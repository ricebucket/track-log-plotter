# Development

[简体中文](DEVELOPMENT.zh-CN.md)

How to work on Track Log Plotter, and what to run before every push to GitHub.

## Setup

You need a current Node.js: the minimum is `engines` in package.json.

- **Everything in this folder:** run `npm install`.
- **Build, test and lint tools in a parent folder:** Node finds them there. Install only the app's own libraries here with `npm install --omit=dev`, and the tools in the parent folder:

  ```sh
  npm install vite @preact/preset-vite vitest @vitest/coverage-v8 happy-dom @testing-library/preact fast-check oxlint typescript @playwright/test @axe-core/playwright @types/node
  ```

- **Browser for the browser tests:** run `npx playwright install chromium` once for each Playwright version.

## Commands

| Command | What it does |
| --- | --- |
| `npm run dev` | Development server at http://localhost:5173/track-log-plotter/ |
| `npm run build` | Production build in `dist/` |
| `npm run preview` | Serves the production build |
| `npm test` | Unit and component tests (Vitest) |
| `npm run test:watch` | The same, rerunning on every change |
| `npm run test:coverage` | Unit and component tests with coverage (without the timing tests) |
| `npm run test:perf` | The timing tests alone, without coverage (as CI runs them) |
| `npm run test:e2e` | Browser tests (Playwright), desktop and phone |
| `npm run lint` | oxlint |
| `npm run typecheck` | TypeScript |
| `npm run check` | Lint, type check, tests, build and browser tests, in that order |
| `npm run fixtures` | Regenerates the sample tracks and the New York City fixtures that `scripts/make-fixtures.mjs` makes (see [Tests](#tests)) |
| `npm run screenshots` | Regenerates the README screenshots (see [Screenshots](#screenshots)) |
| `npm run video` | Records the README demo videos (see [Demo videos](#demo-videos)) |

## Before every push

Every step below must pass before you push.

GitHub runs the same checks on every push to `main`. The Pages deploy, though, runs only the unit tests and the build before it publishes. A change that only the browser tests would catch can therefore still go live, so run everything locally first. In this project, for example, the unit tests all passed while the built map was broken; only the browser tests caught it.

1. **Run every check:**

   ```sh
   npm run check
   ```

   It stops at the first failure. Fix that failure, then run it again from the start. A clean run ends like this:

   - lint prints nothing and exits without an error
   - the type check prints nothing
   - Vitest reports every test file as passed
   - Vite reports the build as built
   - Playwright reports every desktop and phone test as passed

2. **Check coverage:** run `npm run test:coverage` and look for files that lost coverage.

3. **Regenerate the fixtures**, if you changed `scripts/make-fixtures.mjs`:

   1. Run `npm run fixtures`.
   2. Run step 1 again.
   3. Commit the regenerated files in `tests/fixtures/` and `public/sample/`.

4. **Keep personal data out:**

   - `git status` must show nothing from `local-tracks/`, and no other track files of your own.
   - Test data must be synthetic, and every coordinate must lie in New York City; only the synthetic Stanford drive's files may lie at Stanford. The privacy test fails the run otherwise, so step 1 already checks this.

5. **Review the change:** run `git status` and `git diff --stat`, and read the diff.

6. **Commit on `main` and push.** This project uses `main` only, with no branches.

   ```sh
   git add -A
   git commit
   git push origin main
   ```

7. **Watch GitHub:** open the Actions tab. **CI** and **Deploy to GitHub Pages** both run on every push to `main`. If either fails, fix it on `main` straight away.

## Tests

- **Unit tests:** `tests/unit/`.
- **Component tests:** `tests/component/`. They run in happy-dom, with a stand-in for the map.
- **Performance tests:** `tests/unit/performance.test.ts` and a browser test in `tests/e2e/app.spec.ts` time a synthetic 10-hour Columbus Fusion log with motion data (36,000 fixes, 360,000 readings, about 10 MB). They time reading it, drawing its acceleration timeline, zooming, and the fix card's lookup. Each test fails if the work takes longer than its time limit. The limits are several times what a laptop needs, so a slow CI machine passes, but a change that makes the work grow out of hand fails. A slowdown of two or three times still passes, so compare the printed timings before and after changing that code. They print their timings when run with `npx vitest run tests/unit/performance.test.ts --silent=false`.
- **Fixtures:** `tests/fixtures/`, all synthetic. Most are New York City tracks made by `scripts/make-fixtures.mjs`, which also makes the sample tracks in `public/sample/`. The Lower Manhattan walk and the Stanford drive come from generators in the git-ignored `track-generator/` folder; only the tracks they write are committed.
- **Privacy test:** `tests/unit/privacy.test.ts` reads every file git would commit, the fixtures and sample tracks included, and fails the run if a coordinate in any of them falls outside New York City. It reads the text itself, so a waypoint without a time, a file's bounds or a skipped line counts too, in each notation: GPX attributes, `lat:` and `lon:` names, NMEA, N/S/E/W letters and number pairs. Only the Stanford drive's fixtures and its test may lie at Stanford.
- **Browser tests:** `tests/e2e/`. They run against the built site at http://localhost:4621/track-log-plotter/, in two Playwright projects: `desktop` (Desktop Chrome) and `phone` (Pixel 7).
  - Every request to another host (tiles, styles, fonts) is answered locally, so no test touches a real server.
  - Chromium gets WebGL through SwiftShader; `playwright.config.ts` sets the flags.
  - After a failure, `npx playwright show-report` shows what went wrong, and traces are saved in `test-results/`.

## Screenshots

Each README shows a desktop screenshot from `docs/screenshots/`, in its own language. Screenshots always show the synthetic sample tracks.

When the interface changes visibly:

1. Run `npm run screenshots`. It builds the site and serves it on port 4175. Unlike the browser tests, it loads real basemap tiles and fonts, so it needs a network connection.
2. Look at the two PNG files before committing them.

## Demo videos

Each README links a demo video from `docs/video/`, in its own language: 1120 × 1680 (upright). It shows only the synthetic fixtures: the Lower Manhattan walk and the Stanford drive.

When what they show changes visibly:

1. Run `npm run video`. It builds the site, serves it on port 4176, then plays the demo once per language and records it. Like the screenshots, it loads real basemap tiles and fonts, so it needs a network connection. Nothing needs installing: Chromium encodes the H.264 itself (WebCodecs), and `tests/video/mp4.ts` writes the MP4 file.
2. Watch both videos before committing them.

To check the steps without making the videos, run `DEMO_DRY_RUN=<folder> npm run video`. It saves the picture on screen every two seconds in that folder, and lists how long each caption stays up. A video over 60 seconds fails. `DEMO_BITRATE=<bits a second>` sets the encoder's bitrate; by default it's the highest the encoder takes, for the best picture.

The recording draws the pointer, the rings where it clicks, the red boxes and the captions into the page; the app itself has none of them.

## Deployment

Two GitHub Actions workflows run on GitHub:

- **CI** (`.github/workflows/ci.yml`) runs on every push and pull request: install, lint, type check, tests with coverage, the timing tests, build, then the browser tests.
- **Deploy to GitHub Pages** (`.github/workflows/pages.yml`) runs on every push to `main`: install, unit and component tests, build, then publishes `dist/`.

The deploy doesn't wait for CI. That's why every check has to pass locally first (see [Before every push](#before-every-push)).

Publishing needs two repository settings:

- Under Settings → Pages, set the source to "GitHub Actions".
- On GitHub's free plan, Pages only publishes public repositories.

The site is published at https://ricebucket.github.io/track-log-plotter/. The base path `/track-log-plotter/` is set in `vite.config.ts`.

## Your own logs

Keep your own track logs in `local-tracks/` to try them in the app.

- Git ignores that folder, and the development server won't serve it.
- The tests also read every log there, so `npm run check` tries the readers on your real files as well as the fixtures:
  - `npm test` reads each one with the app's own code and checks the result: positions on Earth, times in order, sane derived values, and map data that builds.
  - `npm run test:e2e` opens up to ten of them in the built app (desktop only) and checks that they load and draw.
- These checks report file names and counts, never coordinates. Without the folder (on GitHub, for example) they skip themselves.
- Never commit those logs, and never copy their coordinates into tests. Write synthetic New York City data instead, by extending the fixture generator.

## Adding a language

1. Copy `src/i18n/en-US.json` to a new file and translate it.
2. Register it in `src/i18n/i18n.ts` (`LANGS`, `LOCALE` and `MESSAGES`).
3. Teach the places that are set up for Chinese alone about the new language:
   - `initialLang()` in `src/i18n/i18n.ts`, which picks the first language from the address, the saved choice or the browser's languages;
   - the clock format, `fmtClock()` in `src/time/zones.ts`: 24-hour in Chinese, 12-hour otherwise;
   - the map labels, `applyLabels()` in `src/map/MapView.tsx`, which switches the vector basemaps' place names to Chinese.
4. Add a README and a development guide in that language.

The tests check that every message exists in every language with the same placeholders.
