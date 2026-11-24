// @vitest-environment happy-dom
// The fix card on the map: where it goes near the timeline, and the motion
// readings it lists for a second with very many of them.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/preact';
import { App } from '../../src/ui/App';
import * as S from '../../src/state/store';
import { tipXY } from '../../src/map/bridge';
import { hint } from '../../src/ui/Computed';
import type { LoadedTrack } from '../../src/model/types';
import { load } from '../helpers/fixtures';

const NoMap = () => <div data-testid="map" />;
const card = () => document.querySelector('.tooltip') as HTMLElement;
const box = (top: number, bottom: number) => ({ left: 0, right: 1200, top, bottom, width: 1200, height: bottom - top, x: 0, y: top, toJSON: () => ({}) }) as DOMRect;

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
  hint.value = null;
  S.showHaloGraph.value = false;
});
afterEach(() => vi.restoreAllMocks());

describe('fix card position', () => {
  it('moves up to stay clear of the timeline near the bottom of the map, and of the window\'s edge without it', () => {
    // A 300 px card, and the timeline's top 560 px down (happy-dom lays nothing out).
    const real = Element.prototype.getBoundingClientRect;
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
      return this.classList.contains('timeline') ? box(560, 750) : real.call(this);
    });
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function (this: HTMLElement) {
      return this.classList.contains('tooltip') ? 300 : 0;
    });
    S.addLoaded([load('central-park-loop.nmea')]);
    S.cursorT.value = S.items.value[0].track.cols.t[100];
    tipXY.value = { x: 400, y: 600 };
    render(<App Map={NoMap} />);
    // Its bottom 10 px above the timeline.
    expect(parseFloat(card().style.top)).toBe(560 - 10 - 300);
    // Higher up the map, a little above its fix as before.
    act(() => { tipXY.value = { x: 400, y: 200 }; });
    expect(parseFloat(card().style.top)).toBe(160);
    // With the timeline minimized: 10 px above the window's bottom edge.
    act(() => { S.timelineMin.value = true; tipXY.value = { x: 400, y: 700 }; });
    expect(document.querySelector('.timeline')).toBeNull();
    expect(parseFloat(card().style.top)).toBe(window.innerHeight - 10 - 300);
  });
});

describe('fix card readings', () => {
  it('lists 50 readings of a crowded second and counts the rest, the median and the strongest being of them all', () => {
    const tr = crowded(5000);
    S.addLoaded([tr]);
    S.cursorT.value = tr.cols.t[60];
    tipXY.value = { x: 600, y: 300 };
    render(<App Map={NoMap} />);
    const spans = [...card().querySelectorAll('.tip-readings span')];
    expect(spans).toHaveLength(51);
    expect(spans[50].textContent).toBe('+4,950 more');
    const median = card().querySelectorAll('.tip-readings .is-median'), peak = card().querySelectorAll('.tip-readings .is-peak');
    expect([median.length, peak.length]).toEqual([1, 1]);
    expect([spans.indexOf(median[0]), spans.indexOf(peak[0])]).toEqual([25, 49]);
    // 0.5 g to 1.5 g in steps of 0.2 mg: the strongest 1.4998 g, the upper middle 1.0 g.
    expect(peak[0].textContent).toBe('1.50');
    expect(median[0].textContent).toBe('1.00');
    fireEvent.mouseEnter(median[0]);
    expect(screen.getByRole('tooltip').textContent).toMatch(/^MedianThe median of this second's 5000 readings \(the upper of the two middle ones\): 1\.00 g$/);
    fireEvent.mouseLeave(median[0]);
    fireEvent.mouseEnter(peak[0]);
    expect(screen.getByRole('tooltip').textContent).toMatch(/^StrongestThe strongest of this second's 5000 readings: 1\.50 g\./);
  });

  it('works out readings only for the card\'s own track: the other tracks\' rows show just speed and HDOP', () => {
    const own = load('central-park-loop-motion.csv');
    const base = load('central-park-loop-motion.csv');
    let reads = 0;
    const other: LoadedTrack = { ...base, file: 'second-logger.csv', motion: { get t() { reads++; return base.motion!.t; }, g: base.motion!.g } };
    S.addLoaded([own, other]);
    S.select('A');
    S.cursorT.value = own.cols.t[60];
    tipXY.value = { x: 600, y: 300 };
    render(<App Map={NoMap} />);
    expect(card().querySelectorAll('.tip-readings span')).toHaveLength(10);
    expect(card().querySelectorAll('.tip-others > div')).toHaveLength(1);
    expect(card().querySelector('.tip-others')!.textContent).toMatch(/km\/h/);
    expect(reads).toBe(0);
  });
});

describe("other tracks' rows", () => {
  it('say a track has no fix near the moment, rather than showing one minutes away', () => {
    // The second ride starts an hour later: at the first ride's fix, it has none near.
    const ride = load('central-park-loop.nmea'), base = load('central-park-loop-vendor.gpx');
    const later: LoadedTrack = { ...base, file: 'later.gpx', cols: { ...base.cols, t: base.cols.t.map((v) => v + 3_600_000) } };
    S.addLoaded([ride, later]);
    S.select('A');
    S.cursorT.value = ride.cols.t[60];
    tipXY.value = { x: 600, y: 300 };
    render(<App Map={NoMap} />);
    expect(card().querySelector('.tip-others')!.textContent).toMatch(/no fix near this time/);
    expect(card().querySelector('.tip-others')!.textContent).not.toMatch(/km\/h/);
  });
});

