import { describe, expect, it } from 'vitest';
import { buildScale, logEdges, niceEdges, niceNumber, stepOf, STEPS, timeShares, valueAt } from '../../src/color/scale';
import { FAMILIES, palette, haloExtra, haloStyle, SINGLE } from '../../src/color/palettes';
import { load } from '../helpers/fixtures';

const a = load('central-park-loop.nmea');
const b = load('central-park-loop-vendor.gpx');
const c = load('roosevelt-island-run.gpx');

describe('scales', () => {
  it('rounds quantile edges to round numbers', () => {
    expect(niceEdges([8.3, 15.2, 22.6, 28.1])).toEqual([8, 16, 22, 28]);
    expect(niceEdges([4.4, 4.6, 4.8, 5.1])).toEqual([4.4, 4.6, 4.8, 5.1]);
    const flat = niceEdges([5, 5, 5, 5]);
    expect(flat).toHaveLength(4);
  });

  it('shares speed steps across all loaded tracks', () => {
    const s = buildScale('speed', [a, b, c]);
    expect(s.steps).toBe(5);
    expect(s.edges).toHaveLength(4);
    for (let k = 1; k < 4; k++) expect(s.edges[k]).toBeGreaterThan(s.edges[k - 1]);
    // The same value falls in the same step whichever track it comes from.
    expect(stepOf(s, 20)).toBe(stepOf(buildScale('speed', [c, b, a]), 20));
  });

  it('converts to display units before choosing steps', () => {
    const kmh = buildScale('speed', [a]);
    const mph = buildScale('speed', [a], 1 / 1.609344);
    expect(mph.edges[0]).toBeLessThan(kmh.edges[0]);
    expect(stepOf(mph, 100)).toBe(4);
  });

  it('uses fixed steps for grade, HDOP and satellites', () => {
    expect(buildScale('grade', [a]).edges).toEqual([1, 2, 4, 6]);
    const h = buildScale('hdop', [a]);
    expect([0.9, 2, 4.9, 12].map((v) => stepOf(h, v))).toEqual([0, 1, 1, 3]);
    const s = buildScale('sats', [a]);
    expect([12, 10, 8, 5, 3].map((v) => stepOf(s, v))).toEqual([0, 0, 1, 2, 3]);
  });

  it('ranks non-standard HDOP by the track\'s own quartiles', () => {
    const s = buildScale('hdop', [a, b], 1, b);
    expect(s.relative).toBe(true);
    expect(s.edges).toEqual(b.derived.hdopQ!.map((q) => Number(q.toFixed(2))));
  });

  it('puts corrected fixes in the second fix-type step', () => {
    const f = buildScale('fix', [a]);
    expect(stepOf(f, 1)).toBe(0);
    expect(stepOf(f, 2)).toBe(1);
    expect(stepOf(f, NaN)).toBe(-1);
  });

  it('reads grade as steepness, uphill or downhill', () => {
    const i = Array.from(a.derived.grade).findIndex((g) => g < -1);
    expect(i).toBeGreaterThan(-1);
    expect(valueAt(a, 'grade', i)).toBeGreaterThan(1);
  });

  it('splits the track\'s time across steps', () => {
    const shares = timeShares(a, buildScale('speed', [a]));
    expect(shares.reduce((x, y) => x + y, 0)).toBeCloseTo(1, 6);
  });

  it('rounds log-scale edges to round numbers', () => {
    expect([0.93, 4.4, 7.2, 13, 14, 22, 47, 180].map(niceNumber)).toEqual([1, 4, 8, 12, 15, 20, 50, 200]);
    expect(logEdges(2.5, 95, 5)).toEqual([5, 10, 20, 50]);
  });

  it('steps acceleration by fixed amounts in g above the 1 g of rest, the same on every track', () => {
    const s = buildScale('accel', [load('central-park-loop-motion.csv')]);
    expect(s.edges).toEqual([1.1, 1.25, 1.5, 2]);
    expect(stepOf(s, 1.02)).toBe(0);
    expect(stepOf(s, 1.3)).toBe(2);
    expect(stepOf(s, 2.4)).toBe(4);
  });

  it('defines a step count for every measure', () => {
    expect(STEPS).toEqual({ speed: 5, ele: 5, grade: 5, hdop: 4, sats: 4, fix: 2, accel: 5 });
  });
});

describe('palettes', () => {
  it('uses broad multi-hue scales for a lone track', () => {
    expect(palette(1, 'speed', false, true)).toEqual(SINGLE.mag.light5);
    expect(palette(2, 'hdop', true, true)).toEqual(SINGLE.qual.dark4);
    expect(palette(0, 'fix', false, true)).toEqual(SINGLE.fix.light2);
  });

  it('uses each track\'s own range when several are shown', () => {
    expect(palette(0, 'speed', false, false)).toEqual(FAMILIES[0].light5);
    expect(palette(1, 'sats', false, false)).toEqual(FAMILIES[1].light4);
    expect(palette(2, 'none', false, false)).toEqual([FAMILIES[2].light5[2]]);
    expect(palette(4, 'speed', false, false)).toEqual(FAMILIES[1].light5);
  });

  it('gives each step count a halo width per step', () => {
    for (const n of [2, 4, 5]) {
      const w = haloExtra(n);
      expect(w).toHaveLength(n);
      for (let k = 1; k < n; k++) expect(w[k]).toBeGreaterThan(w[k - 1]);
    }
    expect(haloStyle(0, false, true).color).toBe('#1b2a38');
    expect(haloStyle(1, false, false).color).toBe(FAMILIES[1].light5[0]);
  });
});
