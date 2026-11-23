import { describe, expect, it } from 'vitest';
import { parseGpx, parseIsoTime } from '../../src/parse/gpx';
import { parseText } from '../../src/parse/index';
import { noteText } from '../../src/ui/labels';
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
  it('reads the usual times directly and every other time just as the built-in parser does', () => {
    const times = ['2026-06-14T08:00:00Z', '2026-06-14T08:00:01.250Z', '2026-12-31T23:59:59Z', '2024-02-29T12:00:00Z',
      '2026-02-29T12:00:00Z', '2026-06-31T00:00:00Z', '2026-06-14T24:00:00Z', '2026-06-14T08:00:60Z', '0026-06-14T08:00:00Z',
      '1999-01-01T00:00:00Z', '2026-06-14T08:00:00.5Z', '2026-06-14T08:00:00.12345Z', '2026-06-14T08:00:00+02:00',
      '2026-06-14T08:00:00', '2026-06-14t08:00:00z', '2026-13-01T00:00:00Z', '2026-06-14 08:00:00Z'];
    // A time the built-in parser can't read leaves the point out (NaN here).
    const got = times.map((v) => {
      const r = parseGpx(gpx(`<trk><trkseg><trkpt lat="40.7712" lon="-73.9742"><time>${v}</time></trkpt></trkseg></trk>`));
      return [v, r.cols.n ? r.cols.t[0] : NaN];
    });
    expect(got).toEqual(times.map((v) => [v, parseIsoTime(v).t]));
  });

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

describe('a logger that repeats its last position (i-gotU)', () => {
  /**
   * A walk north at 1.4 m/s, a fix a second for 400 s, as i-gotU's software writes it (speed in the Garmin
   * extension). It repeats one fix from 21 s to 40 s (20 s, with a speed of 0) and another from 101 s to 260 s
   * (160 s), each time writing fresh satellites as it goes.
   */
  function igotu(creator = 'igotU_GPS_WIN') {
    const t0 = Date.UTC(2026, 5, 14, 13, 0, 0);
    const held = (i: number) => (i > 20 && i <= 40) || (i > 100 && i <= 260);
    let last = 0;
    const pts = Array.from({ length: 400 }, (_, i) => {
      const north = held(i) ? last : 1.4 * i;
      if (!held(i)) last = north;
      return `<trkpt lat="${(40.78 + north / 111_195).toFixed(9)}" lon="-73.965000000"><time>${new Date(t0 + i * 1000).toISOString().replace('.000Z', 'Z')}</time><sat>${7 + (i % 3)}</sat><extensions><gpxtpx:TrackPointExtension><gpxtpx:speed>${held(i) ? '0.0' : '1.4'}</gpxtpx:speed></gpxtpx:TrackPointExtension></extensions></trkpt>`;
    });
    return `<?xml version="1.0"?><gpx version="1.1" creator="${creator}" xmlns="http://www.topografix.com/GPX/1/1" xmlns:gpxtpx="http://www.garmin.com/xmlschemas/TrackPointExtension/v2"><trk><trkseg>${pts.join('')}</trkseg></trk></gpx>`;
  }

  it('drops the repeats when reading, and says how many', () => {
    const p = parseGpx(igotu());
    expect(p.cols.n).toBe(400 - 20 - 160);
    expect(Array.from(p.cols.speed).filter((v) => v === 0)).toEqual([]);
    expect(p.notes).toContainEqual({ kind: 'repeatsDropped', count: 180, long: 1 });
    // The step across 20 s of repeats is crossed; the one across 160 s isn't (it will be a gap).
    const at = (s: number) => Array.from(p.cols.t).indexOf(p.cols.t[0] + s * 1000);
    expect(p.bridged![at(41)]).toBe(1);
    expect(p.bridged![at(261)]).toBe(0);
    expect(Array.from(p.bridged!).reduce((a, b) => a + b, 0)).toBe(1);
  });

  it('keeps the track whole across short stretches of repeats and shows no 0s, with a gap for the long one', () => {
    const r = parseText(igotu(), 'walk.gpx');
    if (!r.ok) throw new Error(r.error);
    const d = r.track.derived, t = r.track.cols.t, at = (s: number) => Array.from(t).indexOf(t[0] + s * 1000);
    expect(d.gap[at(41)]).toBe(0);
    expect(d.gap[at(261)]).toBe(1);
    expect(d.stats.maxKmh).toBeLessThan(5.1);
    expect(Array.from(d.kmh).filter((v) => v < 1.5).length).toBeLessThan(3); // only the fixes either side of the gap
    expect(noteText(r.track.notes.find((x) => x.kind === 'repeatsDropped')!)).toBe('180 fixes that only repeated the position before them were dropped: this logger repeats its last position until it has a new one. The track goes straight across such stretches; 1 longer than 2 minutes count as gaps.');
  });

  it("keeps other loggers' repeats: a logger standing still repeats its position", () => {
    const p = parseGpx(igotu('Garmin Connect'));
    expect(p.cols.n).toBe(400);
    expect(p.bridged).toBeUndefined();
    expect(p.notes.some((x) => x.kind === 'repeatsDropped')).toBe(false);
  });

  it('starts a new segment after repeats that ran into one, rather than crossing it', () => {
    const t0 = Date.UTC(2026, 5, 14, 13, 0, 0);
    const p1 = (i: number, north: number) => `<trkpt lat="${(40.78 + north / 111_195).toFixed(9)}" lon="-73.965"><time>${new Date(t0 + i * 1000).toISOString()}</time></trkpt>`;
    const body = `<trkseg>${p1(0, 0)}${p1(1, 1.4)}${p1(2, 1.4)}</trkseg><trkseg>${p1(3, 1.4)}${p1(4, 5.6)}</trkseg>`;
    const p = parseGpx(`<?xml version="1.0"?><gpx version="1.1" creator="igotU_GPS_WIN"><trk>${body}</trk></gpx>`);
    expect(p.cols.n).toBe(3);
    expect(Array.from(p.cols.seg)).toEqual([0, 0, 1]);
    expect(Array.from(p.bridged!)).toEqual([0, 0, 0]);
  });
});
