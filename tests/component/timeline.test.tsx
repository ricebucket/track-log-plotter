// @vitest-environment happy-dom
// The timeline: the slider's read-out time, the readout and its zone offset,
// ticks across a daylight-saving change, zooming with the scroll wheel and by
// dragging, the lanes' pixel ratio, a press on another day's lane, playback
// after a hidden tab, the keyboard and screen readers' steps across a gap, and
// the timeline with every track hidden.
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
import { nearestIndex } from '../../src/state/logic';
import { fmtClock } from '../../src/time/zones';
import type { LoadedTrack } from '../../src/model/types';
import { load, ROOT } from '../helpers/fixtures';

const NoMap = () => <div data-testid="map" />;
const frame = () => act(() => new Promise<void>((r) => setTimeout(r, 50)));

/** The lane labels' width on a wide screen, and the lanes' box: 1,000 px of lane right of the labels. */
const LW = 150;
const LANES = { left: 0, top: 0, right: 1150, bottom: 120, width: 1150, height: 120, x: 0, y: 0 };
const xAt = (f: number) => LW + f * (LANES.width - LW);

/**
 * Gives the lanes their box (happy-dom lays nothing out), and each track's lane the rows given,
 * top to bottom: [track, top, bottom].
 */
function sizeLanes(rows: [string, number, number][] = []) {
  const real = Element.prototype.getBoundingClientRect;
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    const box = (o: Partial<DOMRect>) => ({ ...LANES, ...o, toJSON: () => o }) as DOMRect;
    if (this.classList.contains('tl-lanes')) return box({});
    const row = this.classList.contains('lane') ? rows.find(([id]) => id === (this as HTMLElement).dataset.track) : undefined;
    return row ? box({ top: row[1], bottom: row[2], height: row[2] - row[1], y: row[1] }) : real.call(this);
  });
}

/** The browser's animation frames, run by hand: run() calls the frames asked for, as if 16 ms from now. */
function animationFrames() {
  const due = new Map<number, FrameRequestCallback>();
  let id = 0;
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => { due.set(++id, cb); return id; });
  vi.stubGlobal('cancelAnimationFrame', (k: number) => { due.delete(k); });
  return {
    run: () => act(() => {
      const fs = [...due.values()];
      due.clear();
      for (const f of fs) f(performance.now() + 16);
    }),
  };
}

/** The cursor line's place across the lanes, 0 to 1, from its style. */
const cursorFrac = () => Number(/\* ([\d.e-]+)\)$/.exec((document.querySelector('.tl-cursor') as HTMLElement).style.left)![1]);

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

  it('brings the cursor into the part picked by dragging, so "Go to the fix" isn\'t offered for it', () => {
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
    expect(screen.queryByRole('button', { name: 'Go to the fix' })).toBeNull();
  });
});

describe('timeline lanes', () => {
  it("puts the cursor where another day's lane is pressed, by mouse or touch, though selecting its track lines the tracks up anew", async () => {
    // A June run, selected, and a January ride: lined up at the run's start, then at the ride's once it's selected.
    const june = load('roosevelt-island-run.gpx');
    const jan = timeShifted(load('central-park-loop.nmea'), -150 * 86_400_000, 'park-in-january.nmea');
    const tj = jan.cols.t;
    for (const [pointerType, f] of [['mouse', 0.5], ['touch', 0.25]] as const) {
      S.resetForTests();
      S.addLoaded([june, jan]);
      S.select('A');
      const { unmount } = render(<App Map={NoMap} />);
      sizeLanes([['A', 0, 66], ['B', 72, 102]]);
      const off = S.offsets.value.B;
      expect(off).toBeGreaterThan(100 * 86_400_000);
      const slider = screen.getByRole('slider');
      const [t0, t1] = [Number(slider.getAttribute('min')), Number(slider.getAttribute('max'))];
      // The ride's own time under the pointer, and its fix nearest to it.
      const pressed = t0 + f * (t1 - t0) - off;
      const fix = tj[nearestIndex(tj, pressed)];
      expect(fix - tj[0]).toBeGreaterThan(5 * 60_000);
      const lanes = document.querySelector('.tl-lanes')!;
      const at = { pointerType, button: 0, buttons: 1, clientX: xAt(f), clientY: 85, pointerId: 1 };
      fireEvent.pointerDown(lanes, at);
      if (pointerType === 'mouse') fireEvent.pointerUp(lanes, { ...at, buttons: 0 });
      await frame();
      expect(S.selected.value!.id, pointerType).toBe('B');
      expect(S.offsets.value.B).toBe(0);
      // On the fix pressed, in the ride's own clock: not its end (the run's later time of day, taken in the ride's clock).
      expect(S.trackTime('B', S.cursorT.value!), pointerType).toBe(fix);
      // And the cursor line stays where the press was.
      expect(cursorFrac()).toBeCloseTo(f, 2);
      unmount();
      vi.restoreAllMocks();
    }
  });

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

  it("crosses a gap with a screen reader's swipes, which move the slider a step at a time", async () => {
    const ride = load('central-park-loop.nmea'), t = ride.cols.t;
    S.addLoaded([ride]);
    render(<App Map={NoMap} />);
    const slider = screen.getByRole('slider') as HTMLInputElement;
    let g = 1;
    for (let i = 2; i < ride.cols.n; i++) if (t[i] - t[i - 1] > t[g] - t[g - 1]) g = i;
    expect(t[g] - t[g - 1]).toBe(46_000);
    act(() => { S.cursorT.value = t[g - 1]; });
    const step = Number(slider.getAttribute('step'));
    expect(step).toBeLessThan(10_000);
    // What VoiceOver and TalkBack do: the slider's value a step on, and an input event.
    const swipe = async (dir: 1 | -1) => {
      fireEvent.input(slider, { target: { value: String(S.cursorT.value! + dir * step) } });
      await frame();
    };
    for (let k = 0; k < 5; k++) await swipe(1);
    // Over the gap at the first, then a fix a swipe.
    expect(S.cursorT.value).toBe(t[g + 4]);
    for (let k = 0; k < 5; k++) await swipe(-1);
    expect(S.cursorT.value).toBe(t[g - 1]);
    // A value further off than a step (a screen reader setting one) goes to the fix nearest to it, as before.
    fireEvent.input(slider, { target: { value: String(t[g - 1] + 40_000) } });
    await frame();
    expect(S.cursorT.value).toBe(t[g]);
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

  it("shows no badge beside it: the hidden track's values aren't shown", () => {
    S.addLoaded([load('central-park-loop.nmea')]);
    render(<App Map={NoMap} />);
    expect(document.querySelector('.tl-head .badge')!.textContent).toBe('A');
    act(() => S.toggleVisible('A'));
    expect(screen.getByText('No track shown')).toBeTruthy();
    expect(document.querySelector('.tl-head .badge')).toBeNull();
  });

  it('stops playing, so the disabled button says Play, and leaves the cursor on the track for when it is shown again', () => {
    const raf = animationFrames();
    S.addLoaded([load('central-park-loop.nmea')]);
    const c = S.items.value[0].track.cols;
    S.cursorT.value = c.t[100];
    render(<App Map={NoMap} />);
    fireEvent.click(screen.getByRole('button', { name: 'Play' }));
    raf.run();
    const at = S.cursorT.value!;
    expect(at).toBeGreaterThan(c.t[100]);
    act(() => S.toggleVisible('A'));
    const play = document.querySelector('.tl-head .round-btn') as HTMLButtonElement;
    expect([play.disabled, play.getAttribute('aria-label')]).toEqual([true, 'Play']);
    for (let k = 0; k < 5; k++) raf.run();
    expect(S.cursorT.value).toBe(at);
    act(() => S.toggleVisible('A'));
    expect((screen.getByRole('button', { name: 'Play' }) as HTMLButtonElement).disabled).toBe(false);
    expect(S.cursorT.value).toBe(at);
  });

  it('takes no pointer or wheel input on the empty lanes, so a track shown again has its cursor where it was', async () => {
    S.addLoaded([load('central-park-loop.nmea')]);
    S.zone.value = 'America/New_York';
    render(<App Map={NoMap} />);
    sizeLanes();
    const tr = S.items.value[0].track;
    const at = tr.cols.t[300];
    act(() => { S.cursorT.value = at; });
    act(() => S.toggleVisible('A'));
    const lanes = document.querySelector('.tl-lanes')!;
    // Hovering, clicking, dragging across, a touch and the scroll wheel.
    fireEvent.pointerMove(lanes, { pointerType: 'mouse', clientX: xAt(0.5), clientY: 20 });
    fireEvent.pointerDown(lanes, { pointerType: 'mouse', button: 0, buttons: 1, clientX: xAt(0.3), clientY: 20, pointerId: 1 });
    fireEvent.pointerUp(lanes, { pointerType: 'mouse', button: 0, clientX: xAt(0.3), clientY: 20, pointerId: 1 });
    fireEvent.pointerDown(lanes, { pointerType: 'mouse', button: 0, buttons: 1, clientX: xAt(0.2), clientY: 20, pointerId: 1 });
    fireEvent.pointerMove(lanes, { pointerType: 'mouse', buttons: 1, clientX: xAt(0.9), clientY: 20, pointerId: 1 });
    fireEvent.pointerUp(lanes, { pointerType: 'mouse', button: 0, clientX: xAt(0.9), clientY: 20, pointerId: 1 });
    fireEvent.pointerDown(lanes, { pointerType: 'touch', buttons: 1, clientX: xAt(0.7), clientY: 20, pointerId: 2 });
    fireEvent.pointerMove(lanes, { pointerType: 'touch', buttons: 1, clientX: xAt(0.8), clientY: 20, pointerId: 2 });
    wheel(lanes, -300, xAt(0.5));
    await frame();
    expect(S.cursorT.value).toBe(at);
    expect(S.timelineView.value).toBeNull();
    expect(document.querySelector('.tl-band')).toBeNull();
    act(() => S.toggleVisible('A'));
    await frame();
    // Its time in the header (not midnight in 1970), and its line on the lanes.
    expect(document.querySelector('.tl-time')!.textContent).toBe(fmtClock(at, 'America/New_York', 'en-US'));
    expect(cursorFrac()).toBeCloseTo((at - tr.derived.stats.start) / (tr.derived.stats.end - tr.derived.stats.start), 3);
  });
});

