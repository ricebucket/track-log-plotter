import type { Columns, FixQuality } from '../model/types';
import { haversine } from '../derive/geo';

/** Faster than any real track can move between two fixes (m/s). */
export const IMPOSSIBLE_SPEED = 350;

export interface FixInput {
  t: number;
  lat: number;
  lon: number;
  ele?: number;
  speed?: number;
  course?: number;
  hdop?: number;
  vdop?: number;
  pdop?: number;
  sats?: number;
  fixq?: FixQuality;
  geoid?: number;
  accel?: number;
  line: number;
  lineEnd?: number;
  seg?: boolean;
}

export interface CleanCounts {
  backwards: number;
  backwardsLine: number;
  duplicates: number;
  jumps: number;
  jumpLine: number;
  /** Fixes left out for their position: not a number, off the Earth, or exactly 0, 0 (a placeholder). */
  noPosition: number;
}

type F32Key = 'ele' | 'speed' | 'course' | 'hdop' | 'vdop' | 'pdop' | 'sats' | 'geoid' | 'accel';

/** A value for a measurement column: NaN for anything missing or not finite. */
const val = (v: number | undefined): number => (Number.isFinite(v) ? (v as number) : NaN);

/** A copy of a typed array with room for `cap` values. */
export function grown<T extends Float64Array | Float32Array | Int32Array | Int8Array | Uint8Array>(a: T, cap: number): T {
  const b = new (a.constructor as new (n: number) => T)(cap);
  b.set(a);
  return b;
}

/** A position on the Earth, and not the 0, 0 some loggers write without a fix (NaN fails both comparisons). */
export function isPosition(lat: number, lon: number): boolean {
  return Math.abs(lat) <= 90 && Math.abs(lon) <= 180 && !(lat === 0 && lon === 0);
}

/**
 * Collects fixes into growable typed arrays, dropping fixes that go back in
 * time. Every column is its own field, written directly: no per-fix lookups.
 */
export class ColumnBuilder {
  private cap = 1024;
  n = 0;
  t = new Float64Array(this.cap);
  lat = new Float64Array(this.cap);
  lon = new Float64Array(this.cap);
  ele = new Float32Array(this.cap);
  speed = new Float32Array(this.cap);
  course = new Float32Array(this.cap);
  hdop = new Float32Array(this.cap);
  vdop = new Float32Array(this.cap);
  pdop = new Float32Array(this.cap);
  sats = new Float32Array(this.cap);
  geoid = new Float32Array(this.cap);
  /** Public so a reader can fill it in once each fix's readings are known. */
  accel = new Float32Array(this.cap);
  fixq = new Int8Array(this.cap);
  line = new Int32Array(this.cap);
  lineEnd = new Int32Array(this.cap);
  seg = new Uint8Array(this.cap);
  counts: CleanCounts = { backwards: 0, backwardsLine: 0, duplicates: 0, jumps: 0, jumpLine: 0, noPosition: 0 };
  private pendingSeg = false;

  private grow() {
    const cap = this.cap * 2;
    this.t = grown(this.t, cap); this.lat = grown(this.lat, cap); this.lon = grown(this.lon, cap);
    this.ele = grown(this.ele, cap); this.speed = grown(this.speed, cap); this.course = grown(this.course, cap);
    this.hdop = grown(this.hdop, cap); this.vdop = grown(this.vdop, cap); this.pdop = grown(this.pdop, cap);
    this.sats = grown(this.sats, cap); this.geoid = grown(this.geoid, cap); this.accel = grown(this.accel, cap);
    this.fixq = grown(this.fixq, cap); this.line = grown(this.line, cap); this.lineEnd = grown(this.lineEnd, cap);
    this.seg = grown(this.seg, cap);
    this.cap = cap;
  }

  /** The next fix starts a new segment (no line drawn from the previous fix). */
  breakSegment() { if (this.n > 0) this.pendingSeg = true; }

  push(f: FixInput): boolean {
    if (!Number.isFinite(f.t)) return false;
    if (!isPosition(f.lat, f.lon)) { this.counts.noPosition++; return false; }
    const n = this.n;
    if (n > 0) {
      const lastT = this.t[n - 1];
      if (f.t < lastT) {
        if (this.counts.backwards === 0) this.counts.backwardsLine = f.line;
        this.counts.backwards++;
        return false;
      }
      if (f.t === lastT) { this.counts.duplicates++; return false; }
    }
    if (n === this.cap) this.grow();
    this.t[n] = f.t;
    this.lat[n] = f.lat;
    this.lon[n] = f.lon;
    this.ele[n] = val(f.ele); this.speed[n] = val(f.speed); this.course[n] = val(f.course);
    this.hdop[n] = val(f.hdop); this.vdop[n] = val(f.vdop); this.pdop[n] = val(f.pdop);
    this.sats[n] = val(f.sats); this.geoid[n] = val(f.geoid); this.accel[n] = val(f.accel);
    this.fixq[n] = f.fixq ?? 0;
    this.line[n] = f.line;
    this.lineEnd[n] = f.lineEnd ?? f.line;
    this.seg[n] = f.seg || this.pendingSeg ? 1 : 0;
    this.pendingSeg = false;
    this.n = n + 1;
    return true;
  }

  /** Builds the columns, dropping isolated fixes that jump impossibly far. */
  build(): Columns {
    const n = this.n;
    const keep = new Uint8Array(n).fill(1);
    const v = (a: number, b: number) => {
      const dt = (this.t[b] - this.t[a]) / 1000;
      if (dt <= 0) return Infinity;
      return haversine(this.lat[a], this.lon[a], this.lat[b], this.lon[b]) / dt;
    };
    // The speed into each fix from the one before, worked out once (not once from each side).
    const into = new Float64Array(n + 1);
    for (let i = 1; i < n; i++) into[i] = v(i - 1, i);
    for (let i = 0; i < n; i++) {
      const prev = i > 0 ? into[i] : 0;
      const next = i < n - 1 ? into[i + 1] : 0;
      let spike = false;
      if (i > 0 && i < n - 1) spike = prev > IMPOSSIBLE_SPEED && next > IMPOSSIBLE_SPEED && v(i - 1, i + 1) <= IMPOSSIBLE_SPEED;
      else if (i === 0 && n > 2) spike = next > IMPOSSIBLE_SPEED && v(1, 2) <= IMPOSSIBLE_SPEED;
      else if (i === n - 1 && n > 2) spike = prev > IMPOSSIBLE_SPEED && v(n - 3, n - 2) <= IMPOSSIBLE_SPEED;
      if (spike) {
        keep[i] = 0;
        if (this.counts.jumps === 0) this.counts.jumpLine = this.line[i];
        this.counts.jumps++;
      }
    }
    let m = 0;
    for (let i = 0; i < n; i++) m += keep[i];
    if (m === n) {
      // Nothing dropped (the usual case): straight copies.
      const out: Columns = {
        n, t: this.t.slice(0, n), lat: this.lat.slice(0, n), lon: this.lon.slice(0, n),
        ele: this.ele.slice(0, n), speed: this.speed.slice(0, n), course: this.course.slice(0, n),
        hdop: this.hdop.slice(0, n), vdop: this.vdop.slice(0, n), pdop: this.pdop.slice(0, n),
        sats: this.sats.slice(0, n), fixq: this.fixq.slice(0, n), geoid: this.geoid.slice(0, n), accel: this.accel.slice(0, n),
        line: this.line.slice(0, n), lineEnd: this.lineEnd.slice(0, n), seg: this.seg.slice(0, n),
      };
      if (n) out.seg[0] = 0;
      return out;
    }
    const out: Columns = {
      n: m,
      t: new Float64Array(m), lat: new Float64Array(m), lon: new Float64Array(m),
      ele: new Float32Array(m), speed: new Float32Array(m), course: new Float32Array(m),
      hdop: new Float32Array(m), vdop: new Float32Array(m), pdop: new Float32Array(m),
      sats: new Float32Array(m), fixq: new Int8Array(m), geoid: new Float32Array(m), accel: new Float32Array(m),
      line: new Int32Array(m), lineEnd: new Int32Array(m), seg: new Uint8Array(m),
    };
    let j = 0;
    let carrySeg = 0;
    for (let i = 0; i < n; i++) {
      if (!keep[i]) { carrySeg |= this.seg[i]; continue; }
      out.t[j] = this.t[i];
      out.lat[j] = this.lat[i];
      out.lon[j] = this.lon[i];
      out.ele[j] = this.ele[i]; out.speed[j] = this.speed[i]; out.course[j] = this.course[i];
      out.hdop[j] = this.hdop[i]; out.vdop[j] = this.vdop[i]; out.pdop[j] = this.pdop[i];
      out.sats[j] = this.sats[i]; out.geoid[j] = this.geoid[i]; out.accel[j] = this.accel[i];
      out.fixq[j] = this.fixq[i];
      out.line[j] = this.line[i];
      out.lineEnd[j] = this.lineEnd[i];
      out.seg[j] = (this.seg[i] | carrySeg) && j > 0 ? 1 : 0;
      carrySeg = 0;
      j++;
    }
    return out;
  }
}

/** Which columns hold at least one value. */
export function present(cols: Columns, k: F32Key): boolean {
  const a = cols[k];
  for (let i = 0; i < a.length; i++) if (!Number.isNaN(a[i])) return true;
  return false;
}

/** The fixes with keep[i] set, in order: every column cut down alike (k = how many are kept). */
export function keepFixes(c: Columns, keep: Uint8Array, k: number): Columns {
  const out: Record<string, unknown> = { n: k };
  for (const [name, a] of Object.entries(c)) {
    if (name === 'n') continue;
    const src = a as Float64Array;
    const dst = new (src.constructor as Float64ArrayConstructor)(k);
    for (let i = 0, j = 0; i < c.n; i++) if (keep[i]) dst[j++] = src[i];
    out[name] = dst;
  }
  return out as unknown as Columns;
}
