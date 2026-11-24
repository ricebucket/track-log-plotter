// @vitest-environment happy-dom
// The start: the window's title in the language in use, and the sample ride,
// whose logs may fail to arrive (offline, or not found on the server).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/preact';
import { App } from '../../src/ui/App';
import * as S from '../../src/state/store';
import { fixture } from '../helpers/fixtures';

const NoMap = () => <div data-testid="map" />;

/** Serves the sample logs, except the ones named in `missing` (a 404 page) and `offline` (no answer at all). */
function serve({ missing = [] as string[], offline = [] as string[] } = {}) {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    const name = String(url).split('/').pop()!;
    if (offline.includes(name)) throw new TypeError('Failed to fetch');
    if (missing.includes(name)) return new Response('<!doctype html><title>Not found</title>', { status: 404 });
    return new Response(fixture(name), { status: 200 });
  }));
}

beforeEach(() => S.resetForTests());
afterEach(() => vi.unstubAllGlobals());

describe('the window title', () => {
  it("is the app's name in the language in use", () => {
    render(<App Map={NoMap} />);
    expect(document.title).toBe('Track Log Plotter');
    act(() => { S.lang.value = 'zh'; });
    expect(document.title).toBe('轨迹绘图器');
    act(() => { S.lang.value = 'en'; });
    expect(document.title).toBe('Track Log Plotter');
  });
});

describe('the sample ride', () => {
  it('opens both sample logs', async () => {
    serve();
    await S.loadSample('/');
    expect(S.items.value.map((x) => x.track.file)).toEqual(['central-park-loop.nmea', 'roosevelt-island-run.gpx']);
    expect(S.loadErrors.value).toEqual([]);
  });

  it("says a log that wasn't found couldn't be read, rather than reading the error page as a log, and opens the other", async () => {
    serve({ missing: ['roosevelt-island-run.gpx'] });
    render(<App Map={NoMap} />);
    await act(() => S.loadSample('/'));
    expect(S.items.value.map((x) => x.track.file)).toEqual(['central-park-loop.nmea']);
    expect(S.loadErrors.value).toEqual([{ file: 'roosevelt-island-run.gpx', error: 'unreadable' }]);
    expect(screen.getByRole('alert').textContent).toBe("roosevelt-island-run.gpx couldn't be read.");
  });

  it("says so when nothing arrives at all, instead of failing silently", async () => {
    serve({ offline: ['central-park-loop.nmea', 'roosevelt-island-run.gpx'] });
    render(<App Map={NoMap} />);
    await act(() => S.loadSample('/'));
    expect(S.items.value).toEqual([]);
    expect(S.loadErrors.value.map((e) => e.error)).toEqual(['unreadable', 'unreadable']);
    expect(screen.getByRole('alert').textContent).toContain("central-park-loop.nmea couldn't be read.");
  });

  it('holds the buttons from the first click, so a second click opens nothing twice', async () => {
    serve();
    render(<App Map={NoMap} />);
    const sample = screen.getByRole('button', { name: 'Try the samples' }) as HTMLButtonElement;
    fireEvent.click(sample);
    expect(sample.disabled).toBe(true);
    expect(screen.getByText('Reading files…')).toBeTruthy();
    await act(async () => { await vi.waitFor(() => expect(S.items.value).toHaveLength(2)); });
  });
});
