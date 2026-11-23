// Performance: long logs stay quick to read, combine and draw. Each time
// limit is several times what this work takes on a laptop, so a slow CI
// machine still passes, while a change that makes the work grow out of hand
// (say, from linear to quadratic in the number of readings) fails.
import { describe, expect, it } from 'vitest';
import { parseText, transferables } from '../../src/parse/index';
import { parseNmea } from '../../src/parse/nmea';
import { columns } from '../../src/ui/timelineMath';
import { buildScale } from '../../src/color/scale';
import { fixAt } from '../../src/state/inspect';
import { combineTracks } from '../../src/combine/combine';
import type { LoadedTrack } from '../../src/model/types';
import { bigFusionLog, bigGpxLog, bigNmeaLog, nmeaSentence } from '../helpers/big-logs';

const time = (fn: () => void, reps = 1) => {
  const t0 = performance.now();
  for (let k = 0; k < reps; k++) fn();
  return (performance.now() - t0) / reps;
};

const read = (text: string, name: string): LoadedTrack => {
  const r = parseText(text, name);
  if (!r.ok) throw new Error(r.error);
  return r.track;
};

describe('big GPX and NMEA logs', () => {
  it('reads 50,000 GPX points (14 MB) well under a few seconds', () => {
    const text = bigGpxLog(50_000);
    let tr: LoadedTrack | null = null;
    const ms = time(() => { tr = read(text, 'big.gpx'); });
    console.log(`GPX: ${ms.toFixed(0)} ms for ${(text.length / 1e6).toFixed(1)} MB`);
    expect(tr!.cols.n).toBe(50_000);
    expect(ms).toBeLessThan(2500);
  }, 30_000);

  it('reads 36,000 NMEA fixes (7 MB) well under a few seconds', () => {
    const text = bigNmeaLog(36_000);
    let tr: LoadedTrack | null = null;
    const ms = time(() => { tr = read(text, 'big.nmea'); });
    console.log(`NMEA: ${ms.toFixed(0)} ms for ${(text.length / 1e6).toFixed(1)} MB`);
    expect(tr!.cols.n).toBe(36_000);
    expect(ms).toBeLessThan(2500);
  }, 30_000);

  it('reads an NMEA log in one pass however far apart its $ and * marks are', () => {
    // Each search for the next $ or * picks up where the last one stopped. A
    // search from every line instead would cover the rest of the file each
    // time here: the first log has no $ after its first line, the second no *.
    const noDollar = nmeaSentence('GPRMC,080000.00,A,4046.87200,N,07357.99000,W,5.20,123.0,140626,13.1,W,A') + '\n'
      + Array.from({ length: 100_000 }, (_, i) => `noise ${i} without a sentence start`).join('\n') + '\n';
    const noStar = Array.from({ length: 100_000 }, (_, i) => `$GPTXT,01,01,02,line ${i} has no checksum`).join('\n') + '\n';
    for (const text of [noDollar, noStar]) {
      let n = -1;
      const ms = time(() => { n = parseNmea(text).cols.n; });
      expect(n).toBeLessThanOrEqual(1);
      expect(ms).toBeLessThan(1000);
    }
  }, 30_000);
});

describe('combining long logs', () => {
  it('combines two and three logs of 36,000 fixes in well under a second', () => {
    // The same walk from three loggers a few metres apart (not one recording twice).
    const gpx = read(bigGpxLog(36_000), 'a.gpx'), nmea = read(bigNmeaLog(36_000, 3), 'b.nmea'), nmea2 = read(bigNmeaLog(36_000, -4), 'c.nmea');
    let n2 = 0, n3 = 0;
    const two = time(() => { const r = combineTracks([gpx, nmea]); if (r.ok) n2 = r.track.cols.n; });
    const three = time(() => { const r = combineTracks([gpx, nmea, nmea2]); if (r.ok) n3 = r.track.cols.n; });
    console.log(`combine: ${two.toFixed(1)} ms for two logs, ${three.toFixed(1)} ms for three`);
    expect(n2).toBe(36_000);
    expect(n3).toBe(36_000);
    expect(two).toBeLessThan(1000);
    expect(three).toBeLessThan(1500);
  }, 60_000);
});

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
