// README screenshots: the synthetic sample ride on the Light basemap, on a
// desktop, in English and Chinese. Run with npm run screenshots.
import { expect, test, type Browser, type BrowserContextOptions, type Page } from '@playwright/test';

const OUT = 'docs/screenshots';
const TEXT = {
  en: { sample: 'Try the sample ride', dismiss: 'Dismiss' },
  zh: { sample: '试试示例骑行', dismiss: '关闭提示' },
} as const;
type Lang = keyof typeof TEXT;

async function open(browser: Browser, lang: Lang, options: BrowserContextOptions): Promise<Page> {
  const ctx = await browser.newContext(options);
  const page = await ctx.newPage();
  await page.addInitScript((l) => {
    (window as unknown as { tlpTestHooks: boolean }).tlpTestHooks = true;
    localStorage.setItem('tlp.prefs.v1', JSON.stringify({ lang: l, basemap: 'light', zone: 'America/New_York', timelineMin: false }));
  }, lang);
  await page.goto('./');
  await page.getByRole('button', { name: TEXT[lang].sample }).click();
  await expect(page.locator('.map')).toHaveAttribute('data-lines', /^[1-9]/, { timeout: 30_000 });
  await page.getByRole('button', { name: TEXT[lang].dismiss }).click();
  return page;
}

/** Moves the timeline cursor to a fraction of the way along. */
async function point(page: Page, frac: number) {
  const box = (await page.locator('.tl-lanes').boundingBox())!;
  const label = 150;
  await page.mouse.move(box.x + label + (box.width - label) * frac, box.y + 30);
}

/** Waits until the map has drawn and every tile has arrived. */
async function settle(page: Page) {
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForTimeout(1200);
}

for (const lang of ['en', 'zh'] as const) {
  test(`desktop (${lang})`, async ({ browser }) => {
    const page = await open(browser, lang, { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
    await settle(page);
    await point(page, 0.36);
    await settle(page);
    await page.screenshot({ path: `${OUT}/desktop-${lang}.png` });
  });
}
