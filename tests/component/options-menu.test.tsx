// @vitest-environment happy-dom
// The Options menu by keyboard: the focus moves into it as it opens, and back
// to the Options button as it closes.
import { beforeEach, describe, expect, it } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/preact';
import { App } from '../../src/ui/App';
import * as S from '../../src/state/store';

const NoMap = () => <div data-testid="map" />;
const optionsButton = () => screen.getByRole('button', { name: /Options/ });

beforeEach(() => S.resetForTests());

describe('Options menu focus', () => {
  it('moves the focus onto the basemap in use as it opens, and back to the Options button on Escape', () => {
    render(<App Map={NoMap} />);
    fireEvent.click(optionsButton());
    const menu = screen.getByRole('dialog', { name: 'Options' });
    expect(menu.contains(document.activeElement)).toBe(true);
    expect(document.activeElement!.getAttribute('aria-pressed')).toBe('true');
    expect(document.activeElement!.textContent).toContain('Light');
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: 'Options' })).toBeNull();
    expect(document.activeElement).toBe(optionsButton());
  });

  it('puts the focus back on the Options button when its Close button closes it', () => {
    render(<App Map={NoMap} />);
    fireEvent.click(optionsButton());
    const close = within(screen.getByRole('dialog', { name: 'Options' })).getByRole('button', { name: 'Close' });
    close.focus();
    fireEvent.click(close);
    expect(screen.queryByRole('dialog', { name: 'Options' })).toBeNull();
    expect(document.activeElement).toBe(optionsButton());
  });

  it('leaves the focus where it is when the menu closes with the focus elsewhere', () => {
    render(<App Map={NoMap} />);
    fireEvent.click(optionsButton());
    const zoomIn = screen.getByRole('button', { name: 'Zoom in' });
    zoomIn.focus();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: 'Options' })).toBeNull();
    expect(document.activeElement).toBe(zoomIn);
  });
});
