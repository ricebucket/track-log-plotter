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

/** Seconds of accelerometer readings averaged to find gravity, which is then taken out. */
export const GRAVITY_WINDOW_S = 4;
/** Fixes further apart than this (ms) mean the logger paused; motion readings don't run across. */
const PAUSE_MS = 2000;

function num(s: string | undefined): number {
  if (s === undefined) return NaN;
  const v = s.trim();
  return v === '' ? NaN : Number(v);
}

/** Decimal degrees, signed or with an N/S/E/W letter after the number. */
function coord(s: string | undefined): number {
  if (s === undefined) return NaN;
  const m = /^\s*([+-]?\d+(?:\.\d+)?)\s*([NSEWnsew])?\s*$/.exec(s);
  if (!m) return NaN;
  const v = Number(m[1]);
  return m[2] && /[SWsw]/.test(m[2]) ? -v : v;
}

interface Row {
  t: number;
  lat: number;
  lon: number;
  ele: number;
  speed: number;
  course: number;
  hdop: number;
  vdop: number;
  pdop: number;
  fixq: FixQuality;
  line: number;
  /** This fix's accelerometer readings: [s0, s1) in the reading arrays. */
  s0: number;
  s1: number;
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
 * The strongest acceleration in each fix's second, in g, with gravity taken
 * out: gravity is the average reading over GRAVITY_WINDOW_S seconds around each
 * reading (never across a pause), and what's left is the push from braking,
 * speeding up, turning and bumps.
 */
function accelPeaks(rows: Row[], r: Readings, perSecond: number): Float32Array {
  const out = new Float32Array(rows.length).fill(NaN);
  if (r.n === 0) return out;
  const half = Math.max(1, Math.round((GRAVITY_WINDOW_S * perSecond) / 2));
  // Runs of readings with no pause between their fixes.
  let k = 0;
  while (k < rows.length) {
    let end = k + 1;
    while (end < rows.length && rows[end].t - rows[end - 1].t <= PAUSE_MS) end++;
    const a = rows[k].s0, b = rows[end - 1].s1;
    if (b > a) {
      const sx = new Float64Array(b - a + 1), sy = new Float64Array(b - a + 1), sz = new Float64Array(b - a + 1);
      for (let j = a; j < b; j++) {
        sx[j - a + 1] = sx[j - a] + r.x[j];
        sy[j - a + 1] = sy[j - a] + r.y[j];
        sz[j - a + 1] = sz[j - a] + r.z[j];
      }
      for (let f = k; f < end; f++) {
        let peak = NaN;
        for (let j = rows[f].s0; j < rows[f].s1; j++) {
          const lo = Math.max(a, j - half) - a, hi = Math.min(b, j + half + 1) - a, m = hi - lo;
          const dx = r.x[j] - (sx[hi] - sx[lo]) / m, dy = r.y[j] - (sy[hi] - sy[lo]) / m, dz = r.z[j] - (sz[hi] - sz[lo]) / m;
          const v = Math.sqrt(dx * dx + dy * dy + dz * dz);
          if (!(v <= peak)) peak = v;
        }
        out[f] = peak;
      }
    }
    k = end;
  }
  return out;
}

export function parseFusion(text: string): ParsedTrack {
  const problems: Problem[] = [];
  const notes: Note[] = [];
  const flags: Flag[] = [];
  const src = text.includes('\0') ? text.replace(/\0/g, '') : text;
  const lines = src.split(/\r\n|\r|\n/);
  const complete = /[\r\n]\s*$/.test(src);
  let last = lines.length - 1;
  while (last >= 0 && !lines[last].trim()) last--;

  let h = 0;
  while (h < lines.length && (!lines[h].trim() || lines[h].trimStart().startsWith('#'))) h++;
  const names = (lines[h] ?? '').split(',').map((s) => s.trim().toLowerCase());
  const col = (...alts: string[]) => names.findIndex((n) => alts.includes(n));
  const iTag = col('tag'), iDate = col('date'), iTime = col('time');
  const iLat = col('lat', 'latitude', 'latitude n/s'), iLon = col('lon', 'longitude', 'longitude e/w');
  const iAlt = col('alt', 'altitude', 'height'), iSpeed = col('speed'), iHead = col('heading', 'course');
  const iAx = col('ax'), iAy = col('ay'), iAz = col('az');
  const iPdop = col('pdop'), iHdop = col('hdop'), iVdop = col('vdop'), iFix = col('fix mode', 'fix'), iValid = col('valid');
  const motion = iAx >= 0 && iAy >= 0 && iAz >= 0;

  const rows: Row[] = [];
  const r = new Readings();
  let ymd: [number, number, number] | null = null;
  let dayShift = 0, lastTod = -1;
  let noDate = false, garbage = 0, garbageLine = 0, voidCount = 0;
  let truncated: { line: number; chars: number } | null = null;

  if (iTime >= 0 && iLat >= 0 && iLon >= 0) {
    for (let i = h + 1; i <= last; i++) {
      const raw = lines[i];
      if (!raw.trim() || raw.trimStart().startsWith('#')) continue;
      const f = raw.split(',');
      if (f.length !== names.length) {
        if (i === last && !complete && f.length < names.length) truncated = { line: i + 1, chars: raw.length };
        else { if (!garbage) garbageLine = i + 1; garbage++; }
        continue;
      }
      const time = f[iTime].trim();
      const lat = coord(f[iLat]), lon = coord(f[iLon]);
      if (time) {
        const ds = iDate >= 0 ? f[iDate].trim() : '';
        if (/^\d{6}$/.test(ds)) {
          const next: [number, number, number] = [2000 + Number(ds.slice(0, 2)), Number(ds.slice(2, 4)), Number(ds.slice(4, 6))];
          if (!ymd || next.join() !== ymd.join()) { ymd = next; dayShift = 0; }
        }
        const tm = /^(\d{2})(\d{2})(\d{2})(\.\d+)?$/.exec(time);
        if (tm && Number.isFinite(lat) && Number.isFinite(lon)) {
        if (!ymd) { ymd = [1970, 1, 1]; noDate = true; }
        const tod = Number(tm[1]) * 3600 + Number(tm[2]) * 60 + Number(tm[3]);
        // Past midnight with no new date written: the day moves on.
        if (!ds && lastTod >= 0 && tod < lastTod - 43200) dayShift++;
        lastTod = tod;
        const ms = tm[4] ? Math.round(Number(tm[4]) * 1000) : 0;
        const t = Date.UTC(ymd[0], ymd[1] - 1, ymd[2] + dayShift, Number(tm[1]), Number(tm[2]), Number(tm[3]), ms);
        const valid = iValid >= 0 ? f[iValid].trim().toUpperCase() : '';
        const mode = iFix >= 0 ? f[iFix].trim().toUpperCase() : '';
        const fixq: FixQuality = valid.includes('DGPS') ? 2 : /[23]D/.test(mode) ? 1 : 0;
        rows.push({
          t, lat, lon, ele: iAlt >= 0 ? num(f[iAlt]) : NaN, speed: iSpeed >= 0 ? num(f[iSpeed]) / 3.6 : NaN,
          course: iHead >= 0 ? num(f[iHead]) : NaN, hdop: iHdop >= 0 ? num(f[iHdop]) : NaN,
          vdop: iVdop >= 0 ? num(f[iVdop]) : NaN, pdop: iPdop >= 0 ? num(f[iPdop]) : NaN,
          fixq, line: i + 1, s0: r.n, s1: r.n,
        });
        const tag = iTag >= 0 ? f[iTag].trim().toUpperCase() : '';
        if (tag === 'C' || tag === 'V') flags.push({ n: flags.length + 1, t, lat, lon, name: null });
        } else voidCount++;
      } else if (Number.isFinite(lat) || Number.isFinite(lon)) {
        voidCount++;
      }
      // An accelerometer reading belongs to the fix above it.
      if (motion && rows.length) {
        const x = num(f[iAx]), y = num(f[iAy]), z = num(f[iAz]);
        if (Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z)) {
          r.push(x, y, z);
          rows[rows.length - 1].s1 = r.n;
        }
      }
    }
  }

  // Readings a second: the usual count per fix where fixes are a second apart.
  const counts: number[] = [];
  for (let k = 0; k + 1 < rows.length; k++) if (rows[k + 1].t - rows[k].t === 1000 && rows[k].s1 > rows[k].s0) counts.push(rows[k].s1 - rows[k].s0);
  counts.sort((a, b) => a - b);
  const perSecond = counts.length ? counts[counts.length >> 1] : 1;
  const accel = accelPeaks(rows, r, perSecond);

  const b = new ColumnBuilder();
  rows.forEach((x, k) => b.push({ ...x, accel: accel[k] }));
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

  return { format: 'fusion', creator: null, name: null, cols, flags, problems, notes, fields, lines: lines.length, clock: 'utc' };
}
