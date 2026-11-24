// Quirks seen in real loggers' files, reproduced with synthetic New York City
// tracks: abbreviated extension fields, placeholder values and noisy height.
import { describe, expect, it } from 'vitest';
import { parseText } from '../../src/parse/index';
import { parseNmea, nmeaChecksum } from '../../src/parse/nmea';
import { buildScale } from '../../src/color/scale';
import { measuresOf } from '../../src/state/logic';
import type { LoadedTrack } from '../../src/model/types';

const START = Date.UTC(2026, 5, 14, 13, 0, 0);
const iso = (t: number) => new Date(t).toISOString().replace('.000Z', 'Z');

/** A GPX track heading north through Central Park at `mps`, one point a second. */
function gpx(n: number, point: (i: number) => string, opts: { mps?: number; ns?: string } = {}) {
  const { mps = 5, ns = '' } = opts;
  const pts = Array.from({ length: n }, (_, i) =>
    `<trkpt lat="${(40.775 + (i * mps) / 111_195).toFixed(7)}" lon="-73.9690000"><time>${iso(START + i * 1000)}</time>${point(i)}</trkpt>`);
  return `<?xml version="1.0"?><gpx version="1.1" creator="Test" xmlns="http://www.topografix.com/GPX/1/1" ${ns}><trk><trkseg>${pts.join('')}</trkseg></trk></gpx>`;
}

function loaded(text: string, name = 't.gpx'): LoadedTrack {
  const r = parseText(text, name);
  if (!r.ok) throw new Error(r.error);
  return r.track;
}

describe('logger quirks', () => {
  it('reads abbreviated speed and course in a vendor extension, inferring km/h', () => {
    const tr = loaded(gpx(120, (i) => `<ele>10</ele><extensions><x:spd>${(18 + (i % 3) * 0.1).toFixed(1)}</x:spd><x:crs>${i % 2 ? 1 : 359}</x:crs></extensions>`, { ns: 'xmlns:x="urn:test"' }));
    expect(tr.notes).toContainEqual({ kind: 'speedUnit', unit: 'kmh', inferred: true });
    expect(tr.derived.speedFromFile).toBe(true);
    expect(tr.derived.kmh[60]).toBeCloseTo(18, 0);
    expect(tr.fields).toEqual(expect.arrayContaining(['speed', 'course']));
    expect(tr.notes.find((n) => n.kind === 'ignored')).toBeUndefined();
  });

  it('names a satellites-in-view extension as ignored', () => {
    const tr = loaded(gpx(20, () => '<sat>5</sat><extensions><y:TrackPointExtension><y:sat_view>12</y:sat_view></y:TrackPointExtension></extensions>', { ns: 'xmlns:y="urn:test"' }));
    expect(tr.notes).toContainEqual({ kind: 'ignored', fields: ['satsInView'] });
  });

  it('drops an elevation that is 0 at every fix', () => {
    const tr = loaded(gpx(60, () => '<ele>0</ele>'));
    expect(tr.notes).toContainEqual({ kind: 'eleZero' });
    expect(tr.fields).not.toContain('ele');
    expect(measuresOf(tr).has('ele')).toBe(false);
    expect(measuresOf(tr).has('grade')).toBe(false);
    expect(tr.derived.stats.climbM).toBeNull();
  });

  it('keeps a real elevation of 0 at sea level when other fixes differ', () => {
    const tr = loaded(gpx(60, (i) => `<ele>${i < 30 ? 0 : 1}</ele>`));
    expect(tr.notes.find((n) => n.kind === 'eleZero')).toBeUndefined();
    expect(tr.fields).toContain('ele');
  });

  it('treats an HDOP of 0 as missing', () => {
    const tr = loaded(gpx(40, (i) => `<hdop>${i % 4 ? 1.2 : 0}</hdop>`));
    expect(Number.isNaN(tr.cols.hdop[0])).toBe(true);
    expect(tr.cols.hdop[1]).toBeCloseTo(1.2);
    const body = 'GNGGA,130000.00,4046.08572,N,07358.87242,W,1,08,0.0,25.4,M,-32.6,M,,';
    const nm = parseNmea(`$${body}*${nmeaChecksum(body)}\n`);
    expect(Number.isNaN(nm.cols.hdop[0])).toBe(true);
  });

  it('merges NMEA sentences of one second whose times have different decimals', () => {
    // RMC writes the time to the hundredth of a second; GGA and ZDA write it to the thousandth.
    const nm = (body: string) => `$${body}*${nmeaChecksum(body)}`;
    const second = (i: number) => [
      nm(`GNRMC,13050${i}.00,A,4046.0857${i},N,07358.87242,W,1.0,45.0,140626,,,A,V`),
      nm(`GNGGA,13050${i}.000,4046.0857${i},N,07358.87242,W,1,09,0.9,25.4,M,-32.6,M,,`),
      nm(`GNZDA,13050${i}.000,14,06,2026,00,00`),
    ];
    const p = parseNmea([0, 1, 2].flatMap(second).join('\n') + '\n');
    expect(p.cols.n).toBe(3);
    expect(Array.from(p.cols.ele, (v) => v.toFixed(1))).toEqual(['25.4', '25.4', '25.4']);
    expect(Array.from(p.cols.sats)).toEqual([9, 9, 9]);
    expect(Array.from(p.cols.hdop, (v) => v.toFixed(1))).toEqual(['0.9', '0.9', '0.9']);
    expect(Array.from(p.cols.lineEnd)).toEqual([3, 6, 9]);
    expect(p.notes.filter((n) => n.kind === 'duplicates' || n.kind === 'void')).toEqual([]);
  });

  it('notes fixes that report 0 satellites, and how many repeat the last position', () => {
    // Fixes 20–29 report no satellites and hold the previous position.
    const n = 60;
    const lat = (i: number) => (40.775 + ((i >= 20 && i < 30 ? 19 : i) * 5) / 111_195).toFixed(7);
    const pts = Array.from({ length: n }, (_, i) => `<trkpt lat="${lat(i)}" lon="-73.9690000"><time>${iso(START + i * 1000)}</time><sat>${i >= 20 && i < 30 ? 0 : 5}</sat></trkpt>`);
    const tr = loaded(`<?xml version="1.0"?><gpx version="1.1" creator="Test"><trk><trkseg>${pts.join('')}</trkseg></trk></gpx>`);
    expect(tr.notes).toContainEqual({ kind: 'zeroSats', count: 10, stale: 10 });
    expect(tr.cols.n).toBe(n);
  });

  it('keeps stops out of the speed steps', () => {
    // Half of the fixes stand still: the first step must still start above 0.
    const tr = loaded(gpx(400, () => '', { mps: 0 }));
    const moving = loaded(gpx(400, () => '', { mps: 6 }));
    const s = buildScale('speed', [tr, moving]);
    expect(s.edges[0]).toBeGreaterThan(1);
  });

  it('weights each track equally when choosing shared steps', () => {
    // A long walk and a short drive: the drive still gets steps of its own.
    const walk = loaded(gpx(3000, () => '', { mps: 1.3 }));
    const drive = loaded(gpx(300, () => '', { mps: 15 }));
    const s = buildScale('speed', [walk, drive]);
    expect(s.edges[s.edges.length - 1]).toBeGreaterThanOrEqual(30);
    expect(s.edges[0]).toBeLessThan(10);
  });

  it('spaces speed steps on a log scale when the shown tracks are faster than running', () => {
    const walk = loaded(gpx(600, () => '', { mps: 1.2 }));
    const drive = loaded(gpx(600, () => '', { mps: 25 }));
    const mixed = buildScale('speed', [walk, drive]);
    expect(mixed.log).toBe(true);
    // Each step reaches a similar multiple of the one before.
    const ratios = mixed.edges.slice(1).map((e, k) => e / mixed.edges[k]);
    for (const r of ratios) expect(r).toBeGreaterThan(1.3);
    expect(Math.max(...ratios) / Math.min(...ratios)).toBeLessThan(1.8);
    // A walk on its own keeps the even, data-based split.
    const alone = buildScale('speed', [walk, loaded(gpx(600, () => '', { mps: 1.6 }))]);
    expect(alone.log).toBe(false);
  });

  it('smooths noisy GPS height before grade and climb', () => {
    // Flat ride with ±8 m of jitter in the recorded height.
    const tr = loaded(gpx(600, (i) => `<ele>${(10 + (i % 2 ? 8 : -8) * ((i * 7) % 3 === 0 ? 1 : 0.5)).toFixed(1)}</ele>`));
    const steep = Array.from(tr.derived.grade).filter((g) => Math.abs(g) > 6).length;
    expect(steep / tr.cols.n).toBeLessThan(0.02);
    expect(tr.derived.stats.climbM).toBeLessThan(10);
    // The elevation colors still use the recorded values.
    expect(tr.derived.stats.maxEle).toBeGreaterThan(17);
  });
});
