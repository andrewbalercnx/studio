# Usability Findings — Naive-Agent Probe (Run 2026-06-05)

> **Method**: naive-agent usability probe (POC) — an LLM agent given *only* an objective and no
> knowledge of the system, driving the live app through accessibility-tree + screenshot perception
> only (no DOM/source/test-ids). See `docs/sprints/SPRINT-03-UX-TESTING.md` (Pillar B) and the driver
> at `tools/probe/server.mjs`.
> **Status**: first proof-of-concept run. Findings are real and actionable; treat as the seed of the
> first-run-usability (Sprint 5) backlog.

## Run summary

| Field | Value |
|-------|-------|
| Target | Live app (`https://storypic.rcnx.io`) |
| Objective | "Sign up and create a personalised story for a child called Ezra; get as far as you can." |
| Persona | Impatient parent |
| Budget | ~22 actions |
| Outcome | **Partial** — signed up, created child "Ezra", reached ~40% of the Story Wizard; no finished book within budget |
| Time-to-first-value | First personalised wizard question ("Where should our story begin?") |

## What this validates (method)

- A knowledge-isolated agent perceiving the app **only** via the accessibility tree + screenshots can
  drive the real product and **gets genuinely stuck where affordances/labels are missing** — the
  intended signal. Missing "play as child" control → real dead-end, not a scripted assertion.
- The probe produced, per finding, **the single on-screen change that would have unblocked it** — i.e.
  codable fixes, not vague "improve discoverability."
- **Validity caveat observed live**: the agent *persisted* through a dead-end (child switching) that a
  real impatient parent would likely have abandoned on. Lesson: flag "succeeded-but-struggled" steps,
  not just outright failures — those are conversion leaks an over-persistent agent masks.

## Findings (prioritised)

Severity × where the friction sits on the activation path (signup → first child → first story → book).

### High

1. **"End Tour" navigates to the signup page.** Ending the welcome tour dumped the user onto `/signup`
   (while still logged in) — alarming ("did I get logged out? did my account save?").
   - *Category*: navigation · *Fix*: "End Tour" should return to home / "Who is playing?".
2. **No way to start a story for a child from "Manage Children".** Child rows expose only
   Edit/Photos/Voice/Delete; names/avatars aren't clickable; there's no "Play as / Start story".
   - *Category*: discoverability · *Fix*: a "Play as Ezra" / "Start a story" button on each child card.
3. **Child switching is hidden; nav pins to the previous child.** The logo and avatar both keep
   returning to the previously-selected child; the only way to switch was reloading the site root URL.
   - *Category*: navigation · *Fix*: a visible "Switch child" control in the nav (or make the logo
     always route to "Who is playing?").

### Medium

4. **Auto-created "My First Child" placeholder.** A dummy child the user never created — and it
   **leaked into Ezra's story as a character** ("Ezra and My First Child are about to start a grand
   adventure").
   - *Category*: content · *Fix*: prompt "Add your first child" instead of seeding a dummy profile (or
     exclude placeholder profiles from story casts).
5. **Story-method chooser exposes model jargon.** Five similar options ("Gemini Free", "Story Beats",
   `gemini4`-style names) with no guidance for a first-timer.
   - *Category*: labelling · *Fix*: a "Recommended for first-timers" badge on one option; hide model
     names from end users.

### Low

6. **Redundant PIN re-entry post-signup.** Immediately after setting a PIN at signup, the user was
   asked to enter the same PIN to proceed.
   - *Category*: feedback · *Fix*: a "PIN saved" confirmation, or skip the prompt right after creation.
7. **Slow, vaguely-narrated waits in the wizard.** Each answer triggered a multi-second "creating your
   adventure" wait with only a vague bar.
   - *Category*: feedback · *Fix*: a clear "Question 2 of 4" step indicator and expectation-setting.

## Cross-cutting themes

- **The child is the unit of action, but the UI doesn't make "act as a child" obvious** (findings 2–4).
  This is the single biggest activation blocker the run surfaced — a first-time parent struggled to get
  from "I have a child profile" to "a story is being made for them."
- **Navigation has surprising teleports** (findings 1, 3) that break the user's mental model and erode
  trust right after signup — the worst possible moment.
- **Onboarding leaks implementation** (findings 4, 5): a placeholder child and model names surface
  internals to the parent.
- **Perceived performance** (finding 7) plus a long action-count to first book means the "impatient
  parent" never reached the payoff within a reasonable budget.

## Recommended actions

- File findings 1–3 as **high-priority `usability` dev-todos** (real live-app issues, fix regardless of
  Sprint 3) and 4–7 as medium/low. These become the first entries of the Sprint-5 backlog.
- When the probe is productionised (Sprint 3B): add an **expert-agent baseline** so severity is a ratio
  (naive cost ÷ expert cost), run the **objective × persona matrix** for frequency, and **cross-check
  against PostHog funnel drop-off** to confirm the agent stalls where real users stall.
- Re-run this objective after fixes to confirm the friction is gone (usability regression check).

## Caveats

This is one run, one persona, one objective, no baseline — exploratory, not statistical. An LLM agent
predicts **structural/labelling/flow** defects well; it does **not** predict aesthetic, emotional, or
trust reactions. Findings here are high-confidence *structural* issues; treat the method as a
complement to, not a replacement for, real-user testing.
