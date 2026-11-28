// @vitest-environment happy-dom
// Combining logs in the interface: select mode, the Combine button and its
// notices, the combined track's card (its logs, the trust line and shape), its
// fix card and its Properties page. The logs are the synthetic Stanford drive
// and small synthetic walks in Central Park.
import { beforeEach, describe, expect, it } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/preact';
import { App } from '../../src/ui/App';
import * as S from '../../src/state/store';
import { tipXY } from '../../src/map/bridge';
import { isCombined, type ComboTrack } from '../../src/combine/combine';
import { parseText } from '../../src/parse/index';
import type { LoadedTrack } from '../../src/model/types';
import { walk as walkLog } from '../helpers/walks';
import { load } from '../helpers/fixtures';

const NoMap = () => <div data-testid="map" />;

/** A walk north through Central Park, a fix a second, `eastM` metres to the east of the path. */
function walk(file: string, eastM = 0, seconds = 300): LoadedTrack {
  const t0 = Date.UTC(2026, 5, 14, 13, 0, 0);
  const pts = Array.from({ length: seconds }, (_, i) =>
    `<trkpt lat="${(40.775 + (i * 1.5) / 111_195).toFixed(7)}" lon="${(-73.969 + eastM / 84_300).toFixed(7)}"><ele>20</ele><time>${new Date(t0 + i * 1000).toISOString()}</time><hdop>1.2</hdop><sat>8</sat></trkpt>`);
  const r = parseText(`<?xml version="1.0"?><gpx version="1.1" creator="Test"><trk><trkseg>${pts.join('')}</trkseg></trk></gpx>`, file);
  if (!r.ok) throw new Error(r.error);
  return r.track;
}

const bar = () => screen.getByRole('toolbar', { name: 'Act on the selected tracks' });
const combineBtn = () => within(bar()).getByRole('button', { name: 'Combine' });
const rowBox = (id: string) => screen.getByRole('checkbox', { name: new RegExp(`^Select track ${id}:`) });

/** Loads the logs, enters select mode, ticks them in order. */
function tick(...ids: string[]) {
  fireEvent.click(screen.getByRole('button', { name: 'Select' }));
  for (const id of ids) fireEvent.click(rowBox(id));
}

beforeEach(() => S.resetForTests());

describe('select mode', () => {
  it('turns the eyes into tick boxes, counts the ticked tracks, and ends with Done or Escape', () => {
    S.addLoaded([load('central-park-loop.nmea'), load('roosevelt-island-run.gpx')]);
    render(<App Map={NoMap} />);
    expect(screen.getAllByRole('button', { name: /^(Hide|Show) track/ })).toHaveLength(2);
    fireEvent.click(screen.getByRole('button', { name: 'Select' }));
    expect(screen.queryAllByRole('button', { name: /^(Hide|Show) track/ })).toHaveLength(0);
    expect(within(bar()).getByText('0 selected')).toBeTruthy();
    fireEvent.click(rowBox('B'));
    expect(rowBox('B').getAttribute('aria-checked')).toBe('true');
    expect(within(bar()).getByText('1 selected')).toBeTruthy();
    // The open card stays closed while selecting: a tap ticks the track instead of opening it.
    expect(document.querySelector('.track-inline')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(S.selecting.value).toBe(false);
    expect(document.querySelector('.track-inline')).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Select' }));
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(S.selecting.value).toBe(false);
  });

  it('selects all, then none, with Select all', () => {
    S.addLoaded([load('central-park-loop.nmea'), load('roosevelt-island-run.gpx'), load('lower-manhattan-walk.gpx')]);
    render(<App Map={NoMap} />);
    fireEvent.click(screen.getByRole('button', { name: 'Select' }));
    const all = screen.getByRole('checkbox', { name: 'Select all' });
    expect(all.getAttribute('aria-checked')).toBe('false');
    fireEvent.click(all);
    expect(S.ticked.value).toEqual(['A', 'B', 'C']);
    expect(all.getAttribute('aria-checked')).toBe('true');
    fireEvent.click(all);
    expect(S.ticked.value).toEqual([]);
    // Some ticked: neither all nor none.
    fireEvent.click(rowBox('B'));
    expect(all.getAttribute('aria-checked')).toBe('mixed');
    expect(all.querySelector('.tick-box')!.classList.contains('is-mixed')).toBe(true);
  });

  it('removes the ticked tracks after asking once more, and leaves select mode', () => {
    S.addLoaded([load('central-park-loop.nmea'), load('roosevelt-island-run.gpx'), load('lower-manhattan-walk.gpx')]);
    render(<App Map={NoMap} />);
    tick('A', 'C');
    fireEvent.click(within(bar()).getByRole('button', { name: 'Remove' }));
    expect(S.items.value).toHaveLength(3);
    fireEvent.click(within(bar()).getByRole('button', { name: 'Remove 2?' }));
    expect(S.items.value.map((x) => x.id)).toEqual(['B']);
    expect(S.selecting.value).toBe(false);
  });

  it('greys out Combine, saying why, unless 2 or 3 logs that share time are ticked', () => {
    S.addLoaded([load('stanford-drive-car.nmea'), load('stanford-drive-phone.gpx'), load('roosevelt-island-run.gpx'), load('central-park-loop.nmea')]);
    render(<App Map={NoMap} />);
    tick('A');
    expect(combineBtn().getAttribute('aria-disabled')).toBe('true');
    expect(screen.getByText('Select 2 or 3 tracks of the same trip to combine them.')).toBeTruthy();
    fireEvent.click(rowBox('C'));
    expect(screen.getByText('These tracks share no time.')).toBeTruthy();
    fireEvent.click(rowBox('C'));
    fireEvent.click(rowBox('B'));
    expect(combineBtn().getAttribute('aria-disabled')).toBeNull();
    fireEvent.click(rowBox('C'));
    fireEvent.click(rowBox('D'));
    expect(screen.getByText('At most 3 tracks can be combined.')).toBeTruthy();
    // Pressing a greyed-out Combine does nothing.
    fireEvent.click(combineBtn());
    expect(S.items.value).toHaveLength(4);
  });
});

describe('combining', () => {
  it('adds the combined track beside its logs, selected and shown, its logs hidden, with its logs on its card', () => {
    S.addLoaded([load('stanford-drive-car.nmea'), load('stanford-drive-phone.gpx'), load('roosevelt-island-run.gpx')]);
    render(<App Map={NoMap} />);
    tick('A', 'B');
    fireEvent.click(combineBtn());
    expect(S.selecting.value).toBe(false);
    expect(S.items.value.map((x) => x.id)).toEqual(['A', 'B', 'D', 'C']);
    const c = S.items.value[2];
    expect(isCombined(c.track)).toBe(true);
    expect(c.track.file).toBe('A+B Combined Track');
    expect(S.selected.value?.id).toBe('D');
    expect([c.vis, S.items.value[0].vis, S.items.value[1].vis]).toEqual([true, false, false]);
    expect(c.logs).toEqual([true, true]);
    // Its row: a diamond badge, and the number of sources.
    const row = document.querySelector('.track-row[data-track="D"]')!;
    expect(row.querySelector('.track-sub')!.textContent).toMatch(/ · 2 sources$/);
    // Its card: each source numbered, with how much it counts and its typical error.
    const logs = within(row as HTMLElement).getByRole('region', { name: 'Sources' });
    const items = within(logs).getAllByRole('listitem');
    expect(items.map((li) => li.querySelector('.combo-file')!.textContent)).toEqual(['stanford-drive-car.nmea', 'stanford-drive-phone.gpx']);
    expect(items[0].textContent).toMatch(/counts \d+% · typical error [\d.]+ m/);
    expect(within(logs).getByText('equal')).toBeTruthy();
    // Combining the same tracks again: the name gets a number.
    fireEvent.click(screen.getByRole('button', { name: 'Select' }));
    fireEvent.click(rowBox('A'));
    fireEvent.click(rowBox('B'));
    fireEvent.click(combineBtn());
    expect(S.items.value.find((x) => x.id === 'E')?.track.file).toBe('A+B Combined Track 2');
  });

  it('refuses to combine a combined track again', () => {
    S.addLoaded([load('stanford-drive-car.nmea'), load('stanford-drive-phone.gpx')]);
    render(<App Map={NoMap} />);
    tick('A', 'B');
    fireEvent.click(combineBtn());
    tick('A', 'C');
    expect(screen.getByText("A combined track can't be combined again.")).toBeTruthy();
  });

  it('asks to check the time zone of a log that may be read in the wrong one, and opens its properties', () => {
    S.addLoaded([load('stanford-drive-car.nmea'), load('stanford-drive-logger.csv')]);
    render(<App Map={NoMap} />);
    tick('A', 'B');
    fireEvent.click(combineBtn());
    expect(S.items.value).toHaveLength(2);
    const toast = document.querySelector('.toast[data-combo="zone"]') as HTMLElement;
    expect(toast.textContent).toContain("stanford-drive-logger.csv doesn't say which time zone its clock is on");
    fireEvent.click(within(toast).getByRole('button', { name: 'Show properties' }));
    expect(S.page.value).toEqual({ kind: 'details', id: 'B' });
    expect(S.selecting.value).toBe(false);
  });

  it('combines anyway, once asked to check a time zone, logs that share some time: the zone may well be right', () => {
    // The notice was a dead end: Combine asked again each time, whatever zone was picked.
    // The same walk, the second log from 500 s on: they share its last 100 s.
    const a = walkLog({ seed: 2, seconds: 600 }), b = { ...walkLog({ seed: 3, offsetM: 3, seconds: 1100, gap: [0, 500] }), clock: 'utc' as const };
    S.addLoaded([a, b]);
    render(<App Map={NoMap} />);
    tick('A', 'B');
    fireEvent.click(combineBtn());
    const toast = document.querySelector('.toast[data-combo="zone"]') as HTMLElement;
    expect(S.items.value).toHaveLength(2);
    fireEvent.click(within(toast).getByRole('button', { name: 'Combine anyway' }));
    expect(S.items.value).toHaveLength(3);
    expect(isCombined(S.items.value[2].track)).toBe(true);
    expect(S.comboNotice.value).toBeNull();
  });

  it("doesn't offer to combine anyway logs that share no time, or once the ticks change", () => {
    S.addLoaded([load('stanford-drive-car.nmea'), load('stanford-drive-logger.csv')]);
    render(<App Map={NoMap} />);
    tick('A', 'B');
    fireEvent.click(combineBtn());
    expect(within(document.querySelector('.toast[data-combo="zone"]') as HTMLElement).queryByRole('button', { name: 'Combine anyway' })).toBeNull();
    S.resetForTests();
    S.addLoaded([walkLog({ seed: 2, seconds: 600 }), { ...walkLog({ seed: 3, offsetM: 3, seconds: 600, shiftS: 500 }), clock: 'utc' as const }, walkLog({ seed: 4, offsetM: 5 })]);
    act(() => { S.startSelect(); S.toggleTick('A'); S.toggleTick('B'); S.combineTicked(); });
    expect(S.comboNotice.value).toMatchObject({ kind: 'zone', ids: ['A', 'B'] });
    act(() => S.toggleTick('C'));
    expect(S.comboNotice.value).toMatchObject({ kind: 'zone', id: 'B', ids: null });
  });

  it('names the two tracks that are one recording, when three are ticked', () => {
    // The same fixes at the same moments, but for one: found when lining the clocks up.
    S.addLoaded([walkLog({ seed: 9, offsetM: 3, seconds: 299 }), walkLog({ seed: 6 }), walkLog({ seed: 6, drop: [150] })]);
    render(<App Map={NoMap} />);
    tick('A', 'B', 'C');
    fireEvent.click(combineBtn());
    expect(document.querySelector('.toast[data-combo="duplicate"]')?.textContent).toContain('Tracks B and C are the same recording');
  });

  it('warns about the same recording twice instead of combining it', () => {
    S.addLoaded([load('central-park-loop.nmea'), load('central-park-loop-garmin.gpx')]);
    render(<App Map={NoMap} />);
    tick('A', 'B');
    fireEvent.click(combineBtn());
    expect(document.querySelector('.toast[data-combo="duplicate"]')?.textContent).toContain('the same recording twice');
    expect(S.items.value).toHaveLength(2);
    // The same fixes at the same moments, from two files: caught when lining the clocks up.
    S.resetForTests();
    S.addLoaded([load('roosevelt-island-run.gpx'), load('roosevelt-island-run-cut.gpx')]);
    S.startSelect();
    S.toggleTick('A');
    S.toggleTick('B');
    S.combineTicked();
    expect(S.comboNotice.value?.kind).toBe('duplicate');
  });

  it('asks before combining logs that may not be the same trip, and combines them anyway when told to', () => {
    S.addLoaded([walk('east.gpx'), walk('west.gpx', 250, 299)]);
    render(<App Map={NoMap} />);
    tick('A', 'B');
    fireEvent.click(combineBtn());
    const toast = document.querySelector('.toast[data-combo="apart"]') as HTMLElement;
    expect(toast.textContent).toContain('These may not be the same trip');
    expect(S.items.value).toHaveLength(2);
    fireEvent.click(within(toast).getByRole('button', { name: 'Combine anyway' }));
    expect(S.items.value).toHaveLength(3);
    expect(S.comboNotice.value).toBeNull();
  });
});

describe('combining while three other tracks show', () => {
  it('adds the combined track hidden, and its row says why', () => {
    S.addLoaded([walk('phone.gpx'), walk('watch.gpx', 3, 280), load('central-park-loop.nmea'), load('roosevelt-island-run.gpx'), load('lower-manhattan-walk.gpx')]);
    render(<App Map={NoMap} />);
    // A, B and C show at first: hide the two walks, show the others.
    act(() => { S.toggleVisible('A'); S.toggleVisible('B'); S.toggleVisible('D'); S.toggleVisible('E'); });
    expect(S.items.value.filter((x) => x.vis).map((x) => x.id)).toEqual(['C', 'D', 'E']);
    tick('A', 'B');
    fireEvent.click(combineBtn());
    const f = S.items.value.find((x) => x.id === 'F')!;
    expect([f.vis, S.selected.value?.id]).toEqual([false, 'F']);
    expect(within(document.querySelector('.track-row[data-track="F"]') as HTMLElement).getByText('Three tracks are showing. Hide one to show this one.')).toBeTruthy();
  });
});

describe('logs too long to combine', () => {
  /** A logger with a fix every 1000 s for 40 days: no gap at that pace, so it covers every second. */
  function longLog(file: string, eastM: number, offsetMs = 0): LoadedTrack {
    const t0 = Date.UTC(2026, 5, 1) + offsetMs;
    const pts = Array.from({ length: 3457 }, (_, i) =>
      `<trkpt lat="${(40.775 + (i % 50) / 111_195).toFixed(7)}" lon="${(-73.969 + eastM / 84_300).toFixed(7)}"><time>${new Date(t0 + i * 1_000_000).toISOString()}</time></trkpt>`);
    const r = parseText(`<?xml version="1.0"?><gpx version="1.1" creator="Test"><trk><trkseg>${pts.join('')}</trkseg></trk></gpx>`, file);
    if (!r.ok) throw new Error(r.error);
    return r.track;
  }

  it('says so, rather than that they have no moment in common', () => {
    // Half a second apart, so they aren't taken for one recording opened twice.
    S.addLoaded([longLog('long-a.gpx', 0), longLog('long-b.gpx', 4, 500)]);
    render(<App Map={NoMap} />);
    tick('A', 'B');
    fireEvent.click(combineBtn());
    expect(S.comboNotice.value).toEqual({ kind: 'tooLong' });
    expect(screen.getByText(/^These tracks cover too much time to combine/)).toBeTruthy();
    expect(S.items.value).toHaveLength(2);
  });
});

describe("the combined track's card", () => {
  function combinedCarAndPhone() {
    S.addLoaded([load('stanford-drive-car.nmea'), load('stanford-drive-phone.gpx')]);
    render(<App Map={NoMap} />);
    tick('A', 'B');
    fireEvent.click(combineBtn());
    return document.querySelector('.track-row[data-track="C"]') as HTMLElement;
  }
  const combo = () => S.items.value.find((x) => x.id === 'C')!.track as ComboTrack;

  it('numbers its sources, its sub-tracks, in the order they were combined: not the letters they had in the list', () => {
    S.addLoaded([load('roosevelt-island-run.gpx'), load('stanford-drive-car.nmea'), load('stanford-drive-phone.gpx')]);
    render(<App Map={NoMap} />);
    tick('B', 'C');
    fireEvent.click(combineBtn());
    const row = document.querySelector('.track-row[data-track="D"]') as HTMLElement;
    // The combined track's own name says which tracks of the list it was made from.
    expect(row.querySelector('.track-name')!.textContent).toBe('B+C Combined Track');
    // Its sources: 1 and 2, on round dots in the colors of their lines, not the list's lettered badges.
    expect([...row.querySelectorAll('.combo-logs .log-num')].map((b) => b.textContent)).toEqual(['1', '2']);
    expect(row.querySelectorAll('.combo-logs .badge')).toHaveLength(0);
    expect(within(row).getByRole('button', { name: 'Hide source 1' })).toBeTruthy();
    fireEvent.click(within(row).getByRole('button', { name: 'Adjust' }));
    expect([...row.querySelectorAll('.trust-corner text')].map((x) => x.textContent)).toEqual(['1', '2']);
    // The timeline's lanes for them, under the combined track's own.
    expect([...document.querySelectorAll('.log-lane')].map((l) => [l.getAttribute('data-log'), l.querySelector('.log-num')?.textContent])).toEqual([['1', '1'], ['2', '2']]);
  });

  it('hides and shows each source by its own eye', () => {
    const row = combinedCarAndPhone();
    fireEvent.click(within(row).getByRole('button', { name: 'Hide source 2' }));
    expect(S.items.value.find((x) => x.id === 'C')!.logs).toEqual([true, false]);
    expect(within(row).getAllByRole('listitem')[1].textContent).toContain('hidden');
    fireEvent.click(within(row).getByRole('button', { name: 'Show source 2' }));
    expect(S.items.value.find((x) => x.id === 'C')!.logs).toEqual([true, true]);
  });

  it('opens the trust shape from the Trust line, moves the handle by keyboard, and goes back to equal from the center', () => {
    const row = combinedCarAndPhone();
    fireEvent.click(within(row).getByRole('button', { name: 'Adjust' }));
    const handle = within(row).getByRole('slider', { name: 'Trust in each source' });
    fireEvent.keyDown(handle, { key: 'ArrowRight' });
    expect(combo().combo.sources.map((s) => s.trust)).toEqual([0.45, 0.55]);
    expect(within(row).getByText('1 at 45%, 2 at 55%')).toBeTruthy();
    fireEvent.keyDown(handle, { key: 'Home' });
    expect(within(row).getAllByText('equal').length).toBeGreaterThan(0);
    for (let k = 0; k < 4; k++) fireEvent.keyDown(handle, { key: 'ArrowLeft' });
    fireEvent.click(within(row).getByRole('button', { name: 'Make them equal' }));
    expect(combo().combo.sources.map((s) => s.trust)).toEqual([0.5, 0.5]);
    fireEvent.click(within(row).getByRole('button', { name: 'Done' }));
    expect(within(row).queryByRole('slider')).toBeNull();
  });

  it('moves the handle on the line with Up and Down as with Right and Left, reads out the share they raise, and works nothing out for a step that changes nothing', () => {
    const row = combinedCarAndPhone();
    fireEvent.click(within(row).getByRole('button', { name: 'Adjust' }));
    const handle = within(row).getByRole('slider', { name: 'Trust in each source' });
    expect(handle.getAttribute('aria-valuenow')).toBe('50');
    fireEvent.keyDown(handle, { key: 'ArrowUp' });
    expect(combo().combo.sources.map((s) => s.trust)).toEqual([0.45, 0.55]);
    // The value read out is the right-hand source's share: Up and Right raise it.
    expect(handle.getAttribute('aria-valuenow')).toBe('55');
    fireEvent.keyDown(handle, { key: 'ArrowRight' });
    expect(handle.getAttribute('aria-valuenow')).toBe('60');
    fireEvent.keyDown(handle, { key: 'ArrowDown' });
    fireEvent.keyDown(handle, { key: 'ArrowLeft' });
    expect(handle.getAttribute('aria-valuenow')).toBe('50');
    // Home at the center, or an arrow at the end of the line: the same shares, nothing worked out again.
    const equal = combo();
    fireEvent.keyDown(handle, { key: 'Home' });
    fireEvent.click(within(row).getByRole('button', { name: 'Make them equal' }));
    expect(combo()).toBe(equal);
    for (let k = 0; k < 10; k++) fireEvent.keyDown(handle, { key: 'ArrowRight' });
    expect(combo().combo.sources.map((s) => s.trust)).toEqual([0, 1]);
    const end = combo();
    fireEvent.keyDown(handle, { key: 'ArrowRight' });
    fireEvent.keyDown(handle, { key: 'ArrowUp' });
    expect(combo()).toBe(end);
  });

  it('says a source at 0% only fills gaps, and the one at 100% is never left out', () => {
    const row = combinedCarAndPhone();
    fireEvent.click(within(row).getByRole('button', { name: 'Adjust' }));
    const handle = within(row).getByRole('slider', { name: 'Trust in each source' });
    for (let k = 0; k < 12; k++) fireEvent.keyDown(handle, { key: 'ArrowLeft' });
    expect(combo().combo.sources.map((s) => s.trust)).toEqual([1, 0]);
    expect(within(row).getByText("Source 2 is at 0%: it only fills gaps, where no other source has a fix. Source 1 is at 100%: it's never left out, even where it disagrees with the others.")).toBeTruthy();
    // Short of 100%, neither line.
    fireEvent.keyDown(handle, { key: 'ArrowRight' });
    expect(within(row).queryByText(/at 100%|at 0%/)).toBeNull();
  });

  it('works out a new version per animation frame while the handle is dragged', async () => {
    combinedCarAndPhone();
    const before = combo();
    S.setTrust('C', [0.3, 0.7]);
    S.setTrust('C', [0.2, 0.8]);
    expect(combo()).toBe(before);
    await act(() => new Promise((r) => requestAnimationFrame(() => r(undefined))));
    expect(combo().combo.sources.map((s) => s.trust)).toEqual([0.2, 0.8]);
  });

  it('shows in the fix card how far each source is, and the steady height difference between them', () => {
    combinedCarAndPhone();
    const c = combo();
    act(() => {
      S.cursorT.value = c.cols.t[Math.floor(c.cols.n / 3)];
      tipXY.value = { x: 600, y: 300 };
    });
    const tip = document.querySelector('.tooltip') as HTMLElement;
    const logs = [...tip.querySelectorAll('.tip-logs li')].map((li) => li.textContent);
    expect(logs).toHaveLength(2);
    expect(logs[0]).toMatch(/^1Source 1: [\d.]+ m away$/);
    expect(tip.querySelector('.tip-amber')?.textContent).toMatch(/^source 2 reads 3\d m lower than source 1 throughout$/);
  });

  it('says two clocks agree when the shift found rounds to 0.0 s', () => {
    S.addLoaded([walkLog({ seed: 9, noise: 0 }), walkLog({ seed: 10, noise: 0, offsetM: 2, shiftS: 0.02 })]);
    render(<App Map={NoMap} />);
    tick('A', 'B');
    fireEvent.click(combineBtn());
    // The shift is found and applied, but said in tenths it's none.
    expect(combo().combo.sources[1].clockS).toBeGreaterThan(0.01);
    const row = document.querySelector('.track-row[data-track="C"]') as HTMLElement;
    fireEvent.click(within(row).getByRole('button', { name: /^Properties/ }));
    expect(screen.getByText("Source 2's clock agrees with source 1's.")).toBeTruthy();
  });

  it("says a clock couldn't be lined up, rather than that it agrees, when nothing times it", () => {
    // 8 s apart, past the 5 s searched: the shift found was 0, said as clocks that agree.
    S.addLoaded([walkLog({ seed: 9 }), walkLog({ seed: 10, offsetM: 2, shiftS: 8 })]);
    render(<App Map={NoMap} />);
    tick('A', 'B');
    fireEvent.click(combineBtn());
    const row = document.querySelector('.track-row[data-track="C"]') as HTMLElement;
    fireEvent.click(within(row).getByRole('button', { name: /^Properties/ }));
    expect(screen.getByText("Source 2's clock couldn't be lined up with source 1's: its times are as recorded.")).toBeTruthy();
  });

  it('lists its sources, their clocks and the height difference on its Properties page', () => {
    const row = combinedCarAndPhone();
    fireEvent.click(within(row).getByRole('button', { name: /^Properties/ }));
    const logs = screen.getByRole('region', { name: 'Sources' });
    expect(within(logs).getAllByRole('listitem').map((li) => li.querySelector('.combo-file')!.textContent)).toEqual(['stanford-drive-car.nmea', 'stanford-drive-phone.gpx']);
    expect(screen.getByText(/^Source 2's clock read (2\.9|3\.0|3\.1) s ahead of source 1's: its times were made \1 s earlier to match\.$/)).toBeTruthy();
    expect(document.querySelector('.amber-note')?.textContent).toMatch(/^Source 2 reads a steady 3\d m lower than source 1: one of them probably gives heights above the ellipsoid/);
  });
});

describe('the timeline', () => {
  it('offers to go to a point picked outside the zoomed part, and centers the timeline on it', () => {
    S.addLoaded([load('central-park-loop.nmea')]);
    render(<App Map={NoMap} />);
    const t = S.items.value[0].track.cols.t, n = t.length;
    act(() => { S.timelineView.value = [t[0], t[Math.floor(n / 4)]]; });
    expect(screen.queryByRole('button', { name: 'Go to the fix' })).toBeNull();
    act(() => { S.cursorT.value = t[Math.floor((n * 3) / 4)]; });
    fireEvent.click(screen.getByRole('button', { name: 'Go to the fix' }));
    const [a, b] = S.timelineView.value!;
    expect(b - a).toBe(t[Math.floor(n / 4)] - t[0]);
    expect(Math.abs((a + b) / 2 - S.cursorT.value!)).toBeLessThan(1000);
    expect(screen.queryByRole('button', { name: 'Go to the fix' })).toBeNull();
  });
});
