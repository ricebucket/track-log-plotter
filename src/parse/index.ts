import type { Format, LoadedTrack, ParsedTrack, ParseResult } from '../model/types';
import { derive, gapSummary } from '../derive/derive';
import { parseGpx } from './gpx';
import { parseNmea } from './nmea';

/** Largest file the app will read (bytes). */
export const MAX_BYTES = 300 * 1024 * 1024;

const NMEA_LINE = /^\s*\$(GP|GN|GL|GA|GB|BD|GQ|GI)[A-Z]{3},/m;

/** Decides the format from the content, falling back to the file extension. */
export function detectFormat(text: string, file: string): Format | null {
  const head = text.slice(0, 4096);
  if (/<gpx[\s>]/.test(head)) return 'gpx';
  if (NMEA_LINE.test(head)) return 'nmea';
  const ext = file.toLowerCase().split('.').pop() ?? '';
  if (ext === 'gpx' && head.includes('<')) return 'gpx';
  if (['nmea', 'nma', 'log', 'txt'].includes(ext) && head.includes('$')) return 'nmea';
  return null;
}

export function parseText(text: string, file: string, sizeBytes = text.length): ParseResult {
  if (sizeBytes > MAX_BYTES) return { ok: false, file, error: 'tooBig' };
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  if (!src.trim()) return { ok: false, file, error: 'empty' };
  const format = detectFormat(src, file);
  if (!format) return { ok: false, file, error: 'unknownFormat' };
  const parsed = format === 'gpx' ? parseGpx(src) : parseNmea(src);
  if (parsed.cols.n === 0) return { ok: false, file, error: 'empty' };
  checkPlaceholders(parsed);
  const derived = derive(parsed);
  if (derived.hdopRelative) parsed.notes.push({ kind: 'hdopRelative' });
  if (!derived.speedFromFile) parsed.notes.push({ kind: 'speedDerived' });
  const g = gapSummary(parsed.cols, derived.gap);
  if (g.count) parsed.notes.push({ kind: 'gaps', count: g.count, longestS: g.longestS });
  const track: LoadedTrack = { ...parsed, file, sizeBytes, derived };
  return { ok: true, track };
}

/**
 * Values some loggers write when they have none: an elevation that is 0 at
 * every fix, and fixes that report 0 satellites (often repeating the previous
 * position). The first is dropped; the second is kept, since it says something
 * about the logger, and noted.
 */
export function checkPlaceholders(p: ParsedTrack) {
  const c = p.cols;
  let withEle = 0, nonZero = 0;
  for (let i = 0; i < c.n; i++) if (Number.isFinite(c.ele[i])) { withEle++; if (c.ele[i] !== 0) nonZero++; }
  if (withEle > 10 && nonZero === 0) {
    c.ele.fill(NaN);
    p.fields = p.fields.filter((f) => f !== 'ele');
    p.notes.push({ kind: 'eleZero' });
  }
  let zero = 0, stale = 0;
  for (let i = 0; i < c.n; i++) {
    if (c.sats[i] !== 0) continue;
    zero++;
    if (i > 0 && c.lat[i] === c.lat[i - 1] && c.lon[i] === c.lon[i - 1]) stale++;
  }
  if (zero) p.notes.push({ kind: 'zeroSats', count: zero, stale });
}

/** Typed-array buffers in a result, so the worker can transfer instead of copy. */
export function transferables(r: ParseResult): ArrayBuffer[] {
  if (!r.ok) return [];
  const out = new Set<ArrayBuffer>();
  const add = (o: object) => {
    for (const v of Object.values(o)) if (ArrayBuffer.isView(v)) out.add(v.buffer as ArrayBuffer);
  };
  add(r.track.cols);
  add(r.track.derived);
  return [...out];
}
