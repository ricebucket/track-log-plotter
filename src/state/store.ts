import { batch, computed, effect, signal } from '@preact/signals';
import type { ColorKey, HaloKey, LoadedTrack, MeasureKey, ParseResult } from '../model/types';
import { initialLang, LOCALE, translate, type Lang, type Params } from '../i18n/i18n';
import { addCombined, addTracks, alignOffsets, applyToAll, LOAD_LIMIT, removeTrack, removeTracks, replaceTrack, setColor, setHalo, setLogShown, setName, setVisible, SHOW_LIMIT, trackName, trackUid, type TrackItem } from './logic';
import { checkCombine, combineTracks, isCombined, MAX_LOGS, recombine, type ComboTrack } from '../combine/combine';
import { buildScale, type Scale } from '../color/scale';
import { eleFactor, speedFactor, type Units } from '../format';
import { clockShift, isValidZone, type ZoneSel } from '../time/zones';
import type { BasemapId } from '../map/basemaps';
import { BASEMAP_IDS, isDarkBasemap } from '../map/basemaps';
import { parseFile } from '../parse/client';
import { hasFixNear } from './inspect';

// ---------- preferences (remembered in this browser) ----------

const KEY = 'tlp.prefs.v1';
interface Prefs { lang?: Lang; basemap?: BasemapId; dim?: number; zone?: ZoneSel; lastZone?: ZoneSel; units?: Units; panelMin?: boolean; timelineMin?: boolean; arrows?: boolean; fixes?: boolean; gaps?: boolean; haloGraph?: boolean }

function readPrefs(): Prefs {
  try { return JSON.parse(localStorage.getItem(KEY) || '{}') as Prefs; } catch { return {}; }
}
const saved = readPrefs();
const narrow = typeof matchMedia === 'function' && matchMedia('(max-width: 720px)').matches;

export const lang = signal<Lang>(initialLang(
  typeof location === 'undefined' ? '' : location.search,
  saved.lang ?? null,
  typeof navigator === 'undefined' ? [] : navigator.languages ?? [navigator.language],
));
export const locale = computed(() => LOCALE[lang.value]);
/** Translate; reading it inside a component re-renders that component when the language changes. */
export const t = (key: string, params?: Params) => translate(lang.value, key, params);

export const basemap = signal<BasemapId>(saved.basemap && BASEMAP_IDS.includes(saved.basemap) ? saved.basemap : 'light');
export const dim = signal(typeof saved.dim === 'number' ? Math.min(0.7, Math.max(0, saved.dim)) : 0);
export const zone = signal<ZoneSel>(saved.zone && isValidZone(saved.zone) ? saved.zone : 'local');
const isNamedZone = (z: ZoneSel | undefined): z is ZoneSel => !!z && z !== 'local' && z !== 'utc' && isValidZone(z);
/** The last zone picked from the list (not Local or UTC): its button keeps showing it. */
export const lastZone = signal<ZoneSel | null>(isNamedZone(saved.zone) ? saved.zone : isNamedZone(saved.lastZone) ? saved.lastZone : null);
effect(() => { const z = zone.value; if (isNamedZone(z)) lastZone.value = z; });
export const units = signal<Units>(saved.units === 'imperial' ? 'imperial' : 'metric');
export const panelMin = signal(saved.panelMin ?? false);
export const timelineMin = signal(saved.timelineMin ?? narrow);
export const showArrows = signal(saved.arrows ?? true);
export const showFixes = signal(saved.fixes ?? false);
export const showGaps = signal(saved.gaps ?? true);
/** The selected track's halo measure as a second graph on the timeline. */
export const showHaloGraph = signal(saved.haloGraph ?? false);

effect(() => {
  const p: Prefs = {
    lang: lang.value, basemap: basemap.value, dim: dim.value, zone: zone.value, lastZone: lastZone.value ?? undefined, units: units.value,
    panelMin: panelMin.value, timelineMin: timelineMin.value, arrows: showArrows.value, fixes: showFixes.value, gaps: showGaps.value, haloGraph: showHaloGraph.value,
  };
  try { localStorage.setItem(KEY, JSON.stringify(p)); } catch { /* private mode: nothing to remember */ }
  if (typeof document !== 'undefined') document.documentElement.lang = LOCALE[p.lang!];
});

// ---------- tracks ----------

export const items = signal<TrackItem[]>([]);
export const selectedId = signal<string | null>(null);
export const visible = computed(() => items.value.filter((x) => x.vis));
export const single = computed(() => visible.value.length === 1);
export const selected = computed(() => items.value.find((x) => x.id === selectedId.value) ?? items.value[0] ?? null);
export const dark = computed(() => isDarkBasemap(basemap.value));

/** Offsets that line the visible tracks up on the timeline (see alignOffsets). */
export const offsets = computed(() => alignOffsets(visible.value, selected.value?.id ?? ''));

/**
 * Scales per measure, in the chosen units. Speed and elevation steps come from
 * the shown tracks (or the selected one when none is shown), so they change
 * when tracks are shown or hidden.
 */
let lastScales: { key: string; value: Record<MeasureKey, Scale> } | null = null;
export const scales = computed(() => {
  const shown = visible.value.length ? visible.value : selected.value ? [selected.value] : [];
  const all = shown.map((x) => x.track);
  // Changing a color or halo makes new track items, but the same shown tracks
  // give the same steps: keep the previous scales instead of re-sorting.
  const key = `${all.map(trackUid).join(',')}|${units.value}`;
  if (lastScales?.key === key) return lastScales.value;
  const sf = speedFactor(units.value), ef = eleFactor(units.value);
  const value = {
    speed: buildScale('speed', all, sf),
    ele: buildScale('ele', all, ef),
    grade: buildScale('grade', all),
    hdop: buildScale('hdop', all),
    sats: buildScale('sats', all),
    accel: buildScale('accel', all),
    fix: buildScale('fix', all),
  } satisfies Record<MeasureKey, Scale>;
  lastScales = { key, value };
  return value;
});

const relativeScales = new WeakMap<LoadedTrack, Scale>();

/** The scale a track uses for a measure; non-standard HDOP gets the track's own quartiles. */
export function scaleFor(track: LoadedTrack, key: MeasureKey): Scale {
  if (key === 'hdop' && track.derived.hdopRelative) {
    // Built once per track, so lanes and legends see the same object on every render.
    let s = relativeScales.get(track);
    if (!s) { s = buildScale('hdop', [track], 1, track); relativeScales.set(track, s); }
    return s;
  }
  return scales.value[key];
}

// ---------- timeline cursor ----------

/** Cursor time on the timeline axis (ms), or null before the user points anywhere. */
export const cursorT = signal<number | null>(null);
/** True while the cursor is being dragged along a track on the map; playback holds still meanwhile. */
export const scrubbing = signal(false);
/** Time of the cursor in a track's own clock. */
export function trackTime(id: string, axisT: number): number {
  return axisT - (offsets.value[id] ?? 0);
}

/**
 * The track whose values the cursor shows (fix card, timeline readout): the
 * selected one where it has a fix near the cursor, otherwise the shown track
 * with the nearest fix. So inside one logger's gap, another's values show.
 */
export const cursorItem = computed<TrackItem | null>(() => {
  const sel = selected.value;
  const ct = cursorT.value;
  if (ct === null) return sel;
  const lane = laneTrack.value ? visible.value.find((x) => x.id === laneTrack.value) : undefined;
  if (lane && hasFixNear(lane.track, trackTime(lane.id, ct))) return lane;
  if (sel?.vis && hasFixNear(sel.track, trackTime(sel.id, ct))) return sel;
  return visible.value.find((it) => hasFixNear(it.track, trackTime(it.id, ct))) ?? sel;
});

// ---------- panels, menus and notices ----------

export type Page = { kind: 'tracks' } | { kind: 'details'; id: string };
export const page = signal<Page>({ kind: 'tracks' });
/** The track whose color, halo and timeline settings sheet is open. */
export const picker = signal<{ id: string } | null>(null);
/** A newly added track whose row the track list scrolls into view once it shows. */
export const reveal = signal<string | null>(null);
export const basemapOpen = signal(false);
export const zoneOpen = signal(false);
/** The track whose timeline lane the pointer last moved the cursor on; its values show at the cursor. */
export const laneTrack = signal<string | null>(null);
/** The part of the timeline shown when zoomed in, or null for all of it. */
export const timelineView = signal<[number, number] | null>(null);
/** The track whose file time zone is being picked (properties page), or null. */
export const clockPicker = signal<string | null>(null);
export const limitNotice = signal<string | null>(null);

export interface LoadNotice { id: string; file: string; problems: number }
export const loadNotice = signal<LoadNotice | null>(null);
export const loadErrors = signal<{ file: string; error: string }[]>([]);
export const skippedCount = signal(0);
export const loadingCount = signal(0);

/** Select mode: each track's eye becomes a tick box, and a bar acts on the ticked tracks. */
export const selecting = signal(false);
/** The ticked tracks, in the order they were ticked (with equal trust, the first keeps its clock when combined). */
export const ticked = signal<string[]>([]);
/** What pressing Combine ran into, shown as a notice: a time zone to check, the same recording twice, logs that may not be one trip. */
export type ComboNotice =
  | { kind: 'zone'; id: string; file: string }
  | { kind: 'duplicate' }
  | { kind: 'apart'; track: ComboTrack; ids: string[] }
  | { kind: 'full' }
  | { kind: 'empty' };
export const comboNotice = signal<ComboNotice | null>(null);

/** Bumped when the map should zoom to the visible tracks. */
export const fitRequest = signal(0);
/** The map's current view, for the Google Maps link. */
export const mapView = signal({ lat: 40.7705, lon: -73.9655, zoom: 13, bearing: 0, pitch: 0 });

// ---------- actions ----------

export function addLoaded(loaded: LoadedTrack[]) {
  if (!loaded.length) return;
  const r = addTracks(items.value, loaded);
  batch(() => {
    items.value = r.items;
    if (r.added.length) {
      // A newly added track becomes the selected one (the first, when several
      // come at once), shown open in the track list, even from a properties page.
      select(r.added[0]);
      reveal.value = r.added[0];
      if (page.value.kind === 'details') page.value = { kind: 'tracks' };
      const withProblems = r.added.map((id) => r.items.find((x) => x.id === id)!).find((x) => x.track.problems.length > 0);
      loadNotice.value = withProblems ? { id: withProblems.id, file: withProblems.track.file, problems: withProblems.track.problems.length } : null;
      fitRequest.value++;
      cursorT.value = null;
    }
    skippedCount.value = r.skipped;
  });
}

export async function openFiles(files: File[]) {
  if (!files.length) return;
  loadingCount.value += files.length;
  let results: ParseResult[] = [];
  try {
    // Files are read in parallel by a pool of workers; results keep their order.
    results = await Promise.all(files.map((f) => parseFile(f)));
  } finally {
    loadingCount.value -= files.length;
  }
  const ok = results.flatMap((r) => (r.ok ? [r.track] : []));
  loadErrors.value = results.flatMap((r) => (r.ok ? [] : [{ file: r.file, error: r.error }]));
  addLoaded(ok);
}

export const SAMPLE_FILES = ['central-park-loop.nmea', 'roosevelt-island-run.gpx'];

export async function loadSample(base = import.meta.env.BASE_URL) {
  const files = await Promise.all(SAMPLE_FILES.map(async (name) => {
    const res = await fetch(`${base}sample/${name}`);
    return new File([await res.blob()], name);
  }));
  await openFiles(files);
}

export function toggleVisible(id: string) {
  const it = items.value.find((x) => x.id === id);
  if (!it) return;
  const r = setVisible(items.value, id, !it.vis);
  batch(() => {
    items.value = r.items;
    limitNotice.value = r.limited ? id : null;
  });
}

export function select(id: string) {
  batch(() => {
    selectedId.value = id;
    laneTrack.value = null;
    hiddenTogether = [];
    limitNotice.value = null;
    picker.value = null;
  });
}

/** Names a track (see setName); the list is left alone when its name stays the same. */
export function renameTrack(id: string, name: string) {
  const now = items.value, next = setName(now, id, name);
  if (next.some((x, i) => x !== now[i])) items.value = next;
}

/** What a notice should call a track: its name now (it may have been renamed since), else the file the notice named. */
export function nameFor(id: string, file: string): string {
  const x = items.value.find((it) => it.id === id);
  return x && x.track.file === file ? trackName(x) : file;
}

export function setMeasure(id: string, which: 'color' | 'halo', key: ColorKey | HaloKey) {
  items.value = which === 'color' ? setColor(items.value, id, key as ColorKey) : setHalo(items.value, id, key as HaloKey);
}

/** Swaps a track's color and halo measures; "one color" and "off" turn into each other. */
export function swapMeasures(id: string) {
  const it = items.value.find((x) => x.id === id);
  if (!it) return;
  const color: ColorKey = it.halo === 'off' ? 'none' : it.halo;
  const halo: HaloKey = it.color === 'none' ? 'off' : it.color;
  items.value = items.value.map((x) => (x.id === id ? { ...x, color, halo } : x));
}

/** The tracks hidden together by "Hide all", to bring back by "Show all". */
let hiddenTogether: string[] = [];

/** Hides every track, or shows again the ones hidden together (else the first few). */
export function toggleAllVisible() {
  const all = items.value;
  const shown = all.filter((x) => x.vis);
  if (shown.length) {
    hiddenTogether = shown.map((x) => x.id);
    items.value = all.map((x) => (x.vis ? { ...x, vis: false } : x));
  } else {
    const back = hiddenTogether.filter((id) => all.some((x) => x.id === id));
    let next = all;
    for (const id of (back.length ? back : all.map((x) => x.id)).slice(0, SHOW_LIMIT)) next = setVisible(next, id, true).items;
    items.value = next;
  }
  limitNotice.value = null;
}

export function applyAll(id: string) {
  items.value = applyToAll(items.value, id);
}

export function remove(id: string) {
  batch(() => {
    items.value = removeTrack(items.value, id);
    ticked.value = ticked.value.filter((x) => x !== id);
    if (selectedId.value === id) selectedId.value = items.value[0]?.id ?? null;
    if (page.value.kind === 'details' && page.value.id === id) page.value = { kind: 'tracks' };
    if (loadNotice.value?.id === id) loadNotice.value = null;
  });
}

// ---------- select mode: remove or combine several tracks ----------

export function startSelect() {
  batch(() => {
    selecting.value = true;
    ticked.value = [];
    picker.value = null;
    comboNotice.value = null;
  });
}

export function endSelect() {
  batch(() => {
    selecting.value = false;
    ticked.value = [];
    if (comboNotice.value?.kind === 'apart') comboNotice.value = null;
  });
}

export function toggleTick(id: string) {
  batch(() => {
    ticked.value = ticked.value.includes(id) ? ticked.value.filter((x) => x !== id) : [...ticked.value, id];
    if (comboNotice.value?.kind === 'apart') comboNotice.value = null;
  });
}

/** Ticks every track, or none when all are ticked already. */
export function tickAll() {
  ticked.value = ticked.value.length === items.value.length ? [] : items.value.map((x) => x.id);
}

/** Removes the ticked tracks (the list empties back to the start screen) and leaves select mode. */
export function removeTicked() {
  const ids = ticked.value;
  if (!ids.length) return;
  if (ids.length === items.value.length) { clearAll(); return; }
  batch(() => {
    items.value = removeTracks(items.value, ids);
    if (selectedId.value && ids.includes(selectedId.value)) selectedId.value = items.value[0]?.id ?? null;
    if (page.value.kind === 'details' && ids.includes(page.value.id)) page.value = { kind: 'tracks' };
    if (loadNotice.value && ids.includes(loadNotice.value.id)) loadNotice.value = null;
    endSelect();
  });
}

/**
 * Why Combine can't act on the ticked tracks, from the checks that need no
 * pass through the fixes, or null when it can be pressed.
 */
export function combineBlock(ids: readonly string[]): 'few' | 'many' | 'combined' | 'noOverlap' | null {
  if (ids.length < 2) return 'few';
  if (ids.length > MAX_LOGS) return 'many';
  const tracks = ids.map((id) => items.value.find((x) => x.id === id)?.track).filter((x): x is LoadedTrack => !!x);
  if (tracks.some(isCombined)) return 'combined';
  const c = checkCombine(tracks);
  return !c.ok && c.reason === 'noOverlap' ? 'noOverlap' : null;
}

/** The name of a new combined track, from its sources' letters in the order ticked: "B+C Combined Track", then "B+C Combined Track 2". */
function combinedName(ids: readonly string[]): string {
  const taken = new Set(items.value.flatMap((x) => [x.track.file, trackName(x)]));
  const p = { ids: ids.join('+') };
  const base = t('combine.name', p);
  if (!taken.has(base)) return base;
  for (let k = 2; ; k++) { const name = t('combine.nameN', { ...p, n: k }); if (!taken.has(name)) return name; }
}

/**
 * Combines the ticked logs into a new track. The instant checks first: a log
 * whose time zone may be wrong, or the same recording twice, stops it with a
 * notice. Logs far apart for most of their shared time may not be one trip:
 * that asks before the combined track is added.
 */
export function combineTicked() {
  const ids = ticked.value;
  const its = ids.map((id) => items.value.find((x) => x.id === id)).filter((x): x is TrackItem => !!x);
  const c = checkCombine(its.map((x) => x.track));
  if (!c.ok) {
    if (c.reason === 'zone') comboNotice.value = { kind: 'zone', id: its[c.log].id, file: its[c.log].track.file };
    else if (c.reason === 'duplicate') comboNotice.value = { kind: 'duplicate' };
    return;
  }
  if (items.value.length >= LOAD_LIMIT) { comboNotice.value = { kind: 'full' }; return; }
  const r = combineTracks(its.map((x) => x.track), { name: combinedName(its.map((x) => x.id)) });
  if (!r.ok) { comboNotice.value = { kind: r.reason === 'duplicate' ? 'duplicate' : 'empty' }; return; }
  if (r.apart) { comboNotice.value = { kind: 'apart', track: r.track, ids }; return; }
  addCombo(r.track, ids);
}

/** "Combine anyway": adds the combined track held back by the "not the same trip?" question. */
export function confirmApart() {
  const n = comboNotice.value;
  if (n?.kind === 'apart') addCombo(n.track, n.ids);
}

function addCombo(track: ComboTrack, ids: string[]) {
  const r = addCombined(items.value, track, ids);
  if (!r.id) { comboNotice.value = { kind: 'full' }; return; }
  const id = r.id;
  batch(() => {
    items.value = r.items;
    selecting.value = false;
    ticked.value = [];
    comboNotice.value = null;
    // Like a newly loaded track: selected, open in the list, and in view.
    select(id);
    reveal.value = id;
    fitRequest.value++;
    cursorT.value = null;
  });
}

function trustNow(id: string, trust: number[]) {
  const it = items.value.find((x) => x.id === id);
  if (!it || !isCombined(it.track)) return;
  items.value = replaceTrack(items.value, id, recombine(it.track, trust));
}

let trustFrame = 0;
let trustNext: { id: string; trust: number[] } | null = null;

/** New trust shares for a combined track, at once (a drag's frame still waiting is dropped). */
export function applyTrust(id: string, trust: number[]) {
  trustNext = null;
  trustNow(id, trust);
}

/** New trust shares while the handle is dragged: worked out once per animation frame, however fast it moves. */
export function setTrust(id: string, trust: number[]) {
  trustNext = { id, trust };
  if (trustFrame) return;
  const run = () => { trustFrame = 0; const job = trustNext; trustNext = null; if (job) trustNow(job.id, job.trust); };
  if (typeof requestAnimationFrame === 'function') trustFrame = requestAnimationFrame(run);
  else run();
}

/** Shows or hides one log of a combined track. */
export function toggleLog(id: string, k: number) {
  const it = items.value.find((x) => x.id === id);
  if (!it?.logs) return;
  items.value = setLogShown(items.value, id, k, !it.logs[k]);
}

export function openDetails(id: string) {
  batch(() => {
    selectedId.value = id;
    page.value = { kind: 'details', id };
    panelMin.value = false;
    picker.value = null;
    loadNotice.value = null;
  });
}

/**
 * Reads a track's zoneless times in another time zone. The clock readings stay
 * the same, so the whole track moves by the difference between the zones.
 */
export function setClock(id: string, z: ZoneSel) {
  const it = items.value.find((x) => x.id === id);
  const tr = it?.track;
  if (!it || !tr?.clock || tr.clock === z) return;
  const delta = clockShift(tr.cols.t[0], tr.clock, z);
  const track: LoadedTrack = {
    ...tr,
    clock: z,
    cols: { ...tr.cols, t: tr.cols.t.map((v) => v + delta) },
    flags: tr.flags.map((f) => ({ ...f, t: f.t + delta })),
    ...(tr.motion ? { motion: { ...tr.motion, t: tr.motion.t.map((v) => v + delta) } } : {}),
    derived: { ...tr.derived, stats: { ...tr.derived.stats, start: tr.derived.stats.start + delta, end: tr.derived.stats.end + delta } },
  };
  batch(() => {
    items.value = items.value.map((x) => (x.id === id ? { ...x, track } : x));
    if (cursorT.value !== null && selectedId.value === id) cursorT.value += delta;
  });
}

/** Removes the cursor, which closes the fix card on the map. */
export function clearCursor() {
  cursorT.value = null;
}

/** Removes every loaded track, back to the start screen. */
export function clearAll() {
  batch(() => {
    items.value = [];
    selectedId.value = null;
    page.value = { kind: 'tracks' };
    picker.value = null;
    zoneOpen.value = false;
    clockPicker.value = null;
    timelineView.value = null;
    laneTrack.value = null;
    hiddenTogether = [];
    limitNotice.value = null;
    loadNotice.value = null;
    loadErrors.value = [];
    skippedCount.value = 0;
    cursorT.value = null;
    selecting.value = false;
    ticked.value = [];
    comboNotice.value = null;
  });
}

/** Moves the cursor to a moment in a track's own clock. */
export function seek(id: string, trackT: number) {
  cursorT.value = trackT + (offsets.value[id] ?? 0);
}

/** For tests: back to a clean slate. */
export function resetForTests() {
  batch(() => {
    items.value = [];
    selectedId.value = null;
    page.value = { kind: 'tracks' };
    picker.value = null;
    reveal.value = null;
    basemapOpen.value = false;
    zoneOpen.value = false;
    clockPicker.value = null;
    timelineView.value = null;
    laneTrack.value = null;
    limitNotice.value = null;
    loadNotice.value = null;
    loadErrors.value = [];
    skippedCount.value = 0;
    cursorT.value = null;
    selecting.value = false;
    ticked.value = [];
    comboNotice.value = null;
    panelMin.value = false;
    timelineMin.value = false;
    lang.value = 'en';
    zone.value = 'local';
    lastZone.value = null;
    units.value = 'metric';
    basemap.value = 'light';
  });
}
