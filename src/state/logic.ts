import type { ColorKey, HaloKey, LoadedTrack, MeasureKey } from '../model/types';
import { MEASURES } from '../model/types';
import { hasMeasure } from '../color/scale';

export const LOAD_LIMIT = 10;
export const SHOW_LIMIT = 3;
export const LETTERS = 'ABCDEFGHIJ';

export interface TrackItem {
  id: string;
  track: LoadedTrack;
  vis: boolean;
  color: ColorKey;
  halo: HaloKey;
  /** Color range (0 blue, 1 orange, 2 teal) used while several tracks are shown. */
  fam: number;
}

// Tracks never change after loading, so a number per track identifies its data.
const uids = new WeakMap<LoadedTrack, number>();
let nextUid = 1;
export function trackUid(t: LoadedTrack): number {
  let id = uids.get(t);
  if (!id) { id = nextUid++; uids.set(t, id); }
  return id;
}

const measureSets = new WeakMap<LoadedTrack, ReadonlySet<MeasureKey>>();

/** Measures a track has values for. Tracks don't change after loading, so this is worked out once. */
export function measuresOf(track: LoadedTrack): ReadonlySet<MeasureKey> {
  let m = measureSets.get(track);
  if (!m) { m = new Set(MEASURES.filter((k) => hasMeasure(track, k))); measureSets.set(track, m); }
  return m;
}

/** New tracks start with speed for the color and HDOP for the halo. */
export function defaultsFor(track: LoadedTrack): { color: ColorKey; halo: HaloKey } {
  const m = measuresOf(track);
  return { color: 'speed', halo: m.has('hdop') ? 'hdop' : m.has('sats') ? 'sats' : 'off' };
}

/** The first color range no other shown track uses, preferring the track's own. */
function freeFamily(items: TrackItem[], self: TrackItem): number {
  const used = new Set(items.filter((t) => t.vis && t.id !== self.id).map((t) => t.fam));
  if (!used.has(self.fam)) return self.fam;
  for (let k = 0; k < 3; k++) if (!used.has(k)) return k;
  return self.fam;
}

export interface AddResult { items: TrackItem[]; added: string[]; skipped: number }

/** Adds loaded tracks up to the load limit; the first three shown tracks become visible. */
export function addTracks(items: TrackItem[], loaded: LoadedTrack[]): AddResult {
  const out = [...items];
  const added: string[] = [];
  let skipped = 0;
  for (const track of loaded) {
    if (out.length >= LOAD_LIMIT) { skipped++; continue; }
    const id = [...LETTERS].find((l) => !out.some((t) => t.id === l))!;
    const vis = out.filter((t) => t.vis).length < SHOW_LIMIT;
    const item: TrackItem = { id, track, vis, ...defaultsFor(track), fam: 0 };
    item.fam = vis ? freeFamily(out, item) : LETTERS.indexOf(id) % 3;
    out.push(item);
    added.push(id);
  }
  return { items: out, added, skipped };
}

export interface VisResult { items: TrackItem[]; limited: boolean }

/** Shows or hides a track. Showing a fourth is refused; shown tracks never change color range. */
export function setVisible(items: TrackItem[], id: string, vis: boolean): VisResult {
  const t = items.find((x) => x.id === id);
  if (!t || t.vis === vis) return { items, limited: false };
  if (vis && items.filter((x) => x.vis).length >= SHOW_LIMIT) return { items, limited: true };
  const next = items.map((x) => (x.id === id ? { ...x, vis, fam: vis ? freeFamily(items, x) : x.fam } : x));
  return { items: next, limited: false };
}

export function removeTrack(items: TrackItem[], id: string): TrackItem[] {
  return items.filter((x) => x.id !== id);
}

export function setColor(items: TrackItem[], id: string, color: ColorKey): TrackItem[] {
  return items.map((x) => (x.id === id ? { ...x, color } : x));
}

export function setHalo(items: TrackItem[], id: string, halo: HaloKey): TrackItem[] {
  return items.map((x) => (x.id === id ? { ...x, halo } : x));
}

/** Copies one track's color and halo measures to every track that has them. */
export function applyToAll(items: TrackItem[], fromId: string): TrackItem[] {
  const src = items.find((x) => x.id === fromId);
  if (!src) return items;
  return items.map((x) => {
    if (x.id === fromId) return x;
    const m = measuresOf(x.track);
    const color = src.color === 'none' || m.has(src.color) ? src.color : x.color;
    const halo = src.halo === 'off' || m.has(src.halo) ? src.halo : x.halo;
    return { ...x, color, halo };
  });
}

/**
 * Lines tracks up on one timeline. Tracks recorded at the same time as the
 * reference share its clock; a track recorded at another time is moved so its
 * start lines up with the reference's start. Returns ms to add to each track's
 * times to place them on the timeline.
 */
export function alignOffsets(visible: TrackItem[], refId: string): Record<string, number> {
  const out: Record<string, number> = {};
  const ref = visible.find((x) => x.id === refId) ?? visible[0];
  if (!ref) return out;
  const r0 = ref.track.derived.stats.start, r1 = ref.track.derived.stats.end;
  for (const x of visible) {
    const s = x.track.derived.stats;
    const overlaps = s.start < r1 && s.end > r0;
    out[x.id] = x.id === ref.id || overlaps ? 0 : r0 - s.start;
  }
  return out;
}

/** Time range covered by the visible tracks on the timeline. */
export function axisRange(visible: TrackItem[], offsets: Record<string, number>): [number, number] {
  let a = Infinity, b = -Infinity;
  for (const x of visible) {
    const o = offsets[x.id] ?? 0;
    a = Math.min(a, x.track.derived.stats.start + o);
    b = Math.max(b, x.track.derived.stats.end + o);
  }
  return Number.isFinite(a) ? [a, Math.max(b, a + 1000)] : [0, 1000];
}

/** Index of the fix nearest to time t (binary search). */
export function nearestIndex(times: Float64Array, t: number): number {
  const n = times.length;
  if (n === 0) return -1;
  let lo = 0, hi = n - 1;
  if (t <= times[0]) return 0;
  if (t >= times[hi]) return hi;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (times[mid] <= t) lo = mid; else hi = mid;
  }
  return t - times[lo] <= times[hi] - t ? lo : hi;
}
