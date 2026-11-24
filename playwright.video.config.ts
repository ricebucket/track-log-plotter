import { defineConfig } from '@playwright/test';

// Records the demo videos in docs/video/ (npm run video; see DEVELOPMENT.md).
// Like the README screenshots, these load real basemap tiles and fonts. They
// show only the synthetic fixtures.
const port = 4176;
const base = `http://localhost:${port}/track-log-plotter/`;

export default defineConfig({
  testDir: 'tests/video',
  timeout: 300_000,
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
