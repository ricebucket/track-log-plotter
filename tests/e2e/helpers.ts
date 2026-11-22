import type { Page } from '@playwright/test';
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

/** Opens fixture files through the app's file picker. */
export async function open(page: Page, ...names: string[]) {
  await page.locator('#tlp-file-input').setInputFiles(names.map((n) => join(FIX, n)));
}
