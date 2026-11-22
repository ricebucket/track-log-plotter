// Privacy guard: the repo is public, so every coordinate it ships must be
// synthetic and inside New York City, and personal logs must stay out of it.
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { FIXTURES, NYC, ROOT, fixtureNames, load } from '../helpers/fixtures';
import { parseText } from '../../src/parse/index';

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (['node_modules', 'dist', '.git', 'local-tracks', 'coverage', 'playwright-report', 'test-results'].includes(name)) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

function expectInsideNyc(lat: number, lon: number, where: string) {
  const ok = lat >= NYC.south && lat <= NYC.north && lon >= NYC.west && lon <= NYC.east;
  if (!ok) throw new Error(`${where}: ${lat}, ${lon} is outside New York City`);
}

describe('privacy guard', () => {
  it('every fixture fix and button press lies inside New York City', () => {
    let checked = 0;
    for (const name of fixtureNames()) {
      const tr = load(name);
      for (let i = 0; i < tr.cols.n; i++) { expectInsideNyc(tr.cols.lat[i], tr.cols.lon[i], `${name} fix ${i}`); checked++; }
      for (const f of tr.flags) { expectInsideNyc(f.lat, f.lon, `${name} flag ${f.n}`); checked++; }
    }
    expect(checked).toBeGreaterThan(5000);
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
        expectInsideNyc(latLon[0], latLon[1], relative(ROOT, f));
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(10);
  });

  it('keeps local-tracks/ out of git and out of the code', () => {
    const ignore = readFileSync(join(ROOT, '.gitignore'), 'utf8').split('\n').map((l) => l.trim());
    expect(ignore).toContain('local-tracks/');
    const code = walk(join(ROOT, 'src')).concat(walk(join(ROOT, 'tests')), walk(join(ROOT, 'scripts')));
    for (const f of code) {
      if (f.endsWith('privacy.test.ts')) continue;
      expect(readFileSync(f, 'utf8'), relative(ROOT, f)).not.toMatch(/local-tracks/);
    }
  });
});
