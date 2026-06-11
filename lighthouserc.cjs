/**
 * Lighthouse CI config — Core Web Vitals budgets for the public funnel entry
 * pages, run against the local E2E server in CI (report-only step; the job
 * uses continue-on-error until the budgets prove stable — promotion criterion
 * in docs/testing/e2e.md).
 *
 * Run locally (with the E2E stack up): npx --yes @lhci/cli@0.15.1 autorun
 */
module.exports = {
  ci: {
    collect: {
      url: [
        'http://127.0.0.1:9002/login',
        'http://127.0.0.1:9002/signup',
        'http://127.0.0.1:9002/kids',
      ],
      numberOfRuns: 1,
      settings: {
        preset: 'desktop',
        chromeFlags: '--no-sandbox --disable-dev-shm-usage',
        // The E2E server points at local emulators; skip checks that expect
        // a public origin.
        skipAudits: ['is-on-https', 'uses-http2'],
      },
    },
    assert: {
      assertions: {
        // Category floors (warn-level so the report highlights drift).
        'categories:performance': ['warn', { minScore: 0.7 }],
        'categories:accessibility': ['warn', { minScore: 0.9 }],
        'categories:best-practices': ['warn', { minScore: 0.9 }],

        // Core Web Vitals budgets (error-level — these are the real gate
        // once the step is promoted from report-only).
        'largest-contentful-paint': ['error', { maxNumericValue: 4000 }],
        'cumulative-layout-shift': ['error', { maxNumericValue: 0.1 }],
        'total-blocking-time': ['error', { maxNumericValue: 600 }],
        'first-contentful-paint': ['warn', { maxNumericValue: 2500 }],
        interactive: ['warn', { maxNumericValue: 5000 }],
      },
    },
    upload: {
      target: 'filesystem',
      outputDir: '.lighthouseci/reports',
    },
  },
};
