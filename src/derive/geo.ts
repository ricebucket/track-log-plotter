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
  return quantiles(values, [q])[0];
}

/**
 * Linear-interpolated quantiles of the finite values (qs ascending, each in
 * 0..1): the same, to the bit, as from the sorted values, but found by
 * selection, in linear time.
 */
export function quantiles(values: ArrayLike<number>, qs: number[]): number[] {
  const a = new Float64Array(values.length);
  let m = 0;
  for (let i = 0; i < values.length; i++) { const v = values[i]; if (v - v === 0) a[m++] = v; } // v - v === 0: finite
  return quantilesIn(a, m, qs);
}

/**
 * The quantiles of a[0, m), which must hold only finite values. It rearranges
 * a; the readers and derive fill a scratch array as they go and hand it here.
 */
export function quantilesIn(a: Float64Array, m: number, qs: number[]): number[] {
  if (m === 0) return qs.map(() => NaN);
  // The positions either side of each quantile, ascending: with qs ascending,
  // a floor below the last position taken is a position already taken.
  const at: number[] = [];
  for (const q of qs) {
    const pos = (m - 1) * q, lo = Math.floor(pos), hi = Math.ceil(pos);
    if (!at.length || lo > at[at.length - 1]) at.push(lo);
    if (hi > at[at.length - 1]) at.push(hi);
  }
  place(a, m, at);
  const zero = signedZeros(a, m);
  return qs.map((q) => {
    const pos = (m - 1) * q, lo = Math.floor(pos), hi = Math.ceil(pos);
    const vlo = zero(lo);
    return lo === hi ? vlo : vlo + (zero(hi) - vlo) * (pos - lo);
  });
}

/**
 * Rearranges a[0, m) so that a[p] holds the value a sort would put there, for
 * every position p in `at` (ascending, repeats allowed): one selection splits
 * the range around the middle position, and each side is done the same way,
 * so k positions cost about log2(k) passes instead of a sort.
 */
export function place(a: Float64Array, m: number, at: ArrayLike<number>) {
  const pos = new Int32Array(at.length);
  let k = 0;
  for (let i = 0; i < at.length; i++) {
    const p = at[i];
    if (p < 0 || p >= m || (k > 0 && p === pos[k - 1])) continue;
    if (k > 0 && p < pos[k - 1]) throw new RangeError('positions must be ascending');
    pos[k++] = p;
  }
  placeRange(a, 0, m, pos, 0, k);
}

function placeRange(a: Float64Array, from: number, to: number, pos: Int32Array, pa: number, pb: number) {
  while (pa < pb) {
    const mid = (pa + pb) >> 1, p = pos[mid];
    select(a, from, to, p);
    // Everything before p is no larger, everything after no smaller: the
    // positions on each side are found within their side. The smaller side by
    // recursion, the larger in this loop, so the stack stays shallow.
    if (mid - pa < pb - mid) { placeRange(a, from, p, pos, pa, mid); from = p + 1; pa = mid + 1; }
    else { placeRange(a, p + 1, to, pos, mid + 1, pb); to = p; pb = mid; }
  }
}

/**
 * Reads placed positions of a[0, m) as a sort would have them, -0 included: a
 * sort puts -0 before 0, but selection can't tell them apart, so a 0 found at
 * a position gets the sign a sort would give it there. The signs are counted
 * once, and only if a 0 is read.
 */
function signedZeros(a: Float64Array, m: number): (p: number) => number {
  let end = -2; // where the -0s end in sorted order; -1: there are none
  return (p) => {
    const v = a[p];
    if (v !== 0) return v;
    if (end === -2) {
      let neg = 0, negZero = 0;
      for (let i = 0; i < m; i++) { const x = a[i]; if (x < 0) neg++; else if (x === 0 && 1 / x < 0) negZero++; }
      end = negZero ? neg + negZero : -1;
    }
    return p < end ? -0 : 0;
  };
}

/**
 * `size` evenly spaced values of a[0, m) in sorted order, from the smallest
 * to the largest: a[round(j (m - 1) / (size - 1))] of the sorted values. A
 * short summary of a distribution (empty without values).
 *
 * The values are 32-bit floats (speeds and heights are stored that way), and
 * they are picked by their bits: one pass turns each value into a key that
 * orders like the value (-0 before 0, as a sort has it) and tallies the keys'
 * top 16 bits, which says in which group of keys each wanted position lies; a
 * second pass gathers just those groups, and selection finds the positions
 * inside each. a is overwritten.
 */
export function spread(a: Float32Array, m: number, size: number): Float32Array {
  if (m === 0) return new Float32Array(0);
  const keys = new Uint32Array(a.buffer, a.byteOffset, m);
  const { start, room, next } = (tallies ??= { start: new Int32Array(GROUPS + 1), room: new Int32Array(GROUPS).fill(-1), next: new Int32Array(GROUPS).fill(-1) });
  start.fill(0); // start[g]: where group g begins in sorted order
  for (let i = 0; i < m; i++) {
    const bits = keys[i];
    const k = (bits & 0x80000000 ? ~bits : bits | 0x80000000) >>> 0; // negatives reversed, below the positives
    keys[i] = k;
    start[(k >>> 16) + 1]++;
  }
  for (let g = 1; g <= GROUPS; g++) start[g] += start[g - 1];
  // The wanted positions ascend, and so do their groups.
  const want = new Int32Array(size), groupOf = new Int32Array(size);
  let total = 0;
  for (let j = 0, g = 0; j < size; j++) {
    const p = Math.round((j * (m - 1)) / (size - 1));
    while (start[g + 1] <= p) g++;
    want[j] = p; groupOf[j] = g;
    if (room[g] < 0) { room[g] = next[g] = total; total += start[g + 1] - start[g]; }
  }
  const got = new Uint32Array(total);
  for (let i = 0; i < m; i++) { const k = keys[i], at = next[k >>> 16]; if (at >= 0) { got[at] = k; next[k >>> 16] = at + 1; } }
  // Inside each group, its wanted positions by selection; then the keys back to values.
  const pos = new Int32Array(size), out = new Float32Array(size), bitsOut = new Uint32Array(out.buffer);
  for (let j = 0; j < size;) {
    const g = groupOf[j], base = room[g] - start[g];
    let e = j, np = 0;
    for (; e < size && groupOf[e] === g; e++) if (!np || want[e] + base !== pos[np - 1]) pos[np++] = want[e] + base;
    placeKeys(got, room[g], room[g] + start[g + 1] - start[g], pos, 0, np);
    for (; j < e; j++) { const k = got[want[j] + base]; bitsOut[j] = k & 0x80000000 ? k & 0x7fffffff : ~k >>> 0; }
  }
  for (let j = 0; j < size; j++) room[groupOf[j]] = next[groupOf[j]] = -1;
  return out;
}

/** Groups of keys by their top 16 bits. */
const GROUPS = 65536;

/**
 * spread()'s tallies by group (0.8 MB), made on its first call and kept for
 * the next ones: `room` (where a needed group's keys go in the gathered array)
 * and `next` (where its next key goes) are -1 except during a call.
 */
let tallies: { start: Int32Array; room: Int32Array; next: Int32Array } | null = null;

/**
 * How many partition rounds a selection over `size` values gets: about
 * twice the halvings it takes. An order made to defeat the middle pivot (each
 * round then sets aside a single value) would make the work grow with the
 * square of the count; once the rounds run out, what is left is sorted.
 */
function roundsFor(size: number): number {
  return 2 * Math.ceil(Math.log2(size + 1)) + 8;
}

/** place() for keys: every position in pos[pa, pb) (ascending) of a[from, to) gets the key a sort would put there. */
function placeKeys(a: Uint32Array, from: number, to: number, pos: Int32Array, pa: number, pb: number) {
  while (pa < pb) {
    const mid = (pa + pb) >> 1, p = pos[mid];
    let lo = from, hi = to - 1, rounds = roundsFor(to - from);
    while (lo < hi) {
      if (--rounds < 0) { a.subarray(lo, hi + 1).sort(); break; }
      const pivot = a[(lo + hi) >> 1];
      let i = lo, j = hi;
      while (i <= j) {
        while (a[i] < pivot) i++;
        while (a[j] > pivot) j--;
        if (i <= j) { const t = a[i]; a[i] = a[j]; a[j] = t; i++; j--; }
      }
      if (p <= j) hi = j; else if (p >= i) lo = i; else break;
    }
    if (mid - pa < pb - mid) { placeKeys(a, from, p, pos, pa, mid); from = p + 1; pa = mid + 1; }
    else { placeKeys(a, p + 1, to, pos, mid + 1, pb); to = p; pb = mid; }
  }
}

/** The value at position p (the p-th smallest, from 0) of a[0, m) of finite values. It rearranges a. */
export function nth(a: Float64Array, m: number, p: number): number {
  if (p < 0 || p >= m) return NaN;
  select(a, 0, m, p);
  return signedZeros(a, m)(p);
}

/**
 * Rearranges a[from, to) so that a[k] is its (k - from)-th smallest value,
 * with nothing larger before it and nothing smaller after it (Hoare's
 * selection, middle pivot; sorting what is left if the rounds run out, see
 * roundsFor).
 */
function select(a: Float64Array, from: number, to: number, k: number) {
  let lo = from, hi = to - 1, rounds = roundsFor(to - from);
  while (lo < hi) {
    if (--rounds < 0) { a.subarray(lo, hi + 1).sort(); return; }
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
