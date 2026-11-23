// Combining 2 or 3 logs of the same trip into one track. Every step is one
// pass (or a fixed few) through the logs in time order, so the work grows in
// step with the number of fixes, and the hot loops allocate nothing: buffers
// are typed arrays sized once, distances are compared squared.
//
//  1. Clocks: a least-squares fit of the gap between each log and the
//     reference as a steady offset minus (clock difference x velocity),
//     rounded to tenths of a second and applied from 0.2 s up to 10 s.
//  2. Points on whole seconds; each log placed there from its own fixes,
//     interpolated between fixes at most 10 s apart.
//  3. Each fix's accuracy (HDOP, else satellites, against the log's own
//     median; corrected fixes count double) averaged over 10 s.
//  4. Held positions (the third or later identical fix in a row) don't count
//     while another log moves more than 10 m.
//  5. Each logger's typical error from the spread between the logs.
//  6. A log too far from the others to be believed is left out at that second.
//  7. Weights: trust / error^2. A log at 0% trust only fills gaps.
//  8. Position, elevation (as recorded), speed and course: weighted averages
//     of the logs' own values. Speed never comes from the combined points.
//  9. A steady elevation offset between logs is worked out, not applied.
//     Where the logs giving the height change, grade and climb don't reach
//     across (the height may jump there by that offset).
import type { Columns, FieldKey, LoadedTrack } from '../model/types';
import { derive } from '../derive/derive';

export const MAX_LOGS = 3;
/** Fixes further apart than this are not interpolated across (ms). */
export const MAX_SPAN_MS = 10_000;
/** Each fix's accuracy is averaged over this many seconds. */
export const SMOOTH_S = 10;
/** Held fixes stop counting once another log has moved this far (m). */
export const HOLD_MOVE_M = 10;
/** Expected errors never go below this (m). */
export const MIN_ERROR_M = 0.5;

/** What happened to a log at one second of the combined track. Idle: at 0% trust and not needed to fill a gap. */
export const Use = { Absent: 0, Used: 1, LeftOut: 2, Held: 3, Idle: 4 } as const;

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
    const shared = Math.max(0, Math.min(a1, b1) - Math.max(a0, b0));
    if (shared < Math.min(a1 - a0, b1 - b0) / 2) {
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
  runStart: Int32Array; standard: boolean; medH: number; n: number;
}

/** The median of the values `keep` accepts, by selection in a scratch copy: linear on average, no sorting. */
export function medianWhere(a: ArrayLike<number>, keep: (v: number) => boolean): number {
  let n = 0;
  for (let i = 0; i < a.length; i++) if (keep(a[i])) n++;
  if (!n) return NaN;
  const w = new Float64Array(n);
  for (let i = 0, j = 0; i < a.length; i++) if (keep(a[i])) w[j++] = a[i];
  const k = n >> 1;
  let lo = 0, hi = n - 1;
  while (lo < hi) {
    const pivot = w[(lo + hi) >> 1];
    let i = lo, j = hi;
    while (i <= j) {
      while (w[i] < pivot) i++;
      while (w[j] > pivot) j--;
      if (i <= j) { const tmp = w[i]; w[i] = w[j]; w[j] = tmp; i++; j--; }
    }
    if (k <= j) hi = j; else if (k >= i) lo = i; else break;
  }
  return w[k];
}

const positive = (h: number) => h > 0 && h < Infinity;

function toSrc(tr: LoadedTrack, lat0: number, lon0: number): Src {
  const c = tr.cols, n = c.n, d = tr.derived;
  const kx = 111_320 * Math.cos((lat0 * Math.PI) / 180), ky = 110_540;
  const x = new Float64Array(n), y = new Float64Array(n), now = new Float64Array(n), v = new Float64Array(n);
  const fromFile = d.speedFromFile;
  for (let i = 0; i < n; i++) {
    x[i] = (c.lon[i] - lon0) * kx; y[i] = (c.lat[i] - lat0) * ky;
    // The log's own speed: recorded where it has one, else what the app works out for it alone.
    const sp = c.speed[i];
    v[i] = fromFile && sp === sp ? sp : d.kmh[i] / 3.6;
  }
  const hasH = tr.fields.includes('hdop'), hasS = tr.fields.includes('sats');
  let medH = NaN;
  if (hasH) {
    medH = medianWhere(c.hdop, positive);
    for (let i = 0; i < n; i++) { const h = c.hdop[i]; now[i] = h > 0 && h < Infinity ? h / medH : 1; }
  } else if (hasS) {
    const m = medianWhere(c.sats, positive);
    for (let i = 0; i < n; i++) { const s = c.sats[i]; now[i] = s > 0 && s < Infinity ? m / s : 1; }
  } else now.fill(1);
  const fq = c.fixq;
  for (let i = 0; i < n; i++) if (fq[i] === 2) now[i] *= Math.SQRT1_2;
  const runStart = new Int32Array(n);
  for (let i = 1; i < n; i++) runStart[i] = x[i] === x[i - 1] && y[i] === y[i - 1] ? runStart[i - 1] : i;
  return { t: c.t, x, y, now: smooth(c.t, now, SMOOTH_S), v, course: c.course, ele: c.ele, runStart, standard: hasH && !d.hdopRelative, medH, n };
}

/** A moving average over a window of seconds around each fix, with two pointers. */
export function smooth(t: Float64Array, v: Float64Array, windowS: number): Float64Array {
  const n = v.length, out = new Float64Array(n), half = (windowS * 1000) / 2;
  let a = 0, b = 0, sum = 0;
  for (let i = 0; i < n; i++) {
    const ti = t[i];
    while (b < n && t[b] <= ti + half) sum += v[b++];
    while (t[a] < ti - half) sum -= v[a++];
    out[i] = sum / (b - a);
  }
  return out;
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
      if (ti < T && t[i + 1] - t[i] <= MAX_SPAN_MS) { this.fixAt = -1; this.f = (T - ti) / (tj - ti); return true; }
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
    const dt = rt[i + 1] - rt[i - 1];
    if (dt <= 0 || dt > 4000 || !cur.at(rt[i])) continue;
    const dx = cur.val(bx) - rx[i], dy = cur.val(by) - ry[i];
    const dd = dx * dx + dy * dy;
    if (cur.fixAt >= 0) { exact++; exact2 += dd; }
    if (dd > 10_000) continue; // over 100 m apart: not for the fit
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

// ---------------------------------------------------------------- the combination

export interface ComboOptions { trust?: number[]; name?: string }

export type ComboOutcome =
  | { ok: true; track: ComboTrack; apart: boolean }
  | { ok: false; reason: 'duplicate' | 'empty' };

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
  /** 1 where a log's fix is held, or left out. */
  held: Uint8Array; left: Uint8Array;
  /** The seconds where some log counts, in order, and what doesn't change with trust there. */
  idx: Int32Array; t: Float64Array; srcLat: Float64Array[]; srcLon: Float64Array[]; disagree: Uint8Array;
  apart: boolean; eleOffset: ComboInfo['eleOffset'];
}

/** Each combined track's prepared work, so new trust redoes only the weighted averages. */
const preparedFor = new WeakMap<ComboTrack, Prepared>();

/** The log trusted most (the first one ticked, on a tie): it keeps its own clock. */
function mostTrusted(trust: Float64Array): number {
  let ref = 0;
  for (let k = 1; k < trust.length; k++) if (trust[k] > trust[ref] + 1e-9) ref = k;
  return ref;
}

/** Steps 1 to 6, and what follows from them. Null for two copies of the same recording. */
function prepare(tracks: LoadedTrack[], ref: number): Prepared | null {
  const K = tracks.length;
  const lat0 = tracks[0].cols.lat[0], lon0 = tracks[0].cols.lon[0];
  const kx = 111_320 * Math.cos((lat0 * Math.PI) / 180), ky = 110_540;
  const S = tracks.map((t) => toSrc(t, lat0, lon0));

  // 1. Clocks: each log lined up with the reference.
  const shift = new Float64Array(K);
  for (let k = 0; k < K; k++) {
    if (k === ref) continue;
    let total = 0;
    for (let pass = 0; pass < 2; pass++) {
      const fit = clockFit(S[ref], S[k], total * 1000);
      // No clock difference, and the fixes taken at the same instants identical: the same recording.
      if (pass === 0 && fit.exact >= 30 && fit.exactRms < 0.01 && Math.abs(fit.tau) < 0.2) return null;
      const step = Math.round(fit.tau * 10) / 10;
      if (Math.abs(step) < 0.2 || Math.abs(total + step) > 10) break;
      total = Math.round((total + step) * 10) / 10;
    }
    shift[k] = total;
  }

  // 2. Whole seconds across all the logs: every log's values at each (NaN where it has none).
  let t0 = Infinity, t1 = -Infinity;
  for (let k = 0; k < K; k++) { t0 = Math.min(t0, S[k].t[0] - shift[k] * 1000); t1 = Math.max(t1, S[k].t[S[k].n - 1] - shift[k] * 1000); }
  t0 = Math.ceil(t0 / 1000) * 1000; t1 = Math.floor(t1 / 1000) * 1000;
  const M = Math.max(0, Math.round((t1 - t0) / 1000) + 1), MK = M * K;
  const x = NaN64(MK), y = NaN64(MK), now = new Float64Array(MK), v = new Float64Array(MK), hold0 = NaN64(MK);
  const ele = new Float32Array(MK).fill(NaN), crs = new Float32Array(MK).fill(NaN);
  for (let k = 0; k < K; k++) {
    const s = S[k], sh = shift[k] * 1000, cur = new Cursor(s, sh), rs = s.runStart;
    for (let m = 0, j = k; m < M; m++, j += K) {
      if (!cur.at(t0 + m * 1000)) continue;
      x[j] = cur.val(s.x); y[j] = cur.val(s.y); now[j] = cur.val(s.now); v[j] = cur.val(s.v);
      const f = cur.fixAt;
      if (f >= 0) { ele[j] = s.ele[f]; crs[j] = s.course[f]; } else { ele[j] = cur.val(s.ele); crs[j] = s.course[cur.lo]; }
      // Inside a hold (the third or later identical fix): when it began. Between two fixes of one hold, the same.
      const i = f >= 0 ? f : rs[cur.lo + 1] === rs[cur.lo] ? cur.lo + 1 : -1;
      if (i >= 0 && i - rs[i] >= 2) hold0[j] = s.t[rs[i]] - sh;
    }
  }

  // 4. A held fix stops counting once another log has moved over 10 m since the hold began.
  const held = new Uint8Array(MK), holdMove2 = HOLD_MOVE_M * HOLD_MOVE_M;
  for (let m = 0, b = 0; m < M; m++, b += K) {
    for (let k = 0; k < K; k++) {
      const st = hold0[b + k];
      if (st !== st) continue;
      let m0 = Math.round((st - t0) / 1000);
      m0 = m0 < 0 ? 0 : m0 >= M ? M - 1 : m0;
      const b0 = m0 * K;
      for (let o = 0; o < K; o++) {
        if (o === k) continue;
        const dx = x[b + o] - x[b0 + o], dy = y[b + o] - y[b0 + o];
        if (dx * dx + dy * dy > holdMove2) { held[b + k] = 1; break; } // NaN compares false: absent logs never count
      }
    }
  }

  // 5-6. Typical errors from the spread, then leaving out; twice, so jumps don't inflate the spread.
  const left = new Uint8Array(MK), dis = new Uint8Array(M);
  const e = new Float64Array(K), here = new Int8Array(K), T = new Float64Array(K);
  for (let pass = 0; pass < 2; pass++) {
    const T2 = typicalErrors(S, x, y, now, held, left, K, M, pass === 0);
    left.fill(0);
    dis.fill(0);
    for (let k = 0; k < K; k++) T[k] = Math.sqrt(T2[k]);
    for (let m = 0, b = 0; m < M; m++, b += K) {
      let nh = 0;
      for (let k = 0; k < K; k++) {
        const j = b + k;
        if (x[j] !== x[j] || held[j]) continue;
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

  // The seconds where some log counts (present, not held, not left out), and
  // whether two logs are over 100 m apart for most of the time they share.
  const idx = new Int32Array(M);
  const apartN = new Float64Array(9), sharedN = new Float64Array(9);
  let n = 0;
  for (let m = 0, b = 0; m < M; m++, b += K) {
    let counts = false;
    for (let k = 0; k < K; k++) { const j = b + k; if (x[j] === x[j] && !held[j] && !left[j]) counts = true; }
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
  for (let i = 0; i < n; i++) { t[i] = t0 + idx[i] * 1000; disagree[i] = dis[idx[i]]; }
  for (let k = 0; k < K; k++) {
    const la = new Float64Array(n), lo = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const j = idx[i] * K + k, xv = x[j];
      if (xv === xv) { la[i] = lat0 + y[j] / ky; lo[i] = lon0 + xv / kx; } else { la[i] = NaN; lo[i] = NaN; }
    }
    srcLat.push(la); srcLon.push(lo);
  }
  return {
    ref, K, n, shift, T, lat0, lon0, kx, ky, x, y, now, v, ele, crs, held, left,
    idx: idx.slice(0, n), t, srcLat, srcLon, disagree, apart, eleOffset: elevationOffset(ele, K, ref, M),
  };
}

/** Steps 7 and 8: the weighted averages for this trust, and the combined track. */
function finish(tracks: LoadedTrack[], p: Prepared, trust: Float64Array, name: string): ComboTrack {
  const { K, n, idx, x, y, now, v, ele, crs, held, left, T, lat0, lon0, kx, ky } = p;
  const lat = new Float64Array(n), lon = new Float64Array(n), oEle = new Float32Array(n), speed = new Float32Array(n), course = new Float32Array(n);
  const use = new Uint8Array(n * K), eleBreak = new Uint8Array(n);
  const shareSum = new Float64Array(K), shareN = new Float64Array(K), w = new Float64Array(K), counted = new Int8Array(K);
  let prevEleMask = -1;
  for (let i = 0; i < n; i++) {
    const b = idx[i] * K, u = i * K;
    let nc = 0, nTrusted = 0;
    for (let k = 0; k < K; k++) {
      const j = b + k;
      if (x[j] !== x[j]) continue; // Use.Absent
      if (held[j]) { use[u + k] = Use.Held; continue; }
      if (left[j]) { use[u + k] = Use.LeftOut; continue; }
      counted[nc++] = k;
      if (trust[k] > 0) nTrusted++;
    }
    // A log at 0% trust only fills gaps: it counts where no trusted log does.
    let W = 0, sx = 0, sy = 0, We = 0, el = 0, Wv = 0, vv = 0, cs = 0, sn = 0, eleMask = 0;
    for (let c = 0; c < nc; c++) {
      const k = counted[c], j = b + k;
      if (nTrusted && !(trust[k] > 0)) { use[u + k] = Use.Idle; w[k] = 0; continue; }
      use[u + k] = Use.Used;
      const ek = T[k] * now[j], err = ek > MIN_ERROR_M ? ek : MIN_ERROR_M;
      const wk = (nTrusted ? trust[k] : 1) / (err * err);
      w[k] = wk; W += wk; sx += wk * x[j]; sy += wk * y[j];
      const ev = ele[j]; if (ev === ev) { We += wk; el += wk * ev; eleMask |= 1 << k; }
      const vk = v[j]; if (vk === vk) { Wv += wk; vv += wk * vk; }
      const ck = crs[j]; if (ck === ck) { const r = ck * (Math.PI / 180); cs += wk * Math.cos(r); sn += wk * Math.sin(r); }
    }
    for (let c = 0; c < nc; c++) { const k = counted[c]; if (w[k] > 0) { shareSum[k] += w[k] / W; shareN[k]++; } }
    lat[i] = lat0 + sy / W / ky; lon[i] = lon0 + sx / W / kx;
    oEle[i] = We ? el / We : NaN; speed[i] = Wv ? vv / Wv : NaN;
    course[i] = cs || sn ? ((Math.atan2(sn, cs) * 180) / Math.PI + 360) % 360 : NaN;
    if (prevEleMask >= 0 && eleMask !== prevEleMask) eleBreak[i] = 1;
    prevEleMask = eleMask;
  }
  const uses: Uint8Array[] = [];
  for (let k = 0; k < K; k++) { const a = new Uint8Array(n); for (let i = 0; i < n; i++) a[i] = use[i * K + k]; uses.push(a); }

  const nan32 = () => new Float32Array(n).fill(NaN);
  const cols: Columns = {
    n, t: p.t.slice(), lat, lon, ele: oEle, speed, course,
    hdop: nan32(), vdop: nan32(), pdop: nan32(), sats: nan32(), fixq: new Int8Array(n), geoid: nan32(), accel: nan32(),
    line: new Int32Array(n).fill(-1), lineEnd: new Int32Array(n).fill(-1), seg: new Uint8Array(n),
  };
  const fields: FieldKey[] = ['time', 'position'];
  if (oEle.some((h) => h === h)) fields.push('ele');
  fields.push('speed');
  if (course.some((c) => c === c)) fields.push('course');
  const combo: ComboInfo = {
    sources: tracks.map((track, k) => ({ track, clockS: p.shift[k], trust: trust[k], typicalM: T[k], share: shareN[k] ? shareSum[k] / shareN[k] : 0 })),
    ref: p.ref, use: uses, srcLat: p.srcLat.map((a) => a.slice()), srcLon: p.srcLon.map((a) => a.slice()),
    disagree: p.disagree.slice(), eleOffset: p.eleOffset && { ...p.eleOffset },
  };
  const parsed = { format: 'combined' as const, creator: null, name: null, cols, flags: [], problems: [], notes: [], fields, lines: n, eleBreak };
  const track: ComboTrack = { ...parsed, file: name, sizeBytes: 0, derived: derive(parsed), combo };
  preparedFor.set(track, p);
  return track;
}

/** Combines 2 or 3 logs. `apart`: two of them are over 100 m apart for more than half the time they share. */
export function combineTracks(tracks: LoadedTrack[], opts: ComboOptions = {}): ComboOutcome {
  const trust = normalTrust(opts.trust, tracks.length);
  const p = prepare(tracks, mostTrusted(trust));
  if (!p) return { ok: false, reason: 'duplicate' };
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
  const r = combineTracks(tracks, { trust, name: track.file });
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
function typicalErrors(S: Src[], x: Float64Array, y: Float64Array, now: Float64Array, held: Uint8Array, left: Uint8Array, K: number, M: number, robust: boolean): Float64Array {
  const s = new Float64Array(9), a = new Float64Array(9).fill(1);
  const d = new Float64Array(M);
  for (let i = 0; i < K; i++) for (let j = i + 1; j < K; j++) {
    let n = 0, sum = 0, si = 0, sj = 0, maxD = 0;
    for (let bi = i, bj = j, end = M * K; bi < end; bi += K, bj += K) {
      if (held[bi] || held[bj] || left[bi] || left[bj]) continue;
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
  const floor = MIN_ERROR_M * MIN_ERROR_M;
  for (let k = 0; k < K; k++) T2[k] = T2[k] === T2[k] && T2[k] > floor ? T2[k] : T2[k] === T2[k] ? floor : 1;
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
