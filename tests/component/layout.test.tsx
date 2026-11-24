// @vitest-environment happy-dom
// Layout that happy-dom can't lay out, checked in the markup and the style
// sheet: long names wrap on the properties page, the card's stat labels end in
// an ellipsis beside their calculators, section headings keep their line, and
// the time zone search box shows the keyboard focus.
import { beforeEach, describe, expect, it } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/preact';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { App } from '../../src/ui/App';
import * as S from '../../src/state/store';
import { load, ROOT } from '../helpers/fixtures';

const NoMap = () => <div data-testid="map" />;
const css = readFileSync(join(ROOT, 'src', 'styles.css'), 'utf8');
/** The declarations of the rule for `selector` (a rule of its own, starting a line), wherever it is in the style sheet. */
const rule = (selector: string) => {
  const at = css.indexOf(`\n${selector} {`);
  return at < 0 ? '' : css.slice(at + selector.length + 3, css.indexOf('}', at));
};

beforeEach(() => S.resetForTests());

describe('the properties page', () => {
  it('wraps a long name and its line instead of cutting them off', () => {
    const file = 'roosevelt-island-morning-run-with-the-club-around-the-lighthouse-2026-06-14.gpx';
    S.addLoaded([{ ...load('roosevelt-island-run.gpx'), file }]);
    render(<App Map={NoMap} />);
    act(() => S.openDetails('A'));
    expect(document.querySelector('.details-name .track-name')!.textContent).toBe(file);
    const wrap = rule('.details-name .track-name, .details-name .track-sub, .details-logs .combo-file');
    expect(wrap).toContain('white-space: normal');
    expect(wrap).toContain('overflow-wrap: anywhere');
  });
});

describe("the track card's stats", () => {
  it('cut a label too long for its column off with an ellipsis of its own, keeping its calculator beside it', () => {
    S.addLoaded([load('central-park-loop.nmea')]);
    render(<App Map={NoMap} />);
    const dts = [...document.querySelectorAll('.track-inline .stats dt')];
    expect(dts.map((dt) => dt.querySelector('.stat-label')?.textContent)).toEqual(['Distance', 'Moving time', 'Avg speed']);
    for (const dt of dts) expect(dt.lastElementChild!.classList.contains('computed-btn')).toBe(true);
    expect(rule('.stats .stat-label')).toMatch(/min-width: 0; overflow: hidden; text-overflow: ellipsis;/);
    expect(rule('.stats dt')).toContain('display: flex');
    // Nothing lets the label run on into the next column.
    expect(css).not.toMatch(/\.stats dt \{ overflow: visible; \}/);
    expect(rule('.computed-btn')).toContain('flex: none');
    // Cut off, the label shows in full on hover.
    const label = dts[1].querySelector('.stat-label')!;
    Object.defineProperty(label, 'scrollWidth', { configurable: true, value: 90 });
    Object.defineProperty(label, 'clientWidth', { configurable: true, value: 60 });
    fireEvent.mouseEnter(label);
    expect(label.getAttribute('data-tip')).toBe('Moving time');
  });
});

describe('section headings', () => {
  it('keep their line however narrow the panel (a Chinese heading would wrap a character per line)', () => {
    S.addLoaded([load('central-park-loop.nmea')]);
    S.lang.value = 'zh';
    render(<App Map={NoMap} />);
    expect(screen.getByRole('heading', { name: '轨迹' }).parentElement!.classList.contains('sec-head')).toBe(true);
    expect(rule('.sec-head > .eyebrow')).toBe(' flex: none; white-space: nowrap; ');
  });
});

describe('the time zone search box', () => {
  it('shows the keyboard focus on its frame, since the box itself has no outline', () => {
    expect(rule('.search input')).toContain('outline: none');
    expect(rule('.search:has(input:focus-visible)')).toContain('outline: 2px solid');
  });
});
