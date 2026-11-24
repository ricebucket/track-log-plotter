import type { Columns, FieldKey, Flag, FixQuality, Note, ParsedTrack, Problem } from '../model/types';
import { ColumnBuilder, keepFixes, present } from './columns';
import { scanXml } from './xml';
import { inferSpeedUnit, UNIT_FACTOR } from './units';
import { numAt } from './scan';

/**
 * Readable names for extension fields the app doesn't use. A Map, not an
 * object: a tag named "constructor" or "__proto__" must not find Object's own.
 */
const IGNORED_NAMES = new Map<string, string>(Object.entries({
  hr: 'heartRate', heartrate: 'heartRate', cad: 'cadence', cadence: 'cadence', atemp: 'temperature',
  wtemp: 'temperature', temp: 'temperature', temperature: 'temperature', power: 'power', depth: 'depth',
  distance: 'distance', satinview: 'satsInView', satsinview: 'satsInView', sats_in_view: 'satsInView',
  sat_view: 'satsInView', satview: 'satsInView',
}));

/** Elements that hold others: a stray close tag never closes one of these. */
const STRUCTURE = new Set(['gpx', 'metadata', 'trk', 'trkseg', 'trkpt', 'rte', 'rtept', 'wpt', 'extensions']);

const POINT_FIELDS = new Set(['ele', 'time', 'hdop', 'vdop', 'pdop', 'sat', 'fix', 'geoidheight', 'speed', 'spd', 'sog', 'course', 'crs', 'cog', 'heading', 'name', 'sym', 'type', 'desc', 'cmt', 'src', 'link', 'magvar', 'ageofdgpsdata', 'dgpsid', 'extensions', 'text']);

/** A dilution of precision of 0 is a placeholder: real values are never below about 0.5. */
const dop = (v: string) => { const x = num(v); return x > 0 ? x : NaN; };
/** Number(v), read in place; NaN for a blank value (an empty <ele/> is no height, not 0 m). */
const num = (v: string | undefined) => (v === undefined ? NaN : numAt(v, 0, v.length, NaN));
const EXT_CONTAINERS = new Set(['TrackPointExtension', 'TrackPointExtensionv1', 'TrackPointExtensionv2', 'extensions']);

interface Point {
  lat: number;
  lon: number;
  line: number;
  t: number;
  ele: number;
  hdop: number;
  vdop: number;
  pdop: number;
  sats: number;
  fixq: FixQuality | -1;
  geoid: number;
  speedKnown: number;
  speedVendor: number;
  course: number;
  name: string | null;
}

function newPoint(attrs: Map<string, string>, line: number): Point {
  return {
    lat: num(attrs.get('lat')), lon: num(attrs.get('lon')), line, t: NaN, ele: NaN, hdop: NaN, vdop: NaN,
    pdop: NaN, sats: NaN, fixq: 0, geoid: NaN, speedKnown: NaN, speedVendor: NaN, course: NaN, name: null,
  };
}

const HAS_ZONE = /(Z|[+-]\d\d:?\d\d)$/i;
/** A time whose zone is given in hours alone ("…T09:00:00-04"), which Date.parse doesn't take. */
const HOURS_ZONE = /T\d\d:\d\d(?::\d\d(?:[.,]\d+)?)?[+-]\d\d$/;

const digit = (s: string, i: number) => { const c = s.charCodeAt(i) - 48; return c >= 0 && c <= 9 ? c : -100_000; };
const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

/**
 * The usual GPX time, "YYYY-MM-DDTHH:MM:SSZ" (or with exactly three digits of
 * a second), read directly; NaN for anything else, which goes to Date.parse.
 * Only valid times are taken: for those every browser's Date.parse must give
 * the same as Date.UTC, while invalid ones (February 30th, 24:00) differ.
 */
function usualTime(v: string): number {
  const len = v.length;
  if ((len !== 20 && len !== 24) || v.charCodeAt(len - 1) !== 90 /* Z */) return NaN;
  if (v.charCodeAt(4) !== 45 || v.charCodeAt(7) !== 45 || v.charCodeAt(10) !== 84 || v.charCodeAt(13) !== 58 || v.charCodeAt(16) !== 58) return NaN;
  const y = digit(v, 0) * 1000 + digit(v, 1) * 100 + digit(v, 2) * 10 + digit(v, 3);
  const mo = digit(v, 5) * 10 + digit(v, 6), d = digit(v, 8) * 10 + digit(v, 9);
  const h = digit(v, 11) * 10 + digit(v, 12), mi = digit(v, 14) * 10 + digit(v, 15), s = digit(v, 17) * 10 + digit(v, 18);
  let ms = 0;
  if (len === 24) {
    if (v.charCodeAt(19) !== 46) return NaN;
    ms = digit(v, 20) * 100 + digit(v, 21) * 10 + digit(v, 22);
    if (ms < 0) return NaN;
  }
  if (y < 100 || mo < 1 || mo > 12 || d < 1 || h < 0 || h > 23 || mi < 0 || mi > 59 || s < 0 || s > 59) return NaN;
  const leap = mo === 2 && (y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0));
  if (d > DAYS_IN_MONTH[mo - 1] + (leap ? 1 : 0)) return NaN;
  return Date.UTC(y, mo - 1, d, h, mi, s, ms);
}

/** ISO 8601 time → epoch ms. Times without a zone are read as UTC. */
export function parseIsoTime(s: string): { t: number; zoned: boolean } {
  let v = s.trim();
  if (!v) return { t: NaN, zoned: true };
  if (HOURS_ZONE.test(v)) v += ':00';
  const zoned = HAS_ZONE.test(v);
  return { t: Date.parse(zoned ? v : v + 'Z'), zoned };
}

function fixQuality(s: string): FixQuality | -1 {
  const v = s.trim().toLowerCase();
  if (v === 'none') return -1;
  if (v === 'dgps') return 2;
  if (v === '2d' || v === '3d' || v === 'pps') return 1;
  return 0;
}

export function parseGpx(text: string): ParsedTrack {
  const b = new ColumnBuilder();
  // Route points (<rtept>) go here. Some converters save a recorded track as
  // a route, with a time at every point; it's read as the track when the file
  // has no track points.
  const rb = new ColumnBuilder();
  let ptRoute = false;
  let rteName: string | null = null;
  let routePoints = 0;
  const stack: string[] = [];
  const flags: Flag[] = [];
  const ignored = new Set<string>();
  const problems: Problem[] = [];
  const notes: Note[] = [];
  let creator: string | null = null;
  let trkName: string | null = null;
  let pt: Point | null = null;
  let wpt: Point | null = null;
  let buf = '';
  let points = 0;
  let timeless = 0;
  let timelessWpt = 0;
  let noZone = false;
  let voidCount = 0;
  let anyKnownSpeed = false;
  let anyVendorSpeed = false;
  // How deep inside <extensions> (or a vendor container) and Garmin's
  // TrackPointExtension we are; kept as counters so no tag rescans the stack.
  let extDepth = 0;
  let garminDepth = 0;
  const isGarmin = (name: string) => name.startsWith('TrackPointExtension');
  // Each distinct tag name, looked up once per tag: what it means here (kind 1
  // for an extension container, 2 for Garmin's TrackPointExtension) and how
  // many elements of that name are open, so a close tag for one that isn't is
  // dropped at once. The scanner hands out the same string for the same name,
  // so the lookup is quick.
  const tags = new Map<string, { kind: number; open: number }>();
  const tagOf = (name: string) => {
    let g = tags.get(name);
    if (g === undefined) { g = { kind: (EXT_CONTAINERS.has(name) ? 1 : 0) | (isGarmin(name) ? 2 : 0), open: 0 }; tags.set(name, g); }
    return g;
  };

  const result = scanXml(text, {
    open(name, attrs, line) {
      stack.push(name);
      buf = '';
      const g = tagOf(name);
      g.open++;
      if (g.kind & 1) extDepth++;
      if (g.kind & 2) garminDepth++;
      if (name === 'gpx' && stack.length === 1) creator = attrs.get('creator')?.trim() || null;
      else if (name === 'trk') b.breakSegment();
      else if (name === 'trkseg') b.breakSegment();
      else if (name === 'trkpt') { pt = newPoint(attrs, line); ptRoute = false; points++; }
      else if (name === 'rte') rb.breakSegment();
      else if (name === 'rtept') { pt = newPoint(attrs, line); ptRoute = true; routePoints++; }
      // A waypoint is a child of <gpx>, or follows one whose close tag was damaged (and so is still open).
      else if (name === 'wpt' && (stack.length === 2 || stack[stack.length - 2] === 'wpt')) wpt = newPoint(attrs, line);
    },
    text(s) { buf += s; },
    close(name) {
      // Any elements left open inside the one closing close with it. Each element is pushed and popped
      // once: no rescanning the stack.
      const g = tagOf(name);
      if (!g.open) {
        // A close tag for an element that isn't open. When a plain value is open on top, one of the two
        // names was garbled ("<c#ourse>120</course>", "<ele>5</el>"): it closes that value, read under
        // whichever name is a field. Anything else it leaves open ("<ele>5</ele></el>" keeps the point).
        const top = stack[stack.length - 1];
        if (top === undefined || STRUCTURE.has(top)) return;
        const tg = tagOf(top);
        if (tg.kind) return;
        stack.pop();
        tg.open--;
        if (!POINT_FIELDS.has(name) && POINT_FIELDS.has(top)) name = top;
      } else {
        for (;;) {
          const top = stack.pop()!;
          const tg = top === name ? g : tagOf(top);
          tg.open--;
          if (tg.kind & 1) extDepth--;
          if (tg.kind & 2) garminDepth--;
          if (top === name) break;
        }
      }
      const parent = stack[stack.length - 1];
      const v = buf.trim();
      buf = '';
      const p = pt ?? wpt;
      if (name === 'trkpt' || name === 'rtept') {
        const q = pt;
        pt = null;
        if (!q) return;
        if (q.fixq === -1) { if (!ptRoute) voidCount++; return; }
        if (!Number.isFinite(q.t)) { if (!ptRoute) timeless++; return; }
        const speed = Number.isFinite(q.speedKnown) ? q.speedKnown : q.speedVendor;
        (ptRoute ? rb : b).push({
          t: q.t, lat: q.lat, lon: q.lon, ele: q.ele, hdop: q.hdop, vdop: q.vdop, pdop: q.pdop, sats: q.sats,
          fixq: q.fixq as FixQuality, geoid: q.geoid, speed, course: q.course, line: q.line,
        });
        return;
      }
      if (name === 'wpt' && wpt) {
        const w = wpt;
        wpt = null;
        if (Number.isFinite(w.t) && Number.isFinite(w.lat) && Number.isFinite(w.lon)) {
          flags.push({ n: flags.length + 1, t: w.t, lat: w.lat, lon: w.lon, name: w.name });
        } else timelessWpt++;
        return;
      }
      if (name === 'name' && parent === 'trk' && trkName === null && v) { trkName = v; return; }
      if (name === 'name' && parent === 'rte' && rteName === null && v) { rteName = v; return; }
      if (!p) return;
      const inExt = extDepth > 0;
      const garmin = garminDepth > 0;
      const direct = parent === 'trkpt' || parent === 'rtept' || parent === 'wpt';
      switch (name) {
        case 'time':
          if (direct) {
            const t = usualTime(v);
            if (t === t) p.t = t; // ends in Z: zoned
            else { const r = parseIsoTime(v); p.t = r.t; if (!r.zoned) noZone = true; }
          }
          break;
        case 'ele': if (direct) p.ele = num(v); break;
        case 'hdop': p.hdop = dop(v); break;
        case 'vdop': p.vdop = dop(v); break;
        case 'pdop': p.pdop = dop(v); break;
        case 'sat': if (direct) p.sats = num(v); break;
        case 'fix': if (direct) p.fixq = fixQuality(v); break;
        case 'geoidheight': if (direct) p.geoid = num(v); break;
        case 'name': if (direct) p.name = v || null; break;
        // Some loggers abbreviate course and speed in their extensions.
        case 'course': case 'heading': case 'crs': case 'cog': p.course = num(v); break;
        case 'speed': case 'spd': case 'sog':
          if (direct || garmin) { p.speedKnown = num(v); anyKnownSpeed = true; }
          else if (inExt) { p.speedVendor = num(v); anyVendorSpeed = true; }
          break;
        default:
          if (inExt && !POINT_FIELDS.has(name) && !g.kind && v) {
            ignored.add(IGNORED_NAMES.get(name.toLowerCase()) ?? name);
          }
      }
    },
  });

  const useRoute = b.n === 0 && rb.n > 0;
  const src = useRoute ? rb : b;
  let cols = src.build();
  if (useRoute) notes.push({ kind: 'route' });

  // A logger that repeats its last position, once a second, until it has a new one: the repeats say
  // nothing (and their speed of 0 misleads), so they go, and the step across them isn't a gap.
  let bridged: Uint8Array | undefined;
  if (repeatsLastFix(creator)) {
    const r = dropRepeats(cols);
    if (r.dropped) {
      cols = r.cols;
      bridged = r.bridged;
      notes.push({ kind: 'repeatsDropped', count: r.dropped, long: r.long });
    }
  }

  // Vendor speeds come without a unit: infer it from the positions. When the
  // positions don't settle it, the note says the unit is a guess (the user can
  // pick another on the properties page).
  if (!anyKnownSpeed && anyVendorSpeed) {
    const guess = inferSpeedUnit(cols, cols.speed);
    const f = UNIT_FACTOR[guess.unit];
    for (let i = 0; i < cols.n; i++) cols.speed[i] = cols.speed[i] / f;
    notes.push(guess.confident ? { kind: 'speedUnit', unit: guess.unit, inferred: true } : { kind: 'speedUnit', unit: guess.unit, inferred: true, unsure: true });
  } else if (anyKnownSpeed) {
    notes.push({ kind: 'speedUnit', unit: 'ms', inferred: false });
  }

  if (!result.wellFormed) problems.push({ kind: 'badXml', line: result.line, kept: cols.n });
  else if (!result.complete || stack.length > 0) problems.push({ kind: 'unclosed', kept: cols.n });
  if (src.counts.backwards) problems.push({ kind: 'backwards', count: src.counts.backwards, line: src.counts.backwardsLine });
  if (src.counts.jumps) problems.push({ kind: 'jump', count: src.counts.jumps, line: src.counts.jumpLine });
  if (cols.n === 0) problems.push({ kind: 'noFixes' });

  if (noZone) notes.push({ kind: 'noZone' });
  const noPosition = voidCount + src.counts.noPosition;
  if (noPosition) notes.push({ kind: 'void', count: noPosition });
  if (timeless) notes.push({ kind: 'timeless', count: timeless });
  if (src.counts.duplicates) notes.push({ kind: 'duplicates', count: src.counts.duplicates });
  if (timelessWpt) notes.push({ kind: 'timelessWaypoints', count: timelessWpt });
  if (ignored.size) notes.push({ kind: 'ignored', fields: [...ignored].sort() });

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
  if (flags.length) fields.push('flags');

  return {
    format: 'gpx', creator, name: useRoute ? rteName : trkName, cols, flags, problems, notes, fields, lines: useRoute ? routePoints : points,
    ...(noZone ? { clock: 'utc' } : {}), ...(bridged ? { bridged } : {}),
  };
}

/**
 * Loggers known to repeat their last position, once a second, while they have
 * no new one (they keep writing satellites, HDOP and a speed of 0 with it),
 * known by the creator their software writes into the file. Other loggers'
 * repeats are the logger standing still, and stay.
 */
export function repeatsLastFix(creator: string | null): boolean {
  return creator !== null && /igotu/i.test(creator);
}

/** A stretch of dropped repeats up to this long (ms) is crossed in a straight line; a longer one is a gap. */
export const BRIDGE_MS = 120_000;

/**
 * Drops each fix that repeats the position of the fix before it. The fix that
 * follows dropped repeats is marked bridged (its step isn't a gap) when the
 * stretch is at most BRIDGE_MS and no new segment starts in it; `long` counts
 * the stretches too long to cross.
 */
export function dropRepeats(c: Columns): { cols: Columns; bridged: Uint8Array; dropped: number; long: number } {
  const n = c.n, keep = new Uint8Array(n), mark = new Uint8Array(n);
  let k = 0, last = -1, dropped = 0, long = 0, segAhead = 0, skipped = false;
  for (let i = 0; i < n; i++) {
    if (last >= 0 && c.lat[i] === c.lat[last] && c.lon[i] === c.lon[last]) {
      dropped++;
      skipped = true;
      segAhead |= c.seg[i]; // a segment starting among the repeats starts at the next fix kept
      continue;
    }
    keep[i] = 1;
    if (segAhead) c.seg[i] = 1;
    if (skipped && !c.seg[i]) { if (c.t[i] - c.t[last] <= BRIDGE_MS) mark[k] = 1; else long++; }
    segAhead = 0;
    skipped = false;
    last = i;
    k++;
  }
  return { cols: dropped ? keepFixes(c, keep, k) : c, bridged: mark.slice(0, k), dropped, long };
}
