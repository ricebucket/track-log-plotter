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
- **Fixtures:** `tests/fixtures/`. They are synthetic New York City tracks made by `scripts/make-fixtures.mjs`.
- **Browser tests:** `tests/e2e/`. They run against the built site at http://localhost:4173/track-log-plotter/, in two Playwright projects: `desktop` (Desktop Chrome) and `phone` (Pixel 7).
  - Every request to another host (tiles, styles, fonts) is answered locally, so no test touches a real server.
  - Chromium gets WebGL through SwiftShader; `playwright.config.ts` sets the flags.
  - After a failure, `npx playwright show-report` shows what went wrong, and traces are saved in `test-results/`.

## Your own logs

Keep your own track logs in `local-tracks/` to try them in the app.

- Git ignores that folder, and the development server won't serve it.
- Never commit those logs, and never copy their coordinates into tests. Write synthetic New York City data instead, by extending the fixture generator.

## Adding a language

1. Copy `src/i18n/en-US.json` to a new file and translate it.
2. Register it in `src/i18n/i18n.ts` (`LANGS`, `LOCALE` and `MESSAGES`).
3. Add a README and a development guide in that language.

The tests check that every message exists in every language with the same placeholders.
