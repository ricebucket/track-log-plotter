// End-to-end tests against the built site in Chromium. Every request to
// another host (tiles, styles, fonts) is answered locally, so no test touches
// a real server.
import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { writeFileSync } from 'node:fs';
import { mapSettled, open, openAs, pillSides, stubNetwork, textLines, wideFont } from './helpers';
import { bigFusionLog } from '../helpers/big-logs';

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

test('centers the title in its pill on the start screen', async ({ page }) => {
  const [left, right] = await pillSides(page);
  expect(left).toBeGreaterThanOrEqual(14);
  expect(Math.abs(left - right)).toBeLessThanOrEqual(1);
});

test('selects a newly added track and scrolls the list to its card', async ({ page }) => {
  await open(page, 'central-park-loop.nmea', 'central-park-loop-vendor.gpx', 'roosevelt-island-run.gpx', 'hudson-greenway-evening.log', 'hudson-overnight.gpx');
  await expect(page.getByText('3 of 3 shown · 5 loaded')).toBeVisible();
  // Of several added together, the first is selected.
  await expect(page.locator('.track-row.is-selected')).toHaveAttribute('data-track', 'A');
  await open(page, 'lower-manhattan-walk.gpx');
  const row = page.locator('.track-row[data-track="F"]');
  await expect(row).toHaveClass(/is-selected/);
  await expect(page.locator('.track-row.is-selected')).toHaveCount(1);
  // Its open card is in view, not below the fold of the track list.
  const list = (await page.locator('.panel-body').boundingBox())!;
  const card = (await row.boundingBox())!;
  expect(card.height).toBeLessThan(list.height);
  expect(card.y).toBeGreaterThanOrEqual(list.y - 1);
  expect(card.y + card.height).toBeLessThanOrEqual(list.y + list.height + 1);
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
  await mapSettled(page);
  // The selected track is drawn again on top, picked by MapLibre global state.
  await expect(page.locator('.map')).toHaveAttribute('data-sel-lines', /^[1-9]\d*$/);
  await page.locator('.track-row[data-track="B"] .track-main').click();
  await page.getByRole('button', { name: 'Fit the tracks' }).click();
  await expect(page.locator('.map')).toHaveAttribute('data-sel-lines', /^[1-9]\d*$/);
  expect(errors).toEqual([]);
});

test('shows Fit on the map only while the timeline is minimized', async ({ page }) => {
  await open(page, 'central-park-loop.nmea');
  const fit = page.getByRole('button', { name: 'Fit the tracks' });
  await expect(fit).toHaveCount(1);
  await expect(page.locator('.timeline').getByRole('button', { name: 'Fit the tracks' })).toBeVisible();
  await page.getByRole('button', { name: 'Minimize the timeline' }).click();
  await expect(page.locator('.map-tools').getByRole('button', { name: 'Fit the tracks' })).toBeVisible();
  await expect(fit).toHaveCount(1);
});

test('minimizes and restores both panes', async ({ page }) => {
  await open(page, 'central-park-loop.nmea');
  // On a desktop the panel is at the side: its arrow points left to hide it.
  await expect(page.getByRole('button', { name: 'Minimize the panel' }).locator('path')).toHaveAttribute('d', 'M7 3.5v11M12.4 7.2L10.6 9l1.8 1.8');
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
  const pane = page.getByRole('dialog', { name: 'Color, halo and timeline' });
  await expect(pane.getByText(/How many satellites the logger used/)).toBeVisible();
  await pane.getByRole('radio', { name: 'Elevation as the line color' }).check();
  await expect(page.getByRole('button', { name: /^Color Elevation \(m\)/ })).toBeVisible();
  await pane.getByRole('button', { name: 'Done' }).click();
  await expect(pane).toHaveCount(0);
});

test('sizes the settings sheet to its contents, and never past the window', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 1000 });
  // Four measures: a short sheet in a tall window.
  await open(page, 'central-park-loop-vendor.gpx');
  await page.getByRole('button', { name: /^Color/ }).click();
  const sheet = page.getByRole('dialog', { name: 'Color, halo and timeline' });
  const table = (await sheet.locator('table').boundingBox())!;
  const foot = (await sheet.locator('.sheet-foot').boundingBox())!;
  // No empty space between the last row and the footer.
  expect(foot.y - (table.y + table.height)).toBeLessThanOrEqual(12);
  // What None does to the color and to the halo, on separate lines.
  const color = (await sheet.getByText('Color: the whole track in one color from its range.').boundingBox())!;
  const halo = (await sheet.getByText('Halo: no halo.').boundingBox())!;
  expect(halo.y).toBeGreaterThanOrEqual(color.y + color.height - 1);
  // In a short window it stops 16 px from the bottom and scrolls, with Done still in view.
  await page.setViewportSize({ width: 1280, height: 560 });
  const box = (await sheet.boundingBox())!;
  expect(box.y + box.height).toBeLessThanOrEqual(560 - 16 + 1);
  expect(await sheet.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true);
  await expect(sheet.getByRole('button', { name: 'Done' })).toBeInViewport();
});

test('keeps the big badge on the properties page as round as the small ones', async ({ page }) => {
  await open(page, 'central-park-loop-motion.csv');
  const small = (await page.locator('.track-row[data-track="A"] .badge').boundingBox())!;
  expect(Math.round(small.width)).toBe(Math.round(small.height));
  await page.locator('.track-row.is-selected').getByRole('button', { name: /^Properties/ }).click();
  const big = (await page.locator('.details-title .badge').boundingBox())!;
  expect([Math.round(big.width), Math.round(big.height)]).toEqual([26, 26]);
});

test('keeps Properties and Remove? on one line while asking to remove', async ({ page }) => {
  // A Columbus Fusion log has the longest label: "Properties & time zone".
  await open(page, 'central-park-loop-motion.csv');
  const card = page.locator('.track-row.is-selected');
  const props = card.getByRole('button', { name: /^Properties/ });
  await card.getByRole('button', { name: 'Remove this track' }).click();
  const ask = card.getByRole('button', { name: 'Remove?' });
  await expect(ask).toBeVisible();
  expect(await textLines(props)).toBe(1);
  expect(await textLines(ask)).toBe(1);
  const p = (await props.boundingBox())!;
  const a = (await ask.boundingBox())!;
  const c = (await card.boundingBox())!;
  expect(Math.abs(p.y - a.y)).toBeLessThanOrEqual(1);
  expect(a.x + a.width).toBeLessThanOrEqual(c.x + c.width);
});

test('keeps Properties and Remove? on one line inside the card in a wide fallback font', async ({ page }) => {
  // The CI runner's fallback font is wider than this one's: the label gives way, Remove? never leaves the card.
  await wideFont(page);
  await open(page, 'central-park-loop-motion.csv');
  const card = page.locator('.track-row.is-selected');
  const props = card.getByRole('button', { name: /^Properties/ });
  await card.getByRole('button', { name: 'Remove this track' }).click();
  const ask = card.getByRole('button', { name: 'Remove?' });
  await expect(ask).toBeVisible();
  expect(await textLines(props)).toBe(1);
  expect(await textLines(ask)).toBe(1);
  const p = (await props.boundingBox())!;
  const a = (await ask.boundingBox())!;
  const c = (await card.boundingBox())!;
  expect(Math.abs(p.y - a.y)).toBeLessThanOrEqual(1);
  expect(p.x + p.width).toBeLessThanOrEqual(a.x);
  expect(a.x + a.width).toBeLessThanOrEqual(c.x + c.width);
  // The whole label is still its name, and shows on hover once it's cut off.
  await expect(props).toHaveAccessibleName('Properties & time zone');
  await props.hover();
  await expect(props).toHaveAttribute('title', 'Properties & time zone');
});

test('shows a track name cut off in the list in full on hover, and only then', async ({ page }) => {
  const long = 'central-park-loop-with-a-very-long-file-name-from-the-logger-2026-10-17.gpx';
  await openAs(page, 'central-park-loop-garmin.gpx', long);
  await openAs(page, 'central-park-loop-vendor.gpx', 'short.gpx');
  const longName = page.locator('.track-row .track-name', { hasText: long });
  const shortName = page.locator('.track-row .track-name', { hasText: 'short.gpx' });
  await longName.hover();
  await expect(longName).toHaveAttribute('title', long);
  await shortName.hover();
  await expect(shortName).not.toHaveAttribute('title');
});

test('combines two logs from select mode: the new track, its logs on the map and the timeline, and its trust', async ({ page }) => {
  await open(page, 'stanford-drive-car.nmea', 'stanford-drive-phone.gpx');
  await mapSettled(page);
  await page.getByRole('button', { name: 'Select', exact: true }).click();
  await page.getByRole('checkbox', { name: /^Select track A:/ }).click();
  await page.getByRole('checkbox', { name: /^Select track B:/ }).click();
  const bar = page.getByRole('toolbar', { name: 'Act on the selected tracks' });
  await expect(bar.getByText('2 selected')).toBeVisible();
  // Combine and Remove sit at the bar's two ends.
  const c = (await bar.getByRole('button', { name: 'Combine' }).boundingBox())!;
  const r = (await bar.getByRole('button', { name: 'Remove' }).boundingBox())!;
  const b = (await bar.boundingBox())!;
  expect(c.x - b.x).toBeLessThan(12);
  expect(b.x + b.width - (r.x + r.width)).toBeLessThan(12);
  await bar.getByRole('button', { name: 'Combine' }).click();

  const row = page.locator('.track-row[data-track="C"]');
  await expect(row.locator('.track-name')).toHaveText('Combined track');
  await expect(row).toHaveClass(/is-selected/);
  await expect(row.getByRole('region', { name: 'Its logs' }).getByRole('listitem')).toHaveCount(2);
  // On the map: the combined track, and its two logs as thin lines, the phone's jump in red.
  const map = page.locator('.map');
  await expect(map).toHaveAttribute('data-log-lines', /^[1-9]\d*$/, { timeout: 20_000 });
  await expect(map).toHaveAttribute('data-log-out', /^[1-9]\d*$/);
  // On the timeline: a thin lane for each log under the combined track's lane.
  await expect(page.locator('.lane.log-lane')).toHaveCount(2);
  await row.getByRole('button', { name: 'Hide log 2' }).click();
  await expect(page.locator('.lane.log-lane')).toHaveCount(1);
  await row.getByRole('button', { name: 'Show log 2' }).click();

  // Trust: open the line and drag the handle most of the way to log 2.
  await expect(row.locator('.trust-val')).toHaveText('equal');
  await row.getByRole('button', { name: 'Adjust' }).click();
  const shape = row.locator('.trust-shape');
  const box = (await shape.boundingBox())!;
  const handle = (await row.getByRole('slider', { name: 'Trust in each log' }).boundingBox())!;
  await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.8, box.y + box.height / 2, { steps: 6 });
  await page.mouse.up();
  await expect(row.locator('.trust-val')).toHaveText(/^1 at \d+%, 2 at \d+%$/);
  const [, one, , two] = (await row.locator('.trust-val').textContent())!.match(/\d+/g)!.map(Number);
  expect(two).toBeGreaterThan(one);
  // Clicking the center mark makes them equal again.
  await row.getByRole('button', { name: 'Make them equal' }).click();
  await expect(row.locator('.trust-val')).toHaveText('equal');
});

test('leaves select mode on Escape, and refuses to combine a combined track again', async ({ page }) => {
  await open(page, 'stanford-drive-car.nmea', 'stanford-drive-phone.gpx');
  await page.getByRole('button', { name: 'Select', exact: true }).click();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('toolbar', { name: 'Act on the selected tracks' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Select', exact: true }).click();
  await page.getByRole('checkbox', { name: /^Select track A:/ }).click();
  await page.getByRole('checkbox', { name: /^Select track B:/ }).click();
  await page.getByRole('button', { name: 'Combine' }).click();
  await page.getByRole('button', { name: 'Select', exact: true }).click();
  await page.getByRole('checkbox', { name: /^Select track A:/ }).click();
  await page.getByRole('checkbox', { name: /^Select track C:/ }).click();
  await expect(page.getByText("A combined track can't be combined again.")).toBeVisible();
  await expect(page.getByRole('button', { name: 'Combine' })).toHaveAttribute('aria-disabled', 'true');
});

test('closes the Options menu and the color pane on a second press', async ({ page }) => {
  await open(page, 'central-park-loop.nmea');
  const options = page.getByRole('button', { name: /Options/ });
  await options.click();
  await expect(page.getByRole('dialog', { name: 'Options' })).toBeVisible();
  await options.click();
  await expect(page.getByRole('dialog', { name: 'Options' })).toHaveCount(0);
  const color = page.getByRole('button', { name: /^Color Speed \(km\/h\)/ });
  await color.click();
  await expect(page.getByRole('dialog', { name: 'Color, halo and timeline' })).toBeVisible();
  await color.click();
  await expect(page.getByRole('dialog', { name: 'Color, halo and timeline' })).toHaveCount(0);
});

test('closes the fix card with its button and with a click on an empty spot', async ({ page }) => {
  await open(page, 'central-park-loop.nmea');
  await mapSettled(page);
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
  await mapSettled(page);
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
  // Positions are measured on screen, so the fit's animation must be over.
  await mapSettled(page);
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
  await mapSettled(page);
  await page.getByRole('button', { name: /^Color/ }).click();
  await page.getByRole('dialog', { name: 'Color, halo and timeline' }).getByRole('radio', { name: 'Acceleration as the line color' }).check();
  await expect(page.getByRole('button', { name: /^Color Acceleration \(g\)/ })).toBeVisible();
  await page.getByRole('dialog', { name: 'Color, halo and timeline' }).getByRole('button', { name: 'Done' }).click();
});

test('snaps the cursor to a fix when hovering a gap', async ({ page }) => {
  await open(page, 'hudson-overnight.gpx');
  const lanes = (await page.locator('.tl-lanes').boundingBox())!;
  // The middle of the timeline is the night's gap.
  await page.mouse.move(lanes.x + 150 + (lanes.width - 150) * 0.5, lanes.y + 20);
  await expect(page.locator('.tl-values')).toContainText('km/h');
});

test('zooms into a dragged range and back out with Reset zoom', async ({ page }) => {
  await open(page, 'central-park-loop.nmea');
  const lanes = (await page.locator('.tl-lanes').boundingBox())!;
  const x = (f: number) => lanes.x + 150 + (lanes.width - 150) * f;
  const first = await page.locator('.tl-ticks span').first().textContent();
  await page.mouse.move(x(0.4), lanes.y + 20);
  await page.mouse.down();
  await page.mouse.move(x(0.5), lanes.y + 20, { steps: 4 });
  await page.mouse.move(x(0.6), lanes.y + 20, { steps: 4 });
  await page.mouse.up();
  const reset = page.getByRole('button', { name: 'Reset zoom' });
  await expect(reset).toBeVisible();
  // Reset zoom comes and goes to the left of Fit, which keeps its place.
  const fitBox = (await page.locator('.timeline').getByRole('button', { name: /^Fit/ }).boundingBox())!;
  expect((await reset.boundingBox())!.x).toBeLessThan(fitBox.x);
  await expect(page.locator('.tl-ticks span').first()).not.toHaveText(first!);
  await reset.click();
  await expect(reset).toHaveCount(0);
  await expect(page.locator('.tl-ticks span').first()).toHaveText(first!);
});

test('zooms the timeline with the scroll wheel', async ({ page }) => {
  await open(page, 'central-park-loop.nmea');
  const lanes = (await page.locator('.tl-lanes').boundingBox())!;
  const first = await page.locator('.tl-ticks span').first().textContent();
  await page.mouse.move(lanes.x + 150 + (lanes.width - 150) * 0.5, lanes.y + 20);
  await page.mouse.wheel(0, -600);
  const reset = page.getByRole('button', { name: 'Reset zoom' });
  await expect(reset).toBeVisible();
  await expect(page.locator('.tl-ticks span').first()).not.toHaveText(first!);
  await page.mouse.wheel(0, 3000);
  await expect(reset).toHaveCount(0);
  await expect(page.locator('.tl-ticks span').first()).toHaveText(first!);
});

test('opens a 10-hour log with motion data and draws its acceleration without stalling', async ({ page }, info) => {
  test.setTimeout(120_000);
  // 36,000 fixes and 360,000 readings: the browser side of the performance test.
  const file = info.outputPath('ten-hours.CSV');
  writeFileSync(file, bigFusionLog(10));
  const t0 = Date.now();
  await page.locator('#tlp-file-input').setInputFiles(file);
  await expect(page.locator('.map')).toHaveAttribute('data-lines', /^[1-9]\d*$/, { timeout: 60_000 });
  const loadMs = Date.now() - t0;
  await page.getByRole('button', { name: /^Color/ }).click();
  await page.getByRole('dialog', { name: 'Color, halo and timeline' }).getByRole('radio', { name: 'Acceleration as the line color' }).check();
  await expect(page.getByRole('button', { name: /^Color Acceleration \(g\)/ })).toBeVisible();
  await page.getByRole('dialog', { name: 'Color, halo and timeline' }).getByRole('button', { name: 'Done' }).click();
  // Zoom in on the timeline and back out: each step redraws from every reading.
  const lanes = (await page.locator('.tl-lanes').boundingBox())!;
  await page.mouse.move(lanes.x + 150 + (lanes.width - 150) * 0.5, lanes.y + 20);
  const t1 = Date.now();
  for (let k = 0; k < 8; k++) await page.mouse.wheel(0, -400);
  await expect(page.getByRole('button', { name: 'Reset zoom' })).toBeVisible();
  await page.getByRole('button', { name: 'Reset zoom' }).click();
  const zoomMs = Date.now() - t1;
  console.log(`ten-hour motion log: drawn ${loadMs} ms after opening; zooming ${zoomMs} ms`);
  // About 2 s and 0.4 s on a laptop with software WebGL; the time limits leave room for slow CI machines.
  expect(loadMs).toBeLessThan(15_000);
  expect(zoomMs).toBeLessThan(5_000);
});

test('hovering a lane snaps to that track, and clicking a collapsed lane selects it', async ({ page }) => {
  // Two loggers carried together: lined up by clock, so both lanes cover the same time.
  await open(page, 'central-park-loop.nmea', 'central-park-loop-vendor.gpx');
  await expect(page.locator('.track-row[data-track="A"]')).toHaveClass(/is-selected/);
  const laneB = (await page.locator('.lane[data-track="B"]').boundingBox())!;
  const x = laneB.x + 150 + (laneB.width - 150) * 0.3;
  await page.mouse.move(x, laneB.y + laneB.height / 2);
  // The readout follows the lane under the pointer.
  await expect(page.locator('.tl-head .badge')).toHaveText('B');
  await page.mouse.click(x, laneB.y + laneB.height / 2);
  await expect(page.locator('.track-row[data-track="B"]')).toHaveClass(/is-selected/);
  await expect.poll(async () => (await page.locator('.lane[data-track="B"]').boundingBox())!.height).toBeGreaterThan(40);
});

test('fits the zoomed part of the timeline on the map', async ({ page }) => {
  await open(page, 'central-park-loop.nmea');
  await mapSettled(page);
  // The map's zoom, read from the Google Maps link (in the menu of its button).
  const zoomOf = async () => {
    const menu = page.getByRole('button', { name: 'Open in Google Maps' });
    if ((await menu.getAttribute('aria-expanded')) !== 'true') await menu.click();
    const href = await page.getByRole('link', { name: /This map view/ }).getAttribute('href');
    await page.keyboard.press('Escape');
    return Number(/zoom=([\d.]+)/.exec(href!)![1]);
  };
  const fit = page.getByRole('button', { name: 'Fit the tracks' });
  await fit.click();
  await expect.poll(zoomOf).toBeGreaterThan(10);
  const whole = await zoomOf();
  // Zoom the timeline into a tenth of the ride: Fit now fits just that part, closer in.
  const lanes = (await page.locator('.tl-lanes').boundingBox())!;
  const xAt = (f: number) => lanes.x + 150 + (lanes.width - 150) * f;
  await page.mouse.move(xAt(0.2), lanes.y + 20);
  await page.mouse.down();
  await page.mouse.move(xAt(0.3), lanes.y + 20, { steps: 5 });
  await page.mouse.up();
  await page.getByRole('button', { name: 'Fit the zoomed part of the timeline on the map' }).click();
  await expect.poll(zoomOf).toBeGreaterThan(whole + 0.5);
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

test('has no serious accessibility problems in select mode, or on a combined track with its trust shape open', async ({ page }) => {
  await open(page, 'stanford-drive-car.nmea', 'stanford-drive-phone.gpx', 'stanford-drive-logger.gpx');
  await page.getByRole('button', { name: 'Select', exact: true }).click();
  await page.getByRole('checkbox', { name: /^Select track A:/ }).click();
  const serious = async () => (await new AxeBuilder({ page }).exclude('.map').analyze()).violations
    .filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => `${v.id}: ${v.help}`);
  expect(await serious()).toEqual([]);
  await page.getByRole('checkbox', { name: /^Select track B:/ }).click();
  await page.getByRole('checkbox', { name: /^Select track C:/ }).click();
  await page.getByRole('button', { name: 'Combine' }).click();
  await page.locator('.track-row[data-track="D"]').getByRole('button', { name: 'Adjust' }).click();
  await expect(page.getByRole('slider', { name: 'Trust in each log' })).toBeVisible();
  expect(await serious()).toEqual([]);
});
