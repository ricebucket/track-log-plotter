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
export function fixAt(tr: LoadedTrack, t: number, slackMs = 5000): FixInfo | null {
  const c = tr.cols;
  if (c.n === 0 || t < c.t[0] - slackMs || t > c.t[c.n - 1] + slackMs) return null;
  const i = nearestIndex(c.t, t);
  const flag = tr.flags.find((f) => Math.abs(f.t - c.t[i]) <= Math.max(1000, tr.derived.stats.intervalS * 500)) ?? null;
  return {
    i, t: c.t[i], lat: c.lat[i], lon: c.lon[i], kmh: tr.derived.kmh[i], ele: c.ele[i],
    ellipsoid: c.ele[i] + c.geoid[i], grade: tr.derived.grade[i], hdop: c.hdop[i], vdop: c.vdop[i], pdop: c.pdop[i],
    sats: c.sats[i], fixq: c.fixq[i], course: c.course[i], accel: c.accel[i], line: c.line[i], lineEnd: c.lineEnd[i], flag: flag ? flag.n : null,
  };
}
