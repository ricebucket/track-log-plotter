// What the interface needs from the map, without loading MapLibre itself
// (component tests run without WebGL).
import { signal } from '@preact/signals';

/** Map controls for the buttons beside the map. Filled in once the map exists. */
export const mapApi = {
  zoomIn: () => {},
  zoomOut: () => {},
  fit: () => {},
  north: () => {},
};

/** Screen position of the selected track's cursor fix, for the inspector card. */
export const tipXY = signal<{ x: number; y: number } | null>(null);

/** Set when the browser can't draw the map (no WebGL). */
export const mapFailed = signal(false);
