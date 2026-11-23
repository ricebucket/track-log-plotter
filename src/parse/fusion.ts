// Columbus Fusion logs: CSV files with a "# Format=ColumbusFusion" comment
// line, a header row, then one row per fix. With the motion sensor on
// (Type=GNSS+IMU), each fix row is followed by rows that hold only ax, ay and
// az: accelerometer readings in g, several per second.
//
//   # Format=ColumbusFusion; Version=1.0; Type=GNSS+IMU
//   tag,date,time,lat,lon,alt,speed,heading,ax,ay,az
//   T,261028,162603,40.7712345,-73.9712345,16.9,0.0,0.0,-0.05,0.09,1.08
//   ,,,,,,,,-0.02,0.09,1.06
//   ,,162604,40.7712400,-73.9712300,16.9,0.0,0.0,-0.03,0.06,1.05
//
// - date is YYMMDD and time HHMMSS, on the logger's own clock with no time
//   zone. They're read as UTC; the properties page can set another zone. A row
//   may leave the date (and the tag) empty: the last date carries on.
// - lat and lon are decimal degrees. The older Columbus CSV layout writes a
//   positive number with N/S/E/W after it, pads its fields with NUL bytes and
//   names some columns differently (LATITUDE N/S, HEIGHT); that's read too.
// - alt is meters, speed km/h and heading degrees.
// - tag: T and G are ordinary fixes (G the first after a pause in logging);
//   C marks a point the user saved and V a voice note, both shown as button
//   presses.
import type { FieldKey, FixQuality, Flag, Note, ParsedTrack, Problem } from '../model/types';
import { ColumnBuilder, present } from './columns';
import { isSpace, lastNonSpace, numAt } from './scan';

/** A field's number, or NaN when it is blank. */
const num = (s: string, a: number, b: number): number => numAt(s, a, b, NaN);

/**
 * Decimal degrees, signed or with an N/S/E/W letter after the number
 * (/^\s*([+-]?\d+(?:\.\d+)?)\s*([NSEWnsew])?\s*$/, read in place).
 */
function coord(s: string, a: number, b: number): number {
  let i = a;
  while (i < b && isSpace(s.charCodeAt(i))) i++;
  const n0 = i;
  let c = s.charCodeAt(i);
  if (i < b && (c === 43 || c === 45)) i++;
  const d0 = i;
  while (i < b && (c = s.charCodeAt(i)) >= 48 && c <= 57) i++;
  if (i === d0) return NaN;
  if (i < b && s.charCodeAt(i) === 46) {
    const f0 = ++i;
    while (i < b && (c = s.charCodeAt(i)) >= 48 && c <= 57) i++;
    if (i === f0) return NaN;
  }
  const n1 = i;
  while (i < b && isSpace(s.charCodeAt(i))) i++;
  let neg = false;
  if (i < b) {
    c = s.charCodeAt(i) | 32; // lower case
    if (c !== 110 && c !== 115 && c !== 101 && c !== 119) return NaN; // n s e w
    neg = c === 115 || c === 119;
    i++;
    while (i < b && isSpace(s.charCodeAt(i))) i++;
    if (i < b) return NaN;
  }
  const v = numAt(s, n0, n1);
  return neg ? -v : v;
}

/**
 * Each fix as the file gives it, before any is dropped: its time, its
 * accelerometer readings [s0, s1) and its place among the kept fixes (-1 if
 * dropped). Struct of arrays, so no object per fix.
 */
class Rows {
  n = 0;
  t = new Float64Array(4096);
  s0 = new Int32Array(4096);
  s1 = new Int32Array(4096);
  kept = new Int32Array(4096);
  push(t: number, s: number, kept: number) {
    if (this.n === this.t.length) {
      const cap = this.n * 2;
      const t2 = new Float64Array(cap); t2.set(this.t); this.t = t2;
      const a = new Int32Array(cap); a.set(this.s0); this.s0 = a;
      const b = new Int32Array(cap); b.set(this.s1); this.s1 = b;
      const k = new Int32Array(cap); k.set(this.kept); this.kept = k;
    }
    this.t[this.n] = t; this.s0[this.n] = s; this.s1[this.n] = s; this.kept[this.n] = kept;
    this.n++;
  }
}

/** Accelerometer readings, in growable typed arrays. */
class Readings {
  n = 0;
  x = new Float32Array(4096);
  y = new Float32Array(4096);
  z = new Float32Array(4096);
  push(x: number, y: number, z: number) {
    if (this.n === this.x.length) {
      const grow = (a: Float32Array) => { const b = new Float32Array(a.length * 2); b.set(a); return b; };
      this.x = grow(this.x); this.y = grow(this.y); this.z = grow(this.z);
    }
    this.x[this.n] = x; this.y[this.n] = y; this.z[this.n] = z;
    this.n++;
  }
}

/**
 * The strongest accelerometer reading in a fix's second, in g: the three axes
 * combined as √(ax² + ay² + az²), with gravity left in, so a logger at rest
 * reads about 1 g. No filtering: each value is one actual reading.
 */
function accelPeak(r: Readings, s0: number, s1: number): number {
  let peak = NaN;
  for (let j = s0; j < s1; j++) {
    const v = Math.sqrt(r.x[j] * r.x[j] + r.y[j] * r.y[j] + r.z[j] * r.z[j]);
    if (!(v <= peak)) peak = v;
  }
  return peak;
}

/**
 * Every reading with its time, for the timeline. The file gives readings no
 * time of their own: they follow their fix evenly, `perSecond` to a second (or
 * spread over the time to the next fix, if that's shorter).
 */
function readingSeries(rows: Rows, r: Readings, perSecond: number): { t: Float64Array; g: Float32Array } {
  const t = new Float64Array(r.n), g = new Float32Array(r.n);
  let m = 0, last = -Infinity;
  for (let k = 0; k < rows.n; k++) {
    const s0 = rows.s0[k], count = rows.s1[k] - s0, ft = rows.t[k];
    if (!count) continue;
    const next = k + 1 < rows.n ? rows.t[k + 1] : Infinity;
    const step = Math.min(1000 / Math.max(1, perSecond), (next - ft) / count);
    for (let j = s0; j < s0 + count; j++) {
      const at = ft + (j - s0) * step;
      if (!(at > last)) continue; // a fix out of time order: its readings can't go on the timeline
      t[m] = at;
      g[m] = Math.sqrt(r.x[j] * r.x[j] + r.y[j] * r.y[j] + r.z[j] * r.z[j]);
      last = at;
      m++;
    }
  }
  return { t: t.slice(0, m), g: g.slice(0, m) };
}

/** Two digits as a number, or -1. */
function two(s: string, i: number): number {
  const a = s.charCodeAt(i) - 48, b = s.charCodeAt(i + 1) - 48;
  return a >= 0 && a <= 9 && b >= 0 && b <= 9 ? a * 10 + b : -1;
}

export function parseFusion(text: string): ParsedTrack {
  const problems: Problem[] = [];
  const notes: Note[] = [];
  const flags: Flag[] = [];
  const src = text.includes('\0') ? text.replace(/\0/g, '') : text;
  const len = src.length;
  // The content ends at the last character that isn't space; the file is
  // complete when a line break comes after it.
  const lastNonWs = lastNonSpace(src);
  let complete = false;
  for (let k = lastNonWs + 1; k < len && !complete; k++) { const c = src.charCodeAt(k); complete = c === 10 || c === 13; }

  // Lines end at \r\n, \r or \n. Each is read once, character by character,
  // noting its commas on the way, so no line or field is cut out as a string.
  let ls = 0, li = 0, nComma = 0;
  let cut = new Int32Array(64);
  /** End of the line starting at `ls`; its first `max` commas go into `cut`. */
  const scanLine = (max: number): number => {
    let e = ls;
    nComma = 0;
    for (; e < len; e++) {
      const c = src.charCodeAt(e);
      if (c === 44) { if (nComma < max) cut[nComma] = e; nComma++; }
      else if (c === 10 || c === 13) break;
    }
    return e;
  };
  /** Moves to the line after the one ending at `e`; false when there is none. */
  const nextLine = (e: number): boolean => {
    if (e >= len) return false;
    ls = e + (src.charCodeAt(e) === 13 && src.charCodeAt(e + 1) === 10 ? 2 : 1);
    li++;
    return true;
  };
  /** First character of [a, e) that isn't space, or -1 for a blank line. */
  const firstChar = (a: number, e: number): number => {
    for (let k = a; k < e; k++) if (!isSpace(src.charCodeAt(k))) return k;
    return -1;
  };

  // The header: the first line that is neither blank nor a comment.
  let names: string[] = [''];
  let more = true;
  while (more) {
    const a = ls, e = scanLine(0);
    more = nextLine(e);
    const fc = firstChar(a, e);
    if (fc >= 0 && src.charCodeAt(fc) !== 35 /* # */) { names = src.slice(a, e).split(',').map((v) => v.trim().toLowerCase()); break; }
  }
  const N = names.length;
  const col = (...alts: string[]) => names.findIndex((n) => alts.includes(n));
  const iTag = col('tag'), iDate = col('date'), iTime = col('time');
  const iLat = col('lat', 'latitude', 'latitude n/s'), iLon = col('lon', 'longitude', 'longitude e/w');
  const iAlt = col('alt', 'altitude', 'height'), iSpeed = col('speed'), iHead = col('heading', 'course');
  const iAx = col('ax'), iAy = col('ay'), iAz = col('az');
  const iPdop = col('pdop'), iHdop = col('hdop'), iVdop = col('vdop'), iFix = col('fix mode', 'fix'), iValid = col('valid');
  const motion = iAx >= 0 && iAy >= 0 && iAz >= 0;

  const b = new ColumnBuilder();
  const rows = new Rows();
  const r = new Readings();
  let yr = 0, mo = 0, dy = 0, haveYmd = false;
  let dayShift = 0, lastTod = -1;
  let noDate = false, garbage = 0, garbageLine = 0, voidCount = 0;
  let truncated: { line: number; chars: number } | null = null;
  if (cut.length < N) cut = new Int32Array(N);
  // Field k of the current line is src[FS[k], FE[k]).
  const FS = new Int32Array(N), FE = new Int32Array(N);
  const field = (k: number) => src.slice(FS[k], FE[k]);
  const numField = (k: number) => num(src, FS[k], FE[k]);

  if (iTime >= 0 && iLat >= 0 && iLon >= 0) {
    while (more) {
      const a = ls, e = scanLine(N), lineNo = li + 1;
      more = nextLine(e);
      const fc = firstChar(a, e);
      if (fc < 0 || src.charCodeAt(fc) === 35) continue;
      if (nComma + 1 !== N) {
        const lastLine = a <= lastNonWs && lastNonWs < e;
        if (lastLine && !complete && nComma + 1 < N) truncated = { line: lineNo, chars: e - a };
        else { if (!garbage) garbageLine = lineNo; garbage++; }
        continue;
      }
      FS[0] = a;
      for (let k = 1; k < N; k++) { FE[k - 1] = cut[k - 1]; FS[k] = cut[k - 1] + 1; }
      FE[N - 1] = e;

      let t0 = FS[iTime], t1 = FE[iTime];
      while (t0 < t1 && isSpace(src.charCodeAt(t0))) t0++;
      while (t1 > t0 && isSpace(src.charCodeAt(t1 - 1))) t1--;
      const lat = coord(src, FS[iLat], FE[iLat]), lon = coord(src, FS[iLon], FE[iLon]);
      if (t1 > t0) {
        let d0 = 0, d1 = 0;
        if (iDate >= 0) {
          d0 = FS[iDate]; d1 = FE[iDate];
          while (d0 < d1 && isSpace(src.charCodeAt(d0))) d0++;
          while (d1 > d0 && isSpace(src.charCodeAt(d1 - 1))) d1--;
        }
        const dated = d1 > d0;
        // A date is YYMMDD, six digits.
        if (d1 - d0 === 6) {
          const yy = two(src, d0), mm = two(src, d0 + 2), dd = two(src, d0 + 4);
          if (yy >= 0 && mm >= 0 && dd >= 0 && (!haveYmd || 2000 + yy !== yr || mm !== mo || dd !== dy)) {
            yr = 2000 + yy; mo = mm; dy = dd; haveYmd = true; dayShift = 0;
          }
        }
        // A time is HHMMSS, perhaps with a fraction of a second.
        let hh = -1, mi = -1, ss = -1, ms = 0, timed = false;
        const tl = t1 - t0;
        if (tl >= 6) {
          hh = two(src, t0); mi = two(src, t0 + 2); ss = two(src, t0 + 4);
          if (hh >= 0 && mi >= 0 && ss >= 0) {
            if (tl === 6) timed = true;
            else if (tl > 7 && src.charCodeAt(t0 + 6) === 46) {
              timed = true;
              for (let k = t0 + 7; k < t1 && timed; k++) { const c = src.charCodeAt(k); timed = c >= 48 && c <= 57; }
              if (timed) ms = Math.round(numAt(src, t0 + 6, t1) * 1000);
            }
          }
        }
        if (timed && Number.isFinite(lat) && Number.isFinite(lon)) {
          if (!haveYmd) { yr = 1970; mo = 1; dy = 1; haveYmd = true; noDate = true; }
          const tod = hh * 3600 + mi * 60 + ss;
          // Past midnight with no new date written: the day moves on.
          if (!dated && lastTod >= 0 && tod < lastTod - 43200) dayShift++;
          lastTod = tod;
          const t = Date.UTC(yr, mo - 1, dy + dayShift, hh, mi, ss, ms);
          const valid = iValid >= 0 ? field(iValid).trim().toUpperCase() : '';
          const mode = iFix >= 0 ? field(iFix).trim().toUpperCase() : '';
          const fixq: FixQuality = valid.includes('DGPS') ? 2 : /[23]D/.test(mode) ? 1 : 0;
          const kept = b.push({
            t, lat, lon, ele: iAlt >= 0 ? numField(iAlt) : NaN, speed: iSpeed >= 0 ? numField(iSpeed) / 3.6 : NaN,
            course: iHead >= 0 ? numField(iHead) : NaN, hdop: iHdop >= 0 ? numField(iHdop) : NaN,
            vdop: iVdop >= 0 ? numField(iVdop) : NaN, pdop: iPdop >= 0 ? numField(iPdop) : NaN,
            fixq, line: lineNo,
          });
          rows.push(t, r.n, kept ? b.n - 1 : -1);
          if (iTag >= 0) {
            // C marks a saved point and V a voice note.
            let g0 = FS[iTag], g1 = FE[iTag];
            while (g0 < g1 && isSpace(src.charCodeAt(g0))) g0++;
            while (g1 > g0 && isSpace(src.charCodeAt(g1 - 1))) g1--;
            const c = g1 - g0 === 1 ? src.charCodeAt(g0) | 32 : 0;
            if (c === 99 || c === 118) flags.push({ n: flags.length + 1, t, lat, lon, name: null });
          }
        } else voidCount++;
      } else if (Number.isFinite(lat) || Number.isFinite(lon)) {
        voidCount++;
      }
      // An accelerometer reading belongs to the fix above it.
      if (motion && rows.n) {
        const x = numField(iAx), y = numField(iAy), z = numField(iAz);
        if (Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z)) {
          r.push(x, y, z);
          rows.s1[rows.n - 1] = r.n;
        }
      }
    }
  }
  while (more) more = nextLine(scanLine(0)); // count the lines left
  const lineCount = li + 1;

  // Readings a second: the usual count per fix where fixes are a second apart.
  const counts = new Int32Array(rows.n);
  let nc = 0;
  for (let k = 0; k + 1 < rows.n; k++) if (rows.t[k + 1] - rows.t[k] === 1000 && rows.s1[k] > rows.s0[k]) counts[nc++] = rows.s1[k] - rows.s0[k];
  const sorted = counts.subarray(0, nc).sort();
  const perSecond = nc ? sorted[nc >> 1] : 1;
  for (let k = 0; k < rows.n; k++) {
    const at = rows.kept[k];
    if (at >= 0) { const peak = accelPeak(r, rows.s0[k], rows.s1[k]); b.accel[at] = Number.isFinite(peak) ? peak : NaN; }
  }
  const series = r.n ? readingSeries(rows, r, perSecond) : undefined;
  const cols = b.build();

  if (truncated) problems.push({ kind: 'truncated', line: truncated.line, chars: truncated.chars, kept: cols.n });
  if (garbage) problems.push({ kind: 'garbage', count: garbage, line: garbageLine });
  if (b.counts.backwards) problems.push({ kind: 'backwards', count: b.counts.backwards, line: b.counts.backwardsLine });
  if (b.counts.jumps) problems.push({ kind: 'jump', count: b.counts.jumps, line: b.counts.jumpLine });
  if (cols.n === 0) problems.push({ kind: 'noFixes' });

  if (present(cols, 'speed')) notes.push({ kind: 'speedUnit', unit: 'kmh', inferred: false });
  notes.push({ kind: 'noZone' });
  if (noDate) notes.push({ kind: 'noDate' });
  if (r.n) notes.push({ kind: 'motion', rate: perSecond });
  if (voidCount) notes.push({ kind: 'void', count: voidCount });
  if (b.counts.duplicates) notes.push({ kind: 'duplicates', count: b.counts.duplicates });

  const fields: FieldKey[] = ['time', 'position'];
  if (present(cols, 'ele')) fields.push('ele');
  if (present(cols, 'speed')) fields.push('speed');
  if (present(cols, 'course')) fields.push('course');
  if (present(cols, 'hdop')) fields.push('hdop');
  if (present(cols, 'vdop')) fields.push('vdop');
  if (present(cols, 'pdop')) fields.push('pdop');
  if (cols.fixq.some((q) => q > 0)) fields.push('fix');
  if (present(cols, 'accel')) fields.push('accel');
  if (flags.length) fields.push('flags');

  return { format: 'fusion', creator: null, name: null, cols, flags, problems, notes, fields, lines: lineCount, clock: 'utc', ...(series ? { motion: series } : {}) };
}
