// The phone layout, in a Pixel 7-sized Chromium (see playwright.config.ts).
import { expect, test } from '@playwright/test';
import { open, stubNetwork } from './helpers';

test.beforeEach(async ({ page }) => {
  await stubNetwork(page);
  await page.goto('./');
});

test('points the panel arrows down to hide the bottom sheet and up to bring it back', async ({ page }) => {
  await page.getByRole('button', { name: 'Try the sample ride' }).click();
  const hide = page.getByRole('button', { name: 'Minimize the panel' });
  // The bottom-sheet icon: a divider near the bottom and a downward arrow.
  await expect(hide.locator('path')).toHaveAttribute('d', 'M2.5 11h13M7.2 6.2L9 8l1.8-1.8');
  await hide.click();
  await expect(page.getByRole('button', { name: 'Show the panel' }).locator('path')).toHaveAttribute('d', 'M2.5 11h13M7.2 8L9 6.2l1.8 1.8');
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

test('minimizes both panes to two small buttons', async ({ page }) => {
  await open(page, 'central-park-loop.nmea');
  await page.getByRole('button', { name: 'Minimize the panel' }).click();
  await expect(page.locator('.panel')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Show the panel' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Show the timeline' })).toBeVisible();
  await expect(page.getByText('Track Log Plotter')).toHaveCount(0);
});
