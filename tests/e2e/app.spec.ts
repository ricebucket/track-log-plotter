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
  await page.getByRole('button', { name: 'Show properties' }).click();
  await expect(page.getByText('Last line cut off')).toBeVisible();
});

test('loads the sample ride and draws the tracks', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|pbf|glyph/i.test(m.text())) errors.push(m.text()); });
  await page.getByRole('button', { name: 'Try the sample ride' }).click();
  await expect(page.getByText('2 of 3 shown · 2 loaded')).toBeVisible();
  await expect(page.locator('.maplibregl-canvas')).toBeVisible();
  // The map fills the window (MapLibre's own stylesheet must not shrink it).
  const size = page.viewportSize()!;
  expect(await page.locator('.maplibregl-canvas').evaluate((c) => [c.clientWidth, c.clientHeight])).toEqual([size.width, size.height]);
  // The map reports how many track lines it drew once it settles.
  await expect(page.locator('.map')).toHaveAttribute('data-lines', /^[1-9]\d*$/, { timeout: 20_000 });
  // The selected track is drawn again on top, picked by MapLibre global state.
  await expect(page.locator('.map')).toHaveAttribute('data-sel-lines', /^[1-9]\d*$/);
  await page.locator('.track-row[data-track="B"] .track-main').click();
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

test('switches to Chinese from the Options menu and remembers it', async ({ page }) => {
  await page.getByRole('button', { name: /Options/ }).click();
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

test('closes the Options menu and the color pane on a second press', async ({ page }) => {
  await open(page, 'central-park-loop.nmea');
  const options = page.getByRole('button', { name: /Options/ });
  await options.click();
  await expect(page.getByRole('dialog', { name: 'Options' })).toBeVisible();
  await options.click();
  await expect(page.getByRole('dialog', { name: 'Options' })).toHaveCount(0);
  const color = page.getByRole('button', { name: 'Color Speed (km/h)' });
  await color.click();
  await expect(page.getByRole('dialog', { name: 'Color track A by' })).toBeVisible();
  await color.click();
  await expect(page.getByRole('dialog', { name: 'Color track A by' })).toHaveCount(0);
});

test('closes the fix card with its button and with a click on an empty spot', async ({ page }) => {
  await open(page, 'central-park-loop.nmea');
  await expect(page.locator('.map')).toHaveAttribute('data-lines', /^[1-9]\d*$/, { timeout: 20_000 });
  const lanes = (await page.locator('.tl-lanes').boundingBox())!;
  const hover = () => page.mouse.move(lanes.x + 150 + (lanes.width - 150) * 0.5, lanes.y + 20);
  await hover();
  const card = page.locator('.tooltip');
  await expect(card).toBeVisible();
  await card.getByRole('button', { name: 'Close' }).click();
  await expect(card).toHaveCount(0);
  await hover();
  await expect(card).toBeVisible();
  // Just right of the panel, near the top: empty map.
  const panel = (await page.locator('.panel').boundingBox())!;
  await page.mouse.click(panel.x + panel.width + 40, panel.y + 60);
  await expect(card).toHaveCount(0);
});

test('shows the compass only while the map is turned', async ({ page }) => {
  await open(page, 'central-park-loop.nmea');
  await expect(page.locator('.map')).toHaveAttribute('data-lines', /^[1-9]\d*$/, { timeout: 20_000 });
  const compass = page.getByRole('button', { name: 'Turn the map north up' });
  await expect(compass).toHaveCount(0);
  // Right-drag turns the map.
  const vp = page.viewportSize()!;
  await page.mouse.move(vp.width * 0.7, vp.height * 0.35);
  await page.mouse.down({ button: 'right' });
  await page.mouse.move(vp.width * 0.7 + 160, vp.height * 0.35 + 40, { steps: 12 });
  await page.mouse.up({ button: 'right' });
  await expect(compass).toBeVisible();
  await compass.click();
  await expect(compass).toHaveCount(0, { timeout: 5_000 });
});

/** Where the fix card's fix is on screen, and the time it shows. */
async function cardFix(page: import('@playwright/test').Page) {
  const card = page.locator('.tooltip');
  await expect(card).toBeVisible();
  return { x: Number(await card.getAttribute('data-x')), y: Number(await card.getAttribute('data-y')), time: await card.locator('.tip-time').textContent() };
}

test('dragging along a track moves the cursor and the fix card with it', async ({ page }) => {
  await open(page, 'central-park-loop.nmea');
  await expect(page.locator('.map')).toHaveAttribute('data-lines', /^[1-9]\d*$/, { timeout: 20_000 });
  const lanes = (await page.locator('.tl-lanes').boundingBox())!;
  const at = (f: number) => page.mouse.move(lanes.x + 150 + (lanes.width - 150) * f, lanes.y + 20);
  await at(0.3);
  const a = await cardFix(page);
  await at(0.36);
  const b = await cardFix(page);
  expect(b.time).not.toBe(a.time);
  // Press on the track at the first fix and drag to the second.
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move((a.x + b.x) / 2, (a.y + b.y) / 2, { steps: 5 });
  await page.mouse.move(b.x, b.y, { steps: 5 });
  // At this zoom a pixel covers a few seconds of riding: the nearest fix may be a neighbor.
  const secs = (s: string) => { const m = /(\d+):(\d+):(\d+)\s*([AP]M)/.exec(s.replace(/\s/g, ' '))!; return ((Number(m[1]) % 12) + (m[4] === 'PM' ? 12 : 0)) * 3600 + Number(m[2]) * 60 + Number(m[3]); };
  await expect.poll(async () => Math.abs(secs((await page.locator('.tooltip .tip-time').textContent())!) - secs(b.time!))).toBeLessThanOrEqual(5);
  await expect.poll(async () => Math.abs(secs((await page.locator('.tooltip .tip-time').textContent())!) - secs(a.time!))).toBeGreaterThan(30);
  await page.mouse.up();
  // The map didn't pan: the fix is still where it was on screen.
  const after = await cardFix(page);
  expect(Math.abs(after.x - b.x) + Math.abs(after.y - b.y)).toBeLessThan(3);
});

test('during playback, hovering the timeline leaves the cursor alone but a press moves it', async ({ page }) => {
  await open(page, 'central-park-loop.nmea');
  const lanes = (await page.locator('.tl-lanes').boundingBox())!;
  const x = (f: number) => lanes.x + 150 + (lanes.width - 150) * f;
  const frac = async () => {
    const box = (await page.locator('.tl-cursor').boundingBox())!;
    return (box.x - lanes.x - 150) / (lanes.width - 150);
  };
  await page.mouse.click(x(0.05), lanes.y + 20);
  await page.getByRole('button', { name: 'Play' }).click();
  await page.mouse.move(x(0.9), lanes.y + 20);
  await page.waitForTimeout(300);
  expect(await frac()).toBeLessThan(0.5);
  await page.mouse.click(x(0.8), lanes.y + 20);
  await expect.poll(frac).toBeGreaterThan(0.75);
  await page.getByRole('button', { name: 'Pause' }).click();
  await page.mouse.move(x(0.2), lanes.y + 20);
  await expect.poll(frac).toBeLessThan(0.3);
});

test('zoomed far out, a dot stands in for the track and zooms back to it', async ({ page }) => {
  await open(page, 'central-park-loop.nmea');
  const map = page.locator('.map');
  await expect(map).toHaveAttribute('data-lines', /^[1-9]\d*$/, { timeout: 20_000 });
  await expect(map).toHaveAttribute('data-marks', '0');
  for (let i = 0; i < 10 && (await map.getAttribute('data-marks')) === '0'; i++) {
    await page.getByRole('button', { name: 'Zoom out' }).click();
    await page.waitForTimeout(450);
  }
  await expect(map).toHaveAttribute('data-marks', '1');
  const [x, y] = (await map.getAttribute('data-mark-at'))!.split(',').map(Number);
  await page.mouse.click(x, y);
  await expect(map).toHaveAttribute('data-marks', '0');
  await expect(map).toHaveAttribute('data-lines', /^[1-9]\d*$/);
});

test('shows dates on the timeline for a log over two days', async ({ page }) => {
  await open(page, 'hudson-overnight.gpx');
  await page.getByRole('button', { name: 'UTC' }).click();
  await expect(page.locator('.tl-ticks .tick-date')).toHaveText(['Jul 12']);
  const lanes = (await page.locator('.tl-lanes').boundingBox())!;
  await page.mouse.move(lanes.x + 150 + (lanes.width - 150) * 0.9, lanes.y + 20);
  await expect(page.locator('.tl-time')).toContainText('Jul 12,');
});

test('opens a Columbus Fusion log with motion data and shows its acceleration', async ({ page }) => {
  await open(page, 'central-park-loop-motion.csv');
  await expect(page.getByText(/· Columbus Fusion$/)).toBeVisible();
  await expect(page.locator('.map')).toHaveAttribute('data-lines', /^[1-9]\d*$/, { timeout: 20_000 });
  await page.getByRole('button', { name: /^Color/ }).click();
  await page.getByRole('dialog', { name: 'Color track A by' }).getByRole('radio', { name: /Acceleration/ }).click();
  await expect(page.getByRole('button', { name: 'Color Acceleration (g)' })).toBeVisible();
});

test('snaps the cursor to a fix when hovering a gap', async ({ page }) => {
  await open(page, 'hudson-overnight.gpx');
  const lanes = (await page.locator('.tl-lanes').boundingBox())!;
  // The middle of the timeline is the night's gap.
  await page.mouse.move(lanes.x + 150 + (lanes.width - 150) * 0.5, lanes.y + 20);
  await expect(page.locator('.tl-values')).toContainText('km/h');
});

test('zooms into a dragged range and back out with Show all', async ({ page }) => {
  await open(page, 'central-park-loop.nmea');
  const lanes = (await page.locator('.tl-lanes').boundingBox())!;
  const x = (f: number) => lanes.x + 150 + (lanes.width - 150) * f;
  const first = await page.locator('.tl-ticks span').first().textContent();
  await page.mouse.move(x(0.4), lanes.y + 20);
  await page.mouse.down();
  await page.mouse.move(x(0.5), lanes.y + 20, { steps: 4 });
  await page.mouse.move(x(0.6), lanes.y + 20, { steps: 4 });
  await page.mouse.up();
  const showAll = page.getByRole('button', { name: 'Show all' });
  await expect(showAll).toBeVisible();
  await expect(page.locator('.tl-ticks span').first()).not.toHaveText(first!);
  await showAll.click();
  await expect(showAll).toHaveCount(0);
  await expect(page.locator('.tl-ticks span').first()).toHaveText(first!);
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
