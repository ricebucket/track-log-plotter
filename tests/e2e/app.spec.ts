// End-to-end tests against the built site in Chromium. Every request to
// another host (tiles, styles, fonts) is answered locally, so no test touches
// a real server.
import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { open, stubNetwork } from './helpers';

test.beforeEach(async ({ page }) => {
  await stubNetwork(page);
  await page.goto('./');
});

test('opens files and flags the damaged one', async ({ page }) => {
  await expect(page.getByRole('heading', { name: 'Plot your GPS track logs' })).toBeVisible();
  await open(page, 'central-park-loop-truncated.nmea', 'central-park-loop-vendor.gpx');
  await expect(page.getByText('central-park-loop-truncated.nmea', { exact: true })).toBeVisible();
  await expect(page.getByText('2 of 3 shown · 2 loaded')).toBeVisible();
  await expect(page.getByText('1 problem', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Show details' }).click();
  await expect(page.getByText('Last line cut off')).toBeVisible();
});

test('loads the sample ride and draws the tracks', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|pbf|glyph/i.test(m.text())) errors.push(m.text()); });
  await page.getByRole('button', { name: 'Try the sample ride' }).click();
  await expect(page.getByText('3 of 3 shown · 3 loaded')).toBeVisible();
  await expect(page.locator('.maplibregl-canvas')).toBeVisible();
  // The map fills the window (MapLibre's own stylesheet must not shrink it).
  const size = page.viewportSize()!;
  expect(await page.locator('.maplibregl-canvas').evaluate((c) => [c.clientWidth, c.clientHeight])).toEqual([size.width, size.height]);
  // The map reports how many track lines it drew once it settles.
  await expect(page.locator('.map')).toHaveAttribute('data-lines', /^[1-9]\d*$/, { timeout: 20_000 });
  // The selected track is drawn again on top, picked by MapLibre global state.
  await expect(page.locator('.map')).toHaveAttribute('data-sel-lines', /^[1-9]\d*$/);
  await page.locator('.track-row[data-track="C"] .track-main').click();
  await page.getByRole('button', { name: 'Fit the tracks' }).click();
  await expect(page.locator('.map')).toHaveAttribute('data-sel-lines', /^[1-9]\d*$/);
  expect(errors).toEqual([]);
});

test('minimizes and restores both panes', async ({ page }) => {
  await open(page, 'central-park-loop.nmea');
  await page.getByRole('button', { name: 'Minimize the panel' }).click();
  await expect(page.getByText('Track Log Plotter')).toHaveCount(0);
  await page.getByRole('button', { name: 'Minimize the timeline' }).click();
  await expect(page.getByRole('region', { name: 'Timeline' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Show the panel' }).click();
  await page.getByRole('button', { name: 'Show the timeline' }).click();
  await expect(page.getByRole('heading', { name: 'Track Log Plotter' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Timeline' })).toBeVisible();
});

test('switches to Chinese and remembers it', async ({ page }) => {
  await page.getByRole('button', { name: '中文' }).click();
  await expect(page.getByText('轨迹绘图器')).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: '把 GPS 轨迹记录画在地图上' })).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('lang', 'zh-CN');
});

test('explains each measure and recolors the track', async ({ page }) => {
  await open(page, 'central-park-loop.nmea');
  await page.getByRole('button', { name: /^Color/ }).click();
  const pane = page.getByRole('dialog', { name: 'Color track A by' });
  await expect(pane.getByText(/How many satellites the logger used/)).toBeVisible();
  await pane.getByRole('radio', { name: /Elevation/ }).click();
  await expect(pane).toHaveCount(0);
  await expect(page.getByText('Elevation (m)')).toBeVisible();
});

test('shows at most three tracks', async ({ page }) => {
  await open(page, 'central-park-loop.nmea', 'central-park-loop-vendor.gpx', 'roosevelt-island-run.gpx', 'hudson-greenway-evening.log');
  await expect(page.getByText('3 of 3 shown · 4 loaded')).toBeVisible();
  await page.getByRole('button', { name: 'Show track D' }).click();
  await expect(page.getByText('Three tracks are showing. Hide one to show this one.')).toBeVisible();
});

test('moving over the timeline moves the cursor', async ({ page }) => {
  await open(page, 'central-park-loop.nmea');
  const lanes = page.locator('.tl-lanes');
  const box = (await lanes.boundingBox())!;
  await page.mouse.move(box.x + box.width * 0.4, box.y + box.height / 2);
  const first = await page.locator('.tl-time').textContent();
  await page.mouse.move(box.x + box.width * 0.8, box.y + box.height / 2);
  await expect(page.locator('.tl-time')).not.toHaveText(first!);
});

test('has no serious accessibility problems', async ({ page }) => {
  await open(page, 'central-park-loop.nmea', 'central-park-loop-vendor.gpx');
  await expect(page.getByText('2 of 3 shown · 2 loaded')).toBeVisible();
  const results = await new AxeBuilder({ page }).exclude('.map').analyze();
  const serious = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  expect(serious.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
});
