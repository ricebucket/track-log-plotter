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

/** The finite values, sorted ascending, in a typed array (numeric sort, no comparator). */
export function sortedFinite(values: ArrayLike<number>): Float64Array {
  const a = new Float64Array(values.length);
  let k = 0;
  for (let i = 0; i < values.length; i++) { const v = values[i]; if (Number.isFinite(v)) a[k++] = v; }
  return a.subarray(0, k).sort();
}

/** Linear-interpolated quantile of the finite values (q in 0..1). */
export function quantile(values: ArrayLike<number>, q: number): number {
  return quantiles(values, [q])[0];
}

/**
 * Linear-interpolated quantiles of the finite values (qs ascending, each in
 * 0..1), the same as from the sorted values, but found by selection: linear
 * time instead of a sort. Values holding -0 are sorted instead, since the sort
 * puts -0 before 0 and selection can't tell them apart.
 */
export function quantiles(values: ArrayLike<number>, qs: number[]): number[] {
  let m = 0, negZero = false;
  for (let i = 0; i < values.length; i++) { const v = values[i]; if (v - v === 0) { m++; if (v === 0 && 1 / v < 0) negZero = true; } }
  if (negZero) { const s = sortedFinite(values); return qs.map((q) => quantileSorted(s, q)); }
  if (m === 0) return qs.map(() => NaN);
  const a = new Float64Array(m);
  for (let i = 0, j = 0; i < values.length; i++) { const v = values[i]; if (v - v === 0) a[j++] = v; }
  // The positions needed, in order: each one selected leaves everything after
  // it larger or equal, so the next is looked for only after it.
  const need = [...new Set(qs.flatMap((q) => [Math.floor((m - 1) * q), Math.ceil((m - 1) * q)]))].sort((x, y) => x - y);
  const at = new Map<number, number>();
  let from = 0;
  for (const p of need) { select(a, from, m, p); at.set(p, a[p]); from = p + 1; }
  return qs.map((q) => {
    const pos = (m - 1) * q, lo = Math.floor(pos), hi = Math.ceil(pos);
    const vlo = at.get(lo)!;
    return lo === hi ? vlo : vlo + (at.get(hi)! - vlo) * (pos - lo);
  });
}

/**
 * Rearranges a[from, to) so that a[k] is its (k - from)-th smallest value,
 * with nothing larger before it and nothing smaller after it (Hoare's
 * selection, middle pivot).
 */
function select(a: Float64Array, from: number, to: number, k: number) {
  let lo = from, hi = to - 1;
  while (lo < hi) {
    const pivot = a[(lo + hi) >> 1];
    let i = lo, j = hi;
    while (i <= j) {
      while (a[i] < pivot) i++;
      while (a[j] > pivot) j--;
      if (i <= j) { const t = a[i]; a[i] = a[j]; a[j] = t; i++; j--; }
    }
    if (k <= j) hi = j; else if (k >= i) lo = i; else return;
  }
}

export function quantileSorted(a: ArrayLike<number>, q: number): number {
  if (a.length === 0) return NaN;
  const pos = (a.length - 1) * q;
  const lo = Math.floor(pos), hi = Math.ceil(pos);
  return lo === hi ? a[lo] : a[lo] + (a[hi] - a[lo]) * (pos - lo);
}
