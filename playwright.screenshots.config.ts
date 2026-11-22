import { defineConfig } from '@playwright/test';

// Regenerates the README screenshots in docs/screenshots/ (npm run screenshots).
// Unlike the browser tests, these load real basemap tiles and fonts, so the
// pictures look like the app does. They only ever show the synthetic sample ride.
const port = 4175;
const base = `http://localhost:${port}/track-log-plotter/`;

export default defineConfig({
  testDir: 'tests/screenshots',
  timeout: 120_000,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: base,
    launchOptions: { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] },
  },
  webServer: {
    command: `npm run build && npm run preview -- --port ${port} --strictPort`,
    url: base,
    reuseExistingServer: false,
    timeout: 180_000,
  },
});
