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

/**
 * The color Safari on an iPhone (26 and later) gives the strip behind its bar at the top or bottom of the page, by the
 * rule read from WebKit (LocalFrameView::fixedContainerEdges): the element at the edge's middle, 4px in; the first
 * fixed or sticky element there or above it; that one's background color, if it spans 90% of the width and is over
 * 10px deep, blended over the page's background when under 75% opaque. With nothing fixed there, the strip is the
 * page's background. These tests run in Chromium, so they check the rule's inputs rather than Safari's strip.
 */
export async function safariStrip(page: Page, edge: 'top' | 'bottom'): Promise<{ color: string; from: string }> {
  return page.evaluate((side) => {
    const pageColor = getComputedStyle(document.body).backgroundColor;
    for (let el = document.elementFromPoint(innerWidth / 2, side === 'top' ? 4 : innerHeight - 4); el && el !== document.documentElement; el = el.parentElement) {
      const cs = getComputedStyle(el);
      if (cs.position !== 'fixed' && cs.position !== 'sticky') continue;
      const r = el.getBoundingClientRect(), from = el.classList[0] ?? el.tagName;
      if (r.width < 0.9 * (innerWidth - 8) || r.height <= 10) return { color: 'narrow', from };
      const alpha = Number(cs.backgroundColor.match(/[\d.]+/g)?.[3] ?? 1);
      return { color: alpha < 0.75 ? pageColor : cs.backgroundColor, from };
    }
    return { color: pageColor, from: 'body' };
  }, edge);
}

type Box = { x: number; y: number; width: number; height: number };

/** The area two boxes share (px²): 0 when they don't overlap. */
export function overlap(a: Box, b: Box): number {
  const w = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  return Math.max(0, w) * Math.max(0, h);
}

/**
 * Touches the screen at (x, y) and slides the finger `up` px upwards, through the browser's own touch input
 * (as a phone's screen sends it), so CSS touch-action decides whether it scrolls. Phone project only.
 */
export async function swipeUp(page: Page, x: number, y: number, up: number) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
  for (let k = 1; k <= 10; k++) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: y - (up * k) / 10 }] });
    await page.waitForTimeout(16);
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await cdp.detach();
}

/** Turns the map with two fingers twisting about (x, y), as on a phone. Phone project only. */
export async function twist(page: Page, x: number, y: number, degrees = 60) {
  const cdp = await page.context().newCDPSession(page);
  const fingers = (deg: number) => [0, 180].map((a, id) => {
    const r = ((a + deg) * Math.PI) / 180;
    return { x: x + 70 * Math.cos(r), y: y + 70 * Math.sin(r), id };
  });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: fingers(0) });
  for (let k = 1; k <= 15; k++) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: fingers((degrees * k) / 15) });
    await page.waitForTimeout(16);
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await cdp.detach();
}
