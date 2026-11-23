// @vitest-environment happy-dom
// Hover text shown by the app itself, after a short pause, instead of the
// browser's own after about a second.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render } from '@testing-library/preact';
import { TipLayer, TIP_DELAY_MS, tip } from '../../src/ui/TipLayer';

beforeEach(() => vi.useFakeTimers());
afterEach(() => { vi.useRealTimers(); tip.value = null; });

const bubble = () => document.querySelector('.tip-bubble')?.textContent ?? null;
const hover = (el: Element) => fireEvent.pointerOver(el, { pointerType: 'mouse' });

describe('hover text', () => {
  it('shows an element\'s title in a bubble after a short pause, and takes it from the browser', () => {
    const { container } = render(<div><TipLayer /><button type="button" title="Hide all tracks" aria-label="Hide all tracks">x</button></div>);
    const b = container.querySelector('button')!;
    hover(b);
    // The browser has nothing to show: the title moved to data-tip at once.
    expect(b.hasAttribute('title')).toBe(false);
    expect(b.getAttribute('data-tip')).toBe('Hide all tracks');
    act(() => { vi.advanceTimersByTime(TIP_DELAY_MS - 50); });
    expect(bubble()).toBeNull();
    act(() => { vi.advanceTimersByTime(60); });
    expect(bubble()).toBe('Hide all tracks');
    fireEvent.pointerOut(b, { pointerType: 'mouse', relatedTarget: null });
    expect(bubble()).toBeNull();
  });

  it('shows the next one at once while moving from element to element', () => {
    const { container } = render(<div><TipLayer /><span title="One">1</span><span title="Two">2</span></div>);
    const [a, b] = container.querySelectorAll('span');
    hover(a);
    act(() => { vi.advanceTimersByTime(TIP_DELAY_MS + 10); });
    expect(bubble()).toBe('One');
    hover(b);
    act(() => { vi.advanceTimersByTime(1); });
    expect(bubble()).toBe('Two');
  });

  it('keeps the text for assistive tech: as the label of an element with none, else as its description', () => {
    const { container } = render(<div><TipLayer /><span class="icon" title="Zoom in" /><span class="text" title="The distance is worked out from the fixes">5 km</span></div>);
    const [b, s] = [container.querySelector('.icon')!, container.querySelector('.text')!];
    hover(b);
    hover(s);
    expect(b.getAttribute('aria-label')).toBe('Zoom in');
    expect(s.getAttribute('aria-description')).toBe('The distance is worked out from the fixes');
  });

  it('shows text set while the pointer rests (a cut-off name), ignores touch, and hides on a press or a key', () => {
    const { container } = render(<div><TipLayer /><span class="name">a-very-long-file-name.gpx</span></div>);
    const name = container.querySelector('.name')!;
    hover(name);
    name.setAttribute('data-tip', 'a-very-long-file-name.gpx');
    act(() => { vi.advanceTimersByTime(TIP_DELAY_MS + 10); });
    expect(bubble()).toBe('a-very-long-file-name.gpx');
    fireEvent.pointerDown(name);
    expect(bubble()).toBeNull();
    fireEvent.pointerOver(container.firstElementChild!, { pointerType: 'touch' });
    act(() => { vi.advanceTimersByTime(TIP_DELAY_MS + 10); });
    expect(bubble()).toBeNull();
    hover(name.parentElement!);
    hover(name);
    act(() => { vi.advanceTimersByTime(TIP_DELAY_MS + 10); });
    expect(bubble()).toBe('a-very-long-file-name.gpx');
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(bubble()).toBeNull();
  });
});
