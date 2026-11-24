// @vitest-environment happy-dom
// The timeline's header picks its compact form (icon buttons, one zone
// button, no readout) by its own width, not the window's: beside the panel, a
// window a little wider than a phone's leaves the timeline about as narrow.
// And the notices, which in such a window go below the map buttons.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/preact';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { App } from '../../src/ui/App';
import * as S from '../../src/state/store';
import { load, ROOT } from '../helpers/fixtures';

const NoMap = () => <div data-testid="map" />;
const head = () => document.querySelector('.tl-head') as HTMLElement;

/** The header's width, which ResizeObserver reports when the test says so (happy-dom lays nothing out). */
let headW = 0;
let observed: (() => void)[] = [];

beforeEach(() => {
  S.resetForTests();
  observed = [];
  vi.stubGlobal('ResizeObserver', class {
    constructor(private cb: () => void) {}
    observe() { observed.push(() => this.cb()); }
    unobserve() {}
    disconnect() {}
  });
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(function (this: HTMLElement) {
    return this.classList.contains('tl-head') ? headW : 0;
  });
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

/** Opens the ride with the header `w` px wide. */
function openWith(w: number) {
  headW = w;
  S.addLoaded([load('central-park-loop.nmea')]);
  render(<App Map={NoMap} />);
}

function resize(w: number) {
  headW = w;
  act(() => { for (const f of observed) f(); });
}

const isFull = () => !!screen.queryByRole('button', { name: 'UTC' }) && !!head().querySelector('.tl-values');
const isCompact = () => !!screen.queryByRole('button', { name: 'Time zone: Local' }) && !head().querySelector('.tl-values');

describe('the timeline header', () => {
  it('closes its gaps up further in the least room, so its buttons fit (283 px beside the panel in a 721 px window)', () => {
    openWith(283);
    expect(head().classList.contains('is-tight')).toBe(true);
    expect(head().classList.contains('is-tightest')).toBe(true);
    resize(330);
    expect(head().classList.contains('is-tightest')).toBe(false);
    const css = readFileSync(join(ROOT, 'src', 'styles.css'), 'utf8');
    expect(css).toMatch(/\.tl-head\.is-tight\.is-tightest\s*\{\s*gap:\s*4px/);
  });

  it('turns compact where the full header turns out not to fit (a wider font than expected), and measures afresh with more room', () => {
    // The full header would need 700 px here, more than its 640 px of room, though the estimates say it fits.
    let needs = 700;
    vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockImplementation(function (this: HTMLElement) {
      return this.classList.contains('tl-head') ? (head().querySelector('.tl-values') ? needs : headW) : 0;
    });
    openWith(640);
    expect(isCompact()).toBe(true);
    // A wider window where it fits: full again.
    needs = 700;
    resize(760);
    expect(isFull()).toBe(true);
  });

  it('is full with room for it: the readout, Fit with its label, Local, UTC and Other', () => {
    openWith(842); // a 1280 px window
    expect(isFull()).toBe(true);
    expect(screen.getByRole('button', { name: 'Fit the tracks' }).textContent).toBe('Fit');
    expect(head().classList.contains('is-tight')).toBe(false);
  });

  it('turns compact when the panel leaves it too little room (a 900 px window), and back when it has room again', () => {
    openWith(842);
    resize(462);
    expect(isCompact()).toBe(true);
    expect(screen.queryByRole('button', { name: 'UTC' })).toBeNull();
    // Fit is an icon, named by its label.
    expect(screen.getByRole('button', { name: 'Fit the tracks' }).textContent).toBe('');
    // Still room for the zone's offset and the zone's name.
    expect(head().classList.contains('is-tight')).toBe(false);
    expect(head().querySelector('.zone-btn-name')?.textContent).toBe('Local');
    resize(842);
    expect(isFull()).toBe(true);
  });

  it('counts the buttons that come and go: zoomed in, Reset zoom needs room too', () => {
    openWith(620);
    expect(isFull()).toBe(true);
    const t = S.items.value[0].track.cols.t;
    act(() => { S.timelineView.value = [t[0], t[Math.floor(t.length / 4)]]; });
    expect(isCompact()).toBe(true);
    act(() => { S.timelineView.value = null; });
    expect(isFull()).toBe(true);
  });

  it('closes up, without the offset and the zone name, in the narrowest pane (a 721 px window)', () => {
    openWith(283);
    expect(isCompact()).toBe(true);
    expect(head().classList.contains('is-tight')).toBe(true);
    expect(head().querySelector('.zone-btn-name')).toBeNull();
    const css = readFileSync(join(ROOT, 'src', 'styles.css'), 'utf8');
    expect(css).toMatch(/\.tl-head\.is-tight \.tl-offset \{ display: none; \}/);
    expect(css).toMatch(/\.tl-head\.is-tight \.tl-time \{ font-size: 14px; \}/);
    // Short of room all the same (a wide fallback font), the zone button gives way rather than push the header out.
    expect(css).toMatch(/\n\.zone-btn \{ flex: 0 1 auto; min-width: 46px;/);
  });

  it('keeps the full header until the header is measured', () => {
    openWith(0);
    expect(isFull()).toBe(true);
  });
});

describe('the notices', () => {
  it('go below the map buttons, from the panel to the right edge, in a window too narrow for them beside the buttons', () => {
    const css = readFileSync(join(ROOT, 'src', 'styles.css'), 'utf8');
    const mid = css.match(/@media \(min-width: 721px\) and \(max-width: 1180px\) \{([\s\S]*?)\n\}/);
    expect(mid).not.toBeNull();
    const rule = mid![1].match(/\.app:not\(\.panel-min\) \.toasts \{([^}]*)\}/)?.[1] ?? '';
    expect(rule).toContain('left: var(--pane-left)');
    expect(rule).toContain('right: 16px');
    expect(rule).toMatch(/top: calc\(16px \+ var\(--tools-h\) \+ 12px\)/);
    // Below Fit and the compass too, when the buttons' column has them.
    expect(mid![1]).toContain('.map-tools:has(.has-fit) ~ .toasts');
    expect(mid![1]).toContain('.map-tools:has(.has-fit.has-compass) ~ .toasts');
  });
});
