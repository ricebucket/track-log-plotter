import type { Columns, SpeedUnit } from '../model/types';
import { haversine, median } from '../derive/geo';

/** Factor from m/s to each unit. */
export const UNIT_FACTOR: Record<SpeedUnit, number> = { ms: 1, kmh: 3.6, knots: 3600 / 1852, mph: 3600 / 1609.344 };

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
  const ratios: number[] = [];
  for (let i = 1; i < cols.n - 1; i++) {
    const v = raw[i];
    if (!(v > 0) || cols.seg[i] || cols.seg[i + 1]) continue;
    const dt = (cols.t[i + 1] - cols.t[i - 1]) / 1000;
    if (dt <= 0 || dt > 120) continue;
    const d = haversine(cols.lat[i - 1], cols.lon[i - 1], cols.lat[i + 1], cols.lon[i + 1]) / dt;
    if (d < 1.5) continue;
    ratios.push(v / d);
  }
  if (ratios.length < 10) return { unit: 'ms', confident: false };
  const r = median(ratios);
  let best: SpeedUnit = 'ms';
  let bestErr = Infinity;
  for (const u of Object.keys(UNIT_FACTOR) as SpeedUnit[]) {
    const err = Math.abs(Math.log(r / UNIT_FACTOR[u]));
    if (err < bestErr) { bestErr = err; best = u; }
  }
  return { unit: best, confident: bestErr < Math.log(1.2) };
}
