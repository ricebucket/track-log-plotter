import { describe, expect, it } from 'vitest';
import { addCombined, addTracks, alignOffsets, applyToAll, axisRange, LOAD_LIMIT, nearestIndex, removeTrack, removeTracks, setColor, setHalo, setLogShown, setVisible, SHOW_LIMIT, type TrackItem } from '../../src/state/logic';
import { combineTracks } from '../../src/combine/combine';
import { load } from '../helpers/fixtures';

const ride = load('central-park-loop.nmea');
const other = load('central-park-loop-vendor.gpx');
const run = load('roosevelt-island-run.gpx');

const vis = (items: TrackItem[]) => items.filter((t) => t.vis).map((t) => t.id);

describe('track list', () => {
  it('letters tracks and shows the first three', () => {
    const r = addTracks([], [ride, other, run, ride]);
    expect(r.added).toEqual(['A', 'B', 'C', 'D']);
    expect(vis(r.items)).toEqual(['A', 'B', 'C']);
    expect(r.items.map((t) => t.fam).slice(0, 3)).toEqual([0, 1, 2]);
  });

  it('stops at ten loaded tracks', () => {
    const r = addTracks([], Array.from({ length: 12 }, () => ride));
    expect(r.items).toHaveLength(LOAD_LIMIT);
    expect(r.skipped).toBe(2);
  });

  it('refuses a fourth shown track and keeps the others as they are', () => {
    const { items } = addTracks([], [ride, other, run, ride]);
    const r = setVisible(items, 'D', true);
    expect(r.limited).toBe(true);
    expect(vis(r.items)).toHaveLength(SHOW_LIMIT);
  });

  it('keeps a hidden track\'s settings and reuses a free color range', () => {
    let { items } = addTracks([], [ride, other, run, ride]);
    items = setColor(items, 'B', 'ele');
    items = setVisible(items, 'B', false).items;
    items = setVisible(items, 'D', true).items;
    expect(items.find((t) => t.id === 'D')!.fam).toBe(1);
    expect(items.find((t) => t.id === 'A')!.fam).toBe(0);
    items = setVisible(items, 'D', false).items;
    items = setVisible(items, 'B', true).items;
    expect(items.find((t) => t.id === 'B')!.color).toBe('ele');
  });

  it('starts with speed and HDOP, or satellites when there is no HDOP', () => {
    const { items } = addTracks([], [ride]);
    expect(items[0]).toMatchObject({ color: 'speed', halo: 'hdop' });
  });

  it('copies color and halo to every track that has those measures', () => {
    let { items } = addTracks([], [ride, other, run]);
    items = setHalo(setColor(items, 'A', 'sats'), 'A', 'fix');
    items = applyToAll(items, 'A');
    // B has no satellites or fix type, so it keeps its own settings.
    expect(items.find((t) => t.id === 'B')).toMatchObject({ color: 'speed', halo: 'hdop' });
    expect(items.find((t) => t.id === 'A')).toMatchObject({ color: 'sats', halo: 'fix' });
  });

  it('removes tracks', () => {
    const { items } = addTracks([], [ride, other]);
    expect(removeTrack(items, 'A').map((t) => t.id)).toEqual(['B']);
  });
});

describe('alignment', () => {
  it('lines up tracks recorded together by clock, and others by their start', () => {
    const { items } = addTracks([], [ride, other, run]);
    const off = alignOffsets(items, 'A');
    expect(off.A).toBe(0);
    expect(off.B).toBe(0);
    expect(off.C).toBe(ride.derived.stats.start - run.derived.stats.start);
    const [t0, t1] = axisRange(items, off);
    expect(t0).toBe(ride.derived.stats.start);
    expect(t1).toBeGreaterThanOrEqual(ride.derived.stats.end);
  });

  it('finds the nearest fix by time', () => {
    const t = new Float64Array([0, 1000, 2000, 5000]);
    expect(nearestIndex(t, -5)).toBe(0);
    expect(nearestIndex(t, 1400)).toBe(1);
    expect(nearestIndex(t, 1600)).toBe(2);
    expect(nearestIndex(t, 9000)).toBe(3);
    expect(nearestIndex(new Float64Array(0), 1)).toBe(-1);
  });
});

describe('combined tracks in the list', () => {
  const car = load('stanford-drive-car.nmea'), phone = load('stanford-drive-phone.gpx'), park = load('central-park-loop.nmea');
  const r = combineTracks([car, phone]);
  if (!r.ok) throw new Error(r.reason);
  const combo = r.track;

  it('goes right after the last of its logs, shown, with its logs hidden and every log line on', () => {
    const items = addTracks([], [car, park, phone]).items; // A car, B the park, C phone
    const c = addCombined(items, combo, ['A', 'C']);
    expect(c.id).toBe('D');
    expect(c.items.map((x) => x.id)).toEqual(['A', 'B', 'C', 'D']);
    expect(c.items.map((x) => x.vis)).toEqual([false, true, false, true]);
    expect(c.items[3].logs).toEqual([true, true]);
    const d = addCombined(addTracks([], [phone, car, park]).items, combo, ['B', 'A']);
    expect(d.items.map((x) => x.id)).toEqual(['A', 'B', 'D', 'C']);
  });

  it('is refused when the list is full', () => {
    const full = addTracks([], Array.from({ length: LOAD_LIMIT }, () => park)).items;
    expect(addCombined(full, combo, ['A', 'B'])).toEqual({ items: full, id: null });
  });

  it('turns single log lines on and off, and removes several tracks at once', () => {
    const c = addCombined(addTracks([], [car, phone]).items, combo, ['A', 'B']);
    const off = setLogShown(c.items, 'C', 1, false);
    expect(off.find((x) => x.id === 'C')!.logs).toEqual([true, false]);
    expect(setLogShown(off, 'A', 0, false)).toEqual(off); // a log's own track has no log lines
    expect(removeTracks(c.items, ['A', 'C']).map((x) => x.id)).toEqual(['B']);
  });
});
