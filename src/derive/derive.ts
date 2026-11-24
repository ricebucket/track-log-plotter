import type { Columns, Derived, MeasureKey, ParsedTrack, TrackStats } from '../model/types';
import { haversine, nth, quantilesIn, spread } from './geo';
import { RELATIVE_HDOP } from './hdop';

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
  for (let i = 1; i < cols.n; i++) { const d = (cols.t[i] - cols.t[i - 1]) / 1000; if (!cols.seg[i] && d - d === 0) dts[k++] = d; }
  const m = quantilesIn(dts, k, [0.5])[0];
  return Number.isFinite(m) ? m : 1;
}

/** How many sorted values of a distribution each track keeps for the shared color steps (see spread()). */
export const SPREAD_SIZE = 512;
/** A log's accuracy (from HDOP or satellites) is averaged over this many seconds before it weights the log in a combination. */
export const ACCURACY_SMOOTH_S = 10;
/**
 * A fix's expected error counts as at most this many times the log's usual
 * one. Real HDOPs stay far below that; one absurd value (say 3e38) would
 * otherwise swamp the running sum that averages them, for the rest of the log.
 */
export const MAX_ACCURACY = 1000;
/** Heights beyond this (m, either way) are taken as this much when smoothed, for the same reason. */
const MAX_HEIGHT_M = 1e6;

/**
 * Everything worked out from a track's fixes, once, when it loads (in the
 * reading worker): distance, speed, gaps, grade, the stats, and the summaries
 * later steps would otherwise rescan the fixes for (which measures it has,
 * its spread of speeds and heights for the color steps, its accuracy over
 * time for combining). A handful of passes over the
 * fixes; medians and quantiles by selection, not sorting.
 */
export function derive(p: ParsedTrack): Derived {
  const c = p.cols, n = c.n;
  const { t, lat, lon, ele, hdop, sats, speed, fixq, accel, seg } = c;

  // ---- Pass 1: what the file holds, the bounds, and the values the medians and quantiles are picked from.
  const dts = new Float64Array(n > 1 ? n - 1 : 0);
  // HDOP and satellite values are gathered only when the track has some (a combined track has none).
  const NONE = new Float64Array(0);
  let hAll = NONE, h6 = NONE, sAll = NONE;
  const eleV = new Float32Array(n);
  let nd = 0, nh = 0, n6 = 0, ns = 0, ne = 0, hNonPos = 0, sNonPos = 0, withSats = 0, withSpeed = 0, fixKnown = 0, corrected = 0;
  let w = 180, s = 90, e = -180, nn = -90, anyEle = false, minEle = Infinity, maxEle = -Infinity, maxAccel = -Infinity;
  for (let i = 0; i < n; i++) {
    const la = lat[i], lo = lon[i];
    if (lo < w) w = lo;
    if (lo > e) e = lo;
    if (la < s) s = la;
    if (la > nn) nn = la;
    if (i > 0) {
      const d = (t[i] - t[i - 1]) / 1000;
      if (!seg[i] && d - d === 0) dts[nd++] = d; // d - d === 0: finite
    }
    const h = hdop[i], sv = sats[i], ev = ele[i], f = fixq[i];
    if (sv >= 0) withSats++;
    if (h - h === 0) {
      if (hAll === NONE) hAll = new Float64Array(n);
      hAll[nh++] = h; if (!(h > 0)) hNonPos++;
      if (sv >= 6) { if (h6 === NONE) h6 = new Float64Array(n); h6[n6++] = h; }
    }
    if (sv - sv === 0) { if (sAll === NONE) sAll = new Float64Array(n); sAll[ns++] = sv; if (!(sv > 0)) sNonPos++; }
    if (ev === ev) {
      anyEle = true;
      if (ev < minEle) minEle = ev;
      if (ev > maxEle) maxEle = ev;
      if (ev - ev === 0) eleV[ne++] = ev;
    }
    if (speed[i] - speed[i] === 0) withSpeed++;
    if (f > 0) fixKnown++;
    if (f === 2) corrected++;
    if (accel[i] > maxAccel) maxAccel = accel[i];
  }

  // ---- Medians and quantiles, by selection.
  const iv = quantilesIn(dts, nd, [0.5])[0];
  const intervalS = Number.isFinite(iv) ? iv : 1;
  const gapS = gapThreshold(intervalS);
  // HDOP quartiles; and whether HDOP behaves like standard HDOP (see hdopIsRelative): judged from the fixes
  // with six or more satellites when most fixes give a count, else from all of them, so it may share the selection.
  let q1: number, q2: number, q3: number, hdopRelative: boolean;
  if (withSats > n / 2) {
    [q1, q2, q3] = quantilesIn(hAll, nh, [0.25, 0.5, 0.75]);
    hdopRelative = n6 >= 30 && quantilesIn(h6, n6, [0.1])[0] > RELATIVE_HDOP;
  } else {
    const q = quantilesIn(hAll, nh, [0.1, 0.25, 0.5, 0.75]);
    [q1, q2, q3] = [q[1], q[2], q[3]];
    hdopRelative = nh >= 30 && q[0] > RELATIVE_HDOP;
  }
  const hdopQ: [number, number, number] | null = Number.isFinite(q2) ? [q1, q2, q3] : null;
  const medSats = quantilesIn(sAll, ns, [0.5])[0];
  // What a log's accuracy is measured against: the middle of its positive HDOPs (the upper middle of an even
  // count), else of its positive satellite counts. Selecting the median above has already put that value in place
  // when every value is positive; otherwise it is picked from the same values, which nothing needs any more.
  const hasH = p.fields.includes('hdop'), hasS = p.fields.includes('sats');
  const hdopBase = hasH ? (hNonPos ? positiveMiddle(hAll, nh) : nh ? hAll[nh >> 1] : NaN) : NaN;
  const satsBase = !hasH && hasS ? (sNonPos ? positiveMiddle(sAll, ns) : ns ? sAll[ns >> 1] : NaN) : NaN;

  // ---- Pass 2: distance, gaps, speed, moving time, and each fix's accuracy.
  const dist = new Float64Array(n), gap = new Uint8Array(n), kmh = new Float32Array(n), now = new Float64Array(n);
  const moving = new Float32Array(n); // speeds as stored (32-bit), for their spread
  const speedFromFile = n > 0 && withSpeed >= n * 0.5, combined = p.format === 'combined';
  let nm = 0, distanceM = 0, movingS = 0, maxKmh = 0;
  // Speed at fix j: from the file, or from positions over its neighbors within the same run. It needs the
  // next fix's distance and gap, so it is worked out one fix behind.
  const speedAt = (j: number) => {
    const f = speed[j];
    if (combined) {
      // A combined track's speed comes only from its logs' own speeds, never from its points: where none of
      // them has one, it has none.
      if (!(f - f === 0)) { kmh[j] = NaN; return; }
      kmh[j] = f * 3.6;
    } else if (speedFromFile && f - f === 0) kmh[j] = f * 3.6;
    else {
      const a = j > 0 && !gap[j] ? j - 1 : j;
      const b = j < n - 1 && !gap[j + 1] ? j + 1 : j;
      const dt = (t[b] - t[a]) / 1000;
      kmh[j] = a === b || dt <= 0 ? NaN : ((dist[b] - dist[a]) / dt) * 3.6;
    }
    // A lone fix between gaps has no speed of its own: call it standing still.
    let v = kmh[j];
    if (!(v - v === 0)) kmh[j] = v = 0;
    if (v > maxKmh) maxKmh = v;
    if (v >= MOVING_KMH) moving[nm++] = v;
  };
  // A step across repeats dropped when the file was read (see parse/gpx) isn't a gap, however long (up to two minutes).
  const bridged = p.bridged;
  for (let i = 0; i < n; i++) {
    if (i > 0) {
      dist[i] = dist[i - 1] + haversine(lat[i - 1], lon[i - 1], lat[i], lon[i]);
      const dt = (t[i] - t[i - 1]) / 1000;
      if (seg[i] || (dt > gapS && !(bridged && bridged[i]))) gap[i] = 1;
      else {
        const d = dist[i] - dist[i - 1];
        distanceM += d;
        if (dt > 0 && (d / dt) * 3.6 >= MOVING_KMH) movingS += dt;
      }
      speedAt(i - 1);
    }
    // Expected error against the log's usual one: HDOP over its middle value, else fewer satellites than usual
    // (at most MAX_ACCURACY times as large); a corrected (differential) fix counts double, its error √½ as large.
    let a = 1;
    if (hasH) { const h = hdop[i]; if (h > 0 && h < Infinity) a = h / hdopBase; }
    else if (hasS) { const sv = sats[i]; if (sv > 0 && sv < Infinity) a = satsBase / sv; }
    if (a > MAX_ACCURACY) a = MAX_ACCURACY;
    if (fixq[i] === 2) a *= Math.SQRT1_2;
    now[i] = a;
  }
  if (n) speedAt(n - 1);

  // Without HDOP, satellites or corrected fixes it is 1 throughout: nothing to average.
  const accuracy = hasH || hasS || corrected ? movingAverage(t, now, ACCURACY_SMOOTH_S) : now;

  // ---- Height: smoothed, never across a gap, nor (in a combined track) across a change in the logs giving it.
  let eleGap = gap;
  if (p.eleBreak) { eleGap = new Uint8Array(n); for (let i = 0; i < n; i++) eleGap[i] = gap[i] | p.eleBreak[i]; }
  const eleS = smoothEle(c, eleGap);

  // ---- Pass 3: grade over a 120 m window centered on each fix, and climb with hysteresis.
  const grade = new Float32Array(n).fill(NaN);
  const eleBreak = p.eleBreak;
  let lo = 0, hi = 0, anyGrade = false, climb = 0, low = NaN, high = NaN;
  for (let k = 0; k < n; k++) {
    // The window: from the last fix at least GRADE_HALF_WINDOW behind (else the run's first) to the first at
    // least that far ahead (else the run's last).
    if (k === 0 || eleGap[k]) lo = hi = k;
    while (lo < k && dist[k] - dist[lo + 1] >= GRADE_HALF_WINDOW) lo++;
    if (hi < k) hi = k;
    while (hi + 1 < n && !eleGap[hi + 1] && dist[hi] - dist[k] < GRADE_HALF_WINDOW) hi++;
    const run = dist[hi] - dist[lo], ea = eleS[lo], eb = eleS[hi];
    if (!(run < GRADE_HALF_WINDOW) && ea === ea && eb === eb) { grade[k] = ((eb - ea) / run) * 100; if (grade[k] === grade[k]) anyGrade = true; }
    // Climb: a rise counts once the track has gone up at least CLIMB_HYSTERESIS from its low, so GPS noise doesn't add up.
    if (ele[k] !== ele[k]) continue;
    const v = eleS[k];
    // Where a combined track's height changes source, close the climb so far and start afresh.
    if (eleBreak && eleBreak[k]) {
      if (high - low >= CLIMB_HYSTERESIS) climb += high - low;
      low = high = NaN;
    }
    if (v !== v) continue;
    if (low !== low) { low = high = v; continue; }
    if (v > high) high = v;
    // A fall of CLIMB_HYSTERESIS from the high ends the rise so far, even one that falls below its low.
    if (high - v >= CLIMB_HYSTERESIS) {
      if (high - low >= CLIMB_HYSTERESIS) climb += high - low;
      low = high = v;
    } else if (v < low) low = high = v;
  }
  if (high - low >= CLIMB_HYSTERESIS) climb += high - low;

  const start = n ? t[0] : 0;
  const end = n ? t[n - 1] : 0;
  const stats: TrackStats = {
    distanceM, start, end, durationS: (end - start) / 1000, movingS,
    avgKmh: movingS > 0 ? (distanceM / movingS) * 3.6 : 0, maxKmh,
    climbM: anyEle ? climb : null, minEle: anyEle ? minEle : null, maxEle: anyEle ? maxEle : null,
    intervalS, correctedShare: fixKnown ? corrected / fixKnown : null,
    medianHdop: Number.isFinite(q2) ? q2 : null, medianSats: Number.isFinite(medSats) ? medSats : null,
    maxAccel: Number.isFinite(maxAccel) ? maxAccel : null,
    bbox: n ? [w, s, e, nn] : [0, 0, 0, 0],
  };
  const has: Record<MeasureKey, boolean> = {
    speed: n > 1, ele: ne > 0, grade: anyGrade, hdop: nh > 0, sats: ns > 0, fix: fixKnown > 0, accel: Number.isFinite(maxAccel),
  };
  return {
    dist, kmh, speedFromFile, grade, gap, hdopRelative, hdopQ, stats, has,
    speedSpread: spread(moving, nm, SPREAD_SIZE), eleSpread: spread(eleV, ne, SPREAD_SIZE),
    accuracy, hdopBase,
  };
}

/** The middle of the positive values of a[0, m), which are all finite (the upper middle of an even count), or NaN. It rearranges a. */
function positiveMiddle(a: Float64Array, m: number): number {
  let k = 0;
  for (let i = 0; i < m; i++) { const x = a[i]; if (x > 0) a[k++] = x; }
  return nth(a, k, k >> 1);
}

/** A moving average over a window of seconds around each value, with two pointers. */
export function movingAverage(t: Float64Array, v: Float64Array, windowS: number): Float64Array {
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

/**
 * GPS height wanders by meters from fix to fix. A moving average over
 * ±ELE_SMOOTH_S seconds, never across a gap, keeps that noise out of grade
 * and climb. Elevation colors still use the recorded values.
 */
export function smoothEle(c: Columns, gap: Uint8Array): Float32Array {
  const n = c.n, ele = c.ele;
  const out = new Float32Array(n).fill(NaN);
  const half = ELE_SMOOTH_S * 1000;
  // The running sum takes each height as at most MAX_HEIGHT_M either way, so one absurd height leaves no trace once out of the window.
  const h = (e: number) => (e > MAX_HEIGHT_M ? MAX_HEIGHT_M : e < -MAX_HEIGHT_M ? -MAX_HEIGHT_M : e);
  let runStart = 0;
  for (let i = 0; i <= n; i++) {
    if (i < n && !(i > 0 && gap[i])) continue;
    let lo = runStart, hi = runStart, sum = 0, cnt = 0;
    for (let k = runStart; k < i; k++) {
      while (hi < i && c.t[hi] <= c.t[k] + half) { if (Number.isFinite(ele[hi])) { sum += h(ele[hi]); cnt++; } hi++; }
      while (c.t[lo] < c.t[k] - half) { if (Number.isFinite(ele[lo])) { sum -= h(ele[lo]); cnt--; } lo++; }
      out[k] = cnt && Number.isFinite(ele[k]) ? sum / cnt : NaN;
    }
    runStart = i;
  }
  return out;
}

/**
 * Number of gaps and the longest one in seconds. A new segment counts only
 * when time is missing there too: a step longer than the gap threshold.
 */
export function gapSummary(c: Columns, gap: Uint8Array): { count: number; longestS: number } {
  let count = 0, longestS = 0, gapS = NaN;
  for (let i = 1; i < c.n; i++) {
    if (!gap[i]) continue;
    const dt = (c.t[i] - c.t[i - 1]) / 1000;
    if (c.seg[i]) {
      if (gapS !== gapS) gapS = gapThreshold(medianInterval(c)); // worked out only for a track with segments
      if (!(dt > gapS)) continue;
    }
    count++;
    longestS = Math.max(longestS, dt);
  }
  return { count, longestS };
}
