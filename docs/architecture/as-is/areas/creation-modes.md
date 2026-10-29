# As-Is: Story Creation Modes

> Scope: every way a story is **created**, up to the point a compiled `stories/{id}` document
> (text) exists. This covers session creation, the per-mode conversation engines, arc and beat
> progression, `$$id$$` placeholders during creation, `worldState`, and compile (text, synopsis,
> title kick-off). It also covers what happened to the "select output type" step.
> Out of scope (handoff points only): storybook pipeline (pagination, images, audio internals),
> characters and actors (character creation and avatars), print, config/admin internals, client shells.
>
> Snapshot of `main` @ `e10293a` (2026-10-29). Every claim cites `file:line`. This describes what
> **is**, not what should be.

---

## 1. Catalogue of creation modes

### 1.1 How a mode is selected (common front door)

- **Generator registry.** The `storyGenerators` collection holds one doc per mode (`wizard`, `gemini3`, `gemini4`, `beat`, `friends`), seeded by `src/app/api/admin/story-generators/seed/route.ts:237-341`. Each doc carries `apiEndpoint`, `capabilities.requiresStoryType` and `status`/`enabledForKids` (`src/lib/types.ts:2063-2097`).
- **Discovery.** `GET /api/kids-generators` returns only docs with `status=='live' && enabledForKids==true` (`src/app/api/kids-generators/route.ts:28-31`), passed through a jargon-scrubbing presentation layer (`src/lib/kids-generator-presentation.ts:52-73`). All three clients use this one endpoint: the parent `/story/start` (`src/app/story/start/page.tsx:53`), kids `/kids/create` (`src/app/kids/create/page.tsx:175`) and mobile (`mobile/src/contexts/ApiClientContext.tsx:58`).
- **Consequence.** The seed gives `beat` no `enabledForKids` (`seed/route.ts:306-325`). The query uses `== true`, so `beat` is never offered by any chooser, even though `docs/SCHEMA.md` says the field defaults to true. Re-seeding also replaces each whole doc (`merge:false`, `seed/route.ts:381-390`), which resets any admin changes to `status`/`enabledForKids`.
- **Kids-flow toggles are unused.** `systemConfig/kidsFlows` (admin page `src/app/admin/kids-flows/page.tsx`) is read only by `GET /api/kids-flows` (`src/app/api/kids-flows/route.ts:11`). No client calls that endpoint; the only reference is the docs page `src/app/api-documentation/page.tsx:34`.

### 1.2 Mode table

| # | Mode (code / UI / docs names) | Entry UI route(s) | Session created by | API routes | Genkit flows | How it ends / compile path | Status |
|---|---|---|---|---|---|---|---|
| A | **Wizard**: `wizard` / "Story Wizard" (`kids-generator-presentation.ts:53`) / "Story Wizard Flow" (STORY_GENERATION_FLOWS.md §1) | Parent: `/story/start` → `/story/start/wizard` (static page, `start/wizard/page.tsx:93`) → `/story/wizard/[sessionId]` (StoryBrowser) | Client Firestore batch: `storySessions` plus the `children/{id}/sessions` mirror (`start/wizard/page.tsx:70-85`) | `/api/storyWizard` | `storyWizardFlow` | The flow writes `stories/{sid}` itself (`story-wizard-flow.ts:347-364`). The route sets session `status:'completed'` (`storyWizard/route.ts:187-191`). The client then calls `/api/storyCompile`, which **short-circuits** (see §6 #1) | **LIVE** (seeded live + enabledForKids; recommended by default, `kids-generator-presentation.ts` pickRecommendedId) |
| A′ | **Wizard (kids PWA variant)** | `/kids/create`, in-page Q&A (`kids/create/page.tsx:315-402`) | Client Firestore batch (`kids/create/page.tsx:343-366`) | **None**: calls `storyWizardFlow` directly as a **server action** (`kids/create/page.tsx:16,375,425`; flow file is `'use server'`, `story-wizard-flow.ts:1`) | `storyWizardFlow` | Client sets `status:'completed'` via `setDoc` (`kids/create/page.tsx:446-455`), then calls `/api/storyCompile` with no output type (`:468-472`), which short-circuits. Then goes to `/kids/create/[sid]/style` (`:488`) | **LIVE** (main kids path) |
| A″ | **Wizard (mobile)** | `mobile/app/create.tsx` → `/play/[sessionId]` | API: `POST /api/storySession` (`ApiClientContext.tsx:101`; route `storySession/route.ts:141-153`) | `/api/storySession`, `/api/storyWizard` | `storyWizardFlow` | Play screen **always** calls `/api/storyWizard`, whichever generator was picked (`mobile/app/play/[sessionId].tsx:59,81`). Mobile never calls `/api/storyCompile` (`compileStory` is defined at `ApiClientContext.tsx:131`, never called) | **LIVE but partial**: wizard only; other generators are silently run as wizard |
| B | **Gemini 3**: `gemini3` / "Free Play" (`kids-generator-presentation.ts:58`) / "Gemini 3 Flow (Free-Form Creative)" | `/story/start/gemini3` (static) → `/story/play/[sid]`; kids `/kids/create` → `/story/play/[sid]` (`kids/create/page.tsx:302`) | Client `setDoc`, **no** child mirror (`start/gemini3/page.tsx:60-68`); kids: batch with mirror (`kids/create/page.tsx:275-293`) | `/api/gemini3` | `gemini3Flow` | Flow sets `status:'completed'`, `currentPhase:'completed'`, `gemini3FinalStory` (`gemini3-flow.ts:263-269`). No story doc yet, so `/api/storyCompile` runs the "gemini_direct" branch (`story-compile-flow.ts:410-527`) | **LIVE** |
| C | **Gemini 4**: `gemini4` / "Guided Story" / "Gemini 4 Flow (Structured Guided)" | `/story/start/gemini4` (static) → `/story/play/[sid]`; kids as B | as B (`start/gemini4/page.tsx:60-68`) | `/api/gemini4` | `gemini4Flow` (+ `gemini4CreateCharacterFlow`, dead branch: §6) | Flow sets `status/currentPhase:'completed'`, `gemini4FinalStory` (`gemini4-flow.ts:341-347`); compile runs gemini_direct | **LIVE** |
| D | **Friends**: `friends` / "Fun with my friends" | `/story/start/friends` (static, `start/friends/page.tsx:90`) → `/story/friends/[sid]`; kids → `/story/play/[sid]` | Client batch with mirror (`start/friends/page.tsx:68-83`) | `/api/storyFriends` | `friendsFlow` (4 internal phases) | Flow writes `stories/{sid}` (`friends-flow.ts:1030-1047`) and sets session `status:'completed'`, `friendsPhase:'complete'` (`:1050-1057`). `/api/storyCompile` then **short-circuits** (§6 #1) | **LIVE** |
| E | **Beat / arc engine**: `beat` / "Choose Your Adventure" (presentation) / "Story Beats" (seed) / "Story Beat Flow (Arc-Based)" / "Story Session Engine" (SYSTEM_DESIGN §2) | Only via (i) `/story/start/[generatorId]` with id `beat` (unreachable from choosers, §1.1); (ii) any session lacking `storyMode`, because `/story/play` and `/kids/play` default to `'beat'` (`story/play/[sessionId]/page.tsx:77`, `kids/play/[sessionId]/page.tsx:96`), i.e. mode F | Client batch (`start/[generatorId]/page.tsx:96-118`) | `/api/storyBeat`, `/api/storyEnding`, `/api/storyCompile` | `storyBeatFlow`, `endingFlow`, `storyCompileFlow` → `storyTextCompileFlow` | StoryBrowser advances `arcStepIndex` client-side (`story-browser.tsx:922-966`). At arc end it calls `/api/storyEnding`, saves `selectedEndingId` (`:913-917`), then `/api/storyCompile` runs the full text-compile branch (`story-compile-flow.ts:530-650`) | **LIVE engine, hidden entry**: reachable only via the chat alias (F) or a direct URL |
| F | **Chat**: `chat` (kids special-case `kids/create/page.tsx:264-275`) / "Starting a New Chat Story" (`start/chat/page.tsx:111`) | `/story/start/chat` (static) → `/story/play/[sid]` | Client `setDoc`, `currentPhase:'story'`, **no `storyMode`** (`start/chat/page.tsx:82-93`). Loads a warmup `promptConfigs` doc and never uses it (`:56-77`) | as E | as E | As E. The story doc gets `storyMode:'chat'` (default at `story-compile-flow.ts:~596`, `storyMode \|\| 'chat'`) | **LIVE only if** a `storyGenerators/chat` doc exists with live + enabledForKids. It is not seeded. Otherwise URL-only |
| G | **Legacy warmup session engine** (warmup chat → story type → beats → ending → compile with output-type picker) | `/story/session/[sid]` (1587 lines). Linked from the StoryBrowser "Settings / Diagnostic View" button (`story-browser.tsx:1128-1133`) and from `/stories` (`stories/page.tsx:117`). `/story/type/[sid]` story-type picker (`session/[sessionId]/page.tsx:1501`) | Nothing in the UI creates `currentPhase:'warmup'` sessions except `/api/storySession` (mobile) and `/admin/create` (`admin/create/page.tsx:47-62`) | `/api/ai-warmup`, `/api/warmupReply`, `/api/storyBeat`, `/api/storyEnding`, `/api/storyCompile` | `warmupReplyFlow`, `storyBeatFlow`, `endingFlow`, `storyCompileFlow` | Ending choice → `triggerCompile` with a selected output type (`session/[sessionId]/page.tsx:838-903`) | **DIAGNOSTIC / effectively broken**: beat handling reads response fields that `/api/storyBeat` no longer returns (§6 #3) |
| H | **Dynamic generator start** `/story/start/[generatorId]` + `/story/[storyId]/[sessionId]` | Hit only for generator ids **without** a static page, because Next.js static segments win. For `wizard`/`friends`/`gemini3`/`gemini4`/`chat` the static pages shadow it (the header comment claiming it "replaces" them, `start/[generatorId]/page.tsx:16-25`, is untrue). Checks `status=='live'` (`:60`); the static pages do not | Client batch | `generator.apiEndpoint` | per generator | StoryBrowser + its own `onStoryComplete` compile (`[storyId]/[sessionId]/page.tsx:63-96`) | **LIVE code path, used only for `beat`/custom ids** |
| I | **Story Arc engine** | Admin `/admin/storyArcTest` only (`admin/storyArcTest/page.tsx:63`) | n/a | `/api/storyArc` | `storyArcEngineFlow` (uses the **client** Firebase SDK on the server, `story-arc-flow.ts:7-8,50`) | none | **ADMIN-ONLY / unused by live flows** |
| J | `startStoryFlow`, `storyChatFlow` | none | `start-story-flow.ts:81-96` would create warmup sessions | none | both | none | **DEAD**: no importer except `src/ai/dev.ts:5` (Genkit dev registry) |
| K | `/kids/play/[sessionId]` (kids-shell StoryBrowser) | No inbound link. Kids create pushes to the **parent** `/story/play` (`kids/create/page.tsx:302`) | | | | redirect `/kids/stories` | **DEAD** |
| L | `/story/session/[sid]/select-output-type` | No inbound link (grep for `select-output-type` finds only the page itself) | | `/api/storyCompile` | | | **DEAD** |

### 1.3 Where output type is chosen now ("select-output-type" step)

- The output type is no longer chosen before compile. `/api/storyCompile` treats `storyOutputTypeId` as optional (`storyCompile/route.ts:34-35`).
- The choice moved to storybook creation (handoff to the storybook-pipeline area):
  - kids: `/kids/create/[sid]/style` (`style/page.tsx:93-175`)
  - parent: `/story/[storyId]` (`story/[storyId]/page.tsx:124`)
  - mobile: `create-book/[storyId]` (`mobile/app/create-book/[storyId].tsx:60`)
- StoryBrowser still passes `storyOutputTypes[0].id`, an **arbitrary first live type**, to compile (`story-browser.tsx:349`). Compile then stamps it into `stories.metadata.storyOutputTypeId/Name/artStyleHint` (`story-compile-flow.ts:239-241, 362-364, 480-482`).
- If no live output types exist, the StoryBrowser "Continue" button silently does nothing (`story-browser.tsx:347`).

---

## 2. Shared vs divergent parts

### 2.1 Common to (almost) every mode
- **Session doc** `storySessions/{sid}` with `childId`, `parentUid`, `status`, `currentPhase`. `stories/{sid}` reuses the **same id** as the session (every compile branch uses `.doc(sessionId)`).
- **Placeholder convention.** AI output carries `$$<entityId>$$`. The raw text is stored and resolved text is returned for display:
  - server helpers: `replacePlaceholdersInText`, `resolveEntitiesInText`, `replacePlaceholdersWithDescriptions` (`src/lib/resolve-placeholders.server.ts:90-150`), `extractEntityIds` (`src/lib/entity-utils.ts:2`)
  - the client re-implements extraction, including a single-`$` fallback (`story-browser.tsx:65-80`)
  - the wizard has its own `$$CHILD_ID_PLACEHOLDER$$` (`story-wizard-flow.ts:87`)
- **StoryBrowser** (`src/components/story/story-browser.tsx`, 1444 lines) is the single parent-shell UI for modes A, B, C, D, E and F. It:
  - posts `{sessionId, selectedOptionId, userMessage}` to `generator.apiEndpoint` (`:394-406`)
  - **writes the transcript itself** into `storySessions/{sid}/messages` (`:437-487`)
  - unions `$$id$$` ids into `session.actors` (`:479-484`)
  - handles story-type picking (`:1000-1010`), the arc and ending logic (`:905-966`), and character introduction via `/api/characters/create` (handoff: characters area)
- **Normalised response** `StoryGeneratorResponse` (`types.ts:2115-2160`). Every generator route maps its flow output onto it (e.g. `storyBeat/route.ts:58-72`, `storyWizard/route.ts:160-171`).
- **Compile chokepoint** `/api/storyCompile`:
  - idempotency lock (`compileInProgress`, 2-min timeout, `route.ts:47-70`)
  - "already compiled" short-circuit (`:73-85`)
  - `story_allowance` check (`:93-116`), then consume (`:171-196`)
  - background `after()` jobs: audio, actor avatar, title (`:199-234`; handoff: storybook pipeline / characters)

### 2.2 Divergences

| Aspect | Wizard (A/A′/A″) | Gemini3/4 (B/C) | Friends (D) | Beat/Chat (E/F/G) |
|---|---|---|---|---|
| Conversation state | Parent route: `wizardAnswers`, `wizardLastQuestion`, `wizardLastChoices` on session (`storyWizard/route.ts:148-153`). Kids PWA: **client React state only**, nothing persisted (`kids/create/page.tsx:169,412-415`) | `messages` subcollection written by client; flow re-reads it (`gemini3-flow.ts:137-139`, `gemini4-flow.ts:212-214`) | `friends*` fields on session (`types.ts:250-268`), phase in `friendsPhase` | `messages` (client-written) + `arcStepIndex` + `worldState` |
| Who writes `stories/{sid}` first | the flow (`story-wizard-flow.ts:347-364`) | compile (`story-compile-flow.ts:469-493`) | the flow (`friends-flow.ts:1030-1047`) | compile (`story-compile-flow.ts:~590-622`) |
| Final text on session | none | `gemini3FinalStory` / `gemini4FinalStory` | none | none (rebuilt from messages by `storyTextCompileFlow`) |
| Who sets `status:'completed'` | route / kids client, **before** compile | flow, before compile | flow, before compile | compile only |
| Title source | `metadata.title` from wizard LLM | `storyTitleFlow` (background) | `metadata.title` from friends LLM | `storyTitleFlow` |
| Synopsis | compile branch would generate it, but is skipped (§6 #1) | compile `generateSynopsis` (`story-compile-flow.ts:445`) | as wizard | `storyTextCompileFlow` |
| `story.storyMode` | `'wizard'` (flow-hardcoded, even for mobile sessions with no `storyMode`) | session `storyMode` | **not set** by flow (`friends-flow.ts:1033-1045`); compile would add it but is skipped | session `storyMode`, or `'chat'` default |
| `story.status` | `'text_ready'` | unset | `'text_ready'` | unset |
| `story.pageGeneration/imageGeneration` | `{status:'idle'}` | unset | `{status:'idle'}` | unset |
| Auth pattern on route | `requireAuthenticatedUser` + manual `parentUid` check + `enforcePersonaScope` (`storyWizard/route.ts:28,54-73`); kids server action has **no auth** | `requireSessionOwner` (`gemini3/route.ts:37`) | `requireAuthenticatedUser` + manual check, **no persona scope** (`storyFriends/route.ts:28,54-59`) | `requireSessionOwner` |
| Model | `gemini-2.5-pro` hardcoded for the story (`story-wizard-flow.ts:247`) | `gemini-2.5-pro` hardcoded (`gemini3-flow.ts:208`, `gemini4-flow.ts:282`) | per-prompt config from generator doc (`friends-flow.ts:373-380`) | `storyType.promptConfig.model.name` or `gemini-2.5-flash` (`story-beat-flow.ts:318`) |
| Prompt source | `storyGenerators/wizard.prompts` (`story-wizard-flow.ts:97`) | `storyGenerators/gemini3|4.prompts` | `storyGenerators/friends.prompts` | `storyTypes.promptConfig`, else legacy `promptConfigs` via `resolvePromptConfigForSession` (`story-beat-flow.ts:228-264`) |

### 2.3 Duplicated logic
- **Session creation is copied in 7 places**, each with a slightly different shape (§3.1): `start/wizard`, `start/friends`, `start/gemini3`, `start/gemini4`, `start/chat`, `start/[generatorId]`, `kids/create` ×2, plus `/api/storySession` and `startStoryFlow` (dead).
- **Page-level compile-on-complete wrappers are near-identical:** `story/wizard/[sid]/page.tsx:50-82`, `story/friends/[sid]/page.tsx:~55-90`, `story/[storyId]/[sessionId]/page.tsx:63-96`. They also duplicate StoryBrowser's own `autoCompileStory`, so **compile is requested twice** when no `completionRedirectPath` is set (`story-browser.tsx:353` then `:380` → page handler).
- **The arc-advance/ending logic exists twice:** StoryBrowser `:922-966` and the legacy page `:780-826`. The legacy page also sets `currentPhase:'ending'` client-side (`:711`); StoryBrowser relies on `endingFlow` to correct it (`ending-flow.ts:79-84`).
- **The four `storyCompileFlow` branches** (friends `:163-284`, wizard `:287-408`, gemini `:410-527`, standard `:530-650`) repeat the same synopsis / session-update / story-upsert / usage / event code.
- **Generator chooser UI and ICON_MAP** are duplicated in `story/start/page.tsx:15-39` and `kids/create/page.tsx:40-108`.
- **Message `kind` naming differs by writer.** StoryBrowser writes `${generatorId}_question`, `${generatorId}_final_story` and `child_choice` (`story-browser.tsx:447,473,806-813`). The `ChatMessage.kind` union lists `gemini3_choice` etc. and lacks `wizard_*` and `friends_*` (`types.ts:161`). Resolved text is stored as `textResolved` by StoryBrowser but `displayText` by the legacy page (`session/[sessionId]/page.tsx:521`) and the type (`types.ts:154`).

---

## 3. State / status fields

### 3.1 `storySessions.status`
| Value | Set by |
|---|---|
| `in_progress` | every client creator (`start/*/page.tsx`, `kids/create/page.tsx:268,278,349`) |
| `active` | `/api/storySession` (mobile) (`storySession/route.ts:147`). **Not in the type** (`types.ts:195`: `'in_progress' \| 'completed'`) |
| `completed` | wizard route (`storyWizard/route.ts:188`); kids client (`kids/create/page.tsx:449`); gemini3/4 flows (`gemini3-flow.ts:265`, `gemini4-flow.ts:343`); friends flow (`friends-flow.ts:1051`); every compile branch (`story-compile-flow.ts:218,345,453,~581`) |

Field writers:
- Compile lock fields (`compileInProgress`, `compileStartedAt`, `compileRequestId`, `compileCompletedAt`, `compileErrorAt`, `compileLastError`) are written only by `storyCompile/route.ts:119-123,143-146,268-272`. They are missing from `StorySession` type and SCHEMA.md.
- Entitlement fields `storyAllowanceConsumed/At/Remaining` are written at `route.ts:178-182`.

### 3.2 `storySessions.currentPhase`
Typed union (`types.ts:197`): `warmup|story|ending|final|wizard|gemini3|gemini4|friends|completed`.

| Value | Set by |
|---|---|
| `warmup` | `/api/storySession` (`:148`), `/admin/create` (`:54`), `startStoryFlow` (dead, `:89`) |
| `story` | chat start (`start/chat/page.tsx:86`), kids chat (`kids/create/page.tsx:269`), legacy page on story-type pick / first beat (`session/[sessionId]/page.tsx:458,493`) |
| `ending` | legacy page (`:711`), `endingFlow` self-correction (`ending-flow.ts:79-84`) |
| `final` | every compile branch (`story-compile-flow.ts:217,344,452,579`) |
| `wizard` / `friends` / `gemini3` / `gemini4` | static start pages and kids create, used as a **mode marker**, not a phase |
| `<any generatorId>`, e.g. `beat` | `start/[generatorId]/page.tsx:100`, `kids/create/page.tsx:279`. `beat` is **outside the typed union** |
| `completed` | gemini3/4 flows (`gemini3-flow.ts:266`, `gemini4-flow.ts:344`). Overwritten to `final` by compile |

Observed transitions:
- Beat: `<id>|story → (ending) → final`
- Gemini: `gemini3 → completed → final`
- Wizard/friends: `wizard|friends → (stays)`, because compile is skipped. Mobile stays at `warmup`.

Readers:
- Legacy page progress UI (`session/[sessionId]/page.tsx:1188-1197`); it disables beat buttons unless `currentPhase==='story'` (`:1381`)
- `storyCompileTest` (`admin/storyCompileTest/page.tsx:61-76`)
- `/stories` badge (`stories/page.tsx:91`)

### 3.3 Other progression fields
- **`arcStepIndex`.**
  - Initialised to 0 by the legacy page (`:457,496`). StoryBrowser does not initialise it; it treats undefined as 0 (`story-browser.tsx:939`).
  - Incremented **client-side** before each beat (`story-browser.tsx:957`; legacy `:811`).
  - Read and clamped by `storyBeatFlow` (`story-beat-flow.ts:139-148`) and `endingFlow`.
- **`friendsPhase`.**
  - Written values: `character_selection → scenario_selection → synopsis_selection → complete` (`friends-flow.ts:556,712,882,1052`).
  - `story_generation` is typed and checked (`:1212`) but **never set**.
- **`storyTypeId`.** Set client-side by StoryBrowser (`:1003`), the legacy page (`:454`) and `/story/type/[sid]` (`:125-126`). Required by the beat/ending/text-compile flows (`story-beat-flow.ts:84`, `story-text-compile-flow.ts:147-148`).
- **`storyPhaseId`, `endingPhaseId`.** Written by the legacy page (`:455-456`) and `endingFlow` (`ending-flow.ts:82`); **never read** by any flow.
- **`worldState` `{presentActorIds, currentLocation}`.**
  - Written fire-and-forget by `storyBeatFlow` only on the structured-output path (`story-beat-flow.ts:533-543`); the fallback-parse path (`:420-480`) does not persist it.
  - Read only when `storyType.promptConfig` exists (`story-beat-flow.ts:228-243` → `story-beat-prompt-builder.ts:194-201`).
- **`progress.*` timestamps.** Written by the legacy page and `endingFlow` (`ending-flow.ts:262-264`); StoryBrowser paths write none.
- **Client UI state** `BrowserState` (`story-browser.tsx:49-60`) is not persisted. A reload re-calls the generator API with no option (`:340`), which for beat regenerates the current beat.

### 3.4 `stories` status-ish fields set during creation
- `status`: `text_ready` (wizard/friends flows). The type also allows `images_pending` (`types.ts:316`).
- `titleGeneration.status`: `pending` (compile) → `generating`/`ready`/`error` (`story-title-flow.ts:96-99,160-164`). Title requires `synopsisGeneration.status=='ready'` (`:89-92`).
- `synopsisGeneration.status`: set to `ready` by compile.
- `actorAvatarGeneration.status`: set to `pending` by compile. The pipeline is the storybook / characters areas' handoff.

---

## 4. Terminology

| Concept | Terms in use (where) |
|---|---|
| A creation mode | **generator** (`storyGenerators`, `StoryGenerator`, `generatorId`); **storyMode** (`session.storyMode`, `story.storyMode`, `start/[generatorId]/page.tsx:110`); **flow** (`/api/kids-flows`, `KidsFlowConfig`, `flowType` in `/api/storySession` and mobile `create.tsx:21`, "Story Wizard Flow" in docs); **mode** (`isWizardMode` etc. in `story-compile-flow.ts:156-158`); **currentPhase** (overloaded as a mode marker, §3.2); **storyTypeId** (analytics: `track(storyStarted,{storyTypeId: generator.id})`, `kids/create/page.tsx:298,371`) |
| The narrative template / arc | **storyType** (`storyTypes`); **arcTemplate.steps / ArcStep** (`types.ts:1267,1316`); **storyPhase** / `storyPhaseId` (`storyPhases`, unused); **basicPlot** (`story-arc-flow.ts`) |
| One turn | **beat** (beat flow, `beat_continuation`/`beat_options`); **question** (wizard/gemini, `*_question`); **step** (`arcStepIndex`, `currentStepIndex`); **exchange** (gemini3 prompt); **phase** (friends) |
| The in-progress creation | **storySession / session** (code); **story** (`/stories` page lists sessions, `stories/page.tsx`; route param `[storyId]` that holds a generator id, `story/[storyId]/[sessionId]/page.tsx:27-29`); **chat** ("Story Chat", `story/type/[sessionId]/page.tsx:203`) |
| The finished text | **Story** (`stories`); **finalStory** (`StoryGeneratorResponse`, `gemini*FinalStory`); **compiled story** (`/compiled` page); **storyText** |
| The AI host | "Story Guide" (legacy page copy, `session/[sessionId]/page.tsx:414`); "Story Wizard" |
| Output format | **storyOutputType** / outputType (`storyOutputTypes`); "Story Type Selected!" toast on the output-type page (`select-output-type/page.tsx`) confuses it with storyType |
| Entities in text | **actor** (`session.actors`, `story.actors`); **entity** (`EntityMap`, `extractEntityIds`); **character** (`characters` collection); **placeholder** (`$$id$$`) |
| Generator display names | `wizard` = "Story Wizard"; `gemini3` = "Free Play"; `gemini4` = "Guided Story"; `beat` = "Choose Your Adventure" (presentation) or "Story Beats" (seed); `friends` = "Fun with my friends" (`kids-generator-presentation.ts:52-73`, seed) |

---

## 5. Collections touched (this area)

| Collection | Read by | Written by |
|---|---|---|
| `storyGenerators` | Client: StoryBrowser (`:160-164`), `start/[generatorId]`, `story/[storyId]/[sessionId]`, child stories page (`child/[childId]/stories/page.tsx:69`). Admin SDK: `/api/kids-generators`, `/api/storySession` (`flowType`), wizard/gemini3/gemini4/friends flows (prompts) | Admin SDK: seed route; admin page (config area) |
| `storySessions` | Client: StoryBrowser, all start/play pages, legacy page. Admin SDK: every creation route and flow, compile | **Client SDK**: creation (all web paths), `storyTypeId`, `arcStepIndex`, `actors`, `selectedEnding*`, kids `status:'completed'`, `storyOutputTypeId` (dead page). **Admin SDK**: `/api/storySession`; wizard route (`wizard*`, status); gemini flows; friends flow; beat (`worldState`); ending (`currentPhase`, `progress`); compile (lock, phase, status, allowance) |
| `storySessions/{id}/messages` | Admin SDK: warmup, beat, ending, gemini3/4, text-compile flows. Client: legacy page | **Client SDK only** (StoryBrowser `:437-487,684-690,806-813`; legacy page). No server flow writes the transcript |
| `storySessions/{id}/events` | (admin/diagnostics) | Admin SDK `logServerSessionEvent` (beat, ending, compile); client `logSessionEvent` (legacy page) |
| `children/{id}/sessions` (mirror) | Client: `/stories` (`stories/page.tsx:146`) | Client: wizard/friends/[generatorId] start pages, kids create. **Never updated after creation** (stale status) |
| `stories` | Admin SDK: compile (idempotency), title flow, synopsis (dead) | Admin SDK: wizard flow, friends flow, compile branches, title flow |
| `storyTypes` | Client: StoryBrowser (`:173-177`), `/story/play`, `/kids/play`, legacy page, `/story/type`. Admin SDK: beat, ending, text-compile flows | (admin/config area) |
| `storyOutputTypes` | Client: StoryBrowser, wrapper pages, legacy page. Admin SDK: compile, `/api/storyOutputTypes` | (admin) |
| `promptConfigs` | Admin SDK: `resolvePromptConfigForSession` (warmup + beat fallback); client: chat start page (unused result) | (admin) |
| `children`, `characters` | Client: start pages (ownership check; also **writes `ownerParentUid` if missing**, e.g. `start/[generatorId]/page.tsx:82-84`, `start/chat/page.tsx:49-51`). Admin SDK: `buildStoryContext` in flows | Client: music toggle (`story-browser.tsx:258`). Character creation is the characters area |
| `answerAnimations` | Client: StoryBrowser (`:187-191`) | - |
| `systemConfig/kidsFlows` | Admin SDK: `/api/kids-flows` (no caller) | admin page |

---

## 6. Delete candidates and bugs / inconsistencies

### 6.1 Notable bugs / inconsistencies (ranked)

1. **Wizard and friends stories skip compile entirely.**
   - Before calling `/api/storyCompile`, each path sets `status:'completed'` and the flow has already written `stories/{sid}`:
     - wizard route `storyWizard/route.ts:187-191`
     - kids client `kids/create/page.tsx:446-455`
     - friends flow `friends-flow.ts:1050-1057`
   - The route returns `alreadyCompiled` whenever `status==='completed'` and the story doc exists (`storyCompile/route.ts:73-85`).
   - The wizard and friends branches of `storyCompileFlow` (`:163-408`) are therefore unreachable in practice. As a result these stories get:
     - no synopsis
     - no `titleGeneration/actorAvatarGeneration` pending
     - no audio/avatar/title background jobs
     - `currentPhase` never reaches `final`
     - **`story_allowance` never consumed**
   - Wizard is the default "recommended" mode. The e2e seed assumes the post-compile shape (`e2e/helpers/emulator.ts:135-160`), so CI would not catch this.
2. **Mobile creation is wizard-only and never compiles.**
   - `/api/storySession` writes `status:'active'`, `currentPhase:'warmup'`, `generatorId`, `flowType` and no `storyMode` (`storySession/route.ts:142-151`).
   - The play screen always calls `/api/storyWizard` (`mobile/app/play/[sessionId].tsx:59,81`).
   - `create.tsx:58` routes on `generator.flowType`, which `/api/kids-generators` strips (`kids-generator-presentation.ts:74-86`).
   - `compileStory`, `sendBeatChoice` and `sendFriendsAction` are never called.
3. **The legacy session page beat handler is incompatible with `/api/storyBeat`.**
   - It destructures `storyContinuation`, `optionsResolved`, `arcStep` and `scene` (`session/[sessionId]/page.tsx:516`).
   - The route returns the normalised `headerText`/`options` shape (`storyBeat/route.ts:58-72`), so the page writes `text: undefined`. The page is still linked as "Settings" from every StoryBrowser screen, including for kids routed to `/story/play`.
4. **Security and integrity gaps in creation.**
   - `storyWizardFlow` is invoked as an unauthenticated server action (`kids/create/page.tsx:16`, flow `'use server'`): any caller can pass any `childId`/`sessionId`.
   - Firestore rules let the owner update **any** session field (`firestore.rules:101-102`), including `status` and `storyAllowanceConsumed`, which are the two inputs the compile route trusts for idempotency and billing.
   - The transcript that compile turns into the story is client-written (§5).
   - `/api/storyFriends` lacks the persona-scope check that `/api/storyWizard` has.
5. **Mode identity is inconsistent.**
   - `currentPhase` doubles as the mode marker (§3.2).
   - `chat` sessions have no `storyMode`, run the `beat` generator (`story/play/[sessionId]/page.tsx:77`) and are stored as `story.storyMode:'chat'`.
   - Friends stories have no `storyMode`.
   - `beat` is not offered anywhere (no `enabledForKids`), contradicting SCHEMA.md's "default: true".
   - Static start pages shadow `/story/start/[generatorId]` and skip its `status=='live'` check.
   - Kids PWA non-wizard modes jump into the parent shell `/story/play` (`kids/create/page.tsx:302`) instead of `/kids/play` (which is orphaned).
6. Other inconsistencies:
   - **Double compile requests** from StoryBrowser plus wrapper pages (§2.3).
   - The **arbitrary first output type** is stamped at compile (§1.3).
   - `/api/storyBeat` ignores `selectedOptionId` and `moreOptions` (`storyBeat/route.ts:15,32`), so "more options" just regenerates the beat.
   - The `/api/storyWizard` finish response puts resolved text in both `finalStory` and `finalStoryResolved` (`:201-202`).
   - The child-session mirror is never updated.
   - `storySessions.status` type omits `active`; lock and allowance fields are missing from `StorySession`.
   - The wizard parses selected options by letter (`charCodeAt(0)-65`, `storyWizard/route.ts:91`).
   - `/api/storySession` and `/api/ai-warmup` are undocumented in `docs/API.md`.
   - SYSTEM_DESIGN §2 still describes warmup→beats as *the* engine (`docs/SYSTEM_DESIGN.md:100-117`).

### 6.2 Delete candidates (with evidence)

| Candidate | Evidence |
|---|---|
| `src/ai/flows/start-story-flow.ts`, `src/ai/flows/story-chat-flow.ts` | No importer except `src/ai/dev.ts` |
| `src/ai/flows/story-synopsis-flow.ts` | No importer (only listed in `src/lib/ai-model-usage-map.ts:33`); synopsis is generated inside compile |
| `/api/kids-flows` + `systemConfig/kidsFlows` + `src/lib/kids-flow-config.server.ts` + `/admin/kids-flows` | No client caller; superseded by `storyGenerators.enabledForKids` (config area to confirm) |
| `/story/session/[sid]/select-output-type` | No inbound links |
| `/kids/play/[sessionId]` | No inbound links |
| `/story/start/{wizard,friends,gemini3,gemini4,chat}` static pages + `/story/wizard/[sid]`, `/story/friends/[sid]` | Duplicates of `/story/start/[generatorId]` + `/story/[g]/[sid]`, or `/story/play` |
| `/api/storyArc` + `storyArcEngineFlow` + `/admin/storyArcTest` | Admin-only; arc progression is done client-side |
| `gemini4` route `action:'createCharacter'` branch (`gemini4/route.ts:55-70`) | No client sends it |
| Legacy warmup engine: `/story/session/[sid]` (beat path broken), `/story/type/[sid]`, `/api/warmupReply` + `warmupReplyFlow`, `/api/ai-warmup`, `promptConfigs` warmup docs | Nothing in the UI creates warmup sessions; the page is reachable only as a "Diagnostic View" |
| `storyPhaseId` / `endingPhaseId` session fields, `storyPhases` collection | Written, never read by flows |
| Unused promptConfig fetch in `start/chat/page.tsx:56-77` | Result discarded |

---

## Observations for the redesign (brief)

- Seven creation front doors and four compile branches all converge on one `storySessions` doc whose shape depends on which page created it. A single server-side "create session" API plus one "complete" transition (owned by the server, not clients) would remove failure modes #1, #2 and #5.
- "Completion" is currently decided in three places: the flow, the client and the compile route. The idempotency guard keys on a client-writable `status`, which is what silently disables post-compile work and billing for the default mode.
- The transcript, arc position and story type are client-written yet authoritative for compile. This runs against the repo's own server-first rule (CLAUDE.md).
- Handoffs:
  - storybook pipeline: everything after `stories/{sid}` exists, including the output-type choice and the audio/title/avatar `after()` jobs
  - characters & actors: `/api/characters/create` and `buildStoryContext`
  - config & admin: generator seeding, `kidsFlows`, `storyTypes`, `promptConfigs`
  - clients: the `/story/play` vs `/kids/play` shell choice and the mobile client
