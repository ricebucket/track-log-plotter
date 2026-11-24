// @vitest-environment happy-dom
// Where the keyboard focus goes after an action takes away the focused
// element: it moves on to the next sensible place rather than drop to <body>.
import { beforeEach, describe, expect, it } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/preact';
import { App } from '../../src/ui/App';
import * as S from '../../src/state/store';
import { parseText } from '../../src/parse/index';
import type { LoadedTrack } from '../../src/model/types';
import { load } from '../helpers/fixtures';

const NoMap = () => <div data-testid="map" />;
const bar = () => screen.getByRole('toolbar', { name: 'Act on the selected tracks' });
const rowBox = (id: string) => screen.getByRole('checkbox', { name: new RegExp(`^Select track ${id}:`) });
const rowMain = (id: string) => document.querySelector(`.track-row[data-track="${id}"] .track-main`);
/** Presses a button the way a keyboard does: it has the focus, then a click. */
const press = (el: HTMLElement) => { el.focus(); fireEvent.click(el); };

/** A walk north through Central Park, a fix a second, `eastM` metres east of the path. */
function walk(file: string, eastM = 0, seconds = 300): LoadedTrack {
  const t0 = Date.UTC(2026, 5, 14, 13, 0, 0);
  const pts = Array.from({ length: seconds }, (_, i) =>
    `<trkpt lat="${(40.775 + (i * 1.5) / 111_195).toFixed(7)}" lon="${(-73.969 + eastM / 84_300).toFixed(7)}"><ele>20</ele><time>${new Date(t0 + i * 1000).toISOString()}</time><hdop>1.2</hdop><sat>8</sat></trkpt>`);
  const r = parseText(`<?xml version="1.0"?><gpx version="1.1" creator="Test"><trk><trkseg>${pts.join('')}</trkseg></trk></gpx>`, file);
  if (!r.ok) throw new Error(r.error);
  return r.track;
}

beforeEach(() => S.resetForTests());

describe('the focus after an action', () => {
  it('goes to Back as the properties page opens, and back to the Properties button after Back', () => {
    S.addLoaded([load('central-park-loop.nmea'), load('roosevelt-island-run.gpx')]);
    render(<App Map={NoMap} />);
    act(() => S.select('B'));
    press(screen.getByRole('button', { name: 'Properties' }));
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Back' }));
    press(screen.getByRole('button', { name: 'Back' }));
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Properties' }));
    expect(document.activeElement!.closest('.track-row')!.getAttribute('data-track')).toBe('B');
  });

  it('goes to the next row after a track is removed from its card, the one before after the last, then to Open tracks', () => {
    S.addLoaded([load('central-park-loop.nmea'), load('roosevelt-island-run.gpx'), load('lower-manhattan-walk.gpx')]);
    render(<App Map={NoMap} />);
    const removeSelected = () => {
      press(screen.getByRole('button', { name: 'Remove this track' }));
      press(screen.getByRole('button', { name: 'Remove?' }));
    };
    removeSelected(); // A, selected as the first added
    expect(document.activeElement).toBe(rowMain('B'));
    act(() => S.select('C'));
    removeSelected();
    expect(document.activeElement).toBe(rowMain('B'));
    removeSelected();
    expect(S.items.value).toEqual([]);
    expect(document.activeElement).toBe(screen.getByRole('button', { name: /Open tracks/ }));
  });

  it('goes to the Select button after "Remove 2?" removes the ticked tracks, and to Open tracks when none is left', () => {
    S.addLoaded([load('central-park-loop.nmea'), load('roosevelt-island-run.gpx'), load('lower-manhattan-walk.gpx')]);
    render(<App Map={NoMap} />);
    fireEvent.click(screen.getByRole('button', { name: 'Select' }));
    fireEvent.click(rowBox('A'));
    fireEvent.click(rowBox('C'));
    press(within(bar()).getByRole('button', { name: 'Remove' }));
    press(within(bar()).getByRole('button', { name: 'Remove 2?' }));
    expect(S.items.value.map((x) => x.id)).toEqual(['B']);
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Select' }));
    press(screen.getByRole('button', { name: 'Select' }));
    fireEvent.click(rowBox('B'));
    press(within(bar()).getByRole('button', { name: 'Remove' }));
    press(within(bar()).getByRole('button', { name: 'Remove 1?' }));
    expect(document.activeElement).toBe(screen.getByRole('button', { name: /Open tracks/ }));
  });

  it("goes to the new combined track's row after Combine, and after Combine anyway", () => {
    S.addLoaded([load('stanford-drive-car.nmea'), load('stanford-drive-phone.gpx')]);
    render(<App Map={NoMap} />);
    fireEvent.click(screen.getByRole('button', { name: 'Select' }));
    fireEvent.click(rowBox('A'));
    fireEvent.click(rowBox('B'));
    press(within(bar()).getByRole('button', { name: 'Combine' }));
    expect(S.items.value.map((x) => x.id)).toEqual(['A', 'B', 'C']);
    expect(document.activeElement).toBe(rowMain('C'));

    S.resetForTests();
    S.addLoaded([walk('east.gpx'), walk('west.gpx', 250, 299)]);
    fireEvent.click(screen.getByRole('button', { name: 'Select' }));
    fireEvent.click(rowBox('A'));
    fireEvent.click(rowBox('B'));
    press(within(bar()).getByRole('button', { name: 'Combine' }));
    const toast = document.querySelector('.toast[data-combo="apart"]') as HTMLElement;
    press(within(toast).getByRole('button', { name: 'Combine anyway' }));
    expect(document.activeElement).toBe(rowMain('C'));
  });

  it('goes back to the button that opened the time zone list as the list closes, unless the press that closed it was elsewhere', () => {
    S.addLoaded([load('central-park-loop.nmea')]);
    render(<App Map={NoMap} />);
    const other = screen.getByRole('button', { name: /Other/ });
    press(other);
    const list = () => screen.queryByRole('dialog', { name: 'Pick a time zone' });
    expect(list()!.contains(document.activeElement)).toBe(true);
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
    expect(list()).toBeNull();
    expect(document.activeElement).toBe(other);
    // A zone picked from the list.
    press(other);
    fireEvent.input(within(list()!).getByRole('searchbox'), { target: { value: 'tokyo' } });
    press(within(list()!).getByRole('radio', { name: /Tokyo/ }));
    expect(list()).toBeNull();
    const tokyo = screen.getByRole('button', { name: /Tokyo/ });
    expect(document.activeElement).toBe(tokyo);
    // Closed by a press on another button, which takes the focus.
    press(tokyo);
    const local = screen.getByRole('button', { name: 'Local' });
    fireEvent.pointerDown(local);
    local.focus();
    expect(list()).toBeNull();
    expect(document.activeElement).toBe(local);
  });
});
