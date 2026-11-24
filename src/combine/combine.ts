// Combining 2 or 3 logs of the same trip into one track. Every step is one
// pass (or a fixed few) through the logs in time order, over their fixes and
// the whole seconds they cover, so the work grows in step with the time the
// logs cover (a second for each fix, at a fix a second), not with the span
// from the first fix to the last: a stray fix days away adds one second, not
// days of them. Logs covering more than MAX_LOG_SECONDS between them aren't
// combined. The hot loops allocate nothing: buffers are typed arrays sized
// once, distances are compared squared.
//
//  0. Two copies of the same recording aren't combined: every pair of logs
//     is checked, the same way whichever log keeps its clock.
//  1. Clocks: a least-squares fit of the gap between each log and the
//     reference as a steady offset minus (clock difference x velocity),
//     rounded to tenths of a second and applied from 0.2 s up to 10 s.
//  2. Points on the whole seconds some log covers; each log placed there from
//     its own fixes, interpolated between them unless the log has a gap there
//     (a step across repeats dropped when the file was read isn't one).
//  3. Each fix's accuracy (HDOP, else satellites, against the log's own
//     median; corrected fixes count double) averaged over 10 s: worked out
//     when the log loaded (derived.accuracy).
//  4. (A logger that repeats its last position while it has no new one has
//     those repeats dropped when its file is read: see parse/gpx.)
//  5. Each logger's typical error from the spread between the logs.
//  6. A log too far from the others to be believed is left out at that second.
//     That is only marked (its values stay), so a log trusted 100% keeps
//     every second it has: it is never left out.
//  7. Weights: trust / error^2. A log at 0% trust only fills gaps.
//  8. Position, elevation (as recorded), speed and course: weighted averages
//     of the logs' own values. Speed never comes from the combined points. A
//     recorded speed of 0 at a fix that moved from the one before is left out
//     (the log runs straight between its speeds either side instead); a 0
//     where the position stayed put is a stop, and counts.
//  9. A steady elevation offset between logs is worked out, not applied.
//     Where the logs giving the height change, grade and climb don't reach
//     across (the height may jump there by that offset).
import type { Columns, FieldKey, LoadedTrack } from '../model/types';
import { derive } from '../derive/derive';

export const MAX_LOGS = 3;
/** Expected errors never go below this (m). */
export const MIN_ERROR_M = 0.5;
/**
 * Most seconds of logs a combination takes: the seconds some log covers, once
 * for each log (2 logs covering about 17 days, 3 about 11). Each takes about
 * 50 bytes, kept with the combined track for changes of trust: about 150 MB
 * at most, with several combined tracks able to be open at once.
 */
export const MAX_LOG_SECONDS = 3_000_000;

/** What happened to a log at one second of the combined track. Idle: at 0% trust and not needed to fill a gap. */
export const Use = { Absent: 0, Used: 1, LeftOut: 2, Idle: 3 } as const;

export interface ComboSource {
  /** The log as it was when combined; later changes to it don't reach the combined track. */
  track: LoadedTrack;
  /** Seconds its clock was moved to line up with the reference (positive: its clock was fast). */
  clockS: number;
  /** Its trust share, 0..1; the shares add up to 1. */
  trust: number;
  /** Its typical error in metres, from the spread between the logs. */
  typicalM: number;
  /** Its average share of the weight over the seconds it counted. */
  share: number;
}

export interface ComboInfo {
  sources: ComboSource[];
  /** The source that kept its clock. */
  ref: number;
  /** Per source, per fix of the combined track: a `Use`. */
  use: Uint8Array[];
  /** Per source, per fix of the combined track: its position then (NaN when absent), for drawing and the fix card. */
  srcLat: Float64Array[];
  srcLon: Float64Array[];
  /** 1 where two logs disagreed but neither could be left out. */
  disagree: Uint8Array;
  /** A steady elevation difference of 5 m or more between two logs, worked out but not applied. */
  eleOffset: { from: number; to: number; m: number } | null;
}

export type ComboTrack = LoadedTrack & { combo: ComboInfo };

export function isCombined(t: LoadedTrack): t is ComboTrack {
  return (t as Partial<ComboTrack>).combo !== undefined;
}

export type CheckResult =
  | { ok: true }
  | { ok: false; reason: 'count' | 'combined' | 'duplicate' | 'noOverlap' }
  | { ok: false; reason: 'zone'; log: number };

/** Instant checks before combining: no pass through the fixes. */
export function checkCombine(tracks: LoadedTrack[]): CheckResult {
  if (tracks.length < 2 || tracks.length > MAX_LOGS) return { ok: false, reason: 'count' };
  if (tracks.some(isCombined)) return { ok: false, reason: 'combined' };
  for (let a = 0; a < tracks.length; a++) for (let b = a + 1; b < tracks.length; b++) {
    const A = tracks[a].cols, B = tracks[b].cols;
    const a0 = A.t[0], a1 = A.t[A.n - 1], b0 = B.t[0], b1 = B.t[B.n - 1];
    // The same recording: the same number of fixes over the same time, whatever the file type.
    if (A.n === B.n && a0 === b0 && a1 === b1) return { ok: false, reason: 'duplicate' };
    const from = Math.max(a0, b0), to = Math.min(a1, b1), shared = Math.max(0, to - from);
    // to < from: no instant in common. (A log of one fix has no time to share, but may still lie inside the other.)
    if (to < from || shared < Math.min(a1 - a0, b1 - b0) / 2) {
      // A log whose file doesn't say its time zone may simply be read in the wrong one.
      const zone = tracks[a].clock !== undefined ? a : tracks[b].clock !== undefined ? b : -1;
      if (zone >= 0) return { ok: false, reason: 'zone', log: zone };
      if (shared === 0) return { ok: false, reason: 'noOverlap' };
    }
  }
  return { ok: true };
}

// ---------------------------------------------------------------- inputs

interface Src {
  t: Float64Array; x: Float64Array; y: Float64Array;
  now: Float64Array; v: Float64Array; course: Float32Array; ele: Float32Array;
  standard: boolean; medH: number; n: number;
  /** 1 where the log has a gap before a fix: it is never drawn across one. */
  gap: Uint8Array;
}

function toSrc(tr: LoadedTrack, lat0: number, lon0: number): Src {
  const c = tr.cols, n = c.n, d = tr.derived;
  const kx = 111_320 * Math.cos((lat0 * Math.PI) / 180), ky = 110_540;
  const x = new Float64Array(n), y = new Float64Array(n), v = new Float64Array(n);
  const fromFile = d.speedFromFile, gap = d.gap;
  let dropped = 0;
  for (let i = 0; i < n; i++) {
    x[i] = (c.lon[i] - lon0) * kx; y[i] = (c.lat[i] - lat0) * ky;
    // The log's own speed: recorded where it has one, else what the app works out for it alone. A recorded 0
    // at a fix that moved from the one before can't be right (a logger that holds its last fix writes it as
    // it starts holding): left out here only; the log on its own keeps it.
    const sp = c.speed[i];
    const moved = i > 0 && !gap[i] && (c.lat[i] !== c.lat[i - 1] || c.lon[i] !== c.lon[i - 1]);
    if (fromFile && sp === 0 && moved) { v[i] = NaN; dropped++; continue; }
    v[i] = fromFile && sp === sp ? sp : d.kmh[i] / 3.6;
  }
  // A speed left out is skipped, not replaced: at each second the log's speed runs straight between its nearest
  // fixes that have one, as its position runs between fixes. Without one on each side before a gap, it has none.
  // One pass: each run of fixes without a speed, [i, j), ends at the next speed or the next gap, and is filled
  // fix by fix from the one before (just filled) to the speed after.
  for (let i = 1; dropped && i < n; i++) {
    if (v[i] === v[i]) continue;
    let j = i + 1;
    while (j < n && !gap[j] && v[j] !== v[j]) j++;
    if (!gap[i] && v[i - 1] === v[i - 1] && j < n && !gap[j]) {
      for (let k = i; k < j; k++) v[k] = v[k - 1] + ((v[j] - v[k - 1]) * (c.t[k] - c.t[k - 1])) / (c.t[j] - c.t[k - 1]);
    }
    i = j - 1;
  }
  // Accuracy over time, and what it's measured against: kept since the log loaded.
  const hasH = tr.fields.includes('hdop');
  return { t: c.t, x, y, now: d.accuracy, v, course: c.course, ele: c.ele, standard: hasH && !d.hdopRelative, medH: d.hdopBase, n, gap: d.gap };
}

// ---------------------------------------------------------------- 1. clocks

/** Walks a log's fixes for increasing times; after at(T), its position at T is a fix or an interpolation. */
class Cursor {
  /** The fix at T (within 1 ms), or -1 when interpolated between `lo` and `lo + 1`. */
  fixAt = -1;
  lo = 0;
  f = 0;
  constructor(private s: Src, private shiftMs = 0) {}
  at(T: number): boolean {
    const t = this.s.t, n = this.s.n, sh = this.shiftMs;
    let i = this.lo;
    while (i < n - 1 && t[i + 1] - sh <= T) i++;
    this.lo = i;
    const ti = t[i] - sh;
    if (ti - T <= 1 && T - ti <= 1) { this.fixAt = i; return true; }
    if (i + 1 < n) {
      const tj = t[i + 1] - sh;
      if (tj - T <= 1) { this.fixAt = i + 1; return true; }
      if (ti < T && !this.s.gap[i + 1]) { this.fixAt = -1; this.f = (T - ti) / (tj - ti); return true; }
    }
    return false;
  }
  val(a: ArrayLike<number>): number {
    const k = this.fixAt;
    return k >= 0 ? a[k] : a[this.lo] + (a[this.lo + 1] - a[this.lo]) * this.f;
  }
}

/**
 * The clock lead of `b` over the reference, in seconds, from one pass over the
 * reference's fixes; the gap left after the fit (its root mean square); and the
 * gap where both logs have a fix at the same instant (0 for the same recording).
 */
export function clockFit(ref: Src, b: Src, shiftMs: number): { tau: number; rms: number; used: number; exact: number; exactRms: number } {
  const cur = new Cursor(b, shiftMs);
  let n = 0, mdx = 0, mdy = 0, mvx = 0, mvy = 0, vd = 0, vv = 0, d2 = 0, exact = 0, exact2 = 0;
  const rx = ref.x, ry = ref.y, rt = ref.t, bx = b.x, by = b.y;
  for (let i = 1; i < ref.n - 1; i++) {
    if (!cur.at(rt[i])) continue;
    const dx = cur.val(bx) - rx[i], dy = cur.val(by) - ry[i];
    const dd = dx * dx + dy * dy;
    // Fixes at the same instant count however far apart the fixes come: a logger may take one every 5 s.
    if (cur.fixAt >= 0) { exact++; exact2 += dd; }
    // The fit needs the velocity, from the fixes either side within 4 s; and not over 100 m apart.
    const dt = rt[i + 1] - rt[i - 1];
    if (dt <= 0 || dt > 4000 || dd > 10_000) continue;
    const vx = ((rx[i + 1] - rx[i - 1]) / dt) * 1000, vy = ((ry[i + 1] - ry[i - 1]) / dt) * 1000;
    n++; mdx += dx; mdy += dy; mvx += vx; mvy += vy; vd += vx * dx + vy * dy; vv += vx * vx + vy * vy; d2 += dd;
  }
  const exactRms = exact ? Math.sqrt(exact2 / exact) : NaN;
  if (n < 30) return { tau: 0, rms: NaN, used: n, exact, exactRms };
  mdx /= n; mdy /= n; mvx /= n; mvy /= n;
  const cov = vd / n - (mvx * mdx + mvy * mdy), varv = vv / n - (mvx * mvx + mvy * mvy);
  const tau = varv > 1e-6 ? -cov / varv : 0;
  // What's left of d - b + tau v, with b = mean(d) + tau mean(v): var(d) + 2 tau cov(v, d) + tau^2 var(v).
  const vard = d2 / n - (mdx * mdx + mdy * mdy);
  return { tau, rms: Math.sqrt(Math.max(0, vard + 2 * tau * cov + tau * tau * varv)), used: n, exact, exactRms };
}

// ---------------------------------------------------------------- 2. seconds

/**
 * The whole seconds (as times, ms) where some log has a position, in order,
 * from the first fix of all the logs to the last: with its clock moved, a log
 * has one from 1 ms before the first fix of each of its runs without a gap to
 * 1 ms after the last (see Cursor.at). Each log's runs come in time order, so
 * one pass through them all merges them, and seconds no log covers take no
 * room. Null when there are more than `max`.
 */
function coveredSeconds(S: Src[], shift: Float64Array, max: number): Float64Array | null {
  const K = S.length, sh = new Float64Array(K), at = new Int32Array(K); // at: each log's next run starts at that fix
  let first = Infinity, last = -Infinity;
  for (let k = 0; k < K; k++) {
    sh[k] = shift[k] * 1000;
    first = Math.min(first, S[k].t[0] - sh[k]); last = Math.max(last, S[k].t[S[k].n - 1] - sh[k]);
  }
  const s0 = Math.ceil(first / 1000), s1 = Math.floor(last / 1000);
  // The covered seconds as ranges [from, to], in whole seconds. (Rounding may add a second just outside a run,
  // which the run doesn't reach: a second where no log has a position changes nothing.)
  const ranges: number[] = [];
  let count = 0;
  for (;;) {
    let k = -1, from = Infinity;
    for (let q = 0; q < K; q++) {
      if (at[q] >= S[q].n) continue;
      const f = Math.ceil((S[q].t[at[q]] - sh[q] - 1) / 1000);
      if (f < from) { from = f; k = q; }
    }
    if (k < 0) break;
    const s = S[k], gap = s.gap;
    let b = at[k];
    while (b + 1 < s.n && !gap[b + 1]) b++;
    at[k] = b + 1;
    let to = Math.floor((s.t[b] - sh[k] + 1) / 1000);
    if (from < s0) from = s0;
    if (to > s1) to = s1;
    if (from > to) continue;
    const r = ranges.length;
    if (r && from <= ranges[r - 1] + 1) { if (to > ranges[r - 1]) { count += to - ranges[r - 1]; ranges[r - 1] = to; } }
    else { ranges.push(from, to); count += to - from + 1; }
    if (count > max) return null;
  }
  const secs = new Float64Array(count);
  for (let r = 0, m = 0; r < ranges.length; r += 2) for (let s = ranges[r]; s <= ranges[r + 1]; s++) secs[m++] = s * 1000;
  return secs;
}

// ---------------------------------------------------------------- the combination

export interface ComboOptions { trust?: number[]; name?: string }

/** Not combined: two of the logs are the same recording; none has a position at a whole second; or they cover more than MAX_LOG_SECONDS. */
export type ComboOutcome =
  | { ok: true; track: ComboTrack; apart: boolean }
  | { ok: false; reason: 'duplicate' | 'empty' | 'tooLong' };

const NaN64 = (n: number) => new Float64Array(n).fill(NaN);

/**
 * Everything about a combination that doesn't depend on trust, given the log
 * whose clock is kept. Per-second values of all the logs sit side by side:
 * second m of log k at m * K + k.
 */
interface Prepared {
  ref: number; K: number; n: number;
  shift: Float64Array; T: Float64Array;
  lat0: number; lon0: number; kx: number; ky: number;
  /** Position in metres east and north of lat0/lon0 (NaN where the log has none), accuracy factor, speed, height, course. */
  x: Float64Array; y: Float64Array; now: Float64Array; v: Float64Array; ele: Float32Array; crs: Float32Array;
  /** 1 where a log's fix is left out. */
  left: Uint8Array;
  /** The seconds where some log counts, in order, and what doesn't change with trust there. */
  idx: Int32Array; t: Float64Array; srcLat: Float64Array[]; srcLon: Float64Array[]; disagree: Uint8Array;
  apart: boolean; eleOffset: ComboInfo['eleOffset'];
  /** Columns shared by every version of the combined track (see finish). */
  blank?: { nan: Float32Array; none: Int32Array; zero8: Int8Array; zeroU8: Uint8Array };
}

/** Each combined track's prepared work, so new trust redoes only the weighted averages. */
const preparedFor = new WeakMap<ComboTrack, Prepared>();

/** The log trusted most (the first one ticked, on a tie): it keeps its own clock. */
function mostTrusted(trust: Float64Array): number {
  let ref = 0;
  for (let k = 1; k < trust.length; k++) if (trust[k] > trust[ref] + 1e-9) ref = k;
  return ref;
}

/** Steps 0 (unless `checked`: done before for these logs) to 6, and what follows from them; or why the logs aren't combined. */
function prepare(tracks: LoadedTrack[], ref: number, checked: boolean): Prepared | 'duplicate' | 'tooLong' {
  const K = tracks.length;
  const lat0 = tracks[0].cols.lat[0], lon0 = tracks[0].cols.lon[0];
  const kx = 111_320 * Math.cos((lat0 * Math.PI) / 180), ky = 110_540;
  const S = tracks.map((t) => toSrc(t, lat0, lon0));

  // 0. No clock difference, and the fixes taken at the same instants identical: the same recording. Every pair
  // is checked, and each the same way whichever log is the reference, so a change of trust can't find one later.
  const first: ReturnType<typeof clockFit>[] = [];
  for (let a = 0; a < K && !checked; a++) for (let b = a + 1; b < K; b++) {
    const fit = clockFit(S[a], S[b], 0);
    if (fit.exact >= 30 && fit.exactRms < 0.01 && Math.abs(fit.tau) < 0.2) return 'duplicate';
    if (a === ref) first[b] = fit; // also the first step of b's clock
  }

  // 1. Clocks: each log lined up with the reference.
  const shift = new Float64Array(K);
  for (let k = 0; k < K; k++) {
    if (k === ref) continue;
    let total = 0;
    for (let pass = 0; pass < 2; pass++) {
      const fit = (pass === 0 ? first[k] : undefined) ?? clockFit(S[ref], S[k], total * 1000);
      const step = Math.round(fit.tau * 10) / 10;
      if (Math.abs(step) < 0.2 || Math.abs(total + step) > 10) break;
      total = Math.round((total + step) * 10) / 10;
    }
    shift[k] = total;
  }

  // 2. The whole seconds some log covers: every log's values at each (NaN where it has none).
  const secs = coveredSeconds(S, shift, MAX_LOG_SECONDS / K);
  if (!secs) return 'tooLong';
  const M = secs.length, MK = M * K;
  const x = NaN64(MK), y = NaN64(MK), now = new Float64Array(MK), v = new Float64Array(MK);
  const ele = new Float32Array(MK).fill(NaN), crs = new Float32Array(MK).fill(NaN);
  for (let k = 0; k < K; k++) {
    const s = S[k], sh = shift[k] * 1000, cur = new Cursor(s, sh);
    for (let m = 0, j = k; m < M; m++, j += K) {
      if (!cur.at(secs[m])) continue;
      x[j] = cur.val(s.x); y[j] = cur.val(s.y); now[j] = cur.val(s.now); v[j] = cur.val(s.v);
      const f = cur.fixAt;
      if (f >= 0) { ele[j] = s.ele[f]; crs[j] = s.course[f]; } else { ele[j] = cur.val(s.ele); crs[j] = s.course[cur.lo]; }
    }
  }

  // 5-6. Typical errors from the spread, then leaving out; twice, so jumps don't inflate the spread.
  const left = new Uint8Array(MK), dis = new Uint8Array(M);
  const e = new Float64Array(K), here = new Int8Array(K), T = new Float64Array(K);
  for (let pass = 0; pass < 2; pass++) {
    const T2 = typicalErrors(S, x, y, now, left, K, M, pass === 0);
    left.fill(0);
    dis.fill(0);
    for (let k = 0; k < K; k++) T[k] = Math.sqrt(T2[k]);
    for (let m = 0, b = 0; m < M; m++, b += K) {
      let nh = 0;
      for (let k = 0; k < K; k++) {
        const j = b + k;
        if (x[j] !== x[j]) continue;
        here[nh++] = k;
        const ek = T[k] * now[j];
        e[k] = ek > MIN_ERROR_M ? ek : MIN_ERROR_M;
      }
      if (nh === 2) {
        const i = here[0], j = here[1];
        const dx = x[b + i] - x[b + j], dy = y[b + i] - y[b + j];
        if (dx * dx + dy * dy > 9 * (e[i] * e[i] + e[j] * e[j])) {
          const hi = e[i] >= e[j] ? i : j, lo = hi === i ? j : i;
          if (e[hi] > 1.2 * e[lo]) left[b + hi] = 1; else dis[m] = 1;
        }
      } else if (nh === 3) {
        let best = -1, bestZ2 = 9;
        for (let c = 0; c < 3; c++) {
          const i = here[c], p = here[(c + 1) % 3], q = here[(c + 2) % 3];
          const wp = 1 / (e[p] * e[p]), wq = 1 / (e[q] * e[q]), W = wp + wq;
          const ax = (wp * x[b + p] + wq * x[b + q]) / W, ay = (wp * y[b + p] + wq * y[b + q]) / W;
          const dx = x[b + i] - ax, dy = y[b + i] - ay;
          const z2 = (dx * dx + dy * dy) / (e[i] * e[i] + 1 / W);
          if (z2 > bestZ2) { bestZ2 = z2; best = i; }
        }
        if (best >= 0) left[b + best] = 1;
      }
    }
  }

  // The seconds where some log counts (present, not left out), and
  // whether two logs are over 100 m apart for most of the time they share.
  const idx = new Int32Array(M);
  const apartN = new Float64Array(9), sharedN = new Float64Array(9);
  let n = 0;
  for (let m = 0, b = 0; m < M; m++, b += K) {
    let counts = false;
    for (let k = 0; k < K; k++) { const j = b + k; if (x[j] === x[j] && !left[j]) counts = true; }
    for (let i = 0; i < K; i++) for (let j = i + 1; j < K; j++) {
      const dx = x[b + i] - x[b + j], dy = y[b + i] - y[b + j], dd = dx * dx + dy * dy;
      if (dd !== dd) continue;
      sharedN[i * 3 + j]++;
      if (dd > 10_000) apartN[i * 3 + j]++;
    }
    if (counts) idx[n++] = m;
  }
  let apart = false;
  for (let p = 0; p < 9; p++) if (sharedN[p] > 0 && apartN[p] > sharedN[p] / 2) apart = true;
  const t = new Float64Array(n), disagree = new Uint8Array(n), srcLat: Float64Array[] = [], srcLon: Float64Array[] = [];
  for (let i = 0; i < n; i++) { t[i] = secs[idx[i]]; disagree[i] = dis[idx[i]]; }
  for (let k = 0; k < K; k++) {
    const la = new Float64Array(n), lo = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const j = idx[i] * K + k, xv = x[j];
      if (xv === xv) { la[i] = lat0 + y[j] / ky; lo[i] = lon0 + xv / kx; } else { la[i] = NaN; lo[i] = NaN; }
    }
    srcLat.push(la); srcLon.push(lo);
  }
  return {
    ref, K, n, shift, T, lat0, lon0, kx, ky, x, y, now, v, ele, crs, left,
    idx: idx.slice(0, n), t, srcLat, srcLon, disagree, apart, eleOffset: elevationOffset(ele, K, ref, M),
  };
}

/** Steps 7 and 8: the weighted averages for this trust, and the combined track. */
function finish(tracks: LoadedTrack[], p: Prepared, trust: Float64Array, name: string): ComboTrack {
  const { K, n, idx, x, y, now, v, ele, crs, left, T, lat0, lon0, kx, ky } = p;
  const lat = new Float64Array(n), lon = new Float64Array(n), oEle = new Float32Array(n), speed = new Float32Array(n), course = new Float32Array(n);
  const use: Uint8Array[] = [], eleBreak = new Uint8Array(n);
  for (let k = 0; k < K; k++) use.push(new Uint8Array(n));
  const shareSum = new Float64Array(K), shareN = new Float64Array(K), w = new Float64Array(K), counted = new Int8Array(K);
  // The one log with any trust, when every other is at 0%: it is never left out, so the track is that log
  // wherever it has a fix (and the others only fill its gaps).
  let full = -1;
  for (let k = 0; k < K; k++) if (trust[k] > 0) full = full === -1 ? k : -2;
  let prevEleMask = -1;
  for (let i = 0; i < n; i++) {
    const b = idx[i] * K;
    let nc = 0, nTrusted = 0;
    for (let k = 0; k < K; k++) {
      const j = b + k;
      if (x[j] !== x[j]) continue; // Use.Absent
      if (left[j] && k !== full) { use[k][i] = Use.LeftOut; continue; }
      counted[nc++] = k;
      if (trust[k] > 0) nTrusted++;
    }
    // A log at 0% trust only fills gaps: it counts where no trusted log does. Weights that come to nothing, or to
    // no number (an error worked out as infinite): once more, the logs used counting alike.
    let W = 0, sx = 0, sy = 0, We = 0, el = 0, Wv = 0, vv = 0, cs = 0, sn = 0, eleMask = 0;
    for (let alike = 0; alike < 2; alike++) {
      if (alike) W = sx = sy = We = el = Wv = vv = cs = sn = eleMask = 0;
      for (let c = 0; c < nc; c++) {
        const k = counted[c], j = b + k;
        if (nTrusted && !(trust[k] > 0)) { use[k][i] = Use.Idle; w[k] = 0; continue; }
        use[k][i] = Use.Used;
        const ek = T[k] * now[j], err = ek > MIN_ERROR_M ? ek : MIN_ERROR_M;
        const wk = alike ? 1 : (nTrusted ? trust[k] : 1) / (err * err);
        w[k] = wk; W += wk; sx += wk * x[j]; sy += wk * y[j];
        const ev = ele[j]; if (ev === ev) { We += wk; el += wk * ev; eleMask |= 1 << k; }
        const vk = v[j]; if (vk === vk) { Wv += wk; vv += wk * vk; }
        const ck = crs[j]; if (ck === ck) { const r = ck * (Math.PI / 180); cs += wk * Math.cos(r); sn += wk * Math.sin(r); }
      }
      if (W > 0 && W < Infinity) break;
    }
    for (let c = 0; c < nc; c++) { const k = counted[c]; if (w[k] > 0) { shareSum[k] += w[k] / W; shareN[k]++; } }
    lat[i] = lat0 + sy / W / ky; lon[i] = lon0 + sx / W / kx;
    oEle[i] = We ? el / We : NaN; speed[i] = Wv ? vv / Wv : NaN;
    course[i] = cs || sn ? ((Math.atan2(sn, cs) * 180) / Math.PI + 360) % 360 : NaN;
    if (prevEleMask >= 0 && eleMask !== prevEleMask) eleBreak[i] = 1;
    prevEleMask = eleMask;
  }

  // Columns a combined track has no values for, and those that don't change with trust: made once per
  // combination and shared by every version of it (nothing writes to a track's columns once it's made).
  const b = p.blank ??= { nan: new Float32Array(n).fill(NaN), none: new Int32Array(n).fill(-1), zero8: new Int8Array(n), zeroU8: new Uint8Array(n) };
  const cols: Columns = {
    n, t: p.t, lat, lon, ele: oEle, speed, course,
    hdop: b.nan, vdop: b.nan, pdop: b.nan, sats: b.nan, fixq: b.zero8, geoid: b.nan, accel: b.nan,
    line: b.none, lineEnd: b.none, seg: b.zeroU8,
  };
  const fields: FieldKey[] = ['time', 'position'];
  if (oEle.some((h) => h === h)) fields.push('ele');
  fields.push('speed');
  if (course.some((c) => c === c)) fields.push('course');
  const combo: ComboInfo = {
    sources: tracks.map((track, k) => ({ track, clockS: p.shift[k], trust: trust[k], typicalM: T[k], share: shareN[k] ? shareSum[k] / shareN[k] : 0 })),
    ref: p.ref, use, srcLat: p.srcLat, srcLon: p.srcLon,
    disagree: p.disagree, eleOffset: p.eleOffset && { ...p.eleOffset },
  };
  const parsed = { format: 'combined' as const, creator: null, name: null, cols, flags: [], problems: [], notes: [], fields, lines: n, eleBreak };
  const track: ComboTrack = { ...parsed, file: name, sizeBytes: 0, derived: derive(parsed), combo };
  preparedFor.set(track, p);
  return track;
}

/** Combines 2 or 3 logs. `apart`: two of them are over 100 m apart for more than half the time they share. */
export function combineTracks(tracks: LoadedTrack[], opts: ComboOptions = {}): ComboOutcome {
  return combine(tracks, opts, false);
}

function combine(tracks: LoadedTrack[], opts: ComboOptions, checked: boolean): ComboOutcome {
  const trust = normalTrust(opts.trust, tracks.length);
  const p = prepare(tracks, mostTrusted(trust), checked);
  if (typeof p === 'string') return { ok: false, reason: p };
  if (p.n === 0) return { ok: false, reason: 'empty' };
  return { ok: true, track: finish(tracks, p, trust, opts.name ?? 'Combined'), apart: p.apart };
}

/**
 * The same logs combined again with new trust shares. While the same log is
 * trusted most (and so keeps its clock), only the weighted averages are redone.
 */
export function recombine(track: ComboTrack, trust: number[]): ComboTrack {
  const tracks = track.combo.sources.map((s) => s.track);
  const t = normalTrust(trust, tracks.length);
  const p = preparedFor.get(track);
  if (p && p.ref === mostTrusted(t)) return finish(tracks, p, t, track.file);
  // Another log keeps its clock: all is worked out again, but for whether two of the logs are one recording,
  // which doesn't depend on it (and was found not so when they were combined).
  const r = combine(tracks, { trust, name: track.file }, true);
  return r.ok ? r.track : track;
}

function normalTrust(trust: number[] | undefined, K: number): Float64Array {
  const out = new Float64Array(K);
  let sum = 0;
  if (trust && trust.length === K) for (let k = 0; k < K; k++) { const v = trust[k] > 0 && trust[k] < Infinity ? trust[k] : 0; out[k] = v; sum += v; }
  if (sum > 0) for (let k = 0; k < K; k++) out[k] /= sum;
  else out.fill(1 / K);
  return out;
}

/** A median of non-negative values in one pass, from a tally in 0.1 m steps (exact enough for spreads). */
function tallyMedian(values: Float64Array, count: number, maxV: number): number {
  const bins = Math.ceil(maxV * 10) + 1, h = new Uint32Array(bins + 1);
  for (let i = 0; i < count; i++) { const b = Math.floor(values[i] * 10); h[b < bins ? b : bins]++; }
  let acc = 0;
  for (let b = 0; b <= bins; b++) { acc += h[b]; if (acc * 2 >= count) return (b + 0.5) / 10; }
  return maxV;
}

/**
 * Each logger's typical error squared (m^2), from the spread between the logs:
 * the mean squared gap of a pair is typical_i^2 + typical_j^2. Three logs pin
 * all three down; two are taken as equally accurate unless both report
 * standard HDOP. The first pass uses medians, so jumps don't inflate it.
 */
function typicalErrors(S: Src[], x: Float64Array, y: Float64Array, now: Float64Array, left: Uint8Array, K: number, M: number, robust: boolean): Float64Array {
  const s = new Float64Array(9), a = new Float64Array(9).fill(1);
  const d = new Float64Array(M);
  for (let i = 0; i < K; i++) for (let j = i + 1; j < K; j++) {
    let n = 0, sum = 0, si = 0, sj = 0, maxD = 0;
    for (let bi = i, bj = j, end = M * K; bi < end; bi += K, bj += K) {
      if (left[bi] || left[bj]) continue;
      const dx = x[bi] - x[bj], dy = y[bi] - y[bj], dd = dx * dx + dy * dy;
      if (dd !== dd) continue;
      const dist = Math.sqrt(dd);
      d[n++] = dist; sum += dd; si += now[bi] * now[bi]; sj += now[bj] * now[bj]; if (dist > maxD) maxD = dist;
    }
    if (!n) continue;
    const med = robust ? tallyMedian(d, n, maxD < 1000 ? maxD : 1000) : 0;
    s[i * 3 + j] = s[j * 3 + i] = robust ? (med * med) / Math.LN2 : sum / n;
    a[i * 3 + j] = si / n; a[j * 3 + i] = sj / n;
  }
  const T2 = new Float64Array(K);
  if (K === 2) {
    if (S[0].standard && S[1].standard) {
      const k2 = s[1] / (S[0].medH ** 2 * a[1] + S[1].medH ** 2 * a[3]);
      T2[0] = k2 * S[0].medH ** 2; T2[1] = k2 * S[1].medH ** 2;
    } else { T2[0] = s[1] / 2 / a[1]; T2[1] = s[1] / 2 / a[3]; }
  } else {
    const s01 = s[1], s02 = s[2], s12 = s[5];
    T2[0] = (s01 + s02 - s12) / 2 / ((a[1] + a[2]) / 2);
    T2[1] = (s01 + s12 - s02) / 2 / ((a[3] + a[5]) / 2);
    T2[2] = (s02 + s12 - s01) / 2 / ((a[6] + a[7]) / 2);
  }
  // Not finite (no spread to go by, or a log whose accuracy averages 0 there): 1 m.
  const floor = MIN_ERROR_M * MIN_ERROR_M;
  for (let k = 0; k < K; k++) T2[k] = Number.isFinite(T2[k]) ? (T2[k] > floor ? T2[k] : floor) : 1;
  return T2;
}

/** The most common height difference between each log and the reference, in 1 m steps from -300 to +300 m. */
function elevationOffset(ele: Float32Array, K: number, ref: number, M: number): ComboInfo['eleOffset'] {
  let best: ComboInfo['eleOffset'] = null;
  const h = new Uint32Array(601);
  for (let k = 0; k < K; k++) {
    if (k === ref) continue;
    h.fill(0);
    let n = 0;
    for (let m = 0, b = 0; m < M; m++, b += K) {
      const dz = ele[b + k] - ele[b + ref];
      if (!(dz >= -300 && dz <= 300)) continue; // a log without a height here (NaN) fails too
      h[Math.round(dz) + 300]++; n++;
    }
    if (n < 30) continue;
    let top = 0;
    for (let b = 1; b < 601; b++) if (h[b] > h[top]) top = b;
    const m = top - 300;
    if ((m >= 5 || m <= -5) && (!best || Math.abs(m) > Math.abs(best.m))) best = { from: ref, to: k, m };
  }
  return best;
}
