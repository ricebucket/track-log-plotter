import type { FieldKey, FixQuality, Note, ParsedTrack, Problem } from '../model/types';
import { ColumnBuilder, present } from './columns';

const KNOT = 1852 / 3600; // m/s

interface Epoch {
  tod: number;
  todKey: string;
  date: number | null;
  lat: number;
  lon: number;
  hasPos: boolean;
  rmcStatus: string | null;
  ggaQ: number | null;
  mode: string | null;
  ele: number;
  geoid: number;
  hdop: number;
  hdopGsa: number;
  vdop: number;
  pdop: number;
  sats: number;
  speed: number;
  course: number;
  line: number;
  lineEnd: number;
}

function newEpoch(todKey: string, tod: number, line: number): Epoch {
  return {
    tod, todKey, date: null, lat: NaN, lon: NaN, hasPos: false, rmcStatus: null, ggaQ: null, mode: null,
    ele: NaN, geoid: NaN, hdop: NaN, hdopGsa: NaN, vdop: NaN, pdop: NaN, sats: NaN, speed: NaN, course: NaN,
    line, lineEnd: line,
  };
}

/** XOR of the characters between "$" and "*", as two hex digits. */
export function nmeaChecksum(body: string): string {
  let x = 0;
  for (let i = 0; i < body.length; i++) x ^= body.charCodeAt(i);
  return x.toString(16).toUpperCase().padStart(2, '0');
}

/** A dilution of precision; 0 is a placeholder, so it counts as missing. */
function dopOf(s: string | undefined): number {
  const v = num(s);
  return v > 0 ? v : NaN;
}

function num(s: string | undefined): number {
  if (s === undefined || s === '') return NaN;
  const v = Number(s);
  return Number.isFinite(v) ? v : NaN;
}

/** "hhmmss.sss" → seconds of day, or NaN. */
function parseTod(s: string | undefined): number {
  if (!s || s.length < 6) return NaN;
  const h = Number(s.slice(0, 2)), m = Number(s.slice(2, 4)), sec = Number(s.slice(4));
  if (!Number.isFinite(h) || !Number.isFinite(m) || !Number.isFinite(sec) || h > 23 || m > 59 || sec >= 61) return NaN;
  return h * 3600 + m * 60 + sec;
}

/** "ddmmyy" → days since 1970-01-01, or null. */
function parseDate(s: string | undefined): number | null {
  if (!s || s.length !== 6) return null;
  const d = Number(s.slice(0, 2)), mo = Number(s.slice(2, 4)), yy = Number(s.slice(4, 6));
  if (!(d >= 1 && d <= 31 && mo >= 1 && mo <= 12 && yy >= 0)) return null;
  const y = yy < 80 ? 2000 + yy : 1900 + yy;
  return Date.UTC(y, mo - 1, d) / 86400000;
}

/** "ddmm.mmmm" + hemisphere → signed degrees, or NaN. */
function parseCoord(v: string | undefined, hemi: string | undefined, degDigits: number): number {
  if (!v || !hemi) return NaN;
  const dot = v.indexOf('.');
  const intLen = dot < 0 ? v.length : dot;
  if (intLen < degDigits + 2) return NaN;
  const deg = Number(v.slice(0, intLen - 2));
  const min = Number(v.slice(intLen - 2));
  if (!Number.isFinite(deg) || !Number.isFinite(min) || min >= 60) return NaN;
  const out = deg + min / 60;
  if (hemi === 'S' || hemi === 'W') return -out;
  if (hemi === 'N' || hemi === 'E') return out;
  return NaN;
}

function ggaQuality(q: number | null): FixQuality | -1 {
  if (q === null || Number.isNaN(q)) return 0;
  if (q === 0) return -1;
  if (q === 2 || q === 4 || q === 5) return 2;
  return 1;
}

function modeQuality(m: string | null): FixQuality | -1 {
  if (!m) return 0;
  if (m === 'N') return -1;
  if (m === 'D' || m === 'R' || m === 'F' || m === 'P') return 2;
  return 1;
}

export function parseNmea(text: string): ParsedTrack {
  const problems: Problem[] = [];
  const notes: Note[] = [];
  const epochs: Epoch[] = [];
  let cur: Epoch | null = null;

  let checksumBad = 0, checksumLine = 0;
  let glued = 0, gluedLine = 0;
  let garbage = 0, garbageLine = 0;
  let withSum = 0, withoutSum = 0;
  let sawGsv = false, sawSpeed = false;
  let truncated: { line: number; chars: number } | null = null;

  const endsWithNewline = /\n\s*$/.test(text);
  const lines = text.split('\n');
  // A trailing newline produces one empty last element.
  let lastContent = lines.length - 1;
  while (lastContent >= 0 && lines[lastContent].trim() === '') lastContent--;

  for (let li = 0; li < lines.length; li++) {
    let raw = lines[li];
    if (raw.endsWith('\r')) raw = raw.slice(0, -1);
    if (raw.trim() === '') continue;
    const lineNo = li + 1;

    // Strip bytes that can never appear in NMEA.
    let clean = raw.replace(/[^\x20-\x7e]/g, '');
    let hadGarbage = clean.length !== raw.length;
    const first = clean.indexOf('$');
    if (first < 0) { garbage++; if (!garbageLine) garbageLine = lineNo; continue; }
    if (first > 0) { hadGarbage = true; clean = clean.slice(first); }
    if (hadGarbage) { garbage++; if (!garbageLine) garbageLine = lineNo; }

    const parts = clean.split('$').filter((p) => p.length > 0);
    if (parts.length > 1) { glued += parts.length - 1; if (!gluedLine) gluedLine = lineNo; }

    for (let pi = 0; pi < parts.length; pi++) {
      let body = parts[pi].trimEnd();
      const star = body.lastIndexOf('*');
      const isLastSentence = li === lastContent && pi === parts.length - 1;
      if (star >= 0 && /^[0-9A-Fa-f]{2}$/.test(body.slice(star + 1))) {
        withSum++;
        if (nmeaChecksum(body.slice(0, star)) !== body.slice(star + 1).toUpperCase()) {
          if (!hadGarbage) { checksumBad++; if (!checksumLine) checksumLine = lineNo; }
          continue;
        }
        body = body.slice(0, star);
      } else {
        if (isLastSentence && !endsWithNewline) { truncated = { line: lineNo, chars: raw.length }; continue; }
        if (withSum > withoutSum) { checksumBad++; if (!checksumLine) checksumLine = lineNo; continue; }
        withoutSum++;
        if (star >= 0) body = body.slice(0, star);
      }

      const f = body.split(',');
      const id = f[0];
      if (id.length < 5 || id[0] === 'P') continue;
      const type = id.slice(2);

      if (type === 'GSA') {
        if (cur) {
          cur.pdop = dopOf(f[15]); cur.hdopGsa = dopOf(f[16]); cur.vdop = dopOf(f[17]);
          cur.lineEnd = lineNo;
        }
        continue;
      }
      if (type === 'VTG') {
        if (cur) {
          if (Number.isNaN(cur.course)) cur.course = num(f[1]);
          if (Number.isNaN(cur.speed)) {
            const kmh = num(f[7]);
            const kn = num(f[5]);
            cur.speed = Number.isFinite(kmh) ? kmh / 3.6 : kn * KNOT;
          }
          if (Number.isFinite(cur.speed)) sawSpeed = true;
          cur.lineEnd = lineNo;
        }
        continue;
      }
      if (type === 'GSV') { sawGsv = true; continue; }
      if (type !== 'RMC' && type !== 'GGA' && type !== 'GLL' && type !== 'ZDA') continue;

      const todField = type === 'GLL' ? f[5] : f[1];
      const tod = parseTod(todField);
      if (Number.isNaN(tod)) continue;
      if (!cur || cur.todKey !== todField) {
        if (cur) epochs.push(cur);
        cur = newEpoch(todField, tod, lineNo);
      }
      cur.lineEnd = lineNo;

      if (type === 'RMC') {
        cur.rmcStatus = f[2] || null;
        const lat = parseCoord(f[3], f[4], 2), lon = parseCoord(f[5], f[6], 3);
        if (Number.isFinite(lat) && Number.isFinite(lon)) { cur.lat = lat; cur.lon = lon; cur.hasPos = true; }
        const sog = num(f[7]);
        if (Number.isFinite(sog)) { cur.speed = sog * KNOT; sawSpeed = true; }
        cur.course = num(f[8]);
        cur.date = parseDate(f[9]);
        if (f[12]) cur.mode = f[12][0];
      } else if (type === 'GGA') {
        const lat = parseCoord(f[2], f[3], 2), lon = parseCoord(f[4], f[5], 3);
        if (Number.isFinite(lat) && Number.isFinite(lon)) { cur.lat = lat; cur.lon = lon; cur.hasPos = true; }
        const q = num(f[6]);
        cur.ggaQ = Number.isNaN(q) ? null : q;
        cur.sats = num(f[7]);
        cur.hdop = dopOf(f[8]);
        cur.ele = num(f[9]);
        cur.geoid = num(f[11]);
      } else if (type === 'GLL') {
        if (!cur.hasPos) {
          const lat = parseCoord(f[1], f[2], 2), lon = parseCoord(f[3], f[4], 3);
          if (Number.isFinite(lat) && Number.isFinite(lon) && f[6] !== 'V') { cur.lat = lat; cur.lon = lon; cur.hasPos = true; }
        }
      } else if (type === 'ZDA') {
        const d = Number(f[2]), mo = Number(f[3]), y = Number(f[4]);
        if (d >= 1 && mo >= 1 && y > 1900) cur.date = Date.UTC(y, mo - 1, d) / 86400000;
      }
    }
  }
  if (cur) epochs.push(cur);

  // Fill in dates: forward from each known date (rolling over at midnight),
  // then backward for epochs logged before the first date.
  let anyDate = false;
  let lastDate: number | null = null, lastTod = 0;
  for (const e of epochs) {
    if (e.date !== null) { lastDate = e.date; anyDate = true; }
    else if (lastDate !== null) { if (e.tod < lastTod - 43200) lastDate += 1; e.date = lastDate; }
    lastTod = e.tod;
  }
  let nextDate: number | null = null, nextTod = 0;
  for (let i = epochs.length - 1; i >= 0; i--) {
    const e = epochs[i];
    if (e.date !== null) { nextDate = e.date; nextTod = e.tod; continue; }
    if (nextDate !== null) { if (e.tod > nextTod + 43200) nextDate -= 1; e.date = nextDate; nextTod = e.tod; }
  }
  if (!anyDate) notes.push({ kind: 'noDate' });

  const b = new ColumnBuilder();
  let voidCount = 0;
  const days = new Set<number>();
  for (const e of epochs) {
    const gq = ggaQuality(e.ggaQ);
    const mq = modeQuality(e.mode);
    const invalid = gq === -1 || mq === -1 || e.rmcStatus === 'V' || !e.hasPos;
    if (invalid) { voidCount++; continue; }
    const fixq: FixQuality = gq > 0 ? (gq as FixQuality) : mq > 0 ? (mq as FixQuality) : 0;
    const day = e.date ?? 0;
    days.add(Math.floor(day + e.tod / 86400));
    b.push({
      t: (day * 86400 + e.tod) * 1000,
      lat: e.lat, lon: e.lon, ele: e.ele, geoid: e.geoid,
      hdop: Number.isFinite(e.hdop) ? e.hdop : e.hdopGsa, vdop: e.vdop, pdop: e.pdop,
      sats: e.sats, speed: e.speed, course: e.course, fixq, line: e.line, lineEnd: e.lineEnd,
    });
  }
  const cols = b.build();

  if (truncated) problems.push({ kind: 'truncated', line: truncated.line, chars: truncated.chars, kept: cols.n });
  if (checksumBad) problems.push({ kind: 'checksum', count: checksumBad, line: checksumLine });
  if (glued) problems.push({ kind: 'glued', count: glued, line: gluedLine });
  if (garbage) problems.push({ kind: 'garbage', count: garbage, line: garbageLine });
  if (b.counts.backwards) problems.push({ kind: 'backwards', count: b.counts.backwards, line: b.counts.backwardsLine });
  if (b.counts.jumps) problems.push({ kind: 'jump', count: b.counts.jumps, line: b.counts.jumpLine });
  if (cols.n === 0) problems.push({ kind: 'noFixes' });

  if (sawSpeed) notes.push({ kind: 'speedUnit', unit: 'knots', inferred: false });
  if (voidCount) notes.push({ kind: 'void', count: voidCount });
  if (b.counts.duplicates) notes.push({ kind: 'duplicates', count: b.counts.duplicates });
  if (days.size > 1) notes.push({ kind: 'midnight' });
  if (sawGsv) notes.push({ kind: 'ignored', fields: ['satsInView'] });

  const fields: FieldKey[] = ['time', 'position'];
  if (present(cols, 'ele')) fields.push('ele');
  if (present(cols, 'speed')) fields.push('speed');
  if (present(cols, 'course')) fields.push('course');
  if (present(cols, 'hdop')) fields.push('hdop');
  if (present(cols, 'vdop')) fields.push('vdop');
  if (present(cols, 'pdop')) fields.push('pdop');
  if (present(cols, 'sats')) fields.push('sats');
  if (cols.fixq.some((q) => q > 0)) fields.push('fix');
  if (present(cols, 'geoid')) fields.push('geoid');

  return { format: 'nmea', creator: null, name: null, cols, flags: [], problems, notes, fields, lines: lastContent + 1 };
}
