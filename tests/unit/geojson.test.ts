import { describe, expect, it } from 'vitest';
import { boundsOf, buildCursors, buildFixPoints, buildFlags, buildGaps, buildMarks, buildPaths, buildRuns, metersPerPixel, stepsFor, type MapCtx } from '../../src/map/geojson';
import { addTracks } from '../../src/state/logic';
import { buildScale } from '../../src/color/scale';
import type { LoadedTrack, MeasureKey } from '../../src/model/types';
import { FAMILIES, SINGLE } from '../../src/color/palettes';
import { columns, PLAY_SPEED, playStep, skipGap, snapTime, tickStep, ticks } from '../../src/ui/timelineMath';
import { scaleBar } from '../../src/ui/scaleBar';
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
    // The selected track draws on top.
    expect(runs.features.find((f) => f.properties.id === 'A')!.properties.z).toBe(2);
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
});

describe('dots for tiny tracks', () => {
  it('marks a shown track only when it is too small to see', () => {
    const items = addTracks([], [load('central-park-loop.nmea'), load('roosevelt-island-run.gpx')]).items;
    expect(buildMarks(items, 14).features).toEqual([]);
    const far = buildMarks(items, 5).features;
    expect(far.map((f) => f.properties.id)).toEqual(['A', 'B']);
    expect(far[0].properties.c).toBe(FAMILIES[items[0].fam % 3].badge);
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
    expect(skipGap(c.t[5] + 1000, tr, 0, t0, t1)).toBe(c.t[5] + 1000);
    expect(skipGap(c.t[night - 1] + 600_000, tr, 0, t0, t1)).toBe(c.t[night]);
    expect(skipGap(t1 + 600_000, tr, 0, t0, t1 + 3_600_000)).toBe(t0);
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
