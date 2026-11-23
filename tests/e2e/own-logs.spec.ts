// Opens your own logs in the built app, when you keep some in the git-ignored
// folder for them (see tests/helpers/own-logs.ts). Desktop only. Checks report
// counts, never coordinates.
import { expect, test, type Page } from '@playwright/test';
import { localLogs } from '../helpers/own-logs';
import { stubNetwork } from './helpers';

// The file picker's extensions (App.tsx), and the app loads at most ten at once.
const files = localLogs().filter((f) => /\.(gpx|nmea|nma|log|txt)$/i.test(f)).slice(0, 10);

/** Shows only the track in row `i`. */
async function showOnly(page: Page, i: number) {
  const eyes = page.locator('.track-row .eye');
  for (let k = 0; k < (await eyes.count()); k++) {
    if (k !== i && (await eyes.nth(k).getAttribute('aria-pressed')) === 'true') await eyes.nth(k).click();
  }
  if ((await eyes.nth(i).getAttribute('aria-pressed')) !== 'true') await eyes.nth(i).click();
}

test.describe('your own logs', () => {
  test.skip(files.length === 0, 'No logs there to check.');

  test('load, then draw each one', async ({ page }) => {
    test.setTimeout(180_000);
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await stubNetwork(page);
    await page.goto('./');
    await page.locator('#tlp-file-input').setInputFiles(files);
    await expect(page.locator('.track-row')).toHaveCount(files.length, { timeout: 90_000 });
    const map = page.locator('.map');
    const drawn = async () => Number(await map.getAttribute('data-lines')) + Number(await map.getAttribute('data-marks'));
    // Something shows for the tracks that are on: lines, or dots for tracks too small to see.
    await expect.poll(drawn, { timeout: 60_000 }).toBeGreaterThan(0);
    // Each log on its own, fitted: its colored line is drawn.
    for (let i = 0; i < files.length; i++) {
      await showOnly(page, i);
      await page.getByRole('button', { name: 'Fit the tracks' }).click();
      await expect(map, `log ${i + 1} of ${files.length}`).toHaveAttribute('data-lines', /^[1-9]\d*$/, { timeout: 30_000 });
      await expect(map).toHaveAttribute('data-marks', '0');
    }
    expect(errors).toEqual([]);
  });
});
