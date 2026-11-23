// Combining logs of the same trip (src/combine): the instant checks, the clock
// fix, leaving out, held positions, trust, speed from the logs' own speeds and
// the elevation offset. The Stanford drive brings three real-looking loggers;
// small synthetic walks in Central Park cover the rest.
import { describe, expect, it } from 'vitest';
import { checkCombine, combineTracks, isCombined, recombine, smooth, Use, type ComboTrack } from '../../src/combine/combine';
import { parseText } from '../../src/parse/index';
import type { LoadedTrack } from '../../src/model/types';
import { load } from '../helpers/fixtures';

const car = load('stanford-drive-car.nmea');
const phone = load('stanford-drive-phone.gpx');
const loggerCsv = load('stanford-drive-logger.csv');
const logger = load('stanford-drive-logger.gpx');

const KY = 110_540;
const metres = (lat1: number, lon1: number, lat2: number, lon2: number) => Math.hypot((lat1 - lat2) * KY, (lon1 - lon2) * KY * Math.cos((lat1 * Math.PI) / 180));
const median = (v: number[]) => [...v].sort((a, b) => a - b)[v.length >> 1];

/** Distances from the combined track to a log, at the seconds the log has a fix (after moving its clock). */
function gapsTo(c: LoadedTrack, log: LoadedTrack, shiftS = 0): number[] {
  const at = new Map<number, number>();
  for (let j = 0; j < log.cols.n; j++) at.set(log.cols.t[j] - shiftS * 1000, j);
  const out: number[] = [];
  for (let i = 0; i < c.cols.n; i++) {
    const j = at.get(c.cols.t[i]);
    if (j !== undefined) out.push(metres(c.cols.lat[i], c.cols.lon[i], log.cols.lat[j], log.cols.lon[j]));
  }
  return out;
}

function combined(tracks: LoadedTrack[], trust?: number[]): ComboTrack {
  const r = combineTracks(tracks, { trust, name: 'Combined' });
  if (!r.ok) throw new Error(r.reason);
  return r.track;
}

// ---------- synthetic walks in Central Park ----------
interface Walk { offsetM?: number; shiftS?: number; seconds?: number; gap?: [number, number]; hold?: [number, number]; hdop?: (i: number) => number; seed?: number; drop?: number[]; speed?: boolean; ele?: number }
/**
 * A walk at 1.5 m/s, a fix a second, as GPX: east for 150 s, then north (a clock
 * offset only shows where the way turns). `offsetM` puts it that far north.
 */
function walk(o: Walk = {}): LoadedTrack {
  const t0 = Date.UTC(2026, 5, 14, 9, 0, 0) + (o.shiftS ?? 0) * 1000;
  let seed = o.seed ?? 1;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5) * 2;
  const lines: string[] = [];
  let lastLat = 0, lastLon = 0;
  for (let i = 0; i < (o.seconds ?? 300); i++) {
    // Noise is drawn for every second, so skipping a fix doesn't change the others.
    const east = Math.min(i, 150) * 1.5, north = Math.max(0, i - 150) * 1.5;
    let lat = 40.7712 + ((o.offsetM ?? 0) + north + rnd() * 0.8) / KY;
    let lon = -73.9742 + (east + rnd() * 0.8) / (KY * Math.cos((40.7712 * Math.PI) / 180));
    if (o.hold && i > o.hold[0] && i < o.hold[1]) { lat = lastLat; lon = lastLon; }
    lastLat = lat; lastLon = lon;
    if (o.gap && i >= o.gap[0] && i < o.gap[1]) continue;
    if (o.drop?.includes(i)) continue;
    const time = new Date(t0 + i * 1000).toISOString().replace('.000Z', 'Z');
    const extra = `${o.ele === undefined ? '' : `<ele>${o.ele}</ele>`}${o.hdop ? `<hdop>${o.hdop(i).toFixed(1)}</hdop>` : ''}${o.speed === false ? '' : `<extensions><gpxtpx:TrackPointExtension><gpxtpx:speed>1.50</gpxtpx:speed></gpxtpx:TrackPointExtension></extensions>`}`;
    lines.push(`<trkpt lat="${lat.toFixed(7)}" lon="${lon.toFixed(7)}"><time>${time}</time>${extra}</trkpt>`);
  }
  const gpx = `<?xml version="1.0"?><gpx version="1.1" creator="test" xmlns="http://www.topografix.com/GPX/1/1" xmlns:gpxtpx="http://www.garmin.com/xmlschemas/TrackPointExtension/v2"><trk><trkseg>${lines.join('')}</trkseg></trk></gpx>`;
  const r = parseText(gpx, `walk-${o.offsetM ?? 0}-${o.seed ?? 1}.gpx`);
  if (!r.ok) throw new Error(r.error);
  return r.track;
}

describe('combining logs: the instant checks', () => {
  it('takes 2 or 3 logs, never a combined track, and refuses the same recording twice', () => {
    expect(checkCombine([car])).toEqual({ ok: false, reason: 'count' });
    expect(checkCombine([car, phone, logger, walk()])).toEqual({ ok: false, reason: 'count' });
    expect(checkCombine([car, car])).toEqual({ ok: false, reason: 'duplicate' });
    const c = combined([car, phone]);
    expect(checkCombine([c, logger])).toEqual({ ok: false, reason: 'combined' });
    expect(checkCombine([car, phone])).toEqual({ ok: true });
    expect(checkCombine([car, phone, logger])).toEqual({ ok: true });
  });

  it('asks to check the time zone of a log whose file has none, when the logs barely share time', () => {
    // The logger's CSV is on local time, so read as UTC it lies 7 h early.
    expect(checkCombine([car, loggerCsv])).toEqual({ ok: false, reason: 'zone', log: 1 });
  });

  it('refuses logs that share no time at all when no time zone can be set', () => {
    expect(checkCombine([car, load('central-park-loop.nmea')])).toEqual({ ok: false, reason: 'noOverlap' });
  });
});

describe('combining logs: the Stanford drive', () => {
  const three = combined([car, phone, logger]);

  it('puts the combined points on whole seconds, once each', () => {
    const t = three.cols.t;
    expect(t.every((v) => v % 1000 === 0)).toBe(true);
    for (let i = 1; i < three.cols.n; i++) expect(t[i]).toBeGreaterThan(t[i - 1]);
    expect(three.format).toBe('combined');
    expect(isCombined(three)).toBe(true);
  });

  it('finds the phone clock 3 s fast, the car keeping its own', () => {
    const [c, p, l] = three.combo.sources;
    expect(three.combo.ref).toBe(0);
    expect(c.clockS).toBe(0);
    expect(p.clockS).toBeCloseTo(3, 5);
    expect(Math.abs(l.clockS)).toBeLessThan(0.2);
  });

  it('comes out close to the best logger and better than the phone', () => {
    const toCar = median(gapsTo(three, car));
    expect(toCar).toBeLessThan(3);
    expect(toCar).toBeLessThan(median(gapsTo(three, phone, 3)));
    // Three logs pin down each logger's typical error: the car best, the phone worst.
    const [c, p, l] = three.combo.sources.map((s) => s.typicalM);
    expect(c).toBeLessThan(l);
    expect(l).toBeLessThan(p);
  });

  it('leaves the phone out during its jump, so the combined track stays on the road', () => {
    const T0 = car.cols.t[0];
    const phoneUse = three.combo.use[1];
    let out = 0;
    for (let i = 0; i < three.cols.n; i++) {
      const s = (three.cols.t[i] - T0) / 1000;
      if (s >= 691 && s < 711 && phoneUse[i] === Use.LeftOut) out++;
    }
    expect(out).toBeGreaterThanOrEqual(10);
    // At the height of the jump the combined track is still within a few metres of the car.
    const at = gapsTo(three, car).length;
    expect(at).toBeGreaterThan(700);
    const mid = three.cols.t.findIndex((t) => t === T0 + 701_000);
    const j = car.cols.t.findIndex((t) => t === T0 + 701_000);
    expect(metres(three.cols.lat[mid], three.cols.lon[mid], car.cols.lat[j], car.cols.lon[j])).toBeLessThan(10);
  });

  it('takes speed from the logs\' own speeds, never from the combined points', () => {
    const at = new Map<number, number>();
    for (let j = 0; j < car.cols.n; j++) at.set(car.cols.t[j], j);
    const diff: number[] = [], steps: number[] = [];
    for (let i = 0; i < three.cols.n; i++) {
      const j = at.get(three.cols.t[i]);
      if (j !== undefined) diff.push(Math.abs(three.cols.speed[i] - car.cols.speed[j]));
      if (i && three.cols.t[i] - three.cols.t[i - 1] === 1000) steps.push(Math.abs(three.cols.speed[i] - three.cols.speed[i - 1]));
    }
    expect(median(diff)).toBeLessThan(0.3);
    expect([...steps].sort((a, b) => a - b)[Math.floor(steps.length * 0.99)]).toBeLessThan(3);
    expect(three.derived.speedFromFile).toBe(true);
  });

  it('works out the phone\'s steady elevation offset without applying it', () => {
    const off = three.combo.eleOffset!;
    expect(off.from).toBe(0);
    expect(off.to).toBe(1);
    expect(Math.abs(off.m + 32.4)).toBeLessThan(4);
    // The combined elevation is the weighted average as recorded, so it sits between the car and the phone.
    expect(three.fields).toContain('ele');
  });

  it('breaks grade and climb where the logs giving the height change, so the 32 m between car and phone never shows as a slope', () => {
    const breaks = three.eleBreak!;
    expect(breaks.reduce((a, b) => a + b, 0)).toBeGreaterThan(3); // the phone's gaps and jump
    // No grade steeper than the car's own, and no more climb than the car's, give or take.
    const steep = (t: LoadedTrack) => { const g = Array.from(t.derived.grade).filter(Number.isFinite).map(Math.abs).sort((a, b) => a - b); return g[Math.floor(g.length * 0.99)]; };
    expect(steep(three)).toBeLessThan(steep(car) + 3);
    expect(three.derived.stats.climbM!).toBeLessThan(car.derived.stats.climbM! + 15);
  });

  it('has no fix type, satellites or accuracy measure of its own', () => {
    expect(three.fields).not.toContain('hdop');
    expect(three.fields).not.toContain('sats');
    expect(three.fields).not.toContain('fix');
  });

  it('follows only the log trusted fully, and gives that log the clock', () => {
    const carOnly = recombine(three, [0, 1, 0]);
    expect(carOnly.combo.ref).toBe(1);
    expect(carOnly.combo.sources[1].trust).toBe(1);
    // Wherever the phone has a fix, the combined track is the phone (its clock now the reference).
    expect(median(gapsTo(carOnly, phone))).toBeLessThan(0.01);
  });

  it('gives the same track when trust changes as when combining afresh with that trust', () => {
    // The same log trusted most: only the weighted averages are redone. Then a
    // change of the log trusted most, which moves the clocks: everything is.
    for (const trust of [[0.5, 0.2, 0.3], [0.2, 0.3, 0.5], [0, 0.5, 0.5]]) {
      const again = recombine(three, trust), fresh = combined([car, phone, logger], trust);
      expect(again.combo.ref).toBe(fresh.combo.ref);
      for (const k of ['t', 'lat', 'lon', 'ele', 'speed', 'course'] as const) expect(Array.from(again.cols[k])).toEqual(Array.from(fresh.cols[k]));
      expect(again.combo.use.map((u) => Array.from(u))).toEqual(fresh.combo.use.map((u) => Array.from(u)));
      expect(again.combo.sources.map((s) => s.share)).toEqual(fresh.combo.sources.map((s) => s.share));
      expect(Array.from(again.eleBreak!)).toEqual(Array.from(fresh.eleBreak!));
    }
  });
});

describe('combining logs: corner cases', () => {
  it('leaves out held fixes while the other log keeps moving', () => {
    const moving = walk({ seed: 2 }), stuck = walk({ seed: 3, offsetM: 3, hold: [100, 140] });
    const c = combined([moving, stuck]);
    const T0 = moving.cols.t[0];
    const heldS: number[] = [];
    for (let i = 0; i < c.cols.n; i++) if (c.combo.use[1][i] === Use.Held) heldS.push((c.cols.t[i] - T0) / 1000);
    // The hold starts counting as held once the moving log is over 10 m away (about 7 s at 1.5 m/s).
    expect(heldS.length).toBeGreaterThan(25);
    expect(Math.min(...heldS)).toBeGreaterThanOrEqual(102);
    expect(Math.max(...heldS)).toBeLessThan(140);
    // Meanwhile the combined track follows the moving log.
    const i = c.cols.t.findIndex((t) => t === T0 + 130_000);
    const j = moving.cols.t.findIndex((t) => t === T0 + 130_000);
    expect(metres(c.cols.lat[i], c.cols.lon[i], moving.cols.lat[j], moving.cols.lon[j])).toBeLessThan(1);
  });

  it('works out an elevation offset only from the seconds both logs have', () => {
    // Both read 50 m: no offset. The second log covers only the first 100 of
    // the 300 seconds, and the 200 it misses must not count as heights of 0 m.
    const a = walk({ ele: 50 });
    expect(combined([a, walk({ ele: 50, offsetM: 3, seed: 2, seconds: 100 })]).combo.eleOffset).toBeNull();
    // A real offset still shows.
    expect(combined([a, walk({ ele: 18, offsetM: 3, seed: 2, seconds: 100 })]).combo.eleOffset).toMatchObject({ from: 0, to: 1, m: -32 });
  });

  it('uses a log at 0% trust only to fill gaps in the others', () => {
    const main = walk({ seed: 4, gap: [120, 160] }), helper = walk({ seed: 5, offsetM: 4 });
    const c = combined([main, helper], [1, 0]);
    const T0 = main.cols.t[0];
    const idx = (s: number) => c.cols.t.findIndex((t) => t === T0 + s * 1000);
    // Where the main log has a fix, the combined track is the main log.
    const a = idx(60), am = main.cols.t.findIndex((t) => t === T0 + 60_000);
    expect(metres(c.cols.lat[a], c.cols.lon[a], main.cols.lat[am], main.cols.lon[am])).toBeLessThan(0.01);
    expect(c.combo.use[1][a]).toBe(Use.Idle);
    // In the main log's gap, the helper fills in.
    const g = idx(140), gh = helper.cols.t.findIndex((t) => t === T0 + 140_000);
    expect(metres(c.cols.lat[g], c.cols.lon[g], helper.cols.lat[gh], helper.cols.lon[gh])).toBeLessThan(0.01);
    expect(c.combo.use[1][g]).toBe(Use.Used);
  });

  it('calls two logs with the same fixes the same recording, even with one fix missing', () => {
    const a = walk({ seed: 6 }), b = walk({ seed: 6, drop: [150] });
    expect(checkCombine([a, b])).toEqual({ ok: true });
    expect(combineTracks([a, b])).toEqual({ ok: false, reason: 'duplicate' });
  });

  it('warns when the logs are too far apart to be the same trip', () => {
    const r = combineTracks([walk({ seed: 7 }), walk({ seed: 8, offsetM: 250 })]);
    expect(r.ok && r.apart).toBe(true);
    const near = combineTracks([walk({ seed: 7 }), walk({ seed: 8, offsetM: 5 })]);
    expect(near.ok && near.apart).toBe(false);
  });

  it('keeps each log counted by its HDOP averaged over 10 s, so the weights don\'t flip from fix to fix', () => {
    const t = Float64Array.from({ length: 60 }, (_, i) => i * 1000);
    const jitter = Float64Array.from({ length: 60 }, (_, i) => (i % 2 ? 1.5 : 0.5));
    const s = smooth(t, jitter, 10);
    for (let i = 10; i < 50; i++) expect(Math.abs(s[i] - 1)).toBeLessThan(0.1);
  });

  it('corrects a clock a fraction of a second off, in tenths', () => {
    const a = walk({ seed: 9 }), b = walk({ seed: 10, offsetM: 2, shiftS: 0.7 });
    const c = combined([a, b]);
    // A walk at 1.5 m/s: 0.7 s is about 1 m along the way, enough for the fit to see on 300 fixes.
    expect(Math.abs(c.combo.sources[1].clockS - 0.7)).toBeLessThanOrEqual(0.2);
    expect(c.cols.t.every((v) => v % 1000 === 0)).toBe(true);
  });
});
