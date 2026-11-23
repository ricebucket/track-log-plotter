// Columbus Fusion logs (CSV), GPX routes with times, and files whose times
// have no time zone.
import { describe, expect, it } from 'vitest';
import { detectFormat, parseText } from '../../src/parse/index';
import { parseFusion } from '../../src/parse/fusion';
import { parseGpx } from '../../src/parse/gpx';
import { clockShift } from '../../src/time/zones';
import { load } from '../helpers/fixtures';

const HEAD = '# Format=ColumbusFusion; Version=1.0; Type=GNSS\r\ntag,date,time,lat,lon,alt,speed,heading\r\n';

describe('Columbus Fusion logs', () => {
  it('are recognized by their content', () => {
    expect(detectFormat(HEAD, 'track.txt')).toBe('fusion');
    expect(detectFormat('INDEX,TAG,DATE,TIME,LATITUDE N/S,LONGITUDE E/W,HEIGHT\n', 'x.csv')).toBe('fusion');
    expect(detectFormat('name,value\na,1\n', 'x.csv')).toBeNull();
  });

  it('reads a log without motion data, its zoneless times as UTC at first', () => {
    const tr = load('roosevelt-island-run.csv');
    expect(tr.format).toBe('fusion');
    expect(tr.problems).toEqual([]);
    expect(tr.cols.n).toBeGreaterThan(500);
    // Written as 07:40:00 on June 21 (the logger's New York clock), read as UTC
    // until the properties page sets the zone.
    expect(tr.cols.t[0]).toBe(Date.UTC(2026, 5, 21, 7, 40, 0));
    expect(tr.clock).toBe('utc');
    expect(tr.notes).toEqual(expect.arrayContaining([{ kind: 'noZone' }, { kind: 'speedUnit', unit: 'kmh', inferred: false }]));
    expect(tr.fields).not.toContain('accel');
    // A row tagged C is a point the user saved: a button press.
    expect(tr.flags).toHaveLength(1);
    expect(tr.fields).toContain('flags');
  });

  it('stores speed in m/s, from the km/h in the file', () => {
    const p = parseFusion(HEAD + 'T,260614,130500,40.7681,-73.9812,25.0,36.0,90.0\r\n,,130501,40.7682,-73.9811,25.1,36.0,91.0\r\n');
    expect(p.cols.n).toBe(2);
    expect(p.cols.speed[0]).toBeCloseTo(10, 5);
    expect(p.cols.ele[1]).toBeCloseTo(25.1, 3);
    expect(p.cols.course[1]).toBeCloseTo(91, 3);
  });

  it('carries the date over, and moves to the next day past midnight', () => {
    const p = parseFusion(HEAD + 'T,260614,235959,40.7681,-73.9812,25,10,90\r\n,,000000,40.7682,-73.9811,25,10,90\r\n,,000001,40.7683,-73.9810,25,10,90\r\n');
    expect(p.cols.n).toBe(3);
    expect(p.cols.t[1] - p.cols.t[0]).toBe(1000);
    expect(p.cols.t[2]).toBe(Date.UTC(2026, 5, 15, 0, 0, 1));
  });

  it('works out acceleration from the motion sensor, without gravity', () => {
    const tr = load('central-park-loop-motion.csv');
    expect(tr.problems).toEqual([]);
    expect(tr.fields).toContain('accel');
    expect(tr.notes).toContainEqual({ kind: 'motion', rate: 10 });
    const a = Array.from(tr.cols.accel);
    expect(a.every(Number.isFinite)).toBe(true);
    const sorted = [...a].sort((x, y) => x - y);
    // Riding along: a little road buzz, nowhere near the 1 g of gravity.
    expect(sorted[sorted.length >> 1]).toBeLessThan(0.15);
    // The two bumps stand out.
    const big = a.map((v, i) => [v, i]).filter(([v]) => v > 0.6).map(([, i]) => i);
    expect(big).toHaveLength(2);
    expect(tr.derived.stats.maxAccel).toBeGreaterThan(0.6);
  });

  it('notices a pause in logging and keeps the readings on each side apart', () => {
    const tr = load('central-park-loop-motion.csv');
    const c = tr.cols;
    const pause = c.t.findIndex((t, i) => i > 0 && t - c.t[i - 1] > 60_000);
    expect(pause).toBe(181);
    expect((c.t[pause] - c.t[pause - 1]) / 1000).toBe(96);
    expect(tr.derived.gap[pause]).toBe(1);
  });

  it('reads the older layout: NUL padding, N/S/E/W letters and other column names', () => {
    const nul = '\0\0\0';
    const text = [
      `INDEX${nul},TAG,DATE${nul},TIME${nul},LATITUDE N/S,LONGITUDE E/W,HEIGHT,SPEED,HEADING,VOX${nul}`,
      `1${nul},T,260614,130500,40.7681N,73.9812W,25,10,90,${nul}`,
      `2${nul},C,260614,130501,40.7682N,73.9811W,26,11,91,${nul}`,
      '',
    ].join('\r\n');
    expect(detectFormat(text, 'old.CSV')).toBe('fusion');
    const p = parseFusion(text);
    expect(p.cols.n).toBe(2);
    expect(p.cols.lat[0]).toBeCloseTo(40.7681, 6);
    expect(p.cols.lon[0]).toBeCloseTo(-73.9812, 6);
    expect(p.cols.ele[1]).toBe(26);
    expect(p.flags).toHaveLength(1);
  });

  it('flags a cut-off last line and broken rows, and keeps the rest', () => {
    const text = HEAD + 'T,260614,130500,40.7681,-73.9812,25,10,90\r\nthis is not a row\r\n,,130501,40.7682,-73.9811,25,10,90\r\n,,130502,40.76';
    const p = parseFusion(text);
    expect(p.cols.n).toBe(2);
    expect(p.problems).toEqual([
      expect.objectContaining({ kind: 'truncated', line: 6 }),
      expect.objectContaining({ kind: 'garbage', count: 1, line: 4 }),
    ]);
  });

  it('goes through the same loading as every other file', () => {
    const r = parseText(HEAD + 'T,260614,130500,40.7681,-73.9812,25,10,90\r\n,,130501,40.7682,-73.9811,25,10,90\r\n', 'log.CSV');
    expect(r.ok && r.track.format).toBe('fusion');
  });
});

describe('GPX routes with times', () => {
  const rte = (pts: string) => `<?xml version="1.0"?><gpx version="1.1" creator="converter"><rte><name>Ride</name>${pts}</rte></gpx>`;
  const pt = (i: number) => `<rtept lat="40.77${i}" lon="-73.97${i}"><ele>20</ele><time>2026-06-14T13:05:0${i}Z</time><name>Position ${i}</name></rtept>`;

  it('read as the track when the file has no track points', () => {
    const p = parseGpx(rte([1, 2, 3].map(pt).join('')));
    expect(p.cols.n).toBe(3);
    expect(p.name).toBe('Ride');
    expect(p.notes).toContainEqual({ kind: 'route' });
  });

  it('are left alone when the file has a track', () => {
    const trk = '<trk><trkseg><trkpt lat="40.7681" lon="-73.9812"><time>2026-06-14T13:05:00Z</time></trkpt><trkpt lat="40.7682" lon="-73.9811"><time>2026-06-14T13:05:01Z</time></trkpt></trkseg></trk>';
    const p = parseGpx(rte(pt(1) + pt(2) + pt(3)).replace('</gpx>', trk + '</gpx>'));
    expect(p.cols.n).toBe(2);
    expect(p.notes).not.toContainEqual({ kind: 'route' });
  });

  it('without times can\'t become a track', () => {
    const p = parseGpx(rte('<rtept lat="40.7681" lon="-73.9812"/><rtept lat="40.7682" lon="-73.9811"/>'));
    expect(p.cols.n).toBe(0);
  });
});

describe('file time zones', () => {
  it('moves clock readings between zones', () => {
    const t = Date.UTC(2026, 9, 28, 8, 26, 3); // 16:26:03 in UTC+8
    expect(clockShift(t, 'Asia/Shanghai', 'utc')).toBe(8 * 3600_000);
    expect(clockShift(t, 'utc', 'America/New_York')).toBe(4 * 3600_000);
    expect(clockShift(t, 'America/New_York', 'America/New_York')).toBe(0);
  });
});
