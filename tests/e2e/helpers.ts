import { expect, type Locator, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const FIX = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures');
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const STYLE = {
  version: 8,
  glyphs: 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf',
  sources: {},
  layers: [{ id: 'bg', type: 'background', paint: { 'background-color': '#eef0f1' } }],
};

/** Answers every request to another host locally, so no test touches a real server. */
export async function stubNetwork(page: Page) {
  // Asks the map to report how many track lines it drew (see MapView).
  await page.addInitScript(() => { (window as unknown as { tlpTestHooks: boolean }).tlpTestHooks = true; });
  await page.route((url) => url.hostname !== 'localhost', async (route) => {
    const url = route.request().url();
    if (url.includes('/styles/')) return route.fulfill({ json: STYLE });
    if (url.endsWith('.pbf')) return route.fulfill({ status: 200, body: Buffer.alloc(0), contentType: 'application/x-protobuf' });
    if (url.includes('fonts.googleapis.com')) return route.fulfill({ status: 200, body: '', contentType: 'text/css' });
    return route.fulfill({ status: 200, body: PNG, contentType: 'image/png' });
  });
}

/** How many lines an element's text wraps onto. */
export function textLines(loc: Locator): Promise<number> {
  return loc.evaluate((el) => {
    const tops = new Set<number>();
    const walk = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    for (let n = walk.nextNode(); n; n = walk.nextNode()) {
      if (!n.textContent?.trim()) continue;
      const range = document.createRange();
      range.selectNodeContents(n);
      for (const r of range.getClientRects()) if (r.width > 0) tops.add(Math.round(r.top));
    }
    return tops.size;
  });
}

/** The space left and right of the title inside the start screen's title pill. */
export async function pillSides(page: Page): Promise<[number, number]> {
  const pill = (await page.locator('.brand-pill').boundingBox())!;
  const title = (await page.locator('.brand-pill .app-title').boundingBox())!;
  return [title.x - pill.x, pill.x + pill.width - (title.x + title.width)];
}

/** Waits until the map has drawn the tracks and finished fitting them into view. */
export async function mapSettled(page: Page) {
  const map = page.locator('.map');
  await expect(map).toHaveAttribute('data-lines', /^[1-9]\d*$/, { timeout: 20_000 });
  await expect(map).not.toHaveAttribute('data-fitting');
}

/** Opens fixture files through the app's file picker. */
export async function open(page: Page, ...names: string[]) {
  await page.locator('#tlp-file-input').setInputFiles(names.map((n) => join(FIX, n)));
}

/** Opens a fixture through the app's file picker under another file name. */
export async function openAs(page: Page, name: string, as: string) {
  await page.locator('#tlp-file-input').setInputFiles({ name: as, mimeType: 'application/octet-stream', buffer: readFileSync(join(FIX, name)) });
}

/**
 * Sets the app's text in a wide font, as on a computer that has neither the
 * web font (blocked in these tests, and for some visitors) nor the first
 * fallbacks: GitHub's Linux runners, for one.
 */
export async function wideFont(page: Page) {
  await page.addStyleTag({ content: ":root { --font: 'DejaVu Sans', Verdana, sans-serif !important; }" });
}
