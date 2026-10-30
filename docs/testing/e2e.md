# E2E Testing: Emulator + TEST_MODE Playwright Suite

> Sprint W1-B deliverable. Last updated: 2026-10-29 (slice 5.4: the funnel creates its Story through the UI — mode chooser, `POST /api/stories`, TEST_MODE wizard turns, `story.finish` — and no longer seeds a completed story; slice 5.2: the funnel makes a Book through `POST /api/books` and the server pipeline)

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
| `e2e/helpers/emulator.ts` | Seeding + cleanup via firebase-admin pointed at the emulators (catalog docs incl. two creation modes, the TEST_MODE wizard fixture constants, a complete-Story and a ready-Book fixture for report-only journeys, per-account teardown of children, characters, Stories with turns, Books, Manuscripts, jobs and the ledger). Every seeded doc is stamped `regressionTest: true`, mirroring `scripts/cleanup-regression-data.mjs`. |
| `e2e/helpers/flows.ts` | UI flows (signup, parent PIN guard, child creation, kids-mode lock) with web-first assertions. |

### Conventions

- **Web-first assertions on user-visible state only.** `waitForTimeout` is
  banned — flag it in review.
- Disposable accounts: every spec signs up a fresh
  `e2e-<tag>-<ts>-<rand>@example.com` user and deletes it (auth user, `users`
  doc, children, characters, stories + turns, books, manuscripts, jobs, entitlement ledger) in
  `afterEach`, so a
  long-lived local emulator stays clean across runs.
- Artifacts (screenshots/videos/traces) can contain synthetic child-like
  content: failure-only, 7-day CI retention, never committed
  (`test-results/`, `playwright-report/` are gitignored).

## The blocking funnel spec (`e2e/funnel.spec.ts`, `@funnel`)

Covers: **signup (no placeholder child is seeded; the home screen shows the
"Add your first child" prompt) → parent creates child (PIN guard passed only
if it appears — the fresh-PIN grace usually skips it) → kids-mode lock → the
mode chooser (`GET /api/creation-modes`) → Story Wizard → `POST /api/stories`
→ four questions answered in the UI (`POST /api/stories/{id}/turns`; prompts
and options shown with the child's name) → `story.finish` → story complete →
the child picks a Form (book type) and a Style (art style) → `POST /api/books`
→ the server pipeline makes the book → book ready → the reader shows the cover
and a page → My Books lists it as ready → My Stories lists the Story as
complete and its reader shows the text with names**,
on `desktop-chrome` and `mobile-chrome`. Checkout/pay is out of scope until
Stripe lands (sprint WG-1).

### Where the determinism seam sits (and why)

- **Book creation** runs through the real `POST /api/books` route (including
  the `storybook_allowance` charge in the creating transaction). The Book
  pipeline's jobs (`manuscript.paginate`, `manuscript.narrate`,
  `book.prepareCast`, `book.castSheet`, `book.illustrate`, `book.pageArt`) run
  on the **in-process dispatcher** of the e2e server (`JOBS_DISPATCHER` is
  forced to `in-process` by `scripts/start-e2e-server.mjs`, so no Cloud Tasks).
  `TEST_MODE=1` makes each handler write fixtures instead of calling a model;
  the Firestore documents advance exactly as in production
  (`paginating → ready`, `illustrating → ready`). The browser only watches.
- **Story creation** runs through the real creation routes (slice 5.4). With
  `TEST_MODE=1` every engine returns fixtures instead of calling a model (the
  engines' state machines still run): the wizard asks four fixed questions
  ("Where should the story happen?" …) with three options each (one names the
  hero) and writes a story titled "<child>'s Big Day"; `story.finish` (on the
  in-process dispatcher) adds the synopsis and consumes the story allowance in
  the same transaction that sets `complete`. The browser creates the Story,
  sends each answer and watches `stories/{id}` and its `turns`; on `complete`
  it opens the Form + Style chooser. No story data is seeded for the funnel.
- **Report-only journeys** (a11y book view, probe "read an existing book") still
  seed a complete Story in the server's shape (`seedCompleteStory`) and a ready
  Book, because they measure screens, not creation; the probe's "reach a
  finished book" goal plays the wizard like the funnel.

### Promotion status

The funnel spec is the **blocking** step of the CI `e2e` job (plus the login
smoke). Promotion criterion (3 consecutive deterministic green runs locally,
cold start each time) was met on 2026-06-11.

## Report-only checks

All three run in CI under `continue-on-error` and publish artifacts. "Report-
only" is **not** "forever": each has an explicit promotion criterion.

| Check | Spec/config | Scope | Promote when |
|-------|------------|-------|--------------|
| Accessibility | `e2e/a11y.spec.ts` (axe-core, WCAG 2.1 A/AA) | signup, who-is-playing, story creation, book view (seeded ready Book), orders | serious+critical count reaches 0 and stays for 2 weeks → set `A11Y_ENFORCE=1` in the CI step (turns scans into hard assertions) and drop `continue-on-error`. |
| Visual | `e2e/visual.spec.ts` | login, signup, kids home (avatars masked — they're seeded from picsum and vary per account) | <2% flake over 2 weeks after linux baselines are committed → drop `continue-on-error`. |
| Lighthouse | `lighthouserc.cjs` | /login, /signup, /kids — CWV budgets: LCP ≤ 4000ms, CLS ≤ 0.1, TBT ≤ 600ms (error-level); perf ≥ 0.7, a11y ≥ 0.9 (warn-level) | budgets stable for 2 weeks → drop `continue-on-error`. |

### Visual baseline bootstrap

Baselines are committed per project+platform under `e2e/__screenshots__/`
(`darwin` baselines exist). The first CI (linux) run fails snapshot-missing and
writes candidates into the `e2e-test-results` artifact — download, eyeball,
commit them as the linux baselines; comparison is active from the next run.

## Known app issues found by this suite (not fixed here — other tracks own the files)

1. ~~**Cold deep-links to kids surfaces crash while Firebase auth hydrates.**~~
   **Resolved in slice 5.4**: the kids pages no longer use the api-client context
   (`useRequiredApiClient`, which threw on the first render); they wait for auth
   and read through the shared creation components. The funnel opens `/kids`
   directly for its last step.
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
