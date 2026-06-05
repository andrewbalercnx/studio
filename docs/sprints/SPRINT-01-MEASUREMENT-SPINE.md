# Sprint 1 — Measurement Spine (Detailed Plan, v2)

> **Status**: Planned · **Priority**: High · **Effort**: ~2 weeks · **Depends on**: Secret rotation (pre-0)
> **Dev todo**: `[GTM Sprint 1/8]` (`nq1czfTGwg41IoyaF2L3`)
> **v2** incorporates the five-lens plan review (simplicity, testability, security, scalability, UX).

## 1. Objective

Make StoryPic's user experience observable end to end so every later sprint has a baseline and
Phase 1/2 KPIs become computable:

1. **Product analytics + funnel** — see where users drop off, including the *kids* surface (PostHog).
2. **Real-user monitoring (RUM)** — session replay + Web Vitals from real users (PostHog).
3. **Error tracking** — unhandled errors + caught exceptions (**PostHog Error Tracking**, not Sentry —
   see decision note below).
4. **Attribution** — UTM/referrer captured at sign-up for Phase-2 channel CAC.

> **Decision (2026-06-05):** Sentry has no usable free tier ($29/mo after a 14-day trial), so error
> tracking uses **PostHog Error Tracking** (`capture_exceptions` auto-capture + `captureException`).
> One vendor, one DPA, EU region already chosen. Fallback if Sentry-grade UX is ever needed:
> **GlitchTip** (Sentry-API-compatible, free self-host).

**Non-goals:** no in-app dashboards (Sprint 7 — use PostHog's UI now), no A/B experiments,
**no feature-flag plumbing** (add in one line when first needed), **no ad-blocker tunnel / source-map
upload** (fast-follow once real data-loss is observed).

## 2. Privacy, consent & compliance (must-read — this gates go-live)

This is a children's product (UK GDPR / ICO Children's Code). Engineering controls are necessary but
**not sufficient** — the legal/compliance layer must land before any tracking is enabled in prod.

**Engineering controls**
- **Identify on `uid` + role only.** Never send child names, photos, story text, or message content.
- **Mask by content, not just by route.** Child content renders on `/parent` and `/storybook` routes
  too, so route-based exclusion is insufficient. PostHog `maskAllInputs: true`, block media/photo
  nodes, and mask story-content DOM wherever it renders. Replay enabled only on parent/auth/checkout.
- **Kids surface:** no replay, no content — but DO emit privacy-safe structured telemetry (see §4.2).
- **Error tracking PII:** keep exception *messages* PII-free (the stack/message is sent as-is). Our
  `captureException` runs context props through the no-PII guard. Ensure `$current_url` / route
  segments (`/storybook/[bookId]`) carry only IDs, and the `idToken` query-param auth
  (`server-auth.ts extractQueryToken`) is never captured in URL logging.

**Compliance layer (new — required before enabling in prod)**
- Signed **DPA** with PostHog as sub-processor (single vendor now); update privacy policy + sub-processor list.
- **EU/UK data residency** — PostHog defaults to US cloud; select the **EU region** (or self-host).
- Documented **consent mechanism + lawful basis** before tracking. A **consent banner is a UX surface**
  that appears before sign-up and can depress the funnel — design its timing/copy/parent tone
  deliberately (do not bolt on). Decide: consent-gated analytics vs documented legitimate interest.
- **Retention limits** on replays/events; opt-out honouring DNT + kill-switch.

## 3. Architecture (simplified)

```
client React ──▶ src/lib/analytics (one module, sink injected) ──▶ PostHog (browser)
server (webhook/cron only) ──▶ trackServer() with explicit flush ──▶ PostHog (node)
exceptions ──▶ analytics.captureException + auto-capture ──▶ PostHog Error Tracking
```

Changes from v1, per review:
- **No Firestore dual-write.** PostHog is the analytics system of record. The existing
  `session-events*.ts` writes stay for the *narrow operational debug trail* they already serve;
  `track()` does **not** fan funnel events into Firestore (avoids write-amplification at scale).
- **Client-first emission.** For events the browser is present for, capture client-side (PostHog's
  own queue/retry is more reliable than a serverless function that may freeze before flush).
  Emit **server-side only** for events with no browser (e.g. Stripe webhook `print_order.paid` in
  Sprint 3), and then **`await posthog.flush()`** explicitly.
- **One module, sink injected (DI).** `src/lib/analytics/` exposes `track`, `identify`, `init`. The
  PostHog client is injected so tests assert payloads against a fake sink. No three-file split, no
  full discriminated union — a `const EVENTS = {...} as const` registry gives drift protection.
- `autocapture: false` (rely on the explicit taxonomy; keeps event volume/cost predictable).

## 4. Event taxonomy (single source of truth in `src/lib/analytics/events.ts`)

### 4.1 Funnel + failure/abandonment (parent/web)

| Event | Fired where | Key props (no PII) |
|-------|-------------|--------------------|
| `signup.completed` | `src/app/signup/page.tsx` | `method`, utm fields |
| `login.completed` | `src/app/login/page.tsx` | `method` |
| `child.created` | `src/app/parent/children/page.tsx`, `src/app/kids/setup/page.tsx` | `childCount` |
| `story.started` | story session create | `storyTypeId`, `sessionId` |
| `story.abandoned` | session inactive / left mid-creation | `sessionId`, `lastBeatIndex` |
| `story.completed` | `/api/storyCompile` | `sessionId`, `beats` |
| `storybook.generation_started` | `/api/storybookV2/pages` | `storybookId` |
| `generation.failed` | via `ai-flow-logger` failure path | `flow`, `reason` (sanitised) |
| `generation.retry_attempted` / `generation.retry_succeeded` | Sprint 2 retry path (wire event now) | `flow`, `attempt` |
| `generation.fell_back_partial` | graceful-degradation path (Sprint 2) | `storybookId` |
| `storybook.art_ready` | image gen finalize | `storybookId`, `pageCount` |
| `checkout.started` / `checkout.abandoned` | order/checkout flow (Stripe lands Sprint 3) | `orderId`, `value` |
| `print_order.placed` | `/api/printOrders` | `orderId`, `value`, `currency` |
| `print_order.paid` | Stripe webhook (Sprint 3) — emit server-side + flush | `orderId`, `value`, `currency` |

### 4.2 Kids telemetry (privacy-safe — no content, no PII)

The kids flow is otherwise a monitoring blind spot. Emit structured, content-free events:
`kids.step_viewed`, `kids.answer_selected` (choice index only), `kids.beat_progressed`,
`kids.stuck` (dwell > threshold), `kids.abandoned`, plus a `generation.duration` distribution.

### 4.3 North-star

**`time_to_first_book`** = `signup.completed` → `storybook.art_ready`. Surface as a PostHog insight in
Sprint 1 (derivable from the taxonomy) so Sprints 4/5 have an honest before/after.

> Wire the Stripe/retry/fallback events **now** even though they only fire once Sprints 2–3 ship — the
> funnel is then complete on day one of those sprints.

## 5. Work breakdown

**5.1 Deps & config** — `posthog-js`, `@sentry/nextjs` (+ `posthog-node` only for the webhook path).
Env in `apphosting.yaml` + `.env.local`: `NEXT_PUBLIC_POSTHOG_KEY`, `NEXT_PUBLIC_POSTHOG_HOST`
(**EU host**), `NEXT_PUBLIC_SENTRY_DSN`, `SENTRY_AUTH_TOKEN`. Kill-switch: a single
`systemConfig/diagnostics.enableAnalytics` toggle (the established runtime-config pattern,
`use-diagnostics.tsx`); env var only as a build/dev opt-out, with precedence documented.

**5.2 Analytics module** (`src/lib/analytics/`) — `events.ts` (`EVENTS` registry + loose props type
with a compile-time/test-time no-PII guard), `index.ts` (`init`, `identify`, `track`; respects DNT +
toggle; PostHog `autocapture:false`, EU host, content masking). Optional `trackServer` (webhook only,
explicit flush).

**5.3 Provider** — `PostHogProvider` inside `src/app/providers.tsx` above `AppContextProvider`;
identify on Firebase auth-state change (uid + role only); reset on `logout`.

**5.4 Error tracking (PostHog)** — `capture_exceptions` in `posthog-sink.ts` (unhandled errors +
rejections auto-captured) and a gated `captureException()` in the core for caught errors;
`global-error.tsx` + per-section boundaries (`/parent`, `/kids`, `/storybook`, `/admin`) that report
via `captureException`. Replay sampled and masked. (Status: sink + core done; boundaries pending.)

**5.5 Instrumentation** — wire §4 events (client-first; server+flush for webhook-only). Hook
`generation.failed` into the **existing `ai-flow-logger`** seam, not scattered `track()` calls.

**5.6 Attribution** — capture `utm_*` + referrer into a first-party cookie on first landing; attach to
`signup.completed` + person properties.

**5.7 Existing-collection hygiene** — add a **Firestore TTL (30–90d)** on `storySessions/{id}/events`
(currently unbounded, no TTL) while we're here; add `expireAt` on write.

## 6. Files

**New:** `src/lib/analytics/{events.ts,index.ts}` (+ `analytics.server.ts` only if webhook path needed
this sprint), `src/components/analytics/posthog-provider.tsx`, `sentry.{client,server,edge}.config.ts`,
`instrumentation-client.ts`, `src/app/global-error.tsx`, `src/lib/analytics/__tests__/*`.
**Changed:** `src/app/providers.tsx`, `src/instrumentation.ts`, `signup/login/logout` pages, funnel
touchpoints (parent/kids pages, `/api/storyCompile`, `/api/storybookV2/{pages,images}`,
`/api/printOrders/route.ts`, `src/lib/ai-flow-logger.ts`), `apphosting.yaml`, `package.json`,
`firestore` TTL config.

## 7. Tests / Definition of Done (automated where possible)

**Automated (CI — extends the existing `.github/workflows/ci.yml` vitest gate):**
- [ ] **No-PII contract test** — fails if a name/photo/story-text-shaped prop is passed to `track()`.
      (Highest-stakes property in a kids product; must not be a manual check.)
- [ ] Kill-switch test — `enableAnalytics=false` / DNT → **zero** calls to the injected sink.
- [ ] Taxonomy type-safety test — unknown event name or bad prop shape fails to compile/validate.
- [ ] `identify` sends only `uid` + role; `trackServer` calls `flush()` on every path.

**Manual (genuinely not automatable):**
- [ ] Replay masking verified on a full parent+checkout session (inputs/media/story content masked).
- [ ] A thrown client error and a thrown server error both land in PostHog Error Tracking.
- [ ] PostHog **funnel insight** + **time-to-first-book** insight built from §4 events.
- [ ] EU data residency confirmed in PostHog project settings; DPAs signed.

**Gate:** `npm run typecheck` + `npm run test` pass.

## 8. Docs to update on completion (per CLAUDE.md)

`SYSTEM_DESIGN.md` (new "Product Analytics & Monitoring" section + update Monitoring & Diagnostics),
`SCHEMA.md` (`diagnostics.enableAnalytics`, events `expireAt`/TTL), `API.md` (attribution),
`CHANGES.md` (on push), regression tests (analytics no-op-when-disabled + no-PII smoke).

## 9. Risks & mitigations

| Risk | Mitigation |
|------|-----------|
| Child PII capture | Content-based masking, identify policy, automated no-PII test (§7) |
| Serverless event loss | Client-first emission; webhook path uses explicit `flush()` |
| Firestore write-amplification | No dual-write; PostHog is system of record; TTL on events |
| Consent banner depresses funnel | Treat as designed UX; measure top-of-funnel impact |
| Non-compliance (kids data) | DPA + EU residency + retention + lawful basis before go-live |
| Vendor lock-in | All calls go through `src/lib/analytics/` — one seam |

## 10. Sequencing within the sprint

1. Days 1–2: deps, EU config, analytics module + DI + no-PII test + kill-switch.
2. Days 3–4: PostHog provider + identify + Web Vitals + content masking + replay.
3. Days 5–6: PostHog error tracking (`capture_exceptions`) + error boundaries + PII-safe scrubbing.
4. Days 7–8: wire §4 events (incl. kids telemetry) + attribution + events TTL.
5. Days 9–10: funnel + time-to-first-book insights, consent/compliance sign-off, DoD.
