// Values in an order made to defeat selection with the middle value as pivot,
// for the selection tests and their timing checks.

/**
 * The ranks 0..m-1 in the order that makes selecting position k of all m
 * values take k + 1 rounds: each round's middle value is the smallest left,
 * and the partition only swaps it to the front of the range. Built by playing
 * those rounds through.
 */
export function adversary(m: number, k: number): Float64Array {
  const at = new Int32Array(m); // at[p]: the value now at position p
  for (let i = 0; i < m; i++) at[i] = i;
  const rank = new Float64Array(m).fill(-1);
  let r = 0;
  for (let lo = 0; lo <= k; lo++) {
    const mid = (lo + m - 1) >> 1;
    rank[at[mid]] = r++;
    const t = at[lo]; at[lo] = at[mid]; at[mid] = t;
  }
  for (let i = 0; i < m; i++) if (rank[i] < 0) rank[i] = r++;
  return rank;
}

/** 32-bit values 4.0, 4.0 + 1 step, ... (the same top 16 bits, so spread() picks them all by selection) in that order. */
export function crowded(rank: Float64Array): Float32Array {
  const out = new Float32Array(rank.length), bits = new Uint32Array(out.buffer);
  for (let i = 0; i < rank.length; i++) bits[i] = 0x40800000 + rank[i];
  return out;
}
