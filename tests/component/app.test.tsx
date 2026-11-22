// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/preact';
import { App } from '../../src/ui/App';
import * as S from '../../src/state/store';
import { load } from '../helpers/fixtures';

const NoMap = () => <div data-testid="map" />;

function loadFixtures(...names: string[]) {
  S.addLoaded(names.map(load));
}

beforeEach(() => {
  S.resetForTests();
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

  it('switches the whole interface to Chinese', () => {
    render(<App Map={NoMap} />);
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

  it('copies color and halo to the other tracks', () => {
    loadFixtures('central-park-loop.nmea', 'roosevelt-island-run.gpx');
    S.setMeasure('A', 'color', 'ele');
    render(<App Map={NoMap} />);
    fireEvent.click(screen.getByRole('button', { name: 'Use this color and halo for all tracks' }));
    expect(S.items.value[1].color).toBe('ele');
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

  it('links to Google Maps for the current view', () => {
    loadFixtures('central-park-loop.nmea');
    render(<App Map={NoMap} />);
    const link = screen.getByRole('link', { name: /This view/ });
    expect(link.getAttribute('href')).toContain('https://www.google.com/maps/@?api=1&map_action=map');
    expect(link.getAttribute('target')).toBe('_blank');
  });

  it('shows time in a picked zone', () => {
    loadFixtures('central-park-loop.nmea');
    S.cursorT.value = S.items.value[0].track.cols.t[0];
    render(<App Map={NoMap} />);
    fireEvent.click(screen.getByRole('button', { name: 'UTC' }));
    expect(screen.getByText('13:05:00')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Other/ }));
    const dlg = screen.getByRole('dialog', { name: 'Pick a time zone' });
    fireEvent.input(within(dlg).getByRole('searchbox'), { target: { value: 'tokyo' } });
    fireEvent.click(within(dlg).getByRole('radio', { name: /Tokyo/ }));
    expect(screen.getByText('22:05:00')).toBeTruthy();
    expect(S.zone.value).toBe('Asia/Tokyo');
  });

  it('switches units', () => {
    loadFixtures('central-park-loop.nmea');
    render(<App Map={NoMap} />);
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
    fireEvent.click(screen.getByRole('radio', { name: /Imperial/ }));
    expect(screen.getAllByText(/mi$/).length).toBeGreaterThan(0);
  });
});
