import { defineConfig, devices } from 'playwright/test';

/**
 * Playwright config for StoryPic Kids E2E (Sprint 3A foundation).
 *
 * baseURL comes from PLAYWRIGHT_BASE_URL and defaults to the local dev server
 * (`npm run dev` serves on :9002). Point it at a deployed/staging URL in CI by
 * setting PLAYWRIGHT_BASE_URL.
 *
 * Projects:
 *  - desktop-chrome  : primary blocking surface
 *  - mobile-chrome   : the PWA / kids surface
 *  - webkit          : Safari autoplay class — present but report-only/optional
 *                      (run explicitly with `--project=webkit`; excluded from
 *                      the default run via grepInvert is not used — instead it
 *                      is simply not part of the default CI gate, see ci.yml).
 */
const baseURL = process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:9002';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI
    ? [['github'], ['html', { open: 'never' }]]
    : [['list'], ['html', { open: 'never' }]],

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
});
