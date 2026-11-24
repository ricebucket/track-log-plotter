// Picking the unit of a file's speeds on its properties page, for a file that
// doesn't say it: the reader works it out from the positions, and reads m/s
// when they don't settle it. Synthetic Central Park logs.
import { beforeEach, describe, expect, it } from 'vitest';
import * as S from '../../src/state/store';
import { rereadSpeeds, SPEED_UNITS, UNIT_FACTOR } from '../../src/parse/units';
import { load } from '../helpers/fixtures';
import { run, slowWalk } from '../helpers/vendor-speed';

beforeEach(() => S.resetForTests());

const item = (id: string) => S.items.value.find((x) => x.id === id)!;
const unitNote = (id: string) => item(id).track.notes.find((n) => n.kind === 'speedUnit');
/** Everything the list keeps about a track but the track itself: its name, color, halo, visibility… */
const settings = (id: string) => Object.fromEntries(Object.entries(item(id)).filter(([k]) => k !== 'track'));

describe("picking the unit of a file's speeds", () => {
  it('reads every speed again in the unit picked, and works out again what depends on them', () => {
    S.addLoaded([slowWalk()]);
    const before = item('A').track;
    // 4.7 in the file, read as m/s.
    expect(before.derived.kmh[60]).toBeCloseTo(16.92, 4);
    expect(before.derived.stats.maxKmh).toBeCloseTo(16.92, 4);
    expect(S.scales.value.speed.edges).toEqual([4, 8, 12, 16]);
    S.setSpeedUnit('A', 'kmh');
    const after = item('A').track;
    expect(after.cols.speed[60]).toBeCloseTo(4.7 / 3.6, 6);
    expect(after.derived.kmh[60]).toBeCloseTo(4.7, 5);
    expect(after.derived.stats.maxKmh).toBeCloseTo(4.7, 5);
    expect(after.derived.speedSpread.every((v) => Math.abs(v - 4.7) < 1e-5)).toBe(true);
    expect(S.scales.value.speed.edges).toEqual([1, 2, 3, 4]);
    // What the positions give stays: distance, moving time, the average speed.
    expect(after.derived.stats.distanceM).toBe(before.derived.stats.distanceM);
    expect(after.derived.stats.avgKmh).toBe(before.derived.stats.avgKmh);
    expect(unitNote('A')).toEqual({ kind: 'speedUnit', unit: 'kmh', inferred: true, chosen: true });
    // The track as it was loaded is left alone: a combined track made from it keeps its own copy.
    expect(before.cols.speed[60]).toBeCloseTo(4.7, 5);
    expect(before.derived.kmh[60]).toBeCloseTo(16.92, 4);
    expect(before.notes).toContainEqual({ kind: 'speedUnit', unit: 'ms', inferred: true, unsure: true });
  });

  it('keeps the name, the color settings, the visibility and the selection', () => {
    S.addLoaded([load('central-park-loop.nmea'), slowWalk()]);
    S.select('B');
    S.renameTrack('B', 'Morning walk');
    S.setMeasure('B', 'color', 'none');
    S.setMeasure('B', 'halo', 'speed');
    S.openDetails('B');
    const kept = settings('B');
    const other = item('A');
    S.setSpeedUnit('B', 'kmh');
    expect(item('B').track.derived.stats.maxKmh).toBeCloseTo(4.7, 5);
    expect(settings('B')).toEqual(kept);
    expect(kept).toMatchObject({ customName: 'Morning walk', color: 'none', halo: 'speed', vis: true });
    expect(S.selected.value!.id).toBe('B');
    expect(S.page.value).toEqual({ kind: 'details', id: 'B' });
    expect(item('A')).toBe(other);
    expect(S.items.value.map((x) => x.id)).toEqual(['A', 'B']);
  });

  it('goes from one unit to another and back', () => {
    S.addLoaded([run()]);
    expect(item('A').track.derived.kmh[60]).toBeCloseTo(10.8, 4);
    S.setSpeedUnit('A', 'ms');
    expect(item('A').track.derived.kmh[60]).toBeCloseTo(38.88, 4);
    S.setSpeedUnit('A', 'knots');
    expect(item('A').track.derived.kmh[60]).toBeCloseTo((10.8 / UNIT_FACTOR.knots) * 3.6, 4);
    S.setSpeedUnit('A', 'mph');
    expect(item('A').track.derived.kmh[60]).toBeCloseTo(10.8 * 1.609344, 4);
    S.setSpeedUnit('A', 'kmh');
    expect(item('A').track.derived.kmh[60]).toBeCloseTo(10.8, 4);
    expect(unitNote('A')).toEqual({ kind: 'speedUnit', unit: 'kmh', inferred: true, chosen: true });
  });

  it('takes the unit in use, picked, as no longer a guess, without reading the speeds again', () => {
    S.addLoaded([slowWalk()]);
    const before = item('A').track;
    S.setSpeedUnit('A', 'ms');
    const after = item('A').track;
    expect(unitNote('A')).toEqual({ kind: 'speedUnit', unit: 'ms', inferred: true, chosen: true });
    expect(after.derived).toBe(before.derived);
    expect(after.cols).toBe(before.cols);
    // Picked again: nothing to change.
    const list = S.items.value;
    S.setSpeedUnit('A', 'ms');
    expect(S.items.value).toBe(list);
  });

  it("leaves a track alone whose file gives its speeds' unit, or has no speeds", () => {
    S.addLoaded([load('central-park-loop-garmin.gpx'), load('central-park-loop.nmea'), load('roosevelt-island-run.csv')]);
    const list = S.items.value;
    for (const id of ['A', 'B', 'C']) {
      expect(S.inferredUnit(item(id).track), id).toBeUndefined();
      S.setSpeedUnit(id, 'mph');
    }
    expect(S.items.value).toBe(list);
  });

  it('offers the four units and reads speeds again as the reader reads them', () => {
    expect(SPEED_UNITS).toEqual(['ms', 'kmh', 'knots', 'mph']);
    // 36 km/h read as m/s, read again as km/h: 10 m/s, as reading it as km/h in the first place gives.
    expect(Array.from(rereadSpeeds(new Float32Array([36, NaN, 0]), 'ms', 'kmh'))).toEqual([10, NaN, 0]);
    expect(rereadSpeeds(new Float32Array([10]), 'kmh', 'knots')[0]).toBeCloseTo(36 / UNIT_FACTOR.knots, 5);
  });
});
