import type { Columns, SpeedUnit } from '../model/types';
import { haversine, quantilesIn } from '../derive/geo';

/** Factor from m/s to each unit. */
export const UNIT_FACTOR: Record<SpeedUnit, number> = { ms: 1, kmh: 3.6, knots: 3600 / 1852, mph: 3600 / 1609.344 };

/** Every speed unit, in the order the properties page offers them. */
export const SPEED_UNITS = Object.keys(UNIT_FACTOR) as SpeedUnit[];

/**
 * Speeds read from a file's numbers as one unit (stored in m/s, as the reader
 * stores them), read again as another: the file's numbers back, each divided
 * by the new unit's factor as the reader divides by the first one's. A new
 * column; the old one is left as it was.
 */
export function rereadSpeeds(speed: Float32Array, from: SpeedUnit, to: SpeedUnit): Float32Array {
  const a = UNIT_FACTOR[from], b = UNIT_FACTOR[to];
  const out = new Float32Array(speed.length);
  for (let i = 0; i < speed.length; i++) out[i] = (speed[i] * a) / b;
  return out;
}

export interface UnitGuess {
  unit: SpeedUnit;
  /** Whether the numbers clearly matched one unit. */
  confident: boolean;
}

/**
 * Works out which unit a speed column uses by comparing it with the speed
 * implied by the positions and times. Files often don't say, and vendor
 * extensions differ (some write km/h, Garmin's extension writes m/s).
 */
export function inferSpeedUnit(cols: Columns, raw: ArrayLike<number>): UnitGuess {
  const ratios = new Float64Array(Math.max(0, cols.n - 2));
  let m = 0;
  for (let i = 1; i < cols.n - 1; i++) {
    const v = raw[i];
    if (!(v > 0) || cols.seg[i] || cols.seg[i + 1]) continue;
    const dt = (cols.t[i + 1] - cols.t[i - 1]) / 1000;
    if (dt <= 0 || dt > 120) continue;
    const d = haversine(cols.lat[i - 1], cols.lon[i - 1], cols.lat[i + 1], cols.lon[i + 1]) / dt;
    if (d < 1.5) continue;
    const q = v / d;
    if (q - q === 0) ratios[m++] = q; // finite, as the median counts
  }
  if (m < 10) return { unit: 'ms', confident: false };
  const r = quantilesIn(ratios, m, [0.5])[0];
  let best: SpeedUnit = 'ms';
  let bestErr = Infinity;
  for (const u of Object.keys(UNIT_FACTOR) as SpeedUnit[]) {
    const err = Math.abs(Math.log(r / UNIT_FACTOR[u]));
    if (err < bestErr) { bestErr = err; best = u; }
  }
  return { unit: best, confident: bestErr < Math.log(1.2) };
}
