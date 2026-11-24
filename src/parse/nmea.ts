import type { FieldKey, FixQuality, Note, ParsedTrack, Problem } from '../model/types';
import { ColumnBuilder, present } from './columns';
import { blankAt, isSpace, lastNonSpace, numAt } from './scan';

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

const BAD_BYTE = /[^\x20-\x7e]/;
const BAD_BYTES = /[^\x20-\x7e]/g;
/** Any byte that can never appear in NMEA but line breaks. */
const BAD_OR_BREAK = /[^\x20-\x7e\n\r]/;

/** Value of a hex digit's character code, or -1. */
function hexDigit(c: number): number {
  if (c >= 48 && c <= 57) return c - 48;
  if (c >= 65 && c <= 70) return c - 55;
  if (c >= 97 && c <= 102) return c - 87;
  return -1;
}

/** A sentence type (the three letters after the talker) as one number. */
const code3 = (t: string) => (t.charCodeAt(0) << 16) | (t.charCodeAt(1) << 8) | t.charCodeAt(2);
const GSA = code3('GSA'), VTG = code3('VTG'), GSV = code3('GSV'), RMC = code3('RMC'), GGA = code3('GGA'), GLL = code3('GLL'), ZDA = code3('ZDA');
/** Fields past this are never read. */
const MAX_FIELDS = 32;

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
  // Set inside line() below, which TypeScript's narrowing doesn't follow.
  let truncated = null as { line: number; chars: number } | null;

  // The content ends at the last character that isn't space: the line holding
  // it is the last line, and the file ended cleanly if a line break follows it.
  const lastNonWs = lastNonSpace(text);
  const endsWithNewline = text.indexOf('\n', lastNonWs + 1) >= 0 || text.indexOf('\r', lastNonWs + 1) >= 0;
  let lastContent = -1;
  // Bytes that can never appear in NMEA are stripped line by line; most files
  // have none, and then every line is read in place.
  const anyBad = BAD_OR_BREAK.test(text);

  // The sentence being read: field k is s[FS[k], FE[k]), for k < nf.
  let s = text, nf = 0;
  const FS = new Int32Array(MAX_FIELDS), FE = new Int32Array(MAX_FIELDS);
  const has = (k: number) => k < nf && FE[k] > FS[k];
  /** A number, or NaN when blank or not finite. */
  const num = (k: number): number => {
    if (!has(k)) return NaN;
    const v = numAt(s, FS[k], FE[k]);
    return v - v === 0 ? v : NaN;
  };
  /** A dilution of precision; 0 is a placeholder, so it counts as missing. */
  const dop = (k: number): number => { const v = num(k); return v > 0 ? v : NaN; };
  /** "hhmmss.sss" → seconds of day, or NaN. */
  const tod = (k: number): number => {
    if (k >= nf || FE[k] - FS[k] < 6) return NaN;
    const a = FS[k];
    const h = numAt(s, a, a + 2), m = numAt(s, a + 2, a + 4), sec = numAt(s, a + 4, FE[k]);
    if (!Number.isFinite(h) || !Number.isFinite(m) || !Number.isFinite(sec) || h > 23 || m > 59 || sec >= 61) return NaN;
    return h * 3600 + m * 60 + sec;
  };
  /** "ddmmyy" → days since 1970-01-01, or null; the same date as last time is worked out once. */
  let dateKey = '', dateDays: number | null = null;
  const date = (k: number): number | null => {
    if (k >= nf || FE[k] - FS[k] !== 6) return null;
    const a = FS[k];
    if (s.startsWith(dateKey, a) && dateKey.length === 6) return dateDays;
    dateKey = s.slice(a, a + 6);
    dateDays = daysAt(a);
    return dateDays;
  };
  const daysAt = (a: number): number | null => {
    const d = numAt(s, a, a + 2), mo = numAt(s, a + 2, a + 4), yy = numAt(s, a + 4, a + 6);
    if (!(d >= 1 && d <= 31 && mo >= 1 && mo <= 12 && yy >= 0)) return null;
    const y = yy < 80 ? 2000 + yy : 1900 + yy;
    return Date.UTC(y, mo - 1, d) / 86400000;
  };
  /** "ddmm.mmmm" + hemisphere → signed degrees, or NaN. */
  const coord = (k: number, hk: number, degDigits: number): number => {
    if (!has(k) || !has(hk)) return NaN;
    const a = FS[k], e = FE[k];
    let dot = a;
    while (dot < e && s.charCodeAt(dot) !== 46) dot++;
    const intLen = dot - a;
    if (intLen < degDigits + 2) return NaN;
    const deg = numAt(s, a, a + intLen - 2), min = numAt(s, a + intLen - 2, e);
    if (!Number.isFinite(deg) || !Number.isFinite(min) || min >= 60) return NaN;
    const out = deg + min / 60;
    if (FE[hk] - FS[hk] !== 1) return NaN;
    const h = s.charCodeAt(FS[hk]);
    if (h === 83 || h === 87) return -out; // S W
    if (h === 78 || h === 69) return out; // N E
    return NaN;
  };
  /** Field k as Number() reads it (NaN when absent, 0 when blank). */
  const plain = (k: number) => (k < nf ? numAt(s, FS[k], FE[k]) : NaN);

  // The next $ and * at or after a point. Searches only move forward through
  // `s`, so each answer is kept until the search passes it: the whole file is
  // searched once, however far apart the marks are (a file with no $ at all
  // would otherwise be searched to its end from every line).
  let dq = -1, dp = -1, sq = -1, sp = -1;
  const nextDollar = (from: number): number => {
    if (dq < 0 || from < dq || (dp >= 0 && dp < from)) { dq = from; dp = s.indexOf('$', from); }
    return dp;
  };
  const nextStar = (from: number): number => {
    if (sq < 0 || from < sq || (sp >= 0 && sp < from)) { sq = from; sp = s.indexOf('*', from); }
    return sp;
  };

  // The sentences on one line: s[PS[i], PE[i]) for i < np.
  let PS = new Int32Array(16), PE = new Int32Array(16), np = 0;
  const addPart = (a: number, b: number) => {
    if (np === PS.length) {
      const ps2 = new Int32Array(np * 2); ps2.set(PS); PS = ps2;
      const pe2 = new Int32Array(np * 2); pe2.set(PE); PE = pe2;
    }
    PS[np] = a; PE[np] = b; np++;
  };
  const line = (a: number, b: number, lineNo: number, rawLen: number, lastLine: boolean, hadGarbage0: boolean) => {
    const str = s, fsA = FS, feA = FE;
    const first = nextDollar(a);
    if (first < 0 || first >= b) { garbage++; if (!garbageLine) garbageLine = lineNo; return; }
    // Space before the first $ is an indented line, not garbage.
    const hadGarbage = hadGarbage0 || (first > a && !blankAt(s, a, first));
    if (hadGarbage) { garbage++; if (!garbageLine) garbageLine = lineNo; }
    // Almost every line holds exactly one sentence; glued ones are split at
    // each $, leaving out empty pieces.
    np = 0;
    const second = nextDollar(first + 1);
    if (second < 0 || second >= b) addPart(first + 1, b);
    else {
      let p = first;
      while (p < b) {
        let q = nextDollar(p + 1);
        if (q < 0 || q > b) q = b;
        if (q > p + 1) addPart(p + 1, q);
        p = q;
      }
    }
    if (np > 1) { glued += np - 1; if (!gluedLine) gluedLine = lineNo; }

    for (let pi = 0; pi < np; pi++) {
      const ba = PS[pi];
      let bb = PE[pi];
      if (bb > ba && str.charCodeAt(bb - 1) <= 32) while (bb > ba && isSpace(str.charCodeAt(bb - 1))) bb--;
      let star = -1; // the last * in the sentence
      for (let q = nextStar(ba); q >= 0 && q < bb; q = nextStar(q + 1)) star = q;
      const isLastSentence = lastLine && pi === np - 1;
      const hi = star >= 0 && bb === star + 3 ? hexDigit(str.charCodeAt(star + 1)) : -1;
      const lo = hi >= 0 ? hexDigit(str.charCodeAt(star + 2)) : -1;
      // Fields are found on the same pass that checks the checksum.
      let n = 0, fs = ba;
      if (lo >= 0) {
        withSum++;
        let x = 0;
        for (let k = ba; k < star; k++) {
          const c = str.charCodeAt(k);
          x ^= c;
          if (c === 44) { if (n < MAX_FIELDS) { fsA[n] = fs; feA[n] = k; } n++; fs = k + 1; }
        }
        if (x !== hi * 16 + lo) {
          if (!hadGarbage) { checksumBad++; if (!checksumLine) checksumLine = lineNo; }
          continue;
        }
        bb = star;
      } else {
        if (isLastSentence && !endsWithNewline) { truncated = { line: lineNo, chars: rawLen }; continue; }
        if (withSum > withoutSum) { checksumBad++; if (!checksumLine) checksumLine = lineNo; continue; }
        withoutSum++;
        if (star >= 0) bb = star;
        for (let k = ba; k < bb; k++) if (str.charCodeAt(k) === 44) { if (n < MAX_FIELDS) { fsA[n] = fs; feA[n] = k; } n++; fs = k + 1; }
      }
      if (n < MAX_FIELDS) { fsA[n] = fs; feA[n] = bb; }
      nf = n + 1 < MAX_FIELDS ? n + 1 : MAX_FIELDS;

      const idLen = FE[0] - FS[0];
      if (idLen < 5 || s.charCodeAt(FS[0]) === 80 /* P */) continue;
      const type = idLen === 5 ? (s.charCodeAt(FS[0] + 2) << 16) | (s.charCodeAt(FS[0] + 3) << 8) | s.charCodeAt(FS[0] + 4) : -1;

      if (type === GSA) {
        if (cur) {
          cur.pdop = dop(15); cur.hdopGsa = dop(16); cur.vdop = dop(17);
          cur.lineEnd = lineNo;
        }
        continue;
      }
      if (type === VTG) {
        if (cur) {
          if (Number.isNaN(cur.course)) cur.course = num(1);
          if (Number.isNaN(cur.speed)) {
            const kmh = num(7);
            const kn = num(5);
            cur.speed = Number.isFinite(kmh) ? kmh / 3.6 : kn * KNOT;
          }
          if (Number.isFinite(cur.speed)) sawSpeed = true;
          cur.lineEnd = lineNo;
        }
        continue;
      }
      if (type === GSV) { sawGsv = true; continue; }
      if (type !== RMC && type !== GGA && type !== GLL && type !== ZDA) continue;

      // A new time starts a new epoch; the time is kept as text only then. The
      // same time written another way ("130500.000" after "130500.00") is the
      // same epoch.
      const tk = type === GLL ? 5 : 1;
      if (!cur || !(tk < nf && FE[tk] - FS[tk] === cur.todKey.length && s.startsWith(cur.todKey, FS[tk]))) {
        const t = tod(tk);
        if (Number.isNaN(t)) continue;
        if (!cur || t !== cur.tod) {
          if (cur) epochs.push(cur);
          cur = newEpoch(s.slice(FS[tk], FE[tk]), t, lineNo);
        }
      }
      cur.lineEnd = lineNo;

      if (type === RMC) {
        cur.rmcStatus = has(2) ? s.slice(FS[2], FE[2]) : null;
        const lat = coord(3, 4, 2), lon = coord(5, 6, 3);
        if (Number.isFinite(lat) && Number.isFinite(lon)) { cur.lat = lat; cur.lon = lon; cur.hasPos = true; }
        const sog = num(7);
        if (Number.isFinite(sog)) { cur.speed = sog * KNOT; sawSpeed = true; }
        cur.course = num(8);
        cur.date = date(9);
        if (has(12)) cur.mode = s.charAt(FS[12]);
      } else if (type === GGA) {
        const lat = coord(2, 3, 2), lon = coord(4, 5, 3);
        if (Number.isFinite(lat) && Number.isFinite(lon)) { cur.lat = lat; cur.lon = lon; cur.hasPos = true; }
        const q = num(6);
        cur.ggaQ = Number.isNaN(q) ? null : q;
        cur.sats = num(7);
        cur.hdop = dop(8);
        cur.ele = num(9);
        cur.geoid = num(11);
      } else if (type === GLL) {
        if (!cur.hasPos) {
          const lat = coord(1, 2, 2), lon = coord(3, 4, 3);
          const voided = 6 < nf && FE[6] - FS[6] === 1 && s.charCodeAt(FS[6]) === 86; // "V"
          if (Number.isFinite(lat) && Number.isFinite(lon) && !voided) { cur.lat = lat; cur.lon = lon; cur.hasPos = true; }
        }
      } else {
        const d = plain(2), mo = plain(3), y = plain(4);
        if (d >= 1 && mo >= 1 && y > 1900) cur.date = Date.UTC(y, mo - 1, d) / 86400000;
      }
    }
  };

  // Lines end at \r\n, \r or \n. The next \r and the next \n are each looked
  // for again only once a line start passes them, so a file without one of
  // them (most have no lone \r) is searched for it once.
  const len = text.length;
  let cr = text.indexOf('\r'), lf = text.indexOf('\n');
  for (let ls = 0, li = 0; ; li++) {
    if (cr >= 0 && cr < ls) cr = text.indexOf('\r', ls);
    if (lf >= 0 && lf < ls) lf = text.indexOf('\n', ls);
    const le = lf < 0 ? (cr < 0 ? len : cr) : cr < 0 || lf < cr ? lf : cr;
    const lastLine = ls <= lastNonWs && lastNonWs < le;
    if (lastLine) lastContent = li;
    if (!blankAt(text, ls, le)) {
      if (!anyBad) { s = text; line(ls, le, li + 1, le - ls, lastLine, false); }
      else {
        // Space before the sentence isn't garbage, whatever kind it is.
        let a = ls;
        while (a < le && isSpace(text.charCodeAt(a))) a++;
        const raw = text.slice(a, le);
        const clean = BAD_BYTE.test(raw) ? raw.replace(BAD_BYTES, '') : raw;
        s = clean; dq = -1; sq = -1; // searches start afresh in each cleaned line
        line(0, clean.length, li + 1, le - ls, lastLine, clean.length !== raw.length);
      }
    }
    if (le >= len) break;
    ls = le + (le === cr && text.charCodeAt(le + 1) === 10 ? 2 : 1);
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
  if (!anyDate) {
    // No dates anywhere: count days from zero, rolling over at midnight, so a
    // log that runs past midnight keeps going forward instead of jumping back.
    let day = 0, prev = epochs[0]?.tod ?? 0;
    for (const e of epochs) {
      if (e.tod < prev - 43200) day += 1;
      e.date = day;
      prev = e.tod;
    }
    notes.push({ kind: 'noDate' });
  }

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
  const noPosition = voidCount + b.counts.noPosition;
  if (noPosition) notes.push({ kind: 'void', count: noPosition });
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
