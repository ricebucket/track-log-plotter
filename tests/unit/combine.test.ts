// Combining logs of the same trip (src/combine): the instant checks, the clock
// fix, leaving out, held positions, trust, speed from the logs' own speeds and
// the elevation offset. The Stanford drive brings three real-looking loggers;
// small synthetic walks in Central Park cover the rest.
import { describe, expect, it } from 'vitest';
import { checkCombine, combineTracks, isCombined, MAX_LOG_SECONDS, recombine, Use, type ComboTrack } from '../../src/combine/combine';
import type { LoadedTrack } from '../../src/model/types';
import { load } from '../helpers/fixtures';
import { KY, loop, walk } from '../helpers/walks';

const car = load('stanford-drive-car.nmea');
const phone = load('stanford-drive-phone.gpx');
const loggerCsv = load('stanford-drive-logger.csv');
const logger = load('stanford-drive-logger.gpx');

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

  it('checks a log of a single fix too: it shares no time with a log it lies outside', () => {
    const lone = (s: number) => walk({ seed: 3, seconds: 1, shiftS: s });
    expect(checkCombine([walk(), lone(120)])).toEqual({ ok: true });
    expect(checkCombine([walk(), lone(-3600)])).toEqual({ ok: false, reason: 'noOverlap' });
    expect(checkCombine([lone(0), lone(20 * 365 * 86_400)])).toEqual({ ok: false, reason: 'noOverlap' });
  });
});

describe('combining logs that span a long time', () => {
  it('lays out only the seconds the logs cover: a stray fix 60 days before adds one second, not 60 days of them', () => {
    const a = walk({ seed: 41 }), b = walk({ seed: 42, offsetM: 3 }), stray = walk({ seed: 42, offsetM: 3, stray: 60 * 86_400 });
    const plain = combined([a, b]), far = combined([a, stray]);
    expect(far.cols.n).toBe(plain.cols.n + 1);
    expect(far.cols.t[0]).toBe(a.cols.t[0] - 60 * 86_400_000);
    for (const k of ['t', 'lat', 'lon', 'speed'] as const) expect(Array.from(far.cols[k].subarray(1))).toEqual(Array.from(plain.cols[k]));
    // How quickly: tests/unit/performance.test.ts.
  }, 30_000);

  it(`refuses logs covering more than ${MAX_LOG_SECONDS / 1e6} million seconds between them, and counts only the seconds they cover`, () => {
    // Two loggers with a fix every 1000 s for 40 days (no gap at that pace): 3.46 million seconds each.
    const n = (40 * 86_400) / 1000;
    expect(combineTracks([loop(n, { stepS: 1000 }), loop(n, { stepS: 1000, northM: 3, seed: 2 })])).toEqual({ ok: false, reason: 'tooLong' });
    // The same 40 days with fixes only in the first and last 12 hours: 43,001 seconds each, twice.
    const keep = (i: number) => i <= 43 || i >= n - 44;
    const r = combineTracks([loop(n, { stepS: 1000, keep }), loop(n, { stepS: 1000, northM: 3, seed: 2, keep })]);
    expect(r.ok && r.track.cols.n).toBe(2 * 43_001);
  }, 30_000);

  it("fills in a log's left-out speeds in one pass, however many come in a row", () => {
    // Every fix of the second log records 0 while it moves. Each was filled by looking along the whole run: 2.5 s.
    const a = loop(40_000), zero = loop(40_000, { northM: 3, seed: 2, speed: 0 });
    const c = combined([a, zero]); // how quickly: tests/unit/performance.test.ts
    // With no speed after them to run to, its 0s stay left out: past its first fix, the speed is the first log's.
    expect(Array.from(c.cols.speed.subarray(1)).every((v) => Math.abs(v - 1.5) < 1e-6)).toBe(true);
  }, 30_000);
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
    // Where the car counts, no grade steeper than the car's own, and no more climb than the car's, give or take.
    // (Before the car's log starts, the phone stands alone at the station: its own heights are all there is.)
    const steep = (t: LoadedTrack, keep: (i: number) => boolean = () => true) => {
      const g = Array.from(t.derived.grade, (v, i) => (keep(i) ? Math.abs(v) : NaN)).filter(Number.isFinite).sort((a, b) => a - b);
      return g[Math.floor(g.length * 0.99)];
    };
    expect(steep(three, (i) => three.combo.use[0][i] === Use.Used)).toBeLessThan(steep(car) + 3);
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

  it('takes any new trust: no change of the log trusted most finds two of the logs to be one recording', () => {
    for (const trust of [[1, 0, 0], [0, 1, 0], [0, 0, 1]]) expect(recombine(three, trust).combo.sources.map((s) => s.trust)).toEqual(trust);
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

describe('a source trusted 100%', () => {
  // The phone jumps off the road around 691-711 s, and is left out there; with all the trust in it, it isn't.
  // Both versions keep the phone's clock (it's trusted most in each), so their seconds line up.
  const most = combined([car, phone], [0.01, 0.99]);
  const all = recombine(most, [0, 1]);
  const leftOut = (c: ComboTrack) => Array.from(c.combo.use[1]).flatMap((u, i) => (u === Use.LeftOut ? [i] : []));

  it('is never left out: where it was, the combined track is that source', () => {
    const out = leftOut(most);
    expect(out.length).toBeGreaterThanOrEqual(10);
    expect(leftOut(all)).toEqual([]);
    for (const i of out) {
      expect(all.combo.use[1][i]).toBe(Use.Used);
      expect(all.combo.use[0][i]).toBe(Use.Idle); // at 0%, not needed there
      expect(metres(all.cols.lat[i], all.cols.lon[i], all.combo.srcLat[1][i], all.combo.srcLon[1][i])).toBeLessThan(0.01);
    }
  });

  it('is the same from a trust change as from a fresh combination', () => {
    const fresh = combined([car, phone], [0, 1]);
    expect(Array.from(fresh.combo.use[1])).toEqual(Array.from(all.combo.use[1]));
    expect(Array.from(fresh.cols.lat)).toEqual(Array.from(all.cols.lat));
  });

  it('takes nothing from leaving out short of 100%: at 99% the phone is still left out in its jump', () => {
    expect(leftOut(most)).toEqual(leftOut(combined([car, phone], [0.4, 0.6])));
  });
});

describe('combining logs: corner cases', () => {
  // A logger that repeats its last fix while it has no new one, recording a speed of 0 meanwhile:
  // the repeats are dropped when its file is read, and the step across them isn't a gap.
  const REPEATER = 'igotU_GPS_WIN'; // the creator its software writes (data, so it keeps the maker's name)

  it('draws a log across the repeats dropped from it, straight from where it stopped to where it moved on', () => {
    // The stuck log repeats its fix from 100 s to 140 s while both walk east at 1.5 m/s.
    const moving = walk({ seed: 2 }), stuck = walk({ seed: 3, offsetM: 3, hold: [100, 140], holdSpeed: 0, creator: REPEATER });
    expect(stuck.cols.n).toBe(300 - 39);
    const c = combined([moving, stuck]);
    const T0 = moving.cols.t[0];
    const at = (s: number) => c.cols.t.findIndex((t) => t === T0 + s * 1000);
    // It counts throughout.
    for (let s = 101; s < 140; s++) expect(c.combo.use[1][at(s)]).toBe(Use.Used);
    // Halfway, it's on the line between its fixes at 100 s and 140 s: near the moving log, not where it stopped.
    const k = moving.cols.t.findIndex((t) => t === T0 + 120_000), mid = at(120);
    expect(metres(c.combo.srcLat[1][mid], c.combo.srcLon[1][mid], moving.cols.lat[k], moving.cols.lon[k])).toBeLessThan(5);
    // Its recorded 0s went with the repeats: the combined speed stays at walking pace.
    for (let s = 101; s < 140; s++) expect(Math.abs(c.cols.speed[at(s)] - 1.5)).toBeLessThan(0.2);
  });

  it('treats repeats over two minutes as a gap in that log, following the logs that move', () => {
    const moving = walk({ seed: 2 }), stuck = walk({ seed: 3, offsetM: 3, hold: [20, 200], creator: REPEATER });
    const c = combined([moving, stuck]);
    const T0 = moving.cols.t[0];
    const i = c.cols.t.findIndex((t) => t === T0 + 130_000);
    expect(c.combo.use[1][i]).toBe(Use.Absent);
    const j = moving.cols.t.findIndex((t) => t === T0 + 130_000);
    expect(metres(c.cols.lat[i], c.cols.lon[i], moving.cols.lat[j], moving.cols.lon[j])).toBeLessThan(1);
  });

  it("doesn't zigzag between the logs while one keeps repeating its fix and catching up", () => {
    // 8 m apart; the second log repeats its fix 15 s out of every 20, like a logger that only now and then gets
    // a new one. With the repeats counted, the combined line went to the stale fix and snapped back.
    const a = walk({ seed: 4 }), b = walk({ seed: 5, offsetM: 8, holds: (i) => i % 20 > 4 && i < 150, holdSpeed: 0, creator: REPEATER });
    const c = combined([a, b]);
    const T0 = a.cols.t[0];
    // The walk heads east until 150 s: the combined line's north offset there should hold steady.
    const north: number[] = [];
    for (let i = 0; i < c.cols.n; i++) {
      const s = (c.cols.t[i] - T0) / 1000;
      if (s >= 30 && s < 140) north.push((c.cols.lat[i] - 40.7712) * KY);
    }
    north.sort((x, y) => x - y);
    expect(north[Math.floor(north.length * 0.95)] - north[Math.floor(north.length * 0.05)]).toBeLessThan(2.5);
    // And its speed never drops to the stuck log's recorded 0s.
    const slow = Array.from(c.cols.speed).filter((v, i) => (c.cols.t[i] - T0) / 1000 < 140 && v < 1).length;
    expect(slow).toBe(0);
  });

  it("leaves out a recorded 0 at a fix that moved, and runs that log's speed straight across the hold after it", () => {
    // Like the logger: the fix at 100 s moves on but already says 0, then it repeats that fix until 140 s.
    const moving = walk({ seed: 2 }), stuck = walk({ seed: 3, offsetM: 3, hold: [100, 140], holdSpeed: 0, zero: (i) => i === 100, creator: REPEATER });
    const T0 = moving.cols.t[0];
    // On its own the log keeps what it recorded.
    const j = stuck.cols.t.findIndex((t) => t === T0 + 100_000);
    expect(stuck.cols.speed[j]).toBe(0);
    expect(stuck.derived.kmh[j]).toBe(0);
    // Combined, its 0 never pulls the speed down: at 100 s and all through the hold, walking pace.
    const c = combined([moving, stuck]);
    const at = (s: number) => c.cols.t.findIndex((t) => t === T0 + s * 1000);
    for (let s = 100; s < 140; s++) expect(Math.abs(c.cols.speed[at(s)] - 1.5)).toBeLessThan(0.05);
  });

  it('still counts a recorded 0 where the position stayed put: that log stood still', () => {
    // Its fixes from 101 s to 139 s repeat the one at 100 s, with a speed of 0, and it keeps them (not a logger
    // whose repeats are dropped). The other walks on; neither is believed over the other, so both count.
    const moving = walk({ seed: 2 }), still = walk({ seed: 3, offsetM: 3, hold: [100, 140], holdSpeed: 0 });
    const c = combined([moving, still]);
    const T0 = moving.cols.t[0], i = c.cols.t.findIndex((t) => t === T0 + 120_000);
    expect(c.combo.use[1][i]).toBe(Use.Used);
    expect(c.cols.speed[i]).toBeLessThan(1);
  });

  it('has no speed at a second where no log has one, rather than one worked out from its points', () => {
    // The first log's fix at 149 s moves on but says 0, and a gap follows: nothing to run its speed to.
    // The second log stops at 100 s.
    const a = walk({ seed: 2, gap: [150, 200], zero: (i) => i === 149 }), b = walk({ seed: 3, offsetM: 3, seconds: 100 });
    const c = combined([a, b]);
    const i = c.cols.t.findIndex((t) => t === a.cols.t[0] + 149_000);
    expect(c.combo.use[0][i]).toBe(Use.Used);
    expect(c.cols.speed[i]).toBeNaN();
    expect(c.derived.kmh[i]).toBeNaN();
    expect(c.derived.stats.maxKmh).toBeLessThan(5.6);
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

  it('knows the same recording at a fix every 3, 5 or 10 s, and still combines two loggers 3 m apart at that pace', () => {
    // The fixes taken at the same instant were counted only where the fixes either side came within 4 s.
    for (const step of [3, 5, 10]) {
      const a = walk({ seed: 6, seconds: 900, step });
      expect(combineTracks([a, walk({ seed: 6, seconds: 900, step, drop: [450] })])).toEqual({ ok: false, reason: 'duplicate' });
      expect(combineTracks([a, walk({ seed: 7, seconds: 900, step, offsetM: 3 })]).ok).toBe(true);
    }
  });

  it('finds the same recording in any two of three logs, whichever is trusted most, so no change of trust can turn one up later', () => {
    // Only the pairs with the log keeping its clock were checked: trusted most, the other log let the copies through.
    const other = walk({ seed: 9, offsetM: 3, seconds: 299 }), rec = walk({ seed: 6 }), copy = walk({ seed: 6, drop: [150] });
    expect(checkCombine([other, rec, copy])).toEqual({ ok: true });
    for (const trust of [undefined, [1, 0, 0], [0, 1, 0], [0, 0, 1], [0.6, 0.2, 0.2]]) expect(combineTracks([other, rec, copy], { trust })).toEqual({ ok: false, reason: 'duplicate' });
  });

  it("never gives a position that isn't a number, whatever a log's accuracy says", () => {
    // The first log has a gap from 100 s to 200 s, where the second is alone. The second's accuracy is replaced.
    const a = walk({ seed: 2, gap: [100, 200] }), b = walk({ seed: 3, offsetM: 3 });
    const accuracy = (f: (i: number) => number): LoadedTrack => ({ ...b, derived: { ...b.derived, accuracy: Float64Array.from({ length: b.cols.n }, (_, i) => f(i)) } });
    const numbers = (c: ComboTrack) => Array.from(c.cols.lat).every(Number.isFinite) && Array.from(c.cols.lon).every(Number.isFinite);
    // 0 wherever both logs have a fix: its error from their spread came out infinite, and its weight where alone 0.
    const zero = combined([a, accuracy((i) => (i >= 100 && i < 200 ? 1 : 0))]);
    expect(zero.combo.sources.map((s) => Number.isFinite(s.typicalM))).toEqual([true, true]);
    expect(numbers(zero)).toBe(true);
    // Infinite where it is alone: the only weight there is 0, so the logs used there count alike.
    const inf = combined([a, accuracy((i) => (i >= 100 && i < 200 ? Infinity : 1))]);
    expect(numbers(inf)).toBe(true);
    const i = inf.cols.t.findIndex((t) => t === a.cols.t[0] + 150_000);
    expect(metres(inf.cols.lat[i], inf.cols.lon[i], inf.combo.srcLat[1][i], inf.combo.srcLon[1][i])).toBeLessThan(0.01);
  });

  it('warns when the logs are too far apart to be the same trip', () => {
    const r = combineTracks([walk({ seed: 7 }), walk({ seed: 8, offsetM: 250 })]);
    expect(r.ok && r.apart).toBe(true);
    const near = combineTracks([walk({ seed: 7 }), walk({ seed: 8, offsetM: 5 })]);
    expect(near.ok && near.apart).toBe(false);
  });

  it('keeps each log counted by its HDOP averaged over 10 s, worked out when it loads, so the weights don\'t flip from fix to fix', () => {
    // HDOP jumping between 0.5 and 1.5 at every fix: three times worse, then three times better.
    const w = walk({ seed: 11, hdop: (i) => (i % 2 ? 1.5 : 0.5) });
    const a = Array.from(w.derived.accuracy.subarray(10, w.cols.n - 10));
    expect(w.derived.hdopBase).toBe(1.5);
    expect(Math.max(...a) - Math.min(...a)).toBeLessThan(0.1);
    expect(Math.abs(a[0] - 2 / 3)).toBeLessThan(0.05);
  });

  it('corrects a clock a fraction of a second off, in tenths', () => {
    const a = walk({ seed: 9 }), b = walk({ seed: 10, offsetM: 2, shiftS: 0.7 });
    const c = combined([a, b]);
    // A walk at 1.5 m/s: 0.7 s is about 1 m along the way, enough for the fit to see on 300 fixes.
    expect(Math.abs(c.combo.sources[1].clockS - 0.7)).toBeLessThanOrEqual(0.2);
    expect(c.cols.t.every((v) => v % 1000 === 0)).toBe(true);
  });
});
