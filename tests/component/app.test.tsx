// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/preact';
import { App } from '../../src/ui/App';
import * as S from '../../src/state/store';
import { tipXY } from '../../src/map/bridge';
import { load } from '../helpers/fixtures';

const NoMap = () => <div data-testid="map" />;

function loadFixtures(...names: string[]) {
  S.addLoaded(names.map(load));
}

beforeEach(() => {
  S.resetForTests();
  tipXY.value = null;
});

describe('empty state', () => {
  it('offers to open files or try the sample ride', () => {
    render(<App Map={NoMap} />);
    expect(screen.getByRole('heading', { name: 'Plot your GPS track logs' })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Open tracks/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Try the sample ride' })).toBeTruthy();
    expect(screen.getByText('GPX')).toBeTruthy();
    expect(screen.getByText('NMEA')).toBeTruthy();
  });

  it('switches the whole interface to Chinese from the Options menu', () => {
    render(<App Map={NoMap} />);
    expect(screen.queryByRole('button', { name: '中文' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Options/ }));
    fireEvent.click(screen.getByRole('button', { name: '中文' }));
    expect(screen.getByText('轨迹绘图器')).toBeTruthy();
    expect(screen.getByRole('heading', { name: '把 GPS 轨迹记录画在地图上' })).toBeTruthy();
    expect(document.documentElement.lang).toBe('zh-CN');
  });
});

describe('tracks panel', () => {
  it('lists loaded tracks and flags the damaged one', () => {
    loadFixtures('central-park-loop-truncated.nmea', 'central-park-loop-vendor.gpx');
    render(<App Map={NoMap} />);
    expect(screen.getByRole('heading', { name: 'Track Log Plotter' })).toBeTruthy();
    expect(screen.getByText('central-park-loop-truncated.nmea')).toBeTruthy();
    expect(screen.getByText('1 problem')).toBeTruthy();
    expect(screen.getByText('2 of 3 shown · 2 loaded')).toBeTruthy();
    expect(screen.getByRole('status').textContent).toContain('loaded with 1 problem');
  });

  it('hides and shows tracks, refusing a fourth', () => {
    loadFixtures('central-park-loop.nmea', 'central-park-loop-vendor.gpx', 'roosevelt-island-run.gpx', 'central-park-loop-garmin.gpx');
    render(<App Map={NoMap} />);
    fireEvent.click(screen.getByRole('button', { name: 'Show track D' }));
    expect(screen.getByText('Three tracks are showing. Hide one to show this one.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Hide track B' }));
    fireEvent.click(screen.getByRole('button', { name: 'Show track D' }));
    expect(screen.getByRole('button', { name: 'Hide track D' }).getAttribute('aria-pressed')).toBe('true');
  });

  it('minimizes the panel to a single button, without the title', () => {
    loadFixtures('central-park-loop.nmea');
    render(<App Map={NoMap} />);
    fireEvent.click(screen.getByRole('button', { name: 'Minimize the panel' }));
    expect(screen.queryByText('Track Log Plotter')).toBeNull();
    expect(screen.queryByText('central-park-loop.nmea')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Show the panel' }));
    expect(screen.getByText('central-park-loop.nmea')).toBeTruthy();
  });

  it('minimizes the timeline to a single button', () => {
    loadFixtures('central-park-loop.nmea');
    render(<App Map={NoMap} />);
    expect(screen.getByRole('region', { name: 'Timeline' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Minimize the timeline' }));
    expect(screen.queryByRole('region', { name: 'Timeline' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Show the timeline' }));
    expect(screen.getByRole('region', { name: 'Timeline' })).toBeTruthy();
  });

  it('explains every measure in the color pane and marks the missing ones', () => {
    loadFixtures('central-park-loop-vendor.gpx');
    render(<App Map={NoMap} />);
    fireEvent.click(screen.getByRole('button', { name: /^Color/ }));
    const pane = screen.getByRole('dialog', { name: 'Color track A by' });
    const radios = within(pane).getAllByRole('radio');
    expect(radios.map((r) => r.querySelector('.opt-name')!.textContent)).toEqual(['Speed', 'Elevation', 'Grade', 'HDOP', 'Satellites used', 'Fix type', 'One color']);
    expect(within(pane).getByText(/Horizontal dilution of precision/)).toBeTruthy();
    // This logger writes no satellite count or fix type.
    const sats = radios[4];
    expect(sats.getAttribute('aria-disabled')).toBe('true');
    expect(within(sats).getByText('Not in this file.')).toBeTruthy();
    expect(within(pane).getByText(/ranked against itself/)).toBeTruthy();
    fireEvent.click(radios[1]);
    expect(screen.queryByRole('dialog', { name: 'Color track A by' })).toBeNull();
    expect(S.items.value[0].color).toBe('ele');
  });

  it('copies the color and halo measures to the other tracks, naming them on hover', () => {
    loadFixtures('central-park-loop.nmea', 'roosevelt-island-run.gpx');
    S.setMeasure('A', 'color', 'ele');
    S.setMeasure('A', 'halo', 'speed');
    render(<App Map={NoMap} />);
    const apply = screen.getByRole('button', { name: 'Use on all tracks' });
    expect(apply.getAttribute('title')).toBe('Every track: color by Elevation, halo by Speed');
    fireEvent.click(apply);
    expect(S.items.value[1].color).toBe('ele');
    expect(S.items.value[1].halo).toBe('speed');
    act(() => {
      S.setMeasure('A', 'color', 'none');
      S.setMeasure('A', 'halo', 'off');
    });
    expect(apply.getAttribute('title')).toBe('Every track: plain lines, no halo');
  });

  it('shows dates for a log that spans two days', () => {
    loadFixtures('hudson-overnight.gpx');
    S.zone.value = 'America/New_York';
    S.cursorT.value = S.items.value[0].track.cols.t[0];
    render(<App Map={NoMap} />);
    expect(screen.getByText(/^Jul 11 – Jul 12 · [\d.]+ km · GPX$/)).toBeTruthy();
    expect(document.querySelector('.tl-time')!.textContent!.replace(/\s/g, ' ')).toBe('Jul 11, 7:30:00 PM');
    expect([...document.querySelectorAll('.tl-ticks .tick-date')].map((e) => e.textContent)).toEqual(['Jul 12']);
    fireEvent.click(screen.getByRole('button', { name: 'Details' }));
    expect(screen.getByText('Sat, Jul 11, 2026 – Sun, Jul 12, 2026')).toBeTruthy();
    expect(screen.getByText(/^Jul 11, 7:30:00\sPM – Jul 12, 8:34:10\sAM/)).toBeTruthy();
  });

  it('opens the color pane from a heading, not a drop-down, and closes it on a second press', () => {
    loadFixtures('central-park-loop.nmea');
    render(<App Map={NoMap} />);
    const heading = screen.getByRole('button', { name: 'Color Speed (km/h)' });
    expect(heading.getAttribute('aria-haspopup')).toBe('dialog');
    fireEvent.click(heading);
    expect(screen.getByRole('dialog', { name: 'Color track A by' })).toBeTruthy();
    expect(heading.getAttribute('aria-expanded')).toBe('true');
    // A real press starts with pointerdown, which closes popovers outside; the heading is exempt.
    fireEvent.pointerDown(heading);
    fireEvent.click(heading);
    expect(screen.queryByRole('dialog', { name: 'Color track A by' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Halo HDOP' }));
    expect(screen.getByRole('dialog', { name: 'Halo around track A' })).toBeTruthy();
  });

  it('explains the percentages behind the calculator, not in a heading', () => {
    loadFixtures('central-park-loop.nmea');
    render(<App Map={NoMap} />);
    expect(screen.queryByText('share of time')).toBeNull();
    const legend = document.querySelector('.legend')!;
    expect(legend.querySelector('.legend-why button')).toBeTruthy();
  });

  it('removes all tracks after asking', () => {
    loadFixtures('central-park-loop.nmea', 'roosevelt-island-run.gpx');
    render(<App Map={NoMap} />);
    fireEvent.click(screen.getByRole('button', { name: 'Remove all tracks' }));
    expect(screen.getByText('Remove all 2 tracks?')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(S.items.value).toHaveLength(2);
    fireEvent.click(screen.getByRole('button', { name: 'Remove all tracks' }));
    fireEvent.click(screen.getByRole('button', { name: 'Remove all' }));
    expect(S.items.value).toHaveLength(0);
    expect(screen.getByRole('heading', { name: 'Plot your GPS track logs' })).toBeTruthy();
  });

  it('shows each map switch as on or off by its border, without a checkbox', () => {
    loadFixtures('central-park-loop.nmea');
    render(<App Map={NoMap} />);
    const arrows = screen.getByRole('button', { name: 'Heading arrows' });
    expect(document.querySelector('.toggle-chip .check')).toBeNull();
    const was = arrows.getAttribute('aria-pressed');
    fireEvent.click(arrows);
    expect(arrows.getAttribute('aria-pressed')).not.toBe(was);
    expect(arrows.classList.contains('is-on')).toBe(arrows.getAttribute('aria-pressed') === 'true');
  });

  it('closes the fix card with its close button', () => {
    loadFixtures('central-park-loop.nmea');
    S.cursorT.value = S.items.value[0].track.cols.t[100];
    tipXY.value = { x: 600, y: 300 };
    render(<App Map={NoMap} />);
    expect(document.querySelector('.tooltip')).toBeTruthy();
    fireEvent.click(within(document.querySelector('.tooltip') as HTMLElement).getByRole('button', { name: 'Close' }));
    expect(S.cursorT.value).toBeNull();
    expect(document.querySelector('.tooltip')).toBeNull();
  });

  it('opens the details page with the problem explained', () => {
    loadFixtures('central-park-loop-truncated.nmea');
    render(<App Map={NoMap} />);
    fireEvent.click(screen.getByRole('button', { name: 'Show details' }));
    expect(screen.getByText('Last line cut off')).toBeTruthy();
    expect(screen.getByText(/stops after 28 characters/)).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Fields in this file' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.getByRole('heading', { name: 'Tracks' })).toBeTruthy();
  });

  it('links Street View to the selected point, and only when there is one', () => {
    loadFixtures('central-park-loop.nmea');
    render(<App Map={NoMap} />);
    expect(screen.queryByRole('link', { name: /Street View/ })).toBeNull();
    act(() => { S.cursorT.value = S.items.value[0].track.cols.t[100]; });
    const sv = screen.getByRole('link', { name: /Street View at the selected point/ });
    const c = S.items.value[0].track.cols;
    expect(sv.getAttribute('href')).toContain(`viewpoint=${c.lat[100].toFixed(6)}%2C${c.lon[100].toFixed(6)}`);
    act(() => S.clearCursor());
    expect(screen.queryByRole('link', { name: /Street View/ })).toBeNull();
  });

  it('points to Google My Maps for seeing the track on Google', () => {
    loadFixtures('central-park-loop.nmea');
    render(<App Map={NoMap} />);
    expect(screen.getByRole('link', { name: /Google My Maps/ }).getAttribute('href')).toBe('https://mymaps.google.com/');
    expect(screen.getByText(/choose Import under its layer and pick your GPX file/)).toBeTruthy();
  });

  it('links to Google Maps for the current view', () => {
    loadFixtures('central-park-loop.nmea');
    render(<App Map={NoMap} />);
    const link = screen.getByRole('link', { name: /This map view/ });
    expect(link.getAttribute('href')).toContain('https://www.google.com/maps/@?api=1&map_action=map');
    expect(link.getAttribute('target')).toBe('_blank');
  });

  it('shows time in a picked zone', () => {
    loadFixtures('central-park-loop.nmea');
    S.cursorT.value = S.items.value[0].track.cols.t[0];
    render(<App Map={NoMap} />);
    fireEvent.click(screen.getByRole('button', { name: 'UTC' }));
    expect(screen.getByText('1:05:00 PM')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Other/ }));
    const dlg = screen.getByRole('dialog', { name: 'Pick a time zone' });
    fireEvent.input(within(dlg).getByRole('searchbox'), { target: { value: 'tokyo' } });
    fireEvent.click(within(dlg).getByRole('radio', { name: /Tokyo/ }));
    expect(screen.getByText('10:05:00 PM')).toBeTruthy();
    expect(S.zone.value).toBe('Asia/Tokyo');
  });

  it('switches units from the Options menu, which keeps showing the basemap', () => {
    loadFixtures('central-park-loop.nmea');
    render(<App Map={NoMap} />);
    expect(screen.queryByRole('button', { name: 'Settings' })).toBeNull();
    const options = screen.getByRole('button', { name: /Options/ });
    expect(options.textContent).toContain('OpenStreetMap');
    fireEvent.click(options);
    const menu = screen.getByRole('dialog', { name: 'Options' });
    expect(within(menu).getByRole('heading', { name: 'Basemap' })).toBeTruthy();
    expect(within(menu).getByRole('heading', { name: 'Language' })).toBeTruthy();
    fireEvent.click(within(menu).getByRole('radio', { name: /Imperial/ }));
    expect(screen.getAllByText(/mi$/).length).toBeGreaterThan(0);
    // A second press on the button closes the menu.
    fireEvent.pointerDown(options);
    fireEvent.click(options);
    expect(screen.queryByRole('dialog', { name: 'Options' })).toBeNull();
  });
});
