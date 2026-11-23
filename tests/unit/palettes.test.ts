import { describe, expect, it } from 'vitest';
import { SINGLE, palette } from '../../src/color/palettes';

/** OKLab lightness, a and b of a #rrggbb color. */
function oklab(hex: string): [number, number, number] {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s];
}
const hue = (c: [number, number, number]) => ((Math.atan2(c[2], c[1]) * 180) / Math.PI + 360) % 360;
const distance = (p: number[], q: number[]) => Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);

describe('one-track colors', () => {
  for (const [mode, steps] of [['light', SINGLE.mag.light5], ['dark', SINGLE.mag.dark5]] as const) {
    it(`run from blue to amber, lighter at every step and far apart (${mode} maps)`, () => {
      const lab = steps.map(oklab);
      for (let i = 1; i < lab.length; i++) {
        expect(lab[i][0], `step ${i + 1} is lighter`).toBeGreaterThan(lab[i - 1][0]);
        expect(distance(lab[i], lab[i - 1]), `steps ${i} and ${i + 1} differ`).toBeGreaterThan(0.15);
      }
      expect(hue(lab[0])).toBeGreaterThan(240);
      expect(hue(lab[0])).toBeLessThan(290);
      expect(hue(lab[4])).toBeGreaterThan(50);
      expect(hue(lab[4])).toBeLessThan(115);
    });
  }

  it('are used only while a single track is shown', () => {
    expect(palette(0, 'speed', false, true)).toEqual(SINGLE.mag.light5);
    expect(palette(0, 'ele', true, true)).toEqual(SINGLE.mag.dark5);
    expect(palette(0, 'speed', false, false)).not.toEqual(SINGLE.mag.light5);
  });
});
