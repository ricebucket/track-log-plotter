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
const ROUTES = {
  centralPark: [
    [40.7681, -73.9812], [40.7722, -73.9787], [40.7769, -73.9757], [40.7818, -73.9722], [40.7866, -73.9688],
    [40.7912, -73.9655], [40.7951, -73.9625], [40.7983, -73.9588], [40.7994, -73.9548], [40.7975, -73.9520],
    [40.7930, -73.9530], [40.7880, -73.9562], [40.7830, -73.9598], [40.7779, -73.9634], [40.7730, -73.9668],
    [40.7686, -73.9700], [40.7660, -73.9745], [40.7664, -73.9790], [40.7681, -73.9812],
  ],
  rooseveltIsland: [
    [40.7531, -73.9634], [40.7570, -73.9598], [40.7612, -73.9561], [40.7655, -73.9522], [40.7697, -73.9472],
    [40.7718, -73.9431], [40.7703, -73.9418], [40.7664, -73.9461], [40.7622, -73.9503], [40.7580, -73.9545],
    [40.7543, -73.9592], [40.7524, -73.9625], [40.7531, -73.9634],
  ],
  hudson: [
    [40.7046, -74.0166], [40.7110, -74.0168], [40.7203, -74.0129], [40.7305, -74.0108], [40.7420, -74.0093],
    [40.7535, -74.0068], [40.7640, -73.9985], [40.7740, -73.9915], [40.7860, -73.9840], [40.7975, -73.9760],
    [40.8085, -73.9682], [40.8190, -73.9600],
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

// Sample ride for the app: track A's log ends on a cut-off line.
const truncatedA = nmeaA.join('\n') + '\n' + nmeaA[4].slice(0, 28); // an RMC sentence cut after 28 characters
write('public/sample/central-park-loop.nmea', truncatedA);
write('public/sample/central-park-loop.gpx', gpxB);
write('public/sample/roosevelt-island-run.gpx', gpxRun);

// Test fixtures.
write('tests/fixtures/central-park-loop.nmea', nmeaA.join('\r\n') + '\r\n');
write('tests/fixtures/central-park-loop-truncated.nmea', truncatedA);
write('tests/fixtures/central-park-loop-vendor.gpx', gpxB);
write('tests/fixtures/central-park-loop-garmin.gpx', gpxGarmin);
write('tests/fixtures/roosevelt-island-run.gpx', gpxRun);
write('tests/fixtures/hudson-greenway-evening.log', nmeaEvening.join('\n') + '\n');

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
