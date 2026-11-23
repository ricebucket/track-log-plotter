// The helpers the readers use to read values straight out of the text, and
// the selection-based quantiles: each must give exactly what the built-in
// conversion (or sorting) gives.
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { blankAt, isSpace, lastNonSpace, numAt } from '../../src/parse/scan';
import { quantile, quantiles, quantileSorted, sortedFinite } from '../../src/derive/geo';

const same = (a: number, b: number) => Object.is(a, b);

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
    const value = fc.oneof(fc.double(), fc.constantFrom(0, -0, 1, 1, 2, NaN, Infinity, -Infinity), fc.integer({ min: -3, max: 3 }));
    const q = fc.double({ min: 0, max: 1, noNaN: true });
    fc.assert(fc.property(fc.array(value, { maxLength: 60 }), fc.array(q, { minLength: 1, maxLength: 5 }), (vals, qs) => {
      qs.sort((a, b) => a - b);
      const s = sortedFinite(vals);
      const got = quantiles(vals, qs);
      expect(qs.every((p, i) => same(got[i], quantileSorted(s, p))) && same(quantile(vals, qs[0]), quantileSorted(s, qs[0]))).toBe(true);
    }), { numRuns: 3000 });
  });
});
