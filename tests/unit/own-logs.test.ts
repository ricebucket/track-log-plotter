// Reads your own logs with the same code as the app, when you keep some in
// the git-ignored folder for them (see tests/helpers/own-logs.ts). Every check
// reports counts, never a coordinate.
import { describe, expect, it } from 'vitest';
import { readFileSync, statSync } from 'node:fs';
import { localLogs, localName } from '../helpers/own-logs';
import { detectFormat, MAX_BYTES, parseText } from '../../src/parse/index';
import { buildScale } from '../../src/color/scale';
import { addTracks, measuresOf } from '../../src/state/logic';
import { buildFixPoints, buildGaps, buildPaths, buildRuns } from '../../src/map/geojson';
import type { LoadedTrack, MeasureKey } from '../../src/model/types';

const files = localLogs();

/** How many numbers in a list are infinite (NaN is fine: it means "not recorded"). */
function infinite(a: ArrayLike<number>): number {
  let n = 0;
  for (let i = 0; i < a.length; i++) if (a[i] === Infinity || a[i] === -Infinity) n++;
  return n;
}

/** How many coordinates in GeoJSON features are not finite. */
function badCoords(fc: unknown): number {
  let n = 0;
  const walk = (c: unknown): void => {
    if (typeof c === 'number') { if (!Number.isFinite(c)) n++; }
    else if (Array.isArray(c)) c.forEach(walk);
  };
  for (const f of (fc as { features: { geometry: { coordinates: unknown } }[] }).features) walk(f.geometry.coordinates);
  return n;
}

describe('your own logs', () => {
  it('are looked for in their git-ignored folder', ({ skip }) => {
    if (files.length === 0) skip('None there: put some in to check them too.');
    expect(files.length).toBeGreaterThan(0);
  });

  for (const path of files) {
    const name = localName(path);
    it(`reads ${name}`, ({ skip }) => {
      const size = statSync(path).size;
      const text = readFileSync(path, 'utf8');
      if (size > MAX_BYTES || !detectFormat(text, name)) skip(`${name} is not a track log the app reads`);

      const r = parseText(text, name, size);
      expect(r.ok ? 'loaded' : `refused: ${r.error}`).toBe('loaded');
      if (!r.ok) return;
      const tr: LoadedTrack = r.track;
      const c = tr.cols;
      expect(c.n, 'fixes').toBeGreaterThan(1);

      // Positions on Earth and times in order; the counts say how many are wrong.
      let offEarth = 0, nullIsland = 0, outOfOrder = 0;
      for (let i = 0; i < c.n; i++) {
        if (!(Math.abs(c.lat[i]) <= 90 && Math.abs(c.lon[i]) <= 180)) offEarth++;
        if (c.lat[i] === 0 && c.lon[i] === 0) nullIsland++;
        if (i > 0 && !(c.t[i] > c.t[i - 1])) outOfOrder++;
      }
      expect(offEarth, 'fixes off the Earth').toBe(0);
      expect(nullIsland, 'fixes at 0, 0').toBe(0);
      expect(outOfOrder, 'fixes out of time order').toBe(0);
      for (const f of tr.flags) expect(Math.abs(f.lat) <= 90 && Math.abs(f.lon) <= 180, `button press ${f.n} on the Earth`).toBe(true);

      // Derived values: same length as the fixes, never infinite.
      const d = tr.derived as unknown as Record<string, unknown>;
      for (const [k, v] of Object.entries(d)) {
        if (!ArrayBuffer.isView(v)) continue;
        const a = v as unknown as ArrayLike<number>;
        expect(a.length, `${k} length`).toBe(c.n);
        expect(infinite(a), `infinite ${k} values`).toBe(0);
      }
      const st = tr.derived.stats;
      expect(Number.isFinite(st.distanceM) && st.distanceM >= 0, 'distance').toBe(true);
      expect(st.end > st.start, 'the track lasts some time').toBe(true);

      // Everything the map and the legends build from it.
      const items = addTracks([], [tr]).items;
      const scaleFor = (t: LoadedTrack, k: MeasureKey) => buildScale(k, [t]);
      for (const k of measuresOf(tr)) expect(buildScale(k, [tr]).steps, `${k} steps`).toBeGreaterThan(0);
      const ctx = { dark: false, single: true, selectedId: items[0].id, scaleFor };
      const runs = buildRuns(items, ctx), paths = buildPaths(items, ctx);
      expect(runs.features.length, 'colored runs').toBeGreaterThan(0);
      expect(paths.features.length, 'paths').toBeGreaterThan(0);
      expect(badCoords(runs) + badCoords(paths) + badCoords(buildGaps(items)) + badCoords(buildFixPoints(items, ctx)), 'broken map coordinates').toBe(0);
    }, 60_000);
  }
});
