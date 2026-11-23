import type { LoadedTrack, MeasureKey } from '../model/types';
import { quantileSorted } from '../derive/geo';
import { MOVING_KMH } from '../derive/derive';

/** Values each track contributes when choosing shared steps. */
const SKETCH = 512;
/** Faster than runners keep up (km/h). Above it, speed steps are spaced on a log scale. */
export const RUNNING_KMH = 20;

/** Number of color steps per measure. */
export const STEPS: Record<MeasureKey, number> = { speed: 5, ele: 5, grade: 5, hdop: 4, sats: 4, fix: 2, accel: 5 };

/** Fixed step edges where the measure has a natural scale. */
const FIXED: Partial<Record<MeasureKey, number[]>> = {
  grade: [1, 2, 4, 6], // percent, uphill or downhill
  hdop: [2, 5, 10],
  sats: [10, 7, 5], // more satellites is better: step 0 is 10 or more
  accel: [1.1, 1.25, 1.5, 2], // g, gravity included (1 g at rest): calm, light, firm, hard, a jolt
};

export interface Scale {
  key: MeasureKey;
  steps: number;
  /** Boundaries between steps in display units (steps - 1 values). */
  edges: number[];
  /** Multiply a stored value by this to get display units (mph, ft). */
  factor: number;
  /** HDOP ranked by the track's own quartiles. */
  relative: boolean;
  /** Speed steps spaced on a log scale (each step a similar ratio of speeds). */
  log: boolean;
}

/** The value of a measure at fix i (km/h, m, |%|, HDOP, count, fix quality, g); NaN when missing. */
export function valueAt(tr: LoadedTrack, key: MeasureKey, i: number): number {
  switch (key) {
    case 'speed': return tr.derived.kmh[i];
    case 'ele': return tr.cols.ele[i];
    case 'grade': return Math.abs(tr.derived.grade[i]);
    case 'hdop': return tr.cols.hdop[i];
    case 'sats': return tr.cols.sats[i];
    case 'fix': return tr.cols.fixq[i] > 0 ? tr.cols.fixq[i] : NaN;
    case 'accel': return tr.cols.accel[i];
  }
}

/** Whether a track has any value for a measure. */
export function hasMeasure(tr: LoadedTrack, key: MeasureKey): boolean {
  if (key === 'speed') return tr.cols.n > 1;
  for (let i = 0; i < tr.cols.n; i++) if (Number.isFinite(valueAt(tr, key, i))) return true;
  return false;
}

/** Step index for a value, or -1 when it's missing. */
export function stepOf(scale: Scale, v: number): number {
  if (!Number.isFinite(v)) return -1;
  if (scale.key === 'fix') return v >= 2 ? 1 : 0;
  const x = v * scale.factor;
  const e = scale.edges;
  if (scale.key === 'sats') {
    for (let k = 0; k < e.length; k++) if (x >= e[k]) return k;
    return e.length;
  }
  for (let k = 0; k < e.length; k++) if (x < e[k]) return k;
  return e.length;
}

const NICE = [500, 200, 100, 50, 20, 10, 5, 2, 1, 0.5, 0.2, 0.1, 0.05, 0.01];

/**
 * Rounds quantile edges to the coarsest round step that keeps them strictly
 * increasing and moves no edge by more than 30% of its value.
 */
export function niceEdges(qs: number[]): number[] {
  const lo = qs[0], hi = qs[qs.length - 1];
  const span = hi - lo;
  if (!(span > 0)) return qs.map((_, k) => round(lo + (k + 1) * 0.1, 0.1));
  for (const step of NICE) {
    if (step > span / 4) continue;
    const r = qs.map((q) => round(q, step));
    const increasing = r.every((v, k) => k === 0 || v > r[k - 1]);
    const close = r.every((v, k) => Math.abs(v - qs[k]) <= 0.3 * Math.abs(qs[k]));
    if (increasing && close) return r;
  }
  return qs.map((q) => round(q, 0.01));
}

function round(v: number, step: number): number {
  return Number((Math.round(v / step) * step).toFixed(4));
}

const NICE_MANTISSA = [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10];

/** The round number nearest to v on a log scale (…, 8, 10, 12, 15, 20, 25, 30, 40, 50, …). */
export function niceNumber(v: number): number {
  const p = 10 ** Math.floor(Math.log10(v));
  let best = 1, err = Infinity;
  for (const c of NICE_MANTISSA) { const e = Math.abs(Math.log(v / p / c)); if (e < err) { err = e; best = c; } }
  return Number((best * p).toPrecision(4));
}

/** Step edges spaced evenly on a log scale between lo and hi, rounded to round numbers. */
export function logEdges(lo: number, hi: number, steps: number): number[] {
  const r = (hi / lo) ** (1 / steps);
  const raw = Array.from({ length: steps - 1 }, (_, k) => lo * r ** (k + 1));
  const increasing = (a: number[]) => a.every((v, k) => k === 0 || v > a[k - 1]);
  const nice = raw.map(niceNumber);
  if (increasing(nice)) return nice;
  const two = raw.map((v) => Number(v.toPrecision(2)));
  return increasing(two) ? two : raw.map((v) => round(v, 0.01));
}

/**
 * Builds the scale for a measure. Speed and elevation steps come from the
 * tracks passed in (the shown ones), so a step means the same value on each.
 */
export function buildScale(key: MeasureKey, tracks: LoadedTrack[], factor = 1, relativeFor?: LoadedTrack): Scale {
  const steps = STEPS[key];
  if (key === 'hdop' && relativeFor?.derived.hdopRelative && relativeFor.derived.hdopQ) {
    return { key, steps, edges: relativeFor.derived.hdopQ.map((q) => round(q, 0.01)), factor: 1, relative: true, log: false };
  }
  const fixed = FIXED[key];
  if (fixed) return { key, steps, edges: fixed, factor: 1, relative: false, log: false };
  if (key === 'fix') return { key, steps, edges: [], factor: 1, relative: false, log: false };
  // Each track adds the same number of evenly spaced quantiles, so a long walk
  // doesn't claim every step from a shorter drive loaded beside it.
  const pool: number[] = [];
  for (const tr of tracks) {
    const n = tr.cols.n;
    const stride = Math.max(1, Math.floor(n / 20000));
    const vals: number[] = [];
    for (let i = 0; i < n; i += stride) {
      const v = valueAt(tr, key, i);
      // Stops all fall in the first speed step anyway; leave them out of the split.
      if (key === 'speed' && !(v >= MOVING_KMH)) continue;
      if (Number.isFinite(v)) vals.push(v * factor);
    }
    if (!vals.length) continue;
    vals.sort((a, b) => a - b);
    for (let j = 0; j < SKETCH; j++) pool.push(vals[Math.round((j * (vals.length - 1)) / (SKETCH - 1))]);
  }
  if (pool.length === 0) return { key, steps, edges: [1, 2, 3, 4], factor, relative: false, log: false };
  pool.sort((a, b) => a - b);
  if (key === 'speed') {
    // Faster than running: space the steps on a log scale, so a walk and a
    // drive shown together each keep several colors.
    const hi = quantileSorted(pool, 0.95);
    const lo = Math.max(MOVING_KMH * factor, quantileSorted(pool, 0.05));
    if (hi > RUNNING_KMH * factor && hi / lo > 1.5) return { key, steps, edges: logEdges(lo, hi, steps), factor, relative: false, log: true };
  }
  const qs = [0.2, 0.4, 0.6, 0.8].map((q) => quantileSorted(pool, q));
  return { key, steps, edges: niceEdges(qs), factor, relative: false, log: false };
}

/** Share of the track's time spent in each step (fractions that sum to 1, or all 0). */
export function timeShares(tr: LoadedTrack, scale: Scale): number[] {
  const out: number[] = Array.from({ length: scale.steps }, () => 0);
  const { t } = tr.cols;
  let total = 0;
  for (let i = 1; i < tr.cols.n; i++) {
    if (tr.derived.gap[i]) continue;
    const k = stepOf(scale, valueAt(tr, scale.key, i));
    if (k < 0) continue;
    const dt = t[i] - t[i - 1];
    out[k] += dt;
    total += dt;
  }
  return total > 0 ? out.map((v) => v / total) : out;
}
