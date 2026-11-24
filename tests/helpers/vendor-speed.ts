// GPX logs whose speed sits in a vendor extension without a unit, as some
// loggers write it: north through Central Park, a fix a second.
import { parseText } from '../../src/parse/index';
import type { LoadedTrack } from '../../src/model/types';

/** Metres per degree of latitude. */
const KY = 111_195;

export interface VendorLog {
  /** How many fixes, a second apart (120). */
  seconds?: number;
  /** The number written for a speed in m/s: km/h by default. */
  field?: (mps: number) => number;
}

/** A log moving north at `mps` metres a second, its speed written in a vendor extension (in km/h, unless `field` says otherwise). */
export function vendorGpx(mps: number, o: VendorLog = {}): string {
  const t0 = Date.UTC(2026, 5, 14, 13, 0, 0);
  const field = o.field ?? ((v: number) => v * 3.6);
  const pts = Array.from({ length: o.seconds ?? 120 }, (_, i) =>
    `<trkpt lat="${(40.775 + (i * mps) / KY).toFixed(7)}" lon="-73.9690000"><time>${new Date(t0 + i * 1000).toISOString()}</time>`
    + `<extensions><speed>${field(mps).toFixed(1)}</speed></extensions></trkpt>`);
  return `<?xml version="1.0"?><gpx version="1.1" creator="Test" xmlns="http://www.topografix.com/GPX/1/1"><trk><trkseg>${pts.join('')}</trkseg></trk></gpx>`;
}

/** The same log, loaded as the app loads a file. */
export function vendorLog(file: string, mps: number, o: VendorLog = {}): LoadedTrack {
  const r = parseText(vendorGpx(mps, o), file);
  if (!r.ok) throw new Error(r.error);
  return r.track;
}

/** A walk at 1.3 m/s, writing 4.7 (km/h): too slow for the positions to settle the unit, so it is read as m/s, 16.9 km/h. */
export const slowWalk = (file = 'slow-walk.gpx') => vendorLog(file, 1.3);
/** A run at 3 m/s, writing 10.8 (km/h): the positions settle it. */
export const run = (file = 'run.gpx') => vendorLog(file, 3);
