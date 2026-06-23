# Sprint CA — Child-Authored Stories ("Be the Author")

> **Status**: Planned · **Priority**: High · **Dev todo**: file one when started (program item)
> **Tracks**: A — Reliability/Flows (primary), C — UX, B — Ops (telemetry/route tail)
> **Depends on**: W1-A degraded-book contract; W2-C parent page-edit; W4-A persona cookie;
> Sprint-1 analytics no-PII contract (extended here to child voice).
> **Decisions locked (owner, 2026-06-23)**: voice-first w/ text fallback · tunable fidelity dial
> defaulting light-touch · child character creation = name+traits+AI-avatar-from-description (no
> photo) · target span ages 4–9 with voice bridging literacy.

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
2. A child authors a multi-segment story via an open-ended dialog (voice-first; text fallback;
   agent prompts spoken aloud), with **undo** and a child-controlled finish.
3. An automated **fidelity/grounding check** shows the agent introduces no named entity or plot
   event absent from the child's contributions (light-touch default).
4. Finishing compiles to a normal `stories/{id}` doc and reaches **art-ready** through the
   existing storybook pipeline under `TEST_MODE` (reuses the W1/W3 e2e net).
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
        │   agent speaks an OPEN prompt (TTS)  ─┐
        │   child answers (voice → STT, or text) │  loop, arc-aware,
        │   agent scribes child's words → segment│  undo supported
        │   agent appends + asks the next prompt ─┘
        │   child (or agent-detected natural end) → "Is that the end?"
        ▼
[finish] → /api/storyCompile (UNCHANGED) → stories/{id}
        ▼
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

**Authorship guarantee.** The system prompt forbids introducing plot; a cheap post-step
**grounding check** verifies the scribed segment's named entities and events are present in the
child's input. Violations are rejected and re-scribed. This check is the contract that makes this
mode genuinely child-authored, and it is the sprint's headline automated test (§6).

**Fidelity dial.** `systemConfig/storyAuthoring.fidelity ∈ {scribe, light, coauthor}`, default
`light`. Lets the owner move the scribe↔co-author balance after seeing real output, no deploy.

### 2.3 Voice (modality)

- **Capture**: browser `MediaRecorder` on a big tap-to-talk mic (kid-first); feature-detected with
  graceful **text fallback** (Safari audio history — see Risks).
- **STT**: **Gemini multimodal audio** (already our model provider — no new vendor, no new DPA).
  New thin route transcribes; raw audio is **not persisted** beyond the request by default.
- **Agent voice**: prompts read aloud via the **existing TTS** path (ElevenLabs / story-audio).
  This closes a fully oral loop for pre-readers: agent speaks → child speaks → agent speaks.
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
| Compile | `storyCompileFlow` (authorship-agnostic) | thin bridge: segments → `storyText` w/ `$$id$$` |
| Pagination/images/exemplars/audio | entire pipeline | — |
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

---

## 3. Data model changes

**`storySessions/{id}`** (additive):
- `storyMode: 'authored'`
- `currentPhase`: add `'authoring'`
- `authoredSegments?: AuthoredSegment[]` — `{ id, order, childInputRaw, scribedText, actorIds[],
  arcStep, inputModality: 'voice'|'text', createdAt }`
- `authoringArcStepIndex?: number`
- `authoringFidelity?: 'scribe'|'light'|'coauthor'` (snapshot at session start)
- `authoringComplete?: boolean`

**`characters/{id}`** (additive): `createdVia?: 'parent'|'ai'|'child_authoring'`;
`aliases?: string[]`; `phoneticKeys?: string[]` (precomputed, for reference resolution §2.6).

**Discourse state** for resolution (extends the existing `worldState` on the session):
`presentActorIds`, `salienceOrder`, `lastSubjectActorId`, `pronounAntecedents { she?, he?, they? }`,
`sessionAliases { alias → actorId }`. Per `authoredSegments[]` entry also stores resolved mentions
+ confidence (for undo and the parent-review flag).

**`systemConfig/storyAuthoring`** (new config doc): `{ enabled, fidelity, arcEnabled,
defaultModality, voiceRetention: 'discard'|'<ttl>' }`. Disabled-by-default (consistent with the
cautious-rollout pattern), behind a flag until the consent gate clears.

**Generator doc** (`storyGenerators`, Firestore-driven, `status=live`/`enabledForKids`): seed a
"Be the Author" generator with its scribe + coach prompt configs; ships **disabled** until §5 gate.

Story compile output is **unchanged** (`stories/{id}.storyText` with `$$id$$` placeholders).

---

## 4. API & flows

**New flow** `src/ai/flows/story-authoring-flow.ts` — the scribe+coach turn loop (§2.2): input
`{ sessionId, contribution?, action: 'start'|'continue'|'undo'|'finish'|'help' }`; output
`{ ok, agentPrompt, storySoFar, arcStep, phase, canFinish }`. Mirrors the
`StoryGeneratorResponse` shape so the existing `StoryBrowser` renders it.

**New routes:**
- `POST /api/storyAuthor` — the turn endpoint (auth + persona scope + ownership).
- `POST /api/storyAuthor/transcribe` — audio → transcript via Gemini (raw audio discarded).
- `POST /api/kids/characters` — child-side character create (+ avatar-from-description).

**Reused unchanged:** `/api/storyCompile`, `/api/storybookV2/{create,pages,images,pageEdit}`,
`/api/entitlements/*`, TTS route.

**Bridge:** on `finish`, assemble `authoredSegments[].scribedText` into the canonical narrative
with `$$id$$` placeholders (entity tags from each segment), then call the existing compile path —
which consumes `story_allowance` and writes `stories/{id}` exactly as today.

---

## 5. Privacy, safety & compliance (gates go-live)

This escalates PII sensitivity over today's posture — capturing a **child's voice** is significant.

- **Transcribe-then-discard**: raw child audio is not persisted by default; only the transcript
  (story content, handled like other story text) is kept.
- **No analytics leakage**: extend the Sprint-1 no-PII contract — child audio and story text never
  reach PostHog. Authoring telemetry is **content-free only**: turn count, modality, arc step,
  stuck events, time-to-finish.
- **Content moderation** (kids product): moderate **both** the child's input and any agent text;
  block/redirect unsafe content; never surface a raw model refusal to a child (reuse
  `toUserSafeMessage`).
- **Parental consent for voice capture** — a documented consent + lawful-basis gate, analogous to
  the Sprint-1 analytics gate. Mode ships **disabled-by-default**; flip on per
  `systemConfig/storyAuthoring.enabled` once consent copy + retention are signed off.

---

## 6. Tests / Definition of Done

**Automated (extends the CI vitest + e2e nets):**
- [ ] **Authorship grounding test (headline)** — for a set of child contributions, the scribed
      segment introduces **no** named entity or plot event absent from the input; violations are
      rejected/re-scribed.
- [ ] **Compile-bridge test** — authored segments → valid `stories/{id}` with `$$id$$`
      placeholders resolving to the selected/created actors.
- [ ] **Reference-resolution suite (§2.6)** — phonetic match binds garbled names ("Wex"→Rex);
      pronoun + gender + presence narrows correctly; a genuinely ambiguous mention triggers a
      clarify turn (not a silent guess); a tapped avatar overrides resolution; compile asserts
      `imageScene.actors ⊆ cast`.
- [ ] **Undo** pops the last segment and rolls back the arc step; **finish** is gated on ≥1 segment.
- [ ] **STT route** returns a transcript for a fixture audio (Gemini mocked under `TEST_MODE`).
- [ ] **Child-created character** persists with `createdVia:'child_authoring'`, gets an avatar,
      and appears in the parent character list.
- [ ] **No-PII contract** (extend Sprint-1): authoring telemetry carries no audio/text.
- [ ] **Playwright happy path** — text modality, deterministic: choose mode → select/create
      character → author 3 segments → finish → (`TEST_MODE`) storybook reaches art-ready.
      Report-only first; promote to blocking after green (per `docs/testing/e2e.md`).
- [ ] **WebKit (report-only)** — mic capture feature-detect + text-fallback smoke.

**Manual (not automatable):**
- [ ] Voice loop end-to-end on a real device (agent speaks, child speaks, transcript is faithful).
- [ ] Light-touch fidelity reads as the child's voice, not the model's, on 5 sample sessions.
- [ ] Consent copy + voice-retention policy reviewed/signed off (go-live gate).

**Gate:** `npm run typecheck` + `npm run build` + `npm run test` pass.

---

## 7. Files

**New:** `src/ai/flows/story-authoring-flow.ts`; `src/app/api/storyAuthor/route.ts`,
`src/app/api/storyAuthor/transcribe/route.ts`, `src/app/api/kids/characters/route.ts`;
kids authoring UI under `src/app/kids/` (mic/text turn surface, story-so-far panel, character
create) reusing `StoryBrowser`; `systemConfig/storyAuthoring` seed; "Be the Author" generator seed;
tests.
**Changed:** `src/lib/types.ts` (session/character additions — Track A write-priority), kids
generator list, `src/lib/analytics/events.ts` (content-free authoring events),
storyCompile entry to accept the authored bridge input.
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
| Placeholder/entity drift on compile | Reuse the proven `$$id$$` + actor-tracking pattern; bridge test (§6) |
| **Wrong character resolved → wrong character drawn** | Closed-world linking + phonetic match + STT biasing + clarify-don't-guess + tappable cast + compile-time `actors ⊆ cast` assert (§2.6) |

---

## 9. Sequencing within the sprint

1. **Foundation** — types/session phase, `systemConfig/storyAuthoring`, generator seed (disabled).
2. **Authoring flow (text-first)** — scribe+coach, arc-awareness, grounding check, undo/finish.
   Text modality first because it's deterministic and carries the headline test.
3. **Characters** — Friends-selection reuse + child create + AI-avatar-from-description.
4. **Compile bridge + e2e** — segments → `storyText`; run through the existing pipeline (TEST_MODE).
5. **Voice** — STT route (Gemini) + spoken agent prompts (TTS) + mic UI + text fallback.
6. **Privacy/telemetry/moderation** — content-free events, transcribe-then-discard, moderation.
7. **DoD + docs + consent gate** — tests green; docs updated; ship disabled-by-default behind flag.

---

## 10. Out of scope (candidate follow-ups)

- Photo-based avatars for child-created characters (consent/safety — parent-gated, later).
- Collaborative / multi-child co-authoring.
- Editing a *finished* authored story's text from the kids surface (parent page-edit covers print).
- Blind A/B of scribe vs co-author output quality (do once the dial has real sessions to compare).
