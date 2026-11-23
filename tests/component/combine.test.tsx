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
    fireEvent.click(all);
    expect(S.ticked.value).toEqual(['A', 'B', 'C']);
    expect(all.getAttribute('aria-checked')).toBe('true');
    fireEvent.click(all);
    expect(S.ticked.value).toEqual([]);
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
    expect(screen.getByText('Select 2 or 3 logs of the same trip to combine them.')).toBeTruthy();
    fireEvent.click(rowBox('C'));
    expect(screen.getByText('These logs share no time.')).toBeTruthy();
    fireEvent.click(rowBox('C'));
    fireEvent.click(rowBox('B'));
    expect(combineBtn().getAttribute('aria-disabled')).toBeNull();
    fireEvent.click(rowBox('C'));
    fireEvent.click(rowBox('D'));
    expect(screen.getByText('At most 3 logs can be combined.')).toBeTruthy();
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
    expect(c.track.file).toBe('Combined track');
    expect(S.selected.value?.id).toBe('D');
    expect([c.vis, S.items.value[0].vis, S.items.value[1].vis]).toEqual([true, false, false]);
    expect(c.logs).toEqual([true, true]);
    // Its row: a diamond badge, and the number of logs.
    const row = document.querySelector('.track-row[data-track="D"]')!;
    expect(row.querySelector('.track-sub')!.textContent).toMatch(/ · 2 logs$/);
    // Its card: each log numbered, with how much it counts and its typical error.
    const logs = within(row as HTMLElement).getByRole('region', { name: 'Its logs' });
    const items = within(logs).getAllByRole('listitem');
    expect(items.map((li) => li.querySelector('.combo-file')!.textContent)).toEqual(['stanford-drive-car.nmea', 'stanford-drive-phone.gpx']);
    expect(items[0].textContent).toMatch(/counts \d+% · typical error [\d.]+ m/);
    expect(within(logs).getByText('equal')).toBeTruthy();
    // A second combined track gets its own name.
    fireEvent.click(screen.getByRole('button', { name: 'Select' }));
    fireEvent.click(rowBox('A'));
    fireEvent.click(rowBox('B'));
    fireEvent.click(combineBtn());
    expect(S.items.value.find((x) => x.id === 'E')?.track.file).toBe('Combined track 2');
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

describe("the combined track's card", () => {
  function combinedCarAndPhone() {
    S.addLoaded([load('stanford-drive-car.nmea'), load('stanford-drive-phone.gpx')]);
    render(<App Map={NoMap} />);
    tick('A', 'B');
    fireEvent.click(combineBtn());
    return document.querySelector('.track-row[data-track="C"]') as HTMLElement;
  }
  const combo = () => S.items.value.find((x) => x.id === 'C')!.track as ComboTrack;

  it('hides and shows each log by its own eye', () => {
    const row = combinedCarAndPhone();
    fireEvent.click(within(row).getByRole('button', { name: 'Hide log 2' }));
    expect(S.items.value.find((x) => x.id === 'C')!.logs).toEqual([true, false]);
    expect(within(row).getAllByRole('listitem')[1].textContent).toContain('hidden');
    fireEvent.click(within(row).getByRole('button', { name: 'Show log 2' }));
    expect(S.items.value.find((x) => x.id === 'C')!.logs).toEqual([true, true]);
  });

  it('opens the trust shape from the Trust line, moves the handle by keyboard, and goes back to equal from the center', () => {
    const row = combinedCarAndPhone();
    fireEvent.click(within(row).getByRole('button', { name: 'Adjust' }));
    const handle = within(row).getByRole('slider', { name: 'Trust in each log' });
    fireEvent.keyDown(handle, { key: 'ArrowRight' });
    expect(combo().combo.sources.map((s) => s.trust)).toEqual([0.45, 0.55]);
    expect(within(row).getByText('1 at 45%, 2 at 55%')).toBeTruthy();
    fireEvent.keyDown(handle, { key: 'Home' });
    expect(within(row).getAllByText('equal').length).toBeGreaterThan(0);
    for (let k = 0; k < 4; k++) fireEvent.keyDown(handle, { key: 'ArrowLeft' });
    fireEvent.click(within(row).getByRole('button', { name: 'Make them equal' }));
    expect(combo().combo.sources.map((s) => s.trust)).toEqual([0.5, 0.5]);
    fireEvent.click(within(row).getByRole('button', { name: 'Hide' }));
    expect(within(row).queryByRole('slider')).toBeNull();
  });

  it('says a log at 0% only fills gaps', () => {
    const row = combinedCarAndPhone();
    fireEvent.click(within(row).getByRole('button', { name: 'Adjust' }));
    const handle = within(row).getByRole('slider', { name: 'Trust in each log' });
    for (let k = 0; k < 12; k++) fireEvent.keyDown(handle, { key: 'ArrowLeft' });
    expect(combo().combo.sources.map((s) => s.trust)).toEqual([1, 0]);
    expect(within(row).getByText('Log 2 is at 0%: it only fills gaps, where no other log has a fix.')).toBeTruthy();
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

  it('shows in the fix card how far each log is, and the steady height difference between them', () => {
    combinedCarAndPhone();
    const c = combo();
    act(() => {
      S.cursorT.value = c.cols.t[Math.floor(c.cols.n / 3)];
      tipXY.value = { x: 600, y: 300 };
    });
    const tip = document.querySelector('.tooltip') as HTMLElement;
    const logs = [...tip.querySelectorAll('.tip-logs li')].map((li) => li.textContent);
    expect(logs).toHaveLength(2);
    expect(logs[0]).toMatch(/^1Log 1: [\d.]+ m away$/);
    expect(tip.querySelector('.tip-amber')?.textContent).toMatch(/^log 2 reads 3\d m lower than log 1 throughout$/);
  });

  it('lists its logs, their clocks and the height difference on its Properties page', () => {
    const row = combinedCarAndPhone();
    fireEvent.click(within(row).getByRole('button', { name: /^Properties/ }));
    const logs = screen.getByRole('region', { name: 'Its logs' });
    expect(within(logs).getAllByRole('listitem').map((li) => li.querySelector('.combo-file')!.textContent)).toEqual(['stanford-drive-car.nmea', 'stanford-drive-phone.gpx']);
    expect(screen.getByText("Log 2's clock read 3.0 s ahead of log 1's: its times were moved back to match.")).toBeTruthy();
    expect(document.querySelector('.amber-note')?.textContent).toMatch(/^Log 2 reads a steady 3\d m lower than log 1: one of them probably gives heights above the ellipsoid/);
  });
});
