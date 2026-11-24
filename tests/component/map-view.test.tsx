// @vitest-environment happy-dom
// The map's wiring, against a stand-in for MapLibre (WebGL can't run here). The
// stand-in keeps the layers in drawing order and answers feature queries as
// MapLibre does, topmost first, from what each test says is drawn under the
// pointer; it hands events to layer listeners as MapLibre does too.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/preact';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { StyleSpecification } from 'maplibre-gl';
import { MapView, STYLE_WAIT_MS } from '../../src/map/MapView';
import { BASEMAPS, PLAIN, ZH_LABEL, basemapFailed, plainStyle } from '../../src/map/basemaps';
import { MapTools } from '../../src/ui/MapTools';
import * as S from '../../src/state/store';
import { tipXY } from '../../src/map/bridge';
import { parseText } from '../../src/parse/index';
import type { LoadedTrack } from '../../src/model/types';
import { load, ROOT } from '../helpers/fixtures';

type Feature = { properties: Record<string, unknown> };
type Layer = { id: string; type: string; layout: Record<string, unknown> };
type Listener = { type: string; layers: string[] | null; fn: (e: Record<string, unknown>) => void; inside: boolean };

const { FakeMap } = vi.hoisted(() => {
  class MapStandIn {
    static current: MapStandIn | null = null;
    layers: Layer[] = [];
    /** Everything sent to each source, in order. */
    data: Record<string, unknown[]> = {};
    /** Styles set after the first. */
    styles: unknown[] = [];
    listeners: Listener[] = [];
    images = new Set<string>();
    global: Record<string, unknown> = {};
    /** What each layer draws under the pointer, topmost first: set by each test. */
    under: Record<string, Feature[]> = {};
    queries = 0;
    canvas = { style: { cursor: '' } };
    /** What isStyleLoaded() says: true once a style has loaded, until the next is set (a test may say otherwise). */
    loaded = false;
    constructor() { MapStandIn.current = this; }
    /** The basemap's style has loaded, with these layers of its own. */
    loadStyle(base: { id: string; type: string; layout?: Record<string, unknown> }[]) {
      this.layers = base.map((l) => ({ ...l, layout: { ...l.layout } }));
      this.data = {};
      this.loaded = true;
      this.fire('style.load');
    }
    getStyle() { return { layers: this.layers.map(({ id, type }) => ({ id, type })) }; }
    setStyle(style: unknown) { this.styles.push(style); this.loaded = false; }
    isStyleLoaded() { return this.loaded; }
    addLayer(l: { id: string; type: string; layout?: Record<string, unknown> }) { this.layers.push({ id: l.id, type: l.type, layout: { ...l.layout } }); }
    getLayer(id: string) { return this.layers.find((l) => l.id === id); }
    addSource(id: string) { this.data[id] = []; }
    getSource(id: string) { const d = this.data[id]; return d ? { setData: (v: unknown) => { d.push(v); } } : undefined; }
    getLayoutProperty(id: string, k: string) { return this.getLayer(id)?.layout[k]; }
    setLayoutProperty(id: string, k: string, v: unknown) { const l = this.getLayer(id); if (l) l.layout[k] = v; }
    setPaintProperty() {}
    setGlobalStateProperty(k: string, v: unknown) { this.global[k] = v; }
    hasImage(id: string) { return this.images.has(id); }
    addImage(id: string) { this.images.add(id); }
    getZoom() { return 15; }
    getCenter() { return { lat: 40.7812, lng: -73.9665 }; }
    getBearing() { return 0; }
    getPitch() { return 0; }
    project() { return { x: 300, y: 300 }; }
    getCanvas() { return this.canvas; }
    fitBounds() {}
    zoomIn() {}
    zoomOut() {}
    resetNorthPitch() {}
    resize() {}
    remove() {}
    on(type: string, a: unknown, b?: unknown) {
      const layers = typeof a === 'function' ? null : Array.isArray(a) ? (a as string[]) : [a as string];
      this.listeners.push({ type, layers, fn: (typeof a === 'function' ? a : b) as Listener['fn'], inside: false });
      return this;
    }
    once(type: string, fn: Listener['fn']) {
      const l: Listener = { type, layers: null, inside: false, fn: (e) => { this.listeners.splice(this.listeners.indexOf(l), 1); fn(e); } };
      this.listeners.push(l);
      return this;
    }
    /** As MapLibre: the features of the layers asked for, the last drawn layer's first. */
    queryRenderedFeatures(_at: unknown, opts: { layers: string[] }) {
      this.queries++;
      const out: Feature[] = [];
      for (let k = this.layers.length - 1; k >= 0; k--) if (opts.layers.includes(this.layers[k].id)) out.push(...(this.under[this.layers[k].id] ?? []));
      return out;
    }
    /** An event, handed to layer listeners as MapLibre does: each queries its layers, hover ones on every move. */
    fire(type: string, e: Record<string, unknown> = {}) {
      // Over a copy: a once listener takes itself out as it runs.
      for (const l of this.listeners.slice()) {
        if (!l.layers) { if (l.type === type) l.fn(e); continue; }
        const hover = l.type === 'mouseenter' || l.type === 'mouseleave';
        if (hover ? type !== 'mousemove' : l.type !== type) continue;
        const live = l.layers.filter((id) => this.getLayer(id));
        const features = live.length ? this.queryRenderedFeatures(e.point, { layers: live }) : [];
        if (l.type === 'mouseenter') { if (features.length && !l.inside) l.fn({ ...e, features }); l.inside = features.length > 0; }
        else if (l.type === 'mouseleave') { if (!features.length && l.inside) l.fn(e); l.inside = features.length > 0; }
        else if (features.length) l.fn({ ...e, features });
      }
    }
  }
  return { FakeMap: MapStandIn };
});

vi.mock('maplibre-gl', () => ({ setWorkerUrl: () => {}, Map: FakeMap }));
vi.mock('maplibre-gl/dist/maplibre-gl.css', () => ({}));

/** The basemap's own layers: a fill, labels with names, and labels without. */
const BASE = [
  { id: 'water', type: 'fill' },
  { id: 'road_shield', type: 'symbol', layout: { 'text-field': '{ref}' } },
  { id: 'housenumber', type: 'symbol', layout: { 'text-field': ['to-string', ['get', 'housenumber']] } },
  { id: 'place_city', type: 'symbol', layout: { 'text-field': ['coalesce', ['get', 'name:en'], ['get', 'name']] } },
  { id: 'water_name', type: 'symbol', layout: { 'text-field': '{name:latin}\n{name:nonlatin}' } },
  { id: 'poi', type: 'symbol', layout: { 'icon-image': 'dot' } },
];

const frame = () => act(() => new Promise<void>((r) => setTimeout(r, 50)));
const f = (id: string): Feature => ({ properties: { id } });
const at = (tr: LoadedTrack, i: number) => ({ point: { x: 300, y: 300 }, lngLat: { lat: tr.cols.lat[i], lng: tr.cols.lon[i] } });

/** Shows the map, and loads its style. */
async function mount(): Promise<InstanceType<typeof FakeMap>> {
  render(<MapView />);
  await vi.waitFor(() => expect(FakeMap.current).not.toBeNull());
  const map = FakeMap.current!;
  act(() => map.loadStyle(BASE));
  return map;
}

/** A walk north through Central Park, a fix a second, `eastM` metres to the east of the path. */
function walk(file: string, eastM = 0, seconds = 300): LoadedTrack {
  const t0 = Date.UTC(2026, 5, 14, 13, 0, 0);
  const pts = Array.from({ length: seconds }, (_, i) =>
    `<trkpt lat="${(40.775 + (i * 1.5) / 111_195).toFixed(7)}" lon="${(-73.969 + eastM / 84_300).toFixed(7)}"><ele>20</ele><time>${new Date(t0 + i * 1000).toISOString()}</time><hdop>1.2</hdop><sat>8</sat></trkpt>`);
  const r = parseText(`<?xml version="1.0"?><gpx version="1.1" creator="Test"><trk><trkseg>${pts.join('')}</trkseg></trk></gpx>`, file);
  if (!r.ok) throw new Error(r.error);
  return r.track;
}

beforeEach(() => {
  S.resetForTests();
  tipXY.value = null;
  FakeMap.current = null;
  // The heading arrow is drawn on a canvas, which happy-dom doesn't have.
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation((() => new Proxy({}, {
    get: (_, k) => (k === 'getImageData' ? (_x: number, _y: number, w: number, h: number) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }) : () => {}),
    set: () => true,
  })) as never);
});
afterEach(() => vi.restoreAllMocks());

describe('picking a track on the map', () => {
  // Both tracks pass under the pointer. In the layers all tracks share, B is drawn after A, so on top
  // of it; the selected track, A, is drawn once more above them all, in layers of its own.
  const overlap = { 'tlp-casing': [f('B'), f('A')], 'tlp-line': [f('B'), f('A')], 'tlp-casing-sel': [f('A')], 'tlp-line-sel': [f('A')] };

  it('picks the selected track where tracks overlap, as it is drawn on top', async () => {
    S.addLoaded([load('central-park-loop.nmea'), load('central-park-loop-vendor.gpx')]);
    S.select('A');
    const map = await mount();
    const a = S.items.value[0].track;
    map.under = overlap;
    act(() => map.fire('click', at(a, 300)));
    expect(S.selected.value!.id).toBe('A');
    expect(S.cursorT.value).toBe(a.cols.t[300]);
  });

  it('starts a drag along the selected track where tracks overlap', async () => {
    S.addLoaded([load('central-park-loop.nmea'), load('central-park-loop-vendor.gpx')]);
    S.select('A');
    const map = await mount();
    const a = S.items.value[0].track;
    map.under = overlap;
    act(() => map.fire('mousedown', { ...at(a, 500), originalEvent: { button: 0 }, preventDefault: () => {} }));
    expect(S.scrubbing.value).toBe(true);
    expect(S.selected.value!.id).toBe('A');
    // The cursor follows on the next frame.
    await frame();
    expect(S.cursorT.value).toBe(a.cols.t[500]);
    act(() => { window.dispatchEvent(new MouseEvent('mouseup')); });
    expect(S.scrubbing.value).toBe(false);
  });

  it('keeps the pointer cursor going from a line onto a dot, with one query per hover listener', async () => {
    S.addLoaded([load('central-park-loop.nmea')]);
    const map = await mount();
    const move = () => act(() => map.fire('mousemove', { point: { x: 10, y: 10 } }));
    map.under = { 'tlp-line': [f('A')] };
    move();
    expect(map.canvas.style.cursor).toBe('pointer');
    map.under = { 'tlp-line': [f('A')], 'tlp-mark': [f('B')] };
    move();
    map.under = { 'tlp-mark': [f('B')] };
    const q = map.queries;
    move();
    expect(map.canvas.style.cursor).toBe('pointer');
    expect(map.queries - q).toBe(2);
    map.under = {};
    move();
    expect(map.canvas.style.cursor).toBe('');
  });
});

describe('map labels and style', () => {
  it('labels places in Chinese on a vector basemap, leaving road numbers and house numbers as they are', async () => {
    S.lang.value = 'zh';
    const map = await mount();
    const tf = (id: string) => map.getLayoutProperty(id, 'text-field');
    expect(tf('place_city')).toEqual(ZH_LABEL);
    expect(tf('water_name')).toEqual(ZH_LABEL);
    expect(tf('road_shield')).toBe('{ref}');
    expect(tf('housenumber')).toEqual(['to-string', ['get', 'housenumber']]);
    expect(tf('poi')).toBeUndefined();
  });

  it('reloads the style for a new language on a vector basemap only: raster tiles have their labels drawn in', async () => {
    S.basemap.value = 'osm';
    const map = await mount();
    act(() => { S.lang.value = 'zh'; });
    expect(map.styles).toHaveLength(0);
    act(() => { S.basemap.value = 'light'; });
    expect(map.styles).toHaveLength(1);
    act(() => { S.lang.value = 'en'; });
    expect(map.styles).toHaveLength(2);
  });
});

describe('cursor dots on the map', () => {
  it("sends the logs' dots only while a combined track shows a log, and otherwise clears them once", async () => {
    // Two loggers carried together (not the same recording twice: one stopped a second sooner).
    S.addLoaded([walk('a.gpx'), walk('b.gpx', 6, 299)]);
    const map = await mount();
    const c = S.items.value[0].track.cols;
    const sends = (id: string) => map.data[id].length;
    expect(sends('tlp-log-cursors')).toBe(1);
    const dots = sends('tlp-cursors');
    for (let k = 1; k <= 5; k++) act(() => { S.cursorT.value = c.t[100 + k]; });
    expect(sends('tlp-cursors')).toBe(dots + 5);
    expect(sends('tlp-log-cursors')).toBe(1);
    // Combined, with both logs shown: their dots follow the cursor.
    act(() => { S.ticked.value = ['A', 'B']; S.combineTicked(); });
    expect(S.visible.value.map((x) => x.id)).toEqual(['C']);
    const logs = sends('tlp-log-cursors');
    for (let k = 1; k <= 5; k++) act(() => { S.cursorT.value = c.t[150 + k]; });
    expect(sends('tlp-log-cursors')).toBe(logs + 5);
    // Both logs hidden: cleared once more, then left alone.
    act(() => { S.toggleLog('C', 0); S.toggleLog('C', 1); });
    const off = sends('tlp-log-cursors');
    expect(map.data['tlp-log-cursors'][off - 1]).toEqual({ type: 'FeatureCollection', features: [] });
    for (let k = 1; k <= 5; k++) act(() => { S.cursorT.value = c.t[200 + k]; });
    expect(sends('tlp-log-cursors')).toBe(off);
  });
});

describe("when the basemap's style can't load", () => {
  const NOTICE = "The basemap couldn't load, so the tracks are drawn on a plain background. Try another basemap under Options.";
  /** The error MapLibre fires when the style can't be fetched: it names no source. */
  const fetchFailed = () => ({ error: new Error('Failed to fetch') });
  const notice = () => screen.queryByRole('status');
  /** How many times the map logged an error. */
  const warned = () => vi.mocked(console.warn).mock.calls.filter((c) => c[0] === 'Map:').length;
  const advance = (ms: number) => act(() => { vi.advanceTimersByTime(ms); });

  beforeEach(() => {
    basemapFailed.value = false;
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  /** Shows the map and its buttons, its style still on its way. */
  async function show(): Promise<InstanceType<typeof FakeMap>> {
    render(<><MapView /><MapTools /></>);
    await vi.waitFor(() => expect(FakeMap.current).not.toBeNull());
    return FakeMap.current!;
  }

  it('draws the tracks on a plain background, with a notice, when the style request fails', async () => {
    S.addLoaded([load('central-park-loop.nmea')]);
    const map = await show();
    act(() => map.fire('error', fetchFailed()));
    expect(map.styles).toEqual([plainStyle(false)]);
    // A single background layer, and nothing fetched from anywhere.
    const plain = map.styles[0] as StyleSpecification;
    expect(plain.version).toBe(8);
    expect(plain.layers).toEqual([{ id: 'plain', type: 'background', paint: { 'background-color': PLAIN.light } }]);
    expect(plain.sources).toEqual({});
    expect(plain).not.toHaveProperty('glyphs');
    expect(plain).not.toHaveProperty('sprite');
    expect(notice()?.textContent).toBe(NOTICE);
    // Its style.load comes, and the tracks are drawn.
    act(() => map.loadStyle([]));
    expect(map.getLayer('tlp-line')).toBeDefined();
    expect(map.data['tlp-runs']).toHaveLength(1);
    // The error is logged once, however often it comes, and the plain background is set only once.
    act(() => map.fire('error', fetchFailed()));
    expect(warned()).toBe(1);
    expect(map.styles).toHaveLength(1);
  });

  it('keeps going on a tile error, and once the style has loaded only logs an error', async () => {
    const map = await show();
    // A tile that failed names its source: no news, and no reason to give up on the style.
    act(() => map.fire('error', { error: new Error('Tile not found'), sourceId: 'openmaptiles', tile: {} }));
    expect(map.styles).toHaveLength(0);
    expect(notice()).toBeNull();
    expect(warned()).toBe(0);
    // The style has loaded, though MapLibre may not say so yet (its sprite still loading, say).
    act(() => map.loadStyle(BASE));
    map.loaded = false;
    act(() => map.fire('error', { error: new Error('Could not load sprite') }));
    expect(warned()).toBe(1);
    expect(map.styles).toHaveLength(0);
    expect(notice()).toBeNull();
  });

  it('gives a style from a server a few seconds, and waits for none once one has loaded or for a basemap drawn from tiles', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      const map = await show();
      advance(STYLE_WAIT_MS - 200);
      expect(map.styles).toHaveLength(0);
      advance(200);
      expect(map.styles).toEqual([plainStyle(false)]);
      expect(notice()?.textContent).toBe(NOTICE);
      act(() => map.loadStyle([]));
      // OpenStreetMap's style is part of the app, with no request to wait for.
      act(() => { S.basemap.value = 'osm'; });
      expect(map.styles).toEqual([plainStyle(false), BASEMAPS.osm.style]);
      advance(2 * STYLE_WAIT_MS);
      expect(map.styles).toHaveLength(2);
      // Light again, its style in time this once: nothing more happens.
      act(() => { S.basemap.value = 'light'; });
      expect(map.styles).toEqual([plainStyle(false), BASEMAPS.osm.style, BASEMAPS.light.style]);
      act(() => map.loadStyle(BASE));
      advance(2 * STYLE_WAIT_MS);
      expect(map.styles).toHaveLength(3);
      expect(notice()).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("shows the notice like the app's other notices, where they stand, and puts them below it", async () => {
    const map = await show();
    act(() => map.fire('error', fetchFailed()));
    const box = notice()!;
    expect(box.classList.contains('toast')).toBe(true);
    expect(box.parentElement!.classList.contains('map-notices')).toBe(true);
    // Placed by the notices' own rules, on a computer, in a window too narrow beside the map buttons, and on a phone.
    const css = readFileSync(join(ROOT, 'src', 'styles.css'), 'utf8');
    expect(css).toContain('\n.map-notices, .toasts { position: absolute;');
    expect(css).toContain('\n  .app:not(.panel-min) .map-notices, .app:not(.panel-min) .toasts {');
    expect(css).toContain('.app:not(.panel-min) .map-tools:has(.has-fit.has-compass) ~ .map-notices { --tools-h: 238px; }');
    expect(css).toContain('\n  .map-notices, .toasts { left: var(--edge-l); right: var(--edge-r); top: 64px; }');
    // The other notices go below it.
    expect(css).toMatch(/@supports \(anchor-name: --a\) \{\s*\.map-notices \{ anchor-name: --tlp-map-notices; \}\s*\.app \.map-notices ~ \.toasts \{ top: calc\(anchor\(--tlp-map-notices bottom\) \+ 8px\); \}/);
  });

  it('draws a dark plain background for the dark basemap', async () => {
    S.basemap.value = 'dark';
    const map = await show();
    act(() => map.fire('error', fetchFailed()));
    expect(map.styles).toEqual([plainStyle(true)]);
    expect((map.styles[0] as StyleSpecification).layers).toEqual([{ id: 'plain', type: 'background', paint: { 'background-color': PLAIN.dark } }]);
  });

  it('lets the notice be dismissed, and keeps it out of the way while the Options menu is open', async () => {
    const map = await show();
    act(() => map.fire('error', fetchFailed()));
    act(() => map.loadStyle([]));
    act(() => { S.basemapOpen.value = true; });
    expect(notice()).toBeNull();
    act(() => { S.basemapOpen.value = false; });
    expect(notice()?.textContent).toBe(NOTICE);
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(notice()).toBeNull();
    // The plain background stays.
    expect(map.styles).toHaveLength(1);
  });

  it('keeps the plain background through a new language, and clears the notice when another basemap is picked, which loads as before', async () => {
    S.addLoaded([load('central-park-loop.nmea')]);
    const map = await show();
    act(() => map.fire('error', fetchFailed()));
    act(() => map.loadStyle([]));
    // A plain background has no labels to put in Chinese: it stays, and the notice reads in Chinese.
    act(() => { S.lang.value = 'zh'; });
    expect(map.styles).toHaveLength(1);
    expect(notice()?.textContent).toContain('底图无法加载');
    act(() => { S.basemap.value = 'osm'; });
    expect(notice()).toBeNull();
    expect(map.styles).toEqual([plainStyle(false), BASEMAPS.osm.style]);
    act(() => map.loadStyle(BASE));
    expect(map.getLayer('tlp-line')).toBeDefined();
    expect(map.data['tlp-runs']).toHaveLength(1);
  });
});
