// Time axis math for the timeline: tick spacing and positions, and the
// per-pixel summary each lane draws.
import type { LoadedTrack, MeasureKey } from '../model/types';
import { stepOf, valueAt, type Scale } from '../color/scale';
import { nearestIndex } from '../state/logic';

const STEPS_S = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600, 7200, 10800, 21600, 43200, 86400];

/** Tick spacing (ms) that keeps labels at least minPx apart. */
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

export function tickStep(spanMs: number, widthPx: number, minPx = 84): number {
  const target = (spanMs / Math.max(1, widthPx)) * minPx;
  for (const s of STEPS_S) if (s * 1000 >= target) return s * 1000;
  return Math.ceil(target / 86_400_000) * 86_400_000;
}

/** Tick times between t0 and t1, on round times in a zone with the given UTC offset (minutes). */
export function ticks(t0: number, t1: number, widthPx: number, offsetMin: number): number[] {
  const step = tickStep(t1 - t0, widthPx);
  const off = offsetMin * 60_000;
  const out: number[] = [];
  for (let t = Math.ceil((t0 + off) / step) * step - off; t <= t1; t += step) out.push(t);
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
  for (let i = 0; i < n; i++) {
    const x = colOf(times[i]);
    if (x < 0 || x >= W) continue;
    // A gap paints every column between the two points it separates.
    if (i > 0 && isGap(i)) {
      const a = Math.max(0, colOf(times[i - 1]) + 1);
      for (let k = a; k < x; k++) out[k] = { step: -1, min: NaN, max: NaN, gap: true };
    }
    const v = value(i);
    const s = scale && key ? stepOf(scale, v) : 0;
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
  let nextIsData = false;
  for (let x = W - 1; x >= 0; x--) {
    const col = out[x];
    if (col) nextIsData = !col.gap;
    else fillable[x] = nextIsData ? 1 : 0;
  }
  let last: Column | null = null;
  for (let x = 0; x < W; x++) {
    const col = out[x];
    if (col) { last = col.gap ? null : col; continue; }
    if (last && fillable[x]) out[x] = { ...last };
  }
  return out;
}
