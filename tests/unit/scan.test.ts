// The helpers the readers use to read values straight out of the text, and
// the selection-based quantiles: each must give exactly what the built-in
// conversion (or sorting) gives.
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { blankAt, isSpace, lastNonSpace, numAt } from '../../src/parse/scan';
import { nth, place, quantile, quantiles, quantilesIn, spread } from '../../src/derive/geo';

const same = (a: number, b: number) => Object.is(a, b);

// The references: sort, then read off (a typed-array sort puts -0 before 0).
const sortedFinite = (v: ArrayLike<number>) => Float64Array.from(Array.from(v).filter(Number.isFinite)).sort();
function quantileSorted(a: Float64Array, q: number): number {
  if (a.length === 0) return NaN;
  const pos = (a.length - 1) * q, lo = Math.floor(pos), hi = Math.ceil(pos);
  return lo === hi ? a[lo] : a[lo] + (a[hi] - a[lo]) * (pos - lo);
}
const value = fc.oneof(fc.double({ noNaN: true, noDefaultInfinity: true }), fc.constantFrom(0, -0, 1, 1, 2), fc.integer({ min: -3, max: 3 }));

describe('numAt', () => {
  it('gives exactly what Number() gives for the slice, on the cases that matter', () => {
    const cases = ['40.7812345', '-73.9665', '0.1', '0.3', '-0', '-0.0', '+5', '.5', '5.', '.', '-', '+', '', '   ', '\t7\t',
      '1e3', '1E-2', '0x1F', '  12  ', '\u00a012\u00a0', '\ufeff3', '123456789012345', '1234567890123456', '9007199254740993',
      '0.000000000000001', '00012', '1.2.3', '- 5', '5 5', 'Infinity', '-Infinity', 'NaN', '1_000', '\u0663', '12abc'];
    const wrong = cases.filter((c) => !same(numAt(`x,${c},y`, 2, 2 + c.length), Number(c)));
    expect(wrong).toEqual([]);
  });

  it('gives exactly what Number() gives on any mix of digits, signs, points and spaces', () => {
    const piece = fc.constantFrom('0', '1', '5', '9', '00', '123', '.', '-', '+', ' ', '\t', 'e', 'x', '\u00a0', '7777777');
    fc.assert(fc.property(fc.array(piece, { maxLength: 12 }).map((p) => p.join('')), fc.string({ maxLength: 3 }), (s, pre) => {
      const text = pre + s + ',';
      expect(same(numAt(text, pre.length, pre.length + s.length), Number(s))).toBe(true);
    }), { numRuns: 5000 });
  });

  it('gives what it is told for a blank field', () => {
    expect(numAt('a,  ,b', 2, 4, NaN)).toBeNaN();
    expect(numAt('a,,b', 2, 2, NaN)).toBeNaN();
    expect(numAt('a, 3 ,b', 2, 5, NaN)).toBe(3);
  });
});

describe('isSpace', () => {
  it('counts as space exactly what trim() and the regex \\s do', () => {
    const wrong: string[] = [];
    for (let c = 0; c <= 0xffff; c++) {
      const ch = String.fromCharCode(c);
      if (isSpace(c) !== /\s/.test(ch) || isSpace(c) !== (ch.trim() === '')) wrong.push(c.toString(16));
    }
    expect(wrong).toEqual([]);
  });

  it('finds blank stretches and the last character that is not space', () => {
    expect(blankAt('a \t\u00a0b', 1, 4)).toBe(true);
    expect(blankAt('a \t\u00a0b', 1, 5)).toBe(false);
    expect(lastNonSpace('abc \r\n ')).toBe(2);
    expect(lastNonSpace(' \n')).toBe(-1);
  });
});

describe('quantiles by selection', () => {
  it('match the sorted values exactly, NaN, infinities, ties and -0 included', () => {
    const any = fc.oneof(fc.double(), fc.constantFrom(0, -0, 1, 1, 2, NaN, Infinity, -Infinity), fc.integer({ min: -3, max: 3 }));
    const q = fc.double({ min: 0, max: 1, noNaN: true });
    fc.assert(fc.property(fc.array(any, { maxLength: 60 }), fc.array(q, { minLength: 1, maxLength: 5 }), (vals, qs) => {
      qs.sort((a, b) => a - b);
      const s = sortedFinite(vals);
      const got = quantiles(vals, qs);
      expect(qs.every((p, i) => same(got[i], quantileSorted(s, p))) && same(quantile(vals, qs[0]), quantileSorted(s, qs[0]))).toBe(true);
    }), { numRuns: 3000 });
  });

  it('match the sorted values when two quantiles fall between the same two values', () => {
    // 5 values: the 0.55 and 0.7 quantiles both sit between the 3rd and 4th.
    const v = [5, 1, 4, 2, 3];
    expect(quantiles(v, [0.55, 0.7])).toEqual([0.55, 0.7].map((q) => quantileSorted(sortedFinite(v), q)));
  });

  it('put every asked-for position where a sort would, and leave the rest on the right side of it', () => {
    fc.assert(fc.property(fc.array(value, { minLength: 1, maxLength: 80 }), fc.array(fc.nat(), { maxLength: 12 }), (vals, raw) => {
      const a = Float64Array.from(vals), m = a.length, s = sortedFinite(vals);
      const at = [...new Set(raw.map((r) => r % m))].sort((x, y) => x - y);
      place(a, m, at);
      expect(at.every((p) => a[p] === s[p] && a.slice(0, p).every((x) => x <= a[p]) && a.slice(p + 1).every((x) => x >= a[p]))).toBe(true);
    }), { numRuns: 2000 });
  });

  it('spreads (of 32-bit values, by their bits) and single picks match the sorted values, -0 included', () => {
    const f32 = fc.oneof(fc.float({ noNaN: true, noDefaultInfinity: true }), fc.constantFrom(0, -0, 1, 1, 2.5, -2.5), fc.integer({ min: -3, max: 3 }));
    fc.assert(fc.property(fc.array(f32, { maxLength: 300 }), fc.integer({ min: 2, max: 40 }), (vals, size) => {
      const s = sortedFinite(vals);
      const sp = spread(Float32Array.from(vals), vals.length, size);
      const want = vals.length ? Float32Array.from({ length: size }, (_, j) => s[Math.round((j * (s.length - 1)) / (size - 1))]) : new Float32Array(0);
      const p = vals.length ? Math.floor(vals.length / 3) : 0;
      expect(Array.from(sp).every((x, j) => same(x, want[j])) && sp.length === want.length && same(nth(Float64Array.from(vals), vals.length, p), vals.length ? s[p] : NaN)).toBe(true);
    }), { numRuns: 2000 });
  });

  it('spreads values crowded into a few groups of bits, as a steady walk\'s speeds are', () => {
    // 100,000 speeds between 4.9 and 5.1 km/h share only a handful of top-16-bit groups.
    let x = 7;
    const v = Float32Array.from({ length: 100_000 }, () => { x = (x * 48271) % 2147483647; return 4.9 + (x / 2147483647) * 0.2; });
    const s = Float32Array.from(v).sort();
    const sp = spread(Float32Array.from(v), v.length, 512);
    expect(Array.from(sp).every((y, j) => same(y, s[Math.round((j * (s.length - 1)) / 511)]))).toBe(true);
  });

  it('stays fast on a long run of equal values and zeros (a log at sea level, a logger standing still)', () => {
    const zeros = new Float32Array(400_000);
    for (let i = 0; i < zeros.length; i += 7) zeros[i] = -0;
    const t0 = performance.now();
    const sp = spread(zeros, zeros.length, 512);
    const q = quantilesIn(new Float64Array(400_000).fill(3), 400_000, [0.1, 0.25, 0.5, 0.75]);
    expect(performance.now() - t0).toBeLessThan(500);
    expect(Object.is(sp[0], -0) && Object.is(sp[511], 0)).toBe(true);
    expect(q).toEqual([3, 3, 3, 3]);
  });
});
