// The phone layout, in a Pixel 7-sized Chromium (see playwright.config.ts).
import { expect, test, type Locator, type Page } from '@playwright/test';
import { open, overlap, pillSides, safariStrip, stubNetwork, swipeUp, twist, wideFont } from './helpers';

test.beforeEach(async ({ page }) => {
  await stubNetwork(page);
  await page.goto('./');
});

test('centers the title in its pill on the start screen', async ({ page }) => {
  const [left, right] = await pillSides(page);
  expect(left).toBeGreaterThanOrEqual(12);
  expect(Math.abs(left - right)).toBeLessThanOrEqual(1);
});

test('keeps the map credits clear of the title and the start card on the start screen, on small phones too', async ({ page }) => {
  // The credits sat at the top left under the title's pill, which hid their start.
  await wideFont(page);
  for (const [width, height] of [[412, 915], [375, 667], [360, 640]]) {
    await page.setViewportSize({ width, height });
    const credits = (await page.locator('.attribution').boundingBox())!;
    expect(credits.width, `${width} px`).toBeGreaterThan(0);
    expect(overlap(credits, (await page.locator('.brand-pill').boundingBox())!), `title, ${width} px`).toBe(0);
    expect(overlap(credits, (await page.locator('.empty-card').boundingBox())!), `start card, ${width} px`).toBe(0);
    expect(overlap(credits, (await page.locator('.bm-button').boundingBox())!), `Options, ${width} px`).toBe(0);
    expect(credits.x + credits.width, `${width} px`).toBeLessThanOrEqual(width);
    expect(credits.y + credits.height, `${width} px`).toBeLessThanOrEqual(height);
  }
});

test('hides the bottom sheet with a down arrow, as the timeline, and brings it back with the sheet icon pointing up', async ({ page }) => {
  await page.getByRole('button', { name: 'Try the samples' }).click();
  const hide = page.getByRole('button', { name: 'Minimize the panel' });
  await expect(hide.locator('path')).toHaveAttribute('d', 'M5 7l4 4 4-4');
  await hide.click();
  // The bottom-sheet icon: a divider near the bottom and an upward arrow.
  await expect(page.getByRole('button', { name: 'Show the panel' }).locator('path')).toHaveAttribute('d', 'M2.5 11h13M7.2 8L9 6.2l1.8 1.8');
});

test("gives the sheet's whole height to the list: no title bar, and Minimize at the right of the list's top row", async ({ page }) => {
  // A dark title bar took a row of the sheet, and its icon didn't read as Minimize: at the top right of the list was Add.
  await wideFont(page);
  await page.getByRole('button', { name: 'Try the samples' }).click();
  await expect(page.getByText('2 of 3 shown · 2 loaded')).toBeVisible();
  await expect(page.locator('.panel-head')).toHaveCount(0);
  const hide = page.getByRole('button', { name: 'Minimize the panel' });
  for (const width of [412, 360, 320]) {
    await page.setViewportSize({ width, height: 800 });
    const b = (await hide.boundingBox())!, add = (await page.locator('#tlp-add').boundingBox())!;
    const panel = (await page.locator('.panel').boundingBox())!, list = (await page.locator('.track-list').boundingBox())!;
    expect(b.x, `${width} px`).toBeGreaterThan(add.x + add.width);
    expect(b.x + b.width, `${width} px`).toBeLessThanOrEqual(panel.x + panel.width);
    expect(b.y + b.height, `${width} px`).toBeLessThanOrEqual(list.y);
    expect(await page.locator('.panel .sec-head').first().evaluate((h) => h.scrollWidth - h.clientWidth), `${width} px`).toBeLessThanOrEqual(1);
  }
  // The same on the Properties page, at the right of Back.
  await page.locator('.track-row[data-track="A"]').getByRole('button', { name: /^Properties/ }).click();
  await expect(page.locator('.details-top').getByRole('button', { name: 'Minimize the panel' })).toBeInViewport();
});

test("colors the strip around Safari's bottom address bar like the sheet: no gray gap between them", async ({ page }) => {
  // Safari on an iPhone paints that strip in the color of the fixed element at the bottom edge. That was the layer
  // holding the whole app, which is see-through, so the strip took the page's gray: a band below the sheet.
  await page.getByRole('button', { name: 'Try the samples' }).click();
  await expect(page.getByText('2 of 3 shown · 2 loaded')).toBeVisible();
  const sheet = await page.locator('.panel').evaluate((p) => getComputedStyle(p).backgroundColor);
  expect(await safariStrip(page, 'bottom')).toEqual({ color: sheet, from: 'panel' });
  // In select mode too, where the bar of actions sits at the foot of the sheet.
  await page.getByRole('button', { name: 'Select' }).click();
  expect((await safariStrip(page, 'bottom')).color).toBe(sheet);
});

test('opens the Options menu from the basemap button', async ({ page }) => {
  const vp = page.viewportSize()!;
  await page.getByRole('button', { name: /Options/ }).click();
  const menu = page.getByRole('dialog', { name: 'Options' });
  await expect(menu.getByRole('heading', { name: 'Language' })).toBeVisible();
  await expect(menu.getByRole('heading', { name: 'Units' })).toBeVisible();
  const b = (await menu.boundingBox())!;
  expect(b.x).toBeGreaterThanOrEqual(0);
  expect(b.x + b.width).toBeLessThanOrEqual(vp.width);
});

test('docks the panel as a bottom sheet and the timeline above it', async ({ page }) => {
  await page.getByRole('button', { name: 'Try the samples' }).click();
  await expect(page.getByText('2 of 3 shown · 2 loaded')).toBeVisible();
  const vp = page.viewportSize()!;
  const panel = (await page.locator('.panel').boundingBox())!;
  expect(Math.round(panel.y + panel.height)).toBe(vp.height);
  expect(Math.round(panel.width)).toBe(vp.width);
  // The timeline starts minimized on a phone, so Fit is on the map.
  await expect(page.getByRole('region', { name: 'Timeline' })).toHaveCount(0);
  await expect(page.locator('.map-tools').getByRole('button', { name: 'Fit the tracks' })).toBeVisible();
  await page.getByRole('button', { name: 'Show the timeline' }).click();
  const tl = (await page.getByRole('region', { name: 'Timeline' }).boundingBox())!;
  expect(tl.y + tl.height).toBeLessThanOrEqual(panel.y + 1);
  for (const lane of await page.locator('.lane').all()) {
    const b = (await lane.boundingBox())!;
    expect(b.y + b.height).toBeLessThanOrEqual(tl.y + tl.height);
  }
  // One header row: no readout line; the graph shows its value at the cursor instead.
  await expect(page.locator('.tl-values')).toHaveCount(0);
  expect((await page.locator('.tl-head').boundingBox())!.height).toBeLessThan(48);
  await expect(page.locator('.lane[data-role="color"] .lane-value').first()).toContainText('km/h');
  await expect(page.getByRole('button', { name: 'Fit the tracks' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Zoom in' })).toBeHidden();
  await expect(page.getByRole('button', { name: 'Time zone: Local' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(vp.width);
});

test("keeps the timeline's header inside the pane on narrow phones: the date and the badge give way first", async ({ page }) => {
  // An overnight log shows the date in the header: on a 360 px phone it pushed Minimize half off the screen, and
  // zoomed in on a 320 px one, entirely.
  await wideFont(page);
  await page.evaluate(() => localStorage.setItem('tlp.prefs.v1', JSON.stringify({ timelineMin: false, zone: 'utc' })));
  await page.reload();
  await open(page, 'hudson-overnight.gpx');
  const head = page.locator('.tl-head'), hide = page.getByRole('button', { name: 'Minimize the timeline' });
  const fits = async (label: string) => {
    // The header settles a moment after the pane's width changes (it measures itself).
    await expect.poll(() => head.evaluate((h) => h.scrollWidth - h.clientWidth), { message: label }).toBeLessThanOrEqual(1);
    const b = (await hide.boundingBox())!, pane = (await page.locator('.timeline').boundingBox())!;
    expect(b.x + b.width, label).toBeLessThanOrEqual(pane.x + pane.width);
  };
  await page.setViewportSize({ width: 412, height: 800 });
  await expect(page.locator('.tl-time')).toContainText('Jul 11,');
  await expect(head.locator('.badge')).toHaveCount(1);
  await fits('412 px');
  for (const width of [390, 360, 320]) {
    await page.setViewportSize({ width, height: 800 });
    await expect(page.locator('.tl-time')).not.toContainText('Jul');
    await expect(head.locator('.badge')).toHaveCount(0);
    await fits(`${width} px`);
  }
  // The date still shows on the tick at midnight.
  await expect(page.locator('.tl-ticks .tick-date')).toHaveText(['Jul 12']);
  // Zoomed in: Reset zoom joins the buttons.
  const lanes = (await page.locator('.tl-lanes').boundingBox())!;
  await page.mouse.move(lanes.x + lanes.width * 0.7, lanes.y + 15);
  await page.mouse.wheel(0, -600);
  await expect(page.getByRole('button', { name: 'Reset zoom' })).toBeVisible();
  for (const width of [412, 360, 320]) {
    await page.setViewportSize({ width, height: 800 });
    await fits(`${width} px, zoomed`);
  }
});

test('opens the color pane and the time zone list as bottom sheets', async ({ page }) => {
  await open(page, 'central-park-loop.nmea');
  const vp = page.viewportSize()!;
  await page.getByRole('button', { name: /^Color/ }).click();
  const pane = (await page.getByRole('dialog', { name: 'Color, halo and timeline' }).boundingBox())!;
  expect(Math.round(pane.width)).toBe(vp.width);
  expect(Math.round(pane.y + pane.height)).toBe(vp.height);
  await page.getByRole('dialog', { name: 'Color, halo and timeline' }).getByRole('button', { name: 'Close' }).click();
  await page.getByRole('button', { name: 'Show the timeline' }).click();
  await page.getByRole('button', { name: 'Time zone: Local' }).click();
  const list = page.getByRole('dialog', { name: 'Pick a time zone' });
  const zones = (await list.boundingBox())!;
  expect(Math.round(zones.width)).toBe(vp.width);
  expect(Math.round(zones.y + zones.height)).toBe(vp.height);
  // The phone's one zone button offers UTC at the top of the list (the zone list itself has UTC too).
  await list.getByRole('radio', { name: /^UTC/ }).first().click();
  await expect(page.getByRole('button', { name: 'Time zone: UTC' })).toBeVisible();
});

test('opens the properties page at the top', async ({ page }) => {
  await open(page, 'central-park-loop-truncated.nmea');
  await page.locator('.track-row[data-track="A"]').getByRole('button', { name: /^Properties/ }).click();
  await expect(page.getByRole('button', { name: 'Back' })).toBeInViewport();
  await expect(page.getByText('Last line cut off')).toBeVisible();
});

test('explains a computed value on tap', async ({ page }) => {
  await open(page, 'central-park-loop.nmea');
  await page.locator('.stats .computed-btn').first().tap();
  await expect(page.getByRole('tooltip')).toContainText('straight-line distances');
  await page.locator('.map').tap({ position: { x: 20, y: 200 } });
  await expect(page.getByRole('tooltip')).toHaveCount(0);
});

/** A map button with a notice showing: clear of the notice, and what is at its center is the button itself. */
async function clearOf(page: Page, notice: Locator, button: Locator, name: string) {
  const b = (await button.boundingBox())!;
  expect(overlap((await notice.boundingBox())!, b), name).toBe(0);
  const at = await page.evaluate(([x, y]) => document.elementFromPoint(x, y)?.closest('button')?.getAttribute('aria-label'), [b.x + b.width / 2, b.y + b.height / 2]);
  expect(at).toBe(name);
}

test('keeps the notices clear of Fit and the compass under the Options button', async ({ page }) => {
  // A damaged file's notice across the top. The timeline starts minimized on a phone, so Fit is on the map.
  await open(page, 'damaged.nmea');
  const notice = page.locator('.toasts .toast');
  await expect(notice).toBeVisible();
  const fit = page.locator('.map-tools').getByRole('button', { name: 'Fit the tracks' });
  await clearOf(page, notice, fit, 'Fit the tracks');
  await fit.click({ timeout: 3000 });
  // With the timeline shown, Fit moves into it; with the map turned, the compass shows there instead.
  await page.getByRole('button', { name: 'Show the timeline' }).click();
  await expect(fit).toHaveCount(0);
  const vp = page.viewportSize()!;
  await twist(page, vp.width / 2, vp.height * 0.3);
  const compass = page.getByRole('button', { name: 'Turn the map north up' });
  await expect(compass).toBeVisible();
  await clearOf(page, notice, compass, 'Turn the map north up');
});

test('keeps the map credits clear of the Options button, whichever basemap they credit', async ({ page }) => {
  // In the CI runners' wide fallback font too: the credits wrap beside the button.
  await wideFont(page);
  await open(page, 'central-park-loop.nmea');
  const options = page.locator('.bm-button');
  await options.click();
  const tiles = page.getByRole('dialog', { name: 'Options' }).locator('.bm-tile');
  const n = await tiles.count();
  expect(n).toBeGreaterThan(3);
  for (let k = 0; k < n; k++) {
    await tiles.nth(k).click();
    await expect(tiles.nth(k)).toHaveAttribute('aria-pressed', 'true');
    const credits = (await page.locator('.attribution').boundingBox())!;
    expect(overlap(credits, (await options.boundingBox())!), `basemap ${k + 1}`).toBe(0);
  }
});

test('scrolls the lanes by touch on their labels, while a finger on a graph moves the cursor', async ({ page }) => {
  // A small phone on its side, with the halo graph: the lanes are taller than the pane, which scrolls them.
  await page.setViewportSize({ width: 568, height: 320 });
  await page.evaluate(() => localStorage.setItem('tlp.prefs.v1', JSON.stringify({ timelineMin: false, haloGraph: true })));
  await page.reload();
  await open(page, 'central-park-loop.nmea', 'central-park-loop-vendor.gpx', 'roosevelt-island-run.gpx');
  await expect(page.locator('.tl-lanes > .lane')).toHaveCount(4);
  const lanes = page.locator('.tl-lanes');
  expect(await lanes.evaluate((el) => el.scrollHeight - el.clientHeight)).toBeGreaterThan(20);
  const scrolled = () => lanes.evaluate((el) => el.scrollTop);
  // On a graph, a swipe moves the cursor and leaves the lanes where they are.
  const graph = (await page.locator('.lane-canvas').first().boundingBox())!;
  const time = (await page.locator('.tl-time').textContent())!;
  await swipeUp(page, graph.x + graph.width * 0.6, graph.y + graph.height / 2, 80);
  await expect(page.locator('.tl-time')).not.toHaveText(time);
  expect(await scrolled()).toBe(0);
  // On the labels, it scrolls them.
  const box = (await lanes.boundingBox())!;
  await swipeUp(page, box.x + 30, box.y + box.height - 10, 80);
  await expect.poll(scrolled).toBeGreaterThan(0);
});

test('minimizes both panes to two small buttons', async ({ page }) => {
  await open(page, 'central-park-loop.nmea');
  await page.getByRole('button', { name: 'Minimize the panel' }).click();
  await expect(page.locator('.panel')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Show the panel' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Show the timeline' })).toBeVisible();
  await expect(page.getByText('Track Log Plotter')).toHaveCount(0);
});
