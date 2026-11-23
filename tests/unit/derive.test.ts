import { describe, expect, it } from 'vitest';
import { haversine, bearing, median, quantile } from '../../src/derive/geo';
import { ACCURACY_SMOOTH_S, derive, gapThreshold, medianInterval, MOVING_KMH, SPREAD_SIZE } from '../../src/derive/derive';
import { buildScale, evenEdges, logEdges, niceEdges, RUNNING_KMH, STEPS } from '../../src/color/scale';
import { hdopIsRelative } from '../../src/derive/hdop';
import { inferSpeedUnit, UNIT_FACTOR } from '../../src/parse/units';
import { ColumnBuilder } from '../../src/parse/columns';
import type { FixQuality, LoadedTrack, ParsedTrack } from '../../src/model/types';
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

describe('what derive works out once, when a track loads', () => {
  /** Central Park, heading north: a fix a second, with HDOP, satellites, a fix type and a height to taste. */
  function fixes(n: number, at: (i: number) => { north?: number; hdop?: number; sats?: number; fixq?: FixQuality; ele?: number }, fields: ParsedTrack['fields'] = ['time', 'position']): ParsedTrack {
    const b = new ColumnBuilder();
    const t0 = Date.UTC(2026, 5, 14, 13, 0, 0);
    for (let i = 0; i < n; i++) {
      const f = at(i);
      b.push({ t: t0 + i * 1000, lat: 40.78 + (f.north ?? i * 3) / 111_195, lon: -73.965, ele: f.ele, hdop: f.hdop, sats: f.sats, fixq: f.fixq, line: i + 1 });
    }
    return { format: 'gpx', creator: null, name: null, cols: b.build(), flags: [], problems: [], notes: [], fields, lines: n };
  }

  it('knows which measures the track has', () => {
    const d = derive(fixes(80, (i) => ({ ele: 10 + i * 0.5, hdop: 1.2 })));
    expect(d.has).toEqual({ speed: true, ele: true, grade: true, hdop: true, sats: false, fix: false, accel: false });
    expect(derive(fixes(1, () => ({}))).has.speed).toBe(false);
  });

  it('keeps 512 of its moving speeds and of its heights in order, for the shared color steps', () => {
    // Walking, then standing for a minute (stops stay out of the speed spread), heights from 10 m up to 49.5 m.
    const p = fixes(200, (i) => ({ north: i < 140 ? i * 1.5 : 210, ele: 10 + (i % 80) * 0.5 }));
    const d = derive(p);
    for (const sp of [d.speedSpread, d.eleSpread]) {
      expect(sp.length).toBe(SPREAD_SIZE);
      expect(Array.from(sp).every((v, i) => i === 0 || v >= sp[i - 1])).toBe(true);
    }
    const moving = Array.from(d.kmh).filter((v) => v >= MOVING_KMH);
    expect(d.speedSpread[0]).toBe(Math.min(...moving));
    expect(d.speedSpread[SPREAD_SIZE - 1]).toBe(Math.max(...moving));
    expect([d.eleSpread[0], d.eleSpread[SPREAD_SIZE - 1]]).toEqual([10, 49.5]);
    expect(derive(fixes(50, () => ({ north: 7 }))).speedSpread.length).toBe(0);
  });

  it('picks exactly the color steps that sorting every fix would give', () => {
    // A long walk and a short drive shown together, against 512 values of each from its sorted fixes.
    const track = (p: ParsedTrack) => { const tr = { ...p, file: 'x', sizeBytes: 0 } as LoadedTrack; tr.derived = derive(tr); return tr; };
    const both = [track(line(3000, { mps: 1.4, climb: 3 })), track(line(700, { mps: 12, climb: -2 }))];
    const pool = (key: 'speed' | 'ele') => both.flatMap((tr) => {
      const v = Array.from(key === 'speed' ? tr.derived.kmh : tr.cols.ele).filter((x) => (key === 'speed' ? x >= MOVING_KMH : Number.isFinite(x))).sort((x, y) => x - y);
      return Array.from({ length: SPREAD_SIZE }, (_, j) => v[Math.round((j * (v.length - 1)) / (SPREAD_SIZE - 1))]);
    }).sort((x, y) => x - y);
    const q = (v: number[], f: number) => { const pos = (v.length - 1) * f, lo = Math.floor(pos), hi = Math.ceil(pos); return v[lo] + (v[hi] - v[lo]) * (pos - lo); };
    const ele = pool('ele');
    expect(buildScale('ele', both).edges).toEqual(niceEdges([0.2, 0.4, 0.6, 0.8].map((f) => q(ele, f))));
    const sp = pool('speed'), hi = q(sp, 0.95), lo = Math.max(MOVING_KMH, q(sp, 0.05));
    const log = hi > RUNNING_KMH && hi / lo > 1.5;
    expect(buildScale('speed', both)).toMatchObject({ log, edges: log ? logEdges(lo, hi, STEPS.speed) : evenEdges(hi, STEPS.speed) });
  });

  it('keeps each fix\'s accuracy against the log\'s middle HDOP, averaged over 10 s', () => {
    // HDOP 1 for a minute, then 3 for a minute: the middle (upper middle of an even count) is 3.
    const d = derive(fixes(120, (i) => ({ hdop: i < 60 ? 1 : 3, sats: 8, fixq: 1 }), ['time', 'position', 'hdop', 'sats']));
    expect(d.hdopBase).toBe(3);
    expect(d.accuracy[20]).toBeCloseTo(1 / 3, 9);
    expect(d.accuracy[100]).toBeCloseTo(1, 9);
    // Across the change it ramps over the window instead of jumping.
    const half = ACCURACY_SMOOTH_S / 2;
    expect(d.accuracy[60 - half - 1]).toBeCloseTo(1 / 3, 9);
    expect(d.accuracy[60]).toBeGreaterThan(1 / 3);
    expect(d.accuracy[60]).toBeLessThan(1);
    // A corrected fix's error is √½ of the same HDOP's; without HDOP or satellites it is 1.
    const c = derive(fixes(40, () => ({ hdop: 2, fixq: 2 }), ['time', 'position', 'hdop']));
    expect(c.accuracy[20]).toBeCloseTo(Math.SQRT1_2, 9);
    expect(Array.from(derive(fixes(30, () => ({}))).accuracy).every((v) => v === 1)).toBe(true);
    // Satellites when there's no HDOP: the usual count over the fix's.
    const s = derive(fixes(60, (i) => ({ sats: i < 30 ? 10 : 5 }), ['time', 'position', 'sats']));
    expect(s.accuracy[10]).toBeCloseTo(1, 9);
    expect(s.accuracy[50]).toBeCloseTo(2, 9);
  });

  it('marks each fix with the start of its run of identical positions', () => {
    const d = derive(fixes(10, (i) => ({ north: i < 3 ? i * 3 : i < 7 ? 9 : i * 3 })));
    expect(Array.from(d.runStart)).toEqual([0, 1, 2, 3, 3, 3, 3, 7, 8, 9]);
  });
});
