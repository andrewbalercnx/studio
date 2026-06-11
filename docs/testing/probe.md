# Mechanical UX Probe

> Sprint W2-A deliverable. Last updated: 2026-06-11

A repeatable, deterministic usability probe that finds activation/usability
regressions before users do. It productionises the naive-agent POC
(`docs/usability/UX-PROBE-FINDINGS-2026-06-05.md`, driver at
`tools/probe/server.mjs`): the POC's LLM agent *discovered* the friction; this
probe *replays* that friction mechanically against every build so it can run
nightly, score against a baseline, and diff findings run-over-run.

## Quick start

```bash
npm run probe          # build (if needed) → emulators+app → probe specs → artifacts
npm run probe:report   # re-aggregate fragments into findings.json + report.md
```

Outputs (gitignored, uploaded as a CI artifact):

| File | What it is |
|------|------------|
| `probe-results/report.md` | PM-readable run summary: W1-C verdicts, persona scoreboard vs expert baseline, funnel walk, findings |
| `probe-results/findings.json` | Machine-readable run record; each finding is a codable fix-record |
| `probe-results/fragments/*.json` | Raw per-spec fragments (steps, hesitations, dead ends) |

`npm run probe` exits non-zero **only on harness errors** (build/spec
infrastructure). Persona failures, FAIL verdicts and new findings are report
content — this is a detector, not a gate. (A blocking wrapper can set
`PROBE_FAIL_ON_REGRESSION=1` for `probe:report`; CI does not.)

It runs on the same stack as the E2E suite (`docs/testing/e2e.md`): Firebase
emulators (offline `demo-` project), the `standalone` E2E build, `TEST_MODE=1`
AI seam. Playwright boots everything via its `webServer` config; set
`PLAYWRIGHT_BASE_URL` to reuse a running stack (the workflow does).

## How it works

```
e2e/probe/
  personas.ts      mechanical personas with explicit budgets
  goals.ts         goal scripts (perceivable affordances only)
  driver.ts        PersonaDriver — the perception constraint + budgets
  recorder.ts      step/hesitation/dead-end/funnel recording
  persona-runs.spec.ts   expert baseline + persona runs
  w1c-regression.spec.ts the 7 original probe findings as PASS/FAIL checks
  baseline-findings.json committed list of KNOWN findings (triage state)
  concordance.ts   PostHog concordance contract (stub until analytics is live)
  seeds.ts         probe-only emulator seeds (startup tour, jargon generator)
  artifacts.ts     fragment writer
scripts/run-probe.mjs     `npm run probe` orchestrator (single worker)
scripts/probe-report.mjs  fragment aggregation → findings.json + report.md
.github/workflows/probe.yml  nightly, report-only, artifact upload
```

### The validity guard (inherited from the POC)

Personas may only target what a user can perceive: **ARIA role + accessible
name, form labels/placeholders, or visible text**. The driver cannot express
CSS selectors or test-ids. A missing or ambiguous accessible label is
therefore a real obstacle for the persona, exactly as for a person — that's
the signal the probe exists to produce.

### Personas and budgets

| Persona | Max actions | Max wall-clock | Action patience | Tries fallbacks |
|---------|------------|----------------|-----------------|-----------------|
| expert (baseline) | 60 | 240s | 30s | no |
| impatient-parent | 26 | 120s | 7s | **no** — abandons at the first dead end |
| first-time-parent | 40 | 200s | 15s | yes — detours recorded as hesitations |
| returning-child (mobile viewport) | 10 | 90s | 8s | no |

Budget rationale: the optimal activation path is ~19 actions (expert run);
the POC's impatient parent burned ~22 without finishing. The impatient budget
(26) sits just above optimal, so any reintroduced friction that forces a
detour busts it.

All personas run the SAME goal script — the optimal path. Divergence comes
from budgets/patience/fallbacks, which keeps runs deterministic while staying
regression-sensitive: a removed affordance dead-ends the impatient parent and
detours (and down-scores) the first-time parent.

### Goals

1. **`reach-finished-book`** — signup → create child → kids mode → story
   entry → *(deterministic seam: seeded completed story, marked `simulated`)*
   → book type → art style → generation → book listed. Story completion has no
   TEST_MODE seam (the wizard is a live AI call), so the probe seeds the exact
   wizard/`storyCompile` post-conditions, same as the funnel spec.
2. **`read-existing-book`** — returning child on a shared device (mobile
   viewport): profile chooser → kids home → My Books → open book → first page.
   Preconditions are seeded outside the budget.

### Scoring

The expert fragment defines `optimalActions` / `optimalWallMs` per goal;
persona scores get an `actionRatio` (steps taken ÷ optimal). Success requires
finishing inside both budgets. Hesitation points = fallback used, or an action
slower than the persona threshold. Dead end = no candidate affordance worked.

### Findings: codable fix-records

Every finding is emitted as
`{ id, severity, surface, category, summary, reproSteps, suggestedFix, source }`
— deliberately shaped to map onto a dev-todo (title/description/priority/
category) for manual or scripted filing. **The probe never calls the dev-todo
API itself.**

`e2e/probe/baseline-findings.json` is the triage state: the report marks any
finding id not in it as **NEW**. After triaging a run, move accepted/tracked
records from `probe-results/findings.json` into the baseline so the next run
only flags genuine novelty.

## The seven W1-C regression checks

`w1c-regression.spec.ts` re-verifies the original probe findings (all fixed on
main) every run, emitting PASS/FAIL verdicts:

| Check | Original finding | Mechanism |
|-------|------------------|-----------|
| W1C-1 | "End Tour" dumped users on /signup | seeds a live default-startup tour, signs up, ends the tour, asserts landing on "Who is playing?" |
| W1C-2 | no way to start a story from Manage Children | asserts + clicks "Play as <child>" |
| W1C-3 | child switching hidden | asserts + clicks "Switch child" in child-mode nav |
| W1C-4 | auto-created "My First Child" | asserts the first-run prompt, zero seeded child docs |
| W1C-5 | model jargon in the story-method chooser | seeds a jargon-named generator, asserts presentation-layer scrub + exactly one "Recommended for first-timers" badge |
| W1C-6 | redundant PIN re-entry post-signup | client-side nav to the parent area right after signup must not re-prompt |
| W1C-7 | vaguely-narrated wizard waits | stalls the wizard server action (route interception) and asserts the narrated waiting state |

Verified 2026-06-11: deliberately reintroducing the W1C-2 bug (renaming the
"Play as" button) was caught as W1C-2 + W1C-3 FAIL with regression findings —
the W2-A exit criterion.

### Known verification gaps

- **W1C-7 is partially verified.** The check covers the wizard
  *initialisation* wait ("Summoning the Story Wizard..."). The deeper W1-A
  narration — "Question N of 4" progress and the between-question/final-write
  reassurance copy — sits past a live Gemini response and cannot be reached
  deterministically until a TEST_MODE seam exists for `storyWizardFlow`.
  Adding that seam is the tracked follow-up; when it lands, extend the check
  through a full mocked Q&A turn.
- **W1C-1 reseeds a tour per run.** The check seeds (and always removes) a
  `helpWizards` doc; if production ever ships a default tour whose "End Tour"
  behaviour differs by page, add per-route variants.

## Determinism

- Single worker (`--workers=1`): the probe measures one user at a time, and
  two checks temporarily seed shared catalog docs (always removed in
  `finally`).
- Disposable accounts per run (same `e2e-` prefix + cleanup as the E2E suite).
- Verified 2026-06-11: two consecutive `npm run probe` runs produced identical
  stable results (verdicts, successes, action counts, funnel, finding ids).
  Timings naturally vary and are excluded from the comparison.

## PostHog concordance (stub)

Probe funnel steps use the **canonical `ANALYTICS_EVENTS` names**
(`signup.completed` → … → `storybook.art_ready`) imported from
`src/lib/analytics/events.ts` — the identity is the contract. Once the
Sprint-1 compliance gate clears and PostHog is live, implement
`fetchRealFunnel()` in `e2e/probe/concordance.ts` (PostHog funnels API) and
call `compareFunnels()` from `scripts/probe-report.mjs`; the report then shows
where the synthetic probe and real users agree/disagree about drop-off.

## Operational notes

- Nightly workflow: `.github/workflows/probe.yml` (03:17 UTC + manual
  dispatch). Report lands in the job summary; `probe-results/` is an artifact
  (14-day retention — reports may reference synthetic child-like content).
- The probe is intentionally **not** in `ci.yml` and never blocks PRs.
- Probe findings discovered so far: see `baseline-findings.json` plus the
  standing finding `pin-guard--grace-lost-on-full-reload` (PIN guard
  re-prompts on hard reload despite a valid persisted grace timestamp —
  contradicts `docs/testing/pin-guard.md` §4; app-code fix belongs to the UX
  track).
