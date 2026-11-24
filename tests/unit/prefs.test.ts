// @vitest-environment happy-dom
// Preferences saved in this browser: whatever is stored (an older version's,
// a hand edit, `null`), the app starts, keeping only values of the right kind.
import { afterEach, describe, expect, it, vi } from 'vitest';

const KEY = 'tlp.prefs.v1';

/** The store as it starts with `raw` saved. */
async function startWith(raw: string) {
  vi.resetModules();
  localStorage.setItem(KEY, raw);
  return import('../../src/state/store');
}

/** The switches as the store starts with them. */
const switches = (S: typeof import('../../src/state/store')) => ({
  panelMin: S.panelMin.value, timelineMin: S.timelineMin.value, arrows: S.showArrows.value,
  fixes: S.showFixes.value, gaps: S.showGaps.value, haloGraph: S.showHaloGraph.value,
});

const DEFAULTS = { panelMin: false, timelineMin: false, arrows: true, fixes: false, gaps: true, haloGraph: false };

afterEach(() => localStorage.clear());

describe('saved preferences', () => {
  for (const raw of ['null', '"light"', '[true]', '42', 'true', '{not json']) {
    it(`starts with the defaults when the saved value is ${raw}`, async () => {
      const S = await startWith(raw);
      expect(switches(S)).toEqual(DEFAULTS);
      expect([S.basemap.value, S.zone.value, S.units.value, S.dim.value]).toEqual(['light', 'local', 'metric', 0]);
      // What it saves next is a proper object.
      expect(JSON.parse(localStorage.getItem(KEY)!)).toMatchObject({ basemap: 'light', panelMin: false });
    });
  }

  it('takes only true or false for a switch: the text "false" and other values give its default', async () => {
    const S = await startWith(JSON.stringify({ panelMin: 'false', timelineMin: 'true', arrows: 0, fixes: 'yes', gaps: null, haloGraph: 1 }));
    expect(switches(S)).toEqual(DEFAULTS);
  });

  it('keeps the values of the right kind', async () => {
    const S = await startWith(JSON.stringify({ panelMin: true, timelineMin: true, arrows: false, fixes: true, gaps: false, haloGraph: true, basemap: 'dark', zone: 'Asia/Tokyo', units: 'imperial', dim: 0.3, lang: 'zh' }));
    expect(switches(S)).toEqual({ panelMin: true, timelineMin: true, arrows: false, fixes: true, gaps: false, haloGraph: true });
    expect([S.basemap.value, S.zone.value, S.lastZone.value, S.units.value, S.dim.value, S.lang.value]).toEqual(['dark', 'Asia/Tokyo', 'Asia/Tokyo', 'imperial', 0.3, 'zh']);
  });

  it('ignores a basemap, zone or language of the wrong kind', async () => {
    const S = await startWith(JSON.stringify({ basemap: ['dark'], zone: 9, lastZone: { id: 'Asia/Tokyo' }, lang: 7 }));
    expect([S.basemap.value, S.zone.value, S.lastZone.value]).toEqual(['light', 'local', null]);
    expect(['en', 'zh']).toContain(S.lang.value);
  });
});
