// The phone layout, in a Pixel 7-sized Chromium (see playwright.config.ts).
import { expect, test } from '@playwright/test';
import { open, stubNetwork } from './helpers';

test.beforeEach(async ({ page }) => {
  await stubNetwork(page);
  await page.goto('./');
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
  await page.getByRole('button', { name: 'Try the sample ride' }).click();
  await expect(page.getByText('3 of 3 shown · 3 loaded')).toBeVisible();
  const vp = page.viewportSize()!;
  const panel = (await page.locator('.panel').boundingBox())!;
  expect(Math.round(panel.y + panel.height)).toBe(vp.height);
  expect(Math.round(panel.width)).toBe(vp.width);
  // The timeline starts minimized on a phone.
  await expect(page.getByRole('region', { name: 'Timeline' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Show the timeline' }).click();
  const tl = (await page.getByRole('region', { name: 'Timeline' }).boundingBox())!;
  expect(tl.y + tl.height).toBeLessThanOrEqual(panel.y + 1);
  for (const lane of await page.locator('.lane').all()) {
    const b = (await lane.boundingBox())!;
    expect(b.y + b.height).toBeLessThanOrEqual(tl.y + tl.height);
  }
  await expect(page.locator('.tl-values')).toContainText('km/h');
  await expect(page.getByRole('button', { name: 'Fit the tracks' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Zoom in' })).toBeHidden();
  await expect(page.getByRole('button', { name: 'UTC' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(vp.width);
});

test('opens the color pane and the time zone list as bottom sheets', async ({ page }) => {
  await open(page, 'central-park-loop.nmea');
  const vp = page.viewportSize()!;
  await page.getByRole('button', { name: /^Color/ }).click();
  const pane = (await page.getByRole('dialog', { name: 'Color track A by' }).boundingBox())!;
  expect(Math.round(pane.width)).toBe(vp.width);
  expect(Math.round(pane.y + pane.height)).toBe(vp.height);
  await page.getByRole('dialog', { name: 'Color track A by' }).getByRole('button', { name: 'Close' }).click();
  await page.getByRole('button', { name: 'Show the timeline' }).click();
  await page.getByRole('button', { name: /Other/ }).click();
  const zones = (await page.getByRole('dialog', { name: 'Pick a time zone' }).boundingBox())!;
  expect(Math.round(zones.width)).toBe(vp.width);
  expect(Math.round(zones.y + zones.height)).toBe(vp.height);
});

test('opens the details page at the top', async ({ page }) => {
  await open(page, 'central-park-loop-truncated.nmea');
  await page.locator('.track-row[data-track="A"]').getByRole('button', { name: /^Details/ }).click();
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

test('minimizes both panes to two small buttons', async ({ page }) => {
  await open(page, 'central-park-loop.nmea');
  await page.getByRole('button', { name: 'Minimize the panel' }).click();
  await expect(page.locator('.panel')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Show the panel' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Show the timeline' })).toBeVisible();
  await expect(page.getByText('Track Log Plotter')).toHaveCount(0);
});
