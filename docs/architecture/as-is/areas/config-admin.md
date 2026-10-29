# As-is: Configuration & Admin/Ops layer

Status: Phase 1 mapping (read-only), 2026-10-29. Describes the code as it is on `main`, not as the docs
say. Citations are `path:line` relative to the repo root. Scope: curated configuration, its loaders,
flag and model-selection control planes, admin/writer/ops tooling. How flows use config in detail is
covered by the creation-modes, pipeline, characters, print and clients area maps.

---

## 1. Inventory of curated config

### 1.1 Top-level config collections

"Curated?" column: **KEEP** = hand-curated product content that must survive a data reset;
**DERIVABLE** = can be regenerated from code or AI (still costly); **OPS** = operational state or logs;
**USER** = runtime user data (wipe).

| Collection | Holds | Edited by (UI → write path) | Read at runtime by | Defaults in code | Seeded by | Curated? | Storage refs |
|---|---|---|---|---|---|---|---|
| `promptConfigs/{id}` | Per-phase/level-band system prompts and `model{name,temperature,maxOutputTokens}` (`src/lib/types.ts:1173`). IDs follow `warmup_level_<band>_v1` and `story_beat_level_<band>_v1` | `/admin/prompts`, `/writer` tab "Prompt Configs", `/admin/upload` (JSON bulk upload, client `setDoc` `src/app/admin/upload/page.tsx:164`), `/admin/storyDesigner`. All client SDK, rules `isWriter()\|\|isAdmin()` (`firestore.rules:276`) | `resolvePromptConfigForSession` (`src/lib/prompt-config-resolver.ts:10-78`) ← `warmup-reply-flow.ts:68`, `story-beat-flow.ts:264`; client `src/app/story/start/chat/page.tsx:56-69` | Only the hard-coded fallback IDs (`prompt-config-resolver.ts:44,56,67`); no prompt text in code. Throws if nothing is found (`:78`) | none (manual upload) | **KEEP** | none |
| `storyTypes/{id}` | Story arc templates: `arcTemplate.steps[]` (embedded, **no subcollections**), `promptConfig` (role, rules, per-phase instructions, `model`), `levelBandOverrides`, age range, `status live/draft`, `backgroundMusic` (`src/lib/types.ts:1302-1345`) | `/admin/storyTypes` (1790-line client page), `/writer` tab "Story Types". Rules writer/admin (`firestore.rules:286`) | `story-beat-flow.ts`, `ending-flow.ts`, `story-arc-flow.ts`, `story-text-compile-flow.ts`; client `story-browser.tsx:174` filters `status=='live'` | Admin page has inline template defaults (`src/app/admin/storyTypes/page.tsx:57-137`) | none | **KEEP** | `backgroundMusic.audioUrl` → `story-types/{id}/background-music.mp3` (`src/app/api/music/generate/route.ts:121`) |
| `storyPhases/{id}` | Phase defs (`warmup/storyBeat/ending`, `choiceCount`, `allowMore`) (`types.ts` `StoryPhase`) | `/admin/storyPhases`, `/writer` tab "Story Phases" (`src/app/writer/page.tsx:292,348`) | **Nothing at runtime.** Only referenced by admin/writer, `regression`, `firestore-test` and `help-wizards.json`. `storyTypes.defaultPhaseId/endingPhaseId` are written (`admin/storyTypes/page.tsx:72-73`) but never read | — | none | KEEP-if-wanted (inert) | none |
| `storyGenerators/{id}` | One doc per creation mode (`wizard`, `gemini3`, `gemini4`, `beat`, `friends`): `status`, `enabledForKids`, `apiEndpoint`, `capabilities`, `styling`, `prompts{key→template}`, `defaultModel`, `defaultTemperature`, `promptConfig{key→{model,temperature}}`, `backgroundMusic` (`types.ts:2063-2097`) | `/admin/storyGenerators` (client SDK, rules admin-only `firestore.rules:306`) | `/api/kids-generators` (`status=='live' && enabledForKids`, `src/app/api/kids-generators/route.ts:29-30`), `/api/storySession` (`route.ts:53`), `gemini3/gemini4/story-wizard/friends` flows | Yes, prompt defaults duplicated in each flow (`gemini3-flow.ts:20,189`, `gemini4-flow.ts:22,44`, `story-wizard-flow.ts:31,52`, `friends-flow.ts:37-132`) | `POST /api/admin/story-generators/seed` (`seed/route.ts:372-391`), button on `/admin/dev` and `/admin/storyGenerators` | **KEEP** (prompts, model settings, styling) | `backgroundMusic.audioUrl` → `story-generators/{id}/background-music.mp3` (`src/app/api/music/generate-generator/route.ts:121`) |
| `storyOutputTypes/{id}` | Output formats (picture book, poem…): `childFacingLabel`, `category`, `defaultPrintLayoutId`, `layoutHints`, `aiHints`, `paginationPrompt`, `imageUrl`, `imagePrompt`, `status` | `/writer` tab "Output Types", `/admin/storyOutputs`. Rules writer/admin (`firestore.rules:291`) | `/api/storyOutputTypes` (`status=='live'`, `route.ts:27`), `story-pagination-flow.ts:222-229`, `story-page-flow.ts`, `storybookV2/create` | — | none | **KEEP** | `imageUrl` → `storyOutputTypes/{id}/image_*.{ext}` (`story-output-type-image-flow.ts:132`) or `storyOutputTypes/{id}/{ts}_{name}` (`api/storyOutputTypes/uploadImage/route.ts:96`) |
| `imageStyles/{autoId}` | Art styles: `stylePrompt`, `sampleDescription`, age range, `preferred`, `sampleImageUrl`, `exampleImages[]{url,storagePath}`, `sceneExemplars{tag→{imageUrl,storagePath,status}}` (`types.ts:1716-1732`). **Map field, not a subcollection** | `/admin/image-styles` (client SDK, admin-only rules `firestore.rules:301`) + `/api/imageStyles/*` (upload/delete example, generate sample, generate scene exemplars) | `/api/imageStyles`, `story-image-flow.ts:1583-1585` (scene exemplars as style refs), `actor-exemplar-flow.ts`, `story-exemplar-generation-flow.ts` | `SEED_IMAGE_STYLES` in the seed route | `POST /api/imageStyles/seed` (creates **new auto-ID docs on every call**, `src/app/api/imageStyles/seed/route.ts:97-104`) | **KEEP** (prompts + example images); sample/scene exemplars are DERIVABLE | `exampleImages[].url` → `imageStyles/{id}/examples/{uuid}.{ext}` (`uploadExampleImage/route.ts:126`, hand-uploaded, **not regenerable**); `sampleImageUrl` → `imageStyles/{id}/sample_*.{ext}` (`image-style-sample-flow.ts:131`); `sceneExemplars.*` → `sceneExemplars/{styleId}/{tag}/image.{ext}` (`style-scene-exemplar-flow.ts:100`) |
| `answerAnimations/{id}` | CSS keyframes, duration, easing, `isActive`, `order`, `soundEffect{prompt,audioUrl,…}` | `/admin/answer-animations` (client SDK, rules writer/admin `firestore.rules:312`) | Client `story-browser.tsx` | `ANSWER_ANIMATION_PRESETS` (`src/lib/animation-presets.ts`) | `POST /api/soundEffects/seed` (upsert, keeps ready audio, `route.ts:31-41`) | **KEEP** (presets are in code, but edits/sound prompts are curated) | `soundEffect.audioUrl` → `animations/{id}/sound-effect.mp3` (`api/soundEffects/generate/route.ts:130`) |
| `helpWizards/{id}` | Guided-tour pages (`pages[]` with CSS selectors), `role`, `status`, `isDefaultStartup` | `/admin/helpWizards` (client SDK, rules writer/admin `firestore.rules:326`) | `components/help-wizard.tsx`, `header.tsx`, `startup-wizard-trigger.tsx`, `onboarding/onboarding-tip-trigger.tsx` | `src/data/help-wizards.json`, `helpwizard-admin-guide.json` | Client-side batch from JSON, **overwrites** (`src/app/admin/helpWizards/page.tsx:39-45`) | **KEEP** (edits diverge from the JSON) | none |
| `printLayouts/{id}` *(config only, print area maps use)* | Page geometry, text/image boxes, fonts, `printProductId` | `/admin/print-layouts`, `/writer` (client SDK, writer/admin) | Pagination, storybookV2, PDF routes | `src/data/print-layouts.json`; also read directly as fallback by `api/storyBook/printable/route.ts:1033` | Client-side batch from JSON (`admin/print-layouts/page.tsx:931-937`) | **KEEP** | none |
| `printProducts/{id}` *(config only)* | Mixam spec per product | `/admin/print-products` (client SDK) | Mixam order routes, pagination | `src/lib/seed-print-products.ts` | `POST /api/admin/print-products/seed` (`seedHardcoverProduct`) | **KEEP** | none |
| `products/{id}`, `prices/{id}` *(config only)* | Commercial catalogue | `/admin/products` → `/api/admin/products`, `/api/admin/prices` | entitlements | — | none | **KEEP** | none |

### 1.2 `systemConfig/*` documents

Rules: any authenticated user can **read** every `systemConfig` doc, only admins can write
(`firestore.rules:332-335`). That includes email, address, Mixam payment and ops state.

| Doc (actual ID in code) | Holds | Edited by | Loader / readers | Code defaults | Seeded | Curated? |
|---|---|---|---|---|---|---|
| `diagnostics` | 9 toggles: diagnostics panel, client/server/AI-flow logging, API docs page, Mixam webhook logging, Report-Issue button, `elevenLabsApiVersion`, `enableAnalytics` (`types.ts:1740-1766`) | `/admin` dashboard, client `setDoc` via `src/hooks/use-diagnostics.tsx:30,61` | Client hook `use-diagnostics`; server `get-elevenlabs-config.server.ts:17` (uncached); `webhooks/mixam/route.ts`; PostHog gate `posthog-provider.tsx:45` | `DEFAULT_DIAGNOSTICS_CONFIG` | `POST /api/admin/system-config/seed` → `seedDiagnosticsConfig` (create-if-absent, `src/lib/seed-system-config.ts:10-27`) | KEEP (small) |
| `prompts` | `globalPrefix`, `enabled` | `/admin/global-prompts` → `PUT /api/admin/system-config/prompts` | `global-prompt-config.server.ts:6` ← `story-text-compile-flow.ts:241` + 4 other files | `DEFAULT_GLOBAL_PROMPT_CONFIG` | no | **KEEP** |
| `compilePrompt` | `compilePrompt`, `enabled` | `/admin/compile-prompt` → `/api/admin/system-config/compile-prompt` | `compile-prompt-config.server.ts:7` ← `story-text-compile-flow.ts:242` | yes | no | **KEEP** |
| `paginationPrompt` | `paginationPrompt`, `enabled` | `/admin/pagination-prompt` → `/api/admin/system-config/pagination-prompt` | `pagination-prompt-config.server.ts:7` ← `story-pagination-flow.ts:224` | `DEFAULT_PAGINATION_PROMPT` | no | **KEEP** |
| `imagePrompt` | `imagePrompt`, `enabled` | `/admin/image-prompt` → `/api/admin/system-config/image-prompt` | `image-prompt-config.server.ts:7` ← `story-image-flow.ts:879` | `DEFAULT_IMAGE_PROMPT` | no | **KEEP** |
| `kidsFlows` | `wizardEnabled`, `chatEnabled`, `gemini3Enabled`, `gemini4Enabled`, `friendsEnabled` (`types.ts:1841-1857`) | `/admin/kids-flows` (not linked from any dashboard) → `/api/admin/system-config/kids-flows` | `kids-flow-config.server.ts:7` ← only `GET /api/kids-flows`, which **no client calls** (web uses `/api/kids-generators`, `src/app/kids/create/page.tsx:175`; mobile too, `mobile/src/contexts/ApiClientContext.tsx:58`) | yes | no | Dead (superseded by `storyGenerators.enabledForKids`) |
| `voice` | `voiceRecordingText` (voice-clone script) | `/admin/voice-config` → `/api/admin/system-config/voice` | `VoiceSelector.tsx:79` calls the **admin** route (GET needs only a signed-in parent, `voice/route.ts:19`) | `DEFAULT_VOICE_RECORDING_TEXT` | no | KEEP |
| `email` | sender, footer, brand colour, per-template subject/body/enabled | `/admin/email-config`, **client `setDoc` directly** (`src/app/admin/email-config/page.tsx:92,130`), no API route | `src/lib/email/send-email.ts:52` (60s cache, no invalidation hook) | `DEFAULT_EMAIL_CONFIG` (`types.ts:1934`, hard-codes a personal sender address) | no | **KEEP** |
| `aiModels` | 4 model IDs + `availabilityCheck` (state) | `/admin/ai-models` → `/api/admin/ai-models` (PUT, `route.ts:152-155`), `/check-availability` (writes check result, emails on issues) | `src/lib/ai-model-config.ts:37` (60s cache) | `DEFAULT_AI_MODELS_CONFIG` (`types.ts:2315`) | auto-seeded on GET when fields are missing (`ai-models/route.ts:50-61`) | KEEP (config fields); `availabilityCheck` is OPS |
| `addresses` | System/business return addresses | `/admin/system-addresses` → `/api/admin/system-config/addresses` | print-order submit/resubmit routes | `DEFAULT_SYSTEM_ADDRESS_CONFIG` (`types.ts:66`) | no | **KEEP** |
| `mixam` | `paymentMethod` (`TEST_ORDER`/`ACCOUNT`/`CARD_ON_FILE`) | `/admin/mixam-catalogue` → `/api/admin/system-config/mixam` | Mixam order routes | `DEFAULT_MIXAM_CONFIG` = `ACCOUNT` (`types.ts:2279`) | no | KEEP (environment-specific) |
| `orderTransparency` | Turnaround min/max business days | **No editor** (console only) | `order-transparency-config.server.ts:28` ← `/api/printOrders/my-orders` | yes (`:12-15`) | no | KEEP if set |
| `sceneExemplars` | Per-tag overrides of scene prompts | **No editor** (SCHEMA.md calls it "admin-editable") | `style-scene-exemplar-flow.ts:125` (uncached) | `DEFAULT_SCENE_EXEMPLAR_DEFINITIONS` (`src/lib/scene-exemplar-config.ts:21`) | no | KEEP if set |
| `featureFlags` | flag key → boolean (only key that exists: `health_verbose`) | **No editor** | `feature-flags.server.ts:50,118-134` (30s cache) | `FLAG_DEFAULTS` (`src/lib/feature-flags.ts:29-38`) | no | KEEP if set |
| `opsHealth` | `thresholds` (config) **and** `lastAlertedAt`, last run results (state) | thresholds: console only; state: `/api/admin/ops/health-check` (`route.ts:76-80`) | `/api/admin/ops/metrics` (`route.ts:115`) | `DEFAULT_OPS_HEALTH_THRESHOLDS` (`src/lib/ops/health-checks.ts:28`) | no | thresholds KEEP, rest OPS |
| `circuitBreakers` | Cross-instance AI circuit-breaker state | written by `ai-circuit-breaker.server.ts:29` | same | n/a | no | OPS (do not export) |

### 1.3 Operational / derivable collections (do not export as product content)

| Collection | Writer | Reader / UI | Class |
|---|---|---|---|
| `aiFlowLogs` | `logAIFlow` (`src/lib/ai-flow-logger.ts:169`), always writes (see §6) | `/admin/ai-logs` (client SDK) | OPS |
| `aiRunTraces/{sessionId}` | `src/lib/ai-run-trace.ts:208,287,449,469` | `/admin/run-traces` | OPS |
| `devTodos` | `/api/admin/dev-todos` (`route.ts:8`), `/api/internal/dev-todos` (shared secret, `route.ts:19`) | `/admin/dev` → `DevTodoList.tsx` | OPS (backlog, export separately if wanted) |
| `tickets` | `/api/report-issue` (`route.ts:42`), `/api/tickets` | parent `/parent/orders`; **no admin triage UI** | USER |
| `feedback` (+ testimonials) | `/api/feedback`, `/api/feedback/testimonial` | `rating-prompt.tsx`; no admin UI | USER (testimonials may be worth keeping) |
| `help-*` docs in user collections | `POST /api/admin/help-sample-data` from `src/data/help-sample-data.json` (`route.ts:6-114`) | help wizards (public via rules) | DERIVABLE (reseed from JSON) |

### 1.4 Runtime user data (wipe)

`users` (+ `addresses`, `voices` subcollections; the parent's cloned voices live at
`users/{uid}/voices`, `api/voices/clone/route.ts:163-168`, Storage `users/{uid}/voice-samples/…`),
`children` (+ `sessions`), `characters`, `exemplars` (actor exemplars, Storage `exemplars/{uid}/…`),
`storySessions` (+ `messages`, `events`), `stories` (+ `storybooks/pages`, `shareTokens`, `outputs`),
`storyBooks` (legacy), `printStoryBooks`, `printOrders`, `shareLinks`, `entitlementLedgers`,
`tickets`, `feedback`; Storage `stories/**`, `canonicals/**`, `storybook_printables/**`.

Note on "voices" as config: there is **no curated voices collection**. Preset narrator voices are a
hard-coded list in `src/lib/tts-config.ts:9-50`; the only Firestore voice config is
`systemConfig/voice` (recording script) and `systemConfig/diagnostics.elevenLabsApiVersion`.

### 1.5 Storage dependency (export warning)

Exporting Firestore alone leaves these config fields pointing at Storage objects that a bucket
reset would delete:

| Config field | Storage prefix | Regenerable? |
|---|---|---|
| `imageStyles.exampleImages[].url` | `imageStyles/{id}/examples/` | **No**: hand-uploaded reference art |
| `imageStyles.sampleImageUrl` | `imageStyles/{id}/sample_*` | AI (cost) |
| `imageStyles.sceneExemplars.*.imageUrl` | `sceneExemplars/{styleId}/{tag}/` | AI (cost). The startup backfill (`src/instrumentation.ts:36-43`) only regenerates tags whose entry is missing or not `ready` (`src/lib/scene-exemplar-backfill.ts:35-37`), so **a dangling URL with `status:'ready'` is never repaired** |
| `storyOutputTypes.imageUrl` | `storyOutputTypes/{id}/` | AI or upload |
| `storyTypes.backgroundMusic.audioUrl` | `story-types/{id}/background-music.mp3` | AI (ElevenLabs) |
| `storyGenerators.backgroundMusic.audioUrl` | `story-generators/{id}/background-music.mp3` | AI |
| `answerAnimations.soundEffect.audioUrl` | `animations/{id}/sound-effect.mp3` | AI |

URLs are token-bearing download URLs built against the bucket name
(`style-scene-exemplar-flow.ts:116`), so they also break if the project or bucket changes. An export
must copy these objects, or rewrite and regenerate them.

---

## 2. How config is loaded

There are eight near-identical server loaders, each a module-level `{cachedConfig, timestamp}` with a
60s TTL, `{...DEFAULT, ...doc.data()}` shallow merge, and fallback to defaults on error:

| Loader | Doc | TTL | Cache clear exported | Notes |
|---|---|---|---|---|
| `src/lib/ai-model-config.ts:20-51` | `aiModels` | 60s | `clearModelConfigCache` | uses `initFirebaseAdminApp`+`getFirestore` directly; others use `getServerFirestore` |
| `global-prompt-config.server.ts` | `prompts` | 60s | yes | |
| `compile-prompt-config.server.ts` | `compilePrompt` | 60s | yes | |
| `pagination-prompt-config.server.ts` | `paginationPrompt` | 60s | yes | |
| `image-prompt-config.server.ts` | `imagePrompt` | 60s | yes | two getters: `getGlobalImagePrompt` ('' when off) and `…OrDefault` |
| `kids-flow-config.server.ts` | `kidsFlows` | 60s | yes | dead consumer |
| `order-transparency-config.server.ts` | `orderTransparency` | 60s | yes (sync) | caches defaults on error |
| `email/send-email.ts:11-75` | `email` | 60s | yes | deep-merges `templates` |
| `feature-flags.server.ts` | `featureFlags` + Remote Config | 30s / 60s | test hook only | injectable deps |
| `get-elevenlabs-config.server.ts` | `diagnostics` | none | — | reads on every call |
| `style-scene-exemplar-flow.ts:121-135` | `sceneExemplars` | none | — | inline, per-tag merge |
| `ops/health-check/route.ts:76` | `opsHealth` | none | — | inline + `resolveThresholds` |
| `prompt-config-resolver.ts` | `promptConfigs` | none | — | 3-step ID fallback, throws |
| client `use-diagnostics.tsx` | `diagnostics` | live listener | — | client also writes |

Observations:

- The admin PUT routes call the matching `clear…Cache()` (e.g. `system-config/prompts/route.ts:103`),
  but that clears only the instance that served the PUT. Other App Hosting instances serve stale config
  for up to 60s. `email` is written from the client, so no cache is cleared at all.
- Collection config (`storyTypes`, `storyGenerators`, `storyOutputTypes`, `imageStyles`,
  `printLayouts`…) has **no loader layer**: each flow or route queries Firestore inline, and several
  client pages read them directly through the client SDK (`story-browser.tsx:174,182`).
- Defaults live in three places: `src/lib/types.ts` (`DEFAULT_*_CONFIG`), per-module constants
  (`order-transparency`, `scene-exemplar-config`, `ops/health-checks`, `feature-flags`), and inline in
  flows (generator prompt defaults, model fallbacks).
- The 8 cache loaders are copy-paste duplicates. A generic `getConfigDoc(path, defaults, ttl)` would
  replace them.

---

## 3. Feature-flag and model-selection control planes

### 3.1 On/off switches: at least seven control planes

| # | Plane | Scope | Where |
|---|---|---|---|
| 1 | Env `FLAG_<KEY>` | registered flags | `feature-flags.ts:58-70` |
| 2 | Firebase Remote Config server template | registered flags (UID/email/percentage) | `feature-flags.server.ts:72-108` |
| 3 | `systemConfig/featureFlags` | registered flags | `feature-flags.server.ts:118-134` |
| 4 | `systemConfig/diagnostics` booleans | logging, UI chrome, analytics kill-switch, TTS model | `types.ts:1740` |
| 5 | `systemConfig/kidsFlows` | per-creation-mode enable | dead, see §1.2 |
| 6 | `storyGenerators.status` + `enabledForKids` (+ `storyTypes.status`, `storyOutputTypes.status`, `helpWizards.status`, `answerAnimations.isActive`) | per-entity visibility | `kids-generators/route.ts:29-30` |
| 7 | Ad-hoc env vars | `NEXT_PUBLIC_ANALYTICS_ENABLED`, `MOCK_STORYBOOK_IMAGES` (`story-image-flow.ts:42`), `TEST_MODE`/`E2E_FAKE_AI` (`src/lib/test-mode.ts:23`), `MIXAM_MOCK_MODE`, `ENABLE_DEV_LOGS`, `NEXT_PUBLIC_ENABLE_SW` | scattered |

Planes 1-3 together form the "feature flags" system. Its precedence is env, then Remote Config, then
Firestore, then the code default (`feature-flags.ts:17-24`). The registry holds **one flag**,
`health_verbose` (`feature-flags.ts:37`). Its only consumer is `/api/health`; `/api/flags` exposes it,
and `useFeatureFlag` has no consumers outside regression. PostHog is used for analytics plus a
server-side query for ops metrics (`src/lib/posthog-query.server.ts`), **not** for flags. Analytics is
gated by plane 4 (`enableAnalytics`), plane 7 (`NEXT_PUBLIC_ANALYTICS_ENABLED`) and consent
(`posthog-provider.tsx:45`).

### 3.2 Model selection: four overlapping sources, one mostly unused

| Source | Applies to | Actually consulted? |
|---|---|---|
| `systemConfig/aiModels.imageGenerationModel` | image flows | **Yes**, 11 image flows call `getImageGenerationModel` (each with its own hard-coded `FALLBACK_IMAGE_MODEL`, e.g. `story-image-flow.ts:41`) |
| `systemConfig/aiModels.primaryTextModel / lightweightTextModel / legacyTextModel` | text flows | **No.** `getPrimaryTextModel`, `getLightweightTextModel` and `getLegacyTextModel` have zero callers. Text flows hard-code the model: `warmup-reply-flow.ts:119`, `gemini3-flow.ts:208`, `story-wizard-flow.ts:250`, `story-text-compile-flow.ts:281`, `story-pagination-flow.ts:309`, `story-page-flow.ts:260`… The admin page still shows `MODEL_USAGE_MAP` (`src/lib/ai-model-usage-map.ts:10-39`), which claims these flows use the configured model |
| `storyTypes.promptConfig.model` | beat, ending | Yes (`story-beat-flow.ts:318`, `ending-flow.ts:203`), with differing fallbacks (flash vs pro) |
| `promptConfigs.model` | warmup, beat | temperature/maxTokens only (`warmup-reply-flow.ts:112-127`, `story-beat-flow.ts:304-308`); `name` ignored |
| `storyGenerators.defaultModel / promptConfig[key].model` | friends (and per-prompt) | friends flow resolves it (`friends-flow.ts:358-381`); gemini3/gemini4/wizard hard-code pro |

Net effect: changing a text model at `/admin/ai-models` has no effect. The real text-model knobs are
spread across the code, `storyTypes`, `promptConfigs` and `storyGenerators`.

---

## 4. Admin / ops tooling inventory

Entry points: `/admin` dashboard (links at `src/app/admin/page.tsx:128-206`, diagnostics toggles at
`:241`+), `/writer` hub (tabs at `src/app/writer/page.tsx:109-112`, links at `:145-281`), `/admin/dev`
(test-harness links at `src/app/admin/dev/page.tsx:63-127`).

| Page | Data path | Collections / docs | Linked from | Assessment |
|---|---|---|---|---|
| `/writer` | client SDK | storyPhases, promptConfigs, storyOutputTypes, printLayouts | header, admin | live hub |
| `/admin/storyTypes` | client SDK + `/api/music/generate` | storyTypes | writer | live |
| `/admin/storyGenerators` | client SDK + seed + music | storyGenerators | writer | live |
| `/admin/storyOutputs` | client SDK + output-type image APIs | storyOutputTypes, printLayouts | storyDesigner, pagination-prompt | live |
| `/admin/prompts`, `/admin/upload` | client SDK | promptConfigs | writer / admin | live (legacy-shaped data) |
| `/admin/storyPhases` | client SDK | storyPhases | **unlinked** (writer has its own tab) | inert data |
| `/admin/storyDesigner` | client SDK | storyTypes, promptConfigs, storyOutputTypes | **unlinked** | likely abandoned |
| `/admin/image-styles` | client SDK + `/api/imageStyles/*` | imageStyles + Storage | writer | live |
| `/admin/answer-animations` | client SDK + soundEffects APIs | answerAnimations | writer | live |
| `/admin/helpWizards` | client SDK + help-sample-data | helpWizards, `help-*` docs | writer | live |
| `/admin/global-prompts`, `compile-prompt`, `pagination-prompt`, `image-prompt` | `/api/admin/system-config/*` | systemConfig/prompts, compilePrompt, paginationPrompt, imagePrompt | writer | live; the routes require `isAdmin` (`system-config/prompts/route.ts:20`) although they are linked from the writer hub |
| `/admin/voice-config` | `/api/admin/system-config/voice` | systemConfig/voice | writer | live |
| `/admin/kids-flows` | `/api/admin/system-config/kids-flows` | systemConfig/kidsFlows | **unlinked** | **abandoned** (no runtime consumer) |
| `/admin/ai-models` | `/api/admin/ai-models*` | systemConfig/aiModels | admin | live, but text models inert (§3.2) |
| `/admin/email-config` | client SDK + `/api/admin/test-email` | systemConfig/email | admin | live |
| `/admin/system-addresses` | `/api/admin/system-config/addresses` | systemConfig/addresses | admin | live |
| `/admin/mixam-catalogue` | `/api/admin/mixam-catalogue` (live Mixam API) + system-config/mixam | systemConfig/mixam | print-products | live |
| `/admin/print-layouts`, `/admin/print-products`, `/admin/products`, `/admin/print-orders` | client SDK / APIs | print area | admin/writer | live (print agent) |
| `/admin/ops` | `/api/admin/ops/health-check`, `/metrics` | systemConfig/opsHealth, stories, printOrders, aiFlowLogs, PostHog | admin | live (newest tooling) |
| `/admin/ai-logs` | client SDK | aiFlowLogs | admin | live |
| `/admin/run-traces` | client SDK | aiRunTraces | dev | live |
| `/admin/dev` | `/api/admin/dev-todos`, story-generators/seed | devTodos | admin | live |
| `/admin/regression` (2825 lines) | ~35 API routes + client SDK | many | dev | live (CLAUDE.md mandates it) |
| `/admin/storyBeatTest`, `storyArcTest`, `storyCompileTest`, `paginationTest` | single API each | — | dev | dev harnesses |
| `/admin/create` | client SDK | children, characters, storySessions | dev | dev data |
| `/admin/database` | `/api/admin/database/listDocuments` | any | admin | live (read-only browser) |
| `/admin/deleted-items` | client SDK | children, characters, stories | admin | live |
| `/admin/cleanup` | `/api/admin/cleanup` (GET scan / POST / DELETE), `/api/admin/cleanup-exemplars` | user collections, aiFlowLogs, aiRunTraces, Storage `stories/*/exemplars` | **unlinked** | live-ish; hard-codes `VALID_PARENT_EMAIL = 'parent@rcnx.io'` (`api/admin/cleanup/route.ts:9`) as the only user to keep |
| `/admin/users`, `/admin/view-as-parent/[uid]` | client SDK + `/api/admin/token-usage` | users, children… | admin | live |
| `/admin/characters`, `/admin/children`, `/admin/sessions` | client SDK / `/api/admin/sessions` | user data | **unlinked** | stale viewers |
| `/admin/voiceTest` | `/api/voices/list`, `/preview` | — | **unlinked** | dev harness |
| `/admin/tasks` | `POST /api/admin/migrations/story-sessions` (`tasks/page.tsx:25`) | — | **unlinked** | **broken**: route does not exist |

API-only ops tools: `/api/admin/audit-collections` (schema audit; no UI caller, only listed in
`api-documentation`), `/api/internal/system-test` (called by `.github/workflows/system-tests.yml`,
nightly), `/api/health` + `/api/healthz` (`apphosting.yaml`, `instrumentation.ts`),
`/api/admin/system-config/seed` (diagnostics only), `/api-documentation` page (hand-maintained route
list, drifts from `docs/API.md`).

Migrations: `src/lib/migrations/migrate-story-types.ts` and
`src/lib/migration/migrate-children-characters.ts` (note the two directory names) have **no importers**.
Both are dead code.

---

## 5. Terminology overlaps

| Term in code | What it is | Overlaps with |
|---|---|---|
| **storyGenerator** (`storyGenerators/{id}`) | A creation **mode/engine**: wizard, gemini3, gemini4, beat, friends, each with its own API route and prompts | "kids flow" (`systemConfig/kidsFlows` keys `wizard/chat/gemini3/gemini4/friends`, where `chat` ≈ generator `beat`); `generatorId` on sessions; the creation-modes area calls these "modes" |
| **storyType** (`storyTypes`) | A **genre/arc template** (adventure, mystery…) used only by the beat/chat mode (and ending/compile) | Has its own `promptConfig` + `model`, which duplicates `promptConfigs`; "story designer" |
| **storyOutputType** | The **output format** (picture book, poem, colouring pages) | Overlaps print layout (`defaultPrintLayoutId`) and the pagination prompt (`paginationPrompt` per type vs `systemConfig/paginationPrompt`) |
| **storyPhase** | A phase definition (warmup/beat/ending) | `promptConfigs.phase`, `storySessions.currentPhase`, gemini4 `phase_*` prompts, friends phases. The collection itself is unused |
| **promptConfig** (`promptConfigs`) | Level-band prompt doc for warmup/beat | `StoryTypePromptConfig` (`storyTypes.promptConfig`), `StoryGeneratorPromptConfig` (`storyGenerators.promptConfig` = per-prompt model/temp, not prompt text!), `storyGenerators.prompts` (prompt text), `systemConfig/prompts` (= global **prefix**, `GlobalPromptConfig`) |
| **"prompt" system docs** | `systemConfig/prompts` (global prefix), `compilePrompt`, `paginationPrompt`, `imagePrompt` | Each is a single prompt fragment with `enabled`; naming does not say "prefix" |
| **exemplar** | (a) actor reference sheet (`exemplars` collection, user data); (b) storybook-scoped actor exemplars (`stories/*/exemplars` Storage); (c) image-style **scene exemplars** (`imageStyles.sceneExemplars`, `systemConfig/sceneExemplars`) | `/api/admin/cleanup-exemplars` deletes only (b) |
| **voice** | preset list in code; `users/{uid}/voices` (cloned); `systemConfig/voice` (recording script) | "voices" in REVIEW_PLAN means presets + script |
| **diagnostics** | Actually the general **settings/kill-switch** doc | feature flags |

---

## 6. Delete candidates and inconsistencies

### Delete candidates (evidence)

- `systemConfig/kidsFlows` + `/admin/kids-flows` + `/api/admin/system-config/kids-flows` + `/api/kids-flows` + `kids-flow-config.server.ts`: no client reads `/api/kids-flows`; superseded by `storyGenerators.enabledForKids`.
- `storyPhases` collection + `/admin/storyPhases` + writer tab + `storyTypes.defaultPhaseId/endingPhaseId`: no runtime reader.
- `getPrimaryTextModel`, `getLightweightTextModel`, `getLegacyTextModel` and the three text fields of `aiModels` (or wire them up); `MODEL_USAGE_MAP` is misleading.
- `src/lib/migrations/*`, `src/lib/migration/*`: no importers.
- `src/ai/flows/start-story-flow.ts`: no importers (it still queries `promptConfigs`).
- `/admin/tasks`: calls a non-existent route.
- `/admin/storyDesigner`, `/admin/voiceTest`, `/admin/characters`, `/admin/children`: unlinked.
- `/api/admin/audit-collections`: no UI caller.
- `useFeatureFlag` hook: only regression uses it.
- `/api/imageStyles/seed`: creates duplicate styles on every run.

### Notable inconsistencies

1. **Admin model selection is mostly a no-op** (§3.2): text models are hard-coded in flows, while the UI shows a usage map that says otherwise.
2. **Generator seed clobbers curated prompts**: `story-generators/seed` rewrites `prompts` from code with `merge:false` (`seed/route.ts:378-390`) and keeps only music/model/temperature. The "Seed" button sits on both `/admin/dev` and `/admin/storyGenerators`. The help-wizard and print-layout "seed" buttons also overwrite whole docs (`helpWizards/page.tsx:41`, `print-layouts/page.tsx:933`). Prompt defaults exist in three copies: flow constants, seed constants and Firestore.
3. **The `enableAIFlowLogging` / `enableServerLogging` toggles do nothing server-side.** Only the client hook and admin page read them, and `logAIFlow` writes on every call (`ai-flow-logger.ts:169`).
4. **Config and state mixed in one doc**: `aiModels.availabilityCheck`, and `opsHealth.thresholds` alongside `lastAlertedAt`/run state. An export of `systemConfig` would capture state; a reset of state would wipe config.
5. **Docs drift**: SCHEMA.md lists `systemConfig/compile-prompt` and `systemConfig/kids-flows`, but code uses `compilePrompt` / `kidsFlows`. SCHEMA calls `sceneExemplars` "admin-editable" although no editor exists. SYSTEM_DESIGN's model table (`docs/SYSTEM_DESIGN.md:240-245`) repeats the inert text-model mapping.
6. Three config docs have no editor (`featureFlags`, `orderTransparency`, `sceneExemplars`, plus `opsHealth.thresholds`). Their values are changed in the console and are invisible to anyone using the admin UI.
7. Inconsistent write paths: some config goes through admin API routes (system-config/*), some through the client SDK under rules (storyTypes, imageStyles, email), with different role gates. For example `imageStyles`/`storyGenerators` are admin-only in rules while `storyTypes` is writer-writable, and prompt routes require admin although they are linked from the writer hub.
8. Every authenticated parent can read all `systemConfig` docs (`firestore.rules:332-335`), including email templates, business addresses and Mixam payment mode.
9. `DEFAULT_EMAIL_CONFIG.senderEmail` hard-codes a personal address (`types.ts:1934-1935`). Cleanup hard-codes a single "real" parent email (`cleanup/route.ts:9`).

---

## Observations for the redesign

- The export script should cover: `promptConfigs`, `storyTypes`, `storyGenerators`, `storyOutputTypes`,
  `imageStyles`, `answerAnimations`, `helpWizards`, `printLayouts`, `printProducts`, `products`,
  `prices`, and `systemConfig/{diagnostics,prompts,compilePrompt,paginationPrompt,imagePrompt,voice,email,aiModels*,addresses,mixam,orderTransparency?,sceneExemplars?,featureFlags?,opsHealth.thresholds}`.
  Strip `availabilityCheck`, `lastAlertedAt` and run state, and skip `circuitBreakers` and `kidsFlows`.
  Optionally include `storyPhases` and `devTodos`.
- The export must copy the Storage prefixes in §1.5 (at minimum `imageStyles/*/examples/`) and
  rewrite URLs on import. Otherwise, clear `sceneExemplars` so the backfill regenerates them.
- A single typed config registry would remove the 8 duplicated loaders and give each config a
  defaults source, a cache, invalidation and an editor. Splitting config docs from state docs, and
  flags from settings, would follow from it.
