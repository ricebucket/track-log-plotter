import type { FieldKey, FixQuality, Note, ParsedTrack, Problem } from '../model/types';
import { ColumnBuilder, grown, isPosition, present } from './columns';
import { blankAt, isSpace, lastNonSpace, numAt } from './scan';

const KNOT = 1852 / 3600; // m/s

/**
 * An epoch's date before a sentence gives one. Not NaN: a ZDA date out of
 * Date's range is NaN, and is read as the date it is (its fixes are dropped).
 */
const NO_DATE = -Infinity;

/** The epoch being read: what the sentences of one time say. */
interface Epoch {
  tod: number;
  todKey: string;
  /** Days since 1970-01-01, or NO_DATE while the epoch has none. */
  date: number;
  lat: number;
  lon: number;
  hasPos: boolean;
  /** RMC calls the fix void (status V). */
  rmcVoid: boolean;
  /** GGA fix quality, or NaN. */
  ggaQ: number;
  /** RMC mode letter as a character code, or -1. */
  mode: number;
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

/** Empties `e` for a new time, so one object serves every epoch. */
function startEpoch(e: Epoch, todKey: string, tod: number, line: number): Epoch {
  e.tod = tod; e.todKey = todKey; e.date = NO_DATE; e.lat = NaN; e.lon = NaN; e.hasPos = false; e.rmcVoid = false;
  e.ggaQ = NaN; e.mode = -1; e.ele = NaN; e.geoid = NaN; e.hdop = NaN; e.hdopGsa = NaN; e.vdop = NaN; e.pdop = NaN;
  e.sats = NaN; e.speed = NaN; e.course = NaN; e.line = line; e.lineEnd = line;
  return e;
}

/** XOR of the characters between "$" and "*", as two hex digits. */
export function nmeaChecksum(body: string): string {
  let x = 0;
  for (let i = 0; i < body.length; i++) x ^= body.charCodeAt(i);
  return x.toString(16).toUpperCase().padStart(2, '0');
}

/** Bytes that can never appear in NMEA: anything but printable ASCII. */
const STRAY = /[^\x20-\x7e]/g;

/** Whether s[a, b) holds a byte that can never appear in NMEA. */
function strayIn(s: string, a: number, b: number): boolean {
  for (let k = a; k < b; k++) { const c = s.charCodeAt(k); if (c < 32 || c > 126) return true; }
  return false;
}

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

/** A position that wasn't measured: estimated (dead reckoning), entered by hand or simulated. Not a GPS fix. */
const UNMEASURED = 3;

/** A GGA fix quality as the app keeps it: -1 no fix, 0 not given, 1 GPS, 2 corrected, or UNMEASURED. */
function ggaQuality(q: number): number {
  if (Number.isNaN(q)) return 0;
  if (q === 0) return -1;
  if (q === 2 || q === 4 || q === 5) return 2;
  if (q === 6 || q === 7 || q === 8) return UNMEASURED;
  return 1;
}

/** The same for an RMC mode letter, given as its character code (-1 when there is none). */
function modeQuality(m: number): number {
  if (m < 0) return 0;
  if (m === 78) return -1; // N
  if (m === 68 || m === 82 || m === 70 || m === 80) return 2; // D R F P
  if (m === 69 || m === 77 || m === 83) return UNMEASURED; // E M S
  return 1;
}

/**
 * Every epoch read, as columns: a long log keeps no object per epoch (on a
 * 100 MB log, collecting those took up to half the read time). The values
 * are kept as read, as doubles, until they go into the track's columns.
 */
class Epochs {
  n = 0;
  tod = new Float64Array(1024);
  /** Days since 1970-01-01; NO_DATE until known. */
  date = new Float64Array(1024);
  lat = new Float64Array(1024);
  lon = new Float64Array(1024);
  ele = new Float64Array(1024);
  geoid = new Float64Array(1024);
  /** GGA's HDOP, else GSA's. */
  hdop = new Float64Array(1024);
  vdop = new Float64Array(1024);
  pdop = new Float64Array(1024);
  sats = new Float64Array(1024);
  speed = new Float64Array(1024);
  course = new Float64Array(1024);
  /** Fix quality; -1 for an epoch that is no fix. */
  q = new Int8Array(1024);
  line = new Int32Array(1024);
  lineEnd = new Int32Array(1024);

  private grow() {
    const cap = this.tod.length * 2;
    this.tod = grown(this.tod, cap); this.date = grown(this.date, cap); this.lat = grown(this.lat, cap); this.lon = grown(this.lon, cap);
    this.ele = grown(this.ele, cap); this.geoid = grown(this.geoid, cap); this.hdop = grown(this.hdop, cap); this.vdop = grown(this.vdop, cap);
    this.pdop = grown(this.pdop, cap); this.sats = grown(this.sats, cap); this.speed = grown(this.speed, cap); this.course = grown(this.course, cap);
    this.q = grown(this.q, cap); this.line = grown(this.line, cap); this.lineEnd = grown(this.lineEnd, cap);
  }

  push(e: Epoch) {
    if (this.n === this.tod.length) this.grow();
    const i = this.n++;
    this.tod[i] = e.tod; this.date[i] = e.date; this.lat[i] = e.lat; this.lon[i] = e.lon;
    this.ele[i] = e.ele; this.geoid[i] = e.geoid; this.hdop[i] = Number.isFinite(e.hdop) ? e.hdop : e.hdopGsa; this.vdop[i] = e.vdop;
    this.pdop[i] = e.pdop; this.sats[i] = e.sats; this.speed[i] = e.speed; this.course[i] = e.course;
    // A void epoch, or one without a position, is no fix. A position that wasn't measured is one of unknown quality,
    // whatever the other sentences say; otherwise GGA's quality counts first, then RMC's mode.
    const gq = ggaQuality(e.ggaQ), mq = modeQuality(e.mode);
    this.q[i] = gq === -1 || mq === -1 || e.rmcVoid || !e.hasPos ? -1 : gq === UNMEASURED || mq === UNMEASURED ? 0 : gq > 0 ? gq : mq;
    this.line[i] = e.line; this.lineEnd[i] = e.lineEnd;
  }
}

export function parseNmea(text: string): ParsedTrack {
  const problems: Problem[] = [];
  const notes: Note[] = [];
  const epochs = new Epochs();
  // The epoch being read, null before the first time: always the same object, emptied for each new time.
  const ep = startEpoch({} as Epoch, '', NaN, 0);
  let cur: Epoch | null = null;

  let checksumBad = 0, checksumLine = 0;
  let glued = 0, gluedLine = 0;
  let garbage = 0, garbageLine = 0;
  let withSum = 0, withoutSum = 0;
  let sawGsv = false, sawSpeed = false;
  /** A sentence gave a position but no time it can be placed at (all that a planned route has). */
  let untimed = false;
  // Set inside line() below, which TypeScript's narrowing doesn't follow.
  let truncated = null as { line: number; chars: number } | null;

  // The content ends at the last character that isn't space: the line holding
  // it is the last line, and the file ended cleanly if a line break follows it.
  const lastNonWs = lastNonSpace(text);
  const endsWithNewline = text.indexOf('\n', lastNonWs + 1) >= 0 || text.indexOf('\r', lastNonWs + 1) >= 0;
  let lastContent = -1;

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
  /** "ddmmyy" → days since 1970-01-01, or NO_DATE; the same date as last time is worked out once. */
  let dateKey = '', dateDays = NO_DATE;
  const date = (k: number): number => {
    if (k >= nf || FE[k] - FS[k] !== 6) return NO_DATE;
    const a = FS[k];
    if (s.startsWith(dateKey, a) && dateKey.length === 6) return dateDays;
    dateKey = s.slice(a, a + 6);
    dateDays = daysAt(a);
    return dateDays;
  };
  const daysAt = (a: number): number => {
    const d = numAt(s, a, a + 2), mo = numAt(s, a + 2, a + 4), yy = numAt(s, a + 4, a + 6);
    if (!(d >= 1 && d <= 31 && mo >= 1 && mo <= 12 && yy >= 0)) return NO_DATE;
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
  /** Field k is the single letter `c` (a character code). */
  const letter = (k: number, c: number) => k < nf && FE[k] - FS[k] === 1 && s.charCodeAt(FS[k]) === c;
  /** Field k as Number() reads it (NaN when absent, 0 when blank). */
  const plain = (k: number) => (k < nf ? numAt(s, FS[k], FE[k]) : NaN);
  /** For a sentence without a usable time: whether it gives a position all the same. */
  const timelessPosition = (type: number): boolean => {
    if (type === RMC) return !letter(2, 86) && isPosition(coord(3, 4, 2), coord(5, 6, 3)); // not void (V)
    if (type === GGA) return num(6) !== 0 && isPosition(coord(2, 3, 2), coord(4, 5, 3)); // quality 0: no fix
    if (type === GLL) return !letter(6, 86) && isPosition(coord(1, 2, 2), coord(3, 4, 3));
    return false;
  };

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
  /**
   * Reads the sentences of the line s[a, b). A stray byte (one that can never
   * appear in NMEA) after the first $ changes what the line says, so such a
   * line is read again with those bytes taken out: line() reads nothing of it
   * and returns false. Stray bytes are looked for on the passes that visit each
   * character anyway (the checksum's, and the one trimming space off the end);
   * `clean` says the line has none.
   */
  const line = (a: number, b: number, lineNo: number, rawLen: number, lastLine: boolean, hadGarbage0: boolean, clean: boolean): boolean => {
    const str = s, fsA = FS, feA = FE;
    const first = nextDollar(a);
    if (first < 0 || first >= b) { garbage++; if (!garbageLine) garbageLine = lineNo; return true; }
    // Space before the first $ is an indented line, not garbage. Anything
    // else there is garbage, a stray byte or not, and changes no sentence.
    const hadGarbage = hadGarbage0 || (first > a && !blankAt(str, a, first));
    // Almost every line holds exactly one sentence; glued ones are split at
    // each $, leaving out empty pieces. Each is read before the next, so a
    // glued line is looked through for stray bytes first.
    np = 0;
    const second = nextDollar(first + 1);
    if (second < 0 || second >= b) addPart(first + 1, b);
    else {
      if (!clean && strayIn(str, first, b)) return false;
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
      // `bad` turns negative at a stray byte (a code below 32 or above 126).
      let n = 0, fs = ba, bad = 0;
      // Space at the end is no part of the sentence; any kind but a plain space is a stray byte.
      if (bb > ba && str.charCodeAt(bb - 1) <= 32) {
        while (bb > ba && isSpace(str.charCodeAt(bb - 1))) { if (str.charCodeAt(bb - 1) !== 32) bad = -1; bb--; }
      }
      let star = -1; // the last * in the sentence
      for (let q = nextStar(ba); q >= 0 && q < bb; q = nextStar(q + 1)) star = q;
      const isLastSentence = lastLine && pi === np - 1;
      const hi = star >= 0 && bb === star + 3 ? hexDigit(str.charCodeAt(star + 1)) : -1;
      const lo = hi >= 0 ? hexDigit(str.charCodeAt(star + 2)) : -1;
      // Fields are found, and stray bytes looked for, on the same pass that checks the checksum.
      if (lo >= 0) {
        let x = 0;
        for (let k = ba; k < star; k++) {
          const c = str.charCodeAt(k);
          x ^= c;
          bad |= (126 - c) | (c - 32);
          if (c === 44) { if (n < MAX_FIELDS) { fsA[n] = fs; feA[n] = k; } n++; fs = k + 1; }
        }
        if (bad < 0 && !clean) return false;
        withSum++;
        if (x !== hi * 16 + lo) {
          if (!hadGarbage) { checksumBad++; if (!checksumLine) checksumLine = lineNo; }
          continue;
        }
        bb = star;
      } else {
        const end = star >= 0 ? star : bb;
        for (let k = ba; k < end; k++) {
          const c = str.charCodeAt(k);
          bad |= (126 - c) | (c - 32);
          if (c === 44) { if (n < MAX_FIELDS) { fsA[n] = fs; feA[n] = k; } n++; fs = k + 1; }
        }
        if (!clean && (bad < 0 || (star >= 0 && strayIn(str, star, bb)))) return false;
        if (isLastSentence && !endsWithNewline) { truncated = { line: lineNo, chars: rawLen }; continue; }
        if (withSum > withoutSum) { checksumBad++; if (!checksumLine) checksumLine = lineNo; continue; }
        withoutSum++;
        bb = end;
      }
      if (n < MAX_FIELDS) { fsA[n] = fs; feA[n] = bb; }
      nf = n + 1 < MAX_FIELDS ? n + 1 : MAX_FIELDS;

      const idLen = FE[0] - FS[0];
      if (idLen < 5 || str.charCodeAt(FS[0]) === 80 /* P */) continue;
      const type = idLen === 5 ? (str.charCodeAt(FS[0] + 2) << 16) | (str.charCodeAt(FS[0] + 3) << 8) | str.charCodeAt(FS[0] + 4) : -1;

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
      if (!cur || !(tk < nf && FE[tk] - FS[tk] === cur.todKey.length && str.startsWith(cur.todKey, FS[tk]))) {
        const t = tod(tk);
        if (Number.isNaN(t)) { if (!untimed) untimed = timelessPosition(type); continue; }
        if (!cur || t !== cur.tod) {
          if (cur) epochs.push(cur);
          cur = startEpoch(ep, str.slice(FS[tk], FE[tk]), t, lineNo);
        }
      }
      cur.lineEnd = lineNo;

      if (type === RMC) {
        cur.rmcVoid = letter(2, 86); // V
        const lat = coord(3, 4, 2), lon = coord(5, 6, 3);
        if (Number.isFinite(lat) && Number.isFinite(lon)) { cur.lat = lat; cur.lon = lon; cur.hasPos = true; }
        const sog = num(7);
        if (Number.isFinite(sog)) { cur.speed = sog * KNOT; sawSpeed = true; }
        cur.course = num(8);
        cur.date = date(9);
        if (has(12)) cur.mode = str.charCodeAt(FS[12]);
      } else if (type === GGA) {
        const lat = coord(2, 3, 2), lon = coord(4, 5, 3);
        if (Number.isFinite(lat) && Number.isFinite(lon)) { cur.lat = lat; cur.lon = lon; cur.hasPos = true; }
        cur.ggaQ = num(6);
        cur.sats = num(7);
        cur.hdop = dop(8);
        cur.ele = num(9);
        cur.geoid = num(11);
      } else if (type === GLL) {
        if (!cur.hasPos) {
          const lat = coord(1, 2, 2), lon = coord(3, 4, 3);
          if (Number.isFinite(lat) && Number.isFinite(lon) && !letter(6, 86)) { cur.lat = lat; cur.lon = lon; cur.hasPos = true; } // not void (V)
        }
      } else {
        const d = plain(2), mo = plain(3), y = plain(4);
        if (d >= 1 && mo >= 1 && y > 1900) cur.date = Date.UTC(y, mo - 1, d) / 86400000;
      }
    }
    if (hadGarbage) { garbage++; if (!garbageLine) garbageLine = lineNo; }
    return true;
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
    if (!blankAt(text, ls, le) && !line(ls, le, li + 1, le - ls, lastLine, false, false)) {
      // A stray byte: the line is read again with its stray bytes taken out
      // (space before the sentence isn't one, whatever kind), and counts as
      // garbage.
      let a = ls;
      while (a < le && isSpace(text.charCodeAt(a))) a++;
      const raw = text.slice(a, le), cleaned = raw.replace(STRAY, '');
      s = cleaned; dq = -1; sq = -1; // searches start afresh in the cleaned line, and again after it
      line(0, cleaned.length, li + 1, le - ls, lastLine, cleaned.length !== raw.length, true);
      s = text; dq = -1; sq = -1;
    }
    if (le >= len) break;
    ls = le + (le === cr && text.charCodeAt(le + 1) === 10 ? 2 : 1);
  }
  if (cur) epochs.push(cur);

  // Fill in dates: forward from the first known date (rolling over at
  // midnight, and taking each new date as it comes), then backward for the
  // epochs logged before it.
  const en = epochs.n, D = epochs.date, T = epochs.tod;
  let first = -1;
  let lastDate = NO_DATE, lastTod = 0;
  for (let i = 0; i < en; i++) {
    const d = D[i];
    if (d !== NO_DATE) { lastDate = d; if (first < 0) first = i; }
    else if (first >= 0) { if (T[i] < lastTod - 43200) lastDate += 1; D[i] = lastDate; }
    lastTod = T[i];
  }
  if (first > 0) {
    let nextDate = D[first], nextTod = T[first];
    for (let i = first - 1; i >= 0; i--) {
      if (T[i] > nextTod + 43200) nextDate -= 1;
      D[i] = nextDate;
      nextTod = T[i];
    }
  }
  if (first < 0) {
    // No dates anywhere: count days from zero, rolling over at midnight, so a
    // log that runs past midnight keeps going forward instead of jumping back.
    let day = 0, prev = en ? T[0] : 0;
    for (let i = 0; i < en; i++) {
      if (T[i] < prev - 43200) day += 1;
      D[i] = day;
      prev = T[i];
    }
    notes.push({ kind: 'noDate' });
  }

  const b = new ColumnBuilder();
  let voidCount = 0;
  // The UTC day of the first fix, and whether any other fix is on another (NaN, from a ZDA date out of range,
  // counting as one day of its own).
  let day0 = 0, anyDay = false, manyDays = false;
  const E = epochs;
  for (let i = 0; i < en; i++) {
    const q = E.q[i];
    if (q < 0) { voidCount++; continue; }
    const day = D[i], t = T[i];
    const dayNo = Math.floor(day + t / 86400);
    if (!anyDay) { day0 = dayNo; anyDay = true; } else if (!(dayNo === day0 || (dayNo !== dayNo && day0 !== day0))) manyDays = true;
    b.push({
      t: (day * 86400 + t) * 1000,
      lat: E.lat[i], lon: E.lon[i], ele: E.ele[i], geoid: E.geoid[i], hdop: E.hdop[i], vdop: E.vdop[i], pdop: E.pdop[i],
      sats: E.sats[i], speed: E.speed[i], course: E.course[i], fixq: q as FixQuality, line: E.line[i], lineEnd: E.lineEnd[i],
    });
  }
  const cols = b.build();

  if (truncated) problems.push({ kind: 'truncated', line: truncated.line, chars: truncated.chars, kept: cols.n });
  if (checksumBad) problems.push({ kind: 'checksum', count: checksumBad, line: checksumLine });
  if (glued) problems.push({ kind: 'glued', count: glued, line: gluedLine });
  if (garbage) problems.push({ kind: 'garbage', count: garbage, line: garbageLine });
  if (b.counts.backwards) problems.push({ kind: 'backwards', count: b.counts.backwards, line: b.counts.backwardsLine });
  if (b.counts.jumps) problems.push({ kind: 'jump', count: b.counts.jumps, line: b.counts.jumpLine });
  if (cols.n === 0) problems.push(untimed ? { kind: 'noFixes', timeless: true } : { kind: 'noFixes' });

  if (sawSpeed) notes.push({ kind: 'speedUnit', unit: 'knots', inferred: false });
  const noPosition = voidCount + b.counts.noPosition;
  if (noPosition) notes.push({ kind: 'void', count: noPosition });
  if (b.counts.duplicates) notes.push({ kind: 'duplicates', count: b.counts.duplicates });
  if (manyDays) notes.push({ kind: 'midnight' });
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
