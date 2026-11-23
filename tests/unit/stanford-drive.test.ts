// The synthetic Stanford drive, recorded by three loggers at once: the fixtures
// for combining logs. From the Palo Alto Caltrain station down Palm Drive, a
// quarter of the Campus Drive loop counterclockwise to Santa Teresa Street,
// out by Lomita Drive, along Mayfield Avenue, up Campus Drive East to the
// Escondido Road roundabout, and right at the second corner into the lot in
// front of Branner Hall. Each logger
// brings the cases combining has to handle; these tests pin them down.
import { describe, expect, it } from 'vitest';
import { load } from '../helpers/fixtures';
import type { LoadedTrack } from '../../src/model/types';

const car = load('stanford-drive-car.nmea');
const phone = load('stanford-drive-phone.gpx');
const csv = load('stanford-drive-logger.csv');
const logger = load('stanford-drive-logger.gpx');

const KX = 111320 * Math.cos((37.43 * Math.PI) / 180);
const KY = 110540;
const metres = (lat1: number, lon1: number, lat2: number, lon2: number) => Math.hypot((lon1 - lon2) * KX, (lat1 - lat2) * KY);
const median = (v: number[]) => [...v].sort((a, b) => a - b)[Math.floor(v.length / 2)];

/** Distances between two logs at the seconds both have a fix, after moving b's clock by shiftS. */
function apart(a: LoadedTrack, b: LoadedTrack, shiftS = 0): number[] {
  const at = new Map<number, number>();
  for (let j = 0; j < b.cols.n; j++) at.set(b.cols.t[j] + shiftS * 1000, j);
  const out: number[] = [];
  for (let i = 0; i < a.cols.n; i++) {
    const j = at.get(a.cols.t[i]);
    if (j !== undefined) out.push(metres(a.cols.lat[i], a.cols.lon[i], b.cols.lat[j], b.cols.lon[j]));
  }
  return out;
}

/** Each pass of a log within r metres of a point, as [first, last] fix: a pass ends once the log is 2r away. */
function passes(tr: LoadedTrack, [lat, lon]: readonly [number, number], r: number): [number, number][] {
  const out: [number, number][] = [];
  let open = false;
  for (let i = 0; i < tr.cols.n; i++) {
    const d = metres(tr.cols.lat[i], tr.cols.lon[i], lat, lon);
    if (d <= r) {
      if (open) out[out.length - 1][1] = i;
      else { out.push([i, i]); open = true; }
    } else if (d > 2 * r) open = false;
  }
  return out;
}

/** Steps between fixes longer than the usual interval, in seconds. */
function longSteps(tr: LoadedTrack, usualS: number): { at: number; s: number }[] {
  const out: { at: number; s: number }[] = [];
  for (let i = 1; i < tr.cols.n; i++) {
    const s = (tr.cols.t[i] - tr.cols.t[i - 1]) / 1000;
    if (s > usualS) out.push({ at: tr.cols.t[i - 1], s });
  }
  return out;
}

const STATION_CURB = [37.44343, -122.16567] as const; // Mitchell Lane, at the Caltrain station
const BRANNER_LOT = [37.42533, -122.16344] as const; // up the driveway one corner past the first lot
const BRANNER_HALL = [37.425574, -122.162818] as const;
// The junctions the drive passes, in order.
const ROUTE = [
  ['Palm Drive and Campus Drive', [37.43452, -122.1679]],
  ['Campus Drive turning into Campus Drive West', [37.43095, -122.17828]],
  ['Campus Drive West and Santa Teresa Street', [37.42675, -122.18133]],
  ['Santa Teresa Street and Lomita Drive', [37.4252, -122.17308]],
  ['Lomita Drive and Mayfield Avenue', [37.42278, -122.1732]],
  ['Mayfield Avenue and Campus Drive East', [37.42141, -122.16841]],
  ['the Escondido Road roundabout', [37.42426, -122.16052]],
] as const;
// Parts of the Campus Drive loop the drive never takes.
const NOT_TAKEN = [
  ['the south end of Campus Drive West', [37.42193, -122.18229]],
  ['the west end of Campus Drive East', [37.41945, -122.17593]],
  ['Campus Drive East north of Escondido Road', [37.42643, -122.15965]],
] as const;

describe('the Stanford drive', () => {
  it('starts at the Palo Alto Caltrain station and ends in the lot in front of Branner Hall', () => {
    const c = car.cols;
    expect(metres(c.lat[0], c.lon[0], ...STATION_CURB)).toBeLessThan(25);
    expect(metres(c.lat[c.n - 1], c.lon[c.n - 1], ...BRANNER_LOT)).toBeLessThan(25);
    expect(metres(c.lat[c.n - 1], c.lon[c.n - 1], ...BRANNER_HALL)).toBeLessThan(100);
    expect(car.derived.stats.distanceM).toBeGreaterThan(5400);
    expect(car.derived.stats.distanceM).toBeLessThan(6000);
  });

  it('passes each junction once, in order: a quarter of Campus Drive counterclockwise, then Santa Teresa, Lomita and Mayfield', () => {
    let last = -1;
    for (const [name, at] of ROUTE) {
      const p = passes(car, at, 30);
      expect(p.length, name).toBe(1);
      expect(p[0][0], name).toBeGreaterThan(last);
      last = p[0][1];
    }
    for (const [name, at] of NOT_TAKEN) expect(passes(car, at, 60), name).toEqual([]);
  });

  it('records the drive on three loggers that agree within their errors', () => {
    expect(median(apart(car, logger))).toBeLessThan(8);
    expect(median(apart(car, phone, -3))).toBeLessThan(10);
  });

  it('has a car log every second, with standard HDOP, satellites, SBAS fixes and the geoid height', () => {
    expect(car.format).toBe('nmea');
    expect(car.fields).toEqual(expect.arrayContaining(['ele', 'speed', 'course', 'hdop', 'sats', 'fix', 'geoid']));
    expect(longSteps(car, 1)).toEqual([]);
    expect(car.derived.hdopRelative).toBe(false);
    expect(median([...car.cols.hdop])).toBeLessThan(1.5);
    expect([...car.cols.fixq].filter((q) => q === 2).length).toBeGreaterThan(car.cols.n / 2);
    expect(median([...car.cols.geoid])).toBeCloseTo(-32.4, 5);
  });

  it('has a phone log with a non-standard HDOP, whose clock runs 3 s fast', () => {
    expect(phone.format).toBe('gpx');
    expect(phone.fields).toEqual(expect.arrayContaining(['ele', 'speed', 'course', 'hdop', 'sats']));
    expect(phone.derived.hdopRelative).toBe(true);
    expect(median([...phone.cols.hdop])).toBeGreaterThan(5);
    const byShift = [-8, -6, -5, -4, -3, -2, -1, 0, 1, 2, 4].map((s) => [s, median(apart(car, phone, s))] as const);
    const best = byShift.reduce((a, b) => (b[1] < a[1] ? b : a));
    expect(best[0]).toBe(-3);
    // It started 90 s before the car, standing at the station.
    expect((car.cols.t[0] - phone.cols.t[0]) / 1000).toBe(87);
    for (let i = 0; i < 60; i++) expect(metres(phone.cols.lat[i], phone.cols.lon[i], ...STATION_CURB)).toBeLessThan(25);
  });

  it('has the phone jump away once, for about 20 s, up to 75 m off', () => {
    const far: number[] = [];
    const at = new Map<number, number>();
    for (let j = 0; j < phone.cols.n; j++) at.set(phone.cols.t[j] - 3000, j);
    for (let i = 0; i < car.cols.n; i++) {
      const j = at.get(car.cols.t[i]);
      if (j !== undefined && metres(car.cols.lat[i], car.cols.lon[i], phone.cols.lat[j], phone.cols.lon[j]) > 40) far.push(car.cols.t[i] / 1000);
    }
    expect(far.length).toBeGreaterThanOrEqual(8);
    expect(far.length).toBeLessThanOrEqual(20);
    expect(far[far.length - 1] - far[0]).toBe(far.length - 1); // one run of seconds
    expect(Math.max(...apart(car, phone, -3))).toBeLessThan(90);
  });

  it('records heights above sea level in the car and above the ellipsoid in the phone, 32.4 m apart here', () => {
    const at = new Map<number, number>();
    for (let j = 0; j < phone.cols.n; j++) at.set(phone.cols.t[j] - 3000, j);
    const dh: number[] = [];
    for (let i = 0; i < car.cols.n; i++) {
      const j = at.get(car.cols.t[i]);
      if (j !== undefined) dh.push(phone.cols.ele[j] - car.cols.ele[i]);
    }
    // The phone's heights scatter by about 8 m, so over the drive their median is good to about 2 m.
    expect(Math.abs(median(dh) + 32.4)).toBeLessThan(4);
  });

  it('has gaps of 8, 35 and 70 s in the phone and one of 60 s in the logger, overlapping one of the phone\'s', () => {
    const p = longSteps(phone, 1);
    expect(p.map((g) => g.s)).toEqual([9, 36, 71]);
    const l = longSteps(logger, 5);
    expect(l.map((g) => g.s)).toEqual([65]);
    // On the phone's clock corrected by 3 s, the logger's gap overlaps the phone's second gap: only the car has fixes there.
    const [a1, b1] = [l[0].at, l[0].at + 65_000];
    const [a2, b2] = [p[1].at - 3000, p[1].at - 3000 + 36_000];
    expect(a1 < b2 && b1 > a2).toBe(true);
    // The converted GPX starts a new segment after the gap.
    expect([...logger.cols.seg].slice(1).filter(Boolean)).toHaveLength(1);
  });

  it('has a logger that starts 150 s late and records every 5 s, without HDOP or satellites', () => {
    expect(csv.format).toBe('fusion');
    expect(csv.fields).not.toContain('hdop');
    expect(csv.fields).not.toContain('sats');
    expect(logger.fields).toEqual(['time', 'position']);
    expect((logger.cols.t[0] - car.cols.t[0]) / 1000).toBe(150);
    expect(longSteps(logger, 5)).toHaveLength(1);
  });

  it('has the logger\'s CSV on local time: read as UTC it shares no time with the others, and 7 h later it is the same recording as its GPX', () => {
    expect(csv.notes.map((n) => n.kind)).toContain('noZone');
    expect(apart(car, csv)).toEqual([]);
    expect(csv.cols.n).toBe(logger.cols.n);
    for (let i = 0; i < csv.cols.n; i++) {
      expect(csv.cols.t[i] + 7 * 3600_000).toBe(logger.cols.t[i]);
      expect(csv.cols.lat[i]).toBe(logger.cols.lat[i]);
      expect(csv.cols.lon[i]).toBe(logger.cols.lon[i]);
    }
  });
});
