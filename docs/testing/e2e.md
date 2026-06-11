# E2E Testing: Emulator + TEST_MODE Playwright Suite

> Sprint W1-B deliverable. Last updated: 2026-06-11

The E2E suite runs the real app (production `standalone` build) against the
**Firebase Emulator Suite** with the **TEST_MODE AI seam** active, so the whole
activation funnel is exercised with zero model calls, zero production access
and deterministic fixtures.

## Quick start

```bash
npm run build:e2e        # one-time per code change: E2E build (emulator client config baked in)
npm run test:e2e:funnel  # the blocking happy-path, desktop + mobile
npm run test:e2e         # everything (funnel + smoke + a11y + visual)
npm run test:e2e:a11y    # axe scans only
npm run test:e2e:visual  # screenshot regression only
npm run probe            # mechanical UX probe (report-only) — see docs/testing/probe.md
```

Playwright boots the emulators and the app itself (see `webServer` in
`playwright.config.ts`); nothing needs to be running beforehand. Requirements:
`firebase-tools` CLI and a **Java 21+** JDK (firebase-tools 15 needs it —
`scripts/start-e2e-emulators.mjs` auto-detects Homebrew/Linux JDK locations).
To point the suite at an already-running stack instead, set
`PLAYWRIGHT_BASE_URL` (the CI workflow does this).

## Architecture

| Piece | What it does |
|-------|--------------|
| `scripts/build-e2e.mjs` | `next build` with `NEXT_PUBLIC_FIREBASE_USE_EMULATOR=true` + `NEXT_PUBLIC_FIREBASE_PROJECT_ID=demo-storypic-e2e` baked into the client bundle, then writes the `.next/E2E_BUILD.json` marker. |
| `scripts/start-e2e-server.mjs` | Assembles and serves the standalone build with `TEST_MODE=1` and the Admin-SDK emulator env vars. **Refuses to run without the marker** — serving a prod-config bundle would point the funnel's signup at production Firebase. Scrubs `FIREBASE_SERVICE_ACCOUNT_KEY` / `GOOGLE_APPLICATION_CREDENTIALS` etc. |
| `scripts/start-e2e-emulators.mjs` | `firebase emulators:start --only auth,firestore,storage --project demo-storypic-e2e`. The `demo-` prefix makes the emulators fully offline: requests to non-emulated services for that project always fail, so prod is unreachable by construction. |
| `e2e/helpers/emulator.ts` | Seeding + cleanup via firebase-admin pointed at the emulators (catalog docs, completed-story fixture, ready-storybook fixture, per-account teardown). Every seeded doc is stamped `regressionTest: true`, mirroring `scripts/cleanup-regression-data.mjs`. |
| `e2e/helpers/flows.ts` | UI flows (signup, parent PIN guard, child creation, kids-mode lock) with web-first assertions. |

### Conventions

- **Web-first assertions on user-visible state only.** `waitForTimeout` is
  banned — flag it in review.
- Disposable accounts: every spec signs up a fresh
  `e2e-<tag>-<ts>-<rand>@example.com` user and deletes it (auth user, `users`
  doc, children, sessions, stories, entitlement ledger) in `afterEach`, so a
  long-lived local emulator stays clean across runs.
- Artifacts (screenshots/videos/traces) can contain synthetic child-like
  content: failure-only, 7-day CI retention, never committed
  (`test-results/`, `playwright-report/` are gitignored).

## The blocking funnel spec (`e2e/funnel.spec.ts`, `@funnel`)

Covers: **signup (no placeholder child is seeded; the home screen shows the
"Add your first child" prompt) → parent creates child (PIN guard passed only
if it appears — the fresh-PIN grace usually skips it) → kids-mode lock →
story-creation entry → story completion → storybook generation → book ready**,
on `desktop-chrome` and `mobile-chrome`. Checkout/pay is out of scope until
Stripe lands (sprint WG-1).

### Where the determinism seam sits (and why)

- **Storybook generation** runs through the real `/api/storybookV2/create`,
  `/pages` and `/images` routes (including the `storybook_allowance`
  entitlement consume); `TEST_MODE=1` short-circuits only the model calls and
  advances the same `idle → running → ready` Firestore state machine
  (`src/lib/test-mode.ts`).
- **Story creation/completion has no server seam**: the wizard
  (`storyWizardFlow`) is a live Gemini call invoked as a server action, and
  `src/ai/flows/*` is outside this track's write territory. The spec therefore
  asserts the creation entry UI (generator cards render for the locked child),
  then **seeds the exact post-conditions** of the wizard + `/api/storyCompile`
  (completed `storySessions` doc + child session mirror + compiled `stories`
  doc — shapes copied from `story-compile-flow.ts`'s wizard branch) and resumes
  UI-driven from My Stories → Read Story → Create Picture Book → style picker.
  When a TEST_MODE seam is added to the wizard route, replace the seed with
  real clicks.

### Promotion status

The funnel spec is the **blocking** step of the CI `e2e` job (plus the login
smoke). Promotion criterion (3 consecutive deterministic green runs locally,
cold start each time) was met on 2026-06-11.

## Report-only checks

All three run in CI under `continue-on-error` and publish artifacts. "Report-
only" is **not** "forever": each has an explicit promotion criterion.

| Check | Spec/config | Scope | Promote when |
|-------|------------|-------|--------------|
| Accessibility | `e2e/a11y.spec.ts` (axe-core, WCAG 2.1 A/AA) | signup, who-is-playing, story creation, storybook view, orders | serious+critical count reaches 0 and stays for 2 weeks → set `A11Y_ENFORCE=1` in the CI step (turns scans into hard assertions) and drop `continue-on-error`. |
| Visual | `e2e/visual.spec.ts` | login, signup, kids home (avatars masked — they're seeded from picsum and vary per account) | <2% flake over 2 weeks after linux baselines are committed → drop `continue-on-error`. |
| Lighthouse | `lighthouserc.cjs` | /login, /signup, /kids — CWV budgets: LCP ≤ 4000ms, CLS ≤ 0.1, TBT ≤ 600ms (error-level); perf ≥ 0.7, a11y ≥ 0.9 (warn-level) | budgets stable for 2 weeks → drop `continue-on-error`. |

### Visual baseline bootstrap

Baselines are committed per project+platform under `e2e/__screenshots__/`
(`darwin` baselines exist). The first CI (linux) run fails snapshot-missing and
writes candidates into the `e2e-test-results` artifact — download, eyeball,
commit them as the linux baselines; comparison is active from the next run.

## Known app issues found by this suite (not fixed here — other tracks own the files)

1. **Cold deep-links to kids surfaces crash while Firebase auth hydrates.**
   `useRequiredApiClient` throws during the first render of `/kids/stories`,
   `/kids/books`, `/kids/create/[id]/style` etc. on a direct page load, landing
   on the global error boundary ("Oops! Something got muddled."). Real users
   hit this when a PWA reopens on a deep URL. The specs work around it with
   client-side navigation.
2. **a11y findings** (see CI artifact for details): icon-only buttons/links
   without accessible names on the kids surfaces (critical), color-contrast
   failures on amber-on-amber text, `aria-hidden` focusable elements on
   who-is-playing, an invalid ARIA attribute value on orders.

## CI layout (`.github/workflows/ci.yml`, `e2e` job)

build:e2e → start emulators (Java 21, cached binaries) → start app →
**blocking funnel+smoke** → report-only a11y → report-only visual →
report-only Lighthouse → artifacts (`playwright-report`, `e2e-test-results`,
`lighthouse-reports`).

Not yet implemented (deliberately): the nightly quarantined real-generation
smoke (no TEST_MODE, low-quota key) from the Sprint 3A plan — tracked as a
follow-up.
