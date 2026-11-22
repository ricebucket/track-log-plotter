import { useEffect, useRef } from 'preact/hooks';
import { effect } from '@preact/signals';
import { Map as MlMap, setWorkerUrl, type GeoJSONSource, type StyleSpecification } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
// MapLibre looks for its worker next to its own module, which no longer holds
// once Vite bundles it. Have Vite bundle the worker too, and say where it is.
import mapWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';

setWorkerUrl(mapWorkerUrl);
import * as S from '../state/store';
import { BASEMAPS, TEXT_FONT, ZH_LABEL } from './basemaps';
import { boundsOf, buildCursors, buildFixPoints, buildFlags, buildGaps, buildPaths, buildRuns, type MapCtx } from './geojson';
import { CASING, GAP } from '../color/palettes';
import { haversine } from '../derive/geo';
import { mapApi, mapFailed, tipXY } from './bridge';

export { mapApi, mapFailed, tipXY };

const LINE = [2.6, 4.2, 6, 8];
const zoomed = (add: number | unknown[]) =>
  ['interpolate', ['linear'], ['zoom'], 10, plus(LINE[0], add), 14, plus(LINE[1], add), 17, plus(LINE[2], add), 20, plus(LINE[3], add)];
function plus(base: number, add: number | unknown[]) {
  return typeof add === 'number' ? base + add : ['+', base, add];
}

const SOURCES = ['tlp-runs', 'tlp-paths', 'tlp-gaps', 'tlp-fixes', 'tlp-flags', 'tlp-cursors'] as const;
const EMPTY = { type: 'FeatureCollection', features: [] } as const;

function ctx(): MapCtx {
  return { dark: S.dark.value, single: S.single.value, selectedId: S.selected.value?.id ?? null, scaleFor: S.scaleFor };
}

function arrowImage(): ImageData {
  const s = 32;
  const c = document.createElement('canvas');
  c.width = c.height = s;
  const g = c.getContext('2d')!;
  g.beginPath();
  g.moveTo(9, 7); g.lineTo(24, 16); g.lineTo(9, 25); g.lineTo(13, 16); g.closePath();
  g.fillStyle = '#ffffff';
  g.strokeStyle = '#0b1016';
  g.lineWidth = 2;
  g.lineJoin = 'round';
  g.fill();
  g.stroke();
  return g.getImageData(0, 0, s, s);
}

function addOwnLayers(map: MlMap) {
  const d = S.dark.value;
  if (!map.hasImage('tlp-arrow')) map.addImage('tlp-arrow', arrowImage(), { pixelRatio: 2 });
  map.addLayer({ id: 'tlp-fade', type: 'background', paint: { 'background-color': d ? '#000000' : '#ffffff', 'background-opacity': S.dim.value } });
  for (const id of SOURCES) map.addSource(id, { type: 'geojson', data: EMPTY as never });
  const round = { 'line-cap': 'round', 'line-join': 'round', 'line-sort-key': ['get', 'z'] } as const;
  map.addLayer({ id: 'tlp-halo', type: 'line', source: 'tlp-runs', layout: round as never, paint: { 'line-color': ['get', 'hc'], 'line-opacity': ['get', 'ho'], 'line-width': zoomed(['get', 'hx']) as never } });
  map.addLayer({ id: 'tlp-gap', type: 'line', source: 'tlp-gaps', layout: { 'line-cap': 'round' }, paint: { 'line-color': d ? GAP.dark : GAP.light, 'line-width': 2.4, 'line-dasharray': [0.2, 2] } });
  map.addLayer({ id: 'tlp-casing', type: 'line', source: 'tlp-paths', layout: round as never, paint: { 'line-color': d ? CASING.dark : CASING.light, 'line-width': zoomed(2.6) as never } });
  map.addLayer({ id: 'tlp-line', type: 'line', source: 'tlp-runs', layout: round as never, paint: { 'line-color': ['get', 'c'], 'line-width': zoomed(0) as never } });
  map.addLayer({
    id: 'tlp-arrows', type: 'symbol', source: 'tlp-paths', minzoom: 14,
    layout: { 'symbol-placement': 'line', 'symbol-spacing': 70, 'icon-image': 'tlp-arrow', 'icon-size': ['interpolate', ['linear'], ['zoom'], 14, 0.7, 18, 1], 'icon-rotation-alignment': 'map', 'icon-allow-overlap': false, 'icon-padding': 1 },
  });
  map.addLayer({ id: 'tlp-fix-ring', type: 'circle', source: 'tlp-fixes', minzoom: 17, paint: { 'circle-radius': 8, 'circle-color': '#ffffff', 'circle-stroke-color': ['get', 'r'], 'circle-stroke-width': 2.2 } });
  map.addLayer({ id: 'tlp-fix-text', type: 'symbol', source: 'tlp-fixes', minzoom: 17, layout: { 'text-field': ['get', 's'], 'text-font': TEXT_FONT, 'text-size': 9, 'text-allow-overlap': true, 'text-ignore-placement': true }, paint: { 'text-color': '#101820' } });
  map.addLayer({ id: 'tlp-flag', type: 'circle', source: 'tlp-flags', paint: { 'circle-radius': 10, 'circle-color': ['get', 'c'], 'circle-stroke-color': '#ffffff', 'circle-stroke-width': 2 } });
  map.addLayer({ id: 'tlp-flag-text', type: 'symbol', source: 'tlp-flags', layout: { 'text-field': ['get', 'label'], 'text-font': TEXT_FONT, 'text-size': 10, 'text-allow-overlap': true }, paint: { 'text-color': '#ffffff' } });
  map.addLayer({ id: 'tlp-cursor-ring', type: 'circle', source: 'tlp-cursors', paint: { 'circle-radius': 10, 'circle-color': '#ffffff' } });
  map.addLayer({ id: 'tlp-cursor', type: 'circle', source: 'tlp-cursors', paint: { 'circle-radius': 7, 'circle-color': ['get', 'c'], 'circle-stroke-color': '#101820', 'circle-stroke-width': 3 } });
}

/** Vector basemaps label places in Chinese when the app is in Chinese. */
function applyLabels(map: MlMap) {
  if (!BASEMAPS[S.basemap.value].vector || S.lang.value !== 'zh') return;
  for (const l of map.getStyle().layers ?? []) {
    if (l.type !== 'symbol' || l.id.startsWith('tlp-')) continue;
    const tf = map.getLayoutProperty(l.id, 'text-field');
    if (tf) map.setLayoutProperty(l.id, 'text-field', ZH_LABEL);
  }
}

function setData(map: MlMap, id: (typeof SOURCES)[number], data: unknown) {
  (map.getSource(id) as GeoJSONSource | undefined)?.setData(data as never);
}

export function MapView() {
  const el = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let map: MlMap;
    try {
      map = new MlMap({
        container: el.current!,
        style: BASEMAPS[S.basemap.value].style as string | StyleSpecification,
        center: [-73.9655, 40.7705],
        zoom: 12,
        attributionControl: false,
        maxPitch: 0,
        localIdeographFontFamily: "'PingFang SC', 'Microsoft YaHei', 'Noto Sans CJK SC', 'Noto Sans SC', sans-serif",
      });
    } catch {
      mapFailed.value = true;
      return;
    }
    let ready = false;
    const disposers: (() => void)[] = [];

    const padding = () => {
      const narrow = window.innerWidth <= 720;
      return {
        top: 80,
        right: narrow ? 24 : 80,
        left: narrow || S.panelMin.value || S.items.value.length === 0 ? 40 : 420,
        bottom: narrow ? Math.round(window.innerHeight * 0.5) : S.timelineMin.value ? 80 : 270,
      };
    };
    const fit = () => {
      const b = boundsOf(S.visible.value);
      if (!b) return;
      map.fitBounds([[b[0], b[1]], [b[2], b[3]]], { padding: padding(), maxZoom: 16, duration: 500 });
    };
    mapApi.zoomIn = () => map.zoomIn();
    mapApi.zoomOut = () => map.zoomOut();
    mapApi.north = () => map.resetNorth();
    mapApi.fit = fit;

    const pushTracks = () => {
      if (!ready) return;
      const c = ctx();
      const vis = S.visible.value;
      setData(map, 'tlp-runs', buildRuns(vis, c));
      setData(map, 'tlp-paths', buildPaths(vis, c));
      setData(map, 'tlp-gaps', S.showGaps.value ? buildGaps(vis) : EMPTY);
      setData(map, 'tlp-fixes', S.showFixes.value ? buildFixPoints(vis, c) : EMPTY);
      setData(map, 'tlp-flags', buildFlags(vis, c));
      map.setLayoutProperty('tlp-arrows', 'visibility', S.showArrows.value ? 'visible' : 'none');
    };
    const pushCursor = () => {
      if (!ready) return;
      setData(map, 'tlp-cursors', buildCursors(S.visible.value, S.offsets.value, S.cursorT.value, ctx()));
      placeTip();
    };
    const placeTip = () => {
      const sel = S.selected.value;
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

    map.on('style.load', () => {
      addOwnLayers(map);
      applyLabels(map);
      ready = true;
      pushTracks();
      pushCursor();
    });
    map.on('move', placeTip);
    map.on('moveend', () => {
      const c = map.getCenter();
      S.mapView.value = { lat: c.lat, lon: c.lng, zoom: map.getZoom(), bearing: map.getBearing() };
    });
    map.on('error', () => { /* a tile failed to load; the map keeps going */ });
    // How many track lines are drawn, for the browser tests.
    map.on('idle', () => {
      if (!ready || !el.current) return;
      try { el.current.dataset.lines = String(map.queryRenderedFeatures({ layers: ['tlp-line'] }).length); } catch { /* style changing */ }
    });

    // Clicking a track line selects it and moves the cursor to the nearest fix.
    map.on('click', (e) => {
      if (!ready) return;
      const hit = map.queryRenderedFeatures([[e.point.x - 6, e.point.y - 6], [e.point.x + 6, e.point.y + 6]], { layers: ['tlp-line', 'tlp-casing'] });
      const id = hit[0]?.properties?.id as string | undefined;
      const it = id ? S.items.value.find((x) => x.id === id) : undefined;
      if (!it) return;
      S.select(it.id);
      const c = it.track.cols;
      let best = 0, bd = Infinity;
      for (let i = 0; i < c.n; i++) {
        const dd = haversine(e.lngLat.lat, e.lngLat.lng, c.lat[i], c.lon[i]);
        if (dd < bd) { bd = dd; best = i; }
      }
      S.seek(it.id, c.t[best]);
    });
    for (const layer of ['tlp-line', 'tlp-casing']) {
      map.on('mouseenter', layer, () => { map.getCanvas().style.cursor = 'pointer'; });
      map.on('mouseleave', layer, () => { map.getCanvas().style.cursor = ''; });
    }

    let lastStyle = S.basemap.value + S.lang.value;
    disposers.push(effect(() => {
      const key = S.basemap.value + S.lang.value;
      if (key === lastStyle) return;
      lastStyle = key;
      ready = false;
      map.setStyle(BASEMAPS[S.basemap.value].style as string | StyleSpecification, { diff: false });
    }));
    disposers.push(effect(() => {
      // Read every input so the effect re-runs when any of them changes.
      void S.visible.value; void S.scales.value; void S.single.value; void S.dark.value; void S.selected.value;
      void S.showArrows.value; void S.showFixes.value; void S.showGaps.value;
      pushTracks();
      pushCursor();
    }));
    disposers.push(effect(() => {
      void S.cursorT.value; void S.offsets.value;
      pushCursor();
    }));
    disposers.push(effect(() => {
      const v = S.dim.value;
      if (ready && map.getLayer('tlp-fade')) map.setPaintProperty('tlp-fade', 'background-opacity', v);
    }));
    let lastFit = S.fitRequest.value;
    disposers.push(effect(() => {
      const f = S.fitRequest.value;
      if (f === lastFit) return;
      lastFit = f;
      if (ready) fit(); else map.once('idle', fit);
    }));

    const ro = new ResizeObserver(() => map.resize());
    ro.observe(el.current!);

    return () => {
      ro.disconnect();
      disposers.forEach((d) => d());
      map.remove();
    };
  }, []);

  return <div ref={el} class="map" />;
}
