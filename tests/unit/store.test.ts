import { beforeEach, describe, expect, it } from 'vitest';
import * as S from '../../src/state/store';
import { load } from '../helpers/fixtures';

beforeEach(() => S.resetForTests());

describe('store', () => {
  it('removes every track at once and starts the letters over', () => {
    S.addLoaded([load('central-park-loop.nmea'), load('roosevelt-island-run.gpx')]);
    S.select('B');
    S.cursorT.value = S.items.value[0].track.cols.t[10];
    S.clearAll();
    expect(S.items.value).toEqual([]);
    expect(S.selected.value).toBeNull();
    expect(S.cursorT.value).toBeNull();
    S.addLoaded([load('roosevelt-island-run.gpx')]);
    expect(S.items.value.map((x) => x.id)).toEqual(['A']);
  });

  it('moves the motion readings with the track when its file time zone changes', () => {
    S.addLoaded([load('central-park-loop-motion.csv')]);
    const before = S.items.value[0].track;
    S.setClock('A', 'Asia/Tokyo');
    const after = S.items.value[0].track;
    const delta = after.cols.t[0] - before.cols.t[0];
    expect(delta).toBe(-9 * 3600_000);
    expect(after.motion!.t[0] - before.motion!.t[0]).toBe(delta);
    expect(after.motion!.t[3599] - before.motion!.t[3599]).toBe(delta);
  });

  it('closes the fix card by removing the cursor', () => {
    S.addLoaded([load('central-park-loop.nmea')]);
    S.cursorT.value = S.items.value[0].track.cols.t[10];
    S.clearCursor();
    expect(S.cursorT.value).toBeNull();
  });

  it('takes speed and elevation steps from the shown tracks only', () => {
    const ride = load('central-park-loop.nmea');
    const run = load('roosevelt-island-run.gpx');
    S.addLoaded([run, ride]);
    const both = S.scales.value.speed.edges.join();
    S.toggleVisible('B'); // hide the ride
    const runOnly = S.scales.value.speed;
    expect(runOnly.edges.join()).not.toBe(both);
    expect(runOnly.log).toBe(false); // a run alone stays below running pace
    S.toggleVisible('B');
    expect(S.scales.value.speed.edges.join()).toBe(both);
  });

  it('uses the selected track for steps when nothing is shown', () => {
    S.addLoaded([load('roosevelt-island-run.gpx')]);
    S.toggleVisible('A');
    expect(S.visible.value).toHaveLength(0);
    expect(S.scales.value.speed.edges[0]).toBeGreaterThan(1);
  });

  it('lines tracks recorded together up by clock and others at their start', () => {
    const a = load('central-park-loop.nmea');
    const b = load('central-park-loop-vendor.gpx');
    const c = load('roosevelt-island-run.gpx');
    S.addLoaded([a, b, c]);
    expect(S.offsets.value).toEqual({ A: 0, B: 0, C: a.derived.stats.start - c.derived.stats.start });
    S.seek('C', c.derived.stats.start);
    expect(S.cursorT.value).toBe(a.derived.stats.start);
    expect(S.trackTime('C', S.cursorT.value!)).toBe(c.derived.stats.start);
  });

  it('opens the properties page and remembers preferences', () => {
    S.addLoaded([load('central-park-loop.nmea')]);
    S.openDetails('A');
    expect(S.page.value).toEqual({ kind: 'details', id: 'A' });
    S.remove('A');
    expect(S.page.value).toEqual({ kind: 'tracks' });
    expect(S.items.value).toHaveLength(0);
  });
});
