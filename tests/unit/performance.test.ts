// Performance: long logs stay quick to read, combine and draw. Each time
// limit is several times what this work takes on a laptop, so a slow CI
// machine still passes, while a change that makes the work grow out of hand
// (say, from linear to quadratic in the number of readings) fails. The limits
// are for plain runs: counting coverage makes this work about 5x slower, so
// `npm run test:coverage` leaves this file out and CI runs it on its own
// (`npm run test:perf`).
import { describe, expect, it } from 'vitest';
import { parseText, transferables } from '../../src/parse/index';
import { parseNmea } from '../../src/parse/nmea';
import { columns } from '../../src/ui/timelineMath';
import { buildScale } from '../../src/color/scale';
import { fixAt } from '../../src/state/inspect';
import { combineTracks } from '../../src/combine/combine';
import { nearestFix } from '../../src/map/geojson';
import { quantilesIn, spread } from '../../src/derive/geo';
import { derive } from '../../src/derive/derive';
import { ColumnBuilder } from '../../src/parse/columns';
import { scanXml } from '../../src/parse/xml';
import { parseGpx } from '../../src/parse/gpx';
import { adversary, crowded } from '../helpers/selection-orders';
import { loop, walk } from '../helpers/walks';
import { haversine } from '../../src/derive/geo';
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

describe('the map', () => {
  it('scans a 100,000-fix track several times faster than with great circles', () => {
    const n = 100_000;
    const lat = Float64Array.from({ length: n }, (_, i) => 40.7812 + 0.01 * Math.sin(i / 600));
    const lon = Float64Array.from({ length: n }, (_, i) => -73.9665 + 0.008 * Math.cos(i / 600));
    const cols = { n, lat, lon };
    const warmTime = (fn: () => void) => { fn(); fn(); const t0 = performance.now(); for (let r = 0; r < 20; r++) fn(); return (performance.now() - t0) / 20; };
    const fast = warmTime(() => nearestFix(cols, 40.781, -73.961));
    const slow = warmTime(() => { let bd = Infinity; for (let i = 0; i < n; i++) bd = Math.min(bd, haversine(40.781, -73.961, lat[i], lon[i])); });
    console.log(`nearest fix of 100,000: ${fast.toFixed(2)} ms; with haversine ${slow.toFixed(2)} ms`);
    expect(fast).toBeLessThan(slow / 2);
  });
});

// Input made to be slow, or simply extreme: a file can bring any of it. Each check says what it cost before
// it was made linear; the results themselves are tested beside the code (selection, parse-hardening, gpx,
// scan and combine tests).
describe('input made to be slow stays near linear', () => {
  it('finds the median of 100,000 values in an order made to defeat selection in milliseconds (it took about 2 s)', () => {
    const m = 100_000, v = adversary(m, m >> 1);
    expect(time(() => quantilesIn(v, m, [0.5]))).toBeLessThan(250);
  });

  it('spreads 65,536 values that share their top 16 bits in such an order in milliseconds (about 1 s)', () => {
    const m = 65_536, size = 512, v = crowded(adversary(m, Math.round(((size >> 1) * (m - 1)) / (size - 1))));
    expect(time(() => spread(v, m, size))).toBeLessThan(250);
  });

  it('works out a 100,000-fix log whose HDOPs come in such an order as quickly as any other (about 2 s)', () => {
    const n = 100_000, rank = adversary(n, 49_999), b = new ColumnBuilder();
    for (let i = 0; i < n; i++) b.push({ t: Date.UTC(2026, 5, 14, 8, 0, i), lat: 40.78 + (i % 1000) * 1e-5, lon: -73.965 + Math.floor(i / 1000) * 1e-5, hdop: (rank[i] + 1) / 100, line: i + 1 });
    const parsed = { format: 'gpx' as const, creator: null, name: null, cols: b.build(), flags: [], problems: [], notes: [], fields: ['time' as const, 'position' as const, 'hdop' as const], lines: n };
    expect(time(() => derive(parsed))).toBeLessThan(1000);
  });

  it('spreads a long run of equal values and zeros quickly', () => {
    const zeros = new Float32Array(400_000);
    for (let i = 0; i < zeros.length; i += 7) zeros[i] = -0;
    const threes = new Float64Array(400_000).fill(3);
    expect(time(() => { spread(zeros, zeros.length, 512); quantilesIn(threes, threes.length, [0.1, 0.25, 0.5, 0.75]); })).toBeLessThan(500);
  });

  it('reads a tag whose 200,000-character name has no value in one pass (about 20 s)', () => {
    const text = `<gpx><trkpt ${'a'.repeat(200_000)}=x b="1"></trkpt></gpx>`;
    expect(time(() => scanXml(text, { open() {}, text() {}, close() {} }))).toBeLessThan(1000);
  });

  it('reads 50,000 stray or unclosed GPX tags in one pass', () => {
    const n = 50_000;
    for (const body of ['<a>'.repeat(n) + '</b>'.repeat(n), '<trk>' + '<a>'.repeat(n) + '</trk>'.repeat(n)]) {
      expect(time(() => parseGpx(`<gpx version="1.1">${body}</gpx>`))).toBeLessThan(1000);
    }
  });

  it('looks for the line breaks of 200,000 blank NMEA lines once each, whatever they are (seconds otherwise)', () => {
    const rmc = (i: number) => nmeaSentence(`GNRMC,1305${String(i).padStart(2, '0')}.00,A,4046.${String(8572 + i * 30).padStart(5, '0')},N,07358.87242,W,1.0,45.0,140626,,,A,V`);
    const blank = (br: string) => `${' '.repeat(40)}${br}`.repeat(200_000);
    for (const text of [rmc(0) + '\n' + blank('\n') + rmc(1) + '\n', rmc(0) + '\n' + blank('\n') + rmc(1) + '\n\r', rmc(0) + '\r' + blank('\r') + rmc(1) + '\r']) {
      expect(time(() => parseNmea(text))).toBeLessThan(1500);
    }
  });

  it('combines logs with a stray fix 60 days away in milliseconds (about 400 ms and 700 MB)', () => {
    const a = walk({ seed: 41 }), stray = walk({ seed: 42, offsetM: 3, stray: 60 * 86_400 });
    combineTracks([a, stray]);
    expect(time(() => combineTracks([a, stray]), 3)).toBeLessThan(100);
  }, 30_000);

  it("fills in 40,000 left-out speeds in a row in one pass (about 2.5 s)", () => {
    const a = loop(40_000), zero = loop(40_000, { northM: 3, seed: 2, speed: 0 });
    expect(time(() => combineTracks([a, zero]))).toBeLessThan(1000);
  }, 30_000);
});
