// The combination gives the same tracks, to the bit, as it did before it laid
// out only the seconds some log covers (2026-11-24). Then its per-second
// values spanned every whole second from the first fix of all the logs to the
// last, so one stray fix days away took hundreds of MB. That version is
// copied below, unchanged but for leaving out the combined track's own
// derive() (MIN_ERROR_M and Use come from the module), and both run on the
// Stanford drive and on synthetic walks in Central Park with gaps, held
// positions, recorded 0s, clock offsets, sparse fixes and stray fixes. Delete
// this file once the combination is meant to give other results. (Since
// 2026-11-25 the copy takes its clock shifts from the module's clockShift, as
// the clock search changed then, and has that day's other changes: the second
// pass of typical errors skips seconds where two logs disagreed, three logs of
// which two never meet take each from the pairs that do, shares are averaged
// over every second, and heights are compared between every pair of logs.
// Since 2026-11-27 it leaves out among the logs that count at each second,
// for each trust, rather than once among all of them. This file checks the
// layout of the seconds.)
import { describe, expect, it } from 'vitest';
import { clockShift, combineTracks, MIN_ERROR_M, recombine, Use, type ComboTrack } from '../../src/combine/combine';
import { parseText } from '../../src/parse/index';
import type { LoadedTrack } from '../../src/model/types';
import { load } from '../helpers/fixtures';

// ---------------------------------------------------------------- the combination before (copied)

type EleOffset = { from: number; to: number; m: number } | null;

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
  for (let i = 0; dropped && i < n; i++) {
    if (v[i] === v[i]) continue;
    let a = i, b = i;
    while (a > 0 && !gap[a]) { a--; if (v[a] === v[a]) break; }
    while (b < n - 1 && !gap[b + 1]) { b++; if (v[b] === v[b]) break; }
    if (a < i && b > i && v[a] === v[a] && v[b] === v[b]) v[i] = v[a] + ((v[b] - v[a]) * (c.t[i] - c.t[a])) / (c.t[b] - c.t[a]);
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
function clockFit(ref: Src, b: Src, shiftMs: number): { tau: number; rms: number; used: number; exact: number; exactRms: number } {
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

const NaN64 = (n: number) => new Float64Array(n).fill(NaN);

interface Prepared {
  ref: number; K: number; n: number;
  shift: Float64Array; clock: Float64Array; T: Float64Array;
  lat0: number; lon0: number; kx: number; ky: number;
  /** Position in metres east and north of lat0/lon0 (NaN where the log has none), accuracy factor, speed, height, course. */
  x: Float64Array; y: Float64Array; now: Float64Array; v: Float64Array; ele: Float32Array; crs: Float32Array;
  /** 1 where a log's fix is left out. */
  left: Uint8Array;
  /** The seconds where some log counts, in order, and what doesn't change with trust there. */
  idx: Int32Array; t: Float64Array; srcLat: Float64Array[]; srcLon: Float64Array[]; disagree: Uint8Array;
  apart: boolean; eleOffset: EleOffset;
}

function mostTrusted(trust: Float64Array): number {
  let ref = 0;
  for (let k = 1; k < trust.length; k++) if (trust[k] > trust[ref] + 1e-9) ref = k;
  return ref;
}

function prepare(tracks: LoadedTrack[], ref: number): Prepared | null {
  const K = tracks.length;
  const lat0 = tracks[0].cols.lat[0], lon0 = tracks[0].cols.lon[0];
  const kx = 111_320 * Math.cos((lat0 * Math.PI) / 180), ky = 110_540;
  const S = tracks.map((t) => toSrc(t, lat0, lon0));

  // 1. Clocks: each log lined up with the reference, by the module's own search (NaN: not lined up, kept).
  const shift = new Float64Array(K), clock = new Float64Array(K);
  for (let k = 0; k < K; k++) {
    if (k === ref) continue;
    const fit = clockFit(S[ref], S[k], 0);
    // No clock difference, and the fixes taken at the same instants identical: the same recording.
    if (fit.exact >= 30 && fit.exactRms < 0.01 && Math.abs(fit.tau) < 0.2) return null;
    clock[k] = clockShift(S[ref], S[k]);
    shift[k] = clock[k] === clock[k] ? clock[k] : 0;
  }

  // 2. Whole seconds across all the logs: every log's values at each (NaN where it has none).
  let t0 = Infinity, t1 = -Infinity;
  for (let k = 0; k < K; k++) { t0 = Math.min(t0, S[k].t[0] - shift[k] * 1000); t1 = Math.max(t1, S[k].t[S[k].n - 1] - shift[k] * 1000); }
  t0 = Math.ceil(t0 / 1000) * 1000; t1 = Math.floor(t1 / 1000) * 1000;
  const M = Math.max(0, Math.round((t1 - t0) / 1000) + 1), MK = M * K;
  const x = NaN64(MK), y = NaN64(MK), now = new Float64Array(MK), v = new Float64Array(MK);
  const ele = new Float32Array(MK).fill(NaN), crs = new Float32Array(MK).fill(NaN);
  for (let k = 0; k < K; k++) {
    const s = S[k], sh = shift[k] * 1000, cur = new Cursor(s, sh);
    for (let m = 0, j = k; m < M; m++, j += K) {
      if (!cur.at(t0 + m * 1000)) continue;
      x[j] = cur.val(s.x); y[j] = cur.val(s.y); now[j] = cur.val(s.now); v[j] = cur.val(s.v);
      const f = cur.fixAt;
      if (f >= 0) { ele[j] = s.ele[f]; crs[j] = s.course[f]; } else { ele[j] = cur.val(s.ele); crs[j] = s.course[cur.lo]; }
    }
  }

  // 5-6. Typical errors from the spread, then leaving out; twice, so jumps don't inflate the spread.
  const left = new Uint8Array(MK), dis = new Uint8Array(M);
  const e = new Float64Array(K), here = new Int8Array(K), T = new Float64Array(K);
  for (let pass = 0; pass < 2; pass++) {
    const T2 = typicalErrors(S, x, y, now, left, dis, K, M, pass === 0);
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
    ref, K, n, shift, clock, T, lat0, lon0, kx, ky, x, y, now, v, ele, crs, left,
    idx: idx.slice(0, n), t, srcLat, srcLon, disagree, apart, eleOffset: elevationOffset(ele, K, ref, M),
  };
}

function finish(p: Prepared, trust: Float64Array) {
  const { K, n, idx, x, y, now, v, ele, crs, T, lat0, lon0, kx, ky } = p;
  const lat = new Float64Array(n), lon = new Float64Array(n), oEle = new Float32Array(n), speed = new Float32Array(n), course = new Float32Array(n);
  const use = new Uint8Array(n * K), eleBreak = new Uint8Array(n);
  const shareSum = new Float64Array(K), w = new Float64Array(K), counted = new Int8Array(K);
  // (2026-11-27) Leaving out among the logs that count: those trusted above 0%, or where none of them has a fix,
  // the others. Before, prepare left out among all the logs (it still does, for the typical errors), and the one
  // log with any trust was never left out.
  // Two trusted logs with a third at 0% go by their spread split evenly.
  const e = new Float64Array(K), here = new Int8Array(K), disagree = new Uint8Array(n), Td = Float64Array.from(T);
  const tr = [0, 1, 2].filter((k) => k < K && trust[k] > 0);
  if (K === 3 && tr.length === 2) Td[tr[0]] = Td[tr[1]] = Math.sqrt((T[tr[0]] * T[tr[0]] + T[tr[1]] * T[tr[1]]) / 2);
  let prevEleMask = -1;
  for (let i = 0; i < n; i++) {
    const b = idx[i] * K, u = i * K;
    let anyTrusted = false, nh = 0, out = -1;
    for (let k = 0; k < K; k++) if (x[b + k] === x[b + k] && trust[k] > 0) anyTrusted = true;
    for (let k = 0; k < K; k++) {
      const j = b + k;
      if (x[j] !== x[j] || (anyTrusted && !(trust[k] > 0))) continue;
      here[nh++] = k;
      const ek = Td[k] * now[j];
      e[k] = ek > MIN_ERROR_M ? ek : MIN_ERROR_M;
    }
    if (nh === 2) {
      const i1 = here[0], j1 = here[1];
      const dx = x[b + i1] - x[b + j1], dy = y[b + i1] - y[b + j1];
      if (dx * dx + dy * dy > 9 * (e[i1] * e[i1] + e[j1] * e[j1])) {
        const hi = e[i1] >= e[j1] ? i1 : j1, lo = hi === i1 ? j1 : i1;
        if (e[hi] > 1.2 * e[lo]) out = hi; else disagree[i] = 1;
      }
    } else if (nh === 3) {
      let bestZ2 = 9;
      for (let c = 0; c < 3; c++) {
        const i1 = here[c], p1 = here[(c + 1) % 3], q = here[(c + 2) % 3];
        const wp = 1 / (e[p1] * e[p1]), wq = 1 / (e[q] * e[q]), W = wp + wq;
        const ax = (wp * x[b + p1] + wq * x[b + q]) / W, ay = (wp * y[b + p1] + wq * y[b + q]) / W;
        const dx = x[b + i1] - ax, dy = y[b + i1] - ay;
        const z2 = (dx * dx + dy * dy) / (e[i1] * e[i1] + 1 / W);
        if (z2 > bestZ2) { bestZ2 = z2; out = i1; }
      }
    }
    let nc = 0, nTrusted = 0;
    for (let k = 0; k < K; k++) {
      const j = b + k;
      if (x[j] !== x[j]) continue; // Use.Absent
      if (k === out) { use[u + k] = Use.LeftOut; continue; }
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
    for (let c = 0; c < nc; c++) { const k = counted[c]; if (w[k] > 0) shareSum[k] += w[k] / W; }
    lat[i] = lat0 + sy / W / ky; lon[i] = lon0 + sx / W / kx;
    oEle[i] = We ? el / We : NaN; speed[i] = Wv ? vv / Wv : NaN;
    course[i] = cs || sn ? ((Math.atan2(sn, cs) * 180) / Math.PI + 360) % 360 : NaN;
    if (prevEleMask >= 0 && eleMask !== prevEleMask) eleBreak[i] = 1;
    prevEleMask = eleMask;
  }
  const uses: Uint8Array[] = [];
  for (let k = 0; k < K; k++) { const a = new Uint8Array(n); for (let i = 0; i < n; i++) a[i] = use[i * K + k]; uses.push(a); }
  return {
    t: p.t, lat, lon, ele: oEle, speed, course, eleBreak, use: uses, srcLat: p.srcLat, srcLon: p.srcLon, disagree, eleOffset: p.eleOffset,
    clockS: Array.from(p.clock), typicalM: Array.from(T), share: Array.from(shareSum, (s) => (n ? s / n : 0)), apart: p.apart,
  };
}

function normalTrust(trust: number[] | undefined, K: number): Float64Array {
  const out = new Float64Array(K);
  let sum = 0;
  if (trust && trust.length === K) for (let k = 0; k < K; k++) { const v = trust[k] > 0 && trust[k] < Infinity ? trust[k] : 0; out[k] = v; sum += v; }
  if (sum > 0) for (let k = 0; k < K; k++) out[k] /= sum;
  else out.fill(1 / K);
  return out;
}

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
function typicalErrors(S: Src[], x: Float64Array, y: Float64Array, now: Float64Array, left: Uint8Array, dis: Uint8Array, K: number, M: number, robust: boolean): Float64Array {
  const s = new Float64Array(9), a = new Float64Array(9).fill(1), np = new Float64Array(9);
  const d = new Float64Array(M);
  for (let i = 0; i < K; i++) for (let j = i + 1; j < K; j++) {
    let n = 0, sum = 0, si = 0, sj = 0, maxD = 0;
    for (let m = 0, bi = i, bj = j; m < M; m++, bi += K, bj += K) {
      if (left[bi] || left[bj] || dis[m]) continue;
      const dx = x[bi] - x[bj], dy = y[bi] - y[bj], dd = dx * dx + dy * dy;
      if (dd !== dd) continue;
      const dist = Math.sqrt(dd);
      d[n++] = dist; sum += dd; si += now[bi] * now[bi]; sj += now[bj] * now[bj]; if (dist > maxD) maxD = dist;
    }
    np[i * 3 + j] = n;
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
  } else if (np[1] >= 30 && np[2] >= 30 && np[5] >= 30) {
    const s01 = s[1], s02 = s[2], s12 = s[5];
    T2[0] = (s01 + s02 - s12) / 2 / ((a[1] + a[2]) / 2);
    T2[1] = (s01 + s12 - s02) / 2 / ((a[3] + a[5]) / 2);
    T2[2] = (s02 + s12 - s01) / 2 / ((a[6] + a[7]) / 2);
  } else {
    for (let k = 0; k < 3; k++) {
      let sum = 0, c = 0;
      for (let j = 0; j < 3; j++) { const p = k < j ? k * 3 + j : j * 3 + k; if (j !== k && np[p] >= 30) { sum += s[p] / 2 / a[k * 3 + j]; c++; } }
      T2[k] = c ? sum / c : NaN;
    }
  }
  const floor = MIN_ERROR_M * MIN_ERROR_M;
  for (let k = 0; k < K; k++) T2[k] = T2[k] === T2[k] && T2[k] > floor ? T2[k] : T2[k] === T2[k] ? floor : 1;
  return T2;
}

/** The most common height difference between each pair of logs (those with the reference first), in 1 m steps from -300 to +300 m. */
function elevationOffset(ele: Float32Array, K: number, ref: number, M: number): EleOffset {
  let best: EleOffset = null;
  const h = new Uint32Array(601), pairs: [number, number][] = [];
  for (let k = 0; k < K; k++) if (k !== ref) pairs.push([ref, k]);
  if (K === 3) pairs.push(ref === 0 ? [1, 2] : ref === 1 ? [0, 2] : [0, 1]);
  for (const [from, k] of pairs) {
    h.fill(0);
    let n = 0;
    for (let m = 0, b = 0; m < M; m++, b += K) {
      const dz = ele[b + k] - ele[b + from];
      if (!(dz >= -300 && dz <= 300)) continue; // a log without a height here (NaN) fails too
      h[Math.round(dz) + 300]++; n++;
    }
    if (n < 30) continue;
    let top = 0;
    for (let b = 1; b < 601; b++) if (h[b] > h[top]) top = b;
    const m = top - 300;
    if ((m >= 5 || m <= -5) && (!best || Math.abs(m) > Math.abs(best.m))) best = { from, to: k, m };
  }
  return best;
}
/** The copied combination; null for the same recording twice, 'empty' when no log has a position at a whole second. */
function before(tracks: LoadedTrack[], trustIn?: number[]) {
  const trust = normalTrust(trustIn, tracks.length);
  const p = prepare(tracks, mostTrusted(trust));
  if (!p) return null;
  if (p.n === 0) return 'empty' as const;
  return finish(p, trust);
}

// ---------------------------------------------------------------- the logs

const KY = 110_540, KX = KY * Math.cos((40.7712 * Math.PI) / 180);
const REPEATER = 'igotU_GPS_WIN'; // the creator a logger that repeats its last fix writes (data): its repeats are dropped when read
interface Walk { seed: number; offsetM?: number; shiftS?: number; seconds?: number; step?: number; gaps?: [number, number][]; hold?: [number, number]; holdSpeed?: number; repeater?: boolean; zero?: (i: number) => boolean; hdop?: (i: number) => number; ele?: (i: number) => number; stray?: number[]; speed?: boolean }

/** A walk at 1.5 m/s in Central Park as GPX: east for 150 s, then north. `stray`: lone fixes that many seconds before the start. */
function walk(o: Walk): LoadedTrack {
  const t0 = Date.UTC(2026, 5, 14, 9, 0, 0) + (o.shiftS ?? 0) * 1000;
  let seed = o.seed;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5) * 2;
  const iso = (t: number) => new Date(t).toISOString().replace('.000Z', 'Z');
  const lines = (o.stray ?? []).map((s, k) => `<trkpt lat="${(40.7722 + k * 1e-4).toFixed(7)}" lon="-73.9742000"><time>${iso(t0 - s * 1000)}</time></trkpt>`);
  let lastLat = 0, lastLon = 0;
  for (let i = 0; i < (o.seconds ?? 300); i += o.step ?? 1) {
    const east = Math.min(i, 150) * 1.5, north = Math.max(0, i - 150) * 1.5;
    let lat = 40.7712 + ((o.offsetM ?? 0) + north + rnd() * 0.8) / KY, lon = -73.9742 + (east + rnd() * 0.8) / KX;
    const holding = o.hold && i > o.hold[0] && i < o.hold[1];
    if (holding) { lat = lastLat; lon = lastLon; }
    lastLat = lat; lastLon = lon;
    if (o.gaps?.some(([a, b]) => i >= a && i < b)) continue;
    const sp = holding && o.holdSpeed !== undefined ? o.holdSpeed : o.zero?.(i) ? 0 : 1.5;
    const extra = `${o.ele ? `<ele>${o.ele(i).toFixed(1)}</ele>` : ''}${o.hdop ? `<hdop>${o.hdop(i).toFixed(1)}</hdop>` : ''}${o.speed === false ? '' : `<extensions><gpxtpx:TrackPointExtension><gpxtpx:speed>${sp.toFixed(2)}</gpxtpx:speed></gpxtpx:TrackPointExtension></extensions>`}`;
    lines.push(`<trkpt lat="${lat.toFixed(7)}" lon="${lon.toFixed(7)}"><time>${iso(t0 + i * 1000)}</time>${extra}</trkpt>`);
  }
  const gpx = `<?xml version="1.0"?><gpx version="1.1" creator="${o.repeater ? REPEATER : 'test'}" xmlns="http://www.topografix.com/GPX/1/1" xmlns:gpxtpx="http://www.garmin.com/xmlschemas/TrackPointExtension/v2"><trk><trkseg>${lines.join('')}</trkseg></trk></gpx>`;
  const r = parseText(gpx, `walk-${o.seed}.gpx`);
  if (!r.ok) throw new Error(r.error);
  return r.track;
}

// ---------------------------------------------------------------- the comparison

/** Where two typed arrays first differ (NaN equal to NaN, -0 not equal to 0), or -1. */
function firstDiff(a: ArrayLike<number>, b: ArrayLike<number>): number {
  if (a.length !== b.length) return Math.min(a.length, b.length);
  for (let i = 0; i < a.length; i++) if (!Object.is(a[i], b[i])) return i;
  return -1;
}

/** What differs between a combined track and what the copy gave. */
function differs(c: ComboTrack, apart: boolean, old: ReturnType<typeof finish>): string[] {
  const out: string[] = [], s = c.combo.sources;
  const check = (name: string, a: ArrayLike<number>, b: ArrayLike<number>) => {
    const i = firstDiff(a, b);
    if (i >= 0) out.push(`${name}[${i}]: ${a[i]} now, ${b[i]} before (${a.length} and ${b.length} values)`);
  };
  check('t', c.cols.t, old.t); check('lat', c.cols.lat, old.lat); check('lon', c.cols.lon, old.lon);
  check('ele', c.cols.ele, old.ele); check('speed', c.cols.speed, old.speed); check('course', c.cols.course, old.course);
  check('eleBreak', c.eleBreak!, old.eleBreak); check('disagree', c.combo.disagree, old.disagree);
  old.use.forEach((u, k) => check(`use ${k}`, c.combo.use[k], u));
  old.srcLat.forEach((v, k) => check(`srcLat ${k}`, c.combo.srcLat[k], v));
  old.srcLon.forEach((v, k) => check(`srcLon ${k}`, c.combo.srcLon[k], v));
  check('clockS', s.map((x) => x.clockS), old.clockS); check('typicalM', s.map((x) => x.typicalM), old.typicalM); check('share', s.map((x) => x.share), old.share);
  if (JSON.stringify(c.combo.eleOffset) !== JSON.stringify(old.eleOffset)) out.push(`eleOffset: ${JSON.stringify(c.combo.eleOffset)} now, ${JSON.stringify(old.eleOffset)} before`);
  if (apart !== old.apart) out.push(`apart: ${apart} now, ${old.apart} before`);
  return out;
}

/** What differs between the combination now and before, for each trust (undefined: equal shares): afresh, and after a trust change. */
function differences(logs: LoadedTrack[], trusts: (number[] | undefined)[]): string[] {
  const out: string[] = [];
  let first: ComboTrack | null = null;
  for (const trust of trusts) {
    const r = combineTracks(logs, { trust }), old = before(logs, trust), at = `${logs.map((l) => l.file).join('+')}, trust ${JSON.stringify(trust ?? 'equal')}`;
    if (!r.ok || old === null || old === 'empty') { out.push(`${at}: ${r.ok ? 'ok' : r.reason} now, ${old === null ? 'duplicate' : old === 'empty' ? 'empty' : 'ok'} before`); continue; }
    out.push(...differs(r.track, r.apart, old).map((d) => `${at}: ${d}`));
    if (first && trust) out.push(...differs(recombine(first, trust), r.apart, old).map((d) => `${at}, after a trust change: ${d}`));
    first ??= r.track;
  }
  return out;
}

describe('the combination, against the copy of it from before it laid out only the covered seconds', () => {
  const car = load('stanford-drive-car.nmea'), phone = load('stanford-drive-phone.gpx'), logger = load('stanford-drive-logger.gpx');

  it('gives the same Stanford drive, from any trust, with car, phone and logger and in pairs', () => {
    expect([
      ...differences([car, phone, logger], [undefined, [0.5, 0.2, 0.3], [0.2, 0.3, 0.5], [0, 0.5, 0.5], [0, 1, 0], [1, 0, 0]]),
      ...differences([car, phone], [undefined, [0.01, 0.99], [0, 1], [0.4, 0.6]]),
      ...differences([phone, logger], [undefined, [0.7, 0.3]]),
      // The logger's CSV is read 7 h early: hours of seconds where only one log has a fix, or none.
      ...differences([car, load('stanford-drive-logger.csv')], [undefined]),
    ]).toEqual([]);
  });

  it('gives the same walks with gaps, held positions, recorded 0s, clock offsets, heights and HDOP', () => {
    expect([
      ...differences([walk({ seed: 2 }), walk({ seed: 3, offsetM: 3, hold: [100, 140], holdSpeed: 0, repeater: true })], [undefined, [0.3, 0.7]]),
      ...differences([walk({ seed: 2 }), walk({ seed: 3, offsetM: 3, hold: [20, 200], repeater: true })], [undefined]),
      ...differences([walk({ seed: 2 }), walk({ seed: 3, offsetM: 3, hold: [100, 140], holdSpeed: 0 })], [undefined]),
      ...differences([walk({ seed: 4, gaps: [[120, 160]] }), walk({ seed: 5, offsetM: 4 })], [undefined, [1, 0], [0, 1]]),
      ...differences([walk({ seed: 31 }), walk({ seed: 32, offsetM: 3, zero: (i) => i % 97 < 30 || i < 5 || i > 290, gaps: [[40, 52]] })], [undefined]),
      ...differences([walk({ seed: 9 }), walk({ seed: 10, offsetM: 2, shiftS: 0.7 })], [undefined, [0.2, 0.8]]),
      ...differences([walk({ seed: 61, ele: (i) => 20 + 8 * Math.sin(i / 20), hdop: (i) => (i % 2 ? 1.5 : 0.5) }), walk({ seed: 62, offsetM: 3, ele: (i) => 50 + 8 * Math.sin(i / 20) + (i % 7), hdop: (i) => 0.8 + (i % 5) * 0.2 })], [undefined]),
      ...differences([walk({ seed: 21, gaps: [[50, 80]] }), walk({ seed: 22, offsetM: 3, gaps: [[100, 170]], shiftS: 1.3 }), walk({ seed: 23, offsetM: -2, seconds: 250, hold: [30, 60], repeater: true })], [undefined, [0.1, 0.1, 0.8], [0.2, 0.7, 0.1]]),
    ]).toEqual([]);
  });

  it('gives the same walks with sparse fixes and with stray fixes hours or a day away', () => {
    expect([
      ...differences([walk({ seed: 51, step: 3, seconds: 900 }), walk({ seed: 52, offsetM: 3, step: 5, seconds: 900 }), walk({ seed: 53, offsetM: -3, step: 10, seconds: 900, shiftS: 2 })], [undefined, [0.2, 0.2, 0.6]]),
      ...differences([walk({ seed: 41 }), walk({ seed: 42, offsetM: 3, stray: [86_400] })], [undefined, [0.2, 0.8]]),
      ...differences([walk({ seed: 43, gaps: [[10, 40]], stray: [7_200, 7_199] }), walk({ seed: 44, offsetM: 3, stray: [3_600], gaps: [[200, 260]] }), walk({ seed: 45, offsetM: -3, shiftS: -0.4 })], [undefined, [0.3, 0.3, 0.4]]),
    ]).toEqual([]);
  });

  it('gives the same tracks for walks made up at random', () => {
    let s = 2026;
    const rnd = () => (s = (s * 48271) % 2147483647) / 2147483647, found: string[] = [];
    for (let run = 0; run < 12; run++) {
      const logs = Array.from({ length: 2 + Math.floor(rnd() * 2) }, (_, k) => {
        const a = Math.floor(rnd() * 250), gaps: [number, number][] = rnd() < 0.7 ? [[a, a + 11 + Math.floor(rnd() * 60)]] : [];
        return walk({
          seed: 100 + run * 3 + k, offsetM: (rnd() - 0.5) * 8, shiftS: Math.round((rnd() - 0.5) * 30) / 10, seconds: 200 + Math.floor(rnd() * 200),
          step: rnd() < 0.2 ? 2 + Math.floor(rnd() * 4) : 1, gaps, zero: rnd() < 0.3 ? (i) => i % 13 < 4 : undefined,
          stray: rnd() < 0.3 ? [Math.floor(rnd() * 200_000)] : undefined, hdop: rnd() < 0.5 ? (i) => 0.6 + ((i * 7) % 11) / 10 : undefined,
          hold: rnd() < 0.3 ? [a, a + 20] : undefined, holdSpeed: 0, repeater: rnd() < 0.5,
        });
      });
      found.push(...differences(logs, [undefined, logs.map(() => rnd())]).map((d) => `run ${run}: ${d}`));
    }
    expect(found).toEqual([]);
  });
});
