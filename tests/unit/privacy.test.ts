// Privacy guard: the repo is public, so every coordinate it ships must be
// synthetic and inside New York City, and personal logs must stay out of it.
// The one exception is the synthetic Stanford drive the user asked for: its
// fixtures and its own test may lie at Stanford instead.
//
// Every text file git would commit is read as text, the fixtures and the
// sample tracks too, so a position counts even where the app's readers leave
// it out: a waypoint without a time, a file's bounds, a skipped line. The
// scan reads each way the repo writes a coordinate:
//   - by name: lat="40.78" lon="-73.96" (GPX, and minlat/maxlon in its
//     bounds), lat: 40.78 or "lon": -73.96 (code, JSON), lat = 40.78;
//   - NMEA: 4046.80,N,07357.60,W;
//   - with N/S/E/W letters: 40.78N,73.96W (the older Columbus Fusion layout), 40.78° N;
//   - number pairs with 2 or more decimals: 40.78, -73.96, or [-73.96, 40.78].
import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { basename, join, relative } from 'node:path';
import { NYC, ROOT, STANFORD, STANFORD_FIXTURE, STANFORD_TEST, fixtureNames, load } from '../helpers/fixtures';
import { parseText } from '../../src/parse/index';
import { nmeaChecksum } from '../../src/parse/nmea';

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (['node_modules', 'dist', '.git', 'local-tracks', 'track-generator', 'coverage', 'playwright-report', 'test-results'].includes(name)) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

type Box = typeof NYC;
const inside = (b: Box, lat: number, lon: number) => lat >= b.south && lat <= b.north && lon >= b.west && lon <= b.east;

/** Inside New York City, or at Stanford where that's allowed. */
function expectInsideNyc(lat: number, lon: number, where: string, stanfordOk = false) {
  if (inside(NYC, lat, lon) || (stanfordOk && inside(STANFORD, lat, lon))) return;
  throw new Error(`${where}: ${lat}, ${lon} is outside New York City${stanfordOk ? ' and Stanford' : ''}`);
}

/** A coordinate written in a text. A latitude or longitude named on its own leaves the other NaN. */
interface Found { how: 'name' | 'NMEA' | 'letters' | 'pair'; lat: number; lon: number; at: number; text: string }

const NUM = String.raw`[-+]?\d{1,3}(?:\.\d+)?(?![\d.])`;
const NAMED = new RegExp(String.raw`\b(min|max)?(lat|latitude|lon|lng|longitude)\b["']?\s*[:=]\s*["']?(${NUM})`, 'gi');
const NMEA = /(?<![\d.])(\d{1,2})(\d{2}\.\d+),([NS]),(\d{1,3})(\d{2}\.\d+),([EW])/g;
const LETTERS = /(?<![\d.])(\d{1,2}(?:\.\d+)?)\s*°?\s*([NS])\s*,\s*(\d{1,3}(?:\.\d+)?)\s*°?\s*([EW])(?![a-z\d])/gi;
const PAIR = /(?<![\d.])([-+]?\d{1,3})\.(\d{2,})\s*,\s*([-+]?\d{1,3})\.(\d{2,})(?![\d.])/g;
/** An NMEA sentence: its positions are read as NMEA, and its other numbers (DOPs, speeds) aren't pairs. */
const SENTENCE = /\$[A-Z]{5},[^\s'"`]*/g;

/** Every coordinate in a text, in each notation the scan reads. */
function coordinates(text: string): Found[] {
  const out: Found[] = [];
  // By name: a latitude and a longitude side by side (either first, with the same min/max) are one coordinate.
  const named = [...text.matchAll(NAMED)].map((m) => ({ pre: (m[1] ?? '').toLowerCase(), isLat: /^lat/i.test(m[2]), v: Number(m[3]), at: m.index, end: m.index + m[0].length }));
  for (let k = 0; k < named.length; k++) {
    const a = named[k], b = named[k + 1];
    if (b && a.isLat !== b.isLat && a.pre === b.pre && b.at - a.at < 200) {
      out.push({ how: 'name', lat: a.isLat ? a.v : b.v, lon: a.isLat ? b.v : a.v, at: a.at, text: text.slice(a.at, b.end) });
      k++;
    } else out.push({ how: 'name', lat: a.isLat ? a.v : NaN, lon: a.isLat ? NaN : a.v, at: a.at, text: text.slice(a.at, a.end) });
  }
  for (const m of text.matchAll(NMEA)) {
    const lat = (Number(m[1]) + Number(m[2]) / 60) * (m[3] === 'S' ? -1 : 1), lon = (Number(m[4]) + Number(m[5]) / 60) * (m[6] === 'W' ? -1 : 1);
    out.push({ how: 'NMEA', lat, lon, at: m.index, text: m[0] });
  }
  for (const m of text.matchAll(LETTERS)) {
    out.push({ how: 'letters', lat: Number(m[1]) * (/s/i.test(m[2]) ? -1 : 1), lon: Number(m[3]) * (/w/i.test(m[4]) ? -1 : 1), at: m.index, text: m[0] });
  }
  for (const m of text.replace(SENTENCE, (s) => ' '.repeat(s.length)).matchAll(PAIR)) {
    const a = Number(`${m[1]}.${m[2]}`), b = Number(`${m[3]}.${m[4]}`);
    // Two small numbers with few decimals are readings (DOPs, g, shares), not a place: 0.05, 0.12.
    if (Math.abs(a) < 10 && Math.abs(b) < 10 && (m[2].length < 4 || m[4].length < 4)) continue;
    out.push({ how: 'pair', lat: a, lon: b, at: m.index, text: m[0] });
  }
  return out;
}

/** Whether a coordinate (or the half of one named on its own) lies in the box. */
const within = (b: Box, lat: number, lon: number) =>
  (Number.isNaN(lat) || (lat >= b.south && lat <= b.north)) && (Number.isNaN(lon) || (lon >= b.west && lon <= b.east));
/** Not a place: off the Earth, or 0, 0, which a logger writes when it has no fix (the readers' tests use both). */
const nowhere = (lat: number, lon: number) => Math.abs(lat) > 90 || Math.abs(lon) > 180 || ((lat === 0 || Number.isNaN(lat)) && (lon === 0 || Number.isNaN(lon)));

/** The coordinates outside New York City (and outside Stanford, where that's allowed). */
function strays(found: Found[], stanfordOk = false): Found[] {
  return found.filter((c) => {
    // A pair may be latitude first or longitude first (GeoJSON).
    const places = (c.how === 'pair' ? [[c.lat, c.lon], [c.lon, c.lat]] : [[c.lat, c.lon]]).filter(([lat, lon]) => !nowhere(lat, lon));
    return places.length > 0 && !places.some(([lat, lon]) => within(NYC, lat, lon) || (stanfordOk && within(STANFORD, lat, lon))
      // Code that writes NMEA keeps its longitude unsigned, the W going after it: lon = 73.97.
      || (c.how === 'name' && within(NYC, lat, -lon)));
  });
}

/** Every file git would commit: the ones it tracks, and new ones it doesn't ignore. */
function committable(): string[] {
  return execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], { cwd: ROOT, encoding: 'utf8' }).split('\0').filter(Boolean);
}

/** A file's text, or null when it isn't text (not UTF-8: images, videos). The NUL bytes the older Fusion layout pads its fields with are dropped. */
function textOf(bytes: Uint8Array): string | null {
  try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes).replaceAll('\0', ''); } catch { return null; }
}

const lineAt = (text: string, at: number) => text.slice(0, at).split('\n').length;

// Places to plant in each notation, worked out here rather than written out so
// this file doesn't trip its own scan: one in New York City, one at Stanford,
// one just south of the Stanford box, and one in the Atlantic.
type Place = { lat: number; lon: number };
const nyc: Place = { lat: (NYC.south + NYC.north) / 2, lon: (NYC.west + NYC.east) / 2 };
const stanford: Place = { lat: (STANFORD.south + STANFORD.north) / 2, lon: (STANFORD.west + STANFORD.east) / 2 };
const southOfStanford: Place = { lat: STANFORD.south - 0.07, lon: STANFORD.east + 0.25 };
const atSea: Place = { lat: NYC.south - 5, lon: NYC.east + 20 };

const hemi = (v: number, pos: string, neg: string) => (v < 0 ? neg : pos);
/** Degrees and minutes, as NMEA writes them: ddmm.mmmm (latitude) or dddmm.mmmm (longitude). */
const ddmm = (v: number, digits: number) => {
  const a = Math.abs(v), d = Math.floor(a);
  return String(d).padStart(digits, '0') + ((a - d) * 60).toFixed(4).padStart(7, '0');
};
/** An NMEA RMC sentence at second i, with its checksum, or with a wrong one. */
function rmc(p: Place, i: number, wrongSum = false): string {
  const body = `GPRMC,1300${String(i).padStart(2, '0')}.00,A,${ddmm(p.lat, 2)},${hemi(p.lat, 'N', 'S')},${ddmm(p.lon, 3)},${hemi(p.lon, 'E', 'W')},0.5,90.0,140626,,,A`;
  const sum = nmeaChecksum(body);
  return `$${body}*${wrongSum ? (sum === '00' ? '01' : '00') : sum}`;
}
const letters = (p: Place, gap = '') => `${Math.abs(p.lat).toFixed(6)}${gap}${hemi(p.lat, 'N', 'S')},${Math.abs(p.lon).toFixed(6)}${gap}${hemi(p.lon, 'E', 'W')}`;

/** One place written in each notation the scan reads. */
const NOTATIONS: Record<string, (p: Place) => string> = {
  'a GPX fix': (p) => `<trkpt lat="${p.lat.toFixed(6)}" lon="${p.lon.toFixed(6)}"><time>2026-06-14T13:00:00Z</time></trkpt>`,
  'GPX bounds': (p) => `<bounds minlat="${p.lat.toFixed(4)}" minlon="${p.lon.toFixed(4)}" maxlat="${(p.lat + 0.01).toFixed(4)}" maxlon="${(p.lon + 0.01).toFixed(4)}"/>`,
  'attributes without quotes': (p) => `<wpt lon=${p.lon.toFixed(5)} lat=${p.lat.toFixed(5)}>`,
  'an object literal': (p) => `{ t: 0, lat: ${p.lat.toFixed(4)}, lon: ${p.lon.toFixed(4)}, ele: 12 }`,
  'JSON': (p) => JSON.stringify({ latitude: p.lat, longitude: p.lon }),
  'assignments': (p) => `const lat = ${p.lat.toFixed(4)}, lng = ${p.lon.toFixed(4)};`,
  'a latitude on its own': (p) => `{ lat: ${p.lat.toFixed(4)}, t: 0 }`,
  'an NMEA sentence': (p) => rmc(p, 0),
  'a row with N/S/E/W letters': (p) => `1,T,260614,130500,${letters(p)},25,10,90`,
  'degrees and letters': (p) => `${Math.abs(p.lat).toFixed(2)}° ${hemi(p.lat, 'N', 'S')}, ${Math.abs(p.lon).toFixed(2)}° ${hemi(p.lon, 'E', 'W')}`,
  'a pair with 2 decimals': (p) => `near ${p.lat.toFixed(2)}, ${p.lon.toFixed(2)}`,
  'a GeoJSON pair': (p) => `"coordinates": [${p.lon.toFixed(5)}, ${p.lat.toFixed(5)}]`,
  'a Columbus Fusion row': (p) => `T,260614,130500,${p.lat.toFixed(7)},${p.lon.toFixed(7)},25.0,18.0,90.0,0.05,0.12,0.99`,
};

describe('privacy guard', () => {
  it('every fixture fix and button press lies inside New York City, or at Stanford for the drive', () => {
    let checked = 0;
    for (const name of fixtureNames()) {
      const tr = load(name);
      const ok = STANFORD_FIXTURE.test(name);
      for (let i = 0; i < tr.cols.n; i++) { expectInsideNyc(tr.cols.lat[i], tr.cols.lon[i], `${name} fix ${i}`, ok); checked++; }
      for (const f of tr.flags) { expectInsideNyc(f.lat, f.lon, `${name} flag ${f.n}`, ok); checked++; }
    }
    expect(checked).toBeGreaterThan(5000);
  });

  it('allows Stanford only for the drive: anywhere else it fails', () => {
    expect(() => expectInsideNyc(stanford.lat, stanford.lon, 'a drive fix', true)).not.toThrow();
    expect(() => expectInsideNyc(stanford.lat, stanford.lon, 'another fixture')).toThrow(/outside New York City/);
    expect(() => expectInsideNyc(southOfStanford.lat, southOfStanford.lon, 'south of the box', true)).toThrow(/outside New York City and Stanford/);
  });

  it('every fix in the sample tracks lies inside New York City', () => {
    const dir = join(ROOT, 'public', 'sample');
    for (const name of readdirSync(dir)) {
      const r = parseText(readFileSync(join(dir, name), 'utf8'), name);
      expect(r.ok).toBe(true);
      if (!r.ok) continue;
      for (let i = 0; i < r.track.cols.n; i++) expectInsideNyc(r.track.cols.lat[i], r.track.cols.lon[i], `${name} fix ${i}`);
    }
  });

  it('every coordinate in every file git would commit lies inside New York City, or at Stanford for the drive', () => {
    const bad: string[] = [];
    let files = 0, checked = 0;
    for (const f of committable()) {
      let text: string | null;
      try { text = textOf(readFileSync(join(ROOT, f))); } catch { continue; } // deleted, not yet committed
      if (text === null) continue;
      files++;
      const stanfordOk = f === STANFORD_TEST || (f.startsWith('tests/fixtures/') && STANFORD_FIXTURE.test(basename(f)));
      const found = coordinates(text);
      checked += found.length;
      for (const c of strays(found, stanfordOk)) bad.push(`${f}:${lineAt(text, c.at)}: ${c.text.replace(/\s+/g, ' ').slice(0, 100)} (${c.how})`);
    }
    expect(bad).toEqual([]);
    // The fixtures and the sample tracks were read too, fix by fix.
    expect(files).toBeGreaterThan(100);
    expect(checked).toBeGreaterThan(10_000);
  });

  it('keeps the track generators out of git: only the tracks they write are committed', () => {
    const ignore = readFileSync(join(ROOT, '.gitignore'), 'utf8').split('\n').map((l) => l.trim());
    expect(ignore).toContain('track-generator/');
  });

  it('keeps local-tracks/ out of git, the app and the scripts', () => {
    const ignore = readFileSync(join(ROOT, '.gitignore'), 'utf8').split('\n').map((l) => l.trim());
    expect(ignore).toContain('local-tracks/');
    // Only the test helper that finds your own logs may name the folder.
    const allowed = new Set(['tests/helpers/own-logs.ts', 'tests/unit/privacy.test.ts']);
    const code = walk(join(ROOT, 'src')).concat(walk(join(ROOT, 'tests')), walk(join(ROOT, 'scripts')));
    for (const f of code) {
      if (allowed.has(relative(ROOT, f))) continue;
      expect(readFileSync(f, 'utf8'), relative(ROOT, f)).not.toMatch(/local-tracks/);
    }
  });
});

describe('the coordinate scan', () => {
  it('finds a place in each notation, and fails it outside New York City', () => {
    for (const [name, write] of Object.entries(NOTATIONS)) {
      expect(coordinates(write(nyc)), name).not.toEqual([]);
      expect(strays(coordinates(write(nyc))), name).toEqual([]);
      expect(strays(coordinates(write(atSea))).length, name).toBeGreaterThan(0);
    }
  });

  it('allows Stanford only where the drive is: anywhere else, and just outside the box, it fails', () => {
    for (const [name, write] of Object.entries(NOTATIONS)) {
      expect(strays(coordinates(write(stanford)), true), name).toEqual([]);
      expect(strays(coordinates(write(stanford))).length, name).toBeGreaterThan(0);
      expect(strays(coordinates(write(southOfStanford)), true).length, name).toBeGreaterThan(0);
    }
  });

  it("reads what the app's readers leave out: a waypoint without a time, the bounds, a sentence that fails its checksum", () => {
    // A GPX file whose fixes all lie in New York City, with its bounds and a waypoint without a time in the Atlantic.
    const fixes = Array.from({ length: 30 }, (_, i) => NOTATIONS['a GPX fix']({ lat: nyc.lat + i * 1e-4, lon: nyc.lon }).replace('13:00:00', `13:00:${String(i).padStart(2, '0')}`));
    const gpx = `<?xml version="1.0"?><gpx version="1.1" creator="t" xmlns="http://www.topografix.com/GPX/1/1"><metadata>${NOTATIONS['GPX bounds'](atSea)}</metadata>`
      + `<wpt lat="${atSea.lat.toFixed(5)}" lon="${atSea.lon.toFixed(5)}"><name>home</name></wpt><trk><trkseg>${fixes.join('\n')}</trkseg></trk></gpx>`;
    // An NMEA log in New York City with a sentence from the Atlantic that fails its checksum.
    const sentences = Array.from({ length: 30 }, (_, i) => rmc({ lat: nyc.lat + i * 1e-4, lon: nyc.lon }, i));
    sentences.splice(15, 0, rmc(atSea, 15, true));
    const nmea = sentences.join('\n');
    for (const [file, text, left] of [['walk.gpx', gpx, 3], ['walk.nmea', nmea, 1]] as const) {
      const r = parseText(text, file);
      expect(r.ok, file).toBe(true);
      if (!r.ok) continue;
      // What the reader keeps is all in New York City…
      expect(r.track.cols.n, file).toBe(30);
      for (let i = 0; i < r.track.cols.n; i++) expectInsideNyc(r.track.cols.lat[i], r.track.cols.lon[i], `${file} fix ${i}`);
      // …but the scan reads the text, and finds the rest.
      expect(strays(coordinates(text)), file).toHaveLength(left);
    }
  });

  it('reads a file padded with NUL bytes as text, and skips only files that are not text', () => {
    const padded = `1\0\0,T\0,260614,130500,${letters(atSea, '\0\0\0')},25\0\0`;
    const text = textOf(new TextEncoder().encode(padded));
    expect(text).not.toBeNull();
    expect(strays(coordinates(text!))).toHaveLength(1);
    expect(textOf(Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]))).toBeNull();
  });

  it('passes what is not a place: positions off the Earth, 0, 0, readings, and an unsigned west longitude for NMEA', () => {
    expect(strays(coordinates(rmc({ lat: 0, lon: 0 }, 0)))).toEqual([]);
    expect(strays(coordinates(NOTATIONS['a GPX fix']({ lat: 95.5, lon: nyc.lon })))).toEqual([]);
    expect(strays(coordinates('$GNGSA,A,3,02,05,07,09,13,15,18,20,,,,,12.19,11.29,5.67,1*0D'))).toEqual([]);
    expect(strays(coordinates(['ax', 'ay'].map((k, i) => `${k}: [${(0.05 + i).toFixed(2)}, ${(0.12 + i).toFixed(2)}]`).join('\n')))).toEqual([]);
    expect(strays(coordinates(`const lat = ${nyc.lat.toFixed(4)}, lon = ${(-nyc.lon).toFixed(4)};`))).toEqual([]);
    // A latitude and longitude far apart are each checked on their own.
    expect(strays(coordinates(`{ lat: ${atSea.lat.toFixed(4)}${' '.repeat(300)}lon: ${nyc.lon.toFixed(4)} }`))).toHaveLength(1);
  });
});
