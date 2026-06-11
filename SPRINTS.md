# StoryPic Kids — Sprint Roadmap (GTM Program + Execution)

> **Last Updated**: 2026-06-11
>
> **This is the single source of truth** for the GTM sprint program: its rationale, the
> authoritative done/outstanding rollup, and the worktree-parallelised execution plan.
> It supersedes the former `docs/SPRINTS.md` (now a pointer stub) and merges the program
> definition with the execution roadmap. Detailed per-sprint implementation plans live under
> [`docs/sprints/`](docs/sprints/).
>
> Say "Sprint W1-A" (etc.) to begin a sprint. On every change: update the rollup below, the
> sprint's Status line, and mark the cited dev todos completed in the admin UI
> (Admin → Development).

---

## Program status (single source of truth — update on every change)

> The authoritative done/outstanding rollup so it survives context resets. As of **2026-06-11** (post Wave-1 merge).

### Done
- **Wave 1 (Sprints W1-A/B/C, 2026-06-11)** — three parallel worktree sprints merged (`ef39433`,
  `333b6b6`, `5fe98a4`); typecheck + build + 245 vitest green on the merged result.
  - **W1-A Generation reliability — COMPLETE**: degraded-book status contract
    (`artStatus`/`deriveStorybookArtStatus`/`isViewable`/`isOrderable`, contract commit `710d622`);
    flow-result errors user-safe across 20 flows (raw stays in logs); `withRetry` adoption
    (wizard/avatar-animation; image flow on shared backoff + breaker); **distributed circuit
    breaker** in `systemConfig/circuitBreakers` (transactional, 5s cache, fail-open);
    degraded books viewable/orderable + recovery detection/toast; kid-safe `/kids/*` states;
    server-authoritative "Question N of 4" wizard progress.
  - **W1-B E2E + security tail — COMPLETE**: blocking funnel gate (signup → child → story →
    storybookV2 generation on emulator + TEST_MODE, 3× deterministic, desktop+mobile) — the old CI
    e2e job was silently failing and is fixed; report-only axe/visual/Lighthouse with promotion
    criteria in `docs/testing/e2e.md`; `crypto.timingSafeEqual` on internal routes.
  - **W1-C Probe findings — COMPLETE**: placeholder child no longer seeded ("Add your first
    child" empty state; placeholders + soft-deleted profiles excluded from casts server-side —
    also fixed deleted siblings leaking into prompts); kids-generator presentation layer (no
    model jargon, one "Recommended for first-timers" badge, **fixed public route leaking AI
    prompts/model config**); fresh-PIN grace after signup; 0efa328 fixes smoke-verified PASS.
- **Sprint 1 — Measurement spine** (`[GTM 1/8]`): engineering complete, **shipped disabled-by-default**.
  PostHog (EU) analytics + RUM + Error Tracking; vendor-agnostic core with no-PII guard, kill-switch,
  consent gating, pre-init buffer; funnel events; admin toggle. *Not yet live* — see compliance gate.
- **Commercial catalog** (Monetisation I-b, payment-agnostic): `products`/`prices` model + entitlement
  components + admin `/admin/products` + APIs.
- **3 high-severity usability fixes** (probe findings): End-Tour→home, "Play as child" button, "Switch
  child" nav. *Smoke-verified PASS in W1-C.*
- **Sprint 3A foundation (partial)**: emulator-aware Firebase config (env-gated, default unchanged) +
  Playwright scaffold + one smoke spec + report-only CI `e2e` job + `TEST_MODE` AI seam (deterministic
  fixtures, default off). *Completed by W1-B.*
- **Generation reliability (slice)**: retry+jitter util, error classifier, circuit-breaker scaffold,
  raw→user-safe error mapping. **No raw error reaches a child/parent**: the `storybookV2/*` routes
  plus every interactive generation route (`tts`, `storyWizard`, `storyFriends`, `storyArc`,
  `storyEnding`, `storyBeat`, `gemini3`, `gemini4`, `warmupReply`, `storyCompile`) now map catch-block
  messages through `toUserSafeMessage` (raw stays in logs). *Completed by W1-A.*
- **Entitlement ledger model**: `entitlementLedgers` collection + grant/check/consume (scope-resolved)
  + server reader + free-tier + rules + tests.
- **Entitlement enforcement (story + storybook)**: transaction-wrapped `consumeEntitlement` +
  read-only `checkEntitlement` server helpers. `story_allowance` is enforced at the shared
  **completion chokepoint** `POST /api/storyCompile` (covers kids + all parent flows): pre-flight
  `402` block at the limit, plus **consume-on-completion** (idempotent via `storyAllowanceConsumed`,
  so abandoned creates never charge). `kids/create` also calls the non-consuming
  `POST /api/entitlements/check` at start for an early friendly block. `storybook_allowance` gated
  inside `POST /api/storybookV2/create`. Free-tier seeded on first use. *Remaining: `print_credit`
  at print time — deliberately deferred until purchase grants exist → Sprint WG-2.*

### Outstanding (mapped to execution sprints below)
| # | Item | Sprint |
|---|------|--------|
| 4 | Naive-agent probe, productionised (`[GTM 3/8]` second half; POC validated) | **W2-A** |
| 5 | First-run usability (`[GTM 4/8]`): onboarding checklist + tips + time-to-first-book | **W2-B** |
| 6 | Parent storybook view & ordering flow: simplified view + per-page edit/regenerate; print-flow split; save address; incremental loading | **W2-C** |
| 7 | Admin UX-monitoring dashboard (`[GTM 7/8]`) + Mixam webhook automation | **W3-A** |
| 8 | Deployment strategy: canary, flags, rollback | **W3-B** |
| 9 | Feedback & conversion polish (`[GTM 8/8]`) | **W3-C** |
| 10 | Monetisation I — payments/Stripe (`[GTM 2/8]`): **deferred by owner** | **WG-1** |
| 11 | Monetisation II (`[GTM 6/8]`): subscriptions + gifting + `print_credit` + ledger hardening | **WG-2** |

### Open non-sprint gates / follow-ups
- **Sprint 1 compliance gate (to flip analytics ON)**: set PostHog retention; add EU sub-processor list
  to privacy policy; consent-basis sign-off. *(Owner/legal.)* Until flipped, "measurable lift" exit
  criteria are judged from session-events/logs instead.
- **Catalog rules deploy**: `firebase deploy --only firestore:rules` (products/prices rules not yet deployed).
- **Secret remediation tail** (non-blocking, secrets already dead): optional git-history scrub;
  ADC/workload-identity migration. See `docs/SECURITY_REMEDIATION.md`.
  *(timingSafeEqual ✅ done in W1-B; history scrub still deferred — needs coordinated force-push.)*
- **Firestore TTL on `events`**: ✅ enabled (2026-06-05).
- **Wave-1 follow-ups** (dev todos filed where noted):
  - **[BUG] Kids cold deep-links crash to the error boundary while Firebase auth hydrates**
    (`/kids/stories`, `/kids/books`; `useRequiredApiClient` throws) — found by W1-B; real
    PWA-reopen scenario. *(todo filed)*
  - Wire `withProviderReliability` into the remaining direct `ai.generate` flows + the reserved
    `elevenlabs-tts` breaker key. *(todo filed)*
  - Fix the axe-surfaced a11y violations (icon-only buttons, contrast, aria-hidden-focus), then
    promote the a11y gate per `docs/testing/e2e.md`. *(todo filed)*
  - One-off migration to soft-delete legacy "My First Child" docs; admin UI fields for
    `kidFriendlyName`/`kidFriendlyDescription`/`recommendedForKids`. *(todo filed)*
  - W2-C product question: ordering a degraded book should confirm "some pages print without
    art" — added to the W2-C sprint notes.
  - Extend TEST_MODE into the wizard route so the seeded story steps become real clicks; nightly
    real-generation smoke; linux visual baselines from first CI artifact.
  - Recovery notification is in-app only; consider email/push. Durable queue (Cloud Tasks) for
    long generations at scale.
  - Data check: live `beat` generator doc has `enabledForKids: true` (seed disagrees).

---

## Why this program exists

`docs/SALES_MARKETING.md` is the demand plan (ads, influencers, PR). It assumes the product can
(a) measure a funnel, (b) take payment, and (c) reliably convert a stranger into a finished book.
As assessed at program start (2026-06-05) it could do none of these robustly: no product analytics,
a stub `pay` route, greenfield subscriptions, raw generation failures, buried onboarding, ~5 unit
tests with no E2E, and no production error tracking. The rollup above tracks how far that has moved.

**Decisions locked:** analytics/RUM/errors = **PostHog** (EU region, one vendor/DPA — not Sentry,
which has no usable free tier; GlitchTip is the fallback); payments = **Stripe** (hosted Checkout,
SAQ-A); browser tests = **Playwright**.

**Cross-cutting rules from the five-lens review (apply to every sprint):**
- **No Firestore dual-write of analytics** — PostHog is the system of record; `session-events`
  stays only as a narrow operational debug trail.
- **Test per sprint, not just in the testing sprint** — every sprint ships its own Tests/DoD;
  extend the existing CI rather than re-create it.
- **Compliance scaffolding (kids product)** — signed DPA, EU/UK residency, consent banner + lawful
  basis, retention limits, **content-based** (not just route-based) replay masking.
- **Stripe webhook must not inherit the Mixam bypass pattern** — hard-fail on bad signature,
  idempotent dedupe on `event.id`, reconciliation job; server-authoritative pricing.
- **Bound new data** — Firestore TTL on event-like collections; composite index definitions ship
  with every new collection.
- **Dashboards read from PostHog** (query API, cached), not Firestore collection-group scans.

---

## Parallelisation Model — Worktrees

Three tracks, each in its own git worktree, chosen so their primary file territory is disjoint:

| Track | Worktree | Branch | Owns (primary file territory) |
|-------|----------|--------|-------------------------------|
| **A — Reliability** | `../studio-reliability` | `track/reliability` | `src/ai/flows/`, `src/lib/ai-retry.ts`, `src/lib/ai-error-map*`, storybook status components |
| **B — Ops/Testing** | `../studio-ops` | `track/ops` | `e2e/`, `playwright.config.ts`, `.github/`, `src/app/admin/`, deployment config, internal API routes |
| **C — UX** | `../studio-ux` | `track/ux` | `src/app/kids/`, `src/app/parent/`, `src/app/storybook/`, `src/components/` (wizards, nav, cards), `src/data/help-wizards.json` |

```bash
git worktree add ../studio-reliability -b track/reliability
git worktree add ../studio-ops         -b track/ops
git worktree add ../studio-ux          -b track/ux
```

**Rules of engagement**

1. **Waves are merge barriers.** All tracks merge to `main` at the end of each wave, in fixed
   order **A → B → C** (A owns `src/lib/types.ts` and flow contracts; B and C rebase onto main
   before merging).
2. **Shared-file ownership.** `src/lib/types.ts`, `firestore.rules`: Track A has write priority;
   B/C append-only and rebase. Global providers/`layout.tsx` are already settled — tracks should
   rarely touch them.
3. **Docs merge last.** `docs/CHANGES.md`, `docs/SCHEMA.md`, `docs/API.md`, and this file are
   append-conflict magnets — keep doc edits in a final commit per track and resolve at the wave
   merge, per the CLAUDE.md single-push workflow.
4. **Cross-track contracts.** Where one track consumes another's output mid-wave (e.g. UX renders
   Reliability's degraded-book states), the producing track merges a types/interface stub to
   `main` early and both sides build against it.
5. **Cloud agents count as a track.** Work also lands via web-agent PRs (`claude/...` branches).
   Before starting any sprint, `git fetch` and re-read the rollup above — do not assume the
   status column is current.

---

## Status Overview

| Wave | Sprint | Track | Title | Status |
|------|--------|-------|-------|--------|
| 1 | W1-A | Reliability | Generation reliability — finish (degradation, kid-safe states, breaker) | COMPLETE (2026-06-11, `ef39433`) |
| 1 | W1-B | Ops | E2E funnel specs + a11y/Lighthouse/visual + security tail | COMPLETE (2026-06-11, `333b6b6`) |
| 1 | W1-C | UX | Remaining probe findings (placeholder child, jargon, PIN) | COMPLETE (2026-06-11, `5fe98a4`) |
| 2 | W2-A | Reliability→Ops | Naive-agent probe, productionised | PENDING |
| 2 | W2-B | UX | First-run usability — onboarding checklist, tips, time-to-first-book | PENDING |
| 2 | W2-C | UX | Parent storybook view & ordering flow (simplified view + per-page edit) | PENDING |
| 3 | W3-A | Ops | Admin UX-monitoring dashboard + Mixam webhook automation | PENDING |
| 3 | W3-B | Ops | Deployment strategy — canary, flags, rollback | PENDING |
| 3 | W3-C | UX | Feedback & conversion polish — NPS, testimonials, order transparency | PENDING |
| gated | WG-1 | Money | Take money — Stripe Checkout + hardened webhook (owner-deferred) | BLOCKED (owner) |
| gated | WG-2 | Money | Monetisation II — subscriptions, gifting, print_credit, ledger hardening | BLOCKED (WG-1) |

---

# Wave 1

## Sprint W1-A: Generation Reliability — Finish

**Track:** A — Reliability
**Dev todos:** `TFBfyjJFshsZOWndUi4W` [GTM 5/8], `yYCCsnDkZZZbmBfzcQrN` [circuit breaker +
withRetry], `wWoz8bF8U5Bx1F7trt5Q` [wizard wait progress — perceived latency]

**Goal:** The magic moment survives transient failure end-to-end — the route-level user-safe
error slice is done; finish the flow, UI, and infrastructure layers. Generation failure is fatal
for word-of-mouth and paid traffic.

### Deliverables
- Map **flow-result** error messages through `toUserSafeMessage` (routes are done; flow results
  still leak).
- Migrate remaining bespoke retry loops in `src/ai/flows/*` onto the shared `withRetry` util
  (only `story-image-flow` consolidated so far). Exponential backoff + jitter, **low cap (2–3)**,
  only for *classified transient* errors (5xx/timeout), never 4xx/quota.
- Make the circuit breaker systemConfig-backed (or per-provider Firestore counter) so it trips
  consistently across serverless instances; on sustained error rate it fast-fails to graceful
  degradation instead of retrying — a provider outage must not become a self-inflicted retry
  storm that burns AI tokens.
- Graceful degradation: a text + partial-art book is viewable/orderable instead of a dead Error
  badge; notify the user when a previously failed generation recovers.
- Kid-safe, age-appropriate (possibly non-textual) error/empty/loading states on `/kids/*`
  (mascot/icon/audio).
- Perceived latency: "Question N of 4" wizard progress + reassurance copy during slow generation
  (uses the `generation.duration` instrumentation from Sprint 1).
- Merge the degraded-book status contract to `main` early for W2-C's parent view.

### Technical approach
Consolidate the retry/backoff logic already scattered across the flows (don't build a parallel
mechanism); reuse the existing `ai-flow-logger` seam (it already captures `failureReason` and
calls `notifyMaintenanceError`). Map raw errors via the exhaustive, unit-tested table in
`ai-error-map`. For long generations, note a durable queue (Cloud Tasks) as the at-scale
follow-up.

### Tests / DoD
Backoff-schedule test; transient-retried / permanent-not-retried test; circuit-breaker trip/reset
test; error-mapping table stays exhaustive.

### Files
Changed: AI flows, `src/app/storybook/[bookId]/page.tsx`, status components,
`src/lib/ai-flow-logger.ts`, `src/lib/ai-retry.ts`. Docs: SYSTEM_DESIGN (error handling).

### Exit criteria
No raw API strings from flows or routes; transient failures self-heal; a partial-art book can be
viewed and ordered; breaker trips consistently across instances.

**Status:** COMPLETE — 2026-06-11, merged `ef39433` (contract commit `710d622`; 215 track tests green)

---

## Sprint W1-B: E2E Funnel Specs + a11y/Lighthouse/Visual + Security Tail

**Track:** B — Ops/Testing
**Dev todos:** `LwQBiYIctkd7CJe1Svnl` [GTM 3/8], tail of `wkcM2eWHI6wm4aiLtXfp` [security]
**See also:** `docs/sprints/SPRINT-03-UX-TESTING.md`, `docs/SECURITY_REMEDIATION.md`

**Goal:** Turn the existing Playwright scaffold + TEST_MODE seam into a real CI safety net —
an automated gate that exercises real UX, not just units — and close the non-blocking security
tail.

### Deliverables
- Deterministic funnel E2E specs on emulator + TEST_MODE: signup → child → story → storybook
  generation. (The checkout/pay spec lands with WG-1 when Stripe is unblocked.)
- axe-core accessibility assertions on key pages; Lighthouse CI with Core Web Vitals budgets;
  visual regression snapshots for key surfaces (all report-only first).
- Promote the happy-path spec from report-only to a blocking merge gate once green; add a
  `test:e2e` script.
- Security tail: `crypto.timingSafeEqual` on internal-secret comparisons
  (`src/app/api/internal/*`); optional git-history scrub (old secrets already rotated/dead);
  note ADC/workload-identity migration as follow-up.

### Technical approach
Playwright projects for desktop + mobile viewports; seed a disposable test account; reuse the
cleanup pattern from `scripts/cleanup-regression-data.mjs`. Keep flaky AI-generation steps behind
the TEST_MODE deterministic fixtures. Pair with the real-user half: PostHog session replay
(Sprint 1) once the compliance gate flips.

### Files
New: `e2e/` specs, Lighthouse config. Changed: `playwright.config.ts`, `package.json`,
`.github/` workflow, `src/app/api/internal/*`. Docs: `docs/testing/`.

### Exit criteria
CI fails on a broken funnel; a11y/perf/visual reports produced on every PR; internal routes use
constant-time comparison.

**Status:** COMPLETE — 2026-06-11, merged `333b6b6` (funnel gate blocking after 3× deterministic runs; history scrub still deferred)

---

## Sprint W1-C: Remaining Probe Findings

**Track:** C — UX
**Dev todos:** `bjnUyxz7wbOxZqkhXet9` [placeholder child], `MnAEg1usKm7vmsuM5WrW` [story-method
jargon], `9wuCAy5kThfyNRXLVvaM` [PIN re-entry]
**See also:** `docs/usability/UX-PROBE-FINDINGS-2026-06-05.md` (3 of 7 findings already fixed
in `0efa328`)

**Goal:** Clear the remaining medium/low activation friction from the naive-agent probe.

### Deliverables
- Stop seeding the "My First Child" placeholder — prompt "Add your first child" instead; exclude
  placeholder profiles from story casts.
- Story-method chooser: hide model names from end users; "Recommended for first-timers" badge.
- Skip/confirm the redundant PIN prompt immediately after signup.
- Manual/probe smoke of the three already-merged high-severity fixes (End Tour, Play-as, Switch
  child) — owed per the rollup.

### Exit criteria
A probe re-run hits none of the seven findings; no placeholder children appear in any story cast.

**Status:** COMPLETE — 2026-06-11, merged `5fe98a4` (full probe re-run owed to W2-A; code-path smoke PASS on all seven)

---

# Wave 2

## Sprint W2-A: Naive-Agent Probe, Productionised

**Track:** A capacity moves here post-W1; runs in the ops worktree
**Dev todos:** — (program item; file one when started)
**Depends on:** W1-B (E2E infra), W1-C (so the probe measures a clean baseline). POC validated.

**Goal:** A repeatable, mechanical UX probe that finds regressions before users do.

### Deliverables
- Expert baseline + mechanical personas with budgets; codable fix-records.
- PostHog concordance (synthetic probe vs real funnel) once analytics is flipped on.
- PM-readable report artifact per run; runnable on demand and on a schedule.

### Exit criteria
One command produces a persona-run report; findings file as codable records; a deliberately
reintroduced W1-C bug is caught.

**Status:** PENDING

---

## Sprint W2-B: First-Run Usability

**Track:** C — UX
**Dev todos:** `qP9EhmT6Y8PwwpYyl7k0` [GTM 4/8]

**Goal:** A new family reaches a finished book unaided — the biggest Phase-1 risk is
friends-and-family users stalling before the "wow".

### Deliverables
- First-run detection + guided "create your first book" checklist (upload photo → create child →
  start story → generate art → preview).
- Strong empty states on child/character/storybook lists pointing to the next action (deepen the
  thin slice already shipped where the checklist reveals gaps).
- Auto-triggered in-context tips on first use of story creation and art generation.
- Instrument time-to-first-book.

### Technical approach
Reuse `src/components/help-wizard.tsx`, `startup-wizard-trigger.tsx`, and
`wizard-target-overlay.tsx` rather than building anew; add an `onboardingState` per user (steps
completed) in Firestore.

### Files
Changed: provider/wizard components, parent/kids list pages, `src/app/signup/page.tsx`.
New: onboarding checklist component + `onboardingState` field. Docs: SCHEMA, SYSTEM_DESIGN.

### Exit criteria
Measurable lift in signup → story-completed vs baseline (PostHog once live; session-events
otherwise); a fresh account reaches a finished book unaided.

**Status:** PENDING

---

## Sprint W2-C: Parent Storybook View & Ordering Flow

**Track:** C — UX (second worktree off `track/ux`, or sequential after W2-B — owner's call)
**Dev todos:** `Y8oQ7iqkdNFvbDzMeOS0` [print workflow], `IrcG2YBlJjxnRKaebTuh` [save address],
`WwE4eEEOHpVT5PGSIsA5` [incremental loading], `iOErHwHgj7H0KLU4UzOp` [simplified parent view +
per-page edit/regenerate]
**Depends on:** W1-A's degraded-book status contract (the parent view must render partial-art
books).

**Goal:** The parent's view of a child's storybook becomes as simple as the child's, with editing
power where it belongs, and the path to a printed book stops being overcomplex.

### Deliverables
- **Simplified parent book view, aligned with the child's view** — same rendering/components as
  the kids' book page, replacing the current overcomplicated parent presentation — with one
  exception: an **Edit button on each page** that lets the parent (a) modify the image-generation
  prompt, (b) edit the page text, and (c) re-generate the page image. Server-first: edits and
  regeneration go through API routes, reusing the existing generation flows.
- Separate **page clean-up** (the per-page review/edit pass above) from **print ordering** as two
  distinct stages in the flow.
- "Save address" on the shipping page; saved addresses offered on later orders (an `addresses`
  subcollection already exists in rules).
- Incremental loading on object-heavy pages (e.g. `/parent/storybooks`): return the list first,
  fill images afterwards — filtering/sorting server-side per the server-first principle.
- Ordering a degraded (partial-art) book must show an explicit confirmation that some pages will
  print without art (W1-A made such orders possible; the order dialog doesn't warn yet).

### Exit criteria
Parent and child book views share components; a parent can edit prompt/text and regenerate a
single page without leaving the book; clean-up and ordering are distinct steps; a second order
reuses a saved address; `/parent/storybooks` renders its list without waiting on images.

**Status:** PENDING

---

# Wave 3

## Sprint W3-A: Admin UX-Monitoring Dashboard + Mixam Webhook Automation

**Track:** B — Ops
**Dev todos:** `N0Bx3q1bFTXiw17og6hz` [GTM 7/8], `EzfeQDmgA3upALePJMFy` [Mixam webhooks]

**Goal:** One page answers "where are users dropping off and what's broken now?" — 44 admin
config pages exist but none show user health — and Mixam order progression drives admin state
automatically.

### Deliverables
- Ops/KPI dashboard: DAU/MAU, the Sprint-1 funnel, print-order conversion, generation error rate
  — reading from PostHog's query API (cached), not Firestore collection-group scans.
- Health checks + alerts: art pending > N hours, orders un-reviewed > 24h, error-rate spikes →
  notify maintenance (reuse `notifyMaintenanceError`).
- Surface failure reasons at a glance in print-order and sessions admin views (currently must
  open each record).
- Mixam webhook automation: each webhook advances the admin order state / queues the next admin
  action — toward driving the full Mixam interaction from the StoryPic console.

### Files
New: `src/app/admin/ops/page.tsx`, health-check job(s). Changed:
`src/app/admin/sessions/page.tsx`, `src/app/admin/print-orders/page.tsx`,
`src/app/admin/page.tsx`, `src/app/api/webhooks/mixam/route.ts`. Docs: SYSTEM_DESIGN, API.

### Exit criteria
The drop-off/broken-now question is answerable from one page; alerts fire on synthetic stuck-job
conditions; a Mixam status webhook visibly advances the order in admin without manual refresh.

**Status:** PENDING

---

## Sprint W3-B: Deployment Strategy — Canary, Flags, Rollback

**Track:** B — Ops (sequential after W3-A or parallel in a second ops worktree)
**Dev todos:** `Vbs6BigfnGoTFbSI3xs5`

**Goal:** Replace "push → auto deploy" with staged rollout and fast rollback before traffic grows.

### Deliverables
- Build-once CI: image tagged `$COMMIT_SHA`; new revisions deployed `--no-traffic` for staging
  smoke tests.
- Canary via Cloud Run traffic splitting (0% → canary % → 100%) without rebuilding; one-step
  rollback to a known-good revision.
- Feature flags via Firebase Remote Config (UID / email-domain / percentage conditions);
  app-level health endpoint.
- Optional: Firebase Hosting preview channels for feature-branch QA.

### Exit criteria
A release ships to a canary %, promotes, and rolls back — each without a rebuild; a flag disables
a feature in production without a deploy.

**Status:** PENDING

---

## Sprint W3-C: Feedback & Conversion Polish

**Track:** C — UX
**Dev todos:** `bRfMxYLwnsTCExVYpcDA` [GTM 8/8]

**Goal:** Close the loop — satisfaction becomes a tracked metric and testimonials are captured
(Phase 1 targets: 10+ testimonials, 4.5★). Today there is only an email-only, untracked
issue-report button.

### Deliverables
- Post-book / post-order rating + NPS prompt piped to analytics; new `feedback` collection.
- Lightweight testimonial capture (consent + quote/photo) feeding the marketing flywheel.
- Order pipeline transparency: estimated turnaround/delivery, progress indicator, confirmation
  (builds on W2-C's simplified ordering flow).
- Turn issue-reports into tracked tickets with status back to the user.

### Files
Changed: `src/components/report-issue-button.tsx`, `src/app/api/report-issue/route.ts`,
`src/app/parent/orders/page.tsx`, order pages. New: NPS/rating component + `feedback`
collection, testimonial capture. Docs: SCHEMA, API, SYSTEM_DESIGN.

### Exit criteria
NPS/satisfaction live on the W3-A dashboard; testimonials captured in-product; order status
transparent to parents.

**Status:** PENDING

---

# Owner-Gated Sprints (scheduled when unblocked)

## Sprint WG-1: Take Money — Stripe Checkout + Hardened Webhook

**Dev todos:** `uRwu8VlWyyhqPgh51N7G` [GTM 2/8 — critical-path half], `0RewpFrqxoJtYnQLGw2f`
(umbrella: one-time purchases)
**Blocked by:** owner decision (Stripe deferred)

**Goal:** Take real card payment for a printed book. Phase 1's "50–100 paying customers /
£2–5K revenue" is impossible while `pay` is a stub. The catalog half (Monetisation I-b) is
already done.

### Deliverables
- Stripe hosted Checkout + customer creation; **webhooks as the source of truth** for
  `paymentStatus`.
- New `src/app/api/webhooks/stripe/route.ts` — hard-fail on bad/missing signature, idempotent
  dedupe on Stripe `event.id`, reconciliation job (do **not** copy the Mixam handler's
  signature-bypass). Pricing is server-authoritative (client never sends amount).
- Replace the stub `src/app/api/printOrders/[orderId]/pay/route.ts` → real payment → existing
  `printOrders` fulfilment flow; keep `productSnapshot` on the order for an immutable record.
- Stripe Tax/VAT, refunds, receipts; rate-limiting on checkout/pay; minimum post-payment
  transparency (confirmation + turnaround/status).

### Tests / DoD
Webhook signature (valid passes / tampered 400s); idempotency (duplicate event → one update);
atomic order/payment write; Playwright happy-path checkout smoke in Stripe test mode (extends
W1-B's specs).

### Exit criteria
A parent pays by card; webhook confirms; order proceeds to admin/Mixam fulfilment; conversion
event fires.

**Status:** BLOCKED (owner)

---

## Sprint WG-2: Monetisation II — Subscriptions, Gifting, print_credit, Ledger Hardening

**Dev todos:** `SArzCSqBMJM2iDWYWPCX` [GTM 6/8], `Y4RIepF1595hCF4bOCJb` [ledger hardening],
remainder of `0RewpFrqxoJtYnQLGw2f` (free-tier boundary, token gifts)
**Blocked by:** WG-1

**Goal:** Recurring revenue ("Story of the Month", Phase 3 target ~£60K/yr) with self-serve
billing, reusing the existing catalog and ledger.

### Deliverables
- Recurring prices in the catalog + subscription plan management in the admin pricing UI.
- Stripe subscriptions + customer billing portal (self-serve upgrade/cancel); lifecycle webhooks
  (created/updated/cancelled/past_due) + dunning.
- Entitlements: a subscription grants N books/month or unlocks premium features; enforced in
  Firestore rules + API (the ledger and enforcement chokepoints already exist).
- `print_credit` enforcement at print time (deferred until these purchase grants exist).
- Ledger hardening: per_period rollover wired to renewal events (grant-triggered today, needs
  the renewal webhook or a sweep); gift redemption resolving the real target ledger (not the
  family pool); child-deletion cleanup hook pruning `children[childId]`.
- Define the free-tier boundary: what a non-paying family can do; chargeable vs non-chargeable
  items; one-time token purchases + gift/donation payment links.

### Exit criteria
A parent subscribes, receives entitlements, and manages billing via the portal; lifecycle events
update Firestore via webhook; free-tier limits enforced; the three ledger gaps have regression
tests.

**Status:** BLOCKED (WG-1)

---

## Completed sprint record

Engineering detail for completed work lives in `docs/CHANGES.md`; the rollup at the top is the
status summary. Detailed plans for completed sprints:
- **Sprint 1 — Measurement spine**: [`docs/sprints/SPRINT-01-MEASUREMENT-SPINE.md`](docs/sprints/SPRINT-01-MEASUREMENT-SPINE.md)
- **UX testing framework (foundation)**: [`docs/sprints/SPRINT-03-UX-TESTING.md`](docs/sprints/SPRINT-03-UX-TESTING.md)

---

## Todo-Resolution Bookkeeping (mark in admin UI)

| Dev todo | Disposition |
|----------|-------------|
| `q0wKiqL6Ur7o213Zeq0E` [GTM Plan v2] | **Resolved** — five-lens revisions reconciled into this roadmap |
| `nK75xl1II15x5a0wUV21` [Mixam confirm investigation] | **Done** — commit `53fd827` implemented confirmation via the Public API |
| `hxEIiRQz14NwGZI0IAX5` [transaction-wrapped consume] | **Done** — `consumeEntitlement` is transaction-wrapped (verify, then close) |
| `jPNbZXSrOxnIpYVnZQSU` / `ljTPITfNev96EtxNNvZm` / `qlEJklsBbK2LaQHttESN` [3 high-sev UX] | **Merged** (`0efa328`) — close after the W1-C probe smoke |
| `nq1czfTGwg41IoyaF2L3` [GTM 1/8] | **Engineering complete** — open only on the owner/legal compliance gate |
| `wkcM2eWHI6wm4aiLtXfp` [security] | **Rotated** — only the W1-B tail remains |

## Backlog (not scheduled)

| Item | Dev todo | Notes |
|------|----------|-------|
| Parent layout editor — WYSIWYG | `95vlWuslJRa2GUSmW7eY` | No description; W2-C's per-page editor may subsume or scope it |

---

## Cross-Sprint Concerns (per `CLAUDE.md`)

- **Docs discipline:** every sprint that touches schema/API/architecture updates
  `docs/SCHEMA.md` / `docs/API.md` / `docs/SYSTEM_DESIGN.md`, appends to `docs/CHANGES.md` on
  push, and updates the rollup at the top of this file before its wave merge.
- **Regression page:** API-touching sprints add cases to `src/app/admin/regression/page.tsx`.
- **Playwright coverage:** from W1-B onward, new flows should ship Playwright coverage.
- **Server-first principle** throughout: filtering/sorting/computed fields in API routes, not
  clients (especially W2-C).
