// Time axis math for the timeline: tick spacing and positions, and the
// per-pixel summary each lane draws.
import type { LoadedTrack, MeasureKey } from '../model/types';
import { stepOf, valueAt, type Scale } from '../color/scale';
import { nearestIndex } from '../state/logic';

const STEPS_S = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600, 7200, 10800, 21600, 43200, 86400];

/** Tick spacing (ms) that keeps labels at least minPx apart. */
/** The shortest stretch of time the timeline zooms to. */
export const MIN_ZOOM_MS = 10_000;

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
 * During playback, the next cursor time once a track's gap is reached: the
 * first fix after it, or the start of the range when the track has ended.
 */
export function skipGap(t: number, tr: LoadedTrack, offset: number, t0: number, t1: number): number {
  const c = tr.cols;
  if (!c.n) return t;
  const i = nearestIndex(c.t, t - offset);
  const slack = Math.max(5000, tr.derived.stats.intervalS * 3000);
  if (Math.abs(c.t[i] + offset - t) <= slack) return t;
  const j = c.t[i] + offset > t ? i : i + 1;
  return j < c.n && c.t[j] + offset <= t1 ? c.t[j] + offset : t0;
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
  const c = tr.cols;
  const gap = tr.derived.gap;
  const colOf = (t: number) => Math.floor(((t + offset - t0) / span) * W);
  for (let i = 0; i < c.n; i++) {
    const x = colOf(c.t[i]);
    if (x < 0 || x >= W) continue;
    // A gap paints every column between the two fixes it separates.
    if (i > 0 && gap[i]) {
      const a = Math.max(0, colOf(c.t[i - 1]) + 1);
      for (let k = a; k < x; k++) out[k] = { step: -1, min: NaN, max: NaN, gap: true };
    }
    const v = key ? valueAt(tr, key, i) : 0;
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
    tally.forEach((n, k) => { if (n > bestN) { bestN = n; best = k - 1; } });
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
