import type { ColorKey } from '../model/types';

// Color ranges from the approved design, checked with the dataviz validator.
// Several tracks: one range per track, matched in lightness step by step.
// One track: broad multi-hue scales.

export interface Family {
  name: 'blue' | 'orange' | 'teal';
  light5: string[];
  dark5: string[];
  light4: string[];
  dark4: string[];
  /** Letter badge background. */
  badge: string;
}

export const FAMILIES: Family[] = [
  { name: 'blue', light5: ['#9dbdff', '#7992ff', '#675aff', '#5e1edb', '#4b0096'], dark5: ['#5b00cf', '#6546f9', '#7080ff', '#8cacff', '#b7d2ff'], light4: ['#9dbdff', '#7181ff', '#6234ea', '#4b0096'], dark4: ['#5b00cf', '#675aff', '#819eff', '#b7d2ff'], badge: '#5f25df' },
  { name: 'orange', light5: ['#f8ae00', '#dc8300', '#bd5a00', '#9e2f00', '#78000e'], dark5: ['#952100', '#b34d00', '#d17400', '#ed9c00', '#ffc845'], light4: ['#f8ae00', '#d27500', '#a83e00', '#78000e'], dark4: ['#952100', '#bd5a00', '#e48f00', '#ffc845'], badge: '#a13400' },
  { name: 'teal', light5: ['#00dfa2', '#00b594', '#008e7f', '#006966', '#00474a'], dark5: ['#005f5e', '#008278', '#00a78d', '#00ce9e', '#00f7a4'], light4: ['#00dfa2', '#00a88e', '#00756f', '#00474a'], dark4: ['#005f5e', '#008e7f', '#00c099', '#00f7a4'], badge: '#006c68' },
];

export const SINGLE = {
  /**
   * Amounts (speed, elevation, grade): a broad multi-hue scale, so low and
   * high are told apart at a glance. Low is blue and high is amber or yellow
   * on every basemap, and each step is lighter than the one before, so
   * color-blind viewers can still read the order.
   * Light maps: deep blue → purple → magenta → coral → amber (OKLCH lightness
   * 0.30 → 0.80). Dark maps: blue → magenta → pink → orange → yellow.
   * Checked with the dataviz validator: adjacent steps differ by ΔE ≥ 16.9
   * (normal vision) and ≥ 8.2 (color-blind simulations). The amber end is
   * light on light maps; the dark casing under every line keeps it visible.
   */
  mag: { light5: ['#041586', '#670dbd', '#cb228e', '#fb5a46', '#f4b00c'], dark5: ['#5a67f5', '#b845c4', '#f0607a', '#fd9d3a', '#f3f04b'] },
  /** Fix quality (HDOP, satellites): green to red. */
  qual: { light4: ['#029e72', '#f0c12a', '#ec7c0e', '#be2132'], dark4: ['#22b988', '#fad03e', '#f98f3a', '#e2484f'] },
  /** Fix type: plain GPS, corrected. */
  fix: { light2: ['#b3bfd2', '#008660'], dark2: ['#677284', '#37d59f'] },
};

/** Letter badge for a hidden track. */
export const HIDDEN_BADGE = '#9aa2a9';

/** Colors for each step of a measure. `single` is true when only one track is shown. */
export function palette(fam: number, key: ColorKey, dark: boolean, single: boolean): string[] {
  if (single) {
    if (key === 'none') return [dark ? '#8cacff' : '#675aff'];
    if (key === 'fix') return dark ? SINGLE.fix.dark2 : SINGLE.fix.light2;
    if (key === 'hdop' || key === 'sats') return dark ? SINGLE.qual.dark4 : SINGLE.qual.light4;
    return dark ? SINGLE.mag.dark5 : SINGLE.mag.light5;
  }
  const F = FAMILIES[((fam % 3) + 3) % 3];
  if (key === 'none') return [(dark ? F.dark5 : F.light5)[2]];
  if (key === 'fix') return dark ? [F.dark5[1], F.dark5[4]] : [F.light5[0], F.light5[3]];
  if (key === 'hdop' || key === 'sats') return dark ? F.dark4 : F.light4;
  return dark ? F.dark5 : F.light5;
}

/** Halo color and opacity: neutral for one track, tinted by the track's range for several. */
export function haloStyle(fam: number, dark: boolean, single: boolean): { color: string; opacity: number } {
  if (single) return { color: dark ? '#ffffff' : '#1b2a38', opacity: dark ? 0.24 : 0.17 };
  const F = FAMILIES[((fam % 3) + 3) % 3];
  return { color: dark ? F.dark5[4] : F.light5[0], opacity: dark ? 0.3 : 0.34 };
}

/** Extra halo width (px beyond the line) per step: the far end of the scale gets the widest halo. */
export function haloExtra(steps: number): number[] {
  if (steps === 2) return [2, 15];
  if (steps === 4) return [2, 8, 15, 23];
  return [1.5, 5.5, 10, 16, 23];
}

export const CASING = { light: 'rgba(10,16,22,0.55)', dark: 'rgba(0,0,0,0.72)' };
export const UNKNOWN = { light: '#a3a9ae', dark: '#7d858c' };
/** A combined track's logs 1 to 3: each in its color range's badge color, so log lines and numbers match. */
export const LOG_COLORS = FAMILIES.map((f) => f.badge);
/** A log left out for a large error: its stretch of line, its ring at the cursor, its timeline mark. */
export const LEFT_OUT = '#d92636';
export const GAP = { light: '#47525d', dark: '#d5dbe0' };
