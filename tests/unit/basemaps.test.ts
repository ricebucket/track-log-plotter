// The basemaps' credit lines, which labels follow the app's language, and when
// a change of language reloads the map's style.
import { describe, expect, it } from 'vitest';
import { BASEMAPS, BASEMAP_IDS, showsName, styleKey } from '../../src/map/basemaps';

describe('basemap credits', () => {
  it('opens every credit link in a new tab, sending the provider no page address', () => {
    for (const id of BASEMAP_IDS) {
      const links = [...BASEMAPS[id].attribution.matchAll(/<a\b[^>]*>/g)].map((m) => m[0]);
      expect(links.length, id).toBeGreaterThan(0);
      for (const a of links) {
        expect(a, id).toContain('target="_blank"');
        expect(a, id).toContain('rel="noopener noreferrer"');
      }
    }
  });

  it('credits OpenMapTiles on the OpenFreeMap basemaps, as its terms ask, and OpenStreetMap on all but the imagery', () => {
    for (const id of BASEMAP_IDS) {
      const text = BASEMAPS[id].attribution;
      expect(text.includes('© OpenMapTiles'), id).toBe(BASEMAPS[id].provider === 'OpenFreeMap');
      expect(text.includes('OpenStreetMap'), id).toBe(!BASEMAPS[id].provider.startsWith('Esri'));
    }
  });
});

describe('basemap labels in Chinese', () => {
  it('changes the labels that show a name, as tokens or as an expression', () => {
    expect(showsName('{name:latin}\n{name:nonlatin}')).toBe(true);
    expect(showsName('{name_en}')).toBe(true);
    expect(showsName('{name}')).toBe(true);
    expect(showsName(['coalesce', ['get', 'name:en'], ['get', 'name']])).toBe(true);
    expect(showsName(['format', ['get', 'name_int'], { 'font-scale': 0.8 }])).toBe(true);
  });

  it('leaves road numbers on shields, house numbers and other labels as they are', () => {
    expect(showsName('{ref}')).toBe(false);
    expect(showsName(['to-string', ['get', 'ref']])).toBe(false);
    expect(showsName(['get', 'housenumber'])).toBe(false);
    expect(showsName(['match', ['get', 'class'], 'name', 'a', 'b'])).toBe(false);
    expect(showsName(['get', 'names'])).toBe(false);
    expect(showsName(undefined)).toBe(false);
    expect(showsName('')).toBe(false);
  });

  it('reloads the style for a new language on a vector basemap only: raster tiles have their labels drawn in', () => {
    expect(styleKey('light', 'en')).not.toBe(styleKey('light', 'zh'));
    expect(styleKey('dark', 'en')).not.toBe(styleKey('dark', 'zh'));
    for (const id of ['osm', 'topo', 'satellite', 'hybrid'] as const) expect(styleKey(id, 'en'), id).toBe(styleKey(id, 'zh'));
    expect(new Set(BASEMAP_IDS.map((id) => styleKey(id, 'en'))).size).toBe(BASEMAP_IDS.length);
  });
});
