// @vitest-environment happy-dom
// The timeline: the slider's read-out time, the readout and its zone offset,
// ticks across a daylight-saving change, zooming with the scroll wheel and by
// dragging, the lanes' pixel ratio, and playback after a hidden tab.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/preact';
import { effect } from '@preact/signals';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { App } from '../../src/ui/App';
import * as S from '../../src/state/store';
import { tipXY } from '../../src/map/bridge';
import { hint } from '../../src/ui/Computed';
import { derive } from '../../src/derive/derive';
import { parseText } from '../../src/parse/index';
import { wheelZoom } from '../../src/ui/timelineMath';
import type { LoadedTrack } from '../../src/model/types';
import { load, ROOT } from '../helpers/fixtures';

const NoMap = () => <div data-testid="map" />;
const frame = () => act(() => new Promise<void>((r) => setTimeout(r, 50)));

/** The lane labels' width on a wide screen, and the lanes' box: 1,000 px of lane right of the labels. */
const LW = 150;
const LANES = { left: 0, top: 0, right: 1150, bottom: 120, width: 1150, height: 120, x: 0, y: 0 };
const xAt = (f: number) => LW + f * (LANES.width - LW);

/** Gives the lanes their box (happy-dom lays nothing out). */
function sizeLanes() {
  const real = Element.prototype.getBoundingClientRect;
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    return this.classList.contains('tl-lanes') ? ({ ...LANES, toJSON: () => LANES } as DOMRect) : real.call(this);
  });
}

/** Turns the scroll wheel over an element (happy-dom's wheel events have no pointer position of their own). */
function wheel(el: Element, deltaY: number, clientX: number) {
  const e = new WheelEvent('wheel', { deltaY, bubbles: true, cancelable: true });
  Object.defineProperties(e, { clientX: { value: clientX }, clientY: { value: 20 } });
  fireEvent(el, e);
}

/** A track moved in time, as if recorded on another day. */
function timeShifted(tr: LoadedTrack, dMs: number, file: string): LoadedTrack {
  const parsed = { ...tr, file, cols: { ...tr.cols, t: tr.cols.t.map((v) => v + dMs) }, flags: tr.flags.map((f) => ({ ...f, t: f.t + dMs })) };
  return { ...parsed, derived: derive(parsed) };
}

/** Slow loops of Central Park from midnight October 31 to midnight November 4, 2026, New York time: a fix every 10 minutes. */
function fourDays(): LoadedTrack {
  const t0 = Date.parse('2026-10-31T04:00:00Z');
  const pts = Array.from({ length: 97 * 6 + 1 }, (_, i) => {
    const a = (i / 60) * Math.PI;
    return `<trkpt lat="${(40.7812 + 0.004 * Math.sin(a)).toFixed(6)}" lon="${(-73.9665 + 0.005 * Math.cos(a)).toFixed(6)}"><time>${new Date(t0 + i * 600_000).toISOString()}</time></trkpt>`;
  });
  const r = parseText(`<?xml version="1.0"?><gpx version="1.1" creator="Test"><trk><trkseg>${pts.join('')}</trkseg></trk></gpx>`, 'four-days.gpx');
  if (!r.ok) throw new Error(r.error);
  return r.track;
}

/** A 2D context that draws nothing (happy-dom has none). */
function fakeContext(): CanvasRenderingContext2D {
  const set: Record<string | symbol, unknown> = {};
  return new Proxy(set, { get: (t, k) => (k in t ? t[k] : () => {}), set: (t, k, v) => { t[k] = v; return true; } }) as unknown as CanvasRenderingContext2D;
}

const dprDescriptor = Object.getOwnPropertyDescriptor(window, 'devicePixelRatio');

beforeEach(() => {
  S.resetForTests();
  tipXY.value = null;
  hint.value = null;
  S.showHaloGraph.value = false;
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  if (dprDescriptor) Object.defineProperty(window, 'devicePixelRatio', dprDescriptor);
  else delete (window as { devicePixelRatio?: number }).devicePixelRatio;
});

describe('timeline slider and readout', () => {
  it('reads the slider out as the time the readout shows, and keeps the readout quiet during playback', () => {
    S.addLoaded([load('central-park-loop.nmea')]);
    S.zone.value = 'America/New_York';
    S.cursorT.value = S.items.value[0].track.cols.t[0];
    render(<App Map={NoMap} />);
    const slider = screen.getByRole('slider', { name: 'Position on the timeline' });
    const time = document.querySelector('.tl-time')!;
    expect(slider.getAttribute('aria-valuetext')).toMatch(/^9:05:00\sAM$/);
    expect(slider.getAttribute('aria-valuetext')).toBe(time.textContent);
    expect(time.getAttribute('aria-live')).toBe('polite');
    fireEvent.click(screen.getByRole('button', { name: 'Play' }));
    expect(time.getAttribute('aria-live')).toBe('off');
    fireEvent.click(screen.getByRole('button', { name: 'Pause' }));
    expect(time.getAttribute('aria-live')).toBe('polite');
  });

  it('shows the hidden slider\'s keyboard focus around the lanes', () => {
    const css = readFileSync(join(ROOT, 'src', 'styles.css'), 'utf8');
    expect(css).toMatch(/\.tl-lanes:has\(input:focus-visible\)\s*\{[^}]*outline:/);
  });

  it('labels the zone offset of the time shown: a track lined up at its start shows its own season\'s', () => {
    const june = load('roosevelt-island-run.gpx');
    const jan = timeShifted(load('central-park-loop.nmea'), -150 * 86_400_000, 'park-in-january.nmea');
    S.addLoaded([june, jan]);
    S.zone.value = 'America/New_York';
    S.select('A');
    render(<App Map={NoMap} />);
    const off = S.offsets.value.B;
    expect(off).toBeGreaterThan(100 * 86_400_000);
    act(() => { S.laneTrack.value = 'B'; S.cursorT.value = jan.cols.t[200] + off; });
    expect(document.querySelector('.tl-head .badge')!.textContent).toBe('B');
    // The January fix's time, in winter time; the timeline's own time is in June.
    expect(document.querySelector('.tl-time')!.textContent).toMatch(/^8:08:20\sAM$/);
    expect(document.querySelector('.tl-offset')!.textContent).toBe('UTC−5');
  });

  it('keeps the ticks on noon and midnight across a daylight-saving change', () => {
    vi.stubGlobal('ResizeObserver', undefined); // the ticks keep their 800 px
    S.addLoaded([fourDays()]);
    S.zone.value = 'America/New_York';
    render(<App Map={NoMap} />);
    const labels = [...document.querySelectorAll('.tl-ticks span')].map((s) => `${s.classList.contains('tick-date') ? 'date ' : ''}${s.textContent!.replace(/\s/g, ' ')}`);
    expect(labels).toEqual(['date Oct 31', '12:00 PM', 'date Nov 1', '12:00 PM', 'date Nov 2', '12:00 PM', 'date Nov 3', '12:00 PM', 'date Nov 4']);
  });
});

describe('zooming the timeline', () => {
  it('zooms with the scroll wheel once a frame, however fast the wheel turns', async () => {
    S.addLoaded([load('central-park-loop.nmea')]);
    render(<App Map={NoMap} />);
    sizeLanes();
    const tr = S.items.value[0].track;
    const full: [number, number] = [tr.derived.stats.start, tr.derived.stats.end];
    let changes = 0;
    const stop = effect(() => { void S.timelineView.value; changes++; });
    changes = 0;
    const lanes = document.querySelector('.tl-lanes')!;
    for (let k = 0; k < 3; k++) wheel(lanes, -100, xAt(0.5));
    // Nothing yet: the view changes on the next frame, once, by all three notches.
    expect(changes).toBe(0);
    await frame();
    expect(changes).toBe(1);
    let want: [number, number] = full;
    for (let k = 0; k < 3; k++) want = wheelZoom(want, full, 0.5, -100)!;
    expect(S.timelineView.value).toEqual(want);
    stop();
  });

  it('brings the cursor into the part picked by dragging, so "Show the cursor" isn\'t offered for it', () => {
    S.addLoaded([load('central-park-loop-vendor.gpx')]); // a fix every 5 s
    render(<App Map={NoMap} />);
    sizeLanes();
    const tr = S.items.value[0].track, c = tr.cols;
    const [t0, t1] = [tr.derived.stats.start, tr.derived.stats.end];
    const x0 = xAt(0.4), x1 = xAt(0.45);
    const from = t0 + 0.4 * (t1 - t0);
    // Where the drag begins, the cursor sits on the fix nearest the pointer: here the one just before.
    const before = c.t[c.t.findIndex((t) => t > from) - 1];
    expect(before).toBeLessThan(from);
    act(() => { S.cursorT.value = before; });
    const lanes = document.querySelector('.tl-lanes')!;
    fireEvent.pointerDown(lanes, { pointerType: 'mouse', button: 0, buttons: 1, clientX: x0, clientY: 20, pointerId: 1 });
    fireEvent.pointerMove(lanes, { pointerType: 'mouse', buttons: 1, clientX: x1, clientY: 20, pointerId: 1 });
    fireEvent.pointerUp(lanes, { pointerType: 'mouse', button: 0, clientX: x1, clientY: 20, pointerId: 1 });
    const view = S.timelineView.value!;
    expect(view[0]).toBeCloseTo(from, 0);
    // On the first fix inside the part picked.
    expect(S.cursorT.value).toBe(c.t[c.t.findIndex((t) => t >= view[0])]);
    expect(S.cursorT.value!).toBeLessThanOrEqual(view[1]);
    expect(screen.queryByRole('button', { name: 'Show the cursor' })).toBeNull();
  });
});

describe('timeline lanes', () => {
  it('redraws the lanes for a new pixel ratio, when the browser zooms or the window moves to another screen', () => {
    const changed: (() => void)[] = [];
    vi.spyOn(window, 'matchMedia').mockImplementation((q: string) => ({
      matches: false, media: q, onchange: null,
      addEventListener: (_: string, fn: () => void) => { if (q.includes('resolution')) changed.push(fn); },
      removeEventListener: () => {}, addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false,
    }) as unknown as MediaQueryList);
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation((() => fakeContext()) as never);
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(600);
    S.addLoaded([load('central-park-loop.nmea')]);
    render(<App Map={NoMap} />);
    const canvas = document.querySelector('.lane[data-track="A"] canvas') as HTMLCanvasElement;
    expect(canvas.width).toBe(600);
    Object.defineProperty(window, 'devicePixelRatio', { value: 2, configurable: true });
    act(() => { for (const fn of changed.splice(0)) fn(); });
    expect(canvas.width).toBe(1200);
  });
});

describe('playback', () => {
  it('goes on from where it was after the tab was hidden, instead of leaping ahead', () => {
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => frames.push(cb));
    vi.stubGlobal('cancelAnimationFrame', () => {});
    S.addLoaded([load('central-park-loop.nmea')]);
    const c = S.items.value[0].track.cols;
    S.cursorT.value = c.t[100];
    render(<App Map={NoMap} />);
    fireEvent.click(screen.getByRole('button', { name: 'Play' }));
    // The next frame comes a minute later: the tab was hidden meanwhile.
    act(() => { for (const f of frames.splice(0)) f(performance.now() + 60_000); });
    // One frame's worth (a tenth of a second at sixty times real time), not a minute's, which loops to the start.
    expect(S.cursorT.value).toBe(c.t[100] + 6000);
  });
});

describe('the keyboard on the timeline', () => {
  it('steps from fix to fix of the shown tracks, crossing a gap in one press; Page keys a minute; Home and End', async () => {
    const ride = load('central-park-loop.nmea'), t = ride.cols.t;
    S.addLoaded([ride]);
    render(<App Map={NoMap} />);
    const slider = screen.getByRole('slider');
    // The ride's longest step between fixes: a gap.
    let g = 1;
    for (let i = 2; i < ride.cols.n; i++) if (t[i] - t[i - 1] > t[g] - t[g - 1]) g = i;
    expect(t[g] - t[g - 1]).toBeGreaterThan(20_000);
    act(() => { S.cursorT.value = t[g - 1]; });
    fireEvent.keyDown(slider, { key: 'ArrowRight' });
    await frame();
    expect(S.cursorT.value).toBe(t[g]);
    fireEvent.keyDown(slider, { key: 'ArrowLeft' });
    await frame();
    expect(S.cursorT.value).toBe(t[g - 1]);
    act(() => { S.cursorT.value = t[0]; });
    fireEvent.keyDown(slider, { key: 'PageUp' });
    await frame();
    expect(S.cursorT.value).toBe(t[t.findIndex((v) => v >= t[0] + 60_000)]);
    fireEvent.keyDown(slider, { key: 'End' });
    await frame();
    expect(S.cursorT.value).toBe(t[ride.cols.n - 1]);
    fireEvent.keyDown(slider, { key: 'Home' });
    await frame();
    expect(S.cursorT.value).toBe(t[0]);
  });
});

describe('the timeline with every track hidden', () => {
  it('says no track is shown, in place of a time from 1970, with no ticks and no playing', () => {
    S.addLoaded([load('central-park-loop.nmea')]);
    render(<App Map={NoMap} />);
    expect(document.querySelectorAll('.tl-ticks span').length).toBeGreaterThan(0);
    act(() => S.toggleVisible('A'));
    expect(screen.getByText('No track shown')).toBeTruthy();
    expect(document.querySelector('.tl-time')).toBeNull();
    expect(document.querySelectorAll('.tl-ticks span')).toHaveLength(0);
    expect((screen.getByRole('button', { name: 'Play' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByRole('slider')).toBeNull();
  });
});

