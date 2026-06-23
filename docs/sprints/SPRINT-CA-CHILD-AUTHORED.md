# Sprint CA — Child-Authored Stories ("Be the Author")

> **Status**: Planned · **Priority**: High · **Dev todo**: file one when started (program item)
> **v2-validation (2026-06-23)**: a **second six-lens council pass** re-reviewed v2 against the live
> code — verdict unchanged (architecture sound, build green behind the flag, `enabled` NO-GO), with
> new build-blockers (chiefly **phantom reuse**: `withProviderReliability`, streaming `/api/tts`, the
> W1/W3 e2e net, and `feature-flags.test.ts` don't exist as cited). Full detail in **§11.5**.
> **v2 (2026-06-23)**: incorporates a six-lens **council review** (simplicity/reuse, AI/ML
> correctness, testability, child safety & privacy, scalability/cost/latency, UX/child-dev fit).
> The council's verdict, findings, and the must-fix gates are in **§11**; the body below is revised
> to reflect them. **Headline corrections:** the grounding guarantee cannot be a single LLM-judge
> (§2.2 redesigned); there is **no moderation capability in the codebase today** (new §2.8); STT
> via the consumer Gemini API is **not** "no new DPA" (§2.3/§5 corrected); "4–9" is two products,
> not one (§2.7 age bands); segments must be a subcollection, not an embedded array (§3); scribe/STT
> must run on Flash, not Pro (§4).
> **Tracks**: A — Reliability/Flows (primary), C — UX, B — Ops (telemetry/route tail)
> **Depends on**: W1-A degraded-book contract + retry/breaker infra; W2-C parent page-edit; W4-A
> persona cookie; Sprint-1 analytics no-PII contract (extended here to child voice).
> **Decisions locked (owner, 2026-06-23)**: voice-first w/ text fallback · tunable fidelity dial
> defaulting light-touch · child character creation = name+traits+AI-avatar-from-description (no
> photo) · target span ages 4–9 with voice bridging literacy.
> **Council decisions resolved (owner, 2026-06-23, §11.4)**: STT → **Vertex AI EU/UK region** (clean
> residency) · **voice-first committed** (so the latency mitigations in §2.3 are mandatory, and the
> latency spike is validation, not a go/no-go) · **both Little + Big Author age bands in v1** · **build
> phases from the start** (full phase state machine up front).

---

## 0. Why this sprint exists

Every current story mode is **AI-invents / child-picks**. Wizard asks 4 multiple-choice questions;
Friends proposes characters → scenarios → synopses for the child to choose between. The model
authors the narrative; the child only selects. The story is never the child's.

This sprint adds the inverse: **the child authors the story, the agent assists.** The agent's role
flips from *inventor* to *scribe + coach* — it elicits the child's ideas, writes them down at a
light touch, and nudges the shape of the story without supplying its content.

**The leverage:** everything downstream of a compiled story is already authorship-agnostic.
`storyCompileFlow` accepts narrative text and does not care who wrote it; pagination → images
(with actor exemplars) → audio (TTS) → print/order → entitlements all reuse unchanged. The new
build is concentrated in two places only: **(1) child-side character creation** and **(2) the
authoring dialog**. Downstream is free.

---

## 1. Objective

A child aged 4–9 selects or creates their characters, then — turn by turn, by voice or text —
tells their own story with the agent acting as scribe and coach. On finish, the existing pipeline
turns it into a viewable, orderable, narratable storybook. The narrative content is demonstrably
the child's, not the model's.

**Exit criteria (top-line):**
1. A child can pick existing characters **or** create a new one (name + type + trait → AI avatar)
   from the kids surface.
2. A child authors a story as a sequence of **phases** via an open-ended dialog (voice-first; text
   fallback; agent prompts spoken aloud); at each phase boundary the agent **reads the phase back**
   and clarifies open elements/actions/character-assignments before locking it; with **undo** and a
   child-controlled finish.
3. An automated **fidelity/grounding check** shows the agent introduces no named entity or plot
   event absent from the child's contributions (light-touch default).
4. Finishing compiles to a normal `stories/{id}` doc and reaches **art-ready** through the
   existing storybook pipeline under `TEST_MODE` (via the e2e harness — note `e2e/` has only a smoke
   spec today, so the storybook-pipeline + authoring specs are net-new build, §11.5.1).
5. **No child voice audio or story text reaches analytics** (extends the Sprint-1 no-PII
   contract); raw child audio is transcribe-then-discard by default.

---

## 2. Design

### 2.1 Flow overview

```
[choose mode: "Be the Author"]
        │
        ▼
[characters]  reuse Friends Phase-1 selection  +  NEW: "make a new one"
        │                                          (name + type + trait → AI avatar from text)
        ▼
[authoring dialog]  ← the heart of the sprint
        │   ┌─ PHASE (a scene/beat = several segments) ───────────────┐
        │   │  agent speaks an OPEN prompt (TTS)  ─┐                   │
        │   │  child answers (voice → STT, or text)│ loop, arc-aware,  │
        │   │  agent scribes child's words→segment │ undo supported    │
        │   │  agent appends + asks next prompt   ─┘                   │
        │   │  agent detects PHASE BOUNDARY →                          │
        │   │  ┌─ RECAP ─────────────────────────────────────────┐    │
        │   │  │ read phase back aloud (TTS) → clarify open items: │    │
        │   │  │ elements · actions · which character did what     │    │
        │   │  │ → child confirms / amends → phase LOCKED          │    │
        │   │  └───────────────────────────────────────────────────┘  │
        │   └──────────────────────────────────────────────────────────┘
        │   next phase… │ child (or agent-detected end) → "Is that the end?"
        ▼
[finish] → /api/storyCompile (UNCHANGED) → stories/{id}
        ▼   (confirmed phases carry scene metadata → better pagination/images)
[existing pipeline]  storybookV2/create → pages → images → audio → order  (ALL REUSED)
```

### 2.2 The agent as scribe + coach (the differentiator)

Each authoring turn the flow:
1. Takes the child's contribution (transcribed audio or typed text).
2. **Scribes** it into a story segment at the configured fidelity. Default **light-touch**: fix
   grammar/spelling, keep the child's voice, vocabulary and ideas; **add no events, characters, or
   detail the child didn't give**. Tag character references → actor IDs.
3. Appends the segment to the running **story-so-far** (visible to the child).
4. Emits the next **open** prompt — never multiple choice (that would be invention). The prompt is
   **arc-aware** (uses the existing arc template invisibly: at the conflict beat, "uh oh — what
   goes wrong now?"; near the end, "how do they fix it?") and **content-free**.
5. If the child stalls, offers a **scaffold** — still a *question*, never a sentence of plot
   ("maybe they go somewhere new… where do you think?").
6. Detects a natural ending and asks "Is that the end, or does more happen?".

**Authorship guarantee (redesigned per council §11).** A single "LLM checks the LLM" grounding
test would be circular — same model family, same blind spots — and would give a *false green* on the
sprint's defining feature. Replace it with a **two-tier, provenance-based** mechanism that separates
the deterministic-and-testable part from the genuinely-fuzzy part:

- **Tier 1 — entity grounding (deterministic, hard gate, the real headline test).** The scribe
  emits `$$id$$`-tagged text; assert `extractEntityIds(scribedText) ⊆ cast` **per segment** (not
  just at compile), and reject any new capitalised/proper-noun token not present (phonetically) in
  the child's transcript. Pure string logic → a deterministic vitest table incl. **adversarial**
  fixtures (child says "the dragon came" → scribe must not add its colour/actions).
- **Tier 2 — event/detail grounding by provenance, not prose-judging.** The scribe emits
  **structured atoms** `{ scribedText, atoms:[{ subject, verb, object?, sourceSpan:"child's exact
  words" }] }`; reject any atom whose `sourceSpan` is not (fuzzily) present in the child's input. An
  invented event has no honest span to cite — this audits provenance mechanically instead of asking
  a model "did you add anything?".
- **Optional semantic check = report-only, never the gate.** If a semantic judge is used, it must be
  an **independent model** (e.g. Claude, since the stack is single-provider Gemini), validated
  against a labelled gold set, and it only annotates — it never blocks.

To keep the scribe stable: **pin temperature low (~0.1–0.2)** (not the storytelling 0.7–1.2), and
**split the `scribe` call from the `coach` next-prompt call** — mixing "add nothing" with "invent an
engaging question" in one decode degrades both. **Instruction-isolation**: child contributions are
delimited as *data, not instructions* so "ignore your rules…" can't steer the agent.

**Fidelity dial.** `systemConfig/storyAuthoring.fidelity ∈ {scribe, light, coauthor}`, default
`light`. *Council note:* ship **one** behaviour (light-touch) for v1 and add the dial once there are
real sessions to tune against — the knob is premature before the grounding mechanism is proven.

### 2.3 Voice (modality)

- **Capture**: browser `MediaRecorder` on a big **tap-to-start / tap-to-stop** mic (not
  press-and-hold — small hands release early) with a visible recording state + voice-activity
  auto-stop; feature-detected with graceful **text fallback** (Safari audio history — see Risks).
- **STT (decided §11.4): Gemini multimodal audio on Vertex AI, pinned to an EU/UK region**, Flash
  tier (transcription doesn't need Pro). This resolves the residency problem with the consumer Gemini
  API (`generativelanguage.googleapis.com`, US-default) — child voice must **not** go there. The
  privacy policy + sub-processor list still name Google/Vertex for STT, and the DPA must cover child
  audio. Verify Vertex's Gemini path accepts the L1 phrase-hints; if not, Google Cloud Speech (EU,
  `speechContexts`) is the fallback.
- **Latency budget (committed — voice-first, §11.4, so this is mandatory).** The serial loop
  record→STT→scribe→[grounding]→TTS→play is ~6–12s naïvely — 2–4× a young child's patience. Target
  **p50 < 4s to first feedback**: show the scribed text + next prompt immediately (don't block on
  audio), **stream** prompt TTS — note `/api/tts` currently *buffers* and a streaming path is net-new
  (§11.5.1) — Flash everywhere, and play a short "let me write that down…" filler so there's never
  dead air. The latency spike (§9.0)
  now *validates the mitigations* (voice-first is committed); if it can't reach the target, the
  mitigations get hardened (e.g. partial-transcript streaming), not the modality abandoned.
- **Agent voice**: prompts read aloud via the **existing TTS** path (ElevenLabs); **cache repeated
  prompt/scaffold TTS by text hash** (they recur every turn). Raw child audio is **transcribe-then-
  discard** — guaranteed in code: never persisted, never logged, never attached to `captureException`.
- **Text fallback** is always available (typed contributions), so a literate child or a flaky-mic
  session is never blocked.

### 2.4 Character creation (child-side, new)

Reuse Friends-flow Phase-1 *selection* as-is. Add a "make a new one" affordance:
- Child gives a **name**, picks a **type** (friend / pet / toy), and one or two **traits**.
- Avatar is generated **from the description** (text → existing avatar generation), **no photo
  upload** — sidesteps child-image consent/safety on the kids surface.
- Persist to the `characters` collection with `isParentGenerated: false`,
  `createdVia: 'child_authoring'`. It then appears in the parent's character list to edit/remove.

### 2.5 Reuse map (explicit)

| Concern | Reuse | New |
|---|---|---|
| Character selection | Friends Phase-1 (`initializeCharacterSelection`, proposal) | — |
| Character creation | avatar generation (text path) | child-side create UI + route |
| Authoring dialog | `messages` subcollection, prompt-config resolver, arc template | `story-authoring-flow` |
| Phasing / recap | arc template (`story-arc-flow`), TTS read-back | phase state machine + recap/clarify (§2.7) |
| Compile | `storyCompileFlow` (authorship-agnostic) | thin bridge: phases/segments → `storyText` w/ `$$id$$` |
| Pagination/images/exemplars/audio | entire pipeline (phase `sceneSummary` pre-feeds pagination) | — |
| Order/print/finalize | entire flow (incl. W2-C page-edit) | — |
| Entitlements | `story_allowance`, `storybook_allowance` | — |
| Persona scope / PIN | W4-A persona cookie | — |

---

### 2.6 Character reference resolution — the "always know who" guarantee

**Why it's critical, not cosmetic.** The canonical story is stored with `$$id$$` placeholders and
the **image pipeline draws whichever actor IDs a page resolves to**. A mis-resolved reference
renders the *wrong character* on the page. With children this is hard: STT garbles pronunciation
("Wex" for "Rex"), and child grammar overloads pronouns and drops referents ("he went and then he
got scared" — which he?). We must keep a reliable mapping from the child's words to known actors in
every sentence.

**The reframe: this is closed-world entity *linking*, not open coreference.** The cast is fixed
before authoring starts (selected + created characters + the child). Every mention links to one of
~2–6 known entities — far more tractable than unbounded coref. A layered pipeline:

- **L0 — Anchor at character time (biggest lever).** Per character capture: canonical name,
  **pronouns**, type, an explicit **alias/nickname list** ("what do you call her?"), and
  precomputed **phonetic keys** (Double Metaphone + a child-phonology substitution table:
  w↔r, th↔f, …). Bind the child's self-reference ("me/I") to the child actor.
- **L1 — Bias transcription.** Pass the cast names/aliases to Gemini STT as phrase hints each turn
  so it transcribes "Luna", not "lunar" — fix pronunciation at the source.
- **L2 — Resolve every mention.** Tag each mention (name, alias, descriptor "the puppy"/"my
  brother", or pronoun) → actor ID using (a) **phonetic + edit-distance** match over the small cast
  (low false-positive risk) and (b) **discourse state**: present actors, recency/salience, last
  subject, per-pronoun antecedents, narrowed by the cast's pronoun metadata ("she" + one female on
  stage → confident). Fold this into the scribe step: the scribe emits the `$$id$$`-tagged segment
  **plus a list of low-confidence mentions** as structured output — one model call, deterministic
  phonetic pre-pass feeding candidates.
- **L3 — Clarify, never guess (key principle).** Each binding carries a confidence. High → bind
  silently. Low/ambiguous → the coach asks a short concrete question in child language ("Did Rex
  get scared, or your brother Tom?"). Ambiguity becomes a cheap dialog turn, never a silent wrong
  render; consistent with the scribe role and the §2.2 grounding check.
- **L4 — Visible, tappable cast.** Show on-stage characters as avatars; **tap one to say "this
  one"** — a non-verbal disambiguation channel for pre-readers and a fallback when voice/grammar
  fail. Aliases learned mid-session are added to the character for the rest of the session.
- **L5 — Verify before image gen.** At compile, assert every page's `imageScene.actors ⊆ cast`; an
  unresolved reference blocks rendering with a clarifying prompt rather than drawing a wrong
  character. Parent per-page edit (W2-C) is the final net.

**Failure handling (trade-off).** If the child can't/won't disambiguate after **one** ask, do not
halt (that frustrates a child) — bind to the most-salient present actor and **flag the segment for
parent review** so W2-C's page edit catches it. Ask once, not repeatedly.

**v1 scoping (council §11 — avoid the research-grade build).** For a cast of 2–6, the closed-world
roster *in the scribe prompt* does ~90% of the linking. Ship the minimal version first: scribe emits
`$$id$$`-tagged text + a list of mentions it couldn't confidently bind; for those, **ask once with
the tappable cast (L4)**; keep the **compile-time `actors ⊆ cast` assert (L5)** as the one
non-negotiable. **Defer to v2**: Double Metaphone + the child-phonology substitution table,
persisted `phoneticKeys`, and the full discourse-state object (`salienceOrder`, `lastSubjectActorId`,
`pronounAntecedents`). **Confidence must come from the deterministic phonetic/edit-distance pre-pass,
not from an LLM-emitted score** (LLM confidence is uncalibrated and would mis-drive the
clarify-vs-bind threshold). Keep the binding logic a **pure module** (`resolveMentions`) so it is
unit-testable; the LLM only *proposes* candidates, it is never the resolver.

---

### 2.7 Phased authoring with boundary recap & clarify

Stories are built as a sequence of **phases** — coherent scenes/beats, each made of several
segments — rather than one undifferentiated stream. Phases are the **missing middle layer** between
a child's turn and a printed page:

```
segment (one child turn)  ⊂  phase (a scene/beat)  ⊂  pages (1..n per phase, from pagination)
```

A phase is the realized instance of an **arc step** (opening → problem → turning point →
resolution), so the existing arc template paces the story without dictating content.

**Phase-boundary detection (each turn the flow asks "is this phase done?"):**
- **Arc satisfaction** — the phase's narrative goal is met (setting established / problem
  introduced / problem resolved).
- **Scene shift** — change of place or time ("the next day…", "back home…").
- **Child signal** — "and that's what happened in the forest", or a natural lull.

**On a boundary → the RECAP state (the core of this section):**
1. **Read it back.** The agent reads the phase's scribed text aloud (TTS): *"Here's what happened
   so far…"*. Essential for pre-readers (hearing is how they verify) and it doubles as a
   **human-in-the-loop check on the fidelity dial** — if the scribe over-polished, the child hears
   it and corrects.
2. **Clarify the open items — three buckets:**
   - **Elements** — image-relevant gaps the child hasn't specified ("what does the dragon look
     like?"). Strictly *elicitation*, never silent invention — preserves the §2.2 authorship
     guarantee. Only ask about gaps that **matter for the page** (don't over-interrogate).
   - **Actions** — ambiguous events ("did they run away, or hide?").
   - **Which character did what** — batch-resolve the phase's accumulated low-confidence character
     bindings here (the §2.6 payoff): "when you said 'he climbed up' — Rex or Tom?".
3. **Confirm / amend → lock.** Child approves or fixes; edits apply to the phase; the phase locks
   and the next one opens.

**Interaction with §2.6 clarify policy:** *blocking* ambiguity is still asked immediately
mid-phase; everything non-blocking **defers to the phase recap**, so questions are batched at
natural checkpoints instead of interrupting every sentence.

**Why phases improve the output (not just the UX):** a confirmed phase carries resolved scene
metadata — location, time, atmosphere, actors, actions — captured *with the child*. Pagination /
image-scene generation currently has to **infer** this from finished prose; here it is
pre-structured at authoring time, so phases → pages yields more accurate, more consistent
illustrations than the AI-authored modes. Each phase's `sceneSummary` feeds
`story-pagination-flow` directly.

**Flow state machine:** `authoring(phase) → phase_recap → (confirm|amend) → authoring(next phase) →
… → finish`. New actions: `confirm_phase`, `amend_phase`. A light arc target (≈3–5 phases) paces
the story; the child may add or drop phases.

**UI:** completed phases render as a visible **storyboard/filmstrip** of cards (mini-summary, later
a thumbnail) so the child watches the story build in chunks; cards are tappable to revisit/amend —
also strong pre-reader UX and a direct visualisation of "phases → pages".

**Age bands — "4–9 is two products" (council §11, UX + must-fix).** Drive the experience off the
child profile's age (parent-confirmed band, not just birthdate):
- **Little Author (≈4–6):** 1–2 phases max; **no** arc/conflict prompts; **zero** mid-phase clarify
  — defer *all* non-blocking clarify to a single end-of-story **parent-review** pass; tappable
  picture-choices + cast taps are the *primary* input rail, voice is enrichment; cheerleader scribe,
  not story coach; soft 3–5 min cap. A **1-phase book is a valid, celebrated artifact.**
- **Big Author (≈7–9):** the full §2.2/§2.7 loop as designed.

**Server-enforced question budget (must-fix).** Prompt-level restraint reliably fails with young
kids. Track `questionsAskedThisPhase` in session state and **hard-cap** it (Little Author ≤1/phase;
Big Author ≤2–3/recap); over budget → fall back to most-salient + parent-review flag. Emit
questions-per-phase as content-free telemetry to tune the cap on real data.

**Parent-Assist / co-pilot mode — HYBRID stance (decided §11.6).** Two clearly-labelled modes, not a
bare toggle:
- **Scaffolding (default):** the grown-up encourages, rephrases the agent's question, or operates the
  device, **but the child supplies the content.** The §2.2 grounding guarantee still validates against
  the *child's* words; turns are provenance-tagged `author:'child'`; the "child-authored" promise
  holds across the whole 4–9 span. If the youngest can't contribute, fall back gracefully (tappable
  picture rail, end early) rather than letting the parent author.
- **"Help me tell it together" (opt-in co-author):** an explicit, distinctly-labelled sub-mode where
  the parent may supply content; turns tagged `author:'parent'|'shared'`; the artifact is labelled
  **co-created** and the child-authored guarantee is *not* claimed for it. This is the honest home for
  the 4–5 band when scaffolding isn't enough.
Provenance (`author` per segment), turn-ownership, and the entry/exit/re-entry flow between the two
modes are a **schema + state-machine concern**, not a boolean — specced with the phase machine.
**Comprehension & turn-taking fallbacks** (not just "silence"): handle the rambler (chunk long audio),
the off-topic answer, and **"child didn't understand"** — rephrase simpler *once*, then drop the
question; never ask the same concept twice.

---

### 2.8 Moderation, self-disclosed-PII & safeguarding (NEW — does not exist today)

**Correction (council §11, BLOCKER):** the plan previously said "moderate input/output, reuse
`toUserSafeMessage`." But `toUserSafeMessage` is only an **error-string mapper**; a codebase search
found **no moderation capability at all**, and **no `safetySettings` are configured** on any Gemini
call. When the child is the *author*, the model will faithfully transcribe unsafe input it would have
refused to *invent* — so this must be built, not reused. It is a launch blocker for a kids product.

- **A real moderation module** applied at three points: (i) child input **post-transcription**,
  (ii) scribed segment / agent prompt **pre-display and pre-TTS** (the recap reads text *aloud* — an
  amplification path), (iii) final compiled story **pre-share / pre-print**. Mechanism: explicit
  Gemini `safetySettings` **plus** a dedicated classification pass **plus** a deterministic blocklist
  for the long tail. Unsafe → redirect kindly, never surface a raw refusal (route via
  `toUserSafeMessage`).
- **Self-disclosed-PII detector/redactor** in the scribe step: a freely-narrating child will say
  real names, address, school. That text compiles into a **printable** and **publicly shareable**
  book (`shareLinks/{id}` is fetched unauthenticated, passcode optional, and currently returns
  `childName`). Flag/redact real-name/address/school/phone patterns before compile.
- **Share/print of authored books is GATED behind explicit parent review (decided §11.6).** No public
  share link or print order can be created for a child-authored book until a parent has reviewed and
  approved it — the strongest control, removing accidental exposure rather than mitigating it. When a
  share *is* approved: passcode-on by default, raise share-token entropy (the current 8-hex/32-bit id
  is brute-forceable), and the parent-review step is where the `childName`-exposure choice is made.
- **Safeguarding policy** (must-fix-before-go-live): a documented stance for distressing disclosure
  (abuse/self-harm/domestic) — at minimum flag-for-parent-review with no auto-report; silence is not
  an acceptable answer for sign-off.
- **Moderate child-created character** name/traits/aliases too (they appear in the parent list and
  the avatar prompt).

⚠️ **Corrections from the council (§11):** segments must NOT be an embedded array on the session
doc — a hot doc rewritten every 2–5s for 12–25 turns risks write-amplification and the 1 MiB limit.
Use a **subcollection** (mirrors the existing `messages` pattern). Add a **TTL** (`expireAt`,
reusing the Sprint-1 `events` TTL pattern) on authoring sessions/segments — abandoned half-authored
sessions carry the heaviest payload in the product. Several fields below are **deferred to v2**.

**`storySessions/{id}/segments/{segId}`** (NEW subcollection — not an array):
- `{ id, order, phaseId, childInputRaw, scribedText, atoms[], actorIds[], resolvedMentions[],
  inputModality: 'voice'|'text', parentReviewFlag?, createdAt }`
- A client-generated **`turnIdempotencyKey`** so a retried turn replaces rather than double-writes.
- Written `status:'pending'` then committed only after the full turn succeeds (mid-turn failure
  semantics, §4).

**`storySessions/{id}`** (small fixed fields only):
- `storyMode: 'authored'` · `currentPhase`: add `'authoring'` · `authoringComplete?` · `expireAt`
- `ageBand?: 'little'|'big'` · `assistMode?: 'none'|'scaffolding'|'coauthor'` (hybrid, §11.6) ·
  `questionsAskedThisPhase?: number` (per-segment `author?: 'child'|'parent'|'shared'` provenance)
- `shareReviewState?: 'unreviewed'|'approved'` · print blocked until `approved` (§11.6 share gate)
- `authoredPhases?` (bounded ≤5, may stay inline) — `{ id, order, arcStep, segmentIds[],
  scribedText, sceneSummary{…}, actorIds[], actions[], status, recapConfirmedAt? }`
- `authoringPhaseState?: 'authoring'|'phase_recap'`
- **v2-deferred:** `authoringFidelity` (ship one behaviour first), `authoringArcStepIndex`, and the
  discourse-state object below.

**`characters/{id}`** (additive): `createdVia?: 'parent'|'ai'|'child_authoring'`; `aliases?: string[]`.
*v2-deferred:* `phoneticKeys?` (only if the deterministic phonetic layer ships — §2.6 v1 scoping).

**Discourse state (v2)** — `salienceOrder`, `lastSubjectActorId`, `pronounAntecedents`,
`sessionAliases` extend `worldState` only when the full resolver lands. **Undo must roll back
discourse state + learned aliases**, not just pop a segment (else a stale antecedent poisons the
next turn — council testability gap).

**`systemConfig/storyAuthoring`** (new config): `{ enabled, arcEnabled, defaultModality,
voiceRetention: 'discard' }`. Disabled-by-default. *(Drop the `'<ttl>'` audio-retention option for
launch — it implies a path that needs its own consent/DPA; `fidelity` deferred with the dial.)*

**`authoringConsent`** (NEW, per-child, server-side — replaces the localStorage analytics-consent
model which is inadequate for voice): `{ childId, parentUid, consentedAt, consentVersion,
scope:['voice','stt-subprocessor','retention'], revokedAt? }`. `enabled` is gated **per family** on
this record, not only the global flag. Revocation disables the mode + deletes retained transcripts.

**Generator doc** (`storyGenerators`): seed "Be the Author" disabled until the §5 gate.

Story compile output is **unchanged** (`stories/{id}.storyText` with `$$id$$` placeholders).

---

## 4. API & flows

**New flow** `src/ai/flows/story-authoring-flow.ts` — the turn loop (§2.2) + phase state machine
(§2.7). Input `{ sessionId, contribution?, turnIdempotencyKey, action:
'start'|'continue'|'undo'|'finish'|'help'|'confirm_phase'|'amend_phase' }`; output
`{ ok, agentPrompt|recap, storySoFar, phases, currentPhase, phaseState, canFinish }`.
- **Two model calls, both on Flash (not Pro) — council §11:** a **scribe** call (low temp ~0.1–0.2;
  emits `$$id$$`-tagged text + atoms + unbound-mention list + grounding/boundary signals as one
  structured output) and a separate **coach** call (next open prompt). Fold grounding + boundary
  detection into the scribe's structured output → **zero extra calls**.
- **Pure modules extracted** (for testability + correctness): `checkGrounding`, `resolveMentions`,
  `phaseStateMachine`, `assertActorsSubsetOfCast` — the LLM never *is* the gate.
- **Reliability (corrected, §11.5.1):** there is **no `withProviderReliability` wrapper** — compose
  the real primitives from `src/lib/ai-retry.ts` (`withRetry` + `CircuitBreaker`/`getCircuitBreaker`)
  around STT, scribe, coach, TTS, with a `gemini-stt` key. The breaker has **zero call sites today**,
  so this is its first real integration — **new work, not reuse**. **Don't inherit Pro.**
- **Loose structured-output schema + deterministic repair** (the pagination-flow lesson — strict
  schemas stochastically fail and Genkit rejects the whole response). **But fail-closed on the
  grounding gate (§11.5.2):** a malformed scribe decode must reject-and-re-scribe, never repair-then-
  pass-grounding.
- ⚠️ **UI reuse correction:** the friends `StoryGeneratorResponse` shapes are all *select-an-option*
  screens; the authoring turn surface (mic, story-so-far, recap, filmstrip) is a **new component**,
  not a `StoryBrowser` render-adapter. Budget for it.

**New routes** (all: TEST_MODE seam w/ fault-injection + moderation-verdict hooks §11.5.8, retry +
breaker, moderation §2.8):
- `POST /api/storyAuthor` — turn endpoint (auth + persona scope + ownership + idempotency).
- `POST /api/storyAuthor/transcribe` — audio → transcript (Flash). **Raw audio: never persisted,
  never logged, never attached to `captureException`** (tested, §6).
- `POST /api/kids/characters` — child-side character create (+ avatar-from-description; moderated).

**Reused unchanged:** `/api/storyCompile`, `/api/storybookV2/{create,pages,images,pageEdit}`,
`/api/entitlements/*`. ⚠️ **TTS streaming is net-new (§11.5.1):** `/api/tts` today buffers the whole
clip (`streamToBuffer` → base64 JSON) — the exact pattern the latency budget needs to avoid. A
**streaming TTS path must be built** for live prompts, with **text-hash caching** of repeated prompts.

**Mid-turn failure semantics (council §11):** STT may succeed then scribe/TTS fail. Write the
segment only after the full turn succeeds (or `status:'pending'` + reconcile), keyed by
`turnIdempotencyKey`, so a retry never double-appends or strands a half-authored story.

**Bridge (corrected):** on `finish`, follow the proven **friends-mode template** — write
`stories/{sessionId}` with the **unresolved `$$id$$`** narrative assembled from confirmed phases and
`actors` = resolved cast (force-include `childId` as actor[0], like every other mode), then add an
`authored` branch in `storyCompileFlow` that skips AI compilation and runs only synopsis + background
tasks. ⚠️ **`sceneSummary` pre-seed is NOT free reuse:** `story-pagination-flow` has no scene-input
channel and *generates* `imageScene` itself. Either **(a)** drop the pre-seed for v1 and let
pagination infer scenes as it does today (recommended — authored prose paginates fine), or **(b)**
scope an explicit pagination-flow change (move it to "Changed"). Do not claim both.

---

## 5. Privacy, safety & compliance (gates go-live)

This escalates PII sensitivity over today's posture — capturing a **child's voice** is significant.

The council (§11) rated this the **highest-stakes lens** and returned **NOT-READY-as-written** with
several BLOCKERs. Concrete requirements:

- **STT data path (decided §11.4): Vertex AI EU/UK region** — child voice is **not** sent to the
  consumer Gemini API (US-default). Residency is clean; still name Google/Vertex as an STT
  sub-processor in the privacy policy + sub-processor list, and ensure the DPA covers child audio.
- **Verifiable parental consent (BLOCKER, go-live):** a **server-side per-child consent record**
  (`authoringConsent`, §3) — not a localStorage flag. Lawful basis = **consent** (safer than LI for
  child voice); per-child, revocable (revocation deletes retained transcripts); records who/what/
  when/version. `enabled` gates per family on this record.
- **Transcribe-then-discard (enforced, not asserted):** prove in code — no persistence, no request
  log, no error-capture attachment; drop the `voiceRetention:'<ttl>'` option for launch.
- **Moderation + self-disclosed-PII + safeguarding:** see §2.8 (does not exist today — build it).
  Gate share-link creation / print of authored books behind parent review.
- **No analytics leakage:** extend the Sprint-1 no-PII contract — child audio/text never reach
  PostHog. Add authoring terms (`transcript`,`utterance`,`scribedText`,`segment`) to
  `FORBIDDEN_KEY_SUBSTRINGS`; telemetry is content-free scalars only (turn count, modality, arc
  step index, stuck bool, questions-per-phase, time-to-finish, per-turn latency).
- **DPIA (go-live):** UK GDPR Art.35 + ICO Children's Code almost certainly require one (children's
  data + innovative tech/voice). New deliverable.
- Mode ships **disabled-by-default**; the manual "consent copy reviewed" checkbox is upgraded to the
  deliverables above.

---

## 6. Tests / Definition of Done

**Test architecture (council §11):** *never assert a live-LLM output value in CI.* Three layers —
(1) **pure-logic vitest** on extracted modules (deterministic, blocking from day one); (2) **seamed
flow tests** via a new authoring TEST_MODE seam (control-flow, deterministic); (3) **e2e happy-path**
(TEST_MODE+emulator). Probabilistic *quality* lives only in a **nightly quarantined live-gen smoke**
with a tolerant threshold, never on the PR gate.

**Layer 1 — pure-logic unit (blocking):**
- [ ] **`checkGrounding` (headline)** — Tier-1 entity gate + Tier-2 provenance audit over a committed
      fixture corpus incl. **adversarial** cases (child "the dragon came" → reject added colour/
      chase; over-embellishing fixture → must be caught). *No LLM in this test.*
- [ ] **`resolveMentions`** — garbled name ("Wex"→Rex), pronoun×gender×presence narrowing,
      genuinely-ambiguous → "needs clarify" verdict (not a guess), tapped-avatar override.
- [ ] **`phaseStateMachine`** — legal transitions + **illegal** ones (confirm while authoring,
      amend a locked phase, finish with 0 confirmed phases); boundary-heuristic detectors.
- [ ] **`assertActorsSubsetOfCast`** — per-segment + compile-time `actors ⊆ cast`; child actor[0]
      force-included.

**Layer 2 — seamed flow (blocking, deterministic via TEST_MODE):**
- [ ] **Authoring TEST_MODE seam** (`buildTestModeAuthoringTurn`, `TEST_MODE_TRANSCRIPT`) — *this is
      foundation, not a checkbox* (E1 §11.3). Flow rejects-and-re-scribes on a grounding-violating
      fixture; defers non-blocking ambiguity to recap; clarifies on low confidence.
- [ ] **STT route** returns the fixture transcript without touching Gemini.
- [ ] **Transcribe-then-discard (privacy)** — no Firestore/Storage write contains audio; nothing
      attached to `captureException`.
- [ ] **Disabled-by-default / consent gate** — routes refuse and the generator is hidden when
      `enabled:false` / no `authoringConsent`. (Mirror the kill-switch test pattern in
      `src/lib/analytics/__tests__/analytics.test.ts`; `feature-flags.test.ts` doesn't exist — §11.5.1.)
- [ ] **Undo** — ship a minimal v1 session-alias map so this is testable against v1 scope, OR
      explicitly v2-defer the "rolls back discourse state" assertion (§11.5.8); **idempotency** — a
      retried turn (same key) does not double-write.
- [ ] **Parent-review-flag** — ambiguous + child declines after one ask → segment flagged → surfaces
      in W2-C page-edit.
- [ ] **Moderation** — unsafe fixture input blocked/redirected at all three points (incl. pre-TTS);
      self-disclosed-PII fixture flagged before compile; refusals mapped via `toUserSafeMessage`.
- [ ] **No-PII contract** — `FORBIDDEN_KEY_SUBSTRINGS` extended (`transcript`/`utterance`/
      `scribedText`/`segment`); content-free scalars pass, content fields rejected.
- [ ] **Compile-bridge** — confirmed phases → `stories/{id}` with **unresolved** `$$id$$` + correct
      `actors`; negative: a phase referencing a non-cast actor is caught before compile.
- [ ] **Question-budget** — `questionsAskedThisPhase` hard-capped per age band.

**Layer 3 — e2e (report-only → blocking after 3 cold green, per `docs/testing/e2e.md`):**
- [ ] **Playwright happy path** — text modality: choose mode → select/create character → author →
      finish → (TEST_MODE) storybook reaches art-ready. **WebKit report-only:** mic feature-detect +
      text-fallback.

**Nightly (quarantined, never PR-blocking):** live-gen grounding-quality smoke (≥threshold of
fixtures clean) — the only place a real Gemini scribe runs.

**Manual / spikes (gates):**
- [ ] **Pre-build spikes (§9):** Wizard-of-Oz voice loop with real 4/6/9-yr-olds; STT WER on
      young-child speech incl. cast names; per-turn latency (must hit p50 < 4s to first feedback).
- [ ] Child-developmental usability gate: ≥1 child in each band completes a story.
- [ ] Light-touch fidelity reads as the child's voice on 5 sample sessions.
- [ ] Consent/DPIA/DPA/sub-processor + safeguarding policy signed off (go-live).

**Gate:** `npm run typecheck` + `npm run build` + `npm run test` pass.

---

## 7. Files

**New:** `src/ai/flows/story-authoring-flow.ts`; pure modules `src/lib/authoring/{checkGrounding,
resolveMentions,phaseStateMachine,assertActorsSubsetOfCast}.ts` (+ `__fixtures__/`); a **moderation
module** (§2.8) + self-disclosed-PII detector; `src/app/api/storyAuthor/route.ts`,
`/transcribe/route.ts`, `src/app/api/kids/characters/route.ts`; authoring TEST_MODE seam in
`src/lib/test-mode.ts`; a **new** kids authoring UI component under `src/app/kids/` (mic/text turn
surface, story-so-far, recap, filmstrip — not a `StoryBrowser` adapter); `systemConfig/storyAuthoring`
+ `authoringConsent` + "Be the Author" generator seeds; tests.
**Changed:** `src/lib/types.ts` (session subcollection + character additions — Track A write-
priority), kids generator list, `src/lib/analytics/events.ts` (+`FORBIDDEN_KEY_SUBSTRINGS`),
`storyCompileFlow` (`authored` branch), `ai-circuit-breaker`/provider keys (`gemini-stt`), firestore
rules + TTL config; **possibly** `story-pagination-flow.ts` *iff* `sceneSummary` pre-seed is chosen
(§4 — otherwise unchanged).
**Docs:** `SCHEMA.md` (session/character/config fields), `API.md` (new routes),
`SYSTEM_DESIGN.md` (new "Child-Authored Stories" component + STT integration + voice-PII handling),
`CHANGES.md` (on push), regression tests for the new routes.

---

## 8. Risks & mitigations

| Risk | Mitigation |
|---|---|
| Agent drifts into authoring (becomes "AI wrote it") | System prompt forbids plot; grounding check (§6); fidelity dial defaults light-touch |
| Pre-reader blocked if STT fails | Always-available text fallback; parent assist; feature-detect mic |
| Child voice = sensitive PII | Transcribe-then-discard; no analytics; consent gate before enable |
| Child stalls / frustration loop | Arc-aware open nudges; question-only scaffolds; child-controlled early finish; undo |
| Output too rough for print | Fidelity dial; light-touch default; parent per-page edit already exists (W2-C) |
| Unsafe child-generated content | Moderate input + output; user-safe redirects, never raw refusals |
| Safari/iOS audio capture flakiness | `MediaRecorder` feature-detect + text fallback; WebKit report-only e2e |
| Placeholder/entity drift on compile | Friends-mode bridge template; **unresolved** `$$id$$` written; bridge test (§6) |
| **Wrong character resolved → wrong character drawn** | Closed-world linking + clarify-don't-guess + tappable cast + compile-time `actors ⊆ cast` assert (§2.6 v1) |
| **Grounding guarantee gives false-green (LLM judges LLM)** | Deterministic entity + provenance gates; independent-model semantic check report-only (§2.2) |
| **Moderation assumed but absent in codebase** | Build the §2.8 module before wiring scribe/recap/TTS/compile |
| **Per-turn latency 6–12s ≫ child patience** | Flash tier; stream TTS; show text before audio; filler; latency spike gates voice-first (§9) |
| **~10× call blow-up / per-book cost** | Flash for scribe+STT; fold grounding/boundary into scribe; TTS text-hash cache; per-book cost telemetry |
| **Hot session doc / 1 MiB / unbounded growth** | Segments in a subcollection; TTL on authoring data (§3) |
| **STT child-voice residency / "no new DPA" false** | Owner decision Vertex-EU vs DPA (§11.4); sub-processor list update |
| **Unusable for the younger half of 4–9** | Age bands + Little-Author reductions + Parent-Assist mode (§2.7) |

---

## 9. Sequencing within the sprint

0. **Pre-build spikes (de-risk — council §11). Tooling built: [`spikes/`](../../spikes/README.md).**
   Wizard-of-Oz voice loop with real 4/6/9-yr-olds (`spikes/woz/` — zero-dep puppet server, no
   creds; validates the age-band/recap/comprehension design before code); STT WER + name-error-rate
   on young-child speech (`spikes/stt/`, Vertex-EU); per-turn latency + streaming-TTS prototype
   (`spikes/latency/`). Voice-first is committed (§11.4) — the latency spike validates/hardens the
   §2.3 mitigations rather than choosing the modality. **Blocker on owner:** a Vertex-EU project +
   creds (spikes 2–3) and recruited children + consent (spike 1).
1. **Foundation** — types + **segments subcollection** + TTL; `systemConfig/storyAuthoring` +
   `authoringConsent` + generator seed (disabled); **Vertex-EU STT wiring**; **TEST_MODE authoring
   seam**; **moderation module skeleton** (§2.8) wired as a no-op hook at all three points.
2. **Authoring flow with phases (text path first for determinism)** — extracted pure modules
   (`checkGrounding`, `resolveMentions`, `phaseStateMachine`) with their vitest corpora *first*; then
   the Flash scribe/coach calls + the **full phase state machine + boundary recap/clarify (§2.7,
   built up front per §11.4)** + idempotency + reliability wrapping. Carries the headline tests.
   *Text path is exercised first only because it's deterministic to test — not a separate milestone.*
3. **Age bands** — both **Little Author (4–6)** and **Big Author (7–9)** (§2.7) + server-enforced
   question budget + **Parent-Assist** mode.
4. **Characters** — Friends-selection reuse + child create + AI-avatar-from-description (moderated).
5. **Compile bridge + e2e** — confirmed phases → unresolved `$$id$$` via the friends-mode template;
   run through the existing pipeline (TEST_MODE). (Pagination pre-seed only if §4 option (b) chosen.)
6. **Voice (committed core)** — Vertex-EU STT + streaming prompt TTS + tap-to-talk UI + text fallback,
   meeting the §2.3 latency budget.
7. **Safety & privacy** — full moderation + self-disclosed-PII detector + share/print gating +
   transcribe-then-discard guarantees + content-free telemetry + no-PII contract extension.
8. **DoD + docs + consent/DPIA gate** — tests green; docs updated; ship disabled-by-default; go-live
   gated on the §5 compliance deliverables.

---

## 10. Out of scope (candidate follow-ups)

- Photo-based avatars for child-created characters (consent/safety — parent-gated, later).
- Collaborative / multi-child co-authoring.
- Editing a *finished* authored story's text from the kids surface (parent page-edit covers print).
- Blind A/B of scribe vs co-author output quality (do once the dial has real sessions to compare).
- **v2 of the authoring engine** (deferred from v1 per council): Double Metaphone + child-phonology
  table + persisted `phoneticKeys`; full discourse-state resolver; the fidelity dial.

---

## 11. Council Review (v2 — 2026-06-23)

Six specialist reviewers assessed the v1 plan against the live codebase. **Consensus: the
architecture is sound** — closed-world entity linking, authorship-agnostic downstream reuse, and
phased recap are the right ideas — **but v1 oversold three things that don't exist or can't work as
written, and treated "4–9" as one user.** The body above (§§1–10) is revised accordingly.

### 11.1 Verdicts by lens
| Lens | Verdict | Sharpest finding |
|---|---|---|
| Simplicity & reuse | Sound, **over-scoped** | `sceneSummary→pagination` is a *false* reuse claim (no scene-input channel); `StoryBrowser`/`messages` reuse oversold; §2.6/§2.7 are research-grade for v1. Bridge is low-risk — friends-mode already paved it. |
| AI/ML correctness | **Two redesigns needed** | A single LLM-judge grounding check is circular → false-green on the headline feature. "Moderation = reuse `toUserSafeMessage`" is false — it's an error mapper; no moderation/`safetySettings` exist. |
| Testability | **Foundation under-budgeted** | Most §6 tests aren't deterministic as written; needs an authoring TEST_MODE seam (E1) + guarantees extracted as pure modules (E2), else the headline test "tests nothing." |
| Child safety & privacy | **NOT-READY as written** | 3 BLOCKERs: consumer-Gemini STT ≠ "no new DPA" (US residency, child voice); no moderation; self-disclosed PII → **public share + print**. |
| Scalability/cost/latency | **Viability risk** | ~10× call blow-up (4–7 → 40–100 dialog calls), inherits Pro; per-turn ~6–12s ≫ a child's 2–4s patience; hot session-doc array. |
| UX / child-dev fit | **"4–9 is two products"** | No younger-age path; no enforced question budget; Parent-Assist leaned on but unbuilt; no latency budget. |

### 11.2 Must-fix **before build** (shape the architecture)
1. **Redesign the grounding guarantee** → deterministic entity gate + provenance audit; independent-model semantic check report-only only (§2.2).
2. **Build a real moderation module** + self-disclosed-PII detector at three insertion points (§2.8) — it does not exist today.
3. **Decide & wire the STT data path** (Vertex-EU vs consumer+DPA) and strike "no new DPA" (§2.3/§5/§11.4).
4. **Add the authoring TEST_MODE seam + extract guarantees as pure modules** (`checkGrounding`/`resolveMentions`/`phaseStateMachine`) (§4/§6).
5. **Segments → subcollection + TTL**; not an embedded array on the hot session doc (§3).
6. **Pin Flash + low temp; split scribe/coach; fold grounding/boundary into scribe output; reliability-wrap + idempotency + mid-turn semantics** (§4).
7. **Age-band split + server-enforced question budget + Parent-Assist mode** (§2.7).
8. **Run the pre-build spikes** (WoZ usability, STT WER, latency) — they can invalidate voice-first cheaply (§9.0).
9. **Simplify §2.6 to v1 scope** (defer metaphone/discourse-state; confidence from the deterministic pre-pass, not the LLM).

### 11.3 Must-fix **before go-live** (flip `enabled`)
Verifiable **server-side parental consent** (per child, revocable) · **DPIA** · executed **DPA + sub-processor-list + privacy-policy** updates naming Google for STT · EU/UK residency confirmed · **safeguarding/escalation policy** · parent-review share/print gate live + `childName`-at-review choice (§11.6) · **age-assurance control + child DSAR/erasure path** (§11.5.5) · the no-PII analytics test extended to authoring telemetry.

### 11.4 Owner decisions — RESOLVED (2026-06-23)
- **STT data path → Vertex AI EU/UK region.** Clean residency for child voice; consumer Gemini ruled
  out. (§2.3, §5 updated.)
- **Voice-first → committed.** Not gated on the spike; the §2.3 latency mitigations become mandatory
  DoD, and the spike validates/hardens them. (§2.3, §9.0 updated.)
- **Age bands → both Little (4–6) + Big (7–9) Author in v1.** (§2.7, §9.3.)
- **Phases → built from the start.** Full phase state machine + recap up front, not a deferred
  increment. (§2.7, §9.2.) *Trade-off accepted: more complex machinery before the scribe loop is
  battle-tested; mitigated by extracting `phaseStateMachine` as a pure, exhaustively-tested module.*

> **Supersedes §11.5's open-decision framing.** §11.5 was written while these four were still open, so
> it flags "flat-stream-first vs phases" (its §11.5.9 "highest-leverage owner call") and "commit to
> one" as live. They are now **decided: phases from the start.** §11.5's *technical* findings
> (phantom reuse 11.5.1, grounding leaks 11.5.2, fat-call contradiction 11.5.3, abandoned-compute
> 11.5.4, compiled-book PII 11.5.5, v1 bind-check 11.5.6, Parent-Assist authorship 11.5.7) **all
> still stand** — choosing phases narrows none of them; if anything 11.5.4/11.5.7 grow, so their
> mitigations are mandatory, not optional.

> **Process note:** v1's three design pillars (scribe-not-inventor, always-know-who, phased recap)
> survived review intact. What changed is *how much to build at once* and *which safety/compliance
> foundations are prerequisites, not follow-ups*. The council did not weaken the vision — it moved
> the load-bearing walls to the bottom.

---

### 11.5 Second council pass — validation of v2 (2026-06-23)

The six lenses were re-run against the **current v2 plan** (not v1), each verifying claims against the
live codebase. **Consensus: architecture sound, build is GREEN behind the flag, flipping `enabled`
is NO-GO** — the same shape as the v1 verdict, but one layer deeper. v2 correctly fixed every
*specific* v1 finding, then re-introduced the *same class* of error one level down: it leans on reuse
anchors that do not exist as named. The pillars still stand; the load-bearing walls moved again.

**Per-lens, did v2 resolve its v1 finding?**

| Lens | v2 status | Residual |
|---|---|---|
| Simplicity & reuse | **Resolved** | Body still written around phases while §11.4 recommends flat-stream-first; commit to one. |
| AI/ML correctness | **Partial** | Moderation fix solid; grounding redesign still leaks (11.5.2). |
| Testability | **Partial** | Architecture now deterministic; rests on phantom reuse anchors (11.5.1). |
| Child safety & privacy | **Partial** | 3 BLOCKERs correctly planned; new deletion / compiled-book-PII / age-assurance gaps (11.5.5). |
| Scalability/cost/latency | **Partial** | Pro & hot-doc resolved; latency budget rests on unbuilt streaming TTS (11.5.1); abandoned-session compute unaddressed (11.5.4). |
| UX / child-dev fit | **Partial** | Bands + budget + Parent-Assist specced; age-4 floor and Parent-Assist authorship still soft (11.5.7). |

#### 11.5.1 The convergent new finding — **phantom reuse** (3+ lenses, independently)

The plan repeatedly says "reuse / extend / stream the existing X" for infrastructure that is absent or
differently shaped. Verified against code:

- **`withProviderReliability` does not exist.** Reliability is `withRetry` + `CircuitBreaker` /
  `getCircuitBreaker` in `src/lib/ai-retry.ts`, and the breaker has **zero call sites** today
  (`withRetry` is wired into exactly one route). The authoring flow would be the breaker's first real
  integration — new work, not reuse. The `gemini-stt` "provider key" reuse is genuine (keys exist),
  but the composed wrapper the doc names must be authored. *(Strike the name throughout §4/§7.)*
- **Streaming `/api/tts` does not exist.** `src/app/api/tts/route.ts:168` drains the whole clip via
  `streamToBuffer` and returns base64 JSON — buffer-then-return, *exactly what §2.3 says to avoid*.
  The entire `p50 < 4s` thesis ("show text now, stream audio") rests on unbuilt streaming. The §9.0
  latency spike is therefore mandatory, not optional, and TTS streaming is net-new build.
- **The "W1/W3 e2e net → art-ready" does not exist.** `e2e/` contains one spec (`login.smoke.spec.ts`).
  Exit criterion 4 chains into a storybook-pipeline e2e that must be **built**, plus the new authoring
  spec.
- **`feature-flags.test.ts` and `docs/testing/e2e.md`'s "report-only → blocking after 3 cold green"
  process do not exist.** Mirror the kill-switch test at `src/lib/analytics/__tests__/analytics.test.ts:80-103`;
  the promotion process must be written, not cited.
- **The one fully-true reuse anchor — the no-PII `findPiiViolation` contract — has a trap.**
  `FORBIDDEN_KEY_SUBSTRINGS` (`src/lib/analytics/events.ts`) already contains `'text'` and `'name'`,
  so `scribedText` is *already* forbidden; the load-bearing half of the test is proving the **allowed**
  content-free scalars (`arcStepIndex`, `questionsPerPhase`, modality) survive an already-greedy
  blocklist. Only `transcript`/`utterance`/`segment` are genuinely new substrings.

**Action (must-fix before build):** a **reuse-accounting pass** that strikes the phantom anchors and
re-budgets each as new work. This is the recurring failure mode the council has now caught twice.

#### 11.5.2 Grounding still leaks (AI/ML + testability)

The Tier-1/Tier-2 redesign is the right *shape*, but as written it does not yet deliver the headline
guarantee:

- **Tier-1 `extractEntityIds(scribedText) ⊆ cast` cannot catch the failure it claims.**
  `extractEntityIds` (`src/lib/entity-utils.ts`) only sees IDs the model already wrapped in `$$…$$`;
  an untagged invention ("a wizard helped them", no placeholder) passes the subset test trivially. The
  *real* gate is the separate "reject new proper-noun token not phonetically in transcript" clause —
  a different, NLP-flavoured mechanism that the doc bundles in as if it were the same "pure string
  logic." Spec it explicitly.
- **Common-noun / verb invention bypasses Tier-1 entirely.** "Then a monster ate them" introduces a
  character and a plot event in lowercase common words. Tier-1 by construction only sees proper
  nouns/IDs → this must be explicitly delegated to Tier-2, not left in the gap.
- **Tier-1 false positives collide with the scribe's job.** Light-touch *fixes capitalisation*
  (§2.2), so a legitimately proper-cased word ("the Dragon") looks like a "new capitalised token."
  Capitalisation-normalisation and proper-noun-invention-detection are in direct tension and must be
  reconciled in the spec.
- **Tier-2 `sourceSpan` is bypassable by confabulated attribution.** Fuzzy span-membership proves
  *a span exists*, not *that the span entails the atom*. Require each atom content-word
  (subject/verb/object) to be independently present/derivable in the cited span.
- **Missing fail-closed invariant.** A malformed/partial scribe structured-output must **reject and
  re-scribe**, never deterministic-repair-then-run-grounding — otherwise §4's repair path produces a
  **false-green on the headline feature**. State this invariant explicitly.

#### 11.5.3 The single fat scribe call contradicts itself (AI/ML + scalability + testability)

§4 mandates one scribe call emitting text + `atoms[]` + `sourceSpan` + unbound-mentions + grounding +
boundary signals ("zero extra calls"); §2.2 mandates **splitting** scribe from coach because mixing
objectives "degrades both." Both cannot be the cost/latency story. The richer structured output also
maximally exposes the exact stochastic-failure mode the doc cites from pagination
(`story-pagination-flow.ts` uses permissive validation + raw-JSON repair precisely because strict
schemas fail), and here a malformed decode is the grounding gate's input. Decide: is the atom payload
a *separate* low-temp call, or folded — and reconcile with the split-call mandate and the fail-closed
rule (11.5.2).

#### 11.5.4 Abandoned-session compute is unaddressed (scalability — new)

TTL (`expireAt`, pattern at `src/lib/session-events.server.ts`) reclaims **storage, not compute**. An
authored session is ~3 model calls/turn for 12–25 turns; a child who quits at turn 15 consumes **no
entitlement** (compile never runs) yet has burned 30–45 Flash calls + STT. Unlike AI-authored modes
(cost bounded by a completed artifact), authoring cost is unbounded by abandonment and uncapped by
entitlements. Add a **server-side per-session turn cap** and an abandoned-session cost ceiling, not
just per-book telemetry.

#### 11.5.5 "Downstream is free" is false for authored books (privacy)

The §0/§2.5 framing holds for AI-invented stories; for **child-narrated** stories the compiled
`stories/{id}.storyText` *is* self-disclosed child PII rendered to a printable + publicly shareable
object. Confirmed surfaces:

- **Public share is unauthenticated and leaks `childName`.** `src/app/api/storyBook/share/route.ts`
  GET takes only an 8-hex-char `shareId` (`randomBytes(4)` ≈ **32 bits**, brute-forceable at scale),
  returns `metadata.childName` + every page's body/audio; `requiresPasscode` is opt-out by default.
  For authored books: default passcode-on, raise token entropy, and decide the `childName`-exposure
  question (already in §11.3).
- **Revocation vs transcribe-then-discard is inconsistent.** Raw audio is discarded but the
  *transcript is retained* (it is the story). "Revocation deletes retained transcripts" must therefore
  be a **cascading deletion** — segments subcollection → compiled `stories/{id}` → storybook → share
  tokens → queued print orders. Bake `childId`/`parentUid` provenance into every derived doc so
  erasure is queryable. Enumerate this before the schema sets.
- **Compiled book has no TTL and no child-subject deletion path.** The §2.8 TTL covers abandoned
  *sessions*, not the finished artifact.
- **§11.3 go-live gate is missing two ICO Children's-Code items:** a named **age-assurance** control
  (the design forks on a *parent-confirmed* band — make it an explicit signed-off control) and a
  **child DSAR / erasure path** covering compiled books + print orders.
- **Safeguarding disclosures need a distinct classifier**, not the moderation blocklist: a distressing
  *disclosure* (not unsafe content) flows transcript → scribe → recap-aloud before a flag-for-parent
  stance engages. Wire it into the pipeline, don't leave it as a documented stance only.

#### 11.5.6 §2.6 confident-bind leak (AI/ML)

The stated principle — "the LLM only *proposes*, the deterministic pre-pass *resolves*" — is violated
in v1 scope, because the deterministic phonetic/edit-distance pre-pass is **v2-deferred** (§2.6 v1
scoping). So the LLM's *confident* inline `$$id$$` binds flow straight into the L5 `actors ⊆ cast`
assert and into image rendering with **no** independent check; the clarify net only fires on mentions
the LLM self-flagged as unsure. A confident-but-wrong bind ("Wex"→`$$rex$$`) silently draws the wrong
character. **Run even v1 name-derived binds through a cheap deterministic edit-distance sanity check**,
not only the LLM-flagged-unsure ones.

#### 11.5.7 Parent-Assist inverts the authorship promise; age-4 floor is soft (UX)

- **Parent-Assist as the *default* for ages 4–5 means the parent authors**, and the §2.2 grounding
  guarantee then validates against the *parent's* words — the sprint's defining promise (§0) is
  quietly inverted for a large slice of the target span. Take an explicit stance: either Parent-Assist
  is **scaffolding-only** (parent prompts/encourages, child supplies content), or accept the 4–5
  artifact is **co-authored** and stop claiming the authorship guarantee for it.
- **Parent-Assist is specified at toggle-level** (`parentAssist?: boolean`) — no turn-ownership,
  provenance tagging, child-engagement, or exit/re-entry flow. That under-specification is how v1's
  Parent-Assist became a finding; it will be improvised at build time again unless given a schema and
  flow states.
- **Age-4 is not credibly served by a voice turn-loop.** The §9.0 WoZ spike must be **empowered to
  re-scope** ("≈6–9, with a co-creation mode below"), not merely tune timings; and the exit criterion
  ("≥1 child per band completes a story") must prove the *child* authored, not a parent-assisted pass.
- **Two v2 additions create new abrupt-cutoff risks:** recap reads back the *whole* accumulating phase
  (fatigue for a 5-year-old — needs a Little-Author "just the new bit" mode), and the hard question-cap
  silently drops a *genuine* ambiguity (must be voiced as "got it!", never silence). Moderation
  "redirect kindly" needs a defined child-facing UX and a "never refuse the same idea twice without a
  steer" rule to avoid redirect→repeat loops.

#### 11.5.8 Testability contradiction (carry-over)

§6's "undo rolls back discourse state + learned aliases" asserts behaviour of **v2-deferred** code (the
discourse-state object is deferred in §2.6). Either ship a minimal v1 session-alias map so the test is
real, or explicitly v2-defer the assertion — do not leave a test that asserts nothing against v1 scope.
The authoring TEST_MODE seam must also expose **fault-injection** (`scribe`/`tts` failure) and a
**moderation-verdict** hook, or mid-turn idempotency and moderation cannot be Layer-2 deterministic.

#### 11.5.9 Net delta to the plan

No change to the top-line: **PLANNED, build green behind the flag, do not flip `enabled`.** The new
build-blocking additions on top of §11.2 are: **(a)** the reuse-accounting pass (11.5.1); **(b)** the
grounding fail-closed invariant + Tier-1/Tier-2 boundary spec (11.5.2); **(c)** resolve the fat-call
vs split-call contradiction (11.5.3); **(d)** a per-session turn/compute cap (11.5.4); **(e)** the
cascading-deletion + compiled-book-PII model (11.5.5, before schema sets); **(f)** the §2.6 v1
deterministic bind-check (11.5.6). New go-live additions: age-assurance + child DSAR/erasure
(11.5.5). And the highest-leverage owner call remains §11.4 #4 (**flat-stream-first vs phases**),
which several of the above shrink dramatically if flat-stream leads.

### 11.6 Owner decisions, round 2 — RESOLVED (2026-06-23)
- **Parent-Assist → HYBRID** (scaffolding-only default + opt-in, distinctly-labelled "help me tell it
  together" co-author sub-mode). Provenance per segment (`author`), modes are a schema + state-machine
  concern. (§2.7 updated.) *The child-authored guarantee holds in scaffolding; it is explicitly NOT
  claimed for the co-author sub-mode, whose output is labelled "co-created."*
- **Share/print of authored books → GATED behind parent review.** No public share link or print order
  until a parent approves; passcode-on + higher token entropy when approved; `childName`-exposure
  decided at the review step. (§2.8 updated; supersedes the "decide childName exposure" open item in
  §11.3/§11.5.5.)
- **Spec sequencing → SPIKES FIRST.** Spike-*dependent* specs (voice/UX, phase cadence, age floor,
  Parent-Assist interaction) wait until the three §9.0 spikes report. The **grounding mechanism spec
  (§12.1) is spike-independent** and is written now.

---

## 12. Implementation specs (post-decision)

> Per §11.6, only the **spike-independent** grounding spec is written now; the spike-dependent specs
> (reference-resolution v1 bind-check, phase state machine, moderation/safeguarding, self-disclosed-PII,
> Parent-Assist flow, compile bridge) follow once the §9.0 spikes report.

### 12.1 Grounding mechanism — implementable spec

The guarantee: the **scribe** (the model that turns a child turn into a story segment) introduces no
entity or event the child didn't supply, at the configured fidelity (v1 ships `light` only). The check
is **deterministic, fail-closed, and testable without a live LLM**. The LLM *produces*; code *judges*.

**Resolves the fat-call vs split-call contradiction (§11.5.3).** Two LLM calls per turn:
1. **scribe** (low temp ~0.1–0.2) — one call emitting a single structured output (all *fidelity* tasks,
   mutually consistent): `scribedText`, `atoms[]`, `unboundMentions[]`, `boundarySignal`. Combining
   these is fine — they are the same "stay faithful" objective.
2. **coach** (separate call) — the next open prompt (a *generative* objective; kept apart so "add
   nothing" and "invent a question" never share one decode).
Grounding **checking is deterministic post-processing — zero extra LLM calls.** ("Zero extra calls"
in §4 means the *check* is code, not that boundary/coach are free.)

**Scribe structured output (permissive schema + repair on non-grounding fields only):**
```
{ scribedText: string,                       // light-touch; character refs wrapped $$id$$
  atoms: [ { subject: actorId,               // resolved actor (see §2.6); or "$$unbound$$"
             verb: string, object?: string,
             sourceSpan: string } ],          // VERBATIM substring of the cited source
  unboundMentions: [ { surface: string, candidates: actorId[] } ],
  boundarySignal: 'continue' | 'phase_end' | 'story_end' }
```

**The check — `checkGrounding(childInputRaw, priorConfirmedText, scribed, cast) → {ok, violations[]}` (pure):**

*Tier 1 — entity grounding*
- **T1a tagged-subset:** every `$$id$$` in `scribedText` ∈ `cast`. (Catches tagged out-of-cast.)
- **T1b proper-noun invention:** tokenize `scribedText`; for each capitalised token that is *not*
  sentence-initial, *not* a cast name/alias, and *not* `$$id$$`-wrapped, require a **case-insensitive /
  phonetic** match in `childInputRaw`. *Reconciles the capitalisation-fix tension (§11.5.2):* the check
  is **lexical presence, not casing** — the scribe may up-case a name the child said lowercase; it may
  not introduce a name absent from the transcript.

*Tier 2 — event/detail grounding (provenance + entailment)*
- **T2a provenance:** every atom's `sourceSpan` is a fuzzy substring of `childInputRaw` **or** of
  `priorConfirmedText` (continuity from a *confirmed* earlier segment is legitimate, tagged as such —
  so persisted location/facts don't read as invention).
- **T2b entailment (closes the confabulated-span bypass, §11.5.2):** each atom **content word**
  (subject name/alias, verb lemma, object head noun) must be present-or-derivable **within the cited
  span**, not merely somewhere in the transcript. "Derivable" = inflection (ran/run) or the cast alias
  map (doggy→`$$dog$$`) only; anything else → violation.
- **T2c common-noun new entity/event (closes the Tier-1 gap, §11.5.2):** an atom subject/object naming
  a **new animate entity** not in `cast` and with no span provenance (e.g. lowercase "monster" in
  "then a monster ate them") → violation. This is where common-noun invention is caught.

*Fail-closed invariant (§11.5.2)*
- Malformed/partial scribe output in any **grounding-relevant** field (`atoms`, `sourceSpan`, tags) →
  **reject and re-scribe**; never deterministic-repair-then-pass. Repair is permitted only on
  non-grounding fields.
- On any T1/T2 violation → re-scribe with a corrective instruction (≤2 retries) → if still failing,
  fall back to **near-verbatim scribe** (clean spelling/grammar of `childInputRaw` only — grounded by
  construction) and **flag for parent review** if it still can't be cleanly tagged.

*Unbound subjects* — an atom whose `subject` is `$$unbound$$` (the resolver couldn't bind a pronoun/
mention) does **not** get fabricated; it triggers the §2.6 clarify path (or defers to the phase recap).

**Fidelity dial:** spec the `light` thresholds above; `scribe` tightens T2b (no synonym latitude),
`coauthor` relaxes T2 (connective detail allowed) — both are config stubs, not v1 behaviour.

**The LLM is never the judge.** `checkGrounding` is the blocking gate. An optional semantic check may
run on an **independent model** (e.g. Claude), **report-only**, validated against a labelled gold set —
it never blocks and never re-scribes.

**Tests (headline, deterministic, no LLM):** `checkGrounding` unit table over a committed fixture
corpus, incl. adversarial cases — added detail ("the dragon"→"the **green** dragon", no basis → T2b
object violation); added character (lowercase "monster" → T2c); confabulated span (real span cited,
doesn't entail → T2b); legitimate cap-fix (child "rex"→"Rex" → pass); alias synonym (child "doggy"→
`$$dog$$` → pass); continuity (atom cites prior confirmed text → pass). A **seamed flow test** feeds a
violating fixture as the scribe output and asserts reject-and-re-scribe + the fail-closed fallback.
