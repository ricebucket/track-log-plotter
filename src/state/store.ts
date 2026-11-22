import { batch, computed, effect, signal } from '@preact/signals';
import type { ColorKey, HaloKey, LoadedTrack, MeasureKey, ParseResult } from '../model/types';
import { initialLang, LOCALE, translate, type Lang, type Params } from '../i18n/i18n';
import { addTracks, alignOffsets, applyToAll, removeTrack, setColor, setHalo, setVisible, type TrackItem } from './logic';
import { buildScale, type Scale } from '../color/scale';
import { eleFactor, speedFactor, type Units } from '../format';
import { isValidZone, type ZoneSel } from '../time/zones';
import type { BasemapId } from '../map/basemaps';
import { BASEMAP_IDS, isDarkBasemap } from '../map/basemaps';
import { parseFile } from '../parse/client';

// ---------- preferences (remembered in this browser) ----------

const KEY = 'tlp.prefs.v1';
interface Prefs { lang?: Lang; basemap?: BasemapId; dim?: number; zone?: ZoneSel; units?: Units; panelMin?: boolean; timelineMin?: boolean; arrows?: boolean; fixes?: boolean; gaps?: boolean }

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

export const basemap = signal<BasemapId>(saved.basemap && BASEMAP_IDS.includes(saved.basemap) ? saved.basemap : 'osm');
export const dim = signal(typeof saved.dim === 'number' ? Math.min(0.7, Math.max(0, saved.dim)) : 0);
export const zone = signal<ZoneSel>(saved.zone && isValidZone(saved.zone) ? saved.zone : 'local');
export const units = signal<Units>(saved.units === 'imperial' ? 'imperial' : 'metric');
export const panelMin = signal(saved.panelMin ?? false);
export const timelineMin = signal(saved.timelineMin ?? narrow);
export const showArrows = signal(saved.arrows ?? true);
export const showFixes = signal(saved.fixes ?? true);
export const showGaps = signal(saved.gaps ?? true);

effect(() => {
  const p: Prefs = {
    lang: lang.value, basemap: basemap.value, dim: dim.value, zone: zone.value, units: units.value,
    panelMin: panelMin.value, timelineMin: timelineMin.value, arrows: showArrows.value, fixes: showFixes.value, gaps: showGaps.value,
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
export const scales = computed(() => {
  const shown = visible.value.length ? visible.value : selected.value ? [selected.value] : [];
  const all = shown.map((x) => x.track);
  const sf = speedFactor(units.value), ef = eleFactor(units.value);
  return {
    speed: buildScale('speed', all, sf),
    ele: buildScale('ele', all, ef),
    grade: buildScale('grade', all),
    hdop: buildScale('hdop', all),
    sats: buildScale('sats', all),
    fix: buildScale('fix', all),
  } satisfies Record<MeasureKey, Scale>;
});

/** The scale a track uses for a measure; non-standard HDOP gets the track's own quartiles. */
export function scaleFor(track: LoadedTrack, key: MeasureKey): Scale {
  if (key === 'hdop' && track.derived.hdopRelative) return buildScale('hdop', [track], 1, track);
  return scales.value[key];
}

// ---------- timeline cursor ----------

/** Cursor time on the timeline axis (ms), or null before the user points anywhere. */
export const cursorT = signal<number | null>(null);
/** Time of the cursor in a track's own clock. */
export function trackTime(id: string, axisT: number): number {
  return axisT - (offsets.value[id] ?? 0);
}

// ---------- panels, menus and notices ----------

export type Page = { kind: 'tracks' } | { kind: 'details'; id: string };
export const page = signal<Page>({ kind: 'tracks' });
export const picker = signal<{ which: 'color' | 'halo'; anchorTop: number } | null>(null);
export const basemapOpen = signal(false);
export const settingsOpen = signal(false);
export const zoneOpen = signal(false);
export const limitNotice = signal<string | null>(null);

export interface LoadNotice { id: string; file: string; problems: number }
export const loadNotice = signal<LoadNotice | null>(null);
export const loadErrors = signal<{ file: string; error: string }[]>([]);
export const skippedCount = signal(0);
export const loadingCount = signal(0);

/** Bumped when the map should zoom to the visible tracks. */
export const fitRequest = signal(0);
/** The map's current view, for the Google Maps link. */
export const mapView = signal({ lat: 40.7705, lon: -73.9655, zoom: 13, bearing: 0 });

// ---------- actions ----------

export function addLoaded(loaded: LoadedTrack[]) {
  if (!loaded.length) return;
  const r = addTracks(items.value, loaded);
  batch(() => {
    items.value = r.items;
    if (r.added.length) {
      if (!selectedId.value || !items.value.some((x) => x.id === selectedId.value)) selectedId.value = r.added[0];
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
  const results: ParseResult[] = [];
  try {
    for (const f of files) results.push(await parseFile(f));
  } finally {
    loadingCount.value -= files.length;
  }
  const ok = results.flatMap((r) => (r.ok ? [r.track] : []));
  loadErrors.value = results.flatMap((r) => (r.ok ? [] : [{ file: r.file, error: r.error }]));
  addLoaded(ok);
}

export const SAMPLE_FILES = ['central-park-loop.nmea', 'central-park-loop.gpx', 'roosevelt-island-run.gpx'];

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
    limitNotice.value = null;
    picker.value = null;
  });
}

export function setMeasure(id: string, which: 'color' | 'halo', key: ColorKey | HaloKey) {
  items.value = which === 'color' ? setColor(items.value, id, key as ColorKey) : setHalo(items.value, id, key as HaloKey);
}

export function applyAll(id: string) {
  items.value = applyToAll(items.value, id);
}

export function remove(id: string) {
  batch(() => {
    items.value = removeTrack(items.value, id);
    if (selectedId.value === id) selectedId.value = items.value[0]?.id ?? null;
    if (page.value.kind === 'details' && page.value.id === id) page.value = { kind: 'tracks' };
    if (loadNotice.value?.id === id) loadNotice.value = null;
  });
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
    basemapOpen.value = false;
    settingsOpen.value = false;
    zoneOpen.value = false;
    limitNotice.value = null;
    loadNotice.value = null;
    loadErrors.value = [];
    skippedCount.value = 0;
    cursorT.value = null;
    panelMin.value = false;
    timelineMin.value = false;
    lang.value = 'en';
    zone.value = 'local';
    units.value = 'metric';
    basemap.value = 'osm';
  });
}
