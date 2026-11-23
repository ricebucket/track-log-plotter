// Generates the synthetic New York City track logs used by the tests and by
// the app's sample ride. Everything is made up: routes follow public parks and
// paths in New York City, with invented timing, speeds and receiver numbers.
// Run with: npm run fixtures
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const RAD = Math.PI / 180;
const R = 6371008.8;
function dist(a, b) {
  const dLat = (b[0] - a[0]) * RAD, dLon = (b[1] - a[1]) * RAD;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * RAD) * Math.cos(b[0] * RAD) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
function bearing(a, b) {
  const y = Math.sin((b[1] - a[1]) * RAD) * Math.cos(b[0] * RAD);
  const x = Math.cos(a[0] * RAD) * Math.sin(b[0] * RAD) - Math.sin(a[0] * RAD) * Math.cos(b[0] * RAD) * Math.cos((b[1] - a[1]) * RAD);
  return (Math.atan2(y, x) / RAD + 360) % 360;
}

// Routes (approximate public paths, New York City).
// Waypoints along real places, checked against OpenStreetMap outlines so every
// 10 m stays on land: the ride on Central Park's drives, the run around
// Roosevelt Island's shore, the evening ride along Manhattan's Hudson edge.
// Derived from map data © OpenStreetMap contributors (ODbL).
const ROUTES = {
  centralPark: [
    [40.76856, -73.98010], [40.76566, -73.97343], [40.76916, -73.97114], [40.77257, -73.96864], [40.77590, -73.96595],
    [40.77923, -73.96326], [40.78264, -73.96077], [40.78613, -73.95848], [40.78963, -73.95618], [40.79304, -73.95369],
    [40.79637, -73.95100], [40.79928, -73.95769], [40.79578, -73.95998], [40.79237, -73.96247], [40.78904, -73.96516],
    [40.78571, -73.96785], [40.78230, -73.97034], [40.77880, -73.97263], [40.77530, -73.97492], [40.77189, -73.97741],
    [40.76856, -73.98010],
  ],
  rooseveltIsland: [
    [40.75002, -73.96107], [40.74999, -73.96101], [40.75111, -73.95977], [40.75159, -73.95935], [40.75218, -73.95841],
    [40.75292, -73.95751], [40.75492, -73.95558], [40.75661, -73.95347], [40.75697, -73.95325], [40.75748, -73.95272],
    [40.75859, -73.95215], [40.75899, -73.95160], [40.76004, -73.95070], [40.76078, -73.94974], [40.76396, -73.94706],
    [40.76601, -73.94518], [40.76742, -73.94419], [40.76845, -73.94326], [40.76923, -73.94218], [40.76956, -73.94151],
    [40.77096, -73.94058], [40.77200, -73.94064], [40.77253, -73.94036], [40.77258, -73.94046], [40.77227, -73.94070],
    [40.77186, -73.94179], [40.77030, -73.94340], [40.76956, -73.94440], [40.76898, -73.94479], [40.76860, -73.94491],
    [40.76858, -73.94502], [40.76812, -73.94536], [40.76801, -73.94557], [40.76404, -73.94874], [40.76407, -73.94889],
    [40.76338, -73.94971], [40.76152, -73.95126], [40.76064, -73.95175], [40.75979, -73.95263], [40.75987, -73.95278],
    [40.75961, -73.95305], [40.75956, -73.95297], [40.75773, -73.95470], [40.75687, -73.95533], [40.75376, -73.95811],
    [40.75314, -73.95893], [40.75166, -73.95967], [40.75055, -73.96080], [40.75006, -73.96114], [40.75002, -73.96107],
  ],
  hudson: [
    [40.70460, -74.01660], [40.71100, -74.01644], [40.72030, -74.01236], [40.73050, -74.01062], [40.74200, -74.00930],
    [40.75350, -74.00680], [40.76400, -73.99850], [40.77400, -73.99150], [40.78600, -73.98400], [40.79750, -73.97600],
    [40.80850, -73.96820], [40.81900, -73.96000],
  ],
};

/** Walks a route at a speed profile, one fix per interval, with GPS-like noise. */
function simulate({ route, start, interval, kmh, seed, eleBase, eleAmp, gapAt, gapS, laps = 1 }) {
  const rand = rng(seed);
  const pts = [];
  for (let l = 0; l < laps; l++) pts.push(...(l ? route.slice(1) : route));
  const segLen = [];
  let total = 0;
  for (let i = 1; i < pts.length; i++) { const d = dist(pts[i - 1], pts[i]); segLen.push(d); total += d; }
  const fixes = [];
  let s = 0, t = start, nx = 0, ny = 0, seg = 0, segStart = 0;
  while (s < total) {
    while (seg < segLen.length - 1 && s > segStart + segLen[seg]) { segStart += segLen[seg]; seg++; }
    const f = Math.min(1, (s - segStart) / segLen[seg]);
    const a = pts[seg], b = pts[seg + 1];
    const lat0 = a[0] + (b[0] - a[0]) * f, lon0 = a[1] + (b[1] - a[1]) * f;
    nx = nx * 0.85 + (rand() - 0.5) * 1.2;
    ny = ny * 0.85 + (rand() - 0.5) * 1.2;
    const lat = lat0 + ny / 111320, lon = lon0 + nx / (111320 * Math.cos(lat0 * RAD));
    const phase = s / total;
    const v = Math.max(0.6, kmh(phase, rand)) / 3.6;
    const ele = eleBase + eleAmp * (Math.sin(phase * Math.PI * 2 * laps - 1.2) * 0.6 + Math.sin(phase * Math.PI * 6 * laps) * 0.4) + (rand() - 0.5) * 1.6;
    fixes.push({ t, lat, lon, v, course: bearing(a, b), ele, phase });
    s += v * interval;
    t += interval * 1000;
    if (gapAt !== undefined && Math.abs(phase - gapAt) < (v * interval) / total) { t += gapS * 1000; s += v * gapS; }
  }
  return fixes;
}

const pad = (n, w = 2) => String(n).padStart(w, '0');
const iso = (t) => new Date(t).toISOString().replace('.000Z', 'Z');

function nmeaCoord(v, degDigits) {
  const a = Math.abs(v);
  const d = Math.floor(a);
  const m = (a - d) * 60;
  return pad(d, degDigits) + m.toFixed(5).padStart(8, '0');
}
function cs(body) {
  let x = 0;
  for (let i = 0; i < body.length; i++) x ^= body.charCodeAt(i);
  return x.toString(16).toUpperCase().padStart(2, '0');
}
const sentence = (body) => `$${body}*${cs(body)}`;

function toNmea(fixes, { rand, sbasEvery = 0, gsv = true }) {
  const out = [];
  fixes.forEach((f, i) => {
    const d = new Date(f.t);
    const tod = `${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}.00`;
    const date = `${pad(d.getUTCDate())}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCFullYear() % 100)}`;
    const lat = nmeaCoord(f.lat, 2), lon = nmeaCoord(f.lon, 3);
    const sbas = sbasEvery > 0 && Math.floor(i / sbasEvery) % 3 === 1;
    const knots = (f.v * 3600) / 1852;
    const cog = knots < 1.2 ? '' : f.course.toFixed(1);
    const sats = 7 + Math.floor(rand() * 6);
    const hdop = (0.6 + rand() * 0.9).toFixed(2);
    out.push(sentence(`GNRMC,${tod},A,${lat},N,${lon},W,${knots.toFixed(3)},${cog},${date},,,${sbas ? 'D' : 'A'},V`));
    out.push(sentence(`GNGGA,${tod},${lat},N,${lon},W,${sbas ? 2 : 1},${pad(sats)},${hdop},${f.ele.toFixed(1)},M,-32.6,M,,`));
    out.push(sentence(`GNGSA,A,3,02,05,07,09,13,15,18,20,,,,,${(Number(hdop) * 1.7).toFixed(2)},${hdop},${(Number(hdop) * 1.4).toFixed(2)},1`));
    if (gsv && i % 5 === 0) out.push(sentence('GPGSV,3,1,12,02,45,120,38,05,30,200,35,07,60,045,41,09,15,300,29'));
  });
  return out;
}

function gpxHeader(creator, name) {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<gpx version="1.1" creator="${creator}" xmlns="http://www.topografix.com/GPX/1/1" xmlns:gpxtpx="http://www.garmin.com/xmlschemas/TrackPointExtension/v2" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">`,
    `  <metadata><name>${name}</name></metadata>`,
  ];
}

function toGpx(fixes, { creator, name, rand, mode, flags = [], gapIdx = -1 }) {
  const lines = gpxHeader(creator, name);
  for (const fl of flags) {
    const f = fixes[fl];
    lines.push(`  <wpt lat="${f.lat.toFixed(7)}" lon="${f.lon.toFixed(7)}"><time>${iso(f.t)}</time><name>${pad(flags.indexOf(fl) + 1, 3)}</name></wpt>`);
  }
  lines.push('  <trk>', `    <name>${name}</name>`, '    <trkseg>');
  fixes.forEach((f, i) => {
    if (i === gapIdx) lines.push('    </trkseg>', '    <trkseg>');
    const p = [`      <trkpt lat="${f.lat.toFixed(7)}" lon="${f.lon.toFixed(7)}">`, `<ele>${f.ele.toFixed(1)}</ele>`, `<time>${iso(f.t)}</time>`];
    if (mode === 'garmin') {
      const sats = 7 + Math.floor(rand() * 6);
      p.push(`<sat>${sats}</sat>`, `<hdop>${(0.6 + rand() * 0.9).toFixed(1)}</hdop>`, `<fix>${i % 600 > 400 ? 'dgps' : '3d'}</fix>`);
      p.push(`<extensions><gpxtpx:TrackPointExtension><gpxtpx:speed>${f.v.toFixed(2)}</gpxtpx:speed><gpxtpx:course>${f.course.toFixed(1)}</gpxtpx:course></gpxtpx:TrackPointExtension></extensions>`);
    } else if (mode === 'vendor') {
      // Non-standard HDOP: 0.16 steps, never below 3.04, unrelated to satellites.
      p.push(`<hdop>${(3.04 + 0.16 * Math.floor(rand() * 40)).toFixed(2)}</hdop>`);
      p.push(`<extensions><speed>${(f.v * 3.6).toFixed(1)}</speed><course>${f.course.toFixed(0)}</course><satinview>12</satinview></extensions>`);
    } else if (mode === 'gpx10') {
      p.push(`<speed>${f.v.toFixed(2)}</speed>`);
    }
    p.push('</trkpt>');
    lines.push(p.join(''));
  });
  lines.push('    </trkseg>', '  </trk>', '</gpx>', '');
  return lines.join('\n');
}

/**
 * A Columbus Fusion log (CSV): a "# Format=" line, a header row, then
 * one row per fix, with the tag and the date only where they change. After a
 * pause in logging the first fix is tagged G and the next T. With motion data,
 * each fix row carries an accelerometer reading (in g) and is followed by nine
 * rows of readings alone: ten a second. The clock is the logger's local time,
 * `clockH` hours from UTC, with no zone in the file.
 */
function toCsv(fixes, { rand, clockH, motion = false, pauseAfter = -1, pauseS = 0, marks = [], bumps = [] }) {
  const out = [`# Format=ColumbusFusion; Version=1.0; Type=${motion ? 'GNSS+IMU' : 'GNSS'}`, `tag,date,time,lat,lon,alt,speed,heading${motion ? ',ax,ay,az' : ''}`];
  // Gravity as the logger sees it, tilted a little in its mount.
  const g = [0.05, 0.12, 0.99];
  const len = Math.hypot(...g);
  for (let k = 0; k < 3; k++) g[k] /= len;
  let lastDate = '';
  fixes.forEach((f, i) => {
    const d = new Date(f.t + clockH * 3600_000 + (i > pauseAfter && pauseAfter >= 0 ? pauseS * 1000 : 0));
    const date = `${pad(d.getUTCFullYear() % 100)}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}`;
    const time = `${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}`;
    const tag = i === 0 ? 'T' : i === pauseAfter + 1 ? 'G' : i === pauseAfter + 2 ? 'T' : marks.includes(i) ? 'C' : '';
    const row = [tag, date !== lastDate ? date : '', time, f.lat.toFixed(7), f.lon.toFixed(7), f.ele.toFixed(1), (f.v * 3.6).toFixed(1), f.course.toFixed(1)];
    lastDate = date;
    if (!motion) { out.push(row.join(',')); return; }
    // Speeding up or slowing down pushes along the logger's x axis; the road adds a little buzz, and a bump a jolt.
    const along = ((fixes[Math.min(i + 1, fixes.length - 1)].v - f.v) / 9.81) * 0.5;
    for (let k = 0; k < 10; k++) {
      const jolt = bumps.includes(i) && k === 4 ? 0.9 : 0;
      const a = [g[0] + along + (rand() - 0.5) * 0.04, g[1] + (rand() - 0.5) * 0.04, g[2] + (rand() - 0.5) * 0.06 + jolt].map((v) => v.toFixed(2));
      out.push((k === 0 ? row : Array(8).fill('')).concat(a).join(','));
    }
  });
  return out.join('\r\n') + '\r\n';
}

function write(rel, text) {
  const p = join(root, rel);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, text);
  console.log('wrote', rel, `(${text.length} bytes)`);
}

// Ride on June 14, 2026, 09:05 New York time (13:05 UTC), two loggers.
const rideStart = Date.UTC(2026, 5, 14, 13, 5, 0);
const rideKmh = (p, r) => 22 + 6 * Math.sin(p * Math.PI * 4) - (p > 0.315 && p < 0.317 ? 18 : 0) + (r() - 0.5) * 3;
const ride = simulate({ route: ROUTES.centralPark, start: rideStart, interval: 1, kmh: rideKmh, seed: 7, eleBase: 30, eleAmp: 14, gapAt: 0.62, gapS: 45 });
const rideB = simulate({ route: ROUTES.centralPark, start: rideStart + 3000, interval: 5, kmh: rideKmh, seed: 8, eleBase: 31, eleAmp: 14 });

// Run on Roosevelt Island, June 21, 2026, 07:40 New York time.
const run = simulate({ route: ROUTES.rooseveltIsland, start: Date.UTC(2026, 5, 21, 11, 40, 0), interval: 2, kmh: (p, r) => 10.5 + 1.2 * Math.sin(p * 9) + (r() - 0.5), seed: 21, eleBase: 6, eleAmp: 2 });

// Evening ride on the Hudson River Greenway, crossing midnight UTC.
const evening = simulate({ route: ROUTES.hudson, start: Date.UTC(2026, 6, 2, 23, 40, 0), interval: 1, kmh: (p, r) => 19 + 3 * Math.sin(p * 12) + (r() - 0.5) * 2, seed: 33, eleBase: 4, eleAmp: 2 });

const nmeaA = toNmea(ride, { rand: rng(101), sbasEvery: 240 });
const gpxB = toGpx(rideB, { creator: 'Synthetic logger B', name: 'Central Park loop', rand: rng(102), mode: 'vendor', flags: [121, 296] });
const gpxGarmin = toGpx(ride, { creator: 'Garmin-style test file', name: 'Central Park loop', rand: rng(103), mode: 'garmin', flags: [400], gapIdx: 900 });
const gpxRun = toGpx(run, { creator: 'Synthetic GPX 1.0 file', name: 'Roosevelt Island run', rand: rng(104), mode: 'gpx10' }).replace('version="1.1"', 'version="1.0"').replace('http://www.topografix.com/GPX/1/1', 'http://www.topografix.com/GPX/1/0');
const nmeaEvening = toNmea(evening, { rand: rng(105), sbasEvery: 0, gsv: false });

// An evening ride up the Hudson (7:30 PM in New York, crossing midnight UTC),
// then the ride back the next morning after a night's stop: one log spanning
// two dates both in New York and in UTC, with a gap overnight.
const eveningUp = simulate({ route: ROUTES.hudson, start: Date.UTC(2026, 6, 11, 23, 30, 0), interval: 5, kmh: (p, r) => 16 + 2 * Math.sin(p * 10) + (r() - 0.5) * 2, seed: 44, eleBase: 5, eleAmp: 2 });
const morningBack = simulate({ route: ROUTES.hudson.toReversed(), start: Date.UTC(2026, 6, 12, 11, 40, 0), interval: 5, kmh: (p, r) => 15 + 2 * Math.sin(p * 9) + (r() - 0.5) * 2, seed: 45, eleBase: 5, eleAmp: 2 });
const gpxOvernight = toGpx([...eveningUp, ...morningBack], { creator: 'Synthetic GPX file', name: 'Hudson overnight', rand: rng(107), mode: 'garmin', gapIdx: eveningUp.length });

// Sample ride for the app: clean files, so a first look shows no problems.
// (The cut-off version below is a test fixture only.)
const truncatedA = nmeaA.join('\n') + '\n' + nmeaA[4].slice(0, 28); // an RMC sentence cut after 28 characters
write('public/sample/central-park-loop.nmea', nmeaA.join('\n') + '\n');
write('public/sample/roosevelt-island-run.gpx', gpxRun);

// Test fixtures.
write('tests/fixtures/central-park-loop.nmea', nmeaA.join('\r\n') + '\r\n');
write('tests/fixtures/central-park-loop-truncated.nmea', truncatedA);
write('tests/fixtures/central-park-loop-vendor.gpx', gpxB);
write('tests/fixtures/central-park-loop-garmin.gpx', gpxGarmin);
write('tests/fixtures/roosevelt-island-run.gpx', gpxRun);
write('tests/fixtures/hudson-greenway-evening.log', nmeaEvening.join('\n') + '\n');
write('tests/fixtures/hudson-overnight.gpx', gpxOvernight);
// CSV logs on a New York clock (UTC−4 in June): the ride with motion data
// (six minutes, a 95-second pause, two bumps) and the run without.
write('tests/fixtures/central-park-loop-motion.csv', toCsv(ride.slice(0, 360), { rand: rng(108), clockH: -4, motion: true, pauseAfter: 180, pauseS: 95, bumps: [60, 250] }));
write('tests/fixtures/roosevelt-island-run.csv', toCsv(run, { rand: rng(109), clockH: -4, marks: [200] }));

// A damaged NMEA log: every kind of damage the reader handles, in one file.
const dmg = toNmea(ride.slice(0, 120), { rand: rng(106), gsv: false });
dmg[30] = dmg[30].replace(/\*[0-9A-F]{2}$/, '*00'); // bad checksum
dmg[45] = dmg[45] + dmg[46]; // glued sentences
dmg.splice(46, 1);
dmg[60] = '\u0000ÿ' + dmg[60]; // stray bytes before a sentence
const back = toNmea([{ ...ride[10], t: ride[10].t }], { rand: rng(107), gsv: false });
dmg.splice(90, 0, ...back.slice(0, 2)); // a fix from earlier: time runs backwards
const spike = toNmea([{ ...ride[100], lat: ride[100].lat + 0.2 }], { rand: rng(108), gsv: false });
const k = dmg.findIndex((l) => l.includes(new Date(ride[100].t).toISOString().slice(11, 19).replace(/:/g, '')));
dmg.splice(k, 3, ...spike.slice(0, 3)); // one fix jumps 22 km away
write('tests/fixtures/damaged.nmea', dmg.join('\n') + '\n' + dmg[5].slice(0, 30));

// A GPX file that stops in the middle of a track point.
const g = gpxRun.split('\n');
write('tests/fixtures/roosevelt-island-run-cut.gpx', g.slice(0, 200).join('\n') + '\n      <trkpt lat="40.76');
