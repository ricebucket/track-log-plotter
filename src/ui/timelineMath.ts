// Time axis math for the timeline: tick spacing and positions, and the
// per-pixel summary each lane draws.
import type { LoadedTrack, MeasureKey } from '../model/types';
import { stepOf, valueAt, type Scale } from '../color/scale';
import { nearestIndex } from '../state/logic';
import { drawnSteps } from '../map/geojson';
import { Use, type ComboTrack } from '../combine/combine';

const STEPS_S = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600, 7200, 10800, 21600, 43200, 86400];

/** The shortest stretch of time the timeline zooms to. */
export const MIN_ZOOM_MS = 10_000;

/** How much one pixel of scrolling zooms: a mouse wheel notch (100 px) is about 22%. */
const WHEEL_ZOOM = 1.002;

/**
 * The view after scrolling `deltaPx` with the pointer `frac` of the way across
 * the lanes: up (negative) zooms in, down zooms out, keeping the time under the
 * pointer in place. Null once zoomed all the way out.
 */
export function wheelZoom(view: [number, number], full: [number, number], frac: number, deltaPx: number): [number, number] | null {
  const span = view[1] - view[0], fullSpan = full[1] - full[0];
  const next = Math.max(MIN_ZOOM_MS, span * WHEEL_ZOOM ** deltaPx);
  if (next >= fullSpan) return null;
  const at = view[0] + frac * span;
  const a = Math.min(full[1] - next, Math.max(full[0], at - frac * next));
  return [a, a + next];
}

/** The view moved sideways by `frac` of its width, kept inside the full range. */
export function panView(view: [number, number], full: [number, number], frac: number): [number, number] {
  const span = view[1] - view[0];
  const a = Math.min(full[1] - span, Math.max(full[0], view[0] + frac * span));
  return [a, a + span];
}

/** The zoomed view moved to center on time t, keeping its width, never past either end of the timeline. */
export function centerView(view: [number, number], full: [number, number], t: number): [number, number] {
  const span = view[1] - view[0];
  const a = Math.min(full[1] - span, Math.max(full[0], t - span / 2));
  return [a, a + span];
}

/**
 * The time of the fix nearest to t (timeline time) on any of the tracks, so
 * the cursor never rests in a gap. Offsets shift each track onto the timeline.
 */
export function snapTime(t: number, tracks: { id: string; track: LoadedTrack }[], offsets: Record<string, number>): number {
  let best = t, bd = Infinity;
  for (const it of tracks) {
    const c = it.track.cols;
    if (!c.n) continue;
    const off = offsets[it.id] ?? 0;
    const v = c.t[nearestIndex(c.t, t - off)] + off;
    if (Math.abs(v - t) < bd) { bd = Math.abs(v - t); best = v; }
  }
  return best;
}

/** The first index of a sorted series whose time is at or after t. */
function firstAt(times: ArrayLike<number>, t: number): number {
  let lo = 0, hi = times.length;
  while (lo < hi) { const m = (lo + hi) >> 1; if (times[m] < t) lo = m + 1; else hi = m; }
  return lo;
}

/**
 * The axis time of the nearest fix of any of the tracks after (dir 1) or
 * before (dir -1) axis time t, gaps skipped; null when there is none. One
 * binary search a track.
 */
export function stepFix(t: number, dir: 1 | -1, tracks: { id: string; track: LoadedTrack }[], offsets: Record<string, number>): number | null {
  let best: number | null = null;
  for (const it of tracks) {
    const c = it.track.cols;
    if (!c.n) continue;
    const off = offsets[it.id] ?? 0;
    if (dir > 0) {
      // The first fix after t: past any fix exactly at t.
      let i = firstAt(c.t, t - off);
      while (i < c.n && c.t[i] + off <= t) i++;
      if (i < c.n && (best === null || c.t[i] + off < best)) best = c.t[i] + off;
    } else {
      const i = firstAt(c.t, t - off) - 1;
      if (i >= 0 && (best === null || c.t[i] + off > best)) best = c.t[i] + off;
    }
  }
  return best;
}

/** The first index of a sorted series whose time is after t. */
function firstAfter(times: ArrayLike<number>, t: number): number {
  let lo = 0, hi = times.length;
  while (lo < hi) { const m = (lo + hi) >> 1; if (times[m] <= t) lo = m + 1; else hi = m; }
  return lo;
}

/**
 * The time of the fix nearest to t (timeline time) among the fixes of any of
 * the tracks inside [a, b]: where the cursor goes when the view narrows to
 * [a, b] and leaves it outside. Without a fix inside, t moved into [a, b].
 */
export function snapInto(t: number, tracks: { id: string; track: LoadedTrack }[], offsets: Record<string, number>, a: number, b: number): number {
  const at = Math.min(b, Math.max(a, t));
  let best = at, bd = Infinity;
  for (const it of tracks) {
    const c = it.track.cols;
    const off = offsets[it.id] ?? 0;
    const lo = firstAt(c.t, a - off), hi = firstAfter(c.t, b - off) - 1; // the fixes inside, first to last
    if (lo > hi) continue;
    const v = c.t[Math.min(hi, Math.max(lo, nearestIndex(c.t, at - off)))] + off;
    if (Math.abs(v - at) < bd) { bd = Math.abs(v - at); best = v; }
  }
  return best;
}

/**
 * During playback, the next cursor time once every shown track is in a gap:
 * the first fix after it on any of them, or the start of the range when they
 * have all ended. While any track has a fix near t, t stays.
 */
export function skipGap(t: number, tracks: { id: string; track: LoadedTrack }[], offsets: Record<string, number>, t0: number, t1: number): number {
  let next = Infinity, any = false;
  for (const it of tracks) {
    const c = it.track.cols;
    if (!c.n) continue;
    any = true;
    const off = offsets[it.id] ?? 0;
    const i = nearestIndex(c.t, t - off);
    const slack = Math.max(5000, it.track.derived.stats.intervalS * 3000);
    if (Math.abs(c.t[i] + off - t) <= slack) return t;
    const j = c.t[i] + off > t ? i : i + 1;
    if (j < c.n) next = Math.min(next, c.t[j] + off);
  }
  if (!any) return t;
  return next <= t1 ? next : t0;
}

/** Playback speed: track time runs this many times faster than real time. */
export const PLAY_SPEED = 60;

/** The cursor after one playback frame. Playback loops: past the end it starts over. */
export function playStep(cursor: number, dtMs: number, t0: number, t1: number): number {
  const next = cursor + dtMs * PLAY_SPEED;
  return next >= t1 || next < t0 ? t0 : next;
}

/** Tick spacing (ms) that keeps labels at least minPx apart. */
export function tickStep(spanMs: number, widthPx: number, minPx = 84): number {
  const target = (spanMs / Math.max(1, widthPx)) * minPx;
  for (const s of STEPS_S) if (s * 1000 >= target) return s * 1000;
  return Math.ceil(target / 86_400_000) * 86_400_000;
}

/**
 * Tick times between t0 and t1, on round times of a zone's clock. `offsetAt`
 * is the zone's UTC offset in minutes: one number for a fixed offset, or a
 * function of time for a zone with daylight saving. Then each tick is checked
 * against the offset at its own time, and where the offset changes (found to
 * the millisecond) the ticks go on from there with the new one, so midnights
 * and round hours after the change stay round. Checking costs one offset a
 * tick; a view without a change needs nothing more.
 */
export function ticks(t0: number, t1: number, widthPx: number, offsetAt: number | ((t: number) => number)): number[] {
  const step = tickStep(t1 - t0, widthPx);
  const out: number[] = [];
  if (typeof offsetAt === 'number') {
    const off = offsetAt * 60_000;
    for (let t = Math.ceil((t0 + off) / step) * step - off; t <= t1; t += step) out.push(t);
    return out;
  }
  const offAt = (t: number) => offsetAt(t) * 60_000;
  let from = t0, off = offAt(t0); // from `from` on, the offset is `off`
  let t = Math.ceil((from + off) / step) * step - off;
  while (t <= t1) {
    if (offAt(t) === off) { out.push(t); from = t; t += step; continue; }
    // The offset changes between `from` and t: find where, and go on from there.
    let lo = from, hi = t;
    while (hi - lo > 1) { const m = Math.floor((lo + hi) / 2); if (offAt(m) === off) lo = m; else hi = m; }
    from = hi;
    off = offAt(hi);
    t = Math.ceil((from + off) / step) * step - off;
  }
  return out;
}

export interface Column {
  /** Step of the color measure that covers most of the column, or -1. */
  step: number;
  min: number;
  max: number;
  gap: boolean;
}

/**
 * The values a lane's graph spans, bottom to top, from the lowest and highest
 * values in view. Most graphs stand on zero. Acceleration hovers around 1 g,
 * so it spans just the readings (at least 0.1 g). Elevation is often far above
 * sea level, so it spans just the values in view too: at least 10 m, so GPS
 * noise on flat ground stays small, with a little room below the lowest point.
 */
export function graphRange(key: MeasureKey, lo: number, hi: number): [number, number] {
  if (!(hi >= lo)) return [0, 1];
  if (key === 'accel') return [Math.min(lo, hi - 0.1), hi];
  if (key === 'ele') {
    const span = Math.max(hi - lo, 10);
    const low = (lo + hi) / 2 - span / 2;
    return [low - span * 0.1, low + span];
  }
  return [Math.min(0, lo), hi];
}

/**
 * Summarises a track into one entry per pixel column of a lane. `offset` moves
 * the track's times onto the axis [t0, t1].
 */
export function columns(tr: LoadedTrack, key: MeasureKey | null, scale: Scale | null, t0: number, t1: number, width: number, offset: number): (Column | null)[] {
  const W = Math.max(1, Math.round(width));
  const out: (Column | null)[] = Array.from({ length: W }, () => null);
  const span = Math.max(1, t1 - t0);
  const counts = new Map<number, number[]>();
  // Acceleration draws every motion-sensor reading (about ten a second), so a
  // zoomed-in timeline shows the real waveform; everything else, one value per
  // fix. A gap is a pause in the readings, or the gap the fix columns mark.
  const motion = key === 'accel' ? tr.motion : undefined;
  const times = motion ? motion.t : tr.cols.t;
  const n = times.length;
  const value = (i: number) => (motion ? motion.g[i] : key ? valueAt(tr, key, i) : 0);
  const isGap = motion ? (i: number) => times[i] - times[i - 1] > 2000 : (i: number) => tr.derived.gap[i] === 1;
  const colOf = (t: number) => Math.floor(((t + offset - t0) / span) * W);
  // Acceleration is colored as on the map: every reading takes its second's
  // color, which comes from that second's strongest reading.
  const fixSteps = motion && scale && key ? drawnSteps(tr, key, scale) : null;
  const fixT = tr.cols.t;
  // Zoomed in, the points before the view are skipped: start at the last of them.
  const i0 = Math.max(0, firstAt(times, t0 - offset) - 1);
  let owner = 0;
  if (fixSteps && i0 < n) owner = Math.max(0, firstAfter(fixT, times[i0]) - 1); // the last fix at or before it
  // The point just before the view and whether the one just after it follows without a gap: the
  // lane is filled from the one and towards the other, so it reaches both edges when zoomed in.
  let before: Column | null = null, after = false;
  for (let i = i0; i < n; i++) {
    const x = colOf(times[i]);
    // A gap paints every column between the two points it separates that is in view: zoomed
    // into a gap, all of them.
    if (i > 0 && isGap(i)) {
      const a = Math.max(0, colOf(times[i - 1]) + 1), b = Math.min(x, W);
      for (let k = a; k < b; k++) out[k] = { step: -1, min: NaN, max: NaN, gap: true };
      before = null;
    }
    if (x >= W) { after = !(i > 0 && isGap(i)); break; }
    const v = value(i);
    let s = 0;
    if (fixSteps) {
      while (owner + 1 < fixT.length && fixT[owner + 1] <= times[i]) owner++;
      s = fixSteps[owner];
    } else if (scale && key) s = stepOf(scale, v);
    if (x < 0) { before = { step: s, min: v, max: v, gap: false }; continue; }
    let col = out[x];
    if (!col || col.gap) { col = { step: s, min: v, max: v, gap: false }; out[x] = col; }
    if (v < col.min || Number.isNaN(col.min)) col.min = v;
    if (v > col.max || Number.isNaN(col.max)) col.max = v;
    let tally = counts.get(x);
    if (!tally) { tally = []; counts.set(x, tally); }
    tally[s + 1] = (tally[s + 1] ?? 0) + 1;
  }
  for (const [x, tally] of counts) {
    let best = -1, bestN = -1;
    tally.forEach((cnt, k) => { if (cnt > bestN) { bestN = cnt; best = k - 1; } });
    out[x]!.step = best;
  }
  // Fixes logged less often than once per pixel leave empty columns between
  // them: carry each fix forward to the next one, but never across a gap.
  const fillable = new Uint8Array(W);
  let nextIsData = after;
  for (let x = W - 1; x >= 0; x--) {
    const col = out[x];
    if (col) nextIsData = !col.gap;
    else fillable[x] = nextIsData ? 1 : 0;
  }
  let last: Column | null = before;
  for (let x = 0; x < W; x++) {
    const col = out[x];
    if (col) { last = col.gap ? null : col; continue; }
    if (last && fillable[x]) out[x] = { ...last };
  }
  return out;
}

/**
 * The pixel columns of a combined track's log lane over [t0, t1]: where the
 * log has a fix (`has`), and where it was left out for a large error (`out`).
 * One pass through the combined points in view. Columns between two fixes of
 * the log are filled (fixes a second apart may be pixels apart when zoomed
 * in), from a fix before the view too, but not across a gap or a stretch
 * where the log has no fix. `offset` moves the track onto the axis.
 */
export function logColumns(tr: ComboTrack, k: number, t0: number, t1: number, width: number, offset: number): { has: Uint8Array; out: Uint8Array } {
  const W = Math.max(1, Math.round(width));
  const has = new Uint8Array(W), out = new Uint8Array(W);
  const times = tr.cols.t, la = tr.combo.srcLat[k], use = tr.combo.use[k], gap = tr.derived.gap;
  const span = Math.max(1, t1 - t0);
  const colOf = (v: number) => Math.floor(((v + offset - t0) / span) * W);
  // A column left of the view is a column like any other: whether there is a fix before is its own flag.
  let prev = 0, hasPrev = false;
  for (let i = Math.max(0, firstAt(times, t0 - offset) - 1); i < tr.cols.n; i++) {
    if (la[i] !== la[i]) { hasPrev = false; continue; }
    const x = colOf(times[i]);
    const from = hasPrev && !gap[i] ? prev + 1 : x;
    const left = use[i] === Use.LeftOut;
    for (let c = Math.max(0, from); c <= Math.min(W - 1, x); c++) { has[c] = 1; if (left) out[c] = 1; }
    if (x >= W) break;
    prev = x;
    hasPrev = true;
  }
  return { has, out };
}
