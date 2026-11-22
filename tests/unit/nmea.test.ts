import { describe, expect, it } from 'vitest';
import { nmeaChecksum, parseNmea } from '../../src/parse/nmea';
import { fixture } from '../helpers/fixtures';

const s = (body: string) => `$${body}*${nmeaChecksum(body)}`;
const rmc = (tod: string, lat = '4046.08572', lon = '07358.87242', date = '140626', mode = 'A', kn = '10.0', cog = '45.0', status = 'A') =>
  s(`GNRMC,${tod},${status},${lat},N,${lon},W,${kn},${cog},${date},,,${mode},V`);
const gga = (tod: string, q = 1, sats = '09', hdop = '0.9', alt = '25.4', geoid = '-32.6', lat = '4046.08572', lon = '07358.87242') =>
  s(`GNGGA,${tod},${lat},N,${lon},W,${q},${sats},${hdop},${alt},M,${geoid},M,,`);

describe('NMEA checksum', () => {
  it('matches a known sentence', () => {
    expect(nmeaChecksum('GPGGA,123519,4807.038,N,01131.000,E,1,08,0.9,545.4,M,46.9,M,,')).toBe('47');
  });
});

describe('parseNmea', () => {
  it('merges RMC, GGA and GSA from the same second into one fix', () => {
    const text = [rmc('130500.00'), gga('130500.00'), s('GNGSA,A,3,02,05,07,09,,,,,,,,,1.8,0.9,1.5,1'), ''].join('\n');
    const p = parseNmea(text);
    expect(p.cols.n).toBe(1);
    expect(p.cols.lat[0]).toBeCloseTo(40.768095, 5);
    expect(p.cols.lon[0]).toBeCloseTo(-73.981207, 5);
    expect(p.cols.ele[0]).toBeCloseTo(25.4);
    expect(p.cols.geoid[0]).toBeCloseTo(-32.6);
    expect(p.cols.hdop[0]).toBeCloseTo(0.9);
    expect(p.cols.pdop[0]).toBeCloseTo(1.8);
    expect(p.cols.vdop[0]).toBeCloseTo(1.5);
    expect(p.cols.sats[0]).toBe(9);
    expect(p.cols.speed[0]).toBeCloseTo(10 * 1852 / 3600, 4);
    expect(p.cols.course[0]).toBe(45);
    expect(p.cols.t[0]).toBe(Date.UTC(2026, 5, 14, 13, 5, 0));
    expect(p.cols.line[0]).toBe(1);
    expect(p.cols.lineEnd[0]).toBe(3);
    expect(p.fields).toEqual(expect.arrayContaining(['time', 'position', 'ele', 'speed', 'course', 'hdop', 'vdop', 'pdop', 'sats', 'fix', 'geoid']));
    expect(p.problems).toEqual([]);
    expect(p.notes).toContainEqual({ kind: 'speedUnit', unit: 'knots', inferred: false });
  });

  it('reads differential fixes from GGA quality and from the RMC mode', () => {
    const p = parseNmea([rmc('130500.00'), gga('130500.00', 2), rmc('130501.00', undefined, undefined, undefined, 'D'), ''].join('\n'));
    expect([...p.cols.fixq]).toEqual([2, 2]);
  });

  it('skips void fixes and notes them', () => {
    const p = parseNmea([rmc('130500.00', undefined, undefined, undefined, 'N', '', '', 'V'), gga('130500.00', 0), rmc('130501.00'), ''].join('\n'));
    expect(p.cols.n).toBe(1);
    expect(p.notes).toContainEqual({ kind: 'void', count: 1 });
  });

  it('keeps course empty when the logger leaves it out', () => {
    const p = parseNmea([rmc('130500.00', undefined, undefined, undefined, 'A', '0.1', ''), ''].join('\n'));
    expect(Number.isNaN(p.cols.course[0])).toBe(true);
  });

  it('rolls the date over at midnight for sentences without a date', () => {
    const text = [rmc('235959.00', undefined, undefined, '020726'), gga('000000.00'), gga('000001.00'), ''].join('\n');
    const p = parseNmea(text);
    expect(p.cols.n).toBe(3);
    expect(p.cols.t[1] - p.cols.t[0]).toBe(1000);
    expect(new Date(p.cols.t[2]).toISOString()).toBe('2026-07-03T00:00:01.000Z');
    expect(p.notes).toContainEqual({ kind: 'midnight' });
  });

  it('dates GGA fixes logged before the first RMC', () => {
    const p = parseNmea([gga('130458.00'), gga('130459.00'), rmc('130500.00'), ''].join('\n'));
    expect(new Date(p.cols.t[0]).toISOString()).toBe('2026-06-14T13:04:58.000Z');
  });

  it('flags a last line that was cut off and keeps everything before it', () => {
    const text = [rmc('130500.00'), gga('130500.00'), rmc('130501.00'), ''].join('\n') + rmc('130502.00').slice(0, 28);
    const p = parseNmea(text);
    expect(p.cols.n).toBe(2);
    expect(p.problems).toContainEqual({ kind: 'truncated', line: 4, chars: 28, kept: 2 });
  });

  it('flags bad checksums, glued sentences and stray bytes', () => {
    const bad = rmc('130501.00').replace(/\*..$/, '*00');
    const text = [rmc('130500.00'), bad, gga('130502.00') + rmc('130502.00'), '\u0000ÿ' + rmc('130503.00'), ''].join('\n');
    const p = parseNmea(text);
    expect(p.problems).toContainEqual({ kind: 'checksum', count: 1, line: 2 });
    expect(p.problems).toContainEqual({ kind: 'glued', count: 1, line: 3 });
    expect(p.problems).toContainEqual({ kind: 'garbage', count: 1, line: 4 });
    expect(p.cols.n).toBe(3);
  });

  it('accepts logs that never write checksums', () => {
    const text = ['$GPRMC,130500.00,A,4046.08572,N,07358.87242,W,1.0,10.0,140626,,,A', '$GPRMC,130501.00,A,4046.08600,N,07358.87200,W,1.0,10.0,140626,,,A', ''].join('\n');
    const p = parseNmea(text);
    expect(p.cols.n).toBe(2);
    expect(p.problems).toEqual([]);
  });

  it('drops fixes that go back in time and impossible jumps', () => {
    const near = (k: number) => (4046.08572 + k * 0.001).toFixed(5);
    const lines = [0, 1, 2, 3, 4, 5].map((k) => rmc(`13050${k}.00`, near(k)));
    lines.splice(3, 0, rmc('130501.50', near(1)));
    lines[5] = rmc('130504.00', '4058.00000');
    const p = parseNmea(lines.join('\n') + '\n');
    expect(p.problems.find((x) => x.kind === 'backwards')).toMatchObject({ count: 1 });
    expect(p.problems.find((x) => x.kind === 'jump')).toMatchObject({ count: 1 });
    expect(p.cols.n).toBe(5);
  });

  it('notes satellites-in-view sentences as ignored', () => {
    const p = parseNmea([rmc('130500.00'), s('GPGSV,3,1,12,02,45,120,38'), ''].join('\n'));
    expect(p.notes).toContainEqual({ kind: 'ignored', fields: ['satsInView'] });
  });

  it('handles Windows line endings', () => {
    const p = parseNmea([rmc('130500.00'), gga('130500.00'), ''].join('\r\n'));
    expect(p.cols.n).toBe(1);
    expect(p.problems).toEqual([]);
  });

  describe('fixtures', () => {
    it('reads the synthetic Central Park log cleanly', () => {
      const p = parseNmea(fixture('central-park-loop.nmea'));
      expect(p.cols.n).toBeGreaterThan(1000);
      expect(p.problems).toEqual([]);
      expect(p.cols.fixq.some((q) => q === 2)).toBe(true);
    });

    it('reports every kind of damage in damaged.nmea', () => {
      const p = parseNmea(fixture('damaged.nmea'));
      const kinds = p.problems.map((x) => x.kind).sort();
      expect(kinds).toEqual(['backwards', 'checksum', 'garbage', 'glued', 'jump', 'truncated']);
      expect(p.cols.n).toBeGreaterThan(100);
    });

    it('reads a log that crosses midnight UTC', () => {
      const p = parseNmea(fixture('hudson-greenway-evening.log'));
      expect(p.notes).toContainEqual({ kind: 'midnight' });
      for (let i = 1; i < p.cols.n; i++) expect(p.cols.t[i]).toBeGreaterThan(p.cols.t[i - 1]);
    });
  });
});
