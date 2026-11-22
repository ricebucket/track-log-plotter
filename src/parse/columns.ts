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
}

const F32 = ['ele', 'speed', 'course', 'hdop', 'vdop', 'pdop', 'sats', 'geoid'] as const;

/** Collects fixes into growable typed arrays, dropping fixes that go back in time. */
export class ColumnBuilder {
  private cap = 1024;
  n = 0;
  t = new Float64Array(this.cap);
  lat = new Float64Array(this.cap);
  lon = new Float64Array(this.cap);
  f32: Record<(typeof F32)[number], Float32Array>;
  fixq = new Int8Array(this.cap);
  line = new Int32Array(this.cap);
  lineEnd = new Int32Array(this.cap);
  seg = new Uint8Array(this.cap);
  counts: CleanCounts = { backwards: 0, backwardsLine: 0, duplicates: 0, jumps: 0, jumpLine: 0 };
  private pendingSeg = false;

  constructor() {
    this.f32 = {} as Record<(typeof F32)[number], Float32Array>;
    for (const k of F32) this.f32[k] = new Float32Array(this.cap);
  }

  private grow() {
    const cap = this.cap * 2;
    const g64 = (a: Float64Array) => { const b = new Float64Array(cap); b.set(a); return b; };
    this.t = g64(this.t);
    this.lat = g64(this.lat);
    this.lon = g64(this.lon);
    for (const k of F32) { const b = new Float32Array(cap); b.set(this.f32[k]); this.f32[k] = b; }
    const i8 = new Int8Array(cap); i8.set(this.fixq); this.fixq = i8;
    const l = new Int32Array(cap); l.set(this.line); this.line = l;
    const le = new Int32Array(cap); le.set(this.lineEnd); this.lineEnd = le;
    const s = new Uint8Array(cap); s.set(this.seg); this.seg = s;
    this.cap = cap;
  }

  /** The next fix starts a new segment (no line drawn from the previous fix). */
  breakSegment() { if (this.n > 0) this.pendingSeg = true; }

  push(f: FixInput): boolean {
    if (!Number.isFinite(f.t) || !Number.isFinite(f.lat) || !Number.isFinite(f.lon)) return false;
    if (Math.abs(f.lat) > 90 || Math.abs(f.lon) > 180 || (f.lat === 0 && f.lon === 0)) return false;
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
    for (const k of F32) {
      const v = f[k];
      this.f32[k][n] = v === undefined || !Number.isFinite(v) ? NaN : v;
    }
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
    for (let i = 0; i < n; i++) {
      const prev = i > 0 ? v(i - 1, i) : 0;
      const next = i < n - 1 ? v(i, i + 1) : 0;
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
    const out: Columns = {
      n: m,
      t: new Float64Array(m), lat: new Float64Array(m), lon: new Float64Array(m),
      ele: new Float32Array(m), speed: new Float32Array(m), course: new Float32Array(m),
      hdop: new Float32Array(m), vdop: new Float32Array(m), pdop: new Float32Array(m),
      sats: new Float32Array(m), fixq: new Int8Array(m), geoid: new Float32Array(m),
      line: new Int32Array(m), lineEnd: new Int32Array(m), seg: new Uint8Array(m),
    };
    let j = 0;
    let carrySeg = 0;
    for (let i = 0; i < n; i++) {
      if (!keep[i]) { carrySeg |= this.seg[i]; continue; }
      out.t[j] = this.t[i];
      out.lat[j] = this.lat[i];
      out.lon[j] = this.lon[i];
      for (const k of F32) out[k][j] = this.f32[k][i];
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
export function present(cols: Columns, k: 'ele' | 'speed' | 'course' | 'hdop' | 'vdop' | 'pdop' | 'sats' | 'geoid'): boolean {
  const a = cols[k];
  for (let i = 0; i < a.length; i++) if (!Number.isNaN(a[i])) return true;
  return false;
}
