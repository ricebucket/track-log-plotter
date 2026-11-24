// @vitest-environment happy-dom
// Renaming a track in the list: a click on the selected track's name (or F2)
// turns it into a text box. The new name shows wherever the track is named;
// its file's name stays on its properties page and in the name's hover text,
// which is always there. Synthetic Central Park logs.
import { beforeEach, describe, expect, it } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/preact';
import { App } from '../../src/ui/App';
import * as S from '../../src/state/store';
import { parseText } from '../../src/parse/index';
import type { LoadedTrack } from '../../src/model/types';
import { load } from '../helpers/fixtures';

const NoMap = () => <div data-testid="map" />;
const row = (id: string) => document.querySelector(`.track-row[data-track="${id}"]`) as HTMLElement;
const main = (id: string) => row(id).querySelector('.track-main') as HTMLElement;
const nameOf = (id: string) => row(id).querySelector('.track-name') as HTMLElement;
const box = () => screen.queryByRole('textbox', { name: /^Name of track / }) as HTMLInputElement | null;
const type = (text: string) => fireEvent.input(box()!, { target: { value: text } });

/** Two logs, A selected (as a newly loaded track is). */
function setup() {
  S.addLoaded([load('central-park-loop.nmea'), load('central-park-loop-vendor.gpx')]);
  return render(<App Map={NoMap} />);
}

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

describe('renaming a track in the list', () => {
  it("selects a track whose name is clicked while it isn't selected, as before", () => {
    setup();
    expect(row('A').classList.contains('is-selected')).toBe(true);
    fireEvent.click(nameOf('B'));
    expect(row('B').classList.contains('is-selected')).toBe(true);
    expect(box()).toBeNull();
  });

  it("turns the selected track's name into a text box holding it, all selected; Enter keeps the new name", () => {
    setup();
    fireEvent.click(nameOf('A'));
    const b = box()!;
    expect(b.value).toBe('central-park-loop.nmea');
    expect(document.activeElement).toBe(b);
    expect([b.selectionStart, b.selectionEnd]).toEqual([0, b.value.length]);
    type('  Reservoir loop ');
    fireEvent.keyDown(b, { key: 'Enter' });
    expect(box()).toBeNull();
    expect(nameOf('A').textContent).toBe('Reservoir loop');
    expect(S.items.value[0].customName).toBe('Reservoir loop');
    expect(S.items.value[0].track.file).toBe('central-park-loop.nmea');
    // The keyboard is back on the row.
    expect(document.activeElement).toBe(main('A'));
  });

  it('keeps the old name on Escape, and only closes the box', () => {
    setup();
    fireEvent.click(nameOf('A'));
    type('Something else');
    fireEvent.keyDown(box()!, { key: 'Escape' });
    expect(box()).toBeNull();
    expect(nameOf('A').textContent).toBe('central-park-loop.nmea');
    expect(S.items.value[0].customName).toBeUndefined();
    expect(row('A').classList.contains('is-selected')).toBe(true);
    expect(document.activeElement).toBe(main('A'));
  });

  it("keeps what's typed when the box is left, or when another track gets selected meanwhile", () => {
    setup();
    fireEvent.click(nameOf('A'));
    type('Reservoir loop');
    fireEvent.blur(box()!);
    expect(box()).toBeNull();
    expect(nameOf('A').textContent).toBe('Reservoir loop');
    fireEvent.click(nameOf('A'));
    type('Reservoir loop, again');
    act(() => S.select('B'));
    expect(box()).toBeNull();
    expect(nameOf('A').textContent).toBe('Reservoir loop, again');
  });

  it("doesn't take Enter while an input method is still composing a word", () => {
    setup();
    fireEvent.click(nameOf('A'));
    type('水库');
    fireEvent.keyDown(box()!, { key: 'Enter', isComposing: true });
    expect(box()).not.toBeNull();
    fireEvent.keyDown(box()!, { key: 'Enter' });
    expect(nameOf('A').textContent).toBe('水库');
  });

  it("takes a blank name as the file's name again", () => {
    setup();
    S.renameTrack('A', 'Reservoir loop');
    fireEvent.click(nameOf('A'));
    expect(box()!.value).toBe('Reservoir loop');
    type('   ');
    fireEvent.keyDown(box()!, { key: 'Enter' });
    expect(nameOf('A').textContent).toBe('central-park-loop.nmea');
    expect(S.items.value[0].customName).toBeUndefined();
  });

  it('renames the selected track from the keyboard with F2', () => {
    setup();
    expect(main('A').getAttribute('aria-keyshortcuts')).toBe('F2');
    expect(main('B').hasAttribute('aria-keyshortcuts')).toBe(false);
    fireEvent.keyDown(main('B'), { key: 'F2' });
    expect(box()).toBeNull();
    fireEvent.keyDown(main('A'), { key: 'F2' });
    expect(box()!.getAttribute('aria-label')).toBe('Name of track A');
  });

  it('ticks the track in select mode instead', () => {
    setup();
    fireEvent.click(screen.getByRole('button', { name: 'Select' }));
    fireEvent.click(nameOf('A'));
    expect(box()).toBeNull();
    expect(S.ticked.value).toEqual(['A']);
    // Its tick box is named by its new name.
    act(() => S.renameTrack('B', 'Reservoir loop'));
    expect(screen.getByRole('checkbox', { name: 'Select track B: Reservoir loop' })).toBeTruthy();
  });
});

describe('where a renamed track shows its names', () => {
  it("gives its name hover text, cut off or not: the name, the file's name once renamed, and the properties page's line", () => {
    setup();
    act(() => S.openDetails('B'));
    const tagline = document.querySelector('.details-name .track-sub')!.textContent!;
    expect(tagline).toMatch(/^GPX · /);
    act(() => { S.page.value = { kind: 'tracks' }; });
    // happy-dom lays nothing out, so nothing here is cut off: the hover text is there all the same.
    expect(nameOf('B').getAttribute('data-tip')).toBe(`central-park-loop-vendor.gpx\n${tagline}`);
    act(() => S.renameTrack('B', 'Reservoir loop'));
    expect(nameOf('B').getAttribute('data-tip')).toBe(`Reservoir loop\nFile name: central-park-loop-vendor.gpx\n${tagline}`);
    // Assistive tech hears the file's name with the row.
    expect(screen.getByRole('button', { name: /Reservoir loop.*File name: central-park-loop-vendor\.gpx/ })).toBe(main('B'));
  });

  it("shows the new name and the file's name on its properties page", () => {
    setup();
    act(() => S.openDetails('B'));
    expect(document.querySelector('.details-orig')).toBeNull();
    act(() => S.renameTrack('B', 'Reservoir loop'));
    expect(document.querySelector('.details-name .track-name')!.textContent).toBe('Reservoir loop');
    expect(document.querySelector('.details-orig')!.textContent).toBe('File name: central-park-loop-vendor.gpx');
  });

  it("names a combined track's sources by their new names, and a renamed combined track by its first name too", () => {
    S.addLoaded([walk('phone.gpx'), walk('watch.gpx', 3, 280)]);
    render(<App Map={NoMap} />);
    act(() => S.renameTrack('A', 'Phone'));
    act(() => { S.startSelect(); S.toggleTick('A'); S.toggleTick('B'); S.combineTicked(); });
    const files = () => Array.from(document.querySelectorAll('.combo-file'), (el) => el.textContent);
    expect(nameOf('C').textContent).toBe('A+B Combined Track');
    expect(files()).toEqual(['Phone', 'watch.gpx']);
    // Renamed after combining: the card follows.
    act(() => S.renameTrack('B', 'Watch'));
    expect(files()).toEqual(['Phone', 'Watch']);
    act(() => S.renameTrack('C', 'Morning walk'));
    act(() => S.openDetails('C'));
    expect(files()).toEqual(['Phone', 'Watch']);
    expect(document.querySelector('.details-name .track-name')!.textContent).toBe('Morning walk');
    expect(document.querySelector('.details-orig')!.textContent).toBe('Original name: A+B Combined Track');
  });

  it('never gives a new combined track a name another track already goes by', () => {
    S.addLoaded([walk('phone.gpx'), walk('watch.gpx', 3, 280)]);
    render(<App Map={NoMap} />);
    act(() => S.renameTrack('B', 'A+B Combined Track'));
    act(() => { S.startSelect(); S.toggleTick('A'); S.toggleTick('B'); S.combineTicked(); });
    expect(nameOf('C').textContent).toBe('A+B Combined Track 2');
  });

  it('names the track by its new name in a notice still showing', () => {
    S.addLoaded([load('central-park-loop-truncated.nmea')]);
    render(<App Map={NoMap} />);
    expect(screen.getByText(/^central-park-loop-truncated\.nmea loaded with 1 problem/)).toBeTruthy();
    act(() => S.renameTrack('A', 'Reservoir loop'));
    expect(screen.getByText(/^Reservoir loop loaded with 1 problem/)).toBeTruthy();
  });
});
