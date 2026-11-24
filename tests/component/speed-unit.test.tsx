// @vitest-environment happy-dom
// The speed unit on a track's properties page, for a file that doesn't say
// which unit its speeds are in: the unit in use, and picking another, as the
// file's time zone is picked for times without one. Synthetic Central Park logs.
import { beforeEach, describe, expect, it } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/preact';
import { App } from '../../src/ui/App';
import * as S from '../../src/state/store';
import { parseText } from '../../src/parse/index';
import type { LoadedTrack } from '../../src/model/types';
import { load } from '../helpers/fixtures';
import { run, slowWalk, vendorGpx } from '../helpers/vendor-speed';

const NoMap = () => <div data-testid="map" />;
const HEADING = 'Speed unit of the file';
const GUESS = "The file doesn't say which unit its speed uses, and comparing it with the positions didn't settle it, so it was read as m/s. Change that under “Speed unit of the file”.";

const units = () => screen.queryByRole('group', { name: HEADING });
const unitButton = (name: string) => within(units()!).getByRole('button', { name });
const pressed = () => within(units()!).getAllByRole('button').filter((b) => b.getAttribute('aria-pressed') === 'true').map((b) => b.textContent);
/** A figure in the properties page's summary, by its label. */
const summary = (label: string) => [...document.querySelectorAll('.details .kv dt')].find((d) => d.textContent === label)?.nextElementSibling?.textContent;
const notes = () => [...document.querySelectorAll('.details .note-list li')].map((li) => li.textContent);
const propsButton = (id: string) => document.getElementById(`tlp-props-${id}`)!;

function loaded(text: string, file: string): LoadedTrack {
  const r = parseText(text, file);
  if (!r.ok) throw new Error(r.error);
  return r.track;
}

beforeEach(() => S.resetForTests());

describe("the speed unit of a file that doesn't say it", () => {
  it('shows the unit in use when the reader worked it out, sure or not, and nothing when the file gives it', () => {
    S.addLoaded([
      slowWalk(), run(), load('central-park-loop-vendor.gpx'),
      load('central-park-loop-garmin.gpx'), load('central-park-loop.nmea'), load('roosevelt-island-run.csv'),
      loaded(vendorGpx(1.3).replace(/<extensions>.*?<\/extensions>/g, ''), 'no-speed.gpx'),
    ]);
    render(<App Map={NoMap} />);
    const shown: Record<string, string[] | null> = {};
    for (const id of ['A', 'B', 'C', 'D', 'E', 'F', 'G']) {
      act(() => S.openDetails(id));
      shown[id] = units() ? pressed() : null;
      expect(!!screen.queryByRole('heading', { name: HEADING }), id).toBe(!!units());
    }
    // A, unsure: m/s. B and C, sure: km/h. The others give their unit (m/s, knots, km/h) or have no speed.
    expect(shown).toEqual({ A: ['m/s'], B: ['km/h'], C: ['km/h'], D: null, E: null, F: null, G: null });
    act(() => S.openDetails('A'));
    expect(within(units()!).getAllByRole('button').map((b) => b.textContent)).toEqual(['m/s', 'km/h', 'knots', 'mph']);
    // Placed as the time zone is: before the summary.
    const sections = [...document.querySelectorAll('.details h3')].map((h) => h.textContent);
    expect(sections.indexOf(HEADING)).toBe(sections.indexOf('Summary') - 1);
  });

  it("reads a walk's speeds again in the unit picked: its 16.9 km/h becomes 4.7 km/h, and the note says the unit was picked", () => {
    S.addLoaded([slowWalk()]);
    S.openDetails('A');
    render(<App Map={NoMap} />);
    expect(summary('Top speed')).toBe('16.9 km/h');
    expect(summary('Avg speed')).toBe('4.7 km/h');
    expect(notes()).toContain(GUESS);
    const kmh = unitButton('km/h');
    kmh.focus();
    fireEvent.click(kmh);
    expect(summary('Top speed')).toBe('4.7 km/h');
    expect(summary('Avg speed')).toBe('4.7 km/h');
    expect(pressed()).toEqual(['km/h']);
    expect(notes()).toContain("The file doesn't say which unit its speed uses; you picked km/h.");
    expect(notes()).not.toContain(GUESS);
    // The keyboard stays on the button pressed.
    expect(document.activeElement).toBe(unitButton('km/h'));
    // In miles an hour, as the summary shows every speed.
    fireEvent.click(unitButton('mph'));
    expect(summary('Top speed')).toBe('7.6 km/h');
    act(() => { S.units.value = 'imperial'; });
    expect(summary('Top speed')).toBe('4.7 mph');
  });

  it('keeps the name, the color settings and the selection of the track', () => {
    S.addLoaded([load('central-park-loop.nmea'), slowWalk()]);
    S.select('B');
    S.renameTrack('B', 'Morning walk');
    S.setMeasure('B', 'color', 'none');
    S.setMeasure('B', 'halo', 'speed');
    S.openDetails('B');
    render(<App Map={NoMap} />);
    fireEvent.click(unitButton('km/h'));
    expect(summary('Top speed')).toBe('4.7 km/h');
    expect(document.querySelector('.details-name .track-name')!.textContent).toBe('Morning walk');
    expect(S.items.value[1]).toMatchObject({ id: 'B', customName: 'Morning walk', color: 'none', halo: 'speed', vis: true });
    expect(S.selected.value!.id).toBe('B');
    // Back in the list: the same track selected, by its name, with its settings.
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    const row = document.querySelector('.track-row[data-track="B"]')!;
    expect(row.classList.contains('is-selected')).toBe(true);
    expect(row.querySelector('.track-name')!.textContent).toBe('Morning walk');
    expect(screen.getByRole('button', { name: /^Color One color Halo Speed \(km\/h\)/ })).toBeTruthy();
  });

  it("leaves the Properties button's label on the card as it was", () => {
    // The walk, and the same walk with times that have no zone.
    S.addLoaded([slowWalk(), loaded(vendorGpx(1.3).replaceAll('.000Z<', '.000<'), 'no-zone.gpx')]);
    render(<App Map={NoMap} />);
    expect(propsButton('A').textContent).toBe('Properties');
    act(() => S.setSpeedUnit('A', 'kmh'));
    expect(propsButton('A').textContent).toBe('Properties');
    act(() => S.select('B'));
    expect(propsButton('B').textContent).toBe('Properties & time zone');
    act(() => S.setSpeedUnit('B', 'kmh'));
    expect(propsButton('B').textContent).toBe('Properties & time zone');
  });

  it('names the units in Chinese', () => {
    S.addLoaded([slowWalk()]);
    S.openDetails('A');
    S.lang.value = 'zh';
    render(<App Map={NoMap} />);
    const group = screen.getByRole('group', { name: '文件的速度单位' });
    expect(within(group).getAllByRole('button').map((b) => b.textContent)).toEqual(['m/s', 'km/h', '节', 'mph']);
  });
});
