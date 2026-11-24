// @vitest-environment happy-dom
// Interface text built from parts: distances in the units in use, each
// language's own colon between a label and its text, and the fix card's
// count of the readings it leaves out.
import { beforeEach, describe, expect, it } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/preact';
import { App } from '../../src/ui/App';
import * as S from '../../src/state/store';
import { tipXY } from '../../src/map/bridge';
import { parseText } from '../../src/parse/index';
import type { LoadedTrack } from '../../src/model/types';
import { load } from '../helpers/fixtures';

const NoMap = () => <div data-testid="map" />;

/** A walk north through Central Park, a fix a second, `eastM` metres east of the path. */
function walk(file: string, eastM = 0, seconds = 300): LoadedTrack {
  const t0 = Date.UTC(2026, 5, 14, 13, 0, 0);
  const pts = Array.from({ length: seconds }, (_, i) =>
    `<trkpt lat="${(40.775 + (i * 1.5) / 111_195).toFixed(7)}" lon="${(-73.969 + eastM / 84_300).toFixed(7)}"><ele>20</ele><time>${new Date(t0 + i * 1000).toISOString()}</time><hdop>1.2</hdop><sat>8</sat></trkpt>`);
  const r = parseText(`<?xml version="1.0"?><gpx version="1.1" creator="Test"><trk><trkseg>${pts.join('')}</trkseg></trk></gpx>`, file);
  if (!r.ok) throw new Error(r.error);
  return r.track;
}

/** The motion log with `count` readings crammed into fix i's second instead of its ten. */
function crowded(count: number, i = 60): LoadedTrack {
  const base = load('central-park-loop-motion.csv');
  const m = base.motion!, c = base.cols;
  const lo = m.t.findIndex((t) => t >= c.t[i]), hi = m.t.findIndex((t) => t >= c.t[i + 1]);
  const t = Float64Array.from({ length: count }, (_, k) => c.t[i] + (k * (c.t[i + 1] - c.t[i])) / count);
  const g = Float32Array.from({ length: count }, (_, k) => 0.5 + ((k * 7919) % count) / count);
  return { ...base, motion: { t: Float64Array.from([...m.t.subarray(0, lo), ...t, ...m.t.subarray(hi)]), g: Float32Array.from([...m.g.subarray(0, lo), ...g, ...m.g.subarray(hi)]) } };
}

beforeEach(() => {
  S.resetForTests();
  tipXY.value = null;
});

describe('distances in the text', () => {
  it("give grade's distance in the settings sheet in the units in use", () => {
    S.addLoaded([load('central-park-loop.nmea')]);
    S.units.value = 'imperial';
    render(<App Map={NoMap} />);
    fireEvent.click(screen.getByRole('button', { name: /^Color/ }));
    const sheet = screen.getByRole('dialog', { name: 'Color, halo and timeline' });
    expect(within(sheet).getByText(/^How steep/).textContent).toBe('How steep the track is, uphill or downhill: the change in elevation over about 394 ft of track, as a percentage.');
    act(() => { S.lang.value = 'zh'; });
    expect(within(sheet).getByText(/^轨迹的陡度/).textContent).toBe('轨迹的陡度（上坡或下坡）：约 394 英尺轨迹范围内的海拔变化，以百分比表示。');
  });

  it('say how far apart logs that may not be one trip are, in the units in use', () => {
    S.addLoaded([walk('east.gpx'), walk('west.gpx', 250, 299)]);
    S.units.value = 'imperial';
    render(<App Map={NoMap} />);
    act(() => { S.startSelect(); S.toggleTick('A'); S.toggleTick('B'); S.combineTicked(); });
    const toast = () => document.querySelector('.toast[data-combo="apart"]')!.textContent!;
    expect(toast()).toContain('they are over 328 ft apart for most of the time they share');
    act(() => { S.units.value = 'metric'; });
    expect(toast()).toContain('they are over 100 m apart for most of the time they share');
  });
});

describe("a label and its text, joined with the language's colon", () => {
  it('in a track row, a calculator and a tick box', () => {
    S.addLoaded([load('central-park-loop.nmea'), load('roosevelt-island-run.gpx')]);
    S.lang.value = 'zh';
    render(<App Map={NoMap} />);
    const row = document.querySelector('.track-row[data-track="A"]')!;
    expect(row.querySelector('.track-sub')!.getAttribute('title')).toMatch(/^距离：把相邻定位点/);
    expect(row.querySelector('.stats .computed-btn')!.getAttribute('aria-label')).toMatch(/^由应用计算：把相邻定位点/);
    fireEvent.click(screen.getByRole('button', { name: '选择' }));
    expect(screen.getByRole('checkbox', { name: '选择轨迹 B：roosevelt-island-run.gpx' })).toBeTruthy();
  });
});

describe("the fix card's readings of a crowded second", () => {
  it('say how many it lists out of how many, and count the rest, in each language', () => {
    const tr = crowded(5000);
    S.addLoaded([tr]);
    S.cursorT.value = tr.cols.t[60];
    tipXY.value = { x: 600, y: 300 };
    render(<App Map={NoMap} />);
    const readings = () => document.querySelector('.tooltip .tip-readings') as HTMLElement;
    const named = () => readings().parentElement!.querySelector('dt')!.textContent;
    expect(readings().querySelector('.tip-more')!.textContent).toBe('+4,950 more');
    expect(named()).toBe('50 of the 5,000 readings in this second, from the lowest to the strongest, with the median and the strongest of them all highlighted');
    expect(named()).not.toMatch(/^All/);
    act(() => { S.lang.value = 'zh'; });
    expect(readings().querySelector('.tip-more')!.textContent).toBe('另有 4,950 次');
    expect(named()).toBe('这一秒内 5,000 次读数中的 50 次，从最低到最大，已标出全部读数的中位数和最大值');
  });

  it('say "All" when every reading is listed', () => {
    const tr = load('central-park-loop-motion.csv');
    S.addLoaded([tr]);
    S.cursorT.value = tr.cols.t[60];
    tipXY.value = { x: 600, y: 300 };
    render(<App Map={NoMap} />);
    const readings = document.querySelector('.tooltip .tip-readings') as HTMLElement;
    expect(readings.querySelector('.tip-more')).toBeNull();
    expect(readings.parentElement!.querySelector('dt')!.textContent).toBe('All 10 readings in this second, lowest first, with the median and the strongest highlighted');
  });
});
