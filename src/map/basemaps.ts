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

const OSM_ATTR = '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';
const ESRI_ATTR = 'Imagery: Esri, Maxar, Earthstar Geographics and the GIS User Community · Powered by <a href="https://www.esri.com">Esri</a>';

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
    id: 'light', provider: 'OpenFreeMap', vector: true,
    attribution: '<a href="https://openfreemap.org">OpenFreeMap</a> · ' + OSM_ATTR,
    style: 'https://tiles.openfreemap.org/styles/positron',
    thumb: { land: '#f3f3f1', water: '#c9d5df', park: '#e4eadd', road: '#ffffff' },
  },
  dark: {
    id: 'dark', provider: 'OpenFreeMap', vector: true,
    attribution: '<a href="https://openfreemap.org">OpenFreeMap</a> · ' + OSM_ATTR,
    style: 'https://tiles.openfreemap.org/styles/dark',
    thumb: { land: '#22262b', water: '#14191f', park: '#273029', road: '#3a4048' },
  },
  topo: {
    id: 'topo', provider: 'OpenTopoMap', vector: false,
    attribution: 'Map data: ' + OSM_ATTR + ', SRTM · Map style: © <a href="https://opentopomap.org">OpenTopoMap</a> (CC-BY-SA)',
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

/** Label expression for vector basemaps in Chinese: Simplified Chinese, then Chinese, then the local name. */
export const ZH_LABEL: ExpressionSpecification = ['coalesce', ['get', 'name:zh-Hans'], ['get', 'name:zh'], ['get', 'name']];
