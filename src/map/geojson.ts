// Turns tracks into GeoJSON for the map layers. Pure functions, so the
// coloring rules are unit-tested without a WebGL map.
import type { Columns, LoadedTrack, MeasureKey } from '../model/types';
import type { TrackItem } from '../state/logic';
import { nearestIndex } from '../state/logic';
import { haversine } from '../derive/geo';
import { FORMAT_SHAPE } from '../color/shapes';
import { stepOf, valueAt, type Scale } from '../color/scale';
import { FAMILIES, haloExtra, haloStyle, LOG_COLORS, palette, UNKNOWN } from '../color/palettes';
import { isCombined, Use } from '../combine/combine';

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

const drawn = new WeakMap<Scale, WeakMap<LoadedTrack, Int8Array>>();

/**
 * The steps the map draws a track's fixes in (single-fix blips smoothed, as on
 * the map), kept per scale so the fix card can show the color at any fix.
 */
export function drawnSteps(track: LoadedTrack, key: MeasureKey, scale: Scale): Int8Array {
  let per = drawn.get(scale);
  if (!per) { per = new WeakMap(); drawn.set(scale, per); }
  let s = per.get(track);
  if (!s) { s = stepsFor(track, key, scale); per.set(track, s); }
  return s;
}

/** Badge color of a track (its range's badge), used for its pins and fix rings. */
export function badgeColor(item: TrackItem): string {
  return FAMILIES[item.fam % 3].badge;
}

/** Bounds of the shown tracks' fixes inside a stretch of timeline time; offsets move each track onto the timeline. */
export function boundsIn(items: TrackItem[], offsets: Record<string, number>, range: [number, number]): [number, number, number, number] | null {
  let w = 180, s = 90, e = -180, n = -90, any = false;
  for (const it of items) {
    if (!it.vis) continue;
    const c = it.track.cols, off = offsets[it.id] ?? 0;
    let lo = 0, hi = c.n;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (c.t[mid] + off < range[0]) lo = mid + 1; else hi = mid; }
    for (let i = lo; i < c.n && c.t[i] + off <= range[1]; i++) {
      any = true;
      if (c.lon[i] < w) w = c.lon[i];
      if (c.lon[i] > e) e = c.lon[i];
      if (c.lat[i] < s) s = c.lat[i];
      if (c.lat[i] > n) n = c.lat[i];
    }
  }
  return any ? [w, s, e, n] : null;
}

/** Meters per screen pixel at a latitude and zoom (MapLibre tiles are 512 pixels wide). */
export function metersPerPixel(lat: number, zoom: number): number {
  return (40_075_016.7 * Math.cos((lat * Math.PI) / 180)) / (512 * 2 ** zoom);
}

/**
 * A dot with the track's letter for each shown track smaller than `minPx` on
 * screen at this zoom. When the shown tracks are far apart, fitting them all
 * zooms out so far that a track is a speck (MapLibre then drops its short
 * colored pieces altogether), so the dot shows where it is.
 */
export function buildMarks(items: TrackItem[], zoom: number, minPx = 24): FC<Point> {
  const out: Feature<Point>[] = [];
  for (const it of items) {
    if (!it.vis) continue;
    const [w, s, e, n] = it.track.derived.stats.bbox;
    const lat = (s + n) / 2, lon = (w + e) / 2;
    const sizeM = Math.max(haversine(lat, w, lat, e), haversine(s, lon, n, lon));
    if (sizeM / metersPerPixel(lat, zoom) >= minPx) continue;
    const c = badgeColor(it);
    out.push({ type: 'Feature', geometry: { type: 'Point', coordinates: [lon, lat] }, properties: { id: it.id, c, icon: `tlp-mark-${FORMAT_SHAPE[it.track.format]}-${c.slice(1)}` } });
  }
  return { type: 'FeatureCollection', features: out };
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
    let k = -9, h = -9;
    let coords: [number, number][] | null = null;
    const close = () => {
      if (!coords || coords.length < 2) return;
      out.push({
        type: 'Feature', geometry: { type: 'LineString', coordinates: coords },
        properties: {
          id: it.id,
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

/** One line per gap-free stretch, for the casing and the heading arrows. (It needs no MapCtx; one is still accepted.) */
export function buildPaths(items: TrackItem[], _ctx?: MapCtx): FC<LineString> {
  const out: Feature<LineString>[] = [];
  for (const it of items) {
    if (!it.vis) continue;
    const { lat, lon, n } = it.track.cols;
    const gap = it.track.derived.gap;
    let coords: [number, number][] = [];
    const close = () => {
      if (coords.length >= 2) out.push({ type: 'Feature', geometry: { type: 'LineString', coordinates: coords }, properties: { id: it.id } });
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

/** One point per fix with its satellite count, drawn as glyphs when zoomed in. (It needs no MapCtx; one is still accepted.) */
export function buildFixPoints(items: TrackItem[], _ctx?: MapCtx): FC<Point> {
  const out: Feature<Point>[] = [];
  for (const it of items) {
    if (!it.vis) continue;
    const { lat, lon, n, sats, fixq } = it.track.cols;
    const ring = badgeColor(it);
    for (let i = 0; i < n; i++) {
      out.push({
        type: 'Feature', geometry: { type: 'Point', coordinates: [lon[i], lat[i]] },
        properties: { id: it.id, i, s: Number.isFinite(sats[i]) ? String(sats[i]) : '', q: fixq[i], r: ring },
      });
    }
  }
  return fc(out);
}

/** Button presses, numbered. (It needs no MapCtx; one is still accepted.) */
export function buildFlags(items: TrackItem[], _ctx?: MapCtx): FC<Point> {
  const out: Feature<Point>[] = [];
  for (const it of items) {
    if (!it.vis) continue;
    for (const f of it.track.flags) {
      out.push({ type: 'Feature', geometry: { type: 'Point', coordinates: [f.lon, f.lat] }, properties: { id: it.id, label: `#${f.n}`, c: badgeColor(it) } });
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
      // The step the line is drawn in here (one-fix flickers smoothed), so the dot matches the line and the fix card.
      const k = drawnSteps(it.track, it.color, ctx.scaleFor(it.track, it.color))[i];
      col = k >= 0 ? colors[Math.min(k, colors.length - 1)] : ctx.dark ? UNKNOWN.dark : UNKNOWN.light;
    }
    out.push({ type: 'Feature', geometry: { type: 'Point', coordinates: [c.lon[i], c.lat[i]] }, properties: { id: it.id, i, c: col, z: it.id === ctx.selectedId ? 2 : 1 } });
  }
  return fc(out);
}

/**
 * The logs of each shown combined track whose eye is on: thin solid lines in
 * each log's color (dots and dashes on the map always mean a gap), red where
 * the log was left out for a large error. A log's own gaps stay blank.
 */
export function buildLogLines(items: TrackItem[]): FC<LineString> {
  const out: Feature<LineString>[] = [];
  for (const it of items) {
    if (!it.vis || !it.logs || !isCombined(it.track)) continue;
    const { combo, cols } = it.track;
    const gap = it.track.derived.gap;
    for (let k = 0; k < combo.sources.length; k++) {
      if (!it.logs[k]) continue;
      const la = combo.srcLat[k], lo = combo.srcLon[k], use = combo.use[k];
      let coords: [number, number][] | null = null, left = false;
      const close = () => {
        if (coords && coords.length >= 2) out.push({ type: 'Feature', geometry: { type: 'LineString', coordinates: coords }, properties: { id: it.id, k, c: LOG_COLORS[k], out: left ? 1 : 0 } });
        coords = null;
      };
      for (let i = 0; i < cols.n; i++) {
        if (la[i] !== la[i] || gap[i]) close(); // no position here, or a gap in the combined track
        if (la[i] !== la[i]) continue;
        const o = use[i] === Use.LeftOut;
        // The step into a left-out second (and out of it) takes that second's look.
        if (coords && o !== left) { const last: [number, number] = coords[coords.length - 1]; close(); coords = [last]; }
        if (!coords) coords = [];
        left = o;
        coords.push([lo[i], la[i]]);
      }
      close();
    }
  }
  return fc(out);
}

/** A dot for each shown log of each shown combined track at the cursor: hollow, ringed in red, where it was left out. */
export function buildLogCursors(items: TrackItem[], offsets: Record<string, number>, axisT: number | null): FC<Point> {
  if (axisT === null) return fc([]);
  const out: Feature<Point>[] = [];
  for (const it of items) {
    if (!it.vis || !it.logs || !isCombined(it.track)) continue;
    const { combo, cols } = it.track;
    const tt = axisT - (offsets[it.id] ?? 0);
    if (cols.n === 0 || tt < cols.t[0] - 5000 || tt > cols.t[cols.n - 1] + 5000) continue;
    const i = nearestIndex(cols.t, tt);
    for (let k = 0; k < combo.sources.length; k++) {
      const la = combo.srcLat[k][i], lo = combo.srcLon[k][i];
      if (!it.logs[k] || la !== la) continue;
      out.push({ type: 'Feature', geometry: { type: 'Point', coordinates: [lo, la] }, properties: { id: it.id, k, c: LOG_COLORS[k], out: combo.use[k][i] === Use.LeftOut ? 1 : 0 } });
    }
  }
  return fc(out);
}

/** Whether a shown combined track has any of its logs shown: only then are the logs' dots at the cursor drawn. */
export function showsLogs(items: TrackItem[]): boolean {
  return items.some((it) => it.vis && !!it.logs?.some(Boolean) && isCombined(it.track));
}

/** Meters in a degree of latitude, on the sphere haversine uses. */
const DEG_M = (6_371_008.8 * Math.PI) / 180;

/**
 * The fix nearest to a point. Distances are measured on a flat map centred on
 * the point (longitude shrunk by the cosine of its latitude): close to the
 * point, where the nearest fix is, that is as good as great circles, and it
 * costs a few multiplications a fix instead of a haversine, so dragging along
 * a 100,000-fix track stays smooth. While dragging, `prev` is the last fix
 * picked: where the track passes the same place twice, a fix within 400 of it
 * wins when it is at most `tolM` meters farther, so the cursor stays on the
 * same pass.
 */
export function nearestFix(cols: Pick<Columns, 'n' | 'lat' | 'lon'>, lat: number, lon: number, prev = -1, tolM = 0): number {
  const { n, lat: la, lon: lo } = cols;
  const k = Math.cos((lat * Math.PI) / 180);
  // Squared distance on that flat map, in degrees of latitude.
  const d2 = (i: number) => {
    const dy = la[i] - lat;
    let dx = lo[i] - lon;
    if (dx > 180) dx -= 360; else if (dx < -180) dx += 360; // the short way across the antimeridian
    dx *= k;
    return dx * dx + dy * dy;
  };
  let best = 0, bd = Infinity;
  for (let i = 0; i < n; i++) { const d = d2(i); if (d < bd) { bd = d; best = i; } }
  if (prev < 0) return best;
  let near = -1, nd = Infinity;
  for (let i = Math.max(0, prev - 400); i < Math.min(n, prev + 400); i++) { const d = d2(i); if (d < nd) { nd = d; near = i; } }
  return near >= 0 && Math.sqrt(nd) * DEG_M <= Math.sqrt(bd) * DEG_M + tolM ? near : best;
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
