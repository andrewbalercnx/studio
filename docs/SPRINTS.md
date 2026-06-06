# Go-to-Market Sprint Program

> **Last Updated**: 2026-06-06
>
> This document defines the engineering program that closes the go-to-market (GTM) functionality
> gaps identified against `docs/SALES_MARKETING.md`. It focuses on the two areas that block GTM
> today: **usability** (can a stranger get from sign-up to a finished, paid-for book?) and
> **monitoring of user experience** (can we see the funnel, failures, and satisfaction?), plus the
> two hard blockers surfaced during planning: **monetisation** (we cannot take money today) and a
> **UX testing framework** (we have almost no automated browser coverage).
>
> Each sprint is also tracked as a `[GTM Sprint N/8]` item in the Development Todo List
> (Admin → Development).

---

## Program status (single source of truth — update on every change)

> This is the authoritative done/outstanding rollup so it survives context resets. As of **2026-06-06**.

### Done
- **Sprint 1 — Measurement spine** (`[GTM 1/8]`): engineering complete, **shipped disabled-by-default**.
  PostHog (EU) analytics + RUM + Error Tracking; vendor-agnostic core with no-PII guard, kill-switch,
  consent gating, pre-init buffer; funnel events; admin toggle. *Not yet live* — see compliance gate.
- **Commercial catalog** (Monetisation I-b, payment-agnostic): `products`/`prices` model + entitlement
  components + admin `/admin/products` + APIs.
- **3 high-severity usability fixes** (probe findings): End-Tour→home, "Play as child" button, "Switch
  child" nav. *Merged; needs a manual/probe smoke post-deploy.*
- **Sprint 3A foundation (partial)**: emulator-aware Firebase config (env-gated, default unchanged) +
  Playwright scaffold + one smoke spec + report-only CI `e2e` job + `TEST_MODE` AI seam (deterministic
  fixtures, default off). *Remaining: the actual funnel E2E specs + a11y/Lighthouse/visual.*
- **Generation reliability (slice)**: retry+jitter util, error classifier, circuit-breaker scaffold,
  raw→user-safe error mapping (storybookV2 routes no longer leak raw errors). *Remaining: graceful
  degradation UI, kid-safe states, broader flow adoption, systemConfig-backed breaker.*
- **Entitlement ledger model**: `entitlementLedgers` collection + grant/check/consume (scope-resolved)
  + server reader + free-tier + rules + tests.
- **Entitlement enforcement (story + storybook)**: transaction-wrapped `consumeEntitlement` +
  read-only `checkEntitlement` server helpers. `story_allowance` is enforced at the shared
  **completion chokepoint** `POST /api/storyCompile` (covers kids + all parent flows): pre-flight
  `402` block at the limit, plus **consume-on-completion** (idempotent via `storyAllowanceConsumed`,
  so abandoned creates never charge). `kids/create` also calls the non-consuming
  `POST /api/entitlements/check` at start for an early friendly block. `storybook_allowance` gated
  inside `POST /api/storybookV2/create`. Free-tier seeded on first use. *Remaining: `print_credit`
  at print time — deliberately deferred until purchase grants exist (no grant path today; enforcing
  now would block all orders).*

### Outstanding (recommended order)
1. **Wire entitlement enforcement** — *story + storybook done, incl. parent flows + consume-on-completion*
   (see Done). Remaining: `print_credit` at print time, deferred until purchase grants exist.
2. **Sprint 3A E2E specs**: build the deterministic funnel specs on emulator + `TEST_MODE`; add
   a11y/Lighthouse/visual (report-only). Promote happy-path to blocking after it's green.
3. **Sprint 3B — Naive-agent probe (productionised)** (`[GTM 3/8]`): expert baseline, mechanical
   personas, codable fix-records, PostHog concordance, PM report. *POC validated.*
4. **Generation reliability — finish**: graceful degradation + kid-safe error/empty states; migrate
   remaining flow retry loops onto the shared util.
5. **First-run usability** (`[GTM 4/8]`): onboarding + empty states + the medium/low probe findings.
6. **Monetisation II** (`[GTM 6/8]`): subscriptions (recurring prices) + gifting redemption; uses the ledger.
7. **Admin UX-monitoring dashboard** (`[GTM 7/8]`): KPIs/funnel from PostHog + stuck-job/health alerts.
8. **Feedback & conversion polish** (`[GTM 8/8]`): NPS/ratings, testimonials, order transparency, tickets.
9. **Monetisation I — payments/Stripe** (`[GTM 2/8]`): **deferred by owner**.

### Open non-sprint gates / follow-ups
- **Sprint 1 compliance gate (to flip analytics ON)**: set PostHog retention; add EU sub-processor list
  to privacy policy; consent-basis sign-off. *(Owner/legal.)*
- **Catalog rules deploy**: `firebase deploy --only firestore:rules` (products/prices rules not yet deployed).
- **Secret remediation tail** (non-blocking, secrets already dead): optional git-history scrub;
  `crypto.timingSafeEqual`; ADC/workload-identity migration. See `docs/SECURITY_REMEDIATION.md` + memory.
- **Firestore TTL on `events`**: ✅ enabled (2026-06-05).

---

## Why this program exists

`SALES_MARKETING.md` is the demand plan (ads, influencers, PR). It assumes the product can (a)
measure a funnel, (b) take payment, and (c) reliably convert a stranger into a finished book.
Today it can do none of these robustly:

- **No product analytics** — funnel, conversion, and CAC are unmeasurable.
- **No payment** — `printOrders/[orderId]/pay` is a stub that just flips `paymentStatus` to `paid`.
- **No subscriptions** — the recurring-revenue plan (Phase 3) is greenfield.
- **Raw generation failures** — image/audio/PDF errors surface raw API strings with no auto-retry.
- **Minimal onboarding** — help is optional and buried; new users can stall before a first book.
- **Thin UX test safety net** — there *is* a CI gate (`.github/workflows/ci.yml`: typecheck + vitest)
  and a daily live `system-test` endpoint, but only ~5 pure-function unit tests, an in-app *manual*
  admin regression page, **no E2E**, and **`firestore.rules` is untested**.
- **No production error tracking** — the code comments "you would log this to Sentry" but doesn't
  (now addressed via PostHog Error Tracking — see Sprint 1).

> **Pre-0 (blocker, outside the sprints):** the security review found a **live Firebase Admin private
> key (`serviceAccount.json`) and the `INTERNAL_API_SECRET` committed to the repo and git history**.
> These must be rotated and purged before launch — see [`docs/SECURITY_REMEDIATION.md`](./SECURITY_REMEDIATION.md).

## Program at a glance (revised post-review)

The five-lens review re-sequenced the program to put the user's ability to *succeed* (generation
reliability, a thin onboarding slice) ahead of optimisation, and split the heavy monetisation sprint.
Execution order:

| Exec | Sprint | Pillar | Priority | Effort | Depends on |
|------|--------|--------|----------|--------|-----------|
| Pre-0 | **Secret rotation & history scrub** | Security | Critical | ~0.5 wk | — |
| 1 | Measurement spine *(+ thin onboarding slice: empty states)* | Monitoring | High | ~2 wk | Pre-0 |
| 2 | Generation reliability *(moved up)* | Usability | High | ~2 wk | 1 |
| 3 | Monetisation I-a — **take money** (Stripe Checkout + hardened webhook + replace stub) | Monetisation | High | ~2 wk | 1 |
| 4 | UX testing framework *(broadens the safety net)* | Testing | High | ~2 wk | 3 |
| 5 | First-run usability (full onboarding) | Usability | Medium | ~2 wk | 1, 4 |
| 6 | Monetisation I-b + II — catalog + subscriptions + entitlements | Monetisation | Medium | ~2 wk | 3 |
| 7 | Admin UX-monitoring dashboard *(reads from PostHog)* | Monitoring | Medium | ~2 wk | 1, 2 |
| 8 | Feedback & conversion polish | Monitoring/Usability | Medium | ~2 wk | 1, 7 |

> The detailed sprint write-ups below retain their original pillar numbering; the table above is the
> **execution order**. The `[GTM Sprint N/8]` dev-todos are being reconciled to this order (see the
> `[GTM Plan v2]` todo).

**Critical path to "can launch and take money":** Pre-0 → 1 → 2 → 3 (~6.5 weeks). Testing (4) is
seeded *inside* sprints 2–3 (webhook + checkout tests) and broadened in its own sprint.

**Decisions locked:** Analytics/RUM = **PostHog** (EU region); payments = **Stripe** (hosted
Checkout); browser tests = **Playwright**.

## Cross-cutting changes from the review (apply to all sprints)

- **No Firestore dual-write of analytics** — PostHog is the system of record; the existing
  `session-events` writes stay only as a narrow operational debug trail.
- **Test per sprint, not just in the testing sprint** — webhook signature/idempotency/atomicity tests
  + a Playwright checkout smoke land *with* the monetisation work; `firestore.rules` emulator tests are
  shared infra; every sprint gets a **Tests/DoD** subsection; extend the existing CI rather than
  re-create it.
- **Compliance scaffolding (kids product)** — signed DPA (PostHog), EU/UK data residency,
  consent banner + lawful basis, retention limits, **content-based** (not just route-based) masking.
- **Stripe webhook must not inherit the Mixam bypass pattern** — hard-fail on bad signature, idempotent
  dedupe on `event.id`, reconciliation job; server-authoritative pricing; hosted Checkout (SAQ-A).
- **Bound new data** — Firestore TTL on the events subcollection; composite index definitions shipped
  with every new collection (`events`/`feedback`/`products`/`prices`).
- **Dashboards read from PostHog** (query API, cached), not Firestore collection-group scans.

---

## Sprint 1 — Measurement spine

**Goal:** Make the funnel, errors, and real-user experience observable end to end.

**GTM rationale:** Every downstream sprint needs a baseline to prove it worked, and Phase 1/2 KPIs
(conversion rate, CAC, drop-off) cannot be computed without instrumentation.

**Scope / deliverables**
- PostHog (product analytics + session replay + Web Vitals/RUM + **error tracking** + feature flags)
  — a **single observability vendor**, EU region.
- A typed, canonical funnel event taxonomy emitted through one vendor-agnostic module.
- UTM/referrer attribution captured on sign-up.

> **Decision (2026-06-05):** error tracking uses **PostHog Error Tracking** (`capture_exceptions` +
> `captureException`), not Sentry — Sentry has no usable free tier ($29/mo after a 14-day trial).
> This consolidates analytics + RUM + errors into one vendor/DPA, which the scalability and
> simplicity reviews both favoured. GlitchTip (Sentry-API-compatible, free self-host) is the
> fallback if Sentry-grade error UX is ever needed.

**Technical approach**
- A vendor-agnostic `src/lib/analytics/` core (`track`/`identify`/`captureException`) with the
  PostHog SDK isolated in `posthog-sink.ts` behind an injected sink — so the privacy rules (no-PII
  guard, kill-switch, identify-on-uid-only) are independent of the vendor.
- `PostHogAnalyticsProvider` in `src/app/providers.tsx`, mounted inside `DiagnosticsProvider`
  (reads the `enableAnalytics` toggle) and `FirebaseClientProvider` (auth). PostHog only initialises
  when enabled, so nothing loads/sends while dark.
- Identify users on auth state change (uid + role, never child PII).

**New / changed**
- New: `src/lib/analytics/{events,index,posthog-sink}.ts`, `src/components/analytics/posthog-provider.tsx`.
- Changed: `src/app/providers.tsx`, `apphosting.yaml` (PostHog env), `tsconfig.json` (exclude stray
  `studio/`), `src/lib/types.ts` (`enableAnalytics` toggle), `src/app/signup/page.tsx` (attribution).
- Docs: SYSTEM_DESIGN (new "Product Analytics & Monitoring" section).

**Dependencies:** none. **Exit criteria:** a funnel chart with drop-off %, PostHog receiving errors
+ exceptions, Web Vitals on real sessions, attribution on new sign-ups.

> Detailed implementation plan: [`docs/sprints/SPRINT-01-MEASUREMENT-SPINE.md`](./sprints/SPRINT-01-MEASUREMENT-SPINE.md)

---

## Sprint 2 — Monetisation I: payments + product/price catalog (one-time)

**Goal:** Take real card payment for a printed book and build the catalog model once, correctly.

**GTM rationale:** Hard blocker. Phase 1's "50–100 paying customers / £2–5K revenue" is impossible
while `pay` is a stub.

> **Split per review (this is two sprints' work):** **2a — "take money"** (Stripe hosted Checkout +
> hardened webhook + replace the stub `pay` route) is on the critical path. **2b — "full catalog"**
> (the `products`/`prices` model + admin pricing UI + tax/refunds) floats to just before Sprint 6,
> its first real consumer (recurring prices). The webhook must **not** copy the Mixam handler's
> signature-bypass — hard-fail on bad/missing signature, dedupe on Stripe `event.id`, and add a
> reconciliation job. Pricing is **server-authoritative** (client never sends amount). **Tests/DoD:**
> webhook signature (valid passes / tampered 400s), idempotency (duplicate event → one update),
> atomic order/payment write, Playwright happy-path checkout smoke in Stripe test mode. Sprint 2's DoD
> also includes minimum **post-payment transparency** (confirmation + turnaround/status) and
> rate-limiting on checkout/pay.

**Scope / deliverables**
- Unified `products` + `prices` Firestore collections mirroring Stripe's model
  (`price.type = 'one_time' | 'recurring'`) so subscriptions (Sprint 6) reuse it.
- Admin pricing UI to create/edit products and prices.
- Stripe Checkout/Elements + customer creation + **webhooks as the source of truth** for
  `paymentStatus`.
- Replace the stub pay route → real payment → existing `printOrders` fulfilment flow.
- Stripe Tax/VAT, refunds, receipts.

**Technical approach**
- Model the print catalog (`PrintProduct`, `types.ts:717`) into the new `products`/`prices` shape;
  keep `productSnapshot` on the order for an immutable record.
- New `src/app/api/webhooks/stripe/route.ts` mirroring the structure of the Mixam webhook
  (`src/app/api/webhooks/mixam/route.ts`); verify signature, update order/payment atomically.
- Checkout initiated from `src/components/storybook/print-order-dialog.tsx` /
  `src/app/storybook/[bookId]/order/page.tsx`.

**New / changed**
- New: `src/app/api/webhooks/stripe/route.ts`, `src/app/api/checkout/route.ts`,
  `src/app/admin/pricing/page.tsx`, Stripe server lib.
- Changed: `src/app/api/printOrders/[orderId]/pay/route.ts` (replace stub),
  `src/lib/types.ts` (Product/Price types), `firestore.rules`.
- Docs: SCHEMA (products/prices), API (checkout + webhook), SYSTEM_DESIGN (payment is currently
  "Future integration point"), regression tests.

**Dependencies:** 1. **Exit criteria:** a parent pays by card; webhook confirms; order proceeds to
admin/Mixam fulfilment; conversion event fires.

---

## Sprint 3 — UX testing framework

**Goal:** An automated, CI-enforced safety net that exercises real UX, not just units.

**GTM rationale:** Stand up after checkout exists so it guards the money path and the usability
sprints that follow; provides the "synthetic" half of UX monitoring.

**Scope / deliverables**
- Playwright E2E of the critical funnel: sign-up → story creation → storybook generation →
  checkout/pay (Stripe test mode).
- axe-core accessibility assertions on key pages.
- Lighthouse CI with Core Web Vitals budgets.
- Visual regression snapshots for key surfaces.
- Wire into the GitHub Actions workflow as a merge gate; add a `test:e2e` script.
- Pair with the real-user half: PostHog session replay (from Sprint 1).

**Technical approach**
- Playwright projects for desktop + mobile viewports; seed a disposable test account; use Stripe
  test cards. Reuse the cleanup pattern from `scripts/cleanup-regression-data.mjs`.
- Keep flaky AI-generation steps behind deterministic fixtures/mocks where needed.

**New / changed**
- New: `playwright.config.ts`, `e2e/` specs, Lighthouse config, CI job.
- Changed: `package.json` (scripts), `.github/` workflow.
- Docs: testing docs under `docs/testing/`.

**Dependencies:** 2. **Exit criteria:** CI fails on broken funnel, a11y regressions, or
perf-budget breaches; team can watch real session replays.

---

## Sprint 4 — First-run usability

**Goal:** A new parent reaches a finished book unaided.

**GTM rationale:** The biggest Phase-1 risk is friends-and-family users stalling before the "wow".

**Scope / deliverables**
- First-run detection + a guided "create your first book" checklist (upload photo → create child →
  start story → generate art → preview).
- Strong empty states on child/character/storybook lists that point to the next action.
- Auto-triggered in-context tips on first use of story creation and art generation (reuse the
  existing help-wizard infra rather than building anew).
- Instrument time-to-first-book.

**Technical approach**
- Reuse `src/components/help-wizard.tsx`, `startup-wizard-trigger.tsx`, and
  `wizard-target-overlay.tsx`; add a `onboardingState` per user (steps completed) in Firestore.

**New / changed**
- Changed: provider/wizard components, parent/kids list pages, `src/app/signup/page.tsx`.
- New: onboarding checklist component + `onboardingState` field.
- Docs: SCHEMA (onboardingState), SYSTEM_DESIGN (onboarding).

**Dependencies:** 1, 3. **Exit criteria:** measurable lift in sign-up → story-completed vs the
Sprint-1 baseline; a new user reaches a finished book without external help.

---

## Sprint 5 — Generation reliability

**Goal:** The magic moment survives transient failure and never shows a raw error.

**GTM rationale:** Generation failure is fatal for word-of-mouth and paid traffic.

**Scope / deliverables**
- Auto-retry with **exponential backoff + jitter** and a **low cap (2–3)**, only for *classified
  transient* errors (5xx/timeout), never for 4xx/quota.
- A **circuit breaker** (keyed in `systemConfig` / per-provider counter) that trips on a sustained
  error rate and fast-fails to graceful degradation instead of retrying — prevents a provider outage
  becoming a self-inflicted retry storm that burns AI tokens.
- User-friendly error messaging + one-tap inline "Try again" (no back-navigation). On `/kids/*`,
  **age-appropriate, possibly non-textual** error/empty/loading states (mascot/icon/audio).
- **Perceived-latency** work: progress + reassurance UI during slow generation (instrument
  `generation.duration` in Sprint 1).
- Graceful degradation: allow viewing/ordering a text + partial-art book instead of a dead Error badge.
- Notify the user when a previously failed generation recovers.

**Technical approach**
- **Consolidate** the retry/backoff logic already scattered across the flows (don't build a parallel
  mechanism); reuse the existing `ai-flow-logger` seam (it already captures `failureReason` and calls
  `notifyMaintenanceError`). Map raw errors to a small set of user-safe messages via an exhaustive,
  unit-tested table (no raw API string ever leaks). For long generations, note a durable queue
  (Cloud Tasks) as the at-scale follow-up.

**Tests/DoD:** backoff-schedule test, transient-retried/permanent-not-retried test, circuit-breaker
trip/reset test, and an exhaustive error-mapping table test.

**New / changed**
- Changed: AI flows, `src/app/storybook/[bookId]/page.tsx`, status components,
  `src/lib/ai-flow-logger.ts`.
- Docs: SYSTEM_DESIGN (error handling), API if endpoints change.

**Dependencies:** 1, 3. **Exit criteria:** no user-facing raw API errors; failure rate visible;
transient failures self-heal.

---

## Sprint 6 — Monetisation II: subscriptions

**Goal:** Recurring revenue ("Story of the Month") with self-serve billing.

**GTM rationale:** Phase 3 target of ~£60K/yr from subscriptions; reuses the Sprint-2 catalog.

**Scope / deliverables**
- Recurring prices in the catalog + subscription plan management in the admin pricing UI.
- Stripe subscriptions + customer billing portal (self-serve upgrade/cancel).
- Entitlements model: a subscription grants N books/month or unlocks premium features; enforced in
  Firestore rules + API.
- Subscription lifecycle webhooks (created/updated/cancelled/past_due) + dunning.

**New / changed**
- New: entitlements model + enforcement, billing portal entry point.
- Changed: `src/app/admin/pricing/page.tsx`, `src/app/api/webhooks/stripe/route.ts`,
  `firestore.rules`, `src/lib/types.ts`.
- Docs: SCHEMA, API, SYSTEM_DESIGN.

**Dependencies:** 2. **Exit criteria:** a parent subscribes, receives entitlements, and manages
billing via the portal; lifecycle events update Firestore via webhook.

---

## Sprint 7 — Admin UX-monitoring dashboard

**Goal:** One page that answers "where are users dropping off, and what's broken now?"

**GTM rationale:** 44 admin config pages exist but none show user health; needed to optimise
channels (Phase 2) and run ops at scale.

**Scope / deliverables**
- Ops/KPI dashboard: DAU/MAU, the Sprint-1 funnel, print-order conversion, generation error rate.
- Health checks + alerts: art pending > N hours, orders un-reviewed > 24h, error-rate spikes →
  notify maintenance (reuse `notifyMaintenanceError`).
- Surface failure reasons at a glance in print-order and sessions admin views.

**New / changed**
- New: `src/app/admin/ops/page.tsx`, health-check job(s).
- Changed: `src/app/admin/sessions/page.tsx`, `src/app/admin/print-orders/page.tsx`,
  `src/app/admin/page.tsx`.
- Docs: SYSTEM_DESIGN (monitoring), API.

**Dependencies:** 1, 5. **Exit criteria:** an admin answers the health question from one page; alerts
fire on the defined thresholds.

---

## Sprint 8 — Feedback & conversion polish

**Goal:** Close the loop — satisfaction becomes a tracked metric and testimonials are captured.

**GTM rationale:** Phase 1 targets 10+ testimonials and 4.5★ satisfaction; today there is only an
email-only, untracked issue-report button.

**Scope / deliverables**
- Post-book / post-order rating + NPS prompt piped to analytics.
- Lightweight testimonial capture (consent + quote/photo) feeding the marketing flywheel.
- Order pipeline transparency: estimated turnaround/delivery, progress indicator, confirmation.
- Turn issue-reports into tracked tickets with status back to the user.

**New / changed**
- Changed: `src/components/report-issue-button.tsx`, `src/app/api/report-issue/route.ts`,
  `src/app/parent/orders/page.tsx`, order pages.
- New: NPS/rating component + `feedback` collection, testimonial capture.
- Docs: SCHEMA, API, SYSTEM_DESIGN.

**Dependencies:** 1, 7. **Exit criteria:** NPS/satisfaction is live; testimonials captured
in-product; order status is transparent to parents.

---

## Cross-cutting rules (per `CLAUDE.md`)

Every sprint that touches schema/API/architecture must update `docs/SCHEMA.md`, `docs/API.md`,
`docs/SYSTEM_DESIGN.md`, add regression tests, and append to `docs/CHANGES.md` on push. From
Sprint 3 onward, new flows should also ship Playwright coverage.
