# Sprint 3 — End-to-End UX Testing Framework (Plan v2)

> **Status**: Planned · **Priority**: High · **Dev todo**: `[GTM Sprint 3/8]` (`LwQBiYIctkd7CJe1Svnl`)
> **v2** incorporates a five-lens plan review + a validated proof-of-concept of the naive-agent probe.
> **Tooling locked**: Playwright; **test env**: Firebase Emulator Suite + a `TEST_MODE` AI seam.
> **Split**: this is now **two sprints — 3A (foundation + deterministic E2E)** and **3B (naive-agent
> usability probe)**. 3B depends on 3A's stable target.

## 0. What we learned before planning (the review + POC)

Five review agents validated the two-pillar strategy but found two foundations missing and the probe
needing rigour. A **POC has since proven the probe works** (see `docs/usability/UX-PROBE-FINDINGS-2026-06-05.md`):
- A knowledge-isolated agent perceiving only the accessibility tree + screenshots drove the **live**
  app end-to-end and surfaced real, codable friction (e.g. "End Tour → /signup", no "play as child"
  control). Driver: `tools/probe/server.mjs`.
- Confirmed the validity caveat live: the agent **persisted** through a dead-end a real impatient user
  would abandon on → we must flag "succeeded-but-struggled", not just failures.

Key foundation facts that shape 3A:
- Firebase client config is **hardcoded** to prod; **no staging, no preview, no emulator wiring**.
- Generation runs **server-side** (`/api/storybookV2/*` → Genkit/Gemini/ElevenLabs/fal), driven by
  Firestore `status` doc listeners on the client. So determinism requires a **server-side mock seam**,
  not client `route()` interception alone.
- `cleanup-regression-data.mjs` does not delete **Auth users** or `users`/`stories` — the funnel
  creates all three.

---

# Sprint 3A — Test Foundation & Deterministic E2E

**Goal:** a deterministic, CI-enforced regression net for the critical funnel.

## A1. Foundation (the load-bearing, build-it-first work)
- **Emulator-aware Firebase config**: add env-gated `connectAuthEmulator` / `connectFirestoreEmulator`
  / `connectStorageEmulator` and an env-driven `projectId` (no more hardcode). Target the **Firebase
  Emulator Suite** (Auth + Firestore + Storage — all covered, free, ephemeral) in CI.
- **`TEST_MODE` AI seam**: an env flag that short-circuits the generation flows
  (`src/ai/flows/*`, the `/api/storybookV2/*` routes) to **fixtures**, advancing `pageGeneration` /
  `imageGeneration` / `audioGeneration` `status` quickly. This is the only way to test the
  `idle→running→ready` state machine deterministically; the emulator cannot run Gemini/ElevenLabs/fal.
- **Seed fixtures** via emulator import/export for repeatable starting state.

## A2. Playwright harness
- `playwright.config.ts` — projects: `desktop-chrome`, `mobile-chrome`; **`webkit` (report-only)** for
  the Safari autoplay class that dominates recent bug history. Traces/screenshots/video on failure.
- `test:e2e` + `test:e2e:ui` scripts. Web-first assertions on **user-visible state** (progress text,
  "Go to My Books" button, post-redirect URL) — **no `waitForTimeout`** (ban in review/lint).

## A3. Deterministic coverage
Funnel happy-path **plus** the high-risk surfaces the review flagged:
1. Signup → default child → land in app.
2. Start a story (a generator) → progress beats → story completes.
3. Storybook: output type + style → generation (TEST_MODE) → art-ready → view.
4. **Audio/TTS narration** loads and plays (mock the TTS call).
5. **Generation failure / retry** path (the likeliest real abandonment point).
6. Parent: add a child; lists render; **PIN child-lock** set → lock → unlock challenge.
7. Admin: `/admin/products` loads + create a product (guards the new catalog).
8. **WebKit (report-only):** avatar/audio autoplay smoke.

## A4. Accessibility / performance / visual
- **axe-core** on key pages; for `/kids/*` add explicit checks: touch-target size, audio-not-sole-cue,
  reduced-motion (answer-exit animations).
- **Lighthouse CI** with Core Web Vitals budgets.
- **Visual regression** with dynamic regions **masked from day one** (the `picsum.photos` seed avatars
  are non-deterministic and will otherwise be pure noise).
- **Firestore rules tests** via `@firebase/rules-unit-testing` against the emulator (currently untested;
  near-free once the emulator path exists).

## A5. CI gating (avoid the flaky-gate trap)
- **Separate `e2e` CI job** (own runner; cache Playwright browsers + Next build; boot emulator).
- **Blocking on PR (day one):** funnel happy-path only.
- **Report-only initially:** axe, Lighthouse, visual — with an **explicit promotion criterion**
  (blocking after N green runs / <X% flake over 2 weeks). "Initially" must not mean "forever".
- **Nightly only:** one quarantined real-generation smoke (no mock), never on the PR path. Log any
  coverage caps so silent truncation isn't read as full coverage.
- Per-worker unique account prefixes for safe sharding.

## A6. Test data & cleanup
- Emulator is ephemeral → most cleanup is moot. For any non-emulator run: stamp `regressionTest:true`
  on **every** funnel write and **extend `cleanup-regression-data.mjs` to delete Auth users + `users`
  + `stories`** (it currently misses all three). A targeted account-cleanup script already exists
  (`tools/probe/cleanup-probe-account.mjs`) as a starting point.

## 3A exit criteria
CI fails on a broken funnel happy-path (TEST_MODE, emulator); a11y/Lighthouse/visual visible on PRs
with a promotion path; rules tested; WebKit autoplay smoke running report-only.

---

# Sprint 3B — Naive-Agent Usability Probe

**Goal:** exploratory discovery of where a first-time user gets stuck — feeding the first-run-usability
sprint (exec-order Sprint 5). **POC validated; this productionises it with rigour.**

## B1. Knowledge isolation (validated approach)
- Agent receives **only**: one objective (user language), the entry URL + test creds (or "sign up"), a
  persona, and the documentation schema. **No** source, docs, route/component names, or test-ids.
- Perception is the **accessibility tree + screenshot only**, via a **custom constrained tool** —
  **not** an off-the-shelf MCP (which leaks DOM). The POC driver (`tools/probe/server.mjs`) already
  exposes exactly `snapshot / click / fill / press / goto(base-only)`; harden it for CI use.
- Scope statement: this is a **labelling/structure/flow probe, not a visual-layout probe** — the a11y
  tree linearises what a sighted user parses spatially. Do not claim visual-discoverability coverage.

## B2. Control baseline (the rigour fix — absolute scores are "vibes")
- Run every objective ALSO with a **knowledgeable expert agent** (full context). Report success-rate,
  steps, clicks **as a ratio to baseline**. Friction = where naive cost ≫ expert cost.
- **Demote self-reported `confusion`** (an LLM confabulates introspection) to a soft annotation; drive
  severity from **objective signals**: success/fail, step/click inflation vs baseline, distinct wrong
  affordances tried, dead-ends, time. Also flag **"succeeded-but-struggled"** (high clicks/time even on
  success) — those are conversion leaks the over-persistent agent masks.

## B3. Personas as mechanical constraints (not role-play)
An LLM can't authentically "be" a low-confidence grandparent. Enforce behaviour in the harness:
- **child**: screenshots only, short visible text, no long typing.
- **impatient parent**: hard step cap → auto-abandon on confusion.
- **cautious grandparent**: must justify each click against a visible label or stop.

## B4. Objective × persona matrix (+ coverage the review added)
Objectives in user language (one per run); ≥2 personas × ≥N attempts each (define N so "frequency" is a
fraction, e.g. 3/4):
1. Create a personalised storybook for a child and read it.
2. Get a physical printed copy of a book you've made. *(order flow / its absence)*
3. Set up a second child and make a story for them.
4. As a grandparent, buy something that lets your grandchild make a book. *(catalog/gifting)*
5. Find out how this works / get help before committing.
6. Change a child's name and avatar.
7. **Have a story read aloud** *(audio/TTS — child persona)*.
8. **Make the story read in your own voice** *(voice cloning — high-ambiguity flow)*.
9. **Send a finished book to grandma** *(share links — exercises recipient view)*.
10. **Your story didn't finish — recover** *(error/recovery path)*.

## B5. Transcript schema (aggregatable, not prose)
Per run: `objective, persona, outcome, time_to_first_value, total_time, where_abandoned`.
Per step: `intent, observed, action, result, seconds, clicks, wrong_affordances_tried, dead_end?, note`.
Stable identifiers assigned in the analyst pass (the naive agent doesn't know route names).

## B6. Codable fix-records (the user's explicit ask — "interrogate what was under-specified")
For each confirmed blocker, a deterministic 3-question interrogation:
1. What was the agent's **intent** at the stalled step?
2. What on-screen affordance did it **expect/search for** (quote its own transcript reasoning verbatim)?
3. What **single element**, present, would have let it proceed?
→ Emit a **fix record**: `{ route/screen, exact_missing_affordance (quoted), proposed_change (one
sentence: add/rename/move/help X), change_type ∈ {label, affordance, empty-state, inline-help,
flow-reorder, error-message}, effort S/M/L, confidence }`. Acceptance test: a Sprint-5 engineer could
implement it without re-reading the transcript. Reject "improve discoverability of X" (a category, not
a change).

## B7. Triage, ranking & loop-closing
- **Triage taxonomy** per finding: `{ ux_defect, harness_limitation, agent_capability, ambiguous }`;
  require **≥2 independent confirmations across personas** before backlog entry; downgrade if a second
  persona cleared it.
- **Rank** by `severity × frequency × funnel-stage-weight` (heavier on the signup→first-book→checkout
  activation path) so it lands with the PM and serves GTM.
- **PostHog concordance (hard dependency, not "where possible")**: tag probe steps to the **Sprint-1
  event taxonomy names** (`src/lib/analytics/events.ts`); pull real drop-off % per matching funnel step.
  A finding that is **both** an agent blocker **and** a top real drop-off step → auto-promote to P1;
  agent-only with low real drop-off → flag possible artifact. This is also the cheapest external-validity check.
- **File P1/P2 findings as `dev-todos`** (category `usability`) with their fix records — tracked work,
  not a rotting report.

## B8. Metrics, baseline & report
- Lock metrics: **task-success-rate** (primary), **blocker count** (activation path),
  **time-to-first-value**. **Commit the first full run as the baseline** so Sprint 5's "measurable lift"
  has a number to beat.
- **PM-facing one-pager** on top of the structured backlog: traffic-light success table, top-5 fixes by
  impact × effort (with the funnel step each unblocks), one quoted agent moment-of-doubt per finding.
- Re-run after Sprint-5 fixes (usability regression check).

## B9. Cadence & cost
On-demand + scheduled (before each usability review; before/after Sprint 5) — **never** a per-PR gate.
Bound runs: ~30–40 steps max, hard wall-clock timeout, serial (avoid emulator contention + cap token
spend; screenshot tokens dominate). The matrix (≈10 objectives × 2 personas × 2 attempts ≈ 40 runs) is
a scheduled batch, not standing CI cost.

## B10. Highest-validity upgrade (future primary mode)
Frame absolute friction scoring as **exploratory**; the strongest defensible mode is **blind A/B of UI
variants** (agent blind to which) measuring success-rate/step-economy delta — relative comparison cancels
most LLM-vs-human confounds. Adopt once variants exist (e.g. testing Sprint-5 fixes).

---

## Data, privacy & security (both sprints)
- Run against **emulator + synthetic data**; obviously-fake child names; never real customer/child data.
- **Artifacts** (screenshots, traces, transcripts) may render child-like content → CI artifact storage
  with short retention (≈7d), failure-only upload, **never committed**, scrubbed before sharing.
- Emulator needs **no prod secrets** (a security win). Any real-gen smoke uses a separate low-quota key.

## Deliverables
- **3A**: emulator-aware config + `TEST_MODE` seam + `playwright.config.ts` + `e2e/` specs + axe +
  Lighthouse + visual + rules tests + CI `e2e` job + extended cleanup. `docs/testing/`.
- **3B**: hardened probe driver (CI-ready) + expert-baseline runner + mechanical-persona harness +
  objective matrix + analyst pass (codable fix-records, triage, ranking, PostHog concordance) + baseline
  snapshot + PM one-pager. Findings filed as `usability` dev-todos.

## Risks (top)
| Risk | Mitigation |
|------|-----------|
| Foundation (emulator + TEST_MODE) is real engineering, mistaken for config | It's the whole of 3A; budget it; build before any spec |
| Flaky gate erodes trust | Happy-path blocks; report-only with promotion criterion; nightly real-gen |
| Probe over-trusted | Expert baseline ratio; objective metrics; ≥2 confirmations; per-item confidence tag |
| Agent failure ≠ UX defect | Triage taxonomy; "could a human do this?" check |
| Artifacts leak child-like content | Synthetic data; retention limits; never in repo |
