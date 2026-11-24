// Medians, quantiles and spreads by selection, against values in an order
// made to defeat it: a file can give its HDOPs, heights or speeds in any order.
// Hoare's selection with the middle value as pivot sets aside one value a
// round when the middle value of the range is always its smallest, so a
// median of 100,000 such values took seconds. The rounds are now limited (then
// what is left is sorted): the work stays near linear, and the results stay
// exactly what sorting gives.
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { nth, place, quantilesIn, spread } from '../../src/derive/geo';
import { derive } from '../../src/derive/derive';
import { ColumnBuilder } from '../../src/parse/columns';
import { adversary, crowded } from '../helpers/selection-orders';

const sorted = (v: ArrayLike<number>) => Float64Array.from(v).sort();
const quantileSorted = (s: Float64Array, q: number) => { const pos = (s.length - 1) * q, lo = Math.floor(pos), hi = Math.ceil(pos); return lo === hi ? s[lo] : s[lo] + (s[hi] - s[lo]) * (pos - lo); };

describe('selection against an order made to defeat it', () => {
  // How quickly (milliseconds, where it took seconds): tests/unit/performance.test.ts.
  it('finds the median of 100,000 values', () => {
    const m = 100_000, v = adversary(m, m >> 1);
    expect(quantilesIn(v, m, [0.5])).toEqual([(m - 1) / 2]);
    expect(nth(adversary(m, 60_000), m, 60_000)).toBe(60_000);
  });

  it('spreads 65,536 values that share their top 16 bits', () => {
    const m = 65_536, size = 512, v = crowded(adversary(m, Math.round(((size >> 1) * (m - 1)) / (size - 1))));
    const want = Float32Array.from(v).sort();
    const sp = spread(v, m, size);
    expect(Array.from(sp)).toEqual(Array.from({ length: size }, (_, j) => want[Math.round((j * (m - 1)) / (size - 1))]));
  });

  it('reads a log of 100,000 fixes whose HDOPs come in that order', () => {
    // Without satellite counts the HDOP quartiles and tenth are picked from all fixes; the median goes first.
    const n = 100_000, rank = adversary(n, 49_999), b = new ColumnBuilder();
    for (let i = 0; i < n; i++) b.push({ t: Date.UTC(2026, 5, 14, 8, 0, i), lat: 40.78 + (i % 1000) * 1e-5, lon: -73.965 + Math.floor(i / 1000) * 1e-5, hdop: (rank[i] + 1) / 100, line: i + 1 });
    const p = { format: 'gpx' as const, creator: null, name: null, cols: b.build(), flags: [], problems: [], notes: [], fields: ['time' as const, 'position' as const, 'hdop' as const], lines: n };
    expect(derive(p).stats.medianHdop).toBeCloseTo(500.005, 2);
  });

  it('gives exactly what sorting gives, whether or not the rounds run out', () => {
    // Orders that defeat the pivot at a random position (with negatives, or many signed zeros), and shuffled ones.
    const kinds = ['ranks', 'signed', 'zeros', 'shuffled'] as const;
    fc.assert(fc.property(
      fc.integer({ min: 1, max: 3000 }), fc.double({ min: 0, max: 1, noNaN: true }), fc.constantFrom(...kinds),
      fc.array(fc.double({ min: 0, max: 1, noNaN: true }), { minLength: 1, maxLength: 6 }), fc.integer({ min: 2, max: 600 }),
      (m, kf, kind, qs, size) => {
        const k = Math.min(m - 1, Math.floor(kf * m)), rank = adversary(m, k);
        if (kind === 'shuffled') for (let i = m - 1; i > 0; i--) { const j = (i * 7919 + k) % (i + 1), t = rank[i]; rank[i] = rank[j]; rank[j] = t; }
        const v = Float64Array.from(rank, (r) => (kind === 'signed' ? r - (m >> 1) : kind === 'zeros' ? (r % 3 ? r : r % 2 ? -0 : 0) : r));
        const s = sorted(v);
        expect(Object.is(nth(v.slice(), m, k), s[k])).toBe(true);
        const a = v.slice();
        place(a, m, [k]);
        expect(a[k] === s[k] && a.subarray(0, k).every((x) => x <= a[k]) && a.subarray(k + 1).every((x) => x >= a[k])).toBe(true);
        qs.sort((x, y) => x - y);
        const got = quantilesIn(v.slice(), m, qs);
        expect(qs.every((q, i) => Object.is(got[i], quantileSorted(s, q)))).toBe(true);
        // spread: the same order, as 32-bit values crowded into one group, aimed at its first selection.
        const p = Math.round(((size >> 1) * (m - 1)) / (size - 1)), c = crowded(adversary(m, Math.min(m - 1, p))), cs = Float32Array.from(c).sort();
        const sp = spread(c, m, size);
        expect(Array.from(sp).every((x, j) => x === cs[Math.round((j * (m - 1)) / (size - 1))])).toBe(true);
      }), { numRuns: 300 });
  });
});
