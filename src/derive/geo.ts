const R = 6371008.8; // mean Earth radius, m
const RAD = Math.PI / 180;

/** Great-circle distance in meters. */
export function haversine(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const dLat = (lat2 - lat1) * RAD;
  const dLon = (lon2 - lon1) * RAD;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * RAD) * Math.cos(lat2 * RAD) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** Initial bearing from point 1 to point 2, degrees clockwise from north. */
export function bearing(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const p1 = lat1 * RAD, p2 = lat2 * RAD, dl = (lon2 - lon1) * RAD;
  const y = Math.sin(dl) * Math.cos(p2);
  const x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
  return (Math.atan2(y, x) / RAD + 360) % 360;
}

/** Median of the finite values, or NaN when there are none. */
export function median(values: ArrayLike<number>): number {
  return quantile(values, 0.5);
}

/** Linear-interpolated quantile of the finite values (q in 0..1). */
export function quantile(values: ArrayLike<number>, q: number): number {
  const a: number[] = [];
  for (let i = 0; i < values.length; i++) { const v = values[i]; if (Number.isFinite(v)) a.push(v); }
  if (a.length === 0) return NaN;
  a.sort((x, y) => x - y);
  return quantileSorted(a, q);
}

export function quantileSorted(a: ArrayLike<number>, q: number): number {
  if (a.length === 0) return NaN;
  const pos = (a.length - 1) * q;
  const lo = Math.floor(pos), hi = Math.ceil(pos);
  return lo === hi ? a[lo] : a[lo] + (a[hi] - a[lo]) * (pos - lo);
}
