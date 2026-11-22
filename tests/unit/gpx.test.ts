import { describe, expect, it } from 'vitest';
import { parseGpx, parseIsoTime } from '../../src/parse/gpx';
import { fixture } from '../helpers/fixtures';

const gpx = (body: string, extra = '') =>
  `<?xml version="1.0"?><gpx version="1.1" creator="Test" xmlns="http://www.topografix.com/GPX/1/1" xmlns:gpxtpx="http://www.garmin.com/xmlschemas/TrackPointExtension/v2" ${extra}>${body}</gpx>`;
const pt = (i: number, inner = '') =>
  `<trkpt lat="${(40.78 + i * 0.0001).toFixed(5)}" lon="-73.965"><ele>${20 + i}</ele><time>2026-06-14T13:05:${String(i).padStart(2, '0')}Z</time>${inner}</trkpt>`;

describe('parseIsoTime', () => {
  it('reads UTC, offsets and fractions', () => {
    expect(parseIsoTime('2026-06-14T13:05:00Z')).toEqual({ t: Date.UTC(2026, 5, 14, 13, 5), zoned: true });
    expect(parseIsoTime('2026-06-14T09:05:00-04:00').t).toBe(Date.UTC(2026, 5, 14, 13, 5));
    expect(parseIsoTime('2026-06-14T13:05:00.250Z').t).toBe(Date.UTC(2026, 5, 14, 13, 5, 0, 250));
  });
  it('reads times without a zone as UTC', () => {
    expect(parseIsoTime('2026-06-14T13:05:00')).toEqual({ t: Date.UTC(2026, 5, 14, 13, 5), zoned: false });
  });
});

describe('parseGpx', () => {
  it('reads track points with the standard fields', () => {
    const p = parseGpx(gpx(`<trk><name>Loop</name><trkseg>${pt(0, '<sat>9</sat><hdop>0.8</hdop><vdop>1.1</vdop><pdop>1.4</pdop><fix>dgps</fix><geoidheight>-32.6</geoidheight>')}${pt(1, '<fix>3d</fix>')}</trkseg></trk>`));
    expect(p.cols.n).toBe(2);
    expect(p.name).toBe('Loop');
    expect(p.creator).toBe('Test');
    expect(p.cols.ele[0]).toBe(20);
    expect(p.cols.sats[0]).toBe(9);
    expect(p.cols.hdop[0]).toBeCloseTo(0.8);
    expect(p.cols.vdop[0]).toBeCloseTo(1.1);
    expect(p.cols.pdop[0]).toBeCloseTo(1.4);
    expect(p.cols.geoid[0]).toBeCloseTo(-32.6);
    expect([...p.cols.fixq]).toEqual([2, 1]);
    expect(p.problems).toEqual([]);
  });

  it('reads Garmin TrackPointExtension speed as m/s', () => {
    const ext = (v: number) => `<extensions><gpxtpx:TrackPointExtension><gpxtpx:speed>${v}</gpxtpx:speed><gpxtpx:hr>140</gpxtpx:hr></gpxtpx:TrackPointExtension></extensions>`;
    const p = parseGpx(gpx(`<trk><trkseg>${pt(0, ext(5.5))}${pt(1, ext(6))}</trkseg></trk>`));
    expect(p.cols.speed[0]).toBeCloseTo(5.5);
    expect(p.notes).toContainEqual({ kind: 'speedUnit', unit: 'ms', inferred: false });
    expect(p.notes).toContainEqual({ kind: 'ignored', fields: ['heartRate'] });
  });

  it('works out the unit of a vendor speed from the positions', () => {
    const p = parseGpx(fixture('central-park-loop-vendor.gpx'));
    expect(p.notes).toContainEqual({ kind: 'speedUnit', unit: 'kmh', inferred: true });
    // stored as m/s: a ~22 km/h ride is ~6 m/s
    const mid = p.cols.speed[Math.floor(p.cols.n / 2)];
    expect(mid).toBeGreaterThan(2);
    expect(mid).toBeLessThan(12);
    expect(p.notes).toContainEqual({ kind: 'ignored', fields: ['satsInView'] });
  });

  it('reads GPX 1.0 speed and course', () => {
    const p = parseGpx(fixture('roosevelt-island-run.gpx'));
    expect(p.fields).toContain('speed');
    expect(p.cols.speed[10]).toBeGreaterThan(2);
    expect(p.cols.speed[10]).toBeLessThan(4);
  });

  it('turns waypoints with a time into button presses', () => {
    const p = parseGpx(fixture('central-park-loop-vendor.gpx'));
    expect(p.flags.map((f) => f.n)).toEqual([1, 2]);
    expect(p.flags[0].name).toBe('001');
    expect(p.fields).toContain('flags');
  });

  it('notes waypoints without a time and leaves them off', () => {
    const p = parseGpx(gpx(`<wpt lat="40.78" lon="-73.96"><name>Plan</name></wpt><trk><trkseg>${pt(0)}${pt(1)}</trkseg></trk>`));
    expect(p.flags).toEqual([]);
    expect(p.notes).toContainEqual({ kind: 'timelessWaypoints', count: 1 });
  });

  it('starts a new segment at each trkseg', () => {
    const p = parseGpx(gpx(`<trk><trkseg>${pt(0)}${pt(1)}</trkseg><trkseg>${pt(5)}</trkseg></trk>`));
    expect([...p.cols.seg]).toEqual([0, 0, 1]);
  });

  it('keeps everything before the point where a file stops', () => {
    const p = parseGpx(fixture('roosevelt-island-run-cut.gpx'));
    expect(p.cols.n).toBeGreaterThan(100);
    expect(p.problems).toContainEqual({ kind: 'unclosed', kept: p.cols.n });
  });

  it('flags a file whose closing tags are missing', () => {
    const p = parseGpx(gpx(`<trk><trkseg>${pt(0)}${pt(1)}`).replace('</gpx>', ''));
    expect(p.cols.n).toBe(2);
    expect(p.problems.map((x) => x.kind)).toEqual(['unclosed']);
  });

  it('skips points with fix "none" and points without a time', () => {
    const p = parseGpx(gpx(`<trk><trkseg>${pt(0, '<fix>none</fix>')}<trkpt lat="40.78" lon="-73.96"></trkpt>${pt(2)}</trkseg></trk>`));
    expect(p.cols.n).toBe(1);
  });

  it('notes times without a zone', () => {
    const p = parseGpx(gpx('<trk><trkseg><trkpt lat="40.78" lon="-73.96"><time>2026-06-14T13:05:00</time></trkpt></trkseg></trk>'));
    expect(p.notes).toContainEqual({ kind: 'noZone' });
  });

  it('reads the Garmin-style fixture with its segment break', () => {
    const p = parseGpx(fixture('central-park-loop-garmin.gpx'));
    expect(p.cols.n).toBeGreaterThan(1000);
    expect(p.cols.seg.reduce((a, b) => a + b, 0)).toBe(1);
    expect(p.problems).toEqual([]);
  });
});
