// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/preact';
import { App } from '../../src/ui/App';
import * as S from '../../src/state/store';
import { tipXY } from '../../src/map/bridge';
import { clockShift } from '../../src/time/zones';
import { hint } from '../../src/ui/Computed';
import { drawnSteps } from '../../src/map/geojson';
import { palette } from '../../src/color/palettes';
import { load } from '../helpers/fixtures';

const NoMap = () => <div data-testid="map" />;

function loadFixtures(...names: string[]) {
  S.addLoaded(names.map(load));
}

beforeEach(() => {
  S.resetForTests();
  tipXY.value = null;
  hint.value = null;
  S.showHaloGraph.value = false;
});

describe('empty state', () => {
  it('offers to open files or try the sample ride', () => {
    render(<App Map={NoMap} />);
    expect(screen.getByRole('heading', { name: 'Plot your GPS track logs' })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Open tracks/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Try the sample ride' })).toBeTruthy();
    expect(screen.getByText('GPX')).toBeTruthy();
    expect(screen.getByText('NMEA')).toBeTruthy();
  });

  it('shows each file format\'s badge shape as a key', () => {
    render(<App Map={NoMap} />);
    const pills = [...document.querySelectorAll('.supports .pill')];
    expect(pills.map((p) => [p.textContent, p.querySelector('.badge-shape')!.classList[1]])).toEqual([['GPX', 'circle'], ['NMEA', 'square'], ['Columbus Fusion', 'hexagon']]);
  });

  it('switches the whole interface to Chinese from the Options menu', () => {
    render(<App Map={NoMap} />);
    expect(screen.queryByRole('button', { name: '中文' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Options/ }));
    fireEvent.click(screen.getByRole('button', { name: '中文' }));
    expect(screen.getByText('轨迹绘图器')).toBeTruthy();
    expect(screen.getByRole('heading', { name: '把 GPS 轨迹记录画在地图上' })).toBeTruthy();
    expect(document.documentElement.lang).toBe('zh-CN');
  });
});

describe('tracks panel', () => {
  it('lists loaded tracks and flags the damaged one', () => {
    loadFixtures('central-park-loop-truncated.nmea', 'central-park-loop-vendor.gpx');
    render(<App Map={NoMap} />);
    expect(screen.getByRole('heading', { name: 'Track Log Plotter' })).toBeTruthy();
    expect(screen.getByText('central-park-loop-truncated.nmea')).toBeTruthy();
    expect(screen.getByText('1 problem')).toBeTruthy();
    expect(screen.getByText('2 of 3 shown · 2 loaded')).toBeTruthy();
    expect(screen.getByRole('status').textContent).toContain('loaded with 1 problem');
  });

  it('shapes each track\'s letter badge by its file format, and names the format on hover', () => {
    loadFixtures('central-park-loop.nmea', 'roosevelt-island-run.gpx', 'central-park-loop-motion.csv');
    render(<App Map={NoMap} />);
    const badge = (id: string) => document.querySelector(`.track-row[data-track="${id}"] .badge`)!;
    expect([badge('A').classList.contains('square'), badge('A').getAttribute('title')]).toEqual([true, 'NMEA']);
    expect([badge('B').classList.contains('circle'), badge('B').getAttribute('title')]).toEqual([true, 'GPX']);
    expect([badge('C').classList.contains('hexagon'), badge('C').getAttribute('title')]).toEqual([true, 'Columbus Fusion']);
    // The same shape follows the track into the timeline.
    const lane = [...document.querySelectorAll('.lane .badge')].find((b) => b.textContent === 'C')!;
    expect(lane.classList.contains('hexagon')).toBe(true);
  });

  it('swaps the color and halo measures with one click in the settings sheet', () => {
    loadFixtures('central-park-loop.nmea');
    render(<App Map={NoMap} />);
    expect([S.items.value[0].color, S.items.value[0].halo]).toEqual(['speed', 'hdop']);
    fireEvent.click(screen.getByRole('button', { name: /^Color Speed \(km\/h\) Halo HDOP/ }));
    const swap = () => fireEvent.click(within(screen.getByRole('dialog', { name: 'Color, halo and timeline' })).getByRole('button', { name: 'Swap' }));
    swap();
    expect([S.items.value[0].color, S.items.value[0].halo]).toEqual(['hdop', 'speed']);
    expect(screen.getByRole('button', { name: /^Color HDOP Halo Speed \(km\/h\)/ })).toBeTruthy();
    // "One color" and no halo turn into each other.
    act(() => { S.setMeasure('A', 'color', 'none'); });
    swap();
    expect([S.items.value[0].color, S.items.value[0].halo]).toEqual(['speed', 'off']);
    expect(screen.getByRole('button', { name: /^Color Speed \(km\/h\) Halo None/ })).toBeTruthy();
  });

  it('hides every track at once, and shows the same ones again', () => {
    loadFixtures('central-park-loop.nmea', 'roosevelt-island-run.gpx', 'central-park-loop-vendor.gpx', 'hudson-greenway-evening.log');
    act(() => { S.toggleVisible('B'); S.toggleVisible('D'); });
    expect(S.visible.value.map((x) => x.id)).toEqual(['A', 'C', 'D']);
    render(<App Map={NoMap} />);
    fireEvent.click(screen.getByRole('button', { name: 'Hide all tracks' }));
    expect(S.visible.value).toEqual([]);
    fireEvent.click(screen.getByRole('button', { name: 'Show the tracks again' }));
    expect(S.visible.value.map((x) => x.id)).toEqual(['A', 'C', 'D']);
  });

  it('graphs the halo measure too, under the selected track\'s lane', () => {
    loadFixtures('central-park-loop.nmea');
    render(<App Map={NoMap} />);
    expect(document.querySelector('.lane[data-role="halo"]')).toBeNull();
    expect(screen.getByRole('button', { name: /Timeline Speed Change/ })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /^Color/ }));
    const toggle = () => screen.getByRole('switch', { name: 'Also graph the halo measure on the timeline' });
    expect(toggle().getAttribute('aria-checked')).toBe('false');
    fireEvent.click(toggle());
    expect(toggle().getAttribute('aria-checked')).toBe('true');
    const lane = document.querySelector('.lane[data-role="halo"]')!;
    expect(lane.querySelector('.lane-measure')!.textContent).toBe('HDOP');
    expect(lane.querySelector('.lane-note')!.textContent).toBe('halo');
    // The card says what the timeline graphs.
    expect(screen.getByRole('button', { name: /Timeline Speed and HDOP Change/ })).toBeTruthy();
    // No halo, no halo graph: the switch is off and can't be turned on.
    act(() => { S.setMeasure('A', 'halo', 'off'); });
    expect(document.querySelector('.lane[data-role="halo"]')).toBeNull();
    expect(toggle().getAttribute('aria-checked')).toBe('false');
    expect((toggle() as HTMLButtonElement).disabled).toBe(true);
  });

  it('hides and shows tracks, refusing a fourth', () => {
    loadFixtures('central-park-loop.nmea', 'central-park-loop-vendor.gpx', 'roosevelt-island-run.gpx', 'central-park-loop-garmin.gpx');
    render(<App Map={NoMap} />);
    fireEvent.click(screen.getByRole('button', { name: 'Show track D' }));
    expect(screen.getByText('Three tracks are showing. Hide one to show this one.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Hide track B' }));
    fireEvent.click(screen.getByRole('button', { name: 'Show track D' }));
    expect(screen.getByRole('button', { name: 'Hide track D' }).getAttribute('aria-pressed')).toBe('true');
  });

  it('minimizes the panel to a single button, without the title', () => {
    loadFixtures('central-park-loop.nmea');
    render(<App Map={NoMap} />);
    fireEvent.click(screen.getByRole('button', { name: 'Minimize the panel' }));
    expect(screen.queryByText('Track Log Plotter')).toBeNull();
    expect(screen.queryByText('central-park-loop.nmea')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Show the panel' }));
    expect(screen.getByText('central-park-loop.nmea')).toBeTruthy();
  });

  it('minimizes the timeline to a single button', () => {
    loadFixtures('central-park-loop.nmea');
    render(<App Map={NoMap} />);
    expect(screen.getByRole('region', { name: 'Timeline' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Minimize the timeline' }));
    expect(screen.queryByRole('region', { name: 'Timeline' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Show the timeline' }));
    expect(screen.getByRole('region', { name: 'Timeline' })).toBeTruthy();
  });

  it('explains every measure the file has in the settings sheet, and leaves out the others', () => {
    loadFixtures('central-park-loop-vendor.gpx');
    render(<App Map={NoMap} />);
    fireEvent.click(screen.getByRole('button', { name: /^Color/ }));
    const sheet = screen.getByRole('dialog', { name: 'Color, halo and timeline' });
    // This logger writes no satellite count or fix type: those rows aren't there at all.
    expect(within(sheet).getAllByRole('radio').map((r) => r.getAttribute('aria-label'))).toEqual([
      'Speed as the line color', 'Speed as the halo', 'Elevation as the line color', 'Elevation as the halo', 'Grade as the line color', 'Grade as the halo',
      'HDOP as the line color', 'HDOP as the halo', 'One color for the line', 'No halo',
    ]);
    expect(within(sheet).getByText(/Horizontal dilution of precision/)).toBeTruthy();
    expect(within(sheet).queryByText(/How many satellites/)).toBeNull();
    expect(within(sheet).getByText(/ranked against itself/)).toBeTruthy();
    // A choice applies at once, and the sheet stays open until Done.
    fireEvent.click(within(sheet).getByRole('radio', { name: 'Elevation as the line color' }));
    expect(S.items.value[0].color).toBe('ele');
    expect(screen.getByRole('dialog', { name: 'Color, halo and timeline' })).toBeTruthy();
    fireEvent.click(within(sheet).getByRole('button', { name: 'Done' }));
    expect(screen.queryByRole('dialog', { name: 'Color, halo and timeline' })).toBeNull();
  });

  it('puts what None does to the color and to the halo on separate lines', () => {
    loadFixtures('central-park-loop.nmea');
    render(<App Map={NoMap} />);
    fireEvent.click(screen.getByRole('button', { name: /^Color/ }));
    const none = document.querySelector('.settings-sheet .none-row th')!;
    expect([...none.querySelectorAll('.opt-desc')].map((d) => d.textContent)).toEqual(['Color: the whole track in one color from its range.', 'Halo: no halo.']);
  });

  it('doesn\'t say what a measure needs from the file, since the sheet lists only measures the file has', () => {
    loadFixtures('central-park-loop.nmea');
    render(<App Map={NoMap} />);
    fireEvent.click(screen.getByRole('button', { name: /^Color/ }));
    const descs = () => [...document.querySelectorAll('.settings-sheet .opt-desc')].map((d) => d.textContent!);
    expect(descs().find((d) => d.startsWith('How steep'))).toBe('How steep the track is, uphill or downhill: the change in elevation over about 120 m of track, as a percentage.');
    expect(descs().filter((d) => /\bneeds?\b[^.]*\bfile\b/i.test(d))).toEqual([]);
    act(() => { S.lang.value = 'zh'; });
    expect(descs().filter((d) => d.includes('需要文件中'))).toEqual([]);
  });

  it('copies the color and halo measures to the other tracks, naming them on hover', () => {
    loadFixtures('central-park-loop.nmea', 'roosevelt-island-run.gpx');
    S.setMeasure('A', 'color', 'ele');
    S.setMeasure('A', 'halo', 'speed');
    render(<App Map={NoMap} />);
    const apply = screen.getByRole('button', { name: 'Use on all tracks' });
    expect(apply.getAttribute('title')).toBe('Every track: color by Elevation, halo by Speed');
    fireEvent.click(apply);
    expect(S.items.value[1].color).toBe('ele');
    expect(S.items.value[1].halo).toBe('speed');
    act(() => {
      S.setMeasure('A', 'color', 'none');
      S.setMeasure('A', 'halo', 'off');
    });
    expect(apply.getAttribute('title')).toBe('Every track: plain lines, no halo');
  });

  it('shows dates for a log that spans two days', () => {
    loadFixtures('hudson-overnight.gpx');
    S.zone.value = 'America/New_York';
    S.cursorT.value = S.items.value[0].track.cols.t[0];
    render(<App Map={NoMap} />);
    expect(screen.getByText(/^Jul 11 – Jul 12 · [\d.]+ km · GPX$/)).toBeTruthy();
    expect(document.querySelector('.tl-time')!.textContent!.replace(/\s/g, ' ')).toBe('Jul 11, 7:30:00 PM');
    expect([...document.querySelectorAll('.tl-ticks .tick-date')].map((e) => e.textContent)).toEqual(['Jul 12']);
    fireEvent.click(screen.getByRole('button', { name: 'Properties' }));
    expect(screen.getByText('Sat, Jul 11, 2026 – Sun, Jul 12, 2026')).toBeTruthy();
    expect(screen.getByText(/^Jul 11, 7:30:00\sPM – Jul 12, 8:\d{2}:\d{2}\sAM/)).toBeTruthy();
  });

  it('opens the settings sheet from the whole card, and closes it on a second press or Escape', () => {
    loadFixtures('central-park-loop.nmea');
    render(<App Map={NoMap} />);
    const card = screen.getByRole('button', { name: 'Color Speed (km/h) Halo HDOP Timeline Speed Change the color, halo and timeline' });
    expect(card.getAttribute('aria-haspopup')).toBe('dialog');
    // The card still explains its keys with calculator buttons of their own.
    expect(document.querySelector('.settings-card .legend .computed-btn')).toBeTruthy();
    fireEvent.click(card);
    expect(screen.getByRole('dialog', { name: 'Color, halo and timeline' })).toBeTruthy();
    expect(card.getAttribute('aria-expanded')).toBe('true');
    // A real press starts with pointerdown, which closes popovers outside; the card is exempt.
    fireEvent.pointerDown(card);
    fireEvent.click(card);
    expect(screen.queryByRole('dialog', { name: 'Color, halo and timeline' })).toBeNull();
    fireEvent.click(card);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: 'Color, halo and timeline' })).toBeNull();
  });

  it('explains the percentages behind the calculator, not in a heading', () => {
    loadFixtures('central-park-loop.nmea');
    render(<App Map={NoMap} />);
    expect(screen.queryByText('share of time')).toBeNull();
    const legend = document.querySelector('.legend')!;
    expect(legend.querySelector('.legend-why button')).toBeTruthy();
  });

  it('shows equal speed steps from zero for a log slower than running, and says why', () => {
    loadFixtures('lower-manhattan-walk.gpx');
    render(<App Map={NoMap} />);
    expect([...document.querySelectorAll('.legend-step .mono:not(.muted)')].map((e) => e.textContent)).toEqual(['< 1.2', '1.2–2.4', '2.4–3.6', '3.6–4.8', '≥ 4.8']);
    const why = [...document.querySelectorAll('.legend .computed-btn')].map((b) => b.getAttribute('aria-label')).join(' ');
    expect(why).toContain('so speed steps are equal parts of 6 km/h');
  });

  it('removes every track after asking, from select mode (which took the place of Remove all)', () => {
    loadFixtures('central-park-loop.nmea', 'roosevelt-island-run.gpx');
    render(<App Map={NoMap} />);
    expect(screen.queryByRole('button', { name: 'Remove all tracks' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Select' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select all' }));
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    expect(S.items.value).toHaveLength(2);
    fireEvent.click(screen.getByRole('button', { name: 'Remove 2?' }));
    expect(S.items.value).toHaveLength(0);
    expect(screen.getByRole('heading', { name: 'Plot your GPS track logs' })).toBeTruthy();
  });

  it('shows each map switch as on or off by its border, without a checkbox', () => {
    loadFixtures('central-park-loop.nmea');
    render(<App Map={NoMap} />);
    const arrows = screen.getByRole('button', { name: 'Heading arrows' });
    expect(document.querySelector('.toggle-chip .check')).toBeNull();
    const was = arrows.getAttribute('aria-pressed');
    fireEvent.click(arrows);
    expect(arrows.getAttribute('aria-pressed')).not.toBe(was);
    expect(arrows.classList.contains('is-on')).toBe(arrows.getAttribute('aria-pressed') === 'true');
  });

  it('closes the fix card with its close button', () => {
    loadFixtures('central-park-loop.nmea');
    S.cursorT.value = S.items.value[0].track.cols.t[100];
    tipXY.value = { x: 600, y: 300 };
    render(<App Map={NoMap} />);
    expect(document.querySelector('.tooltip')).toBeTruthy();
    // No footnote: each computed row explains itself on its calculator button.
    const card = document.querySelector('.tooltip') as HTMLElement;
    expect(card.textContent).not.toContain('Computed by the app, not read from the file');
    fireEvent.mouseEnter(within(card).getByRole('button', { name: /^Computed by the app: Worked out from elevation/ }));
    expect(screen.getByRole('tooltip').textContent).toContain('Worked out from elevation');
    // The fix's position, in decimal degrees.
    const c = S.items.value[0].track.cols;
    expect(within(document.querySelector('.tooltip') as HTMLElement).getByText(`${c.lat[100].toFixed(5)}, ${c.lon[100].toFixed(5)}`)).toBeTruthy();
    fireEvent.click(within(document.querySelector('.tooltip') as HTMLElement).getByRole('button', { name: 'Close' }));
    expect(S.cursorT.value).toBeNull();
    expect(document.querySelector('.tooltip')).toBeNull();
  });

  it('highlights the measures on the color and the halo in the fix card', () => {
    loadFixtures('central-park-loop.nmea');
    S.cursorT.value = S.items.value[0].track.cols.t[100];
    tipXY.value = { x: 600, y: 300 };
    render(<App Map={NoMap} />);
    const card = () => document.querySelector('.tooltip') as HTMLElement;
    const drawn = () => [...card().querySelectorAll('.tip-rows .is-drawn dt')].map((d) => d.textContent);
    expect(drawn()).toEqual(['Speed, shown as the line color', 'HDOP, shown as the halo']);
    // The swatch is the line's color at this fix, as the map draws it.
    const item = S.items.value[0];
    const step = drawnSteps(item.track, 'speed', S.scaleFor(item.track, 'speed'))[100];
    const hex = palette(item.fam, 'speed', false, true)[step];
    const rgb = `rgb(${[1, 3, 5].map((k) => parseInt(hex.slice(k, k + 2), 16)).join(', ')})`;
    expect([hex, rgb]).toContain((card().querySelector('.tip-swatch') as HTMLElement).style.backgroundColor);
    expect(card().querySelector('.tip-halo')).toBeTruthy();
    // It follows the track's settings.
    act(() => { S.setMeasure('A', 'color', 'ele'); });
    expect(drawn()).toEqual(['Elevation, shown as the line color', 'HDOP, shown as the halo']);
    act(() => { S.setMeasure('A', 'color', 'none'); S.setMeasure('A', 'halo', 'off'); });
    expect(drawn()).toEqual([]);
    expect(card().querySelector('.tip-swatch, .tip-halo')).toBeNull();
  });

  it('removes a track from its card with the trash icon; the properties page has no remove button', () => {
    loadFixtures('central-park-loop.nmea', 'roosevelt-island-run.gpx');
    render(<App Map={NoMap} />);
    const trash = screen.getByRole('button', { name: 'Remove this track' });
    expect(trash.textContent).toBe('');
    act(() => { S.openDetails('A'); });
    expect(screen.queryByRole('button', { name: 'Remove this track' })).toBeNull();
    act(() => { S.page.value = { kind: 'tracks' }; });
    // The first click only asks; pressing elsewhere cancels.
    fireEvent.click(screen.getByRole('button', { name: 'Remove this track' }));
    expect(S.items.value).toHaveLength(2);
    fireEvent.blur(screen.getByRole('button', { name: 'Remove?' }));
    expect(screen.queryByRole('button', { name: 'Remove?' })).toBeNull();
    // Asked again, a second click removes it.
    fireEvent.click(screen.getByRole('button', { name: 'Remove this track' }));
    fireEvent.click(screen.getByRole('button', { name: 'Remove?' }));
    expect(S.items.value.map((x) => x.id)).toEqual(['B']);
  });

  it('stops asking "Remove?" after 4 seconds, keeping the track', () => {
    vi.useFakeTimers();
    try {
      loadFixtures('central-park-loop.nmea');
      render(<App Map={NoMap} />);
      fireEvent.click(screen.getByRole('button', { name: 'Remove this track' }));
      act(() => { vi.advanceTimersByTime(3900); });
      expect(screen.getByRole('button', { name: 'Remove?' })).toBeTruthy();
      act(() => { vi.advanceTimersByTime(200); });
      expect(screen.queryByRole('button', { name: 'Remove?' })).toBeNull();
      expect(screen.getByRole('button', { name: 'Remove this track' })).toBeTruthy();
      expect(S.items.value).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('opens the properties page with the problem explained', () => {
    loadFixtures('central-park-loop-truncated.nmea');
    render(<App Map={NoMap} />);
    fireEvent.click(screen.getByRole('button', { name: 'Show properties' }));
    expect(screen.getByText('Last line cut off')).toBeTruthy();
    expect(screen.getByText(/stops after 28 characters/)).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Fields in this file' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.getByRole('heading', { name: 'Tracks' })).toBeTruthy();
  });

  it('links Street View to the selected point, and only when there is one', () => {
    loadFixtures('central-park-loop.nmea');
    render(<App Map={NoMap} />);
    fireEvent.click(screen.getByRole('button', { name: 'Open in Google Maps' }));
    expect(screen.queryByRole('link', { name: /Street View/ })).toBeNull();
    act(() => { S.cursorT.value = S.items.value[0].track.cols.t[100]; });
    const sv = screen.getByRole('link', { name: /Street View at the selected point/ });
    const c = S.items.value[0].track.cols;
    expect(sv.getAttribute('href')).toContain(`viewpoint=${c.lat[100].toFixed(6)}%2C${c.lon[100].toFixed(6)}`);
    act(() => S.clearCursor());
    expect(screen.queryByRole('link', { name: /Street View/ })).toBeNull();
  });

  it('points to Google My Maps for seeing the track on Google', () => {
    loadFixtures('central-park-loop.nmea');
    render(<App Map={NoMap} />);
    fireEvent.click(screen.getByRole('button', { name: 'Open in Google Maps' }));
    expect(screen.getByRole('link', { name: /Google My Maps/ }).getAttribute('href')).toBe('https://mymaps.google.com/');
    expect(screen.getByText('Import a GPX file there to see the track')).toBeTruthy();
    expect(screen.getByText(/choose Import under its layer and pick your GPX file/)).toBeTruthy();
  });

  it('explains My Maps on hover instead of in the panel', () => {
    loadFixtures('central-park-loop.nmea');
    render(<App Map={NoMap} />);
    fireEvent.click(screen.getByRole('button', { name: 'Open in Google Maps' }));
    const link = screen.getByRole('link', { name: /Google My Maps/ });
    expect(screen.queryByRole('tooltip')).toBeNull();
    fireEvent.mouseEnter(link);
    const tip = screen.getByRole('tooltip');
    expect(tip.textContent).toContain('Google My Maps');
    expect(tip.textContent).toContain('choose Import under its layer');
    fireEvent.mouseLeave(link);
    expect(screen.queryByRole('tooltip')).toBeNull();
  });

  it('shows the Options button as a gear, with its name read out but not shown', () => {
    render(<App Map={NoMap} />);
    const options = screen.getByRole('button', { name: /Options/ });
    expect(options.querySelector('.bm-opts svg')).toBeTruthy();
    expect(options.querySelector('.bm-opts .sr-only')!.textContent).toBe('Options');
  });

  it('starts with the Fixes switch off', () => {
    loadFixtures('central-park-loop.nmea');
    render(<App Map={NoMap} />);
    expect(screen.getByRole('button', { name: 'Fixes' }).getAttribute('aria-pressed')).toBe('false');
  });

  it('marks the timeline graph as log scale when the speed steps are', () => {
    loadFixtures('central-park-loop.nmea');
    render(<App Map={NoMap} />);
    expect(S.scales.value.speed.log).toBe(true);
    expect(document.querySelector('.lane-note')!.textContent).toContain('log scale');
  });

  it('keeps "from its start" on the selected lane too, beside "log scale"', () => {
    // The ride and the run were recorded on different days, so both lanes line up at their starts.
    loadFixtures('central-park-loop.nmea', 'roosevelt-island-run.gpx');
    S.select('B');
    render(<App Map={NoMap} />);
    const notes = (id: string) => [...document.querySelectorAll('.lane')].find((l) => l.querySelector('.badge')!.textContent === id)!.querySelectorAll('.lane-note');
    expect([...notes('B')].map((n) => n.textContent)).toEqual(['from its start, Jun 21', 'log scale']);
    expect([...notes('A')].map((n) => n.textContent)).toEqual(['from its start, Jun 14']);
  });

  it('shows acceleration from a Columbus Fusion log with motion data, and only there', () => {
    loadFixtures('central-park-loop-motion.csv', 'roosevelt-island-run.gpx');
    S.cursorT.value = S.items.value[0].track.cols.t[60];
    tipXY.value = { x: 600, y: 300 };
    render(<App Map={NoMap} />);
    expect(screen.getByText(/· Columbus Fusion$/)).toBeTruthy();
    // No fix quality in the file, so the halo starts on acceleration.
    fireEvent.click(screen.getByRole('button', { name: /^Color Speed \(km\/h\) Halo Acceleration \(g\)/ }));
    const pane = screen.getByRole('dialog', { name: 'Color, halo and timeline' });
    // The description says how it's worked out: the magnitude of the three-axis vector.
    expect(within(pane).getByText(/magnitude of that three-axis vector, √\(x² \+ y² \+ z²\)/)).toBeTruthy();
    fireEvent.click(within(pane).getByRole('button', { name: 'Close' }));
    const card = document.querySelector('.tooltip') as HTMLElement;
    expect(within(card).getByText('Acceleration (g)')).toBeTruthy();
    expect(within(card).getByText('Coordinates')).toBeTruthy();
    // All ten readings of that second, lowest first. Two are highlighted: the
    // strongest (the map's value) and the 5th highest (the upper middle one).
    const spans = [...card.querySelectorAll('.tip-readings span')];
    const readings = spans.map((e) => Number(e.textContent));
    expect(readings).toHaveLength(10);
    expect([...readings].sort((x, y) => x - y)).toEqual(readings);
    const median = card.querySelectorAll('.tip-readings .is-median');
    const peak = card.querySelectorAll('.tip-readings .is-peak');
    expect([median.length, peak.length]).toEqual([1, 1]);
    expect([spans.indexOf(median[0]), spans.indexOf(peak[0])]).toEqual([5, 9]);
    expect(readings[9]).toBeCloseTo(S.items.value[0].track.cols.accel[60], 2);
    // No separate "median 1.02 g" text: the highlight shows it.
    expect(card.textContent).not.toMatch(/median \d/i);
    // Hovering a highlighted reading says what it is.
    fireEvent.mouseEnter(median[0]);
    expect(screen.getByRole('tooltip').textContent).toMatch(/^MedianThe median of this second's 10 readings \(the upper of the two middle ones\): \d\.\d\d g$/);
    fireEvent.mouseLeave(median[0]);
    fireEvent.mouseEnter(peak[0]);
    expect(screen.getByRole('tooltip').textContent).toMatch(/^StrongestThe strongest of this second's 10 readings: \d\.\d\d g\. The map and the timeline color this second by it\.$/);
    fireEvent.mouseLeave(peak[0]);
    // A GPX track without motion data doesn't list it.
    fireEvent.click(screen.getByRole('button', { name: /^B roosevelt-island-run.gpx/ }));
    fireEvent.click(screen.getByRole('button', { name: /^Color/ }));
    expect(within(screen.getByRole('dialog', { name: 'Color, halo and timeline' })).queryByRole('radio', { name: 'Acceleration as the line color' })).toBeNull();
  });

  it('lets the time zone of a Columbus Fusion log be changed on its properties page', () => {
    loadFixtures('roosevelt-island-run.csv');
    const before = S.items.value[0].track.cols.t[0];
    render(<App Map={NoMap} />);
    // The button says the time zone is set there.
    fireEvent.click(screen.getByRole('button', { name: 'Properties & time zone' }));
    expect(screen.getByRole('heading', { name: 'Time zone of the file' })).toBeTruthy();
    const clock = document.querySelector('[data-clock-trigger]') as HTMLElement;
    expect(clock.textContent).toBe('UTC');
    fireEvent.click(clock);
    const dlg = screen.getByRole('dialog', { name: "Time zone of track A's file" });
    fireEvent.input(within(dlg).getByRole('searchbox'), { target: { value: 'tokyo' } });
    fireEvent.click(within(dlg).getByRole('radio', { name: /Tokyo/ }));
    const tr = S.items.value[0].track;
    expect(tr.clock).toBe('Asia/Tokyo');
    // The clock readings stay; the whole track moves to Tokyo time.
    expect(tr.cols.t[0] - before).toBe(clockShift(before, 'utc', 'Asia/Tokyo'));
    expect(tr.cols.t[0] - before).toBe(-9 * 3600_000);
    expect(tr.derived.stats.start).toBe(tr.cols.t[0]);
    expect(screen.getByRole('button', { name: /^Tokyo \(UTC\+9\)/ })).toBeTruthy();
  });

  it('keeps the Google Maps links in one button\'s menu', () => {
    loadFixtures('central-park-loop.nmea');
    render(<App Map={NoMap} />);
    const button = screen.getByRole('button', { name: 'Open in Google Maps' });
    expect(button.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByRole('link', { name: /This map view/ })).toBeNull();
    fireEvent.click(button);
    expect(button.getAttribute('aria-expanded')).toBe('true');
    expect(within(document.getElementById('google-menu')!).getAllByRole('link').map((a) => a.textContent)).toEqual(['This map view', 'Google My MapsImport a GPX file there to see the track']);
    // Escape closes it and puts the focus back on the button.
    fireEvent.keyDown(screen.getByRole('link', { name: /This map view/ }), { key: 'Escape' });
    expect(screen.queryByRole('link', { name: /This map view/ })).toBeNull();
    expect(document.activeElement).toBe(button);
    // So does a press anywhere else; following a link closes it too.
    fireEvent.click(button);
    fireEvent.pointerDown(document.body);
    expect(button.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(button);
    fireEvent.click(screen.getByRole('link', { name: /This map view/ }));
    expect(button.getAttribute('aria-expanded')).toBe('false');
  });

  it('shows the On the map switches as icons, named on hover', () => {
    loadFixtures('central-park-loop.nmea');
    render(<App Map={NoMap} />);
    const arrows = screen.getByRole('button', { name: 'Heading arrows' });
    // No visible text: the name is read out and shown on hover.
    expect(arrows.textContent).toBe('');
    expect(arrows.classList.contains('icon-only')).toBe(true);
    fireEvent.mouseEnter(arrows);
    expect(screen.getByRole('tooltip').textContent).toBe('Heading arrowsArrows along the line show the direction of travel, from zoom 14.');
    fireEvent.mouseLeave(arrows);
    expect(screen.queryByRole('tooltip')).toBeNull();
    expect(screen.getByRole('button', { name: 'Gaps' }).getAttribute('aria-pressed')).toBe('true');
  });

  it('links to Google Maps for the current view', () => {
    loadFixtures('central-park-loop.nmea');
    render(<App Map={NoMap} />);
    fireEvent.click(screen.getByRole('button', { name: 'Open in Google Maps' }));
    const link = screen.getByRole('link', { name: /This map view/ });
    expect(link.getAttribute('href')).toContain('https://www.google.com/maps/@?api=1&map_action=map');
    expect(link.getAttribute('target')).toBe('_blank');
  });

  it('shows the other logger\'s values inside the selected logger\'s gap', () => {
    loadFixtures('central-park-loop.nmea', 'central-park-loop-vendor.gpx');
    const c = S.items.value[0].track.cols;
    const gap = c.t.findIndex((t, i) => i > 0 && t - c.t[i - 1] > 30_000);
    S.cursorT.value = (c.t[gap - 1] + c.t[gap]) / 2;
    render(<App Map={NoMap} />);
    expect(S.selected.value!.id).toBe('A');
    expect(S.cursorItem.value!.id).toBe('B');
    const head = document.querySelector('.tl-head')!;
    expect(head.querySelector('.badge')!.textContent).toBe('B');
    expect(head.querySelector('.tl-values')!.textContent).toContain('km/h');
  });

  it('shows time in a picked zone', () => {
    loadFixtures('central-park-loop.nmea');
    S.cursorT.value = S.items.value[0].track.cols.t[0];
    render(<App Map={NoMap} />);
    fireEvent.click(screen.getByRole('button', { name: 'UTC' }));
    expect(screen.getByText('1:05:00 PM')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Other/ }));
    const dlg = screen.getByRole('dialog', { name: 'Pick a time zone' });
    fireEvent.input(within(dlg).getByRole('searchbox'), { target: { value: 'tokyo' } });
    fireEvent.click(within(dlg).getByRole('radio', { name: /Tokyo/ }));
    expect(screen.getByText('10:05:00 PM')).toBeTruthy();
    expect(S.zone.value).toBe('Asia/Tokyo');
  });

  it('keeps the last picked time zone on its button after going back to Local', () => {
    loadFixtures('central-park-loop.nmea');
    render(<App Map={NoMap} />);
    fireEvent.click(screen.getByRole('button', { name: /Other/ }));
    const dlg = screen.getByRole('dialog', { name: 'Pick a time zone' });
    fireEvent.input(within(dlg).getByRole('searchbox'), { target: { value: 'tokyo' } });
    fireEvent.click(within(dlg).getByRole('radio', { name: /Tokyo/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Local' }));
    expect(S.zone.value).toBe('local');
    const named = screen.getByRole('button', { name: /Tokyo/ });
    expect(named.getAttribute('aria-pressed')).toBe('false');
    // Pressing it again opens the list, like Other does.
    fireEvent.click(named);
    expect(screen.getByRole('dialog', { name: 'Pick a time zone' })).toBeTruthy();
  });

  it('switches units from the Options menu, which keeps showing the basemap', () => {
    loadFixtures('central-park-loop.nmea');
    render(<App Map={NoMap} />);
    expect(screen.queryByRole('button', { name: 'Settings' })).toBeNull();
    const options = screen.getByRole('button', { name: /Options/ });
    // OpenFreeMap Light is the basemap to start with.
    expect(options.textContent).toContain('Light');
    expect(S.basemap.value).toBe('light');
    fireEvent.click(options);
    const menu = screen.getByRole('dialog', { name: 'Options' });
    expect(within(menu).getByRole('heading', { name: 'Basemap' })).toBeTruthy();
    expect(within(menu).getByRole('heading', { name: 'Language' })).toBeTruthy();
    fireEvent.click(within(menu).getByRole('radio', { name: /Imperial/ }));
    expect(screen.getAllByText(/mi$/).length).toBeGreaterThan(0);
    // A second press on the button closes the menu.
    fireEvent.pointerDown(options);
    fireEvent.click(options);
    expect(screen.queryByRole('dialog', { name: 'Options' })).toBeNull();
  });
});
