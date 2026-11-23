# Development

[简体中文](DEVELOPMENT.zh-CN.md)

How to work on Track Log Plotter, and what to run before every push to GitHub.

## Setup

You need Node.js 20 or newer.

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
| `npm run test:coverage` | Unit and component tests with coverage |
| `npm run test:e2e` | Browser tests (Playwright), desktop and phone |
| `npm run lint` | oxlint |
| `npm run typecheck` | TypeScript |
| `npm run check` | Lint, type check, tests, build and browser tests, in that order |
| `npm run fixtures` | Regenerates the test fixtures and the sample ride |
| `npm run screenshots` | Regenerates the README screenshots (see [Screenshots](#screenshots)) |

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
   - Test data must be synthetic. Every coordinate must lie in New York City. The privacy test fails the run otherwise, so step 1 already checks this.

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
- **Fixtures:** `tests/fixtures/`. They are synthetic New York City tracks made by `scripts/make-fixtures.mjs`, as is the sample ride in `public/sample/`. A privacy test fails the run if any coordinate in the repository falls outside New York City.
- **Browser tests:** `tests/e2e/`. They run against the built site at http://localhost:4173/track-log-plotter/, in two Playwright projects: `desktop` (Desktop Chrome) and `phone` (Pixel 7).
  - Every request to another host (tiles, styles, fonts) is answered locally, so no test touches a real server.
  - Chromium gets WebGL through SwiftShader; `playwright.config.ts` sets the flags.
  - After a failure, `npx playwright show-report` shows what went wrong, and traces are saved in `test-results/`.

## Screenshots

Each README shows a desktop screenshot from `docs/screenshots/`, in its own language. Screenshots always show the synthetic sample ride.

When the interface changes visibly:

1. Run `npm run screenshots`. It builds the site and serves it on port 4175. Unlike the browser tests, it loads real basemap tiles and fonts, so it needs a network connection.
2. Look at the two PNG files before committing them.

## Deployment

Two GitHub Actions workflows run on GitHub:

- **CI** (`.github/workflows/ci.yml`) runs on every push and pull request: install, lint, type check, tests with coverage, build, then the browser tests.
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
3. Add a README and a development guide in that language.

The tests check that every message exists in every language with the same placeholders.
