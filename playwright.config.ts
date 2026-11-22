import { defineConfig, devices } from '@playwright/test';

const port = 4173;
const base = `http://localhost:${port}/track-log-plotter/`;

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 45_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : [['list']],
  use: {
    baseURL: base,
    trace: 'retain-on-failure',
    // MapLibre needs WebGL; headless Chromium gets it through SwiftShader.
    launchOptions: { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] },
  },
  webServer: {
    command: `npm run build && npm run preview -- --port ${port} --strictPort`,
    url: base,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] }, testIgnore: /phone\.spec\.ts/ },
    { name: 'phone', use: { ...devices['Pixel 7'] }, testMatch: /phone\.spec\.ts/ },
  ],
});
