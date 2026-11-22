import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { detectFormat, MAX_BYTES, parseText, transferables } from '../../src/parse/index';
import { nmeaChecksum, parseNmea } from '../../src/parse/nmea';
import { fixture, fixtureNames } from '../helpers/fixtures';

describe('loading files', () => {
  it('detects the format from the content first', () => {
    expect(detectFormat('<?xml?><gpx version="1.1">', 'track.txt')).toBe('gpx');
    expect(detectFormat('$GPRMC,1', 'track.gpx')).toBe('nmea');
    expect(detectFormat('$GNGGA,1', 'x.LOG')).toBe('nmea');
    expect(detectFormat('hello', 'x.csv')).toBeNull();
  });

  it('loads every fixture', () => {
    for (const name of fixtureNames()) {
      const r = parseText(fixture(name), name);
      expect(r.ok, name).toBe(true);
    }
  });

  it('refuses empty, unknown and oversized files', () => {
    expect(parseText('', 'a.gpx')).toEqual({ ok: false, file: 'a.gpx', error: 'empty' });
    expect(parseText('just words', 'a.csv')).toEqual({ ok: false, file: 'a.csv', error: 'unknownFormat' });
    expect(parseText('$GPGSV,1,1,00', 'a.nmea')).toEqual({ ok: false, file: 'a.nmea', error: 'empty' });
    expect(parseText('x', 'big.gpx', MAX_BYTES + 1)).toEqual({ ok: false, file: 'big.gpx', error: 'tooBig' });
  });

  it('accepts a UTF-8 byte-order mark', () => {
    const r = parseText('﻿' + fixture('roosevelt-island-run.gpx'), 'bom.gpx');
    expect(r.ok).toBe(true);
  });

  it('notes derived speed, relative HDOP and gaps', () => {
    const run = parseText(fixture('central-park-loop-vendor.gpx'), 'b.gpx');
    expect(run.ok && run.track.notes.map((n) => n.kind)).toEqual(expect.arrayContaining(['hdopRelative', 'speedUnit']));
    const cut = parseText(fixture('central-park-loop-truncated.nmea'), 'a.nmea');
    expect(cut.ok && cut.track.problems).toEqual([expect.objectContaining({ kind: 'truncated', chars: 28 })]);
  });

  it('lists the typed-array buffers to transfer', () => {
    const r = parseText(fixture('roosevelt-island-run.gpx'), 'c.gpx');
    expect(transferables(r).length).toBeGreaterThan(10);
    expect(transferables({ ok: false, file: 'x', error: 'empty' })).toEqual([]);
  });
});

describe('NMEA round trip (property)', () => {
  const coord = (v: number, deg: number) => {
    const a = Math.abs(v), d = Math.floor(a);
    return String(d).padStart(deg, '0') + ((a - d) * 60).toFixed(5).padStart(8, '0');
  };
  it('reads back any position inside New York City', () => {
    fc.assert(fc.property(
      fc.double({ min: 40.5, max: 40.9, noNaN: true }),
      fc.double({ min: -74.2, max: -73.7, noNaN: true }),
      fc.integer({ min: 0, max: 86_399 }),
      (lat, lon, tod) => {
        const hh = String(Math.floor(tod / 3600)).padStart(2, '0');
        const mm = String(Math.floor((tod % 3600) / 60)).padStart(2, '0');
        const ss = String(tod % 60).padStart(2, '0');
        const body = `GNRMC,${hh}${mm}${ss}.00,A,${coord(lat, 2)},N,${coord(lon, 3)},W,1.0,,140626,,,A,V`;
        const p = parseNmea(`$${body}*${nmeaChecksum(body)}\n`);
        expect(p.cols.n).toBe(1);
        expect(p.cols.lat[0]).toBeCloseTo(lat, 6);
        expect(p.cols.lon[0]).toBeCloseTo(lon, 6);
        expect(p.cols.t[0]).toBe(Date.UTC(2026, 5, 14) + tod * 1000);
      },
    ));
  });

  it('never throws on arbitrary lines', () => {
    fc.assert(fc.property(fc.array(fc.string()), (lines) => {
      const p = parseNmea(lines.map((l) => '$GN' + l).join('\n'));
      expect(p.cols.n).toBeGreaterThanOrEqual(0);
    }));
  });
});
