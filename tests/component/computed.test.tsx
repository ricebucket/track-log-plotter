// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/preact';
import { App } from '../../src/ui/App';
import * as S from '../../src/state/store';
import { parseText } from '../../src/parse/index';
import { load } from '../helpers/fixtures';

const NoMap = () => <div data-testid="map" />;
const computedButtons = (root: HTMLElement = document.body) =>
  within(root).queryAllByRole('button', { name: /^Computed by the app:/ });

/** A GPX track with elevation but no speed, heading north through Central Park. */
function noSpeedTrack() {
  const start = Date.UTC(2026, 5, 14, 13, 0, 0);
  const pts = Array.from({ length: 300 }, (_, i) =>
    `<trkpt lat="${(40.775 + (i * 4) / 111_195).toFixed(7)}" lon="-73.9690000"><ele>${(10 + i * 0.1).toFixed(1)}</ele><time>${new Date(start + i * 1000).toISOString()}</time></trkpt>`);
  const r = parseText(`<?xml version="1.0"?><gpx version="1.1" creator="Test"><trk><trkseg>${pts.join('')}</trkseg></trk></gpx>`, 'no-speed.gpx');
  if (!r.ok) throw new Error(r.error);
  return r.track;
}

beforeEach(() => {
  S.resetForTests();
});

describe('computed values', () => {
  it('explains the computed stats on the track row', () => {
    S.addLoaded([load('central-park-loop.nmea')]);
    render(<App Map={NoMap} />);
    const stats = document.querySelector('.stats') as HTMLElement;
    const buttons = computedButtons(stats);
    expect(buttons).toHaveLength(3);
    expect(buttons[0].getAttribute('aria-label')).toContain('straight-line distances between consecutive fixes');
    fireEvent.mouseEnter(buttons[1]);
    expect(screen.getByRole('tooltip').textContent).toContain('moving faster than 1.5 km/h');
    fireEvent.mouseLeave(buttons[1]);
    expect(screen.queryByRole('tooltip')).toBeNull();
  });

  it('pins an explanation on tap and closes it on a press elsewhere', () => {
    S.addLoaded([load('central-park-loop.nmea')]);
    render(<App Map={NoMap} />);
    const btn = computedButtons(document.querySelector('.stats') as HTMLElement)[0];
    fireEvent.click(btn);
    expect(screen.getByRole('tooltip')).toBeTruthy();
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole('tooltip')).toBeNull();
  });

  it('marks every computed row on the properties page, and only those', () => {
    S.addLoaded([load('central-park-loop.nmea')]);
    render(<App Map={NoMap} />);
    fireEvent.click(screen.getByRole('button', { name: /^Properties/ }));
    const kv = document.querySelector('.kv') as HTMLElement;
    const labels = [...kv.querySelectorAll('dt')].map((dt) => ({ name: dt.firstChild?.textContent, computed: !!dt.querySelector('.computed-btn') }));
    expect(labels.find((l) => l.name === 'Date')!.computed).toBe(false);
    expect(labels.find((l) => l.name === 'Time')!.computed).toBe(false);
    for (const name of ['Duration', 'Moving time', 'Distance', 'Avg speed', 'Top speed', 'Climb', 'Elevation', 'Fixes', 'Median HDOP', 'Median satellites', 'Corrected fixes']) {
      expect(labels.find((l) => l.name === name), name).toMatchObject({ computed: true });
    }
    const climb = computedButtons(kv).find((b) => b.getAttribute('aria-label')!.includes('uphill'))!;
    expect(climb.getAttribute('aria-label')).toContain('averaged over 30 seconds');
  });

  it('says when speed is worked out from positions', () => {
    S.addLoaded([noSpeedTrack()]);
    render(<App Map={NoMap} />);
    const legend = document.querySelector('.legend') as HTMLElement;
    const why = computedButtons(legend).map((b) => b.getAttribute('aria-label')).join(' ');
    expect(why).toContain('This file has no speed');
    expect(why).toContain('share of the track');
    fireEvent.click(screen.getByRole('button', { name: /^Color/ }));
    const pane = screen.getByRole('dialog', { name: 'Color track A by' });
    const radios = within(pane).getAllByRole('radio');
    expect(within(radios[0]).getByText('Computed')).toBeTruthy(); // speed
    expect(within(radios[2]).getByText('Computed')).toBeTruthy(); // grade
    expect(within(radios[1]).queryByText('Computed')).toBeNull(); // elevation is in the file
  });

  it('explains grade wherever it is shown', () => {
    S.addLoaded([load('central-park-loop.nmea')]);
    S.setMeasure('A', 'color', 'grade');
    render(<App Map={NoMap} />);
    const legendWhy = computedButtons(document.querySelector('.legend') as HTMLElement)[0];
    expect(legendWhy.getAttribute('aria-label')).toContain('change in height over about 120 m');
    const lane = document.querySelector('.lane-label') as HTMLElement;
    expect(computedButtons(lane)).toHaveLength(1);
  });

  it('quotes the units in use', () => {
    S.addLoaded([load('central-park-loop.nmea')]);
    S.units.value = 'imperial';
    render(<App Map={NoMap} />);
    const moving = computedButtons(document.querySelector('.stats') as HTMLElement)[1];
    expect(moving.getAttribute('aria-label')).toContain('0.9 mph');
  });
});
