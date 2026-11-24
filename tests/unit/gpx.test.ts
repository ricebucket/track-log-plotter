import { describe, expect, it } from 'vitest';
import { parseGpx, parseIsoTime } from '../../src/parse/gpx';
import { parseText } from '../../src/parse/index';
import { noteText } from '../../src/ui/labels';
import { fixture } from '../helpers/fixtures';
import { vendorGpx } from '../helpers/vendor-speed';

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

describe('a vendor speed without a unit', () => {
  const unitNote = (text: string) => parseGpx(text).notes.find((n) => n.kind === 'speedUnit');

  it('says the unit is a guess when the positions are too slow to compare: a walk in km/h is read as m/s', () => {
    // 1.3 m/s, written as 4.7 (km/h): below the pace at which speeds are compared with the positions.
    const p = parseGpx(vendorGpx(1.3));
    expect(p.notes.filter((n) => n.kind === 'speedUnit')).toEqual([{ kind: 'speedUnit', unit: 'ms', inferred: true, unsure: true }]);
    expect(p.cols.speed[60]).toBeCloseTo(4.7, 5);
  });

  it('is sure when the positions settle it: a run in km/h', () => {
    const p = parseGpx(vendorGpx(3));
    expect(p.notes.filter((n) => n.kind === 'speedUnit')).toEqual([{ kind: 'speedUnit', unit: 'kmh', inferred: true }]);
    expect(p.cols.speed[60]).toBeCloseTo(3, 5);
  });

  it('says the unit is a guess when the numbers fall between two units, and reads them in the nearer one', () => {
    // 2.9 times the speed in m/s: 19% under km/h, 30% over mph.
    expect(unitNote(vendorGpx(3, { field: (v) => v * 2.9 }))).toEqual({ kind: 'speedUnit', unit: 'kmh', inferred: true, unsure: true });
  });

  it('keeps a speed whose unit the file gives as it was', () => {
    const garmin = gpx(`<trk><trkseg>${pt(0, '<extensions><gpxtpx:TrackPointExtension><gpxtpx:speed>1.3</gpxtpx:speed></gpxtpx:TrackPointExtension></extensions>')}${pt(1)}</trkseg></trk>`);
    expect(unitNote(garmin)).toEqual({ kind: 'speedUnit', unit: 'ms', inferred: false });
    expect(unitNote(gpx(`<trk><trkseg>${pt(0, '<speed>1.3</speed>')}${pt(1)}</trkseg></trk>`))).toEqual({ kind: 'speedUnit', unit: 'ms', inferred: false });
  });
});

describe('a logger that repeats its last position', () => {
  /**
   * A walk north at 1.4 m/s, a fix a second for 400 s, as that logger's software writes it (speed in the Garmin
   * extension). It repeats the fix at 20 s until 40 s, and the one at 100 s until 260 s, writing fresh
   * satellites as it goes; like the logger, it writes the speed of 0 from the fix it repeats on.
   */
  // The creator its software writes, which the reader goes by (data, so it keeps the maker's name).
  const REPEATER = 'igotU_GPS_WIN';

  function repeater(creator = REPEATER, jumpM = 0) {
    const t0 = Date.UTC(2026, 5, 14, 13, 0, 0);
    const held = (i: number) => (i > 20 && i <= 40) || (i > 100 && i <= 260);
    let last = [0, 0];
    const pts = Array.from({ length: 400 }, (_, i) => {
      // jumpM: the fix at 20 s, which it repeats until 40 s, lands that far east of the path, as a position can.
      const at = held(i) ? last : [1.4 * i, i === 20 ? jumpM : 0];
      if (!held(i)) last = at;
      const [north, east] = at;
      return `<trkpt lat="${(40.78 + north / 111_195).toFixed(9)}" lon="${(-73.965 + east / 84_300).toFixed(9)}"><time>${new Date(t0 + i * 1000).toISOString().replace('.000Z', 'Z')}</time><sat>${7 + (i % 3)}</sat><extensions><gpxtpx:TrackPointExtension><gpxtpx:speed>${held(i) || held(i + 1) ? '0.0' : '1.4'}</gpxtpx:speed></gpxtpx:TrackPointExtension></extensions></trkpt>`;
    });
    return `<?xml version="1.0"?><gpx version="1.1" creator="${creator}" xmlns="http://www.topografix.com/GPX/1/1" xmlns:gpxtpx="http://www.garmin.com/xmlschemas/TrackPointExtension/v2"><trk><trkseg>${pts.join('')}</trkseg></trk></gpx>`;
  }

  it('drops the repeats when reading, and says how many', () => {
    const p = parseGpx(repeater());
    expect(p.cols.n).toBe(400 - 20 - 160);
    expect(p.notes).toContainEqual({ kind: 'repeatsDropped', count: 180, long: 1 });
    const at = (s: number) => Array.from(p.cols.t).indexOf(p.cols.t[0] + s * 1000);
    // Every speed kept stays as recorded: the 0s of the fixes it went on to repeat too (only combining leaves those out).
    expect(p.cols.speed[at(20)]).toBe(0);
    expect(p.cols.speed[at(100)]).toBe(0);
    expect(Array.from(p.cols.speed).filter((v) => v === 0)).toHaveLength(2);
    // The step across 20 s of repeats is crossed; the one across 160 s isn't (it will be a gap).
    expect(p.bridged![at(41)]).toBe(1);
    expect(p.bridged![at(261)]).toBe(0);
    expect(Array.from(p.bridged!).reduce((a, b) => a + b, 0)).toBe(1);
  });

  it('keeps the track whole across short stretches of repeats, with a gap for the long one', () => {
    const r = parseText(repeater(), 'walk.gpx');
    if (!r.ok) throw new Error(r.error);
    const d = r.track.derived, t = r.track.cols.t, at = (s: number) => Array.from(t).indexOf(t[0] + s * 1000);
    expect(d.gap[at(41)]).toBe(0);
    expect(d.gap[at(261)]).toBe(1);
    // Walking pace but for the two 0s it recorded; none of the repeats' 0s.
    expect(d.stats.maxKmh).toBeLessThan(5.1);
    expect(Array.from(d.kmh).filter((v) => v < 4.9)).toEqual([0, 0]);
    expect(noteText(r.track.notes.find((x) => x.kind === 'repeatsDropped')!)).toBe(
      '180 fixes that only repeated the position before them were dropped: this logger repeats its last position until it has a new one. The track goes straight across such stretches.'
      + ' 1 stretch longer than 2 minutes counts as a gap.');
    // Without a long stretch, no word of one.
    expect(noteText({ kind: 'repeatsDropped', count: 20, long: 0 })).not.toMatch(/longer than 2 minutes/);
  });

  it('works out no speed from positions that jump: the fix it repeats keeps its recorded 0', () => {
    // The fix at 20 s lands 28 m off the path, and the walk carries on along it: a speed worked out from
    // the positions either side would be 11 km/h.
    const r = parseText(repeater(REPEATER, 28), 'walk.gpx');
    if (!r.ok) throw new Error(r.error);
    const t = r.track.cols.t;
    expect(r.track.derived.kmh[Array.from(t).indexOf(t[0] + 20_000)]).toBe(0);
    expect(r.track.derived.stats.maxKmh).toBeLessThan(5.1);
  });

  it("keeps other loggers' repeats and their speeds: a logger standing still repeats its position", () => {
    const p = parseGpx(repeater('Garmin Connect'));
    expect(p.cols.n).toBe(400);
    expect(p.cols.speed[20]).toBe(0);
    expect(p.bridged).toBeUndefined();
    expect(p.notes.some((x) => x.kind === 'repeatsDropped')).toBe(false);
  });

  it('starts a new segment after repeats that ran into one, rather than crossing it', () => {
    const t0 = Date.UTC(2026, 5, 14, 13, 0, 0);
    const p1 = (i: number, north: number) => `<trkpt lat="${(40.78 + north / 111_195).toFixed(9)}" lon="-73.965"><time>${new Date(t0 + i * 1000).toISOString()}</time></trkpt>`;
    const body = `<trkseg>${p1(0, 0)}${p1(1, 1.4)}${p1(2, 1.4)}</trkseg><trkseg>${p1(3, 1.4)}${p1(4, 5.6)}</trkseg>`;
    const p = parseGpx(`<?xml version="1.0"?><gpx version="1.1" creator="${REPEATER}"><trk>${body}</trk></gpx>`);
    expect(p.cols.n).toBe(3);
    expect(Array.from(p.cols.seg)).toEqual([0, 0, 1]);
    expect(Array.from(p.bridged!)).toEqual([0, 0, 0]);
  });
});

describe('reading odd or damaged GPX', () => {
  const trk = (pts: string) => gpx(`<trk><trkseg>${pts}</trkseg></trk>`);

  it('names extension fields called "constructor" and "__proto__" as they are, and the result can be sent to the page', () => {
    const ext = '<extensions><constructor>1</constructor><__proto__>2</__proto__></extensions>';
    const r = parseText(trk(pt(0, ext) + pt(1, ext)), 'odd.gpx');
    if (!r.ok) throw new Error(r.error);
    expect(r.track.notes).toContainEqual({ kind: 'ignored', fields: ['__proto__', 'constructor'] });
    expect(() => structuredClone(r)).not.toThrow();
  });

  it('reads an empty value as missing, not as 0', () => {
    const empty = pt(0, '<sat/><geoidheight></geoidheight><course> </course>').replace('<ele>20</ele>', '<ele></ele>');
    const p = parseGpx(trk(empty + pt(1, '<sat>8</sat><geoidheight>-32.6</geoidheight><course>90</course>')));
    expect(p.cols.n).toBe(2);
    for (const k of ['ele', 'sats', 'geoid', 'course'] as const) expect(p.cols[k][0], k).toBeNaN();
    expect([p.cols.ele[1], p.cols.sats[1], p.cols.course[1]]).toEqual([21, 8, 90]);
  });

  it('skips a point whose position is blank, off the Earth or 0, 0, and counts it with those without a position', () => {
    const bad = ['lat="" lon="-73.965"', 'lat="40.78" lon=""', 'lat="95.1" lon="-73.965"', 'lat="0" lon="0"'];
    const pts = bad.map((a, i) => `<trkpt ${a}><time>2026-06-14T13:05:0${i}Z</time></trkpt>`).join('');
    const p = parseGpx(trk(pts + pt(5) + pt(6) + pt(7, '<fix>none</fix>')));
    expect(p.cols.n).toBe(2);
    expect(p.notes).toContainEqual({ kind: 'void', count: 5 });
  });

  it('notes points without a time apart from points without a position', () => {
    const p = parseGpx(trk(`<trkpt lat="40.7801" lon="-73.965"></trkpt><trkpt lat="40.7802" lon="-73.965"><ele>3</ele></trkpt>${pt(3, '<fix>none</fix>')}${pt(4)}${pt(5)}`));
    expect(p.cols.n).toBe(2);
    expect(p.notes.filter((n) => n.kind === 'timeless' || n.kind === 'void')).toEqual([{ kind: 'void', count: 1 }, { kind: 'timeless', count: 2 }]);
    expect(noteText({ kind: 'timeless', count: 2 })).toBe('2 fixes without a time were skipped.');
    expect(noteText({ kind: 'timeless', count: 1 })).toBe('1 fix without a time was skipped.');
  });

  it('reads a time zone given in hours alone', () => {
    expect(parseIsoTime('2026-06-14T09:05:00-04')).toEqual({ t: Date.UTC(2026, 5, 14, 13, 5), zoned: true });
    expect(parseIsoTime('2026-06-14T15:05:00.5+02').t).toBe(Date.UTC(2026, 5, 14, 13, 5, 0, 500));
    const p = parseGpx(trk('<trkpt lat="40.78" lon="-73.965"><time>2026-06-14T09:05:00-04</time></trkpt>'));
    expect(Array.from(p.cols.t)).toEqual([Date.UTC(2026, 5, 14, 13, 5)]);
    expect(p.notes).not.toContainEqual({ kind: 'noZone' });
  });

  it('ignores a close tag for an element that isn\'t open, and keeps reading the point', () => {
    const p = parseGpx(trk(`${pt(0)}<trkpt lat="40.7801" lon="-73.965"></ele><ele>21</ele></sat><time>2026-06-14T13:05:01Z</time></extensions></trkpt>${pt(2)}`));
    expect(p.cols.n).toBe(3);
    expect(p.cols.ele[1]).toBe(21);
    expect(p.problems).toEqual([]);
  });

  it('reads the waypoints after one with a damaged close tag as waypoints of their own', () => {
    const w = (i: number, close = '</wpt>') => `<wpt lat="40.78${i}" lon="-73.96${i}"><time>2026-06-14T13:0${i}:00Z</time><name>00${i}</name>${close}`;
    const p = parseGpx(gpx(`${w(1, '</t>')}${w(2)}${w(3)}<trk><trkseg>${pt(0)}${pt(1)}</trkseg></trk>`));
    expect(p.flags.map((f) => [f.name, f.lat, f.lon, f.t])).toEqual([
      ['002', 40.782, -73.962, Date.UTC(2026, 5, 14, 13, 2)],
      ['003', 40.783, -73.963, Date.UTC(2026, 5, 14, 13, 3)],
    ]);
    expect(p.cols.n).toBe(2);
  });

  it('closes what a close tag leaves open inside it', () => {
    // <ele> and <hdop> never closed: </trkpt> closes them with the point.
    const p = parseGpx(trk(`<trkpt lat="40.7801" lon="-73.965"><time>2026-06-14T13:05:01Z</time><hdop>0.9</hdop><ele>21</trkpt>${pt(2)}`));
    expect(p.cols.n).toBe(2);
    expect(p.cols.hdop[0]).toBeCloseTo(0.9);
    expect([...p.cols.seg]).toEqual([0, 0]);
  });

  it('reads a value whose open or close tag is garbled, and keeps the point after a stray close tag', () => {
    const at = (i: number) => `<trkpt lat="40.78${i}" lon="-73.965"><time>2026-06-14T13:05:0${i}Z</time>`;
    const p = parseGpx(trk(`${at(1)}<c#ourse>120</course><hdoxp>2.5</hdop><fix>dgps</fix></trkpt>${at(2)}<ele>5</el><sat>7</sat></trkpt>${at(3)}<ele>9</ele></el></trkpt>`));
    expect(p.cols.n).toBe(3);
    expect(p.cols.course[0]).toBe(120);
    expect(p.cols.hdop[0]).toBeCloseTo(2.5);
    expect(p.cols.fixq[0]).toBe(2);
    expect(p.cols.ele[1]).toBe(5);
    expect(p.cols.sats[1]).toBe(7);
    expect(p.cols.ele[2]).toBe(9);
  });

  it('handles any number of stray or unclosed tags in one pass', () => {
    const n = 50_000;
    for (const body of ['<a>'.repeat(n) + '</b>'.repeat(n), '<trk>' + '<a>'.repeat(n) + '</trk>'.repeat(n)]) {
      // How quickly: tests/unit/performance.test.ts.
      const p = parseGpx(`<gpx version="1.1">${body}</gpx>`);
      expect(p.problems).toContainEqual({ kind: 'noFixes' });
    }
  });
});
