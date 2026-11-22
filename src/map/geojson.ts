// Turns tracks into GeoJSON for the map layers. Pure functions, so the
// coloring rules are unit-tested without a WebGL map.
import type { LoadedTrack, MeasureKey } from '../model/types';
import type { TrackItem } from '../state/logic';
import { nearestIndex } from '../state/logic';
import { stepOf, valueAt, type Scale } from '../color/scale';
import { FAMILIES, haloExtra, haloStyle, palette, UNKNOWN } from '../color/palettes';

export interface Feature<G> { type: 'Feature'; geometry: G; properties: Record<string, string | number> }
export interface LineString { type: 'LineString'; coordinates: [number, number][] }
export interface Point { type: 'Point'; coordinates: [number, number] }
export interface FC<G> { type: 'FeatureCollection'; features: Feature<G>[] }

export interface MapCtx {
  dark: boolean;
  single: boolean;
  selectedId: string | null;
  scaleFor: (track: LoadedTrack, key: MeasureKey) => Scale;
}

const fc = <G>(features: Feature<G>[]): FC<G> => ({ type: 'FeatureCollection', features });

/** Step per fix, with lone one-fix flickers merged into their neighbors. */
export function stepsFor(track: LoadedTrack, key: MeasureKey, scale: Scale): Int8Array {
  const n = track.cols.n;
  const s = new Int8Array(n);
  for (let i = 0; i < n; i++) s[i] = stepOf(scale, valueAt(track, key, i));
  for (let i = 1; i < n - 1; i++) if (s[i - 1] === s[i + 1] && s[i] !== s[i - 1]) s[i] = s[i - 1];
  return s;
}

/** Badge color of a track (its range's badge), used for its pins and fix rings. */
export function badgeColor(item: TrackItem, _single: boolean): string {
  return FAMILIES[item.fam % 3].badge;
}

/** Colored runs of the line, each with its halo width and opacity. */
export function buildRuns(items: TrackItem[], ctx: MapCtx): FC<LineString> {
  const out: Feature<LineString>[] = [];
  for (const it of items) {
    if (!it.vis) continue;
    const { lat, lon, n } = it.track.cols;
    const gap = it.track.derived.gap;
    const colors = palette(it.fam, it.color, ctx.dark, ctx.single);
    const cs = it.color === 'none' ? null : ctx.scaleFor(it.track, it.color);
    const csteps = cs ? stepsFor(it.track, it.color as MeasureKey, cs) : null;
    const hsScale = it.halo === 'off' ? null : ctx.scaleFor(it.track, it.halo);
    const hsteps = hsScale ? stepsFor(it.track, it.halo as MeasureKey, hsScale) : null;
    const extra = hsScale ? haloExtra(hsScale.steps) : [];
    const hs = haloStyle(it.fam, ctx.dark, ctx.single);
    const z = it.id === ctx.selectedId ? 2 : 1;
    let k = -9, h = -9;
    let coords: [number, number][] | null = null;
    const close = () => {
      if (!coords || coords.length < 2) return;
      out.push({
        type: 'Feature', geometry: { type: 'LineString', coordinates: coords },
        properties: {
          id: it.id, z,
          c: k >= 0 ? colors[Math.min(k, colors.length - 1)] : ctx.dark ? UNKNOWN.dark : UNKNOWN.light,
          hc: hs.color, ho: h >= 0 ? hs.opacity : 0, hx: h >= 0 ? extra[h] : 0,
        },
      });
    };
    for (let i = 1; i < n; i++) {
      if (gap[i]) { close(); coords = null; k = h = -9; continue; }
      const ki = csteps ? csteps[i] : 0;
      const hi = hsteps ? hsteps[i] : -1;
      if (!coords || ki !== k || hi !== h) {
        close();
        coords = [[lon[i - 1], lat[i - 1]]];
        k = ki;
        h = hi;
      }
      coords.push([lon[i], lat[i]]);
    }
    close();
  }
  return fc(out);
}

/** One line per gap-free stretch, for the casing and the heading arrows. */
export function buildPaths(items: TrackItem[], ctx: MapCtx): FC<LineString> {
  const out: Feature<LineString>[] = [];
  for (const it of items) {
    if (!it.vis) continue;
    const { lat, lon, n } = it.track.cols;
    const gap = it.track.derived.gap;
    const z = it.id === ctx.selectedId ? 2 : 1;
    let coords: [number, number][] = [];
    const close = () => {
      if (coords.length >= 2) out.push({ type: 'Feature', geometry: { type: 'LineString', coordinates: coords }, properties: { id: it.id, z } });
      coords = [];
    };
    for (let i = 0; i < n; i++) {
      if (i > 0 && gap[i]) close();
      coords.push([lon[i], lat[i]]);
    }
    close();
  }
  return fc(out);
}

/** Straight dashed lines across gaps, where the logger had no fix. */
export function buildGaps(items: TrackItem[]): FC<LineString> {
  const out: Feature<LineString>[] = [];
  for (const it of items) {
    if (!it.vis) continue;
    const { lat, lon, n, t } = it.track.cols;
    const gap = it.track.derived.gap;
    for (let i = 1; i < n; i++) {
      if (!gap[i]) continue;
      out.push({
        type: 'Feature', geometry: { type: 'LineString', coordinates: [[lon[i - 1], lat[i - 1]], [lon[i], lat[i]]] },
        properties: { id: it.id, s: Math.round((t[i] - t[i - 1]) / 1000) },
      });
    }
  }
  return fc(out);
}

/** One point per fix with its satellite count, drawn as glyphs when zoomed in. */
export function buildFixPoints(items: TrackItem[], ctx: MapCtx): FC<Point> {
  const out: Feature<Point>[] = [];
  for (const it of items) {
    if (!it.vis) continue;
    const { lat, lon, n, sats, fixq } = it.track.cols;
    const ring = badgeColor(it, ctx.single);
    for (let i = 0; i < n; i++) {
      out.push({
        type: 'Feature', geometry: { type: 'Point', coordinates: [lon[i], lat[i]] },
        properties: { id: it.id, i, s: Number.isFinite(sats[i]) ? String(sats[i]) : '', q: fixq[i], r: ring },
      });
    }
  }
  return fc(out);
}

/** Button presses, numbered. */
export function buildFlags(items: TrackItem[], ctx: MapCtx): FC<Point> {
  const out: Feature<Point>[] = [];
  for (const it of items) {
    if (!it.vis) continue;
    for (const f of it.track.flags) {
      out.push({ type: 'Feature', geometry: { type: 'Point', coordinates: [f.lon, f.lat] }, properties: { id: it.id, label: `#${f.n}`, c: badgeColor(it, ctx.single) } });
    }
  }
  return fc(out);
}

/** One dot per visible track at the cursor time. */
export function buildCursors(items: TrackItem[], offsets: Record<string, number>, axisT: number | null, ctx: MapCtx): FC<Point> {
  if (axisT === null) return fc([]);
  const out: Feature<Point>[] = [];
  for (const it of items) {
    if (!it.vis) continue;
    const c = it.track.cols;
    const tt = axisT - (offsets[it.id] ?? 0);
    if (tt < c.t[0] - 5000 || tt > c.t[c.n - 1] + 5000) continue;
    const i = nearestIndex(c.t, tt);
    const colors = palette(it.fam, it.color, ctx.dark, ctx.single);
    let col = colors[0];
    if (it.color !== 'none') {
      const k = stepOf(ctx.scaleFor(it.track, it.color), valueAt(it.track, it.color, i));
      col = k >= 0 ? colors[Math.min(k, colors.length - 1)] : ctx.dark ? UNKNOWN.dark : UNKNOWN.light;
    }
    out.push({ type: 'Feature', geometry: { type: 'Point', coordinates: [c.lon[i], c.lat[i]] }, properties: { id: it.id, i, c: col, z: it.id === ctx.selectedId ? 2 : 1 } });
  }
  return fc(out);
}

/** Bounds of the visible tracks [west, south, east, north], or null. */
export function boundsOf(items: TrackItem[]): [number, number, number, number] | null {
  let w = 180, s = 90, e = -180, n = -90, any = false;
  for (const it of items) {
    if (!it.vis) continue;
    const b = it.track.derived.stats.bbox;
    any = true;
    w = Math.min(w, b[0]); s = Math.min(s, b[1]); e = Math.max(e, b[2]); n = Math.max(n, b[3]);
  }
  return any ? [w, s, e, n] : null;
}
