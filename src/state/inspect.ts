// What the inspector and the timeline readout show at the cursor.
import type { LoadedTrack } from '../model/types';
import { nearestIndex } from './logic';

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
  /** Every motion-sensor reading in the fix's second, in g, lowest first (empty without motion data). */
  readings: number[];
  vdop: number;
  pdop: number;
  sats: number;
  fixq: number;
  course: number;
  line: number;
  lineEnd: number;
  flag: number | null;
}

/** The fix nearest to a moment in the track's own clock, or null outside the track. */
/** The motion readings that belong to fix i: from its time up to the next fix (at most 2 s), lowest first. */
function readingsOf(tr: LoadedTrack, i: number): number[] {
  const m = tr.motion, c = tr.cols;
  if (!m || !m.t.length) return [];
  const from = c.t[i];
  const to = Math.min(i + 1 < c.n ? c.t[i + 1] : Infinity, from + 2000);
  let lo = 0, hi = m.t.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (m.t[mid] < from) lo = mid + 1; else hi = mid; }
  const out: number[] = [];
  for (let j = lo; j < m.t.length && m.t[j] < to; j++) out.push(m.g[j]);
  return out.sort((a, b) => a - b);
}

export function fixAt(tr: LoadedTrack, t: number, slackMs = 5000): FixInfo | null {
  const c = tr.cols;
  if (c.n === 0 || t < c.t[0] - slackMs || t > c.t[c.n - 1] + slackMs) return null;
  const i = nearestIndex(c.t, t);
  const flag = tr.flags.find((f) => Math.abs(f.t - c.t[i]) <= Math.max(1000, tr.derived.stats.intervalS * 500)) ?? null;
  return {
    i, t: c.t[i], lat: c.lat[i], lon: c.lon[i], kmh: tr.derived.kmh[i], ele: c.ele[i],
    ellipsoid: c.ele[i] + c.geoid[i], grade: tr.derived.grade[i], hdop: c.hdop[i], vdop: c.vdop[i], pdop: c.pdop[i],
    sats: c.sats[i], fixq: c.fixq[i], course: c.course[i], accel: c.accel[i], readings: readingsOf(tr, i), line: c.line[i], lineEnd: c.lineEnd[i], flag: flag ? flag.n : null,
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
