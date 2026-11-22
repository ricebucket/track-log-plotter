import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseText } from '../../src/parse/index';
import type { LoadedTrack } from '../../src/model/types';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const FIXTURES = join(ROOT, 'tests', 'fixtures');

export function fixture(name: string): string {
  return readFileSync(join(FIXTURES, name), 'utf8');
}

export function fixtureNames(): string[] {
  return readdirSync(FIXTURES).sort();
}

/** Parses a fixture and fails loudly when it doesn't load. */
export function load(name: string): LoadedTrack {
  const r = parseText(fixture(name), name);
  if (!r.ok) throw new Error(`${name} did not load: ${r.error}`);
  return r.track;
}

/** New York City, as used by the privacy guard. */
export const NYC = { south: 40.49, north: 40.92, west: -74.27, east: -73.68 };
