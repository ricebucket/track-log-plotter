import type { FieldKey, Flag, FixQuality, Note, ParsedTrack, Problem } from '../model/types';
import { ColumnBuilder, present } from './columns';
import { scanXml } from './xml';
import { inferSpeedUnit, UNIT_FACTOR } from './units';

/** Readable names for extension fields the app doesn't use. */
const IGNORED_NAMES: Record<string, string> = {
  hr: 'heartRate', heartrate: 'heartRate', cad: 'cadence', cadence: 'cadence', atemp: 'temperature',
  wtemp: 'temperature', temp: 'temperature', temperature: 'temperature', power: 'power', depth: 'depth',
  distance: 'distance', satinview: 'satsInView', satsinview: 'satsInView', sats_in_view: 'satsInView',
  sat_view: 'satsInView', satview: 'satsInView',
};

const POINT_FIELDS = new Set(['ele', 'time', 'hdop', 'vdop', 'pdop', 'sat', 'fix', 'geoidheight', 'speed', 'spd', 'sog', 'course', 'crs', 'cog', 'heading', 'name', 'sym', 'type', 'desc', 'cmt', 'src', 'link', 'magvar', 'ageofdgpsdata', 'dgpsid', 'extensions', 'text']);

/** A dilution of precision of 0 is a placeholder: real values are never below about 0.5. */
const dop = (v: string) => { const x = Number(v); return x > 0 ? x : NaN; };
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
    lat: Number(attrs.get('lat')), lon: Number(attrs.get('lon')), line, t: NaN, ele: NaN, hdop: NaN, vdop: NaN,
    pdop: NaN, sats: NaN, fixq: 0, geoid: NaN, speedKnown: NaN, speedVendor: NaN, course: NaN, name: null,
  };
}

const HAS_ZONE = /(Z|[+-]\d\d:?\d\d)$/i;

/** ISO 8601 time → epoch ms. Times without a zone are read as UTC. */
export function parseIsoTime(s: string): { t: number; zoned: boolean } {
  const v = s.trim();
  if (!v) return { t: NaN, zoned: true };
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

  const result = scanXml(text, {
    open(name, attrs, line) {
      stack.push(name);
      buf = '';
      if (name === 'gpx' && stack.length === 1) creator = attrs.get('creator')?.trim() || null;
      else if (name === 'trk') b.breakSegment();
      else if (name === 'trkseg') b.breakSegment();
      else if (name === 'trkpt') { pt = newPoint(attrs, line); points++; }
      else if (name === 'wpt' && stack.length === 2) wpt = newPoint(attrs, line);
    },
    text(s) { buf += s; },
    close(name) {
      const top = stack.pop();
      if (top !== name) {
        // Mismatched tag: recover by unwinding to the matching open tag.
        const at = stack.lastIndexOf(name);
        if (at >= 0) stack.length = at;
      }
      const parent = stack[stack.length - 1];
      const v = buf.trim();
      buf = '';
      const p = pt ?? wpt;
      if (name === 'trkpt') {
        const q = pt;
        pt = null;
        if (!q) return;
        if (q.fixq === -1) { voidCount++; return; }
        if (!Number.isFinite(q.t)) { timeless++; return; }
        const speed = Number.isFinite(q.speedKnown) ? q.speedKnown : q.speedVendor;
        b.push({
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
      if (!p) return;
      const inExt = stack.some((s) => EXT_CONTAINERS.has(s));
      const garmin = stack.some((s) => s.startsWith('TrackPointExtension'));
      const direct = parent === 'trkpt' || parent === 'wpt';
      switch (name) {
        case 'time': if (direct) { const r = parseIsoTime(v); p.t = r.t; if (!r.zoned) noZone = true; } break;
        case 'ele': if (direct) p.ele = Number(v); break;
        case 'hdop': p.hdop = dop(v); break;
        case 'vdop': p.vdop = dop(v); break;
        case 'pdop': p.pdop = dop(v); break;
        case 'sat': if (direct) p.sats = Number(v); break;
        case 'fix': if (direct) p.fixq = fixQuality(v); break;
        case 'geoidheight': if (direct) p.geoid = Number(v); break;
        case 'name': if (direct) p.name = v || null; break;
        // Some loggers abbreviate course and speed in their extensions.
        case 'course': case 'heading': case 'crs': case 'cog': p.course = Number(v); break;
        case 'speed': case 'spd': case 'sog':
          if (direct || garmin) { p.speedKnown = Number(v); anyKnownSpeed = true; }
          else if (inExt) { p.speedVendor = Number(v); anyVendorSpeed = true; }
          break;
        default:
          if (inExt && !POINT_FIELDS.has(name) && !EXT_CONTAINERS.has(name) && !name.startsWith('TrackPointExtension') && v) {
            ignored.add(IGNORED_NAMES[name.toLowerCase()] ?? name);
          }
      }
    },
  });

  const cols = b.build();

  // Vendor speeds come without a unit: infer it from the positions.
  if (!anyKnownSpeed && anyVendorSpeed) {
    const guess = inferSpeedUnit(cols, cols.speed);
    const f = UNIT_FACTOR[guess.unit];
    for (let i = 0; i < cols.n; i++) cols.speed[i] = cols.speed[i] / f;
    notes.push({ kind: 'speedUnit', unit: guess.unit, inferred: true });
  } else if (anyKnownSpeed) {
    notes.push({ kind: 'speedUnit', unit: 'ms', inferred: false });
  }

  if (!result.wellFormed) problems.push({ kind: 'badXml', line: result.line, kept: cols.n });
  else if (!result.complete || stack.length > 0) problems.push({ kind: 'unclosed', kept: cols.n });
  if (b.counts.backwards) problems.push({ kind: 'backwards', count: b.counts.backwards, line: b.counts.backwardsLine });
  if (b.counts.jumps) problems.push({ kind: 'jump', count: b.counts.jumps, line: b.counts.jumpLine });
  if (cols.n === 0) problems.push({ kind: 'noFixes' });

  if (noZone) notes.push({ kind: 'noZone' });
  if (voidCount) notes.push({ kind: 'void', count: voidCount });
  if (timeless) notes.push({ kind: 'void', count: timeless });
  if (b.counts.duplicates) notes.push({ kind: 'duplicates', count: b.counts.duplicates });
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

  return { format: 'gpx', creator, name: trkName, cols, flags, problems, notes, fields, lines: points };
}
