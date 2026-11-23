import { quantilesIn } from './geo';

/** Even the best tenth of a file's fixes above this HDOP: not standard HDOP. */
export const RELATIVE_HDOP = 2.5;

/**
 * Standard HDOP from a receiver using six or more satellites is almost always
 * below 2. Some loggers write a different number into the HDOP field, one that
 * never gets near that. Judge from the numbers alone: when even the best tenth
 * of the fixes sits above 2.5, color the track by its own quartiles instead.
 * When most fixes give a satellite count, only those with six or more count.
 * (derive() makes the same judgment in its own pass over the fixes.)
 */
export function hdopIsRelative(hdop: ArrayLike<number>, sats: ArrayLike<number>): boolean {
  // One pass: both candidate sets, and the count that picks between them.
  const all = new Float64Array(hdop.length), six = new Float64Array(hdop.length);
  let withSats = 0, na = 0, n6 = 0;
  for (let i = 0; i < hdop.length; i++) {
    if (sats[i] >= 0) withSats++;
    const h = hdop[i];
    if (!(h - h === 0)) continue; // not finite
    all[na++] = h;
    if (sats[i] >= 6) six[n6++] = h;
  }
  const [vals, n] = withSats > hdop.length / 2 ? [six, n6] : [all, na];
  if (n < 30) return false;
  return quantilesIn(vals, n, [0.1])[0] > RELATIVE_HDOP;
}
