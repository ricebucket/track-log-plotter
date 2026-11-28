// Synthetic logs for the combining tests and their timing checks: walks in
// Central Park read from GPX, and long loops built straight into columns.
import { parseText } from '../../src/parse/index';
import { ColumnBuilder } from '../../src/parse/columns';
import { derive } from '../../src/derive/derive';
import type { LoadedTrack, ParsedTrack } from '../../src/model/types';

/** Metres per degree of latitude, near New York. */
export const KY = 110_540;

export interface Walk { offsetM?: number; shiftS?: number; noise?: number; seconds?: number; gap?: [number, number]; hold?: [number, number]; holds?: (i: number) => boolean; holdSpeed?: number; zero?: (i: number) => boolean; creator?: string; hdop?: (i: number) => number; seed?: number; drop?: number[]; speed?: boolean; ele?: number; step?: number; stray?: number }
/**
 * A walk at 1.5 m/s, a fix a second, as GPX: east for 150 s, then north (a clock
 * offset only shows where the way turns), each fix up to `noise` m off (0.8). `offsetM` puts it that far north;
 * `step` keeps a fix every that many seconds; `stray` adds a lone fix that many
 * seconds before the start.
 */
export function walk(o: Walk = {}): LoadedTrack {
  const t0 = Date.UTC(2026, 5, 14, 9, 0, 0) + (o.shiftS ?? 0) * 1000;
  let seed = o.seed ?? 1;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5) * 2;
  const lines: string[] = [];
  if (o.stray !== undefined) lines.push(`<trkpt lat="40.7722000" lon="-73.9742000"><time>${new Date(t0 - o.stray * 1000).toISOString().replace('.000Z', 'Z')}</time></trkpt>`);
  let lastLat = 0, lastLon = 0;
  for (let i = 0; i < (o.seconds ?? 300); i++) {
    // Noise is drawn for every second, so skipping a fix doesn't change the others.
    const east = Math.min(i, 150) * 1.5, north = Math.max(0, i - 150) * 1.5;
    const noise = o.noise ?? 0.8;
    let lat = 40.7712 + ((o.offsetM ?? 0) + north + rnd() * noise) / KY;
    let lon = -73.9742 + (east + rnd() * noise) / (KY * Math.cos((40.7712 * Math.PI) / 180));
    // A logger holding its position: it repeats its last fix (and, some, a speed of 0) until it has a new one.
    const holding = (o.hold && i > o.hold[0] && i < o.hold[1]) || o.holds?.(i);
    if (holding) { lat = lastLat; lon = lastLon; }
    lastLat = lat; lastLon = lon;
    if (o.gap && i >= o.gap[0] && i < o.gap[1]) continue;
    if (o.drop?.includes(i) || (o.step && i % o.step)) continue;
    const time = new Date(t0 + i * 1000).toISOString().replace('.000Z', 'Z');
    const extra = `${o.ele === undefined ? '' : `<ele>${o.ele}</ele>`}${o.hdop ? `<hdop>${o.hdop(i).toFixed(1)}</hdop>` : ''}${o.speed === false ? '' : `<extensions><gpxtpx:TrackPointExtension><gpxtpx:speed>${holding && o.holdSpeed !== undefined ? o.holdSpeed.toFixed(2) : o.zero?.(i) ? '0.00' : '1.50'}</gpxtpx:speed></gpxtpx:TrackPointExtension></extensions>`}`;
    lines.push(`<trkpt lat="${lat.toFixed(7)}" lon="${lon.toFixed(7)}"><time>${time}</time>${extra}</trkpt>`);
  }
  const gpx = `<?xml version="1.0"?><gpx version="1.1" creator="${o.creator ?? 'test'}" xmlns="http://www.topografix.com/GPX/1/1" xmlns:gpxtpx="http://www.garmin.com/xmlschemas/TrackPointExtension/v2"><trk><trkseg>${lines.join('')}</trkseg></trk></gpx>`;
  const r = parseText(gpx, `walk-${o.offsetM ?? 0}-${o.seed ?? 1}.gpx`);
  if (!r.ok) throw new Error(r.error);
  return r.track;
}

/**
 * A log built straight into columns from a function of the second: `pos(i)` gives metres east and north of a
 * corner of Central Park, a fix every second from 9:00 UTC on 14 June 2026 (`leadS` later: a clock that fast),
 * those `keep` keeps. `pos` is called for every second, so leaving fixes out doesn't change the others.
 */
export function logAt(n: number, pos: (i: number) => [number, number], o: { leadS?: number; file?: string; keep?: (i: number) => boolean } = {}): LoadedTrack {
  const b = new ColumnBuilder(), kx = KY * Math.cos((40.7712 * Math.PI) / 180), t0 = Date.UTC(2026, 5, 14, 9, 0, 0) + (o.leadS ?? 0) * 1000;
  for (let i = 0; i < n; i++) {
    const [east, north] = pos(i);
    if (o.keep && !o.keep(i)) continue;
    b.push({ t: t0 + i * 1000, lat: 40.7712 + north / KY, lon: -73.9742 + east / kx, line: i + 1 });
  }
  const p: ParsedTrack = { format: 'gpx', creator: null, name: null, cols: b.build(), flags: [], problems: [], notes: [], fields: ['time', 'position'], lines: n };
  return { ...p, file: o.file ?? 'log.gpx', sizeBytes: 0, derived: derive(p) };
}

/** Noise about 1 m across (a sum of uniforms, near normal with sd 1), the same for a seed every run. */
export function noiseFrom(seed: number): () => number {
  let s = seed;
  const u = () => ((s = (s * 16807) % 2147483647) / 2147483647 - 0.5) * 2;
  return () => (u() + u() + u() + u()) * 0.866;
}

/**
 * A long log looping around Central Park, built straight into columns: `n`
 * fixes `stepS` apart (those `keep` keeps), each recording `speed`.
 */
export function loop(n: number, o: { northM?: number; seed?: number; speed?: number; stepS?: number; keep?: (i: number) => boolean } = {}): LoadedTrack {
  const b = new ColumnBuilder(), kx = KY * Math.cos((40.7812 * Math.PI) / 180), t0 = Date.UTC(2026, 5, 14, 8, 0, 0);
  let seed = o.seed ?? 1;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5) * 2;
  for (let i = 0; i < n; i++) {
    const north = 0.01 * KY * Math.sin(i / 600) + (o.northM ?? 0) + rnd() * 0.8, east = 0.008 * kx * Math.cos(i / 600) + rnd() * 0.8;
    if (o.keep && !o.keep(i)) continue;
    b.push({ t: t0 + i * (o.stepS ?? 1) * 1000, lat: 40.7812 + north / KY, lon: -73.9665 + east / kx, speed: o.speed ?? 1.5, line: i + 1 });
  }
  const p: ParsedTrack = { format: 'gpx', creator: null, name: null, cols: b.build(), flags: [], problems: [], notes: [], fields: ['time', 'position', 'speed'], lines: n };
  return { ...p, file: `loop-${o.seed ?? 1}.gpx`, sizeBytes: 0, derived: derive(p) };
}
