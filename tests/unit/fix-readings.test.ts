// The motion readings the fix card lists for a fix: capped for a second with
// very many of them, and worked out only when the card asks.
import { describe, expect, it } from 'vitest';
import { fixAt, SHOWN_READINGS } from '../../src/state/inspect';
import type { LoadedTrack } from '../../src/model/types';
import { load } from '../helpers/fixtures';

/** The motion log with `count` readings crammed into fix i's second instead of its ten, in no order. */
function crowded(count: number, i = 60): { tr: LoadedTrack; sorted: number[] } {
  const base = load('central-park-loop-motion.csv');
  const m = base.motion!, c = base.cols;
  const lo = m.t.findIndex((t) => t >= c.t[i]), hi = m.t.findIndex((t) => t >= c.t[i + 1]);
  // 0.5 g to 1.5 g, shuffled (7919 is prime, so k × 7919 mod count visits every step once).
  const g = Float32Array.from({ length: count }, (_, k) => 0.5 + ((k * 7919) % count) / count);
  const t = Float64Array.from({ length: count }, (_, k) => c.t[i] + (k * (c.t[i + 1] - c.t[i])) / count);
  const motion = {
    t: Float64Array.from([...m.t.subarray(0, lo), ...t, ...m.t.subarray(hi)]),
    g: Float32Array.from([...m.g.subarray(0, lo), ...g, ...m.g.subarray(hi)]),
  };
  return { tr: { ...base, motion }, sorted: Array.from(g).sort((a, b) => a - b) };
}

describe('fix card readings', () => {
  it('lists every reading of an ordinary second, lowest first, with nothing left out', () => {
    const tr = load('central-park-loop-motion.csv');
    const f = fixAt(tr, tr.cols.t[60])!;
    expect(f.readings).toHaveLength(10);
    expect(f.moreReadings).toBe(0);
  });

  it('lists at most 50 of a crowded second: the lowest, the median of them all in the middle, the strongest last', () => {
    const { tr, sorted } = crowded(5000);
    const f = fixAt(tr, tr.cols.t[60])!;
    expect(f.readings).toHaveLength(SHOWN_READINGS);
    expect(f.moreReadings).toBe(5000 - SHOWN_READINGS);
    expect([...f.readings].sort((a, b) => a - b)).toEqual(f.readings);
    expect(f.readings[0]).toBe(sorted[0]);
    // With an even count, the upper of the two middle readings, as the card says.
    expect(f.readings[SHOWN_READINGS >> 1]).toBe(sorted[2500]);
    expect(f.readings[SHOWN_READINGS - 1]).toBe(sorted[4999]);
    // Each one listed is one of the second's readings, none twice.
    const all = new Set(sorted);
    for (const v of f.readings) expect(all.has(v)).toBe(true);
    expect(new Set(f.readings).size).toBe(SHOWN_READINGS);
    // An odd count has one middle reading.
    const odd = crowded(51);
    const g = fixAt(odd.tr, odd.tr.cols.t[60])!;
    expect([g.readings.length, g.moreReadings]).toEqual([SHOWN_READINGS, 1]);
    expect(g.readings[SHOWN_READINGS >> 1]).toBe(odd.sorted[25]);
    expect(g.readings[SHOWN_READINGS - 1]).toBe(odd.sorted[50]);
  });

  it('works the readings out only when they are read: the readout and the other tracks\' rows never do', () => {
    const base = load('central-park-loop-motion.csv');
    let reads = 0;
    const motion = { get t() { reads++; return base.motion!.t; }, g: base.motion!.g };
    const tr: LoadedTrack = { ...base, motion };
    const f = fixAt(tr, tr.cols.t[60])!;
    expect(f.kmh).toBeGreaterThan(0);
    expect(reads).toBe(0);
    expect(f.readings).toHaveLength(10);
    expect(reads).toBeGreaterThan(0);
    // Read once, kept.
    const seen = reads;
    expect([f.readings.length, f.moreReadings]).toEqual([10, 0]);
    expect(reads).toBe(seen);
  });
});
