import { useEffect, useRef } from 'preact/hooks';
import { effect, signal } from '@preact/signals';
import type { GeoJSONSource, Map as MlMap, MapLayerMouseEvent, MapLayerTouchEvent, StyleSpecification } from 'maplibre-gl';
// MapLibre looks for its worker next to its own module, which no longer holds
// once Vite bundles it. Have Vite bundle the worker too, and say where it is.
import mapWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import * as S from '../state/store';
import { trackUid, type TrackItem } from '../state/logic';
import { BASEMAPS, basemapFailed, plainStyle, showsName, styleKey, TEXT_FONT, ZH_LABEL } from './basemaps';
import { boundsIn, boundsOf, buildCursors, buildFixPoints, buildFlags, buildGaps, buildLogCursors, buildLogLines, buildMarks, buildPaths, buildRuns, metersPerPixel, nearestFix, showsLogs } from './geojson';
import { CASING, GAP, LEFT_OUT } from '../color/palettes';
import { traceShape, type BadgeShape } from '../color/shapes';
import { mapApi, mapFailed, tipXY } from './bridge';

export { mapApi, mapFailed, tipXY };

const LINE = [2.6, 4.2, 6, 8];
const zoomed = (add: number | unknown[]) =>
  ['interpolate', ['linear'], ['zoom'], 10, plus(LINE[0], add), 14, plus(LINE[1], add), 17, plus(LINE[2], add), 20, plus(LINE[3], add)];
function plus(base: number, add: number | unknown[]) {
  return typeof add === 'number' ? base + add : ['+', base, add];
}

const SOURCES = ['tlp-runs', 'tlp-paths', 'tlp-gaps', 'tlp-logs', 'tlp-fixes', 'tlp-flags', 'tlp-marks', 'tlp-cursors', 'tlp-log-cursors'] as const;
const EMPTY = { type: 'FeatureCollection', features: [] } as const;
/** How long a basemap's style may take to arrive before the map gives up on it and draws on a plain background. */
export const STYLE_WAIT_MS = 8000;
/** Fix glyphs draw from zoom 17; their data is sent a little before that. */
const FIX_GLYPH_ZOOM = 17;
const FIX_DATA_ZOOM = 16.5;
/** The selected track is drawn again on top of the others, picked by global state. */
const SELECTED = ['==', ['get', 'id'], ['global-state', 'sel']];
/**
 * The layers a click or a drag picks a track from. MapLibre lists what it finds
 * topmost first, so with the selected track's own layers (drawn on top) in the
 * list, the selected track wins where tracks overlap.
 */
const PICK = ['tlp-line-sel', 'tlp-casing-sel', 'tlp-line', 'tlp-casing'];
/** A drag starts on a track's casing, which is wider than its line. */
const DRAG = ['tlp-casing-sel', 'tlp-casing'];

const visKey = (vis: TrackItem[]) => vis.map((x) => `${x.id}:${trackUid(x.track)}:${x.fam}`).join('|');

let arrow: ImageData | null = null;

/** The heading-arrow icon, drawn once. A CPU-backed canvas keeps getImageData from forcing a GPU readback. */
function arrowImage(): ImageData {
  if (arrow) return arrow;
  const s = 48;
  const c = document.createElement('canvas');
  c.width = c.height = s;
  const g = c.getContext('2d', { willReadFrequently: true })!;
  g.beginPath();
  g.moveTo(11, 8); g.lineTo(39, 24); g.lineTo(11, 40); g.lineTo(18, 24); g.closePath();
  g.fillStyle = '#ffffff';
  g.strokeStyle = '#0b1016';
  g.lineWidth = 3.2;
  g.lineJoin = 'round';
  g.fill();
  g.stroke();
  arrow = g.getImageData(0, 0, s, s);
  return arrow;
}

/** A dot for a tiny track: its badge's shape and color, with a white rim. Drawn before the dots' data is sent (see markIcon). */
function markImage(shape: BadgeShape, color: string): ImageData {
  const s = 56; // 28 px, drawn at twice the size
  const c = document.createElement('canvas');
  c.width = c.height = s;
  const g = c.getContext('2d', { willReadFrequently: true })!;
  traceShape(g, shape, s / 2, s / 2, 22);
  g.fillStyle = color;
  g.fill();
  g.strokeStyle = '#ffffff';
  g.lineWidth = 5;
  g.lineJoin = 'round';
  g.stroke();
  return g.getImageData(0, 0, s, s);
}

function addOwnLayers(map: MlMap) {
  const d = S.dark.value;
  if (!map.hasImage('tlp-arrow')) map.addImage('tlp-arrow', arrowImage(), { pixelRatio: 2 });
  map.addLayer({ id: 'tlp-fade', type: 'background', paint: { 'background-color': d ? '#000000' : '#ffffff', 'background-opacity': S.dim.value } });
  for (const id of SOURCES) map.addSource(id, { type: 'geojson', data: EMPTY as never });
  const round = { 'line-cap': 'round', 'line-join': 'round' } as const;
  const casing = { 'line-color': d ? CASING.dark : CASING.light, 'line-width': zoomed(2.6) as never };
  const line = { 'line-color': ['get', 'c'], 'line-width': zoomed(0) as never };
  map.addLayer({ id: 'tlp-halo', type: 'line', source: 'tlp-runs', layout: round, paint: { 'line-color': ['get', 'hc'], 'line-opacity': ['get', 'ho'], 'line-width': zoomed(['get', 'hx']) as never } });
  map.addLayer({ id: 'tlp-gap', type: 'line', source: 'tlp-gaps', layout: { 'line-cap': 'round' }, paint: { 'line-color': d ? GAP.dark : GAP.light, 'line-width': 2.4, 'line-dasharray': [0.2, 2] } });
  map.addLayer({ id: 'tlp-casing', type: 'line', source: 'tlp-paths', layout: round, paint: casing as never });
  map.addLayer({ id: 'tlp-line', type: 'line', source: 'tlp-runs', layout: round, paint: line as never });
  map.addLayer({ id: 'tlp-casing-sel', type: 'line', source: 'tlp-paths', filter: SELECTED as never, layout: round, paint: casing as never });
  map.addLayer({ id: 'tlp-line-sel', type: 'line', source: 'tlp-runs', filter: SELECTED as never, layout: round, paint: line as never });
  // A combined track's logs: thin, solid and fainter than tracks, drawn over the combined line so they show
  // where they stray from it; red where a log was left out.
  const out = ['==', ['get', 'out'], 1];
  map.addLayer({
    id: 'tlp-log-line', type: 'line', source: 'tlp-logs', layout: round,
    paint: { 'line-color': ['case', out, LEFT_OUT, ['get', 'c']] as never, 'line-opacity': ['case', out, 0.85, 0.3] as never, 'line-width': ['interpolate', ['linear'], ['zoom'], 10, 1.1, 14, 1.6, 17, 2.4, 20, 3.2] },
  });
  map.addLayer({
    id: 'tlp-arrows', type: 'symbol', source: 'tlp-paths', minzoom: 14,
    layout: { 'symbol-placement': 'line', 'symbol-spacing': 90, 'icon-image': 'tlp-arrow', 'icon-size': ['interpolate', ['linear'], ['zoom'], 14, 0.85, 18, 1.2], 'icon-rotation-alignment': 'map', 'icon-allow-overlap': false, 'icon-padding': 1, visibility: S.showArrows.value ? 'visible' : 'none' },
  });
  map.addLayer({ id: 'tlp-fix-ring', type: 'circle', source: 'tlp-fixes', minzoom: FIX_GLYPH_ZOOM, paint: { 'circle-radius': 8, 'circle-color': '#ffffff', 'circle-stroke-color': ['get', 'r'], 'circle-stroke-width': 2.2 } });
  map.addLayer({ id: 'tlp-fix-text', type: 'symbol', source: 'tlp-fixes', minzoom: FIX_GLYPH_ZOOM, layout: { 'text-field': ['get', 's'], 'text-font': TEXT_FONT, 'text-size': 9, 'text-allow-overlap': true, 'text-ignore-placement': true }, paint: { 'text-color': '#101820' } });
  map.addLayer({ id: 'tlp-flag', type: 'circle', source: 'tlp-flags', paint: { 'circle-radius': 10, 'circle-color': ['get', 'c'], 'circle-stroke-color': '#ffffff', 'circle-stroke-width': 2 } });
  map.addLayer({ id: 'tlp-flag-text', type: 'symbol', source: 'tlp-flags', layout: { 'text-field': ['get', 'label'], 'text-font': TEXT_FONT, 'text-size': 10, 'text-allow-overlap': true }, paint: { 'text-color': '#ffffff' } });
  // Dots for tracks too small to see at this zoom; clicking one zooms to it.
  map.addLayer({ id: 'tlp-mark', type: 'symbol', source: 'tlp-marks', layout: { 'icon-image': ['get', 'icon'], 'icon-allow-overlap': true, 'icon-ignore-placement': true } });
  map.addLayer({ id: 'tlp-mark-text', type: 'symbol', source: 'tlp-marks', layout: { 'text-field': ['get', 'id'], 'text-font': TEXT_FONT, 'text-size': 12, 'text-allow-overlap': true, 'text-ignore-placement': true }, paint: { 'text-color': '#ffffff' } });
  map.addLayer({ id: 'tlp-cursor-ring', type: 'circle', source: 'tlp-cursors', layout: { 'circle-sort-key': ['get', 'z'] }, paint: { 'circle-radius': 10, 'circle-color': '#ffffff' } });
  map.addLayer({ id: 'tlp-cursor', type: 'circle', source: 'tlp-cursors', layout: { 'circle-sort-key': ['get', 'z'] }, paint: { 'circle-radius': 7, 'circle-color': ['get', 'c'], 'circle-stroke-color': '#101820', 'circle-stroke-width': 3 } });
  // The logs' dots at the cursor: hollow with a red ring where a log was left out.
  map.addLayer({
    id: 'tlp-log-cursor', type: 'circle', source: 'tlp-log-cursors',
    paint: { 'circle-radius': 4.6, 'circle-color': ['get', 'c'], 'circle-opacity': ['case', out, 0, 1] as never, 'circle-stroke-color': ['case', out, LEFT_OUT, '#ffffff'] as never, 'circle-stroke-width': ['case', out, 2.6, 1.6] as never },
  });
}

/**
 * Vector basemaps label places in Chinese when the app is in Chinese. Only
 * labels that show a name change: road numbers on shields and house numbers stay.
 */
function applyLabels(map: MlMap) {
  if (!BASEMAPS[S.basemap.value].vector || S.lang.value !== 'zh') return;
  for (const l of map.getStyle().layers ?? []) {
    if (l.type !== 'symbol' || l.id.startsWith('tlp-')) continue;
    if (showsName(map.getLayoutProperty(l.id, 'text-field'))) map.setLayoutProperty(l.id, 'text-field', ZH_LABEL);
  }
}

function setData(map: MlMap, id: (typeof SOURCES)[number], data: unknown) {
  (map.getSource(id) as GeoJSONSource | undefined)?.setData(data as never);
}

type MapLibre = typeof import('maplibre-gl');

/** Creates the map and keeps it in step with the app. Returns the cleanup. */
function start(ml: MapLibre, container: HTMLDivElement): () => void {
  ml.setWorkerUrl(mapWorkerUrl);
  const firstStyle = BASEMAPS[S.basemap.value].style as string | StyleSpecification;
  let map: MlMap;
  try {
    map = new ml.Map({
      container,
      style: firstStyle,
      center: [-73.9655, 40.7705],
      zoom: 12,
      attributionControl: false,
      maxPitch: 0,
      localIdeographFontFamily: "'PingFang SC', 'Microsoft YaHei', 'Noto Sans CJK SC', 'Noto Sans SC', sans-serif",
    });
  } catch {
    mapFailed.value = true;
    return () => {};
  }
  // Becomes true each time a style (and our layers) is ready; effects wait for it.
  const ready = signal(false);
  const zoomedIn = signal(false);
  // The zoom in quarter steps, for the dots that stand in for tiny tracks.
  const zoomStep = signal(0);
  // Last data sent to each source, so unchanged data is never sent again.
  const sent: Record<string, string> = {};
  // Whether the drawn-lines count (for the browser tests) needs refreshing.
  let countStale = true;
  // The browser tests set window.tlpTestHooks to read what the map drew.
  const counting = !!(window as unknown as { tlpTestHooks?: boolean }).tlpTestHooks;
  // For those tests, data-fitting is on from a fit's request until its
  // animation ends, so they measure positions only on a still map.
  const fitting = (on: boolean) => { if (counting) { if (on) container.dataset.fitting = '1'; else delete container.dataset.fitting; } };
  const disposers: (() => void)[] = [];

  // Whether the style asked for last has loaded (its style.load came), and whether it is the plain background.
  let styleUp = false;
  let plain = false;
  let styleTimer: ReturnType<typeof setTimeout> | undefined;
  /**
   * The basemap's style won't load: its server failed or can't be reached, or the
   * request hangs. Without its style.load the tracks would never be drawn, so the map
   * takes the plain background instead, and a notice says so (see MapTools).
   */
  const fallBack = () => {
    clearTimeout(styleTimer);
    if (styleUp || plain) return;
    plain = true;
    basemapFailed.value = true;
    map.setStyle(plainStyle(S.dark.peek()), { diff: false });
  };
  /** A style is on its way. One from a server (a URL) gets a few seconds to arrive. */
  const awaitStyle = (style: string | StyleSpecification) => {
    clearTimeout(styleTimer);
    styleUp = false;
    plain = false;
    if (typeof style === 'string') styleTimer = setTimeout(fallBack, STYLE_WAIT_MS);
  };
  awaitStyle(firstStyle);
  basemapFailed.value = false;

  // Keep fitted tracks clear of whatever covers the map: the side panel (or
  // the bottom sheet on a phone), the timeline and the map buttons.
  const padding = () => {
    const W = window.innerWidth, H = window.innerHeight;
    const p = { top: 70, right: W <= 720 ? 70 : 80, bottom: 40, left: 40 };
    const panel = document.querySelector('.panel')?.getBoundingClientRect();
    const tl = document.querySelector('.timeline')?.getBoundingClientRect();
    if (panel) {
      if (panel.width < W * 0.8) p.left = Math.max(p.left, panel.right + 24);
      else p.bottom = Math.max(p.bottom, H - panel.top + 24);
    }
    if (tl) p.bottom = Math.max(p.bottom, H - tl.top + 24);
    // Never pad more than the map can give.
    const shrink = (a: 'left' | 'right' | 'top' | 'bottom', b: 'left' | 'right' | 'top' | 'bottom', size: number) => {
      const over = p[a] + p[b] - (size - 80);
      if (over > 0) { const k = (size - 80) / (p[a] + p[b]); p[a] = Math.floor(p[a] * k); p[b] = Math.floor(p[b] * k); }
    };
    shrink('left', 'right', W);
    shrink('top', 'bottom', H);
    return p;
  };
  const fit = (range?: [number, number]) => {
    const b = range ? boundsIn(S.visible.peek(), S.offsets.peek(), range) : boundsOf(S.visible.peek());
    if (!b) { fitting(false); return; }
    fitting(true);
    map.fitBounds([[b[0], b[1]], [b[2], b[3]]], { padding: padding(), maxZoom: 16, duration: 500 });
    // The map is idle only once no camera animation is left, even if fits overlap.
    map.once('idle', () => fitting(false));
  };
  mapApi.zoomIn = () => map.zoomIn();
  mapApi.zoomOut = () => map.zoomOut();
  mapApi.north = () => map.resetNorthPitch();
  mapApi.fit = fit;

  /** Sends data to a source only when its key changed since the last send. */
  const send = (id: (typeof SOURCES)[number], key: string, build: () => unknown) => {
    if (sent[id] === key) return;
    sent[id] = key;
    setData(map, id, build());
    countStale = true;
  };

  const placeTip = () => {
    const sel = S.cursorItem.value;
    const t = S.cursorT.value;
    if (!sel || !sel.vis || t === null) { tipXY.value = null; return; }
    const cols = sel.track.cols;
    const tt = S.trackTime(sel.id, t);
    if (tt < cols.t[0] - 5000 || tt > cols.t[cols.n - 1] + 5000) { tipXY.value = null; return; }
    let lo = 0, hi = cols.n - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (cols.t[m] <= tt) lo = m; else hi = m; }
    const i = tt - cols.t[lo] <= cols.t[hi] - tt ? lo : hi;
    const p = map.project([cols.lon[i], cols.lat[i]]);
    tipXY.value = { x: p.x, y: p.y };
  };

  /**
   * The icon of a dot for a track too small to see: its badge shape in its color. The marks
   * effect draws each one before sending the dots, also after a basemap change clears the icons.
   */
  const markIcon = (id: string) => {
    const m = /^tlp-mark-(circle|square|hexagon|diamond)-([0-9a-f]{6})$/i.exec(id);
    if (m && !map.hasImage(id)) map.addImage(id, markImage(m[1] as BadgeShape, `#${m[2]}`), { pixelRatio: 2 });
  };
  // A fallback: the dots' icons are drawn before their data is sent (see the marks effect), so MapLibre
  // never has to ask; when it asks for an icon it doesn't have, the dot may never be drawn.
  map.on('styleimagemissing', (e: { id: string }) => markIcon(e.id));
  map.on('style.load', () => {
    styleUp = true;
    clearTimeout(styleTimer);
    addOwnLayers(map);
    applyLabels(map);
    for (const k of Object.keys(sent)) delete sent[k];
    countStale = true;
    ready.value = true;
  });
  map.on('move', placeTip);
  map.on('zoomend', () => {
    zoomedIn.value = map.getZoom() >= FIX_DATA_ZOOM;
    zoomStep.value = Math.round(map.getZoom() * 4) / 4;
  });
  map.on('moveend', () => {
    countStale = true;
    const c = map.getCenter();
    S.mapView.value = { lat: c.lat, lon: c.lng, zoom: map.getZoom(), bearing: map.getBearing(), pitch: map.getPitch() };
  });
  // A tile that failed to load (its error names its source) is no news: the map keeps going. Any other
  // error is logged, once. Before the style has loaded, an error means it won't: the map falls back.
  const logged = new Set<string>();
  map.on('error', (e) => {
    if ((e as { sourceId?: unknown }).sourceId) return;
    const text = String(e.error?.message ?? e.error);
    if (!logged.has(text)) {
      logged.add(text);
      console.warn('Map:', e.error);
    }
    if (!styleUp && !map.isStyleLoaded()) fallBack();
  });
  // How many track lines are drawn, for the browser tests only. Counting
  // queries every drawn feature, so it runs only after the data, view or
  // selection changed.
  map.on('idle', () => {
    if (!counting || !ready.peek() || !countStale) return;
    countStale = false;
    try {
      container.dataset.lines = String(map.queryRenderedFeatures({ layers: ['tlp-line'] }).length);
      container.dataset.selLines = String(map.queryRenderedFeatures({ layers: ['tlp-line-sel'] }).length);
      const logLines = map.queryRenderedFeatures({ layers: ['tlp-log-line'] });
      container.dataset.logLines = String(logLines.length);
      container.dataset.logOut = String(logLines.filter((f) => f.properties?.out === 1).length);
      const marks = map.queryRenderedFeatures({ layers: ['tlp-mark'] });
      container.dataset.marks = String(marks.length);
      const at = marks[0] ? map.project((marks[0].geometry as unknown as { coordinates: [number, number] }).coordinates) : null;
      container.dataset.markAt = at ? `${Math.round(at.x)},${Math.round(at.y)}` : '';
    } catch { /* style changing */ }
  });

  /**
   * The fix of a track nearest to a point. While dragging, `prev` is the last
   * fix picked: where the track passes the same place twice, a fix close to it
   * wins when it is about as near (within 12 pixels at this zoom), so the
   * cursor stays on the same pass.
   */
  const fixNear = (it: TrackItem, ll: { lat: number; lng: number }, prev: number): number =>
    nearestFix(it.track.cols, ll.lat, ll.lng, prev, 12 * metersPerPixel(ll.lat, map.getZoom()));
  const itemAt = (id: unknown) => (typeof id === 'string' ? S.items.peek().find((x) => x.id === id) : undefined);

  // Clicking a track line selects it and moves the cursor to the nearest fix.
  // Clicking anywhere else removes the cursor, which closes the fix card.
  map.on('click', (e) => {
    if (!ready.peek()) return;
    // A dot for a track too small to see: select that track and zoom to it.
    const dot = itemAt(map.queryRenderedFeatures(e.point, { layers: ['tlp-mark'] })[0]?.properties?.id);
    if (dot) {
      S.select(dot.id);
      const b = dot.track.derived.stats.bbox;
      map.fitBounds([[b[0], b[1]], [b[2], b[3]]], { padding: padding(), maxZoom: 16, duration: 500 });
      return;
    }
    const hit = map.queryRenderedFeatures([[e.point.x - 6, e.point.y - 6], [e.point.x + 6, e.point.y + 6]], { layers: PICK });
    const it = itemAt(hit[0]?.properties?.id);
    if (!it) { S.clearCursor(); return; }
    S.select(it.id);
    S.seek(it.id, it.track.cols.t[fixNear(it, e.lngLat, -1)]);
  });

  // Pressing on a track and dragging moves the cursor along it, like the
  // timeline does, and the fix card follows. The map doesn't pan meanwhile.
  let scrubId: string | null = null;
  let scrubPrev = -1;
  let scrubAt: { lat: number; lng: number } | null = null;
  let scrubFrame = 0;
  const scrubTo = (ll: { lat: number; lng: number }) => {
    scrubAt = ll;
    if (scrubFrame) return;
    scrubFrame = requestAnimationFrame(() => {
      scrubFrame = 0;
      const it = itemAt(scrubId);
      if (!it || !scrubAt) return;
      scrubPrev = fixNear(it, scrubAt, scrubPrev);
      S.seek(it.id, it.track.cols.t[scrubPrev]);
    });
  };
  const startScrub = (e: MapLayerMouseEvent | MapLayerTouchEvent) => {
    const it = ready.peek() ? itemAt(e.features?.[0]?.properties?.id) : undefined;
    if (!it) return;
    e.preventDefault(); // keeps the map from panning
    scrubId = it.id;
    scrubPrev = -1;
    S.scrubbing.value = true;
    S.select(it.id);
    map.getCanvas().style.cursor = 'grabbing';
    scrubTo(e.lngLat);
  };
  const endScrub = () => {
    if (!scrubId) return;
    scrubId = null;
    S.scrubbing.value = false;
    map.getCanvas().style.cursor = '';
  };
  map.on('mousedown', DRAG, (e) => { if (e.originalEvent.button === 0) startScrub(e); });
  map.on('touchstart', DRAG, (e) => { if (e.points.length === 1) startScrub(e); });
  map.on('mousemove', (e) => { if (scrubId) scrubTo(e.lngLat); });
  map.on('touchmove', (e) => { if (scrubId) scrubTo(e.lngLat); });
  map.on('touchend', endScrub);
  map.on('touchcancel', endScrub);
  window.addEventListener('mouseup', endScrub);
  disposers.push(() => { window.removeEventListener('mouseup', endScrub); cancelAnimationFrame(scrubFrame); });
  // Hover listeners query features on every mouse move: one pair for the lines and the dots
  // together, so a move costs half the queries, and going from a line onto a dot keeps the pointer.
  map.on('mouseenter', ['tlp-line', 'tlp-mark'], () => { map.getCanvas().style.cursor = 'pointer'; });
  map.on('mouseleave', ['tlp-line', 'tlp-mark'], () => { map.getCanvas().style.cursor = ''; });

  // A new basemap loads its style; so does a new language, but only on a vector basemap (whose labels follow it).
  let lastStyle = styleKey(S.basemap.peek(), S.lang.peek());
  let lastId = S.basemap.peek();
  disposers.push(effect(() => {
    const id = S.basemap.value;
    const key = styleKey(id, S.lang.value);
    if (key === lastStyle) return;
    lastStyle = key;
    // The plain background has no labels to change: it stays until another basemap is picked.
    if (plain && id === lastId) return;
    lastId = id;
    ready.value = false;
    // A new style on its way: a notice about the last one goes.
    basemapFailed.value = false;
    const style = BASEMAPS[id].style as string | StyleSpecification;
    awaitStyle(style);
    map.setStyle(style, { diff: false });
  }));

  // Each source has its own effect, reading only what it depends on, so a
  // change to one input never rebuilds data for the others.
  disposers.push(effect(() => {
    if (!ready.value) return;
    const vis = S.visible.value, single = S.single.value, dark = S.dark.value;
    const scaleKey = vis.map((x) => [x.color, x.halo].map((k) => (k === 'none' || k === 'off' ? k : `${k}=${S.scaleFor(x.track, k).edges.join(',')}`)).join('/')).join('|');
    send('tlp-runs', `${visKey(vis)}#${scaleKey}#${single}#${dark}`, () => buildRuns(vis, { dark, single, selectedId: null, scaleFor: S.scaleFor }));
  }));
  disposers.push(effect(() => {
    if (!ready.value) return;
    const vis = S.visible.value;
    send('tlp-paths', visKey(vis), () => buildPaths(vis));
    send('tlp-flags', visKey(vis), () => buildFlags(vis));
  }));
  disposers.push(effect(() => {
    if (!ready.value) return;
    const vis = S.visible.value;
    const marks = buildMarks(vis, zoomStep.value || map.getZoom());
    for (const f of marks.features) markIcon(String(f.properties.icon));
    send('tlp-marks', `${visKey(vis)}#${marks.features.map((f) => f.properties.id).join(',')}`, () => marks);
  }));
  disposers.push(effect(() => {
    if (!ready.value) return;
    const vis = S.visible.value, on = S.showGaps.value;
    send('tlp-gaps', `${visKey(vis)}#${on}`, () => (on ? buildGaps(vis) : EMPTY));
  }));
  disposers.push(effect(() => {
    if (!ready.value) return;
    const vis = S.visible.value;
    send('tlp-logs', `${visKey(vis)}#${vis.map((x) => x.logs?.map(Number).join('') ?? '').join('|')}`, () => buildLogLines(vis));
  }));
  disposers.push(effect(() => {
    if (!ready.value) return;
    // Up to 100,000s of points: only send them when zoomed in enough to draw them.
    const vis = S.visible.value, on = S.showFixes.value && zoomedIn.value;
    send('tlp-fixes', on ? visKey(vis) : 'off', () => (on ? buildFixPoints(vis) : EMPTY));
  }));
  disposers.push(effect(() => {
    if (!ready.value) return;
    map.setLayoutProperty('tlp-arrows', 'visibility', S.showArrows.value ? 'visible' : 'none');
  }));
  disposers.push(effect(() => {
    if (!ready.value) return;
    map.setGlobalStateProperty('sel', S.selected.value?.id ?? '');
    countStale = true;
  }));
  disposers.push(effect(() => {
    if (!ready.value) return;
    const vis = S.visible.value, offsets = S.offsets.value, at = S.cursorT.value;
    const ctx = { dark: S.dark.value, single: S.single.value, selectedId: S.selected.value?.id ?? null, scaleFor: S.scaleFor };
    setData(map, 'tlp-cursors', buildCursors(vis, offsets, at, ctx));
    // The logs' dots follow the cursor only while a combined track shows a log; otherwise they're cleared once.
    if (showsLogs(vis)) { delete sent['tlp-log-cursors']; setData(map, 'tlp-log-cursors', buildLogCursors(vis, offsets, at)); }
    else send('tlp-log-cursors', 'none', () => EMPTY);
    placeTip();
  }));
  disposers.push(effect(() => {
    const v = S.dim.value;
    if (ready.value && map.getLayer('tlp-fade')) map.setPaintProperty('tlp-fade', 'background-opacity', v);
  }));
  let lastFit = S.fitRequest.peek();
  disposers.push(effect(() => {
    const f = S.fitRequest.value;
    if (f === lastFit) return;
    lastFit = f;
    fitting(true);
    // Fit after the panel and timeline have rendered, so the padding sees them.
    if (ready.peek()) requestAnimationFrame(() => requestAnimationFrame(() => fit())); else map.once('idle', () => fit());
  }));

  const ro = new ResizeObserver(() => map.resize());
  ro.observe(container);

  return () => {
    ro.disconnect();
    clearTimeout(styleTimer);
    basemapFailed.value = false;
    disposers.forEach((d) => d());
    map.remove();
  };
}

export function MapView() {
  const el = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // MapLibre is large: load it after the interface has rendered.
    let stop: (() => void) | null = null;
    let cancelled = false;
    Promise.all([import('maplibre-gl'), import('maplibre-gl/dist/maplibre-gl.css')])
      .then(([ml]) => { if (!cancelled && el.current) stop = start(ml, el.current); })
      .catch(() => { mapFailed.value = true; });
    return () => { cancelled = true; stop?.(); };
  }, []);

  return <div ref={el} class="map" />;
}
