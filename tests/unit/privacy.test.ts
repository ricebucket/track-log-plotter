// Privacy guard: the repo is public, so every coordinate it ships must be
// synthetic and inside New York City, and personal logs must stay out of it.
// The one exception is the synthetic Stanford drive the user asked for: its
// fixtures and its own test may lie at Stanford instead.
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { FIXTURES, NYC, ROOT, STANFORD, STANFORD_FIXTURE, STANFORD_TEST, fixtureNames, load } from '../helpers/fixtures';
import { parseText } from '../../src/parse/index';

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
    expect(() => expectInsideNyc(37.425, -122.163, 'a drive fix', true)).not.toThrow();
    expect(() => expectInsideNyc(37.425, -122.163, 'another fixture')).toThrow(/outside New York City/);
    expect(() => expectInsideNyc(37.33, -121.89, 'south of the box', true)).toThrow(/outside New York City and Stanford/);
  });

  it('every sample-ride fix lies inside New York City', () => {
    const dir = join(ROOT, 'public', 'sample');
    for (const name of readdirSync(dir)) {
      const r = parseText(readFileSync(join(dir, name), 'utf8'), name);
      expect(r.ok).toBe(true);
      if (!r.ok) continue;
      for (let i = 0; i < r.track.cols.n; i++) expectInsideNyc(r.track.cols.lat[i], r.track.cols.lon[i], `${name} fix ${i}`);
    }
  });

  it('every coordinate-looking pair in the source and tests lies inside New York City', () => {
    const files = walk(ROOT).filter((p) => /\.(ts|tsx|mjs|js|json|html|md)$/.test(p) && !p.startsWith(FIXTURES));
    const pair = /(-?\d{1,3}\.\d{4,})\s*,\s*(-?\d{1,3}\.\d{4,})/g;
    let checked = 0;
    for (const f of files) {
      const text = readFileSync(f, 'utf8');
      for (const m of text.matchAll(pair)) {
        const a = Number(m[1]), b = Number(m[2]);
        // lat, lon order and lon, lat order both appear (GeoJSON is lon, lat).
        const latLon = Math.abs(a) <= 90 && a > 0 ? [a, b] : [b, a];
        if (Math.abs(latLon[0]) > 90 || Math.abs(latLon[1]) > 180) continue;
        expectInsideNyc(latLon[0], latLon[1], relative(ROOT, f), relative(ROOT, f) === STANFORD_TEST);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(10);
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
