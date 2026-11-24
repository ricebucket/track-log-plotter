import { describe, expect, it } from 'vitest';
import { boundsIn, boundsOf, buildCursors, buildFixPoints, buildFlags, buildGaps, buildLogCursors, buildLogLines, buildMarks, buildPaths, buildRuns, drawnSteps, metersPerPixel, nearestFix, showsLogs, stepsFor, type MapCtx } from '../../src/map/geojson';
import { combineTracks, Use } from '../../src/combine/combine';
import { addTracks } from '../../src/state/logic';
import { buildScale, stepOf, valueAt } from '../../src/color/scale';
import type { LoadedTrack, MeasureKey } from '../../src/model/types';
import { FAMILIES, LOG_COLORS, palette, SINGLE, UNKNOWN } from '../../src/color/palettes';
import { centerView, columns, graphRange, logColumns, MIN_ZOOM_MS, panView, PLAY_SPEED, playStep, skipGap, snapInto, snapTime, stepFix, tickStep, ticks, wheelZoom } from '../../src/ui/timelineMath';
import { scaleBar } from '../../src/ui/scaleBar';
import { haversine } from '../../src/derive/geo';
import { isMidnight, offsetMinutes } from '../../src/time/zones';
import { load } from '../helpers/fixtures';

const a = load('central-park-loop.nmea');
const b = load('central-park-loop-vendor.gpx');

function ctx(tracks: LoadedTrack[], single: boolean): MapCtx {
  return {
    dark: false, single, selectedId: 'A',
    scaleFor: (tr: LoadedTrack, key: MeasureKey) => buildScale(key, tracks, 1, key === 'hdop' && tr.derived.hdopRelative ? tr : undefined),
  };
}

describe('map features', () => {
  const { items } = addTracks([], [a, b]);

  it('colors runs from each track\'s own range when several are shown', () => {
    const runs = buildRuns(items, ctx([a, b], false));
    const colorsA = new Set(runs.features.filter((f) => f.properties.id === 'A').map((f) => f.properties.c));
    for (const c of colorsA) expect([...FAMILIES[0].light5, '#a3a9ae']).toContain(c);
    const colorsB = new Set(runs.features.filter((f) => f.properties.id === 'B').map((f) => f.properties.c));
    for (const c of colorsB) expect([...FAMILIES[1].light5, '#a3a9ae']).toContain(c);
    // The map draws the selected track on top with layers of its own, so the lines carry no order.
    expect(runs.features.some((f) => 'z' in f.properties)).toBe(false);
    expect(buildPaths(items).features.some((f) => 'z' in f.properties)).toBe(false);
  });

  it('uses the multi-hue scale for a lone track', () => {
    const one = addTracks([], [a]).items;
    const runs = buildRuns(one, ctx([a], true));
    for (const f of runs.features) expect([...SINGLE.mag.light5, '#a3a9ae']).toContain(f.properties.c);
  });

  it('gives halos wider bands at the far end of the scale', () => {
    const runs = buildRuns(items, ctx([a, b], false));
    const widths = new Set(runs.features.filter((f) => Number(f.properties.ho) > 0).map((f) => f.properties.hx));
    expect(widths.size).toBeGreaterThan(1);
  });

  it('breaks lines at gaps and draws the gaps separately', () => {
    const gaps = buildGaps(items);
    expect(gaps.features.filter((f) => f.properties.id === 'A')).toHaveLength(1);
    expect(Number(gaps.features[0].properties.s)).toBeGreaterThan(40);
    const paths = buildPaths(items, ctx([a, b], false));
    expect(paths.features.filter((f) => f.properties.id === 'A')).toHaveLength(2);
  });

  it('places fix glyphs, button presses and cursors', () => {
    const c = ctx([a, b], false);
    expect(buildFixPoints(items, c).features.length).toBe(a.cols.n + b.cols.n);
    expect(buildFlags(items, c).features.map((f) => f.properties.label)).toEqual(['#1', '#2']);
    const cur = buildCursors(items, { A: 0, B: 0 }, a.cols.t[100], c);
    expect(cur.features.map((f) => f.properties.id)).toEqual(['A', 'B']);
    // The selected track's dot sorts on top.
    expect(cur.features.map((f) => f.properties.z)).toEqual([2, 1]);
    expect(buildCursors(items, {}, null, c).features).toEqual([]);
    expect(boundsOf(items)).toEqual([
      Math.min(a.derived.stats.bbox[0], b.derived.stats.bbox[0]), Math.min(a.derived.stats.bbox[1], b.derived.stats.bbox[1]),
      Math.max(a.derived.stats.bbox[2], b.derived.stats.bbox[2]), Math.max(a.derived.stats.bbox[3], b.derived.stats.bbox[3]),
    ]);
  });

  it('smooths away one-fix flickers between steps', () => {
    const s = stepsFor(a, 'hdop', buildScale('hdop', [a]));
    for (let i = 1; i < s.length - 1; i++) expect(s[i - 1] === s[i + 1] && s[i] !== s[i - 1]).toBe(false);
  });

  it('colors the cursor dot as the line is drawn there, one-fix flickers smoothed, as the fix card does', () => {
    const one = addTracks([], [a]).items;
    const c = ctx([a], true);
    const drawn = drawnSteps(a, 'speed', c.scaleFor(a, 'speed'));
    const colors = palette(one[0].fam, 'speed', false, true);
    // Fixes whose own speed falls in another step than the line drawn through them: a flicker smoothed away.
    const flickers = Array.from({ length: a.cols.n }, (_, k) => k).filter((k) => stepOf(c.scaleFor(a, 'speed'), valueAt(a, 'speed', k)) !== drawn[k]);
    expect(flickers.length).toBeGreaterThan(10);
    for (const i of flickers.slice(0, 20)) {
      const dot = buildCursors(one, {}, a.cols.t[i], c).features[0].properties.c;
      expect(dot).toBe(drawn[i] >= 0 ? colors[Math.min(drawn[i], colors.length - 1)] : UNKNOWN.light);
    }
  });
});

describe('picking a fix on the map', () => {
  it('finds the fix nearest to a point, as near as great circles would', () => {
    const c = a.cols;
    for (let k = 0; k < 300; k++) {
      const i = (k * 7919) % c.n;
      // Up to about 40 m off the track, every way.
      const lat = c.lat[i] + (((k % 9) - 4) * 9) / 111_195, lon = c.lon[i] + ((((k >> 3) % 9) - 4) * 9) / 84_300;
      let bd = Infinity;
      for (let j = 0; j < c.n; j++) bd = Math.min(bd, haversine(lat, lon, c.lat[j], c.lon[j]));
      const j = nearestFix(c, lat, lon);
      expect(haversine(lat, lon, c.lat[j], c.lon[j])).toBeLessThanOrEqual(bd + 0.05);
    }
  });

  it('keeps to the pass the cursor is on where a track goes the same way twice', () => {
    // Up Fifth Avenue a fix every metre for a kilometre, and back down the same way.
    const n = 2000;
    const lat = Float64Array.from({ length: n }, (_, i) => 40.7644 + (i < 1000 ? i : 1999 - i) / 111_195);
    const lon = new Float64Array(n).fill(-73.973);
    const cols = { n, lat, lon };
    const at = 40.7644 + 30 / 111_195;
    // On its own, the first pass; dragging along the way back, the way back.
    expect(nearestFix(cols, at, -73.973)).toBe(30);
    expect(nearestFix(cols, at, -73.973, 1960, 5)).toBe(1969);
    // A fix on the same pass that is farther than the tolerance loses to the nearest.
    expect(nearestFix(cols, at, -73.973, 1300, 5)).toBe(30);
  });

});

describe('stepping from fix to fix', () => {
  // Only the fix times matter: A has a fix every second, then one a minute later; B has two of its own.
  const at = (id: string, t: number[]) => ({ id, track: { cols: { t: Float64Array.from(t), n: t.length } } as unknown as LoadedTrack });
  const tracks = [at('A', [0, 1000, 2000, 60_000]), at('B', [1500, 3000])];

  it("goes to the next or previous fix of any track, across gaps, and stops at the ends", () => {
    expect(stepFix(1000, 1, tracks, {})).toBe(1500);
    expect(stepFix(1500, 1, tracks, {})).toBe(2000);
    expect(stepFix(3000, 1, tracks, {})).toBe(60_000); // the 57 s gap in one step
    expect(stepFix(60_000, 1, tracks, {})).toBeNull();
    expect(stepFix(60_000, -1, tracks, {})).toBe(3000);
    expect(stepFix(0, -1, tracks, {})).toBeNull();
    expect(stepFix(-5, 1, tracks, {})).toBe(0);
  });

  it("counts each track's offset on the timeline", () => {
    // B moved 700 ms later: its fixes at 2200 and 3700 on the timeline.
    expect(stepFix(2000, 1, tracks, { B: 700 })).toBe(2200);
    expect(stepFix(3000, -1, tracks, { B: 700 })).toBe(2200);
  });
});

describe('fitting part of the timeline', () => {
  it('bounds only the fixes inside the time range', () => {
    const items = addTracks([], [load('central-park-loop.nmea')]).items;
    const c = items[0].track.cols;
    const all = boundsOf(items)!;
    const part = boundsIn(items, {}, [c.t[0], c.t[200]])!;
    // A tenth of the ride covers a smaller area, inside the whole ride's box.
    expect((part[2] - part[0]) * (part[3] - part[1])).toBeLessThan((all[2] - all[0]) * (all[3] - all[1]) / 2);
    expect(part[0]).toBeGreaterThanOrEqual(all[0]);
    expect(part[3]).toBeLessThanOrEqual(all[3]);
    // Offsets move a track along the timeline; nothing in range means nothing to fit.
    expect(boundsIn(items, { A: 1e9 }, [c.t[0], c.t[200]])).toBeNull();
  });
});

describe('dots for tiny tracks', () => {
  it('marks a shown track only when it is too small to see', () => {
    const items = addTracks([], [load('central-park-loop.nmea'), load('roosevelt-island-run.gpx')]).items;
    expect(buildMarks(items, 14).features).toEqual([]);
    const far = buildMarks(items, 5).features;
    expect(far.map((f) => f.properties.id)).toEqual(['A', 'B']);
    expect(far[0].properties.c).toBe(FAMILIES[items[0].fam % 3].badge);
    // Each dot takes its badge's shape: square for NMEA, circle for GPX.
    expect(far[0].properties.icon).toBe(`tlp-mark-square-${String(far[0].properties.c).slice(1)}`);
    expect(far[1].properties.icon).toMatch(/^tlp-mark-circle-[0-9a-f]{6}$/);
    // The dot sits in the middle of the track's box.
    const box = items[0].track.derived.stats.bbox;
    expect(far[0].geometry.coordinates).toEqual([(box[0] + box[2]) / 2, (box[1] + box[3]) / 2]);
    items[1].vis = false;
    expect(buildMarks(items, 5).features.map((f) => f.properties.id)).toEqual(['A']);
  });

  it('knows how many meters a pixel covers', () => {
    expect(metersPerPixel(0, 0)).toBeCloseTo(78_271.5, 0);
    expect(metersPerPixel(60, 1)).toBeCloseTo(78_271.5 / 4, 0);
  });
});

describe('timeline math', () => {
  it('draws every motion reading for acceleration, so zooming in shows the waveform', () => {
    const tr = load('central-park-loop-motion.csv');
    const s = buildScale('accel', [tr]);
    // Two seconds over 20 columns: a tenth of a second each, with one reading in the middle of each column.
    const from = tr.cols.t[100] - 50, to = from + 2000;
    const fine = columns(tr, 'accel', s, from, to, 20, 0).map((col) => col!.max);
    const values = Array.from(tr.motion!.g).filter((_, j) => tr.motion!.t[j] >= from && tr.motion!.t[j] < to);
    expect(fine).toHaveLength(20);
    for (let k = 0; k < 20; k++) expect(fine[k]).toBeCloseTo(values[k], 5);
    // Without the readings, the same two seconds would be just two values.
    const coarse = columns({ ...tr, motion: undefined }, 'accel', s, from, to, 20, 0).flatMap((col) => (col ? [col.max] : []));
    expect(new Set(coarse.map((v) => v.toFixed(4))).size).toBeLessThanOrEqual(2);
    expect(new Set(fine.map((v) => v.toFixed(4))).size).toBeGreaterThan(5);
  });

  it('colors acceleration on the timeline as the map does: each second by its strongest reading', () => {
    // Three seconds in a row, each with one 2.2 g jolt among calm readings.
    const base = load('central-park-loop-motion.csv');
    const g = base.motion!.g.slice(), accel = base.cols.accel.slice(), i = 100;
    for (const k of [i - 1, i, i + 1]) {
      g[base.motion!.t.findIndex((t) => t >= base.cols.t[k]) + 3] = 2.2;
      accel[k] = 2.2;
    }
    const tr: LoadedTrack = { ...base, cols: { ...base.cols, accel }, motion: { t: base.motion!.t, g } };
    const s = buildScale('accel', [tr]);
    const steps = drawnSteps(tr, 'accel', s);
    expect(steps[i]).toBe(stepOf(s, 2.2));
    // Most of that second's readings are calm, but every column shows the jolt's color, as the map does.
    const cols = columns(tr, 'accel', s, tr.cols.t[i], tr.cols.t[i] + 1000, 10, 0);
    expect(cols.filter((col) => stepOf(s, col!.max) === steps[i])).toHaveLength(1);
    expect(cols.map((col) => col!.step)).toEqual(Array(10).fill(steps[i]));
  });

  it('scales elevation graphs to the values in view, not from sea level', () => {
    // A ride at 1,500–1,540 m: the graph spans those 40 m, with a little room below.
    expect(graphRange('ele', 1500, 1540)).toEqual([1496, 1540]);
    // A flat stretch: at least 10 m, centered, so GPS noise stays small.
    expect(graphRange('ele', 3, 5)).toEqual([-2, 9]);
    // Speed, HDOP and the rest stand on zero; acceleration spans its readings.
    expect(graphRange('speed', 4, 30)).toEqual([0, 30]);
    expect(graphRange('hdop', 0.8, 2.4)).toEqual([0, 2.4]);
    const [lo, hi] = graphRange('accel', 1.02, 1.05);
    expect([Number(lo.toFixed(9)), hi]).toEqual([0.95, 1.05]);
  });

  it('zooms with the scroll wheel around the time under the pointer', () => {
    const full: [number, number] = [0, 3_600_000];
    const inView = wheelZoom(full, full, 0.25, -300)!;
    expect(inView[1] - inView[0]).toBeLessThan(full[1] * 0.6);
    // The time under the pointer stays put.
    expect(inView[0] + 0.25 * (inView[1] - inView[0])).toBeCloseTo(900_000, 3);
    // Never closer than the shortest zoom, never outside the timeline.
    const close = wheelZoom(inView, full, 0.5, -100_000)!;
    expect(close[1] - close[0]).toBe(MIN_ZOOM_MS);
    const edge = wheelZoom([0, 600_000], full, 0, -100)!;
    expect(edge[0]).toBe(0);
    // Scrolling far enough out shows everything again.
    expect(wheelZoom(inView, full, 0.5, 5000)).toBeNull();
  });

  it('moves a zoomed view sideways within the timeline', () => {
    const full: [number, number] = [0, 3_600_000];
    expect(panView([1_000_000, 1_600_000], full, 0.5)).toEqual([1_300_000, 1_900_000]);
    expect(panView([1_000_000, 1_600_000], full, -10)).toEqual([0, 600_000]);
    expect(panView([1_000_000, 1_600_000], full, 10)).toEqual([3_000_000, 3_600_000]);
  });

  it('snaps the cursor to the nearest fix, also inside a gap', () => {
    const tr = load('hudson-overnight.gpx');
    const c = tr.cols;
    const night = c.t.findIndex((t, i) => i > 0 && t - c.t[i - 1] > 3_600_000);
    const tracks = [{ id: 'A', track: tr }];
    // Early in the night's gap: the evening's last fix; late in it: the morning's first.
    expect(snapTime(c.t[night - 1] + 60_000, tracks, {})).toBe(c.t[night - 1]);
    expect(snapTime(c.t[night] - 60_000, tracks, {})).toBe(c.t[night]);
    // Offsets move a track along the timeline.
    expect(snapTime(c.t[10] + 5000 + 1200, tracks, { A: 5000 })).toBe(c.t[10] + 5000);
  });

  it('skips gaps during playback, and starts over after the last fix', () => {
    const tr = load('hudson-overnight.gpx');
    const c = tr.cols;
    const night = c.t.findIndex((t, i) => i > 0 && t - c.t[i - 1] > 3_600_000);
    const t0 = c.t[0], t1 = c.t[c.n - 1];
    const one = [{ id: 'A', track: tr }];
    expect(skipGap(c.t[5] + 1000, one, {}, t0, t1)).toBe(c.t[5] + 1000);
    expect(skipGap(c.t[night - 1] + 600_000, one, {}, t0, t1)).toBe(c.t[night]);
    expect(skipGap(t1 + 600_000, one, {}, t0, t1 + 3_600_000)).toBe(t0);
  });

  it('plays through one logger\'s gap when another shown logger has data there', () => {
    const trA = load('central-park-loop.nmea'), trB = load('central-park-loop-vendor.gpx');
    const c = trA.cols;
    const gap = c.t.findIndex((t, i) => i > 0 && t - c.t[i - 1] > 30_000);
    const mid = (c.t[gap - 1] + c.t[gap]) / 2;
    const both = [{ id: 'A', track: trA }, { id: 'B', track: trB }];
    // Alone, the gap is skipped; with the other logger recording, it isn't.
    expect(skipGap(mid, [both[0]], {}, c.t[0], c.t[c.n - 1])).toBe(c.t[gap]);
    expect(skipGap(mid, both, {}, c.t[0], c.t[c.n - 1])).toBe(mid);
    // And the cursor snaps to the other logger's fix inside the gap.
    const snapped = snapTime(mid, both, {});
    expect(Math.abs(snapped - mid)).toBeLessThanOrEqual(2500);
  });

  it('plays at sixty times real time and loops at the end', () => {
    const t0 = 1_000_000, t1 = t0 + 600_000;
    expect(playStep(t0, 100, t0, t1)).toBe(t0 + 100 * PLAY_SPEED);
    expect(playStep(t1 - 1000, 100, t0, t1)).toBe(t0);
    expect(playStep(t0 - 5000, 16, t0, t1)).toBe(t0);
  });

  it('spaces ticks so labels never crowd', () => {
    expect(tickStep(30 * 60_000, 900)).toBe(300_000);
    expect(tickStep(10 * 3600_000, 300)).toBe(10_800_000);
    const tk = ticks(Date.UTC(2026, 5, 14, 13, 2), Date.UTC(2026, 5, 14, 13, 31), 900, -240);
    expect(new Date(tk[0]).toISOString()).toBe('2026-06-14T13:05:00.000Z');
    // The zone's offset as a function of time gives the same ticks where it doesn't change.
    expect(ticks(Date.UTC(2026, 5, 14, 13, 2), Date.UTC(2026, 5, 14, 13, 31), 900, (t) => offsetMinutes(t, 'America/New_York'))).toEqual(tk);
  });

  it('keeps ticks on round times of the clock across a daylight-saving change', () => {
    const z = 'America/New_York';
    const off = (t: number) => offsetMinutes(t, z);
    const clock = (t: number) => t + off(t) * 60_000;
    // October 31 to November 4, 2026, midnight to midnight; the clocks go back an hour on November 1.
    // Ticks every 12 hours, each on noon or midnight: five midnights, also after the change.
    const tk = ticks(Date.parse('2026-10-31T04:00:00Z'), Date.parse('2026-11-04T05:00:00Z'), 800, off);
    expect(tk).toHaveLength(9);
    for (const t of tk) expect(clock(t) % 43_200_000).toBe(0);
    expect(tk.filter((t) => isMidnight(t, z))).toHaveLength(5);
    // Hourly ticks over each change stay an hour apart: spring forward has no 2:00, fall back has 1:00 twice.
    const spring = ticks(Date.parse('2026-03-08T05:00:00Z'), Date.parse('2026-03-08T11:00:00Z'), 800, off);
    expect(spring.map((t) => new Date(clock(t)).getUTCHours())).toEqual([0, 1, 3, 4, 5, 6, 7]);
    const fall = ticks(Date.parse('2026-11-01T04:00:00Z'), Date.parse('2026-11-01T10:00:00Z'), 800, off);
    expect(fall.map((t) => new Date(clock(t)).getUTCHours())).toEqual([0, 1, 1, 2, 3, 4, 5]);
    for (const list of [spring, fall]) for (let i = 1; i < list.length; i++) expect(list[i] - list[i - 1]).toBe(3_600_000);
  });

  it('shades the lane when zoomed into a gap, and a gap that runs out of view up to the edge', () => {
    const tr = load('hudson-overnight.gpx');
    const c = tr.cols;
    const night = c.t.findIndex((t, i) => i > 0 && t - c.t[i - 1] > 3_600_000);
    const s = buildScale('speed', [tr]);
    // Twenty minutes in the middle of the night: no fix in view, all gap.
    const mid = (c.t[night - 1] + c.t[night]) / 2;
    expect(columns(tr, 'speed', s, mid - 600_000, mid + 600_000, 600, 0).every((col) => col?.gap)).toBe(true);
    // The evening's last fix in the middle of the view: data up to it, the gap from there to the right edge.
    const edge = columns(tr, 'speed', s, c.t[night - 1] - 300_000, c.t[night - 1] + 300_000, 600, 0);
    expect(edge.slice(0, 301).every((col) => col !== null && !col.gap)).toBe(true);
    expect(edge.slice(301).every((col) => col?.gap)).toBe(true);
    // And the morning's first fix: the gap from the left edge up to it.
    const morning = columns(tr, 'speed', s, c.t[night] - 300_000, c.t[night] + 300_000, 600, 0);
    expect(morning.slice(0, 300).every((col) => col?.gap)).toBe(true);
    expect(morning.slice(300).every((col) => col !== null && !col.gap)).toBe(true);
  });

  it('fills a zoomed-in lane to both edges from the fixes just outside the view', () => {
    const b5 = load('central-park-loop-vendor.gpx');
    const c = b5.cols;
    // Four fixes in a row 5 s apart.
    const i = c.t.findIndex((t, k) => k > 40 && c.t[k + 1] - t === 5000 && c.t[k + 2] - t === 10_000 && c.t[k + 3] - t === 15_000);
    const s = buildScale('speed', [b5]);
    // Ten seconds from 1 s after fix i: fixes i + 1 and i + 2 in view, 4 s and 9 s in, none at either edge.
    const cols = columns(b5, 'speed', s, c.t[i] + 1000, c.t[i] + 11_000, 1000, 0);
    expect(cols.every((col) => col !== null && !col.gap)).toBe(true);
    // As between any two fixes, each fix shows until the next: fix i up to the left edge, fix i + 2 to the right one.
    expect(cols[0]!.max).toBe(valueAt(b5, 'speed', i));
    expect(cols[500]!.max).toBe(valueAt(b5, 'speed', i + 1));
    expect(cols[999]!.max).toBe(valueAt(b5, 'speed', i + 2));
    // Zoomed in between two fixes: the earlier one throughout.
    expect(columns(b5, 'speed', s, c.t[i] + 1000, c.t[i] + 4000, 300, 0).every((col) => col?.max === valueAt(b5, 'speed', i))).toBe(true);
    // Not past either end of the track.
    const past = columns(b5, 'speed', s, c.t[c.n - 1] - 2000, c.t[c.n - 1] + 8000, 1000, 0);
    expect(past.slice(201).every((col) => col === null)).toBe(true);
  });

  it('brings the cursor onto the nearest fix inside a narrower view', () => {
    const tr = load('central-park-loop-vendor.gpx'); // a fix every 5 s
    const c = tr.cols;
    const one = [{ id: 'A', track: tr }];
    const from = c.t[40] + 1000, to = c.t[60] - 1000;
    // Snapped to the fix just outside the view, the cursor moves to the first fix inside.
    expect(snapInto(c.t[40], one, {}, from, to)).toBe(c.t[41]);
    expect(snapInto(c.t[60], one, {}, from, to)).toBe(c.t[59]);
    // Offsets move a track along the timeline.
    expect(snapInto(c.t[40] + 7000, one, { A: 7000 }, from + 7000, to + 7000)).toBe(c.t[41] + 7000);
    // No fix inside, as in a gap: the cursor just moves into the view.
    const night = load('hudson-overnight.gpx');
    const n = night.cols;
    const g = n.t.findIndex((t, i) => i > 0 && t - n.t[i - 1] > 3_600_000);
    const mid = (n.t[g - 1] + n.t[g]) / 2;
    expect(snapInto(n.t[g - 1], [{ id: 'A', track: night }], {}, mid - 60_000, mid + 60_000)).toBe(mid - 60_000);
  });

  it('leaves no holes between sparse fixes, except at gaps', () => {
    const b5 = load('central-park-loop-vendor.gpx'); // one fix every 5 s
    const cols = columns(b5, 'speed', buildScale('speed', [b5]), b5.derived.stats.start, b5.derived.stats.end, 1200, 0);
    const first = cols.findIndex(Boolean);
    const last = cols.findLastIndex(Boolean);
    expect(cols.slice(first, last + 1).every((c) => c !== null)).toBe(true);
  });

  it('summarises a track into pixel columns', () => {
    const cols = columns(a, 'speed', buildScale('speed', [a]), a.derived.stats.start, a.derived.stats.end, 400, 0);
    expect(cols).toHaveLength(400);
    expect(cols.filter((c) => c?.gap).length).toBeGreaterThan(0);
    expect(cols.filter((c) => c && !c.gap && c.step >= 0).length).toBeGreaterThan(300);
  });
});

describe('scale bar', () => {
  it('picks a round distance about 100 px long', () => {
    const s = scaleBar(40.77, 14, false);
    expect([100, 200, 500, 1, 2]).toContain(s.value);
    expect(s.px).toBeGreaterThan(40);
    expect(s.px).toBeLessThanOrEqual(110);
    expect(scaleBar(40.77, 10, true).unit).toBe('mi');
  });
});

describe("a combined track's logs on the map", () => {
  const car = load('stanford-drive-car.nmea'), phone = load('stanford-drive-phone.gpx');
  const r = combineTracks([car, phone]);
  if (!r.ok) throw new Error(r.reason);
  const c = r.track;
  const item = (logs: boolean[], vis = true) => ({ ...addTracks([], [c]).items[0], logs, vis });

  it('draws each log with its eye on as lines in its own color, red where it was left out, and none for a hidden log', () => {
    const lines = buildLogLines([item([true, true])]).features;
    expect(new Set(lines.map((f) => f.properties.k))).toEqual(new Set([0, 1]));
    for (const f of lines) expect(f.properties.c).toBe(LOG_COLORS[f.properties.k as number]);
    // The phone's 20 s jump: left out, so drawn red; the car never is.
    const out = lines.filter((f) => f.properties.out === 1);
    expect(out.length).toBeGreaterThan(0);
    expect(out.every((f) => f.properties.k === 1)).toBe(true);
    expect(buildLogLines([item([true, false])]).features.every((f) => f.properties.k === 0)).toBe(true);
    expect(buildLogLines([item([true, true], false)]).features).toEqual([]);
  });

  it("leaves a log's own gaps blank: no line across a stretch where it has no position", () => {
    const phoneLines = buildLogLines([item([false, true])]).features;
    const la = c.combo.srcLat[1];
    // Every point of every line is a real position of the phone, and the phone's gaps split it into pieces.
    // Its 35 s and 70 s gaps stay blank; the 8 s one is bridged, as fixes up to 10 s apart are interpolated.
    expect(phoneLines.length).toBeGreaterThan(2);
    let gaps = 0;
    for (let i = 1; i < c.cols.n; i++) if (Number.isNaN(la[i]) && !Number.isNaN(la[i - 1])) gaps++;
    expect(gaps).toBe(2);
    for (const f of phoneLines) for (const [lon, lat] of f.geometry.coordinates) expect(Number.isFinite(lon) && Number.isFinite(lat)).toBe(true);
  });

  it("fills a log's timeline lane up to the left edge when zoomed in, from the log's fix before the view", () => {
    // A stretch where the car's log has a fix every second, with no gap.
    const la = c.combo.srcLat[0], gap = c.derived.gap, t = c.cols.t;
    const i = t.findIndex((_, k) => k > 50 && Array.from({ length: 14 }, (__, j) => k + j).every((j) => la[j] === la[j] && !gap[j] && (j === k || t[j] - t[j - 1] === 1000)));
    expect(i).toBeGreaterThan(0);
    // Ten seconds from half a second after fix i: the first fix in view is 50 columns in.
    const { has } = logColumns(c, 0, t[i] + 500, t[i] + 10_500, 1000, 0);
    expect(has.every(Boolean)).toBe(true);
    // A log that has no fix just before the view starts where its first fix is.
    const { has: second } = logColumns(c, 1, t[0] - 10_000, t[0] + 10_000, 1000, 0);
    expect(second.slice(0, 499).some(Boolean)).toBe(false);
  });

  it('draws the logs\' dots only while a shown combined track shows a log', () => {
    expect(showsLogs([item([true, false])])).toBe(true);
    expect(showsLogs([item([false, false])])).toBe(false);
    expect(showsLogs([item([true, true], false)])).toBe(false);
    expect(showsLogs(addTracks([], [car, phone]).items)).toBe(false);
  });

  it('puts a dot for each shown log at the cursor, hollow and ringed in red where the log was left out', () => {
    const k = c.combo.use[1].findIndex((u) => u === Use.LeftOut);
    const dots = buildLogCursors([item([true, true])], {}, c.cols.t[k]).features;
    expect(dots.map((f) => [f.properties.k, f.properties.out])).toEqual([[0, 0], [1, 1]]);
    expect(buildLogCursors([item([true, true])], {}, null).features).toEqual([]);
    expect(buildLogCursors([item([false, true])], {}, c.cols.t[k]).features.map((f) => f.properties.k)).toEqual([1]);
  });
});

describe('centering a zoomed timeline on a point', () => {
  it('keeps the zoomed width, centers the point, and stops at either end of the timeline', () => {
    expect(centerView([100, 200], [0, 1000], 500)).toEqual([450, 550]);
    expect(centerView([100, 200], [0, 1000], 20)).toEqual([0, 100]);
    expect(centerView([100, 200], [0, 1000], 990)).toEqual([900, 1000]);
  });
});
