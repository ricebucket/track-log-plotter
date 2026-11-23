// The shape of a track's letter badge says which kind of file it came from,
// so formats tell apart without relying on color: GPX a circle, NMEA a rounded
// square, Columbus Fusion a hexagon, and a track combined from several logs a diamond.
import type { Format } from '../model/types';

export type BadgeShape = 'circle' | 'square' | 'hexagon' | 'diamond';

export const FORMAT_SHAPE: Record<Format, BadgeShape> = { gpx: 'circle', nmea: 'square', fusion: 'hexagon', combined: 'diamond' };

/** Traces a badge shape of half-width r around (cx, cy) on a canvas. */
export function traceShape(g: CanvasRenderingContext2D, shape: BadgeShape, cx: number, cy: number, r: number) {
  g.beginPath();
  if (shape === 'circle') {
    g.arc(cx, cy, r, 0, Math.PI * 2);
  } else if (shape === 'square') {
    g.roundRect(cx - r, cy - r, 2 * r, 2 * r, r * 0.48);
  } else if (shape === 'diamond') {
    const d = r * 1.12;
    g.moveTo(cx, cy - d); g.lineTo(cx + d, cy); g.lineTo(cx, cy + d); g.lineTo(cx - d, cy);
    g.closePath();
  } else {
    // Flat-topped, as wide as the circle.
    const h = r * 0.94;
    g.moveTo(cx - r / 2, cy - h); g.lineTo(cx + r / 2, cy - h); g.lineTo(cx + r, cy);
    g.lineTo(cx + r / 2, cy + h); g.lineTo(cx - r / 2, cy + h); g.lineTo(cx - r, cy);
    g.closePath();
  }
}
