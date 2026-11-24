// What the inspector and the timeline readout show at the cursor.
import type { LoadedTrack } from '../model/types';
import { nearestIndex } from './logic';
import { place } from '../derive/geo';

export interface FixInfo {
  i: number;
  t: number;
  lat: number;
  lon: number;
  kmh: number;
  ele: number;
  /** Height above the WGS-84 ellipsoid: elevation plus geoid separation. */
  ellipsoid: number;
  grade: number;
  hdop: number;
  /** Strongest acceleration in g during the fix's second (motion sensor), or NaN. */
  accel: number;
  /**
   * The motion-sensor readings in the fix's second, in g, lowest first (empty
   * without motion data): all of them, or with more than SHOWN_READINGS that
   * many, spread from the lowest to the strongest with the median of them all
   * in the middle (at index SHOWN_READINGS / 2). Only the fix card reads them,
   * so they're found when first read.
   */
  readings: number[];
  /** How many of the second's readings `readings` leaves out. */
  moreReadings: number;
  vdop: number;
  pdop: number;
  sats: number;
  fixq: number;
  course: number;
  line: number;
  lineEnd: number;
  flag: number | null;
}

/** The most motion readings the fix card lists for one fix; a file can hold thousands in a second. */
export const SHOWN_READINGS = 50;

/** The first index of a sorted series at or after t. */
function firstAtOrAfter(times: Float64Array, t: number): number {
  let lo = 0, hi = times.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (times[mid] < t) lo = mid + 1; else hi = mid; }
  return lo;
}

/**
 * The motion readings that belong to fix i: from its time up to the next fix
 * (at most 2 s), lowest first. Past SHOWN_READINGS, just that many, picked by
 * selection rather than a sort of them all: the lowest, the median (the upper
 * middle one for an even count) at index SHOWN_READINGS / 2, the strongest
 * last, and the rest spread evenly between.
 */
function readingsOf(tr: LoadedTrack, i: number): { shown: number[]; more: number } {
  const m = tr.motion, c = tr.cols;
  if (!m || !m.t.length) return { shown: [], more: 0 };
  const from = c.t[i];
  const to = Math.min(i + 1 < c.n ? c.t[i + 1] : Infinity, from + 2000);
  const lo = firstAtOrAfter(m.t, from), n = firstAtOrAfter(m.t, to) - lo;
  if (n <= SHOWN_READINGS) return { shown: Array.from(m.g.subarray(lo, lo + n)).sort((a, b) => a - b), more: 0 };
  const a = Float64Array.from(m.g.subarray(lo, lo + n));
  const half = SHOWN_READINGS >> 1, mid = n >> 1;
  const at = Array.from({ length: SHOWN_READINGS }, (_, j) => (j <= half
    ? Math.round((j * mid) / half)
    : mid + Math.round(((j - half) * (n - 1 - mid)) / (SHOWN_READINGS - 1 - half))));
  place(a, n, at);
  return { shown: at.map((p) => a[p]), more: n - SHOWN_READINGS };
}

/** The fix nearest to a moment in the track's own clock, or null outside the track. */
export function fixAt(tr: LoadedTrack, t: number, slackMs = 5000): FixInfo | null {
  const c = tr.cols;
  if (c.n === 0 || t < c.t[0] - slackMs || t > c.t[c.n - 1] + slackMs) return null;
  const i = nearestIndex(c.t, t);
  const flag = tr.flags.find((f) => Math.abs(f.t - c.t[i]) <= Math.max(1000, tr.derived.stats.intervalS * 500)) ?? null;
  // The readout, the lanes and the other tracks' rows on the fix card never read the readings: find them only when asked.
  let rd: { shown: number[]; more: number } | null = null;
  const readings = () => (rd ??= readingsOf(tr, i));
  return {
    i, t: c.t[i], lat: c.lat[i], lon: c.lon[i], kmh: tr.derived.kmh[i], ele: c.ele[i],
    ellipsoid: c.ele[i] + c.geoid[i], grade: tr.derived.grade[i], hdop: c.hdop[i], vdop: c.vdop[i], pdop: c.pdop[i],
    sats: c.sats[i], fixq: c.fixq[i], course: c.course[i], accel: c.accel[i],
    get readings() { return readings().shown; },
    get moreReadings() { return readings().more; },
    line: c.line[i], lineEnd: c.lineEnd[i], flag: flag ? flag.n : null,
  };
}

/**
 * Whether a track has a fix close to time t (its own clock): within 5 s, or
 * three times its usual interval for slow loggers. Inside a gap it hasn't.
 */
export function hasFixNear(tr: LoadedTrack, t: number): boolean {
  const c = tr.cols;
  if (c.n === 0) return false;
  const i = nearestIndex(c.t, t);
  return Math.abs(c.t[i] - t) <= Math.max(5000, tr.derived.stats.intervalS * 3000);
}
