// @vitest-environment happy-dom
// Notices about a track that has since gone: the time zone notice of Combine
// leaves with its track, its button checks that the track is still there, and
// a properties page whose track is gone still has its way back.
import { beforeEach, describe, expect, it } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/preact';
import { App } from '../../src/ui/App';
import * as S from '../../src/state/store';
import { load } from '../helpers/fixtures';

const NoMap = () => <div data-testid="map" />;
const bar = () => screen.getByRole('toolbar', { name: 'Act on the selected tracks' });
const rowBox = (id: string) => screen.getByRole('checkbox', { name: new RegExp(`^Select track ${id}:`) });
const zoneToast = () => document.querySelector('.toast[data-combo="zone"]') as HTMLElement | null;

/** The car's log and a logger's log with no time zone, ticked and combined: the time zone notice about B. */
function zoneNotice(...more: string[]) {
  S.addLoaded([load('stanford-drive-car.nmea'), load('stanford-drive-logger.csv'), ...more.map(load)]);
  render(<App Map={NoMap} />);
  fireEvent.click(screen.getByRole('button', { name: 'Select' }));
  fireEvent.click(rowBox('A'));
  fireEvent.click(rowBox('B'));
  fireEvent.click(within(bar()).getByRole('button', { name: 'Combine' }));
  // The logs share no time as they are: nothing to combine anyway.
  expect(S.comboNotice.value).toEqual({ kind: 'zone', id: 'B', file: 'stanford-drive-logger.csv', ids: null });
  expect(zoneToast()).not.toBeNull();
}

beforeEach(() => S.resetForTests());

describe("Combine's time zone notice", () => {
  it('goes when its track is removed in select mode', () => {
    zoneNotice('central-park-loop.nmea');
    fireEvent.click(rowBox('A'));
    fireEvent.click(within(bar()).getByRole('button', { name: 'Remove' }));
    fireEvent.click(within(bar()).getByRole('button', { name: 'Remove 1?' }));
    expect(S.items.value.map((x) => x.id)).toEqual(['A', 'C']);
    expect(S.comboNotice.value).toBeNull();
    expect(zoneToast()).toBeNull();
  });

  it('goes when its track is removed from its card, and stays when another track is', () => {
    zoneNotice('central-park-loop.nmea');
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    act(() => S.remove('C'));
    expect(zoneToast()).not.toBeNull();
    act(() => S.remove('B'));
    expect(zoneToast()).toBeNull();
    // A new file given the letter B isn't the track the notice was about.
    act(() => S.addLoaded([load('roosevelt-island-run.gpx')]));
    expect(S.items.value.find((x) => x.id === 'B')?.track.file).toBe('roosevelt-island-run.gpx');
    expect(zoneToast()).toBeNull();
  });

  it('offers "Show properties" only while the track it names is in the list, with the same file', () => {
    S.addLoaded([load('stanford-drive-car.nmea'), load('roosevelt-island-run.gpx')]);
    render(<App Map={NoMap} />);
    // A notice about a B that has gone, its letter now another file's (as a notice left behind would be).
    act(() => { S.comboNotice.value = { kind: 'zone', id: 'B', file: 'stanford-drive-logger.csv', ids: null }; });
    expect(within(zoneToast()!).queryByRole('button', { name: 'Show properties' })).toBeNull();
    act(() => { S.comboNotice.value = { kind: 'zone', id: 'C', file: 'stanford-drive-logger.csv', ids: null }; });
    expect(within(zoneToast()!).queryByRole('button', { name: 'Show properties' })).toBeNull();
    // The track it names: the button opens its properties.
    act(() => { S.comboNotice.value = { kind: 'zone', id: 'B', file: 'roosevelt-island-run.gpx', ids: null }; });
    fireEvent.click(within(zoneToast()!).getByRole('button', { name: 'Show properties' }));
    expect(S.page.value).toEqual({ kind: 'details', id: 'B' });
  });
});

describe('a properties page whose track is gone', () => {
  it('keeps its Back button, which goes back to the list', () => {
    S.addLoaded([load('central-park-loop.nmea')]);
    render(<App Map={NoMap} />);
    act(() => { S.page.value = { kind: 'details', id: 'Q' }; });
    const back = screen.getByRole('button', { name: 'Back' });
    fireEvent.click(back);
    expect(S.page.value).toEqual({ kind: 'tracks' });
    expect(screen.getByRole('heading', { name: 'Tracks' })).toBeTruthy();
  });
});
