import { defineConfig, devices } from 'playwright/test';

/**
 * Playwright config for StoryPic Kids E2E.
 *
 * Two modes:
 *
 *  1. Self-contained (default, no PLAYWRIGHT_BASE_URL): Playwright boots the
 *     Firebase emulators (auth/firestore/storage, offline `demo-` project) and
 *     the E2E app server (standalone build + TEST_MODE seam) itself via the
 *     webServer entries below. Requires `npm run build:e2e` first.
 *
 *  2. External server (PLAYWRIGHT_BASE_URL set): no servers are started; point
 *     it at whatever is already running (the CI workflow starts the emulators
 *     and app itself so a11y/visual/Lighthouse steps can share one server).
 *
 * Projects:
 *  - desktop-chrome  : primary blocking surface
 *  - mobile-chrome   : the PWA / kids surface
 *  - webkit          : Safari autoplay class — present but report-only/optional
 *                      (run explicitly with `--project=webkit`; not part of the
 *                      default CI gate, see ci.yml).
 *
 * Spec conventions: web-first assertions on user-visible state only; no
 * waitForTimeout. See docs/testing/e2e.md.
 */
const externalBaseURL = process.env.PLAYWRIGHT_BASE_URL;
const baseURL = externalBaseURL || 'http://127.0.0.1:9002';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI
    ? [['github'], ['html', { open: 'never' }]]
    : [['list'], ['html', { open: 'never' }]],

  // Visual baselines live next to the specs, keyed by project + platform.
  snapshotPathTemplate:
    '{testDir}/__screenshots__/{testFilePath}/{arg}-{projectName}-{platform}{ext}',

  expect: {
    toHaveScreenshot: {
      // Kill animation/caret noise; allow tiny anti-aliasing drift.
      animations: 'disabled',
      caret: 'hide',
      maxDiffPixelRatio: 0.02,
    },
  },

  use: {
    baseURL,
    // Diagnostics only on failure to keep artifacts small and avoid leaking
    // child-like content from passing runs.
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },

  projects: [
    {
      name: 'desktop-chrome',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'mobile-chrome',
      use: { ...devices['Pixel 7'] },
    },
    {
      // Report-only / optional. Not part of the default blocking gate; run with
      // `npx playwright test --project=webkit`. Covers the Safari autoplay class.
      name: 'webkit',
      use: { ...devices['Desktop Safari'] },
    },
  ],

  // Self-contained mode only — skipped entirely when PLAYWRIGHT_BASE_URL is set.
  webServer: externalBaseURL
    ? undefined
    : [
        {
          command: 'node scripts/start-e2e-emulators.mjs',
          url: 'http://127.0.0.1:9099/',
          reuseExistingServer: true,
          timeout: 120_000,
          // SIGINT lets the firebase CLI stop its java emulator children; the
          // default SIGKILL orphans them and the next run finds ports taken.
          gracefulShutdown: { signal: 'SIGINT', timeout: 15_000 },
        },
        {
          command: 'node scripts/start-e2e-server.mjs',
          url: 'http://127.0.0.1:9002/login',
          reuseExistingServer: true,
          timeout: 120_000,
        },
      ],
});
