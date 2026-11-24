// @vitest-environment happy-dom
// Escape closes what is open on top first and keeps the key: a menu, a list
// or an explanation closes, and select mode stays on until the next Escape.
import { beforeEach, describe, expect, it } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/preact';
import { App } from '../../src/ui/App';
import * as S from '../../src/state/store';
import { hint } from '../../src/ui/Computed';
import { load } from '../helpers/fixtures';

const NoMap = () => <div data-testid="map" />;
const rowBox = (id: string) => screen.getByRole('checkbox', { name: new RegExp(`^Select track ${id}:`) });
const escape = (el: Element | Document = document.activeElement ?? document.body) => fireEvent.keyDown(el, { key: 'Escape' });

beforeEach(() => {
  S.resetForTests();
  hint.value = null;
});

function twoTracks() {
  S.addLoaded([load('central-park-loop.nmea'), load('roosevelt-island-run.gpx')]);
  render(<App Map={NoMap} />);
}

describe('Escape in select mode', () => {
  it('closes the time zone list opened after select mode began, and keeps select mode', () => {
    twoTracks();
    fireEvent.click(screen.getByRole('button', { name: 'Select' }));
    fireEvent.click(rowBox('A'));
    act(() => { S.zoneOpen.value = true; });
    escape(screen.getByRole('searchbox'));
    expect(S.zoneOpen.value).toBe(false);
    expect([S.selecting.value, S.ticked.value]).toEqual([true, ['A']]);
    escape();
    expect(S.selecting.value).toBe(false);
  });

  it('closes the Options menu opened after select mode began, and keeps select mode', () => {
    twoTracks();
    fireEvent.click(screen.getByRole('button', { name: 'Select' }));
    act(() => { S.basemapOpen.value = true; });
    escape();
    expect([S.basemapOpen.value, S.selecting.value]).toEqual([false, true]);
  });

  it('closes a list open before select mode began (Select pressed from the keyboard), and keeps select mode', () => {
    twoTracks();
    act(() => { S.zoneOpen.value = true; });
    // A click with no pointer press first, as Enter on the button gives: the list stays open.
    fireEvent.click(screen.getByRole('button', { name: 'Select' }));
    fireEvent.click(rowBox('B'));
    expect(S.zoneOpen.value).toBe(true);
    escape(screen.getByRole('searchbox'));
    expect(S.zoneOpen.value).toBe(false);
    expect([S.selecting.value, S.ticked.value]).toEqual([true, ['B']]);
  });

  it('ends select mode when nothing is open on top', () => {
    twoTracks();
    fireEvent.click(screen.getByRole('button', { name: 'Select' }));
    escape(document);
    expect(S.selecting.value).toBe(false);
  });
});

describe('Escape and the explanations', () => {
  it("closes a calculator's explanation shown on hover, and one pinned by a click", () => {
    S.addLoaded([load('central-park-loop.nmea')]);
    render(<App Map={NoMap} />);
    const calc = screen.getAllByRole('button', { name: /^Computed by the app:/ })[0];
    fireEvent.mouseEnter(calc);
    expect(screen.getByRole('tooltip')).toBeTruthy();
    escape(document);
    expect(screen.queryByRole('tooltip')).toBeNull();
    fireEvent.click(calc);
    expect(hint.value?.pinned).toBe(true);
    escape(calc);
    expect(screen.queryByRole('tooltip')).toBeNull();
  });

  it('closes the explanation of an "On the map" switch shown on focus', () => {
    S.addLoaded([load('central-park-loop.nmea')]);
    render(<App Map={NoMap} />);
    const gaps = screen.getByRole('button', { name: 'Gaps' });
    fireEvent.focus(gaps);
    expect(screen.getByRole('tooltip').textContent).toContain('dotted line');
    escape(gaps);
    expect(screen.queryByRole('tooltip')).toBeNull();
  });

  it('keeps select mode while an Escape closes an explanation', () => {
    S.addLoaded([load('central-park-loop.nmea')]);
    render(<App Map={NoMap} />);
    fireEvent.click(screen.getByRole('button', { name: 'Select' }));
    // A calculator in the timeline's lane label (grade), still there in select mode.
    act(() => { S.setMeasure('A', 'color', 'grade'); });
    fireEvent.mouseEnter(document.querySelector('.lane-label .computed-btn')!);
    expect(screen.getByRole('tooltip')).toBeTruthy();
    escape(document);
    expect([!!hint.value, S.selecting.value]).toEqual([false, true]);
    escape(document);
    expect(S.selecting.value).toBe(false);
  });
});
