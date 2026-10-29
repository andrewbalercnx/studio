# As-Is: Storybook Pipeline (compiled Story → finished digital storybook)

> Mapping date: 2026-10-29. Read-only survey of the code as it stands on `main`.
> Scope: pagination, storybook creation, page/image/exemplar/audio generation, art-status rollups,
> finalization/lock, share tokens, reading UIs as consumers, and the `stories/*` storybook data.
> Out of scope (handoff points noted inline): story compile and creation modes (**creation agent**),
> character/actor/canonical-image pipeline (**characters agent**), printable PDF internals,
> `printStoryBooks`, `printOrders` (**print agent**), `systemConfig`/prompt config (**config agent**),
> client shells and api-client package (**clients agent**).

All paths are relative to repo root. `file:line` citations refer to the current tree.

---

## 1. The pipeline as executed today

### 1.0 Entry point / handoff from creation

The input is a `stories/{storyId}` document with `storyText` (with `$$actorId$$` placeholders),
`actors[]`, `synopsis`, `metadata.title`, written by `/api/storyCompile` (creation agent). By
convention `storyId == storySessionId` (kids PWA uses `doc('stories', sessionId)`,
`src/app/kids/create/[sessionId]/generating/page.tsx:62-63`).

At compile time `/api/storyCompile` already fires, via `after()`, three story-level background jobs
that belong to this area's data but are *not* storybook-scoped
(`src/app/api/storyCompile/route.ts:199-209`):
`storyAudioFlow` (whole-story narration → `stories.audioUrl`), `storyActorAvatarFlow`
(composite avatar → `stories.actorAvatarUrl`), `storyTitleFlow`.

### 1.1 V2 pipeline (the only live storybook generation path)

```
[client]  choose output type + image style
   │
   ├─(A) POST /api/storybookV2/create  ......... kids PWA (/kids/create/[sessionId]/style), mobile
   │      or client addDoc(stories/{id}/storybooks) ... /child/[childId]/create-book, /story/[storyId]
   ▼
stories/{storyId}/storybooks/{sbId}   pageGeneration.status=idle, imageGeneration.status=idle
   │
   │  client "generating" page observes the doc (onSnapshot) and, when pageGeneration=idle,
   ├─(B) POST /api/storybookV2/pages  (synchronous, maxDuration 120s)
   │      storyPageFlow ──► storyPaginationFlow (LLM, 3 attempts) ──► image-scene-repair
   │      writes pages/page-NNN (delete-all + batch set), storybook statuses
   │      fire-and-forget (un-awaited promises, NOT after()):
   │        ├─ storyPageAudioFlow  → per-page ElevenLabs TTS → pages.audioUrl, storybook.audioGeneration
   │        └─ storyExemplarGenerationFlow → per-actor character sheets → storybook.actorExemplarUrls
   ▼
   │  client sees pageGeneration=ready && imageGeneration=idle
   ├─(C) POST /api/storybookV2/images  (synchronous, maxDuration 300s)
   │      polls exemplarGeneration up to 120s, then storyImageFlow per page (concurrency 3)
   │      writes pages.imageUrl/imageStatus, storybook.imageGeneration + artStatus
   ▼
   ├─(D) optional edits: POST /api/storybookV2/pageEdit (text/prompt), POST /images {pageId, forceRegenerate}
   ├─(E) POST /api/storybookV2/finalize {action: finalize|unlock}   → isLocked, finalization.*
   ├─(F) POST /api/storyBook/share {create|revoke}; public GET /api/storyBook/share?shareId=
   └─(G) POST /api/storyBook/printable  ─────► print agent (writes finalization.printable*)
```

Step detail:

| # | Trigger | Route / flow | Inputs | Writes | Guards / idempotency / failure |
|---|---|---|---|---|---|
| A1 | Kids PWA style page → `apiClient.createStorybook` (`src/app/kids/create/[sessionId]/style/page.tsx:155`, `packages/api-client/src/client.ts:283-290`); mobile `mobile/src/contexts/ApiClientContext.tsx:149` | `POST /api/storybookV2/create` | storyId, outputTypeId, styleId, imageStylePrompt | `stories/{id}/storybooks/{auto}` with `pageGeneration/imageGeneration {status:'idle'}`, dims from `printLayouts` @300 DPI or default **1024²** (`src/app/api/storybookV2/create/route.ts:99-130,162-181`) | Owner + persona check (`:72-90`); **consumes `storybook_allowance` entitlement** (`:138-156`). No idempotency key: every call creates a new doc + consumes a unit. |
| A2 | `/child/[childId]/create-book/[storyId]` (`page.tsx:223-241`) and `/story/[storyId]` (`page.tsx:118-136`) | **Client SDK `addDoc`** | same | same doc shape but default dims **2400²** | No entitlement consumption, no server validation; allowed because rules grant owner write on `stories/{id}/**` (`firestore.rules:175-186` (write clause `:184-185`)). |
| B | Client `useEffect` when `storybook.pageGeneration.status==='idle'` (`src/app/kids/create/[sessionId]/generating/page.tsx:127-152`, `src/app/child/[childId]/book/[storybookId]/generating/page.tsx:140`, `src/app/story/[storyId]/storybook/[storybookId]/generating/page.tsx:59`), parent viewer regenerate (`src/app/storybook/[bookId]/page.tsx:341`), mobile `mobile/app/generating/[storyId].tsx:66` | `POST /api/storybookV2/pages` → `storyPageFlow` (`src/ai/flows/story-page-flow.ts:457`) → `storyPaginationFlow` (`story-page-flow.ts:642`) | storyId, storybookId (outputTypeId read from storybook, `pages/route.ts:160-163`) | `pageGeneration.status='running'` (`pages/route.ts:98-103`); pages: deletes all existing then batch-sets `page-NNN` (`:182-204`); on success sets `pageGeneration=ready`, resets `imageGeneration` to idle, `audioGeneration=pending`, `exemplarGeneration=pending` (`:207-223`) | Rejects if `isLocked` (`:93-95`). **No concurrency lock** — a second call while `running` re-runs the LLM and rewrites pages. On flow failure `pageGeneration=error` + user-safe message (`:171-178`, `:261-267`). Pagination failure silently falls back to sentence chunking (`story-page-flow.ts:656-678`). |
| B1 | inside storyPageFlow | `storyPaginationFlow` (`src/ai/flows/story-pagination-flow.ts:74`) | story text, output type, child, print layout/product constraints (`:93-150`) | Returns pages `{bodyText, entityIds, imageDescription, imageScene}`; **side-effect write** `stories.locationRegistry` (`:487-489`) | 3 attempts with rising temperature (`:332-354`); loose schema + deterministic `repairImageScene`/`fillMissingScenes` (`:454-456`, `src/lib/image-scene-repair.ts:65,116`). |
| B2 | inside storyPageFlow | cover scenes (`story-page-flow.ts:626-630`) + page assembly | — | Fixed layout: `cover_front`(0), `title_page`(1, no prompt), N `text` pages, ≥1 `blank`, pad to multiple of 4, `cover_back` (`:696-818`). Each page gets a **placeholder `imageUrl`** (`:708,760,816`) and **no `imageStatus`**. | — |
| B3 | fire-and-forget after B (`pages/route.ts:228-234`) | `storyPageAudioFlow` (`src/ai/flows/story-page-audio-flow.ts`) | storyId, storybookId | pages `audioStatus` generating→ready/error, `audioUrl`, `audioMetadata` (`:381-449`); storybook `audioGeneration.status='ready'` even when pages errored (`:499-504`); Storage `stories/{storyId}/audio/page-NNN-{ts}.mp3` (`:168`) | ElevenLabs, 3 concurrent (`:377`); skips `ready` pages unless forceRegenerate (`:364-371`). Runs in an un-awaited promise after the HTTP response. |
| B4 | fire-and-forget after B (`pages/route.ts:232`) | `storyExemplarGenerationFlow` (`src/ai/flows/story-exemplar-generation-flow.ts:340`) | storybook style, story actors (+child) | `exemplarGeneration` running→ready/error (`:475-482`, `:551-559`), `actorExemplarUrls` map; Storage `stories/{storyId}/exemplars/{actorId}.{ext}` (`:104`) | References come from `actor.avatarUrl` + `actor.photos` (`:242-245`). If the flow throws, status is **left at `running`** (`:565-569`). |
| C | Client `useEffect` when `pageGeneration=ready && imageGeneration=idle` (`kids/create/.../generating/page.tsx:181-211`, `child/.../generating/page.tsx:184`, `story/.../generating/page.tsx:103`); retry buttons (`child/.../generating/page.tsx:240-258`, `storybook/[bookId]/page.tsx:300,386,385-400`); mobile `generating/[storyId].tsx:76` | `POST /api/storybookV2/images` → `storyImageFlow` per page | storyId, storybookId, optional pageId, forceRegenerate, imageStylePrompt, target dims, additionalPrompt (`images/route.ts:29-40`) | `imageGeneration.status='running'` (`:242-247`); waits for exemplars ≤120 s polling every 3 s (`:308-336`); per page resets to `pending` (`:523-533`); flow sets `generating` (`story-image-flow.ts:1496`) then `ready`+`imageUrl`+`imageMetadata` (`:1714-1731`) or `error` (`:1660,1789`); flow `FieldValue.increment` on `imageGeneration.pagesReady` (`:1763-1766`); final rollup `imageGeneration.status ∈ ready/error/rate_limited` + `artStatus` (`images/route.ts:626-686`). Storage `stories/{storyId}/storybooks/{sbId}/pages/{pageId}.{ext}` (`story-image-flow.ts:319-321`). | Rejects if locked (`:224`). **Soft lock**: non-transactional read of `status==='running'` → 409 (`:233-239`). Concurrency 3 (`:540`). Flow: up to 3 attempts with progressively simpler prompts + shared circuit breaker (`story-image-flow.ts:1100-1125`). Rate-limit → `rate_limited`, `rateLimitRetryAt=+1h` (`images/route.ts:677-684`) — **nothing schedules that retry**. |
| D | Page editor dialog (`src/components/storybook/page-editor-dialog.tsx:119`) | `POST /api/storybookV2/pageEdit` (`src/app/api/storybookV2/pageEdit/route.ts:34`) | pageText / imagePrompt (validated by `src/lib/storybook-page-edit.ts:51`) | page `bodyText`+`displayText` / `imagePrompt`, `lastEditedAt/By`; if text changed resets `audioStatus='pending'`, `audioUrl=null` (`:101-111`) | Parent/admin auth; rejects if locked (`:80-82`). Image regen is delegated to route C. Storybook-level `audioGeneration` is not touched. |
| E | Parent viewer (`src/app/storybook/[bookId]/page.tsx:422,439`) | `POST /api/storybookV2/finalize` | action finalize/unlock | finalize: `isLocked=true`, `finalization{version+1,status:'finalized',lockedAt/By,printable*=null}` (`finalize/route.ts:137-158`); unlock: `isLocked=false`, `finalization.status='draft'`, deletes printable URL (`:96-106`); `storySessions/{id}/events` log (`:19-35`) | Gate: `deriveStorybookArtStatus(pages).isOrderable` (`:122-135`) — degraded books can be finalized. Unlock does **not** revoke share tokens. |
| F | Parent viewer (`storybook/[bookId]/page.tsx:456,477`); public share page (`src/app/storybook/share/[shareId]/page.tsx:58`) | `POST/GET /api/storyBook/share` | bookId(=storyId), storybookId, expiry, passcode | `stories/{id}/shareTokens/{shareId}` (`share/route.ts:198`), `shareLinks/{shareId}` lookup (`:201`), `storybooks/{sb}.finalization.share*` (`:211-218`) or legacy `stories.storybookFinalization.share*` (`:220-226`); GET increments `viewCount` (`:417`) | Create requires `isLocked` and non-draft finalization (`:166-170`). GET is unauthenticated; validates status/expiry/passcode (`:290-316`); serves **live** pages, not a snapshot (`:356-369`); `finalizationVersion` stored on token is never compared. |
| G | Parent viewer / parent storybooks list (`src/app/parent/storybooks/[childId]/page.tsx:459,495`) | `POST /api/storyBook/printable` | storyId, storybookId | `finalization.printableStatus/…/status='printable_ready'` (`printable/route.ts:1090,1225-1232`) | **Print agent.** Only blocks when `isLocked === false` (`:1074`), so never-finalized books (`isLocked` undefined) pass. |

On-demand audio (live, outside the B3 batch):
- `POST /api/storyBook/pageAudio` (`src/app/api/storyBook/pageAudio/route.ts:45-64`) → `storyPageAudioFlow` in an un-awaited IIFE; used by reader `src/app/storybook/[bookId]/read/page.tsx:106,150`, parent viewer `storybook/[bookId]/page.tsx:496`, parent list `parent/storybooks/[childId]/page.tsx:420`.
- `POST /api/storyBook/audio` (`src/app/api/storyBook/audio/route.ts:42`) → `storyAudioFlow` via `after()`; whole-**story** narration; used by `src/app/child/[childId]/stories/page.tsx:207`, `src/app/child/[childId]/story/[storyId]/read/page.tsx:154`.
- `POST /api/storyBook/actorAvatar` (`src/app/api/storyBook/actorAvatar/route.ts:39`) → `storyActorAvatarFlow` un-awaited; used by `child/[childId]/stories/page.tsx:261`.
- `POST /api/tts` (`src/app/api/tts/route.ts`) — ad-hoc TTS of arbitrary text (no Firestore writes of book data); used by `src/hooks/use-tts.ts:143`, `src/components/shared/EntityEditor.tsx:205`, mobile `ApiClientContext.tsx:184`, api-client `client.ts:391`.

Instrumentation: `src/instrumentation.ts:36-45` runs `backfillMissingSceneExemplars()` at server boot
(`src/lib/scene-exemplar-backfill.ts:18`), which fires `styleSceneExemplarFlow` for styles missing
`sceneExemplars.{tag}` (`src/ai/flows/style-scene-exemplar-flow.ts:151-221`). Those per-style scene
exemplars are consumed by `storyImageFlow` as style references (`story-image-flow.ts:1578-1589`).
Admin trigger: `src/app/api/imageStyles/generateSceneExemplars/route.ts:29,50` (config agent).

**Orchestration model:** there is no server-side orchestrator or queue. Step B→C sequencing is
driven by whichever client page is open (`useEffect` on Firestore status). If the tab is closed after
B, images are never generated. TEST_MODE seams short-circuit B and C (`pages/route.ts:108-156`,
`images/route.ts:252-288`, `story-image-flow.ts:1428`, `story-page-audio-flow.ts:225`).

### 1.2 Which UI uses which path

| UI | Create | Generate | Read | Path |
|---|---|---|---|---|
| Kids PWA `/kids/create/[sessionId]/style` → `/generating?storybookId=` | API (A1) | B, C via `authFetch` | `/kids/read/[bookId]` via api-client `/api/stories/{id}/storybooks[/{sb}/pages]` | V2 |
| Child shell `/child/[childId]/create-book/[storyId]` → `/child/[childId]/book/[sb]/generating` → `/play` | **client addDoc (A2)** | B, C | `/child/.../play` client SDK (V2 path, legacy fallback `play/page.tsx:62-68`) | V2 |
| `/story/[storyId]` → `/story/[storyId]/storybook/[sb]/generating` | **client addDoc (A2)** | B, C | `/storybook/[bookId]?storyId=` | V2 |
| Parent viewer `/storybook/[bookId]?storyId=` | — | C (retry/regen), B (regen) | client SDK pages | V2 (legacy only when `storyId` param absent, `storybook/[bookId]/page.tsx:96-99`) |
| Reader `/storybook/[bookId]/read` | — | pageAudio | client SDK; legacy `outputs/storybook/pages` fallback (`read/page.tsx:62-67`) | V2 + legacy |
| Mobile app | API (A1) | B, C via `ApiClientContext` | `/api/stories/{id}/storybooks...` | V2 |
| `/story/session/[sessionId]` (+`/compiled`, `/generating`), legacy branch of `/kids/create/.../generating` | — | **`/api/storyBook/pages`, `/api/storyBook/images` — routes do not exist** | `outputs/storybook/pages` | Legacy, broken |

### 1.3 Legacy paths (pre-V2)

- **Story-level generation fields**: `stories.pageGeneration`, `imageGeneration`, `isLocked`,
  `storybookFinalization`, `selectedImageStyle*`, `finalizedPages` (`src/lib/types.ts:419-425`,
  `545-573`). Still *initialised* by `story-wizard-flow.ts:359` and `friends-flow.ts:1042`, still
  written by `printOrders/[orderId]/pay/route.ts:41-49` (print agent), still read by
  `/api/parent/storybooks/route.ts:133-146`, `/api/storyBook/share` legacy branch (`share/route.ts:137-140,372-385`),
  `kids/create/.../generating/page.tsx:76-96`.
- **`stories/{id}/outputs/storybook/pages`**: write paths remain only as fallbacks in
  `storyImageFlow` (`story-image-flow.ts:1417-1420`) and `storyPageAudioFlow` (`:282-295`) when no
  `storybookId` is passed — every current caller passes one. Read fallbacks: `storybook/[bookId]/read/page.tsx:65`,
  `child/.../play/page.tsx:68`, `child/[childId]/books/page.tsx:124`, `story/session/[sessionId]/compiled/page.tsx:30`,
  `/api/parent/storybooks/route.ts:214`, `/api/parent/storybooks/thumbnails/route.ts:99`,
  `/api/storyBook/[bookId]/route.ts:33-38` (always reads `outputs/storybook` doc), and print routes.
- **`/api/storyBook/pages` and `/api/storyBook/images`** are called from
  `story/session/[sessionId]/page.tsx:917,1034`, `story/session/[sessionId]/generating/page.tsx:59,101`,
  `story/session/[sessionId]/compiled/page.tsx:92,117`, `kids/create/[sessionId]/generating/page.tsx:160,218`
  but no such route files exist (`src/app/api/storyBook/` holds only `[bookId]`, `actorAvatar`, `audio`,
  `pageAudio`, `printable`, `share`). These requests resolve to `[bookId]` (GET-only, `[bookId]/route.ts:7`) → 405.
- **Top-level `storyBooks`**: only written by help sample seeding (`src/app/api/admin/help-sample-data/route.ts:89`)
  and the rules test page; audited for cleanup (`src/app/api/admin/cleanup/route.ts:422-429`). Rules still open it (`firestore.rules:190-211`).
- **`exemplars` top-level** (`ActorExemplar`, `types.ts:455-469`): written only by `actor-exemplar-flow.ts:290,318,467`,
  which has **no callers** in `src/`. The live exemplar mechanism is the per-storybook map `actorExemplarUrls`.

---

## 2. Data model

### 2.1 Firestore

| Path | Type (src/lib/types.ts) | Represents | Key fields |
|---|---|---|---|
| `stories/{storyId}` | `Story` (`:368-448`) | Compiled story text (input) + legacy book fields + story-level narration/avatar | `storyText`, `actors[]`, `synopsis`, `locationRegistry` (written by pagination), `audioUrl`/`audioGeneration`/`audioMetadata` (whole-story narration), `actorAvatarUrl`/`actorAvatarGeneration`, legacy `pageGeneration`, `imageGeneration`, `isLocked`, `storybookFinalization`, `selectedImageStyleId/Prompt` |
| `stories/{storyId}/storybooks/{sbId}` | `StoryBookOutput` (`:489-539`) | **The storybook** (one rendering of a story) | `storyOutputTypeId`, `imageStyleId`, `imageStylePrompt`, `printLayoutId`, `imageWidthPx/HeightPx`, `pageGeneration`, `imageGeneration`, `exemplarGeneration`, `audioGeneration` (**untyped**), `artStatus`, `actorExemplarUrls`, `actorExemplars` (deprecated, unused), `isLocked`, `isFinalized` (unused), `finalization` (`StoryBookFinalization`, `:303-331`), `title`, `thumbnailUrl` (lazily cached by `/api/parent/storybooks/thumbnails/route.ts:151`), `deletedAt/By` |
| `.../storybooks/{sbId}/pages/page-NNN` | `StoryOutputPage` (`:708-759`), alias `StoryBookPage` (`:764`) | A page: text + image + audio | `pageNumber`, `kind` (cover_front/title_page/text/blank/cover_back; `image` never produced), `bodyText` (with `$$id$$`), `displayText` (resolved), `entityIds`, `imageDescription`, `imageScene`, `imagePrompt`, `imageUrl`, `imageStatus`, `imageMetadata`, `layoutHints`, `audioUrl`, `audioStatus`, `audioMetadata`, `lastEditedAt/By` |
| `stories/{storyId}/shareTokens/{shareId}` | `StoryBookShareToken` (`:346-361`, unused by code) | Share grant | `bookId`, `storybookId`, `status`, `expiresAt`, `finalizationVersion`, `requiresPasscode`, `tokenHash`, `tokenSalt`, `passcodeHint`, `viewCount`, `lastViewedAt` |
| `shareLinks/{shareId}` | (untyped) | Lookup shareId → story/storybook (avoids collectionGroup) | `storyId`, `storybookId`; rules deny all clients (`firestore.rules:339-341`) |
| `stories/{storyId}/outputs/storybook` (+`/pages`) | `LegacyStoryWithOutput`/`StoryBook` (`:545-578`) | Legacy single storybook per story | `finalization`, pages as `StoryOutputPage` |
| `storyBooks/{bookId}` (top-level) | none | Pre-subcollection legacy book | `ownerUserId`/`parentUid` (rules only) |
| `exemplars/{id}` | `ActorExemplar` (`:455-469`) | Style-specific character sheet (dead) | — |
| `imageStyles/{styleId}.sceneExemplars.{tag}` | `SceneExemplarEntry` (`:1708-1714`) | Per-style scene reference image (config agent owns the doc) | `imageUrl`, `storagePath`, `status`, `errorMessage` |
| `storySessions/{id}/events` | — | Event log (`pages.generated`, `storybook.finalized/unlocked`) | written by `story-page-flow.ts:833`, `finalize/route.ts:19-35` |
| `printStoryBooks/{id}` | `PrintStoryBook` (`:593-614`) | Print-layout snapshot of a storybook | **print agent**; read by `/api/storyBook/[bookId]` (`:88-118`) |

### 2.2 Cloud Storage

| Asset | Path | Writer |
|---|---|---|
| Page image | `stories/{storyId}/storybooks/{sbId}/pages/{pageId}.{ext}` (legacy: `stories/{storyId}/pages/…`) | `story-image-flow.ts:315-321` |
| Page audio | `stories/{storyId}/audio/page-NNN-{ts}.mp3` (**not storybook-scoped**) | `story-page-audio-flow.ts:168` |
| Story narration | `stories/{storyId}/audio/narration-{ts}.{ext}` | `story-audio-flow.ts:203` |
| Actor exemplar (live) | `stories/{storyId}/exemplars/{actorId}.{ext}` (**not storybook/style-scoped**) | `story-exemplar-generation-flow.ts:104` |
| Scene exemplar | `sceneExemplars/{styleId}/{tag}/image.{ext}` | `style-scene-exemplar-flow.ts:100` |
| Image upload fallback | inline `data:` URL written into the page doc when bucket unavailable | `story-image-flow.ts:1692-1699` |

### 2.3 Same thing stored twice / in two shapes

| Concept | Shapes |
|---|---|
| Storybook | `storybooks/{sb}` (V2) · `outputs/storybook` (legacy) · story-level fields on `stories/{id}` (oldest) · top-level `storyBooks` · response shape `StoryOutput` synthesised by `/api/storyBook/[bookId]` (`:148-163`) which also duplicates `finalization` as `storybookFinalization` (`:153-155`) |
| Finalization | `storybooks.finalization` vs `stories.storybookFinalization` vs `outputs/storybook.finalization`; `StoryBookFinalization` vs narrower `StoryOutput['finalization']` (`types.ts:774-789`) |
| Page | `StoryOutputPage` = `StoryBookPage`; `StoryBookFinalizedPage` (`:277-285`, unused); `PrintStoryBookPage` (print) |
| Art progress | `imageGeneration.pagesReady/pagesTotal` (counts all pages incl. title/blank) vs `artStatus.pagesReady/pagesTotal` (illustratable only) |
| Share state | `shareTokens/{id}` + `shareLinks/{id}` + denormalised `finalization.share*` |
| Character reference | `storybooks.actorExemplarUrls` (live) · `storybooks.actorExemplars` (deprecated) · `exemplars/` collection (dead) · character `canonicalImageUrl` (characters agent; not consumed here) |
| Narration | per-page `pages.audioUrl` vs whole-story `stories.audioUrl` |
| Image dimensions | `storybooks.imageWidthPx/HeightPx` (1024² default via API, 2400² via client addDoc) vs per-page-type dims recomputed from print layout in images route (`images/route.ts:441-460`) |

---

## 3. Status fields

| Field (doc) | Declared values | Values actually written (setter file:line) | Readers | Notes / contradictions |
|---|---|---|---|---|
| `storybooks.pageGeneration.status` | idle, running, ready, error, rate_limited (`types.ts:617`) | idle (`create/route.ts:173`, client addDoc), running (`pages/route.ts:99`), ready (`:208`), error (`:172,264`) | generating pages, `/api/parent/storybooks:172`, `story/[storyId]/page.tsx` badges | `rate_limited` never written for pages, yet UIs check it (`child/.../generating/page.tsx:325`). |
| `storybooks.imageGeneration.status` | idle, running, ready, error, rate_limited (`:629`) | idle (create; reset by pages `:213`), running (`images/route.ts:243`), ready / error / rate_limited (`:626-668,745,754`) | all generating pages, `/api/stories/[id]/storybooks:54` (filters `=== 'ready'`), ops health (`src/lib/ops/health-checks.ts:97` also checks non-existent `pending`) | `error` is written for **degraded** books (some art ready, `:635-639`) while `artStatus` says orderable. A crashed/timeout run leaves `running` forever and blocks retries with 409 (`:233`). |
| `storybooks.exemplarGeneration.status` | idle, pending, running, ready, error (`:475`) | pending (`pages/route.ts:220`), running (`exemplar-flow:476`), ready (`:360,464,553`), error (`:553` only if all actors fail) | images route wait loop (`images/route.ts:293-336`) | Uncaught exception leaves `running`; images route then waits the full 120 s. |
| `storybooks.audioGeneration.status` | **not declared on `StoryBookOutput`** | pending (`pages/route.ts:217`), running (TEST_MODE only, `page-audio-flow:229`), ready (`:500`), error (`:532`) | barely (book-reader derives from pages) | Set `ready` even when page audio failed. Not documented in SCHEMA.md. |
| `storybooks.artStatus.completeness` | none, in_progress, complete, degraded, failed (`:663-668`) | `images/route.ts:651-673` only (plus client `recoveryNotified` write, `storybook/[bookId]/page.tsx:191`) | finalize gate (recomputed), order page, mixam, `/api/parent/storybooks:194-198`, `/api/storyBook/[bookId]:160` | Stale after pages regeneration (B does not reset it). Derivation counts missing `imageStatus` as pending. |
| `storybooks.finalization.status` | draft, ready_to_finalize, finalized, printable_pending, printable_ready, ordered (`:269-275`) | draft (unlock `finalize/route.ts:99`), finalized (`:144`), printable_ready (`printable/route.ts:1232`), ordered (`printOrders/route.ts:110`) | share create (`share/route.ts:168`), print routes | `ready_to_finalize`, `printable_pending` never written. Never-finalized books have no `finalization` at all (not `draft`). |
| `finalization.printableStatus` | idle, generating, ready, error | `finalize/route.ts:101,152`, `printable/route.ts:1090,1231,1277` | print UIs | print agent. |
| `storybooks.isLocked` / `isFinalized` | boolean | `isLocked` by finalize; `isFinalized` never written | pages/images/pageEdit routes (409), share | Rules allow the owner client to flip `isLocked` directly. |
| `pages.imageStatus` | pending, generating, ready, error (`:720`) | *absent* at creation; pending (`images/route.ts:525`), generating (`story-image-flow.ts:1497`), ready (`:1716`, skip `images/route.ts:511`), error (`:1661,1790`) | images route, `deriveStorybookArtStatus`, readers | New pages carry a placeholder `imageUrl` with no status. |
| `pages.audioStatus` | pending, generating, ready, error (`:740`) | generating (`page-audio-flow:385`), ready (`:413,434` — also for pages with no text), error (`:446`), pending (`pageEdit/route.ts:106`) | readers, `/api/parent/storybooks` audio rollup | — |
| `stories.audioGeneration.status` | idle, pending, generating, ready, error (`:428-433`) | generating (`story-audio-flow.ts:121`), ready (`:245`), error (`:268`) | child stories/read pages, story-card | Uses `generating` where storybook statuses use `running`. |
| `stories.pageGeneration/imageGeneration` (legacy) | same as storybook | idle only (`story-wizard-flow.ts:359`, `friends-flow.ts:1042`) | legacy UI branches, `/api/parent/storybooks:133` | No live writer moves them past idle. |
| `stories.storybookFinalization.status` (legacy) | — | ordered (`printOrders/[orderId]/pay/route.ts:46`) | `stories/page.tsx:37`, share legacy | Pay route writes the legacy field even for V2 books. |
| `shareTokens.status` | active, revoked, expired (`:344`) | active (`share/route.ts:183`), revoked (`:72`), expired (on read `:296-297`) | share GET | — |
| `imageStyles.sceneExemplars.{tag}.status` | generating, ready, error | `style-scene-exemplar-flow.ts:152,194,207,220` | `story-image-flow.ts:1583`, backfill | — |
| `exemplars.status` | pending, generating, ready, error | dead flow only | none | — |
| `PrintStoryBook.pdfStatus` | draft, generating_pdfs, ready, error | print agent | `/api/storyBook/[bookId]:110` maps `ready` → `finalization.status='printable_ready'` in the response | — |

Vocabulary drift: "in flight" = `running` (storybook generation, exemplars) vs `generating`
(page image/audio, story audio, title/synopsis/avatar, scene exemplars, printable) vs `in_progress`
(artStatus) vs `pending` (audioGeneration/exemplarGeneration initial, page imageStatus reset).
"Not started" = `idle` vs `pending` vs field absent.

---

## 4. Terminology

| Concept | Names in use (where) |
|---|---|
| A storybook (one rendering of a story) | `StoryBookOutput` (type, `types.ts:489`); "storybook"/`storybookId` (V2 routes, collection `storybooks`); `storybookV2` (route prefix); "book"/`bookId` (`/storybook/[bookId]` = storybookId when `?storyId=` present, else storyId; `/api/storyBook/[bookId]` = **storyId**; `/kids/read/[bookId]`); `StoryBook` (deprecated alias of `LegacyStoryWithOutput`, `:578`, still imported by `components/child/story-card.tsx`, `story/session/[sessionId]/page.tsx`); `storyBook` (legacy route prefix `/api/storyBook/*`, local var in `storybook/[bookId]/page.tsx:131`); "output" (`outputs/storybook`, `StoryOutput` response type `:768`, `storyOutputTypeId`); `storybookOutput` (local var); `bookId: storyId` returned by `storyPageFlow` (`story-page-flow.ts:848`); `printStoryBook` (print snapshot, distinct entity) |
| Story vs session | `storyId` == `sessionId` by convention (`kids/create/[sessionId]` uses sessionId as storyId) |
| Output type | `storyOutputTypeId` (“picture book”, “poem”) — "output" here means *format*, not the storybook |
| Page | `StoryOutputPage`, `StoryBookPage`, `FlowPage` (story-page-flow), `PageWithId` (images route), `StoryBookFinalizedPage`, `PrintStoryBookPage` |
| Character reference sheet | "exemplar", "actor exemplar", `actorExemplarUrls`, `actorExemplars`, `ActorExemplar`, "reference sheet", "character sheet" |
| Style reference | "style example images", "scene exemplar" (`sceneExemplars`), "sample image" |
| Art rollup | `artStatus`, "degraded-book contract", `StoryBookArtStatus`, `completeness` |
| Lock / finalize | `isLocked`, `isFinalized` (unused), `finalization.status='finalized'`, "lock", "finalize" |
| Narration | page audio (`audioUrl` on pages, `storyPageAudioFlow`) vs story audio (`stories.audioUrl`, `storyAudioFlow`) vs TTS (`/api/tts`) |
| Scene | `imageScene` (structured), `imageDescription` (freeform), `imagePrompt` (assembled prompt), `locationRegistry` |

---

## 5. Collections touched

| Collection | Reads (client SDK = C, Admin SDK = A) | Writes |
|---|---|---|
| `stories` | A: all storybookV2 routes, flows, share, `[bookId]`, `/api/stories/*`, `/api/parent/storybooks`; C: all generating/reader pages | A: pagination (`locationRegistry`), story-audio, actor-avatar, share (legacy finalization), pay route (legacy); C: soft-delete of legacy book (`parent/storybooks/[childId]/page.tsx:531`) |
| `stories/*/storybooks` | A: storybookV2 routes, flows, share, printable, `[bookId]`, `/api/stories/[id]/storybooks`, `/api/parent/storybooks`; C: generating pages, parent viewer, reader, child books/play, `story/[storyId]`, print-layout, admin deleted-items | A: create, pages, images, finalize, pageEdit, share, printable, page-audio, exemplar, image flows, thumbnails route; **C: `addDoc` create (A2), `artStatus.recoveryNotified`, soft-delete/undo (`parent/storybooks/[childId]/page.tsx:531-553`), admin regression** |
| `stories/*/storybooks/*/pages` | A: routes + flows + share GET + `/api/stories/.../pages`; C: parent viewer, reader, child play, book-reader components | A only in product code (pages route, image flow, audio flow, pageEdit, images route); C: admin regression page |
| `stories/*/shareTokens` | A: share route | A: share route |
| `shareLinks` | A: share GET | A: share POST (clients denied by rules) |
| `stories/*/outputs/storybook[/pages]` | A: `[bookId]` route, parent storybooks routes, print routes; C: reader/play/compiled/child books fallbacks | A: image/audio flow fallbacks only (no live caller); admin cleanup deletes |
| `storyBooks` | rules test page, admin cleanup | help-sample seeding |
| `exemplars` | — | `actor-exemplar-flow` (no callers) |
| `imageStyles` | A: image flow, exemplar flow; C: create pages | A: scene-exemplar flow (config agent) |
| `storyOutputTypes`, `printLayouts`, `printProducts`, `children`, `characters` | A: create, pagination, page, image, exemplar flows; C: create pages (`printLayouts`) | — (owned by other agents) |
| `storySessions/*/events` | — | A: page flow, finalize |
| `printStoryBooks` | A: `[bookId]` route | print agent |
| `systemConfig` (circuit breaker, prompts, scene exemplar config) | A | A (breaker state) — config agent |
| `aiFlowLogs` / run traces | — | A: `logAIFlow`, `logAICallToTrace` in flows |

Security note: `firestore.rules:175-186` (write clause `:184-185`) grants the story owner full write on every subcollection
under `stories/{id}` — including `storybooks` status/lock/artStatus/finalization fields, `pages`,
and `shareTokens`. Server-side invariants (lock, entitlement, status machine) are therefore advisory
against a crafted client.

---

## 6. Live vs legacy vs dead

### 6.1 Classification

| Item | Status | Evidence |
|---|---|---|
| `/api/storybookV2/{create,pages,images,finalize,pageEdit}` | Live | callers in §1.2 |
| `storyPageFlow`, `storyPaginationFlow`, `image-scene-repair`, `storyImageFlow`, `storyExemplarGenerationFlow`, `storyPageAudioFlow`, `styleSceneExemplarFlow` | Live | §1.1 |
| `/api/storyPagination` | Admin/test only | only `src/app/admin/paginationTest/page.tsx:213` (+ regression 401 probe); still writes `stories.locationRegistry` |
| `/api/storyBook/[bookId]` | Live (order page) | `src/app/storybook/[bookId]/order/page.tsx:82`; always reads legacy `outputs/storybook` |
| `/api/storyBook/{pageAudio,audio,actorAvatar,share}` | Live | §1.1 |
| `/api/storyBook/printable` | Live (print agent) | `parent/storybooks/[childId]/page.tsx:459` |
| `/api/tts` | Live | §1.1 |
| `storyAudioFlow` (story-level) | Live | storyCompile `after()`, `/api/storyBook/audio` |
| `/api/storyBook/pages`, `/api/storyBook/images` | **Called but missing** (→405) | callers listed in §1.3 |
| `/story/session/[sessionId]` page/generating/compiled, legacy branch of `kids/create/.../generating` | Legacy, non-functional for generation | depend on missing routes; kids style page always passes `storybookId` (`style/page.tsx:175`) |
| `outputs/storybook` write paths in image/audio flows | Dead (fallback unreachable) | all callers pass `storybookId` (`images/route.ts:479`, `pages/route.ts:228`, `system-test/route.ts` passes storybookId) |
| `actor-exemplar-flow.ts`, `exemplars` collection, `ActorExemplar` type | Dead | no imports of `actorExemplarFlow` outside its file |
| `LegacyStoryWithOutput`, `StoryBookFinalizedPage`, `StoryBookShareToken`, `isFinalized`, `actorExemplars` | Dead/unused types/fields | 0 references outside `types.ts` (`StoryBook` alias: 2 importers) |
| api-client `getStorybookStatus` | Stub | throws 501 (`packages/api-client/src/client.ts:326-336`) |
| Top-level `storyBooks` | Legacy residue | help-sample + rules only |

### 6.2 Delete candidates

1. Calls to `/api/storyBook/pages|images` and the `/story/session/[sessionId]/{,generating,compiled}` generation UI (or rewire to V2).
2. Legacy branches in `kids/create/[sessionId]/generating/page.tsx:54-58,153-176,213-262`.
3. `outputs/storybook` fallbacks in `story-image-flow.ts:1417-1420`, `story-page-audio-flow.ts:282-295`, `buildStoragePath` legacy branch.
4. `actor-exemplar-flow.ts`, `ActorExemplar`, `exemplars` collection + SCHEMA.md section.
5. `LegacyStoryWithOutput`, `StoryBook` alias, `StoryBookFinalizedPage`, `StoryBookShareToken` (or start using it), `StoryBookOutput.isFinalized`, `actorExemplars`.
6. `storyBooks` collection rules and help-sample entries (already planned: `docs/SCHEMA_CLEANUP_PLAN.md:366-379`).
7. Unused finalization statuses `ready_to_finalize`, `printable_pending`; `pageGeneration` `rate_limited`.
8. `_debug` payload and `printStoryBookId`-as-storybookId fallback in `/api/storyBook/[bookId]/route.ts:120-144`.
9. `getStorybookStatus` stub.

### 6.3 Notable bugs and inconsistencies

1. **Entitlement bypass**: two web create paths (`child/.../create-book`, `story/[storyId]`) create storybooks with client `addDoc`, skipping `consumeEntitlement` in `/api/storybookV2/create` (`:138`). Generation routes do not check entitlements.
2. **Client-driven orchestration**: B→C chaining relies on an open client page; pages route background work uses un-awaited promises (`pages/route.ts:228-234`) rather than `after()` (which `/api/storyBook/audio` and storyCompile do use), so audio/exemplars can be cut off on serverless.
3. **Stuck `running`**: images route can exceed `maxDuration=300` (120 s exemplar wait + ⌈n/3⌉ batches with up to 3 attempts each); a killed run leaves `imageGeneration.status='running'`, and the soft lock (`images/route.ts:233`) then 409s every retry. Ops health only alerts (`health-checks.ts:97`). Same for `exemplarGeneration` on exception.
4. **No real retry for `rate_limited`**: `rateLimitRetryAt` is written (`images/route.ts:681`) and shown ("We'll try again soon") but nothing reads it to retry.
5. **Degraded vs `imageGeneration.status`**: degraded books get `status='error'` (`:637`); `/api/stories/[id]/storybooks` hides any book whose status isn't `ready` (`:54`), so degraded-but-orderable books are invisible to mobile/kids lists by default, contradicting `artStatus`.
6. **Exemplar storage collision**: `stories/{storyId}/exemplars/{actorId}.{ext}` is shared by all storybooks of a story; generating a second storybook (other style) overwrites the object and its download token, breaking/changing the first book's `actorExemplarUrls`.
7. **Page regeneration side-effects**: `/pages` deletes pages without deleting their Storage images or audio (orphans), leaves `artStatus` stale, and has no lock (concurrent calls duplicate LLM + audio + exemplar work).
8. **Progress counters disagree**: `pagesTotal` set to jobs count (`images/route.ts:548`), flows increment `pagesReady`, then both overwritten with all-page counts incl. title/blank (`:616-620`); `artStatus.pagesTotal` excludes them.
9. **Audio rollup lies**: storybook `audioGeneration.status='ready'` regardless of page failures (`story-page-audio-flow.ts:499-504`); single-page regen overwrites `pagesReady` with 1. Page audio Storage paths are story-scoped.
10. **Share**: unlock does not revoke tokens; `finalizationVersion` is never checked; GET serves live pages, so a re-finalized (edited) book changes under an old link.
11. **Two default dimension sets** (1024² API vs 2400² client vs 2400² images-route fallback) for the same field.
12. **Data URL fallback** writes base64 images into page docs (`story-image-flow.ts:1693`), risking the 1 MiB doc limit.
13. Pay route marks the **legacy** `stories.storybookFinalization.status='ordered'` (`printOrders/[orderId]/pay/route.ts:46`) — handoff to print agent.
14. Printable route only blocks `isLocked === false`, so never-finalized books can be printed (`printable/route.ts:1074`) — handoff to print agent.
15. `finalize/route.ts:1` has a `'use server'` directive on a route handler file.
16. Client may pass an arbitrary `imageStylePrompt` override to `/images` (`images/route.ts:480`).
17. Rules let owners write any storybook field (lock, status, artStatus) directly (`firestore.rules:184-185`).

---

## Observations for the redesign

- There are effectively four storybook representations; only `stories/{id}/storybooks/{sb}` + `pages` is
  generated today. The others survive as read fallbacks and type aliases.
- Pipeline state lives in five sibling status objects plus a derived `artStatus`, with three
  "in-flight" spellings. A single job/state model (with leases/heartbeats instead of a bare `running`)
  would remove the stuck-lock and fake-retry problems.
- Orchestration belongs on the server (one "generate book" job: pages → exemplars → images, audio in
  parallel) rather than in client `useEffect`s on five different pages.
- Creation should have exactly one server entry point (entitlement, dims, idempotency key).
- Asset paths should be storybook-scoped (exemplars, page audio) and cleaned on regeneration.
- Share links should snapshot (or be pinned to) a finalization version.
