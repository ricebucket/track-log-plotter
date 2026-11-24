// @vitest-environment happy-dom
// What redraws when: the whole app doesn't redraw for every move of the cursor
// while the time zone list is open, nor for a new name or trust share; a
// track's row redraws for its own track's changes only. Counted by renders:
// the map stands in for the app (it renders each time the app does), and each
// track row asks for its name's hover text once a render.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render } from '@testing-library/preact';

const calls = vi.hoisted(() => ({ search: 0, rows: [] as string[] }));
vi.mock('../../src/time/zones', async (real) => {
  const m = await real<typeof import('../../src/time/zones')>();
  return { ...m, searchZones: (q: string, at: number) => { calls.search++; return m.searchZones(q, at); } };
});
vi.mock('../../src/ui/labels', async (real) => {
  const m = await real<typeof import('../../src/ui/labels')>();
  return { ...m, nameTip: (item: Parameters<typeof m.nameTip>[0]) => { calls.rows.push(item.id); return m.nameTip(item); } };
});

import { App } from '../../src/ui/App';
import * as S from '../../src/state/store';
import { load } from '../helpers/fixtures';

let appRenders = 0;
const CountingMap = () => { appRenders++; return <div data-testid="map" />; };

beforeEach(() => {
  S.resetForTests();
  appRenders = 0;
  calls.search = 0;
  calls.rows = [];
});

describe('redraws', () => {
  it('leaves the app alone, and the zones unsearched, as the cursor moves with the time zone list open', () => {
    S.addLoaded([load('central-park-loop.nmea')]);
    render(<App Map={CountingMap} />);
    const t = S.items.value[0].track.cols.t;
    act(() => { S.cursorT.value = t[5]; });
    act(() => { S.zoneOpen.value = true; });
    expect(document.querySelector('.zone-picker')).not.toBeNull();
    const [app, searched] = [appRenders, calls.search];
    for (let i = 0; i < 10; i++) act(() => { S.cursorT.value = t[30 + i]; });
    // Before: 10 renders of the whole app and 10 searches through every zone.
    expect([appRenders - app, calls.search - searched]).toEqual([0, 0]);
  });

  it("leaves the app alone for a new name or a new trust share", () => {
    S.addLoaded([load('stanford-drive-car.nmea'), load('stanford-drive-phone.gpx')]);
    render(<App Map={CountingMap} />);
    act(() => { S.startSelect(); S.toggleTick('A'); S.toggleTick('B'); S.combineTicked(); });
    const before = appRenders;
    act(() => S.renameTrack('A', 'Car'));
    for (let i = 0; i < 5; i++) act(() => { S.applyTrust('C', [0.3 + i * 0.05, 0.7 - i * 0.05]); });
    // Before: 6 renders of the whole app.
    expect(appRenders - before).toBe(0);
    // It still redraws when it has to: the last track removed brings back the start screen.
    act(() => S.clearAll());
    expect(document.querySelector('.empty-card')).not.toBeNull();
  });

  it("redraws only the combined track's row for each new trust share, and only the changed row for a new halo", () => {
    S.addLoaded(['stanford-drive-car.nmea', 'stanford-drive-phone.gpx', 'central-park-loop.nmea', 'roosevelt-island-run.gpx', 'lower-manhattan-walk.gpx'].map(load));
    render(<App Map={CountingMap} />);
    act(() => { S.startSelect(); S.toggleTick('A'); S.toggleTick('B'); S.combineTicked(); });
    expect(document.querySelectorAll('.track-row')).toHaveLength(6);
    calls.rows = [];
    for (let i = 0; i < 5; i++) act(() => { S.applyTrust('F', [0.3 + i * 0.05, 0.7 - i * 0.05]); });
    // Before: all 6 rows, 5 times.
    expect(calls.rows).toEqual(['F', 'F', 'F', 'F', 'F']);
    calls.rows = [];
    act(() => { S.setMeasure('C', 'halo', 'sats'); });
    expect(calls.rows).toEqual(['C']);
    // Another track selected: the two rows whose card opens or closes.
    calls.rows = [];
    act(() => S.select('D'));
    expect(calls.rows.sort()).toEqual(['D', 'F']);
  });
});
