import { quantile } from './geo';

/**
 * Standard HDOP from a receiver using six or more satellites is almost always
 * below 2. Some loggers write a different number into the HDOP field, one that
 * never gets near that. Judge from the numbers alone: when even the best tenth
 * of the fixes sits above 2.5, color the track by its own quartiles instead.
 */
export function hdopIsRelative(hdop: ArrayLike<number>, sats: ArrayLike<number>): boolean {
  let withSats = 0;
  for (let i = 0; i < sats.length; i++) if (sats[i] >= 0) withSats++;
  const vals: number[] = [];
  for (let i = 0; i < hdop.length; i++) {
    const h = hdop[i];
    if (!Number.isFinite(h)) continue;
    if (withSats > hdop.length / 2 && !(sats[i] >= 6)) continue;
    vals.push(h);
  }
  if (vals.length < 30) return false;
  return quantile(vals, 0.1) > 2.5;
}
