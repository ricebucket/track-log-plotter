// Performance: a long log with motion data stays quick to read and to draw.
// Each time limit is several times what this work takes on a laptop, so a
// slow CI machine still passes, while a change that makes the work grow out of
// hand (say, from linear to quadratic in the number of readings) fails.
import { describe, expect, it } from 'vitest';
import { parseText, transferables } from '../../src/parse/index';
import { columns } from '../../src/ui/timelineMath';
import { buildScale } from '../../src/color/scale';
import { fixAt } from '../../src/state/inspect';
import type { LoadedTrack } from '../../src/model/types';
import { bigFusionLog } from '../helpers/big-logs';

const time = (fn: () => void, reps = 1) => {
  const t0 = performance.now();
  for (let k = 0; k < reps; k++) fn();
  return (performance.now() - t0) / reps;
};

describe('a 10-hour log with motion data (36,000 fixes, 360,000 readings)', () => {
  const text = bigFusionLog(10);
  let tr: LoadedTrack;

  it('reads in well under a few seconds, keeping every reading', () => {
    let ms = 0;
    ms = time(() => {
      const r = parseText(text, 'big.CSV');
      if (!r.ok) throw new Error(r.error);
      tr = r.track;
    });
    console.log(`read: ${ms.toFixed(0)} ms for ${(text.length / 1e6).toFixed(1)} MB`);
    expect(tr.cols.n).toBe(36_000);
    expect(tr.motion!.t.length).toBe(360_000);
    expect(transferables({ ok: true, track: tr })).toContain(tr.motion!.g.buffer);
    expect(ms).toBeLessThan(2500);
  }, 30_000);

  it('draws the acceleration timeline quickly, zoomed out and in', () => {
    const s = buildScale('accel', [tr]);
    const a = tr.cols.t[0], b = tr.cols.t[tr.cols.n - 1];
    const whole = time(() => columns(tr, 'accel', s, a, b, 1200, 0), 10);
    const zoomed = time(() => columns(tr, 'accel', s, a + 3_600_000, a + 3_660_000, 1200, 0), 10);
    console.log(`timeline: ${whole.toFixed(1)} ms whole, ${zoomed.toFixed(2)} ms for one minute`);
    expect(whole).toBeLessThan(100);
    expect(zoomed).toBeLessThan(20);
  });

  it('finds the readings for the fix card in a fraction of a millisecond', () => {
    const c = tr.cols;
    const per = time(() => {
      const f = fixAt(tr, c.t[Math.floor(Math.random() * c.n)])!;
      if (f.readings.length !== 10) throw new Error('readings');
    }, 2000);
    console.log(`fix card: ${(per * 1000).toFixed(0)} µs a lookup`);
    expect(per).toBeLessThan(0.5);
  });
});
