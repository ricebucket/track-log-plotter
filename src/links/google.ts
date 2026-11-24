// Google Maps links: plain Maps URLs, which need no key and open in a new tab.
// https://developers.google.com/maps/documentation/urls/get-started

export type GoogleBase = 'roadmap' | 'satellite' | 'terrain';

/** Which Google map matches the app's basemap. */
export function googleBaseFor(basemap: string): GoogleBase {
  if (basemap === 'satellite' || basemap === 'hybrid') return 'satellite';
  if (basemap === 'topo') return 'terrain';
  return 'roadmap';
}

const c = (v: number) => v.toFixed(6);

/**
 * The same view in Google Maps. `zoom` is MapLibre's, whose tiles are 512
 * pixels wide; Google's are 256, so the same scale is one zoom level more there.
 */
export function googleViewUrl(lat: number, lon: number, zoom: number, base: GoogleBase): string {
  const z = Math.max(0, Math.min(21, Math.round(zoom + 1)));
  return `https://www.google.com/maps/@?api=1&map_action=map&center=${c(lat)}%2C${c(lon)}&zoom=${z}&basemap=${base}`;
}

export function streetViewUrl(lat: number, lon: number, heading?: number): string {
  const h = heading !== undefined && Number.isFinite(heading) ? `&heading=${Math.round(((heading % 360) + 360) % 360)}` : '';
  return `https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${c(lat)}%2C${c(lon)}${h}`;
}
