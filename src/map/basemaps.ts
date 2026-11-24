import { signal } from '@preact/signals';
import type { ExpressionSpecification, StyleSpecification } from 'maplibre-gl';

// Keyless basemaps only. Each entry says who provides the tiles and what
// attribution the provider requires.

export type BasemapId = 'osm' | 'light' | 'dark' | 'topo' | 'satellite' | 'hybrid';
export const BASEMAP_IDS: BasemapId[] = ['osm', 'light', 'dark', 'topo', 'satellite', 'hybrid'];

export interface Basemap {
  id: BasemapId;
  provider: string;
  attribution: string;
  /** A style URL (vector) or a style object (raster). */
  style: string | StyleSpecification;
  /** Vector styles whose labels can follow the app language. */
  vector: boolean;
  /** Small preview colors for the basemap menu. */
  thumb: { land: string; water: string; park: string; road: string };
}

export const GLYPHS = 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf';
export const TEXT_FONT = ['Noto Sans Bold'];

/** A link in a credit line: it opens in a new tab, so the app stays open, and sends the provider no page address. */
const link = (href: string, text: string) => `<a href="${href}" target="_blank" rel="noopener noreferrer">${text}</a>`;

const OSM_ATTR = `© ${link('https://www.openstreetmap.org/copyright', 'OpenStreetMap')} contributors`;
const ESRI_ATTR = `Imagery: Esri, Maxar, Earthstar Geographics and the GIS User Community · Powered by ${link('https://www.esri.com', 'Esri')}`;
// OpenFreeMap's styles draw OpenMapTiles' vector tiles, whose terms ask for their credit as well.
const OFM_ATTR = `${link('https://openfreemap.org', 'OpenFreeMap')} · ${link('https://www.openmaptiles.org/', '© OpenMapTiles')} · ${OSM_ATTR}`;

function raster(id: string, tiles: string[], attribution: string, maxzoom: number, extra?: { id: string; tiles: string[]; maxzoom: number }): StyleSpecification {
  const sources: StyleSpecification['sources'] = { [id]: { type: 'raster', tiles, tileSize: 256, maxzoom, attribution } };
  const layers: StyleSpecification['layers'] = [{ id: `${id}-tiles`, type: 'raster', source: id }];
  if (extra) {
    sources[extra.id] = { type: 'raster', tiles: extra.tiles, tileSize: 256, maxzoom: extra.maxzoom };
    layers.push({ id: `${extra.id}-tiles`, type: 'raster', source: extra.id });
  }
  return { version: 8, glyphs: GLYPHS, sources, layers };
}

const ESRI_IMAGERY = ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'];
const ESRI_LABELS = ['https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}'];

export const BASEMAPS: Record<BasemapId, Basemap> = {
  osm: {
    id: 'osm', provider: 'OpenStreetMap', attribution: OSM_ATTR, vector: false,
    style: raster('osm', ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'], OSM_ATTR, 19),
    thumb: { land: '#f2efe9', water: '#aad3df', park: '#c8facc', road: '#ffffff' },
  },
  light: {
    id: 'light', provider: 'OpenFreeMap', vector: true, attribution: OFM_ATTR,
    style: 'https://tiles.openfreemap.org/styles/positron',
    thumb: { land: '#f3f3f1', water: '#c9d5df', park: '#e4eadd', road: '#ffffff' },
  },
  dark: {
    id: 'dark', provider: 'OpenFreeMap', vector: true, attribution: OFM_ATTR,
    style: 'https://tiles.openfreemap.org/styles/dark',
    thumb: { land: '#22262b', water: '#14191f', park: '#273029', road: '#3a4048' },
  },
  topo: {
    id: 'topo', provider: 'OpenTopoMap', vector: false,
    attribution: `Map data: ${OSM_ATTR}, SRTM · Map style: © ${link('https://opentopomap.org', 'OpenTopoMap')} (CC-BY-SA)`,
    style: raster('topo', ['a', 'b', 'c'].map((s) => `https://${s}.tile.opentopomap.org/{z}/{x}/{y}.png`), '', 17),
    thumb: { land: '#e9e6d2', water: '#9fc7e8', park: '#c4dba9', road: '#f6d28b' },
  },
  satellite: {
    id: 'satellite', provider: 'Esri World Imagery', attribution: ESRI_ATTR, vector: false,
    style: raster('esri', ESRI_IMAGERY, ESRI_ATTR, 19),
    thumb: { land: '#4a5a3e', water: '#1f3247', park: '#3d5733', road: '#8a8c86' },
  },
  hybrid: {
    id: 'hybrid', provider: 'Esri World Imagery + labels', attribution: ESRI_ATTR, vector: false,
    style: raster('esri', ESRI_IMAGERY, ESRI_ATTR, 19, { id: 'esri-labels', tiles: ESRI_LABELS, maxzoom: 19 }),
    thumb: { land: '#4a5a3e', water: '#1f3247', park: '#3d5733', road: '#d8d2bd' },
  },
};

/** Basemaps dark enough that tracks use their dark-basemap steps. */
export function isDarkBasemap(id: BasemapId): boolean {
  return id === 'dark' || id === 'satellite' || id === 'hybrid';
}

/** The plain background's colors: a light neutral, and a dark one for a dark basemap. */
export const PLAIN = { light: '#eef0f1', dark: '#22262b' } as const;

/**
 * What the map draws on when the basemap's style can't load: a single background
 * layer, dark where the tracks are drawn for a dark basemap. It fetches nothing (no
 * sources, glyphs or sprite), so it always loads; the tracks' labels are drawn in
 * the device's own fonts.
 */
export function plainStyle(dark: boolean): StyleSpecification {
  return { version: 8, sources: {}, layers: [{ id: 'plain', type: 'background', paint: { 'background-color': dark ? PLAIN.dark : PLAIN.light } }] };
}

/**
 * Whether the map shows its notice that the basemap's style couldn't load and the
 * tracks are on the plain background (see MapView and MapTools): set as the map falls
 * back, cleared when the notice is dismissed or another basemap is picked.
 */
export const basemapFailed = signal(false);

/** Label expression for vector basemaps in Chinese: Simplified Chinese, then Chinese, then the local name. */
export const ZH_LABEL: ExpressionSpecification = ['coalesce', ['get', 'name:zh-Hans'], ['get', 'name:zh'], ['get', 'name']];

const NAME_FIELD = /^name([:_]|$)/;

/**
 * Whether a label's text-field shows a name (of a place, a street, water…),
 * read from a name field, as tokens ("{name:latin}") or an expression: those
 * labels follow the app's language. Road numbers on shields, house numbers and
 * the like keep their own text.
 */
export function showsName(textField: unknown): boolean {
  if (typeof textField === 'string') return /\{name([:_][^}]*)?\}/.test(textField);
  if (!Array.isArray(textField)) return false;
  if (textField[0] === 'get') return typeof textField[1] === 'string' && NAME_FIELD.test(textField[1]);
  return textField.some(showsName);
}

/**
 * What the map's style depends on: the basemap, and for a vector basemap the
 * language too, as its labels follow it. Raster tiles have their labels drawn
 * in, so a new language leaves their style as it is.
 */
export function styleKey(id: BasemapId, lang: string): string {
  return BASEMAPS[id].vector ? `${id}:${lang}` : id;
}
