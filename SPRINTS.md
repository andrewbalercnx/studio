# StoryPic Kids — Execution Roadmap (Worktree-Parallelised)

> **Last updated:** 2026-06-11
>
> The GTM **program** definition and its authoritative done/outstanding rollup live in
> [`docs/SPRINTS.md`](docs/SPRINTS.md). This file is the **execution roadmap**: it sequences the
> outstanding program items plus the non-GTM `devTodos` items into waves of parallel sprints, each
> running in its own git worktree. Say "Sprint W1-A" (etc.) to begin a sprint. When a sprint
> completes, update this file, `docs/SPRINTS.md`'s rollup, and mark the cited dev todos completed
> in the admin UI.

---

## Where things stand (from `docs/SPRINTS.md` rollup, 2026-06-06)

Already **done**: measurement spine (shipped disabled-by-default behind the compliance gate);
payment-agnostic product catalog + `/admin/products`; entitlement ledger + transaction-wrapped
enforcement (story + storybook) + summary UI; the 3 high-severity probe fixes (End Tour, Play-as,
Switch child); user-safe error mapping across all interactive generation routes; Playwright
scaffold + TEST_MODE seam + report-only CI e2e job; secret rotation (old keys dead).

**Owner-gated** (not scheduled below until unblocked):
- **Stripe take-money** — deferred by owner. Unblocks: subscriptions (Monetisation II), gifting
  redemption, `print_credit` enforcement, full ledger hardening.
- **Compliance gate** to flip analytics ON (PostHog retention, sub-processor list, consent
  sign-off) — owner/legal. Until flipped, sprint exit criteria that read "measurable lift" are
  judged from session-events/logs instead.
- **Catalog rules deploy**: `firebase deploy --only firestore:rules`.

---

## Parallelisation Model — Worktrees

Three tracks, each in its own worktree, chosen so their primary file territory is disjoint:

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
3. **Docs merge last.** `docs/CHANGES.md`, `docs/SCHEMA.md`, `docs/API.md`, `docs/SPRINTS.md` are
   append-conflict magnets — keep doc edits in a final commit per track and resolve at the wave
   merge, per the CLAUDE.md single-push workflow.
4. **Cross-track contracts.** Where one track consumes another's output mid-wave (e.g. UX renders
   Reliability's degraded-book states), the producing track merges a types/interface stub to
   `main` early and both sides build against it.
5. **Cloud agents count as a track.** Work is also landing via web-agent PRs (e.g.
   `claude/...` branches). Before starting any sprint, `git fetch` and re-read
   `docs/SPRINTS.md`'s rollup — do not assume this file's status column is current.

---

## Status Overview

| Wave | Sprint | Track | Title | Status |
|------|--------|-------|-------|--------|
| 1 | W1-A | Reliability | Generation reliability — finish (degradation, kid-safe states, breaker) | PENDING |
| 1 | W1-B | Ops | E2E funnel specs + a11y/Lighthouse/visual + security tail | PENDING |
| 1 | W1-C | UX | Remaining probe findings (placeholder child, jargon, PIN) | PENDING |
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
**Program ref:** docs/SPRINTS.md Sprint 5; rollup "Generation reliability — finish"

**Goal:** The magic moment survives transient failure end-to-end — the route-level user-safe
error slice is done; finish the flow, UI, and infrastructure layers.

### Deliverables
- Map **flow-result** error messages through `toUserSafeMessage` (routes are done; flow results
  still leak).
- Migrate remaining bespoke retry loops in `src/ai/flows/*` onto the shared `withRetry` util
  (only `story-image-flow` consolidated so far); low cap (2–3), transient-only.
- Make the circuit breaker systemConfig-backed (or per-provider Firestore counter) so it trips
  consistently across serverless instances; fast-fail to degradation, no retry storms.
- Graceful degradation: a text + partial-art book is viewable/orderable instead of a dead Error
  badge; notify the user when a failed generation later recovers.
- Kid-safe, age-appropriate (possibly non-textual) error/empty/loading states on `/kids/*`.
- Perceived latency: "Question N of 4" wizard progress + reassurance copy during slow generation.
- Tests: backoff schedule, transient-retried/permanent-not, breaker trip/reset (per-sprint DoD).
- Merge the degraded-book status contract to `main` early for W2-C's parent view.

### Exit criteria
- No raw API strings from flows or routes; transient failures self-heal; a partial-art book can
  be viewed and ordered; breaker trips consistently across instances.

**Status:** PENDING

---

## Sprint W1-B: E2E Funnel Specs + a11y/Lighthouse/Visual + Security Tail

**Track:** B — Ops/Testing
**Dev todos:** `LwQBiYIctkd7CJe1Svnl` [GTM 3/8], tail of `wkcM2eWHI6wm4aiLtXfp` [security]
**Program ref:** rollup item 2 "Sprint 3A E2E specs"; `docs/SECURITY_REMEDIATION.md`

**Goal:** Turn the existing Playwright scaffold + TEST_MODE seam into a real CI safety net, and
close the non-blocking security tail.

### Deliverables
- Deterministic funnel E2E specs on emulator + TEST_MODE: signup → child → story → storybook
  generation (checkout spec lands with WG-1 when Stripe is unblocked).
- axe-core assertions on key pages; Lighthouse CI with Core Web Vitals budgets; visual regression
  snapshots (all report-only first).
- Promote the happy-path spec from report-only to a blocking merge gate once green.
- Security tail: `crypto.timingSafeEqual` on internal-secret comparisons
  (`src/app/api/internal/*`); optional git-history scrub (old secrets already rotated/dead);
  note ADC/workload-identity migration as follow-up.

### Exit criteria
- CI fails on a broken funnel; a11y/perf/visual reports produced on every PR; internal routes use
  constant-time comparison.

**Status:** PENDING

---

## Sprint W1-C: Remaining Probe Findings

**Track:** C — UX
**Dev todos:** `bjnUyxz7wbOxZqkhXet9` [placeholder child], `MnAEg1usKm7vmsuM5WrW` [story-method
jargon], `9wuCAy5kThfyNRXLVvaM` [PIN re-entry]
**Program ref:** probe findings `docs/usability/UX-PROBE-FINDINGS-2026-06-05.md` (3 of 7 already
fixed in `0efa328`)

**Goal:** Clear the remaining medium/low activation friction from the naive-agent probe.

### Deliverables
- Stop seeding the "My First Child" placeholder — prompt "Add your first child" instead; exclude
  placeholder profiles from story casts.
- Story-method chooser: hide model names from end users; "Recommended for first-timers" badge.
- Skip/confirm the redundant PIN prompt immediately after signup.
- Manual/probe smoke of the three already-merged high-severity fixes (End Tour, Play-as, Switch
  child) — the rollup notes this is still owed.

### Exit criteria
- A probe re-run hits none of the seven findings; no placeholder children appear in any story cast.

**Status:** PENDING

---

# Wave 2

## Sprint W2-A: Naive-Agent Probe, Productionised

**Track:** A capacity moves here post-W1; runs in the ops worktree
**Dev todos:** — (program item; consider filing one when started)
**Program ref:** rollup item 3 "Sprint 3B — Naive-agent probe (productionised)" (POC validated)
**Depends on:** W1-B (E2E infra), W1-C (so the probe measures a clean baseline)

**Goal:** A repeatable, mechanical UX probe that finds regressions before users do.

### Deliverables
- Expert baseline + mechanical personas with budgets; codable fix-records.
- PostHog concordance (synthetic probe vs real funnel) once analytics is flipped on.
- PM-readable report artifact per run; runnable on demand and on a schedule.

### Exit criteria
- One command produces a persona-run report; findings file as codable records; a deliberately
  reintroduced W1-C bug is caught.

**Status:** PENDING

---

## Sprint W2-B: First-Run Usability

**Track:** C — UX
**Dev todos:** `qP9EhmT6Y8PwwpYyl7k0` [GTM 4/8]
**Program ref:** docs/SPRINTS.md Sprint 4

**Goal:** A new family reaches a finished book unaided.

### Deliverables
- First-run detection + guided "create your first book" checklist (upload photo → create child →
  start story → generate art → preview); `onboardingState` per user.
- Auto-triggered in-context tips on first story creation and art generation (reuse help-wizard
  infra).
- Deepen empty states where the checklist reveals gaps; instrument time-to-first-book.

### Exit criteria
- Measurable lift in signup → story-completed vs baseline (PostHog once live; session-events
  otherwise); a fresh account reaches a finished book unaided.

**Status:** PENDING

---

## Sprint W2-C: Parent Storybook View & Ordering Flow

**Track:** C — UX (second worktree off `track/ux`, or sequential after W2-B — owner's call)
**Dev todos:** `Y8oQ7iqkdNFvbDzMeOS0` [print workflow], `IrcG2YBlJjxnRKaebTuh` [save address],
`WwE4eEEOHpVT5PGSIsA5` [incremental loading], **new: simplified parent view + per-page edit**
(file a devTodo when started)
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

### Exit criteria
- Parent and child book views share components; a parent can edit prompt/text and regenerate a
  single page without leaving the book; clean-up and ordering are distinct steps; a second order
  reuses a saved address; `/parent/storybooks` renders its list without waiting on images.

**Status:** PENDING

---

# Wave 3

## Sprint W3-A: Admin UX-Monitoring Dashboard + Mixam Webhook Automation

**Track:** B — Ops
**Dev todos:** `N0Bx3q1bFTXiw17og6hz` [GTM 7/8], `EzfeQDmgA3upALePJMFy` [Mixam webhooks]
**Program ref:** docs/SPRINTS.md Sprint 7

**Goal:** One page answers "where are users dropping off and what's broken now?", and Mixam
order progression drives admin state automatically.

### Deliverables
- Ops/KPI dashboard (`src/app/admin/ops/page.tsx`): DAU/MAU, funnel, print-order conversion,
  generation error rate — reading from PostHog's query API (cached), not collection-group scans.
- Health checks + alerts (art pending > N hours, orders un-reviewed > 24h, error-rate spikes) via
  `notifyMaintenanceError`.
- Failure reasons at a glance in print-order and sessions admin views.
- Mixam webhook automation: each webhook advances the admin order state / queues the next admin
  action — toward driving the full Mixam interaction from the StoryPic console.

### Exit criteria
- The drop-off/broken-now question is answerable from one page; alerts fire on synthetic stuck-job
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

### Exit criteria
- A release ships to a canary %, promotes, and rolls back — each without a rebuild; a flag
  disables a feature in production without a deploy.

**Status:** PENDING

---

## Sprint W3-C: Feedback & Conversion Polish

**Track:** C — UX
**Dev todos:** `bRfMxYLwnsTCExVYpcDA` [GTM 8/8]
**Program ref:** docs/SPRINTS.md Sprint 8

**Goal:** Satisfaction becomes a tracked metric and the marketing flywheel gets fed (Phase 1:
10+ testimonials, 4.5★).

### Deliverables
- Post-book / post-order rating + NPS prompt piped to analytics; `feedback` collection.
- Lightweight testimonial capture (consent + quote/photo).
- Order pipeline transparency: estimated turnaround/delivery, progress indicator, confirmation
  (builds on W2-C's simplified ordering flow).
- Issue-reports become tracked tickets with status visible to the user.

### Exit criteria
- NPS/satisfaction live on the W3-A dashboard; testimonials captured in-product; order status
  transparent to parents.

**Status:** PENDING

---

# Owner-Gated Sprints (scheduled when unblocked)

## Sprint WG-1: Take Money — Stripe Checkout + Hardened Webhook

**Dev todos:** `uRwu8VlWyyhqPgh51N7G` [GTM 2/8 — critical-path half], `0RewpFrqxoJtYnQLGw2f`
(umbrella: one-time purchases)
**Blocked by:** owner decision (Stripe deferred — docs/SPRINTS.md rollup item 9)

Stripe hosted Checkout + customer creation; webhook as source of truth (hard-fail on bad
signature, dedupe on `event.id`, reconciliation job — do **not** copy the Mixam bypass pattern);
replace the stub `pay` route; server-authoritative pricing; Stripe Tax/refunds/receipts;
rate-limiting; Playwright checkout smoke in test mode (extends W1-B's specs). Catalog and
admin products UI already exist.

**Status:** BLOCKED (owner)

## Sprint WG-2: Monetisation II — Subscriptions, Gifting, print_credit, Ledger Hardening

**Dev todos:** `SArzCSqBMJM2iDWYWPCX` [GTM 6/8], `Y4RIepF1595hCF4bOCJb` [ledger hardening],
remainder of `0RewpFrqxoJtYnQLGw2f` (free-tier boundary, token gifts)
**Blocked by:** WG-1

Recurring prices on the existing catalog; Stripe subscriptions + billing portal; lifecycle
webhooks + dunning; `print_credit` enforcement at print time (deferred until purchase grants
exist); ledger hardening — per_period rollover wired to renewal events, gift redemption resolving
the real target ledger, child-deletion cleanup hook; define the free-tier boundary.

**Status:** BLOCKED (WG-1)

---

## Todo-Resolution Bookkeeping (mark in admin UI)

| Dev todo | Disposition |
|----------|-------------|
| `q0wKiqL6Ur7o213Zeq0E` [GTM Plan v2] | **Resolved** — revisions already reconciled into `docs/SPRINTS.md`; this roadmap sequences them |
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

## Cross-Sprint Concerns

- **Docs discipline:** every sprint updates `docs/SCHEMA.md` / `docs/API.md` /
  `docs/SYSTEM_DESIGN.md` / `docs/CHANGES.md` and the `docs/SPRINTS.md` rollup before its wave
  merge.
- **Regression page:** API-touching sprints add cases to `src/app/admin/regression/page.tsx`.
- **Tests per sprint** (5-lens review): each sprint ships its own tests; W1-B's gate is not a
  substitute.
- **Server-first principle** throughout: filtering/sorting/computed fields in API routes, not
  clients (especially W2-C).
