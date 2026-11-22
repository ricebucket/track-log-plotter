import type { Columns, Derived, ParsedTrack, TrackStats } from '../model/types';
import { haversine, median, quantile } from './geo';
import { hdopIsRelative } from './hdop';

/** Half of the distance window used for grade, in meters (120 m in total). */
export const GRADE_HALF_WINDOW = 60;
/** Climb is counted only once the elevation has risen this much (m). */
export const CLIMB_HYSTERESIS = 5;
/** GPS height is smoothed over this many seconds either side before grade and climb. */
export const ELE_SMOOTH_S = 15;
/** Below this speed (km/h) the logger counts as standing still. */
export const MOVING_KMH = 1.5;

/** Seconds without a fix that count as a gap, given the usual interval. */
export function gapThreshold(intervalS: number): number {
  return Math.max(10, 5 * intervalS);
}

export function medianInterval(cols: Columns): number {
  const dts = new Float64Array(Math.max(0, cols.n - 1));
  let k = 0;
  for (let i = 1; i < cols.n; i++) if (!cols.seg[i]) dts[k++] = (cols.t[i] - cols.t[i - 1]) / 1000;
  const m = median(dts.subarray(0, k));
  return Number.isFinite(m) ? m : 1;
}

export function derive(p: ParsedTrack): Derived {
  const c = p.cols;
  const n = c.n;
  const dist = new Float64Array(n);
  const gap = new Uint8Array(n);
  const intervalS = medianInterval(c);
  const gapS = gapThreshold(intervalS);

  for (let i = 1; i < n; i++) {
    dist[i] = dist[i - 1] + haversine(c.lat[i - 1], c.lon[i - 1], c.lat[i], c.lon[i]);
    if (c.seg[i] || (c.t[i] - c.t[i - 1]) / 1000 > gapS) gap[i] = 1;
  }

  // Speed: from positions, over the neighboring fixes within the same run.
  const fromPos = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const a = i > 0 && !gap[i] ? i - 1 : i;
    const b = i < n - 1 && !gap[i + 1] ? i + 1 : i;
    const dt = (c.t[b] - c.t[a]) / 1000;
    fromPos[i] = a === b || dt <= 0 ? NaN : ((dist[b] - dist[a]) / dt) * 3.6;
  }
  let withSpeed = 0;
  for (let i = 0; i < n; i++) if (Number.isFinite(c.speed[i])) withSpeed++;
  const speedFromFile = n > 0 && withSpeed >= n * 0.5;
  const kmh = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const f = c.speed[i];
    kmh[i] = speedFromFile && Number.isFinite(f) ? f * 3.6 : fromPos[i];
  }
  // A lone fix between gaps has no speed of its own: call it standing still.
  for (let i = 0; i < n; i++) if (!Number.isFinite(kmh[i])) kmh[i] = 0;

  const eleS = smoothEle(c, gap);
  const grade = gradeOf(c, eleS, dist, gap);
  const hdopRelative = hdopIsRelative(c.hdop, c.sats);
  const q1 = quantile(c.hdop, 0.25), q2 = quantile(c.hdop, 0.5), q3 = quantile(c.hdop, 0.75);
  const hdopQ: [number, number, number] | null = Number.isFinite(q2) ? [q1, q2, q3] : null;

  return { dist, kmh, speedFromFile, grade, gap, hdopRelative, hdopQ, stats: statsOf(c, eleS, dist, gap, kmh, intervalS) };
}

/**
 * GPS height wanders by meters from fix to fix. A moving average over
 * ±ELE_SMOOTH_S seconds, never across a gap, keeps that noise out of grade
 * and climb. Elevation colors still use the recorded values.
 */
export function smoothEle(c: Columns, gap: Uint8Array): Float32Array {
  const n = c.n;
  const out = new Float32Array(n).fill(NaN);
  const half = ELE_SMOOTH_S * 1000;
  let runStart = 0;
  for (let i = 0; i <= n; i++) {
    if (i < n && !(i > 0 && gap[i])) continue;
    let lo = runStart, hi = runStart, sum = 0, cnt = 0;
    for (let k = runStart; k < i; k++) {
      while (hi < i && c.t[hi] <= c.t[k] + half) { if (Number.isFinite(c.ele[hi])) { sum += c.ele[hi]; cnt++; } hi++; }
      while (c.t[lo] < c.t[k] - half) { if (Number.isFinite(c.ele[lo])) { sum -= c.ele[lo]; cnt--; } lo++; }
      out[k] = cnt && Number.isFinite(c.ele[k]) ? sum / cnt : NaN;
    }
    runStart = i;
  }
  return out;
}

/** Grade in percent over a 120 m window centered on each fix, never across a gap. */
function gradeOf(c: Columns, ele: Float32Array, dist: Float64Array, gap: Uint8Array): Float32Array {
  const n = c.n;
  const out = new Float32Array(n).fill(NaN);
  let runStart = 0;
  for (let i = 0; i <= n; i++) {
    if (i < n && !(i > 0 && gap[i])) continue;
    // run is [runStart, i)
    const s = runStart, e = i - 1;
    let lo = s, hi = s;
    for (let k = s; k <= e; k++) {
      while (lo < k && dist[k] - dist[lo + 1] >= GRADE_HALF_WINDOW) lo++;
      if (hi < k) hi = k;
      while (hi < e && dist[hi] - dist[k] < GRADE_HALF_WINDOW) hi++;
      const a = dist[k] - dist[lo] >= GRADE_HALF_WINDOW ? lo : s;
      const b = dist[hi] - dist[k] >= GRADE_HALF_WINDOW ? hi : e;
      const run = dist[b] - dist[a];
      if (run < GRADE_HALF_WINDOW || Number.isNaN(ele[a]) || Number.isNaN(ele[b])) continue;
      out[k] = ((ele[b] - ele[a]) / run) * 100;
    }
    runStart = i;
  }
  return out;
}

function statsOf(c: Columns, eleS: Float32Array, dist: Float64Array, gap: Uint8Array, kmh: Float32Array, intervalS: number): TrackStats {
  const n = c.n;
  let distanceM = 0, movingS = 0, maxKmh = 0;
  let w = 180, s = 90, e = -180, nn = -90;
  for (let i = 0; i < n; i++) {
    if (c.lon[i] < w) w = c.lon[i];
    if (c.lon[i] > e) e = c.lon[i];
    if (c.lat[i] < s) s = c.lat[i];
    if (c.lat[i] > nn) nn = c.lat[i];
    if (kmh[i] > maxKmh) maxKmh = kmh[i];
    if (i === 0 || gap[i]) continue;
    const d = dist[i] - dist[i - 1];
    const dt = (c.t[i] - c.t[i - 1]) / 1000;
    distanceM += d;
    if (dt > 0 && (d / dt) * 3.6 >= MOVING_KMH) movingS += dt;
  }
  // Climb with hysteresis: a rise counts once the track has gone up at least
  // CLIMB_HYSTERESIS meters from its low, so GPS noise doesn't add up.
  let climb = 0, low = NaN, high = NaN, anyEle = false, minEle = Infinity, maxEle = -Infinity;
  for (let i = 0; i < n; i++) {
    const raw = c.ele[i];
    if (Number.isNaN(raw)) continue;
    anyEle = true;
    if (raw < minEle) minEle = raw;
    if (raw > maxEle) maxEle = raw;
    const v = eleS[i];
    if (Number.isNaN(v)) continue;
    if (Number.isNaN(low)) { low = high = v; continue; }
    if (v > high) high = v;
    if (v < low) { low = high = v; continue; }
    if (high - v >= CLIMB_HYSTERESIS) {
      if (high - low >= CLIMB_HYSTERESIS) climb += high - low;
      low = high = v;
    }
  }
  if (high - low >= CLIMB_HYSTERESIS) climb += high - low;
  let fixKnown = 0, corrected = 0;
  for (let i = 0; i < n; i++) { if (c.fixq[i] > 0) fixKnown++; if (c.fixq[i] === 2) corrected++; }
  const start = n ? c.t[0] : 0;
  const end = n ? c.t[n - 1] : 0;
  const mh = median(c.hdop), ms = median(c.sats);
  return {
    distanceM, start, end, durationS: (end - start) / 1000, movingS,
    avgKmh: movingS > 0 ? (distanceM / movingS) * 3.6 : 0, maxKmh,
    climbM: anyEle ? climb : null, minEle: anyEle ? minEle : null, maxEle: anyEle ? maxEle : null,
    intervalS, correctedShare: fixKnown ? corrected / fixKnown : null,
    medianHdop: Number.isFinite(mh) ? mh : null, medianSats: Number.isFinite(ms) ? ms : null,
    bbox: n ? [w, s, e, nn] : [0, 0, 0, 0],
  };
}

/** Number of gaps and the longest one in seconds. */
export function gapSummary(c: Columns, gap: Uint8Array): { count: number; longestS: number } {
  let count = 0, longestS = 0;
  for (let i = 1; i < c.n; i++) {
    if (!gap[i]) continue;
    count++;
    longestS = Math.max(longestS, (c.t[i] - c.t[i - 1]) / 1000);
  }
  return { count, longestS };
}
