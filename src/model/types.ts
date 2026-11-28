// Shared data model. Fixes are stored column-wise in typed arrays so a
// 100,000-fix log moves from the parsing worker to the page without copying.

/** 'combined': made in the app from 2 or 3 logs of the same trip (see src/combine). */
export type Format = 'gpx' | 'nmea' | 'fusion' | 'combined';

/** Measures a track can be colored or haloed by. */
export type MeasureKey = 'speed' | 'ele' | 'grade' | 'hdop' | 'sats' | 'fix' | 'accel';
export type ColorKey = MeasureKey | 'none';
export type HaloKey = MeasureKey | 'off';

export const MEASURES: readonly MeasureKey[] = ['speed', 'ele', 'grade', 'hdop', 'sats', 'fix', 'accel'];

/** Fix quality: 0 unknown, 1 plain GPS fix, 2 corrected (SBAS, DGPS or RTK). */
export type FixQuality = 0 | 1 | 2;

export interface Columns {
  n: number;
  /** Milliseconds since 1970-01-01 UTC. */
  t: Float64Array;
  lat: Float64Array;
  lon: Float64Array;
  /** Meters above sea level. NaN when missing (as are the other float columns). */
  ele: Float32Array;
  /** Speed as recorded in the file, converted to m/s. */
  speed: Float32Array;
  /** Course over ground in degrees, as recorded. */
  course: Float32Array;
  hdop: Float32Array;
  vdop: Float32Array;
  pdop: Float32Array;
  /** Satellites used for the fix. */
  sats: Float32Array;
  fixq: Int8Array;
  /** Geoid separation in meters (height of sea level above the ellipsoid). */
  geoid: Float32Array;
  /**
   * From a motion sensor: the strongest reading in g during the fix's second,
   * gravity included (about 1 g at rest). NaN without motion data.
   */
  accel: Float32Array;
  /** First and last line of the file that this fix came from. */
  line: Int32Array;
  lineEnd: Int32Array;
  /** 1 where a new track segment starts (GPX trkseg), so the line breaks there. */
  seg: Uint8Array;
}

/** A point the logger marked, usually with a button press (GPX waypoint with a time). */
export interface Flag {
  n: number;
  t: number;
  lat: number;
  lon: number;
  name: string | null;
}

export type Problem =
  | { kind: 'truncated'; line: number; chars: number; kept: number }
  | { kind: 'checksum'; count: number; line: number }
  | { kind: 'glued'; count: number; line: number }
  | { kind: 'garbage'; count: number; line: number }
  /** CSV rows with the wrong number of fields. */
  | { kind: 'badRows'; count: number; line: number }
  | { kind: 'backwards'; count: number; line: number }
  | { kind: 'jump'; count: number; line: number }
  | { kind: 'unclosed'; kept: number }
  | { kind: 'badXml'; line: number; kept: number }
  /** `timeless`: the file gives positions, but without times (as a planned route does). */
  | { kind: 'noFixes'; timeless?: true };

export type SpeedUnit = 'ms' | 'kmh' | 'knots' | 'mph';

export type Note =
  /**
   * The unit of the file's speeds. `inferred`: the file doesn't say, so the
   * unit was worked out by comparing the speeds with the positions. `unsure`:
   * that didn't settle it (too little movement to compare, or numbers between
   * two units), so the unit is a guess. `chosen`: the user has since picked
   * the unit on the properties page.
   */
  | { kind: 'speedUnit'; unit: SpeedUnit; inferred: boolean; unsure?: true; chosen?: true }
  | { kind: 'speedDerived' }
  | { kind: 'hdopRelative' }
  | { kind: 'ignored'; fields: string[] }
  | { kind: 'void'; count: number }
  /** Fixes without a time. */
  | { kind: 'timeless'; count: number }
  | { kind: 'duplicates'; count: number }
  | { kind: 'noZone' }
  | { kind: 'noDate' }
  | { kind: 'midnight' }
  | { kind: 'timelessWaypoints'; count: number }
  | { kind: 'gaps'; count: number; longestS: number }
  | { kind: 'eleZero' }
  | { kind: 'zeroSats'; count: number; stale: number }
  | { kind: 'route' }
  | { kind: 'motion'; rate: number }
  | { kind: 'repeatsDropped'; count: number; long: number };

/** Fields a file can contain, for the properties page. */
export type FieldKey =
  | 'time' | 'position' | 'ele' | 'speed' | 'course' | 'hdop' | 'vdop' | 'pdop'
  | 'sats' | 'fix' | 'geoid' | 'accel' | 'flags';

export interface ParsedTrack {
  format: Format;
  /** GPX creator attribute, when present. */
  creator: string | null;
  /** Track name inside the file, when present. */
  name: string | null;
  cols: Columns;
  flags: Flag[];
  problems: Problem[];
  notes: Note[];
  fields: FieldKey[];
  /** Number of lines in the file (NMEA) or track points read (GPX). */
  lines: number;
  /**
   * Every motion-sensor reading, for the timeline: its time (ms, like the
   * fixes) and its strength in g, gravity included. Only files with motion data.
   */
  motion?: { t: Float64Array; g: Float32Array };
  /**
   * Combined tracks only: 1 where the set of logs giving the height changes
   * (one has a gap or is left out), so the height may jump there.
   * Grade and climb are worked out as if the track broke at those points.
   */
  eleBreak?: Uint8Array;
  /**
   * 1 where the step into a fix crosses fixes dropped when the file was read
   * because they only repeated the position before (a logger that repeats its
   * last position until it has a new one). Up to two minutes, such a step
   * isn't a gap: the logger was running, without a new position.
   */
  bridged?: Uint8Array;
  /**
   * For files whose times have no time zone: the zone they're read in
   * ('local', 'utc' or an IANA id). The user can change it on the properties page.
   */
  clock?: string;
}

export interface TrackStats {
  /** Distance in meters, not counting jumps across gaps. */
  distanceM: number;
  start: number;
  end: number;
  durationS: number;
  movingS: number;
  avgKmh: number;
  maxKmh: number;
  /** Total climb in meters, or null without elevation. */
  climbM: number | null;
  minEle: number | null;
  maxEle: number | null;
  /** Median seconds between fixes. */
  intervalS: number;
  /** Share of fixes with a corrected (differential) fix, or null when unknown. */
  correctedShare: number | null;
  medianHdop: number | null;
  medianSats: number | null;
  /** The strongest acceleration at any fix, in g, or null without motion data. */
  maxAccel: number | null;
  bbox: [number, number, number, number];
}

export interface Derived {
  /** Cumulative distance along the track in meters. */
  dist: Float64Array;
  /** Speed in km/h: from the file where it has one, otherwise from positions. */
  kmh: Float32Array;
  speedFromFile: boolean;
  /** Grade in percent, positive uphill. NaN where unknown. */
  grade: Float32Array;
  /** 1 where a gap (no fixes for a while) precedes the fix. */
  gap: Uint8Array;
  /** HDOP values don't behave like standard HDOP; color by the track's own quartiles. */
  hdopRelative: boolean;
  /** Quartiles of HDOP (25th, 50th, 75th percentile), or null without HDOP. */
  hdopQ: [number, number, number] | null;
  stats: TrackStats;
  /** Which measures the track has values for. */
  has: Record<MeasureKey, boolean>;
  /**
   * The track's moving speeds (km/h, at least walking pace), summed up as 512
   * evenly spaced values in sorted order; empty when it never moves. Shared
   * color steps are picked from these, so a long track counts no more than a
   * short one and nothing is sorted when tracks are shown or hidden.
   */
  speedSpread: Float32Array;
  /** The same for the recorded elevations (m). */
  eleSpread: Float32Array;
  /**
   * Each fix's expected error against the log's usual one (HDOP over its
   * middle value, else the usual satellite count over the fix's; a corrected
   * fix's error √½ as large), averaged over 10 s. 1 throughout without HDOP
   * or satellites. It weights the log when logs are combined.
   */
  accuracy: Float64Array;
  /** The middle of the positive HDOPs, which `accuracy` is measured against; NaN without HDOP. */
  hdopBase: number;
}

export interface LoadedTrack extends ParsedTrack {
  file: string;
  sizeBytes: number;
  derived: Derived;
}

/**
 * What the parsing worker posts back. A file without fixes is 'noTimes' when
 * it gives positions but no times (a planned route, say), else 'empty'.
 */
export type ParseResult =
  | { ok: true; track: LoadedTrack }
  | { ok: false; file: string; error: 'unknownFormat' | 'empty' | 'noTimes' | 'tooBig' | 'unreadable' };
