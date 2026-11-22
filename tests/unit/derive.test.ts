import { describe, expect, it } from 'vitest';
import { haversine, bearing, median, quantile } from '../../src/derive/geo';
import { derive, gapThreshold, medianInterval } from '../../src/derive/derive';
import { hdopIsRelative } from '../../src/derive/hdop';
import { inferSpeedUnit, UNIT_FACTOR } from '../../src/parse/units';
import { ColumnBuilder } from '../../src/parse/columns';
import type { ParsedTrack } from '../../src/model/types';
import { load } from '../helpers/fixtures';

/** A straight synthetic track heading north from Central Park at a steady speed. */
function line(n: number, opts: { dt?: number; mps?: number; climb?: number; gapAt?: number; speed?: number } = {}): ParsedTrack {
  const { dt = 1, mps = 5, climb = 0, gapAt = -1, speed } = opts;
  const b = new ColumnBuilder();
  let t = Date.UTC(2026, 5, 14, 13, 0, 0);
  for (let i = 0; i < n; i++) {
    if (i === gapAt) t += 60_000;
    const north = i * mps * dt;
    b.push({ t, lat: 40.78 + north / 111_195, lon: -73.965, ele: 10 + (north * climb) / 100, speed, line: i + 1 });
    t += dt * 1000;
  }
  const cols = b.build();
  return { format: 'gpx', creator: null, name: null, cols, flags: [], problems: [], notes: [], fields: [], lines: n };
}

describe('geometry', () => {
  it('measures distances and bearings', () => {
    // One degree of latitude is about 111.2 km.
    expect(haversine(40, -74, 41, -74)).toBeCloseTo(111_195, -1);
    expect(bearing(40.7, -74, 40.8, -74)).toBeCloseTo(0, 5);
    expect(bearing(40.7, -74, 40.7, -73.9)).toBeCloseTo(90, 0);
  });
  it('computes medians and quantiles of the finite values', () => {
    expect(median([3, NaN, 1, 2])).toBe(2);
    expect(quantile([0, 10], 0.25)).toBe(2.5);
    expect(Number.isNaN(median([]))).toBe(true);
  });
});

describe('derive', () => {
  it('works out distance, speed and moving time', () => {
    const d = derive(line(101, { mps: 5 }));
    expect(d.stats.distanceM).toBeCloseTo(500, 0);
    expect(d.speedFromFile).toBe(false);
    expect(d.kmh[50]).toBeCloseTo(18, 1);
    expect(d.stats.avgKmh).toBeCloseTo(18, 1);
    expect(d.stats.movingS).toBe(100);
    expect(d.stats.intervalS).toBe(1);
  });

  it('prefers the speed recorded in the file', () => {
    const d = derive(line(50, { mps: 5, speed: 2 }));
    expect(d.speedFromFile).toBe(true);
    expect(d.kmh[10]).toBeCloseTo(7.2, 5);
  });

  it('computes grade over a 120 m window', () => {
    const d = derive(line(200, { mps: 2, climb: 5 }));
    expect(d.grade[100]).toBeCloseTo(5, 1);
    expect(d.stats.climbM).toBeGreaterThan(18);
  });

  it('marks gaps and never computes grade across them', () => {
    const d = derive(line(100, { gapAt: 50, climb: 4 }));
    expect(d.gap[50]).toBe(1);
    expect(d.gap.reduce((a, b) => a + b, 0)).toBe(1);
    expect(d.stats.distanceM).toBeCloseTo(98 * 5, 0);
  });

  it('uses a gap threshold of at least 10 s, or five intervals', () => {
    expect(gapThreshold(1)).toBe(10);
    expect(gapThreshold(5)).toBe(25);
    expect(medianInterval(line(20, { dt: 5 }).cols)).toBe(5);
  });

  it('summarises the fixtures', () => {
    const a = load('central-park-loop.nmea');
    expect(a.derived.stats.distanceM / 1000).toBeGreaterThan(8);
    expect(a.derived.stats.distanceM / 1000).toBeLessThan(13);
    expect(a.derived.stats.correctedShare).toBeGreaterThan(0);
    expect(a.notes).toContainEqual(expect.objectContaining({ kind: 'gaps', count: 1 }));
  });
});

describe('HDOP check', () => {
  it('treats standard HDOP as standard', () => {
    const h = Array.from({ length: 200 }, (_, i) => 0.6 + (i % 10) * 0.1);
    const s = Array.from({ length: 200 }, () => 9);
    expect(hdopIsRelative(h, s)).toBe(false);
  });
  it('spots HDOP that never gets near standard values', () => {
    const h = Array.from({ length: 200 }, (_, i) => 3.04 + 0.16 * (i % 30));
    expect(hdopIsRelative(h, new Float32Array(200).fill(NaN))).toBe(true);
    expect(load('central-park-loop-vendor.gpx').derived.hdopRelative).toBe(true);
    expect(load('central-park-loop-garmin.gpx').derived.hdopRelative).toBe(false);
  });
  it('needs enough fixes to decide', () => {
    expect(hdopIsRelative([4, 4, 4], [9, 9, 9])).toBe(false);
  });
});

describe('speed unit inference', () => {
  const tr = line(120, { mps: 6 });
  for (const unit of ['ms', 'kmh', 'knots', 'mph'] as const) {
    it(`recognises ${unit}`, () => {
      const raw = new Float32Array(tr.cols.n).fill(6 * UNIT_FACTOR[unit]);
      expect(inferSpeedUnit(tr.cols, raw)).toEqual({ unit, confident: true });
    });
  }
  it('falls back to m/s when the track barely moves', () => {
    const still = line(50, { mps: 0.2 });
    expect(inferSpeedUnit(still.cols, new Float32Array(50).fill(1)).confident).toBe(false);
  });
});
