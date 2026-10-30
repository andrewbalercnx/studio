# System Design Document

> **Last Updated**: 2026-10-30 (Gemini 2.5 retired: defaults moved to Gemini 3.x, retired names mapped on read). 2026-10-29 (Phase 5.3: server-side Story creation (§13) — five modes behind one engine interface, `POST /api/stories` + turns + abandon + finish, `story.finish` job, target Stories and turns in `stories`, trial-data reset script; not yet used by the clients (5.4). Phase 5.2: the web app and kids PWA make and read Books on the server pipeline (§3, §12); `storybookV2` and its flows deleted; old storybooks read-only for parents with their print path; printing not yet available for new Books; mobile book creation switched off. Phase 5.1: server-side Book pipeline — `manuscripts` / `books` / `jobs`, job kinds on Cloud Tasks, five new routes; Phase 4 server foundations in `src/server`, present but not yet used by product flows; Phase 3: rules protect server-trusted fields, rules tests in CI, threat model; server actions must self-authenticate; kids wizard action). 2026-10-28 (Phase 0 route auth: Admin-SDK routes enforce ownership via `route-auth.server.ts`; web clients use `authFetch`). Earlier: 2026-06-11 (W4-A: child persona model — signed httpOnly persona cookie + chokepoint enforcement, verify-pin lockout, PIN-guard reload grace)
>
> This document describes the current architecture of StoryPic Kids. It should be read at the beginning of any major piece of work to understand the system before making changes.

---

## Overview

StoryPic Kids is an interactive story creation platform for children. Children create personalized stories through guided conversations with an AI, which are then transformed into illustrated storybooks that can be viewed digitally or printed as physical books.

### Core User Flows

1. **Story Creation**: Child interacts with AI through warmup → story beats → ending → compilation
2. **Book making**: the child picks a book type (Form) and an art style (Style); the server paginates the story into a Manuscript, narrates it and draws the Book's pictures as background jobs
3. **Print Ordering**: Parents can order physical copies through Mixam print-on-demand integration

---

## Technology Stack

### Frontend
- **Framework**: Next.js 16 with App Router
- **UI Library**: React 18.3 with TypeScript 5
- **Styling**: Tailwind CSS with Radix UI components (shadcn/ui)
- **Forms**: React Hook Form with Zod validation

### Backend
- **API Routes**: Next.js App Router API handlers (`src/app/api/`)
- **AI Orchestration**: Genkit 1.25 for managing AI flows
- **Database**: Cloud Firestore (NoSQL)
- **Storage**: Firebase Storage for images, audio, and PDFs
- **Authentication**: Firebase Authentication

### AI/ML Services
- **Text Generation**: Google Gemini models (configurable via admin UI)
- **Image Generation**: Google Gemini image models (configurable via admin UI)
- **Video Generation**: Vertex AI (Veo for avatar animations)
- **Voice Cloning & TTS**: ElevenLabs

Model selection is centrally managed via Firestore (`systemConfig/aiModels`) and the admin UI at `/admin/ai-models`. See Configuration System section for details.

### External Integrations
- **Print-on-Demand**: Mixam API for book printing
- **Commercial catalog**: payment-agnostic `products`/`prices` model + admin management (`/admin/products`). See `docs/PRODUCTS.md`.
- **Payment**: (Future — Stripe; `prices.externalPriceId` is the reserved hook)

---

## Architecture Decisions

### Why Firestore (NoSQL)?

Firestore was chosen for several reasons:
- **Real-time subscriptions**: UI can react to data changes immediately
- **Hierarchical data model**: Natural fit for parent → child → story → pages structure
- **Offline support**: Progressive web app can work offline
- **Security rules**: Fine-grained access control at document level
- **Scalability**: Automatic scaling without database administration

### Why Genkit for AI Orchestration?

Genkit provides:
- **Flow abstraction**: Complex AI operations broken into testable flows
- **Model abstraction**: Easy to switch between Gemini versions
- **Tracing**: Built-in observability for debugging AI calls
- **Type safety**: TypeScript-first with Zod schema validation

### Why Next.js App Router?

- **Server Components**: Reduced client bundle size
- **API Routes**: Backend logic colocated with frontend
- **Static/Dynamic rendering**: Optimal performance per route
- **Middleware**: Authentication and routing logic

### Why ElevenLabs for Voice?

- **Voice cloning**: Parents can clone their voice for narration
- **High quality TTS**: Natural-sounding narration for children
- **Multiple voices**: Preset voices available without cloning

---

## System Components

### 1. Authentication Layer

```
Firebase Auth → Custom Claims → Role-Based Access
```

**Roles**:
- `isAdmin`: Full system access, order management
- `isWriter`: Content configuration (prompts, story types)
- `isParent`: Own children, stories, orders

**Implementation**: Custom claims set via Firebase Admin SDK. Firestore security rules enforce access based on claims.

### 2. Story Session Engine

> What today's clients run. Its replacement — one Story, five creation modes behind one interface,
> three routes and the `story.finish` job — is on the server since slice 5.3 (§13); slice 5.4 moves
> the clients and deletes this engine.

```
Session State Machine:
warmup → story (beats 0-N) → ending → final/completed
```

**Key Collections**:
- `storySessions`: Session state and metadata
- `storySessions/{id}/messages`: Chat history

**Flow**:
1. Session created with `currentPhase: 'warmup'`
2. `/api/warmupReply` handles warmup interactions
3. Session transitions to `story` phase with `storyTypeId` set
4. `/api/storyBeat` generates story options, advances `arcStepIndex`
5. At arc completion, `/api/storyEnding` generates endings
6. `/api/storyCompile` creates final story text

### 3. Books in the clients (web app, kids PWA)

Books are made by the server pipeline (Story → Manuscript → Book, §12). The clients start a Book and
then only watch it ([`architecture/target/slices/5.2-book-clients.md`](architecture/target/slices/5.2-book-clients.md)).

```
story complete ─▶ child picks Form + Style (BookChooser)
               ─▶ POST /api/books { storyId, formId, styleId, idempotencyKey }
               ─▶ /books/{bookId} (web) | /kids/book/{bookId} (PWA)
                    watches books/{id} (status, art {total, done, failed}), manuscripts/{id},
                    and the pages of both — progress, then the reader
```

- **Create**: `src/components/books/book-chooser.tsx` (kids PWA `/kids/create/{storyId}/style`, web
  child shell `/child/{childId}/create-book/{storyId}`) and the parent's dialog on `/story/{storyId}`.
  `useCreateBook` (`src/hooks/use-books.ts`) makes one idempotency key per choice, so a double tap
  or a retry returns the same Book and charges the book allowance once. Length and density default
  from the Form on the server.
- **Read**: `src/hooks/use-books.ts` subscribes read-only to `books/{id}`, `books/{id}/pages`,
  `manuscripts/{id}` and `manuscripts/{id}/pages`; list queries filter on `ownerUid` (the rules
  require it), with optional `childId` / `storyId`. Nothing is written from the browser.
- **Status comes from the server**: lists (kids My Books, child My Books and dashboard count, the
  parent's book list and story page) show `book.status` as written by the job runner; `ready`,
  `partial` and `locked` open the reader, `illustrating` shows progress. No client derives readiness
  from pages any more.
- **Reader** (`src/components/books/book-reader.tsx`): cover with the title, then one story page at
  a time with its picture, words and narration clip. A partial Book is readable; a page whose
  picture failed shows a placeholder.
- **Parent controls** (`/books/{bookId}` in parent mode, behind the PIN guard): draw a failed page
  again (`POST /api/books/{id}/pages/{n}/retry`) and lock / unlock. **Printing is not available for
  these Books yet**: the page says "Printing is coming soon" and offers no print layout or order
  entry (the print slice adds it).
- **Rationale**: the server drives every step (ADR-0002/0005), so closing the tab no longer stops a
  book, and every client reads the same documents with the same status vocabulary.

**Old storybooks** (`stories/{storyId}/storybooks`, made by the deleted `storybookV2` routes) are
trial data kept until the data reset. Parents still see them read-only: the "Earlier storybooks"
section of `/story/{storyId}` and `/parent/storybooks/{childId}`, the viewer `/storybook/{id}` (pages,
share for locked books, print layout and order) and `/storybook/{id}/read`. Generating, repainting,
page editing, finalizing and narration for them are gone. Child-facing lists show new Books only.

**Shared page components** (`src/components/book-reader/`): `BookPageSpread`, `ParentBookView`
and `BookReader` render old storybooks for parents; `ImmersivePlayer` renders shared links
(`/storybook/share/{id}`).

**Mobile**: book creation is switched off ("Make books in the web app for now"); the app still lists
and reads old storybooks through `/api/stories/*`. It does not show new Books yet.

### 4. Print Production System

```
Storybook → PrintStoryBook → PDF Generation → Mixam Order
```

**Key Collections**:
- `printStoryBooks`: Print-specific layout and configuration
- `printOrders`: Order tracking and fulfillment
- `printProducts`: Product catalog (hardcover, paperback options)
- `printLayouts`: Page layout templates

**Workflow**:
1. Parent initiates print from finalized storybook
2. `PrintStoryBook` created with layout configuration
3. PDFs generated (separate cover and interior for Mixam)
4. Order created (`POST /api/printOrders/mixam`), awaits admin approval
5. Admin approves → submitted to Mixam API
6. Webhooks update order status through fulfillment

**Degraded-order gate (Sprint W2-C)**: the order route evaluates `evaluateOrderArtGate`
(`src/lib/storybook-status.ts`) against the book's `artStatus`. A degraded (partial-art) book is
orderable but only with an explicit `acknowledgeDegraded: true` — otherwise the route returns
`409 degraded_confirmation_required` and the checkout shows a "pages will print without pictures"
confirmation. Acknowledged orders carry `degradedArtAcknowledged` + `artStatusSnapshot` for audit.
Fully-failed or in-progress art blocks the order; books with no rollup (legacy) fail open with the
printable-PDF checks as backstop.

**Saved addresses (Sprint W2-C)**: checkout offers "save this address"; the order route persists it
server-side to `users/{uid}/addresses` (deduped), and the order page pre-offers saved addresses on
subsequent orders via `GET /api/user/addresses`.

### 5. Character & Actor System

**Actors** are entities that appear in stories (children, characters). They use `$$id$$` placeholder syntax in story text for personalization.

**Collections**:
- `children`: Child profiles with photos, preferences
- `characters`: Story characters (pets, toys, family members)

**Avatar Generation**:
- Photos uploaded → AI generates consistent cartoon avatar
- Optional dancing animation via Veo video generation

### 6. Configuration System

**Admin-Managed Collections**:
- `promptConfigs`: AI prompt templates per phase/level
- `storyTypes`: Story arc templates (adventure, mystery, etc.)
- `storyPhases`: Phase definitions (warmup, beat, ending)
- `storyOutputTypes`: Output formats (picture book, poem)
- `imageStyles`: Art style prompts (watercolor, cartoon)
- `answerAnimations`: Q&A exit/selection animations with sound effects
- `systemConfig/*`: Global settings (diagnostics, prompts, AI models)

**AI Model Configuration** (`systemConfig/aiModels`):

Central configuration for which AI models to use across the application. Managed via `/admin/ai-models`.

| Model Type | Purpose | Flows Using It |
|------------|---------|----------------|
| `imageGenerationModel` | Image generation | avatar-flow, character-avatar-flow, etc. (the Book pipeline resolves its models through `config/aiModels` purposes, §11) |
| `primaryTextModel` | Complex text generation | story-beat-flow, story-compile-flow, character-traits-flow |
| `lightweightTextModel` | Simple text tasks | story-synopsis-flow, image-description-flow |
| `legacyTextModel` | Specific older use cases | story-title-flow |

**Implementation**:
- Central module at `src/lib/ai-model-config.ts` with 1-minute caching
- Flows call `getImageGenerationModel()`, `getPrimaryTextModel()`, etc.
- Admin UI includes availability checking against Google AI API
- Alerts can be sent to maintenance users when models become unavailable
- Retired models: `src/lib/retired-models.ts` maps every Gemini model Google has shut down
  (1.5, 2.0, 2.5) to its replacement (`gemini-3.8-flash` for text, `gemini-3.1-flash-image` for
  images). Every place that reads a model name from Firestore (this config, `config/aiModels`,
  `storyGenerators`, story types) passes it through `currentModelId`, so a stale stored value
  cannot route calls to a model that returns 404. Defaults use stable models only; there is no
  stable Gemini 3 Pro, so Flash serves the former Pro purposes.

**Design Principle**: Content configuration is data-driven, allowing non-developers to adjust AI behavior and story options.

### 7. Q&A Animation System

The Q&A animation system provides visual feedback during story creation when children select answers:

**Animation Flow**:
1. Child selects an answer option
2. Non-selected answers animate off-screen (10 different exit animations: slide, shrink, spin, bounce, etc.)
3. Selected answer plays a celebration animation, then exits
4. Sound effects play synchronized with animations

**Components**:
- `answerAnimations` collection: Stores animation configurations (CSS transforms, durations, easing)
- `/api/soundEffects/generate`: Generates sound effects via ElevenLabs text-to-sound-effects API
- `AnimatedChoiceButton`: React component that orchestrates animation playback
- Writer portal at `/admin/answer-animations` for configuring animations

### 8. Development Todo List

Tracks work items that should be done for a production-ready system. Both admins and Claude (AI assistant) can add items to this list.

**Purpose**:
- Track technical debt, missing features, and improvements identified during development
- Provide context and implementation guidance for future work
- Enable Claude to flag follow-up items when completing tasks

**Components**:
- `devTodos` collection: Stores todo items with title, description (Markdown), status, priority, category
- `/api/admin/dev-todos`: CRUD API endpoints (admin-only)
- `DevTodoList` component: UI at `/admin/dev` with add/edit/delete, markdown preview, "Copy for Claude" feature
- Standing instructions in `CLAUDE.md` for when/how Claude should add items

**Workflow**:
1. Admin or Claude identifies work needed for production readiness
2. Item added via UI (admin) or API (Claude) with description in Markdown format
3. Admin can copy formatted todo to clipboard to provide context to Claude
4. Items marked complete when implemented

---

### 9. First-Run Onboarding (guided activation)

Gets a brand-new family from an empty account to a finished book unaided. The biggest activation risk is parents stalling before the "wow" moment, so guidance is **pushed** (checklist + auto tips) instead of buried in the help menu.

**Components**:
- **Step derivation** (`src/lib/onboarding.ts`): pure, unit-tested function mapping real account state → completion of the five steps (`createChild` → `addPhoto` → `createStory` → `generateArt` → `previewBook`).
- **`GET/POST /api/user/onboarding`**: the only place steps are computed (server-first principle — clients render, never decide). GET derives from Firestore (children, `storySessions`, `stories` + `storybooks` subcollections), persists the snapshot to `users/{uid}.onboardingState`, and records the `signupAtMs`/`firstBookAtMs` pair. Short-circuits on cached state once complete/dismissed, so established accounts cost one doc read.
- **`OnboardingChecklist`** (`src/components/onboarding/onboarding-checklist.tsx`): non-modal, dismissible card on `/` and `/parent` listing the five steps with the next action highlighted and deep-linked. Renders nothing for non-parents, after dismissal, or once complete — zero change for established accounts. Deliberately never blocks the funnel (no modal, no required interaction).
- **`OnboardingTipTrigger`** (`src/components/onboarding/onboarding-tip-trigger.tsx`): auto-starts a help wizard once per account on first use of story creation (`/kids/create`) and art generation (`/kids/create/[sessionId]/style`). Reuses the existing help-wizard infrastructure — the tips are ordinary `helpWizards` docs (`tip-first-story`, `tip-first-art`, seeded from `src/data/help-wizards.json` via the admin Help Wizards page). Conditioned on `onboardingState.tipsSeen` (server-persisted), never stacks on another wizard, and no-ops when the wizard docs aren't seeded.
- **Empty states**: child/character/storybook list pages all point at the concrete next action (create profile / create character / start a story with this child) instead of dead-ending.

**Instrumentation (time-to-first-book)**:
- Analytics events (`src/lib/analytics/events.ts`): `onboarding.step_completed`, `onboarding.checklist_dismissed`, `onboarding.first_book_ready` (with `durationMs`), `onboarding.tip_shown` — emitted through the existing PostHog-backed module (buffered/no-op until analytics goes live).
- Durable fallback: `signupAtMs`/`firstBookAtMs`/`timeToFirstBookMs` persisted on `users/{uid}.onboardingState`, so activation timing is queryable directly from Firestore before PostHog is enabled.

**Rationale**: deriving steps from real state (rather than client-side event bookkeeping) makes the checklist self-healing across devices and lets the step logic change server-side without client updates.

---

### 10. Feedback Loop & Order Transparency (Sprint W3-C)

Closes the satisfaction loop: ratings/NPS become tracked metrics, testimonials feed the
marketing flywheel, issue reports become tickets with visible status, and parents can see
where a print order actually is.

**Post-moment rating prompts**:
- **`RatingPrompt`** (`src/components/feedback/rating-prompt.tsx`): non-modal, dismissible
  card (floating or inline) collecting 1–5 stars + optional NPS 0–10 + optional comment.
  Parent surfaces only — never mounted under `/kids/*`. Mounted on `/storybook/[bookId]`
  (trigger `book_first_view`, fires when a fully illustrated book is viewed) and on the
  post-order confirmation (`order_placed`).
- **Trigger/suppression logic** (`src/lib/feedback/triggers.ts`): pure, unit-tested
  `shouldShowFeedbackPrompt` — requires a signed-in parent, the moment actually reached, and a
  positive server eligibility check; anything unknown suppresses (a missed prompt is cheap, an
  annoying one is not). Suppression is **server-backed**: one `feedback` doc per
  parent+trigger+subject (dismissals included) means "never shown twice" holds across devices.
- **API** (`POST /api/feedback`, `GET /api/feedback/eligibility`): server-first — clients never
  write the `feedback` collection directly; validation is shared with the client via the same
  lib. Scalar-only analytics events (`feedback.*`) are emitted alongside; free text stays in
  Firestore.

**Testimonial capture**: ratings ≥4 unlock an optional "share your story" step — explicit
consent checkbox, quote, optional photo (uploaded server-side via
`POST /api/feedback/testimonial`, reusing the children-photos Storage pattern). Stored with
`consent`/`consentedAt` on the feedback doc. Capture only; no public display yet.

**Tracked support tickets**: `POST /api/report-issue` now persists a `tickets` doc
(`open` → `in_progress` → `resolved`) before sending the maintenance email (email is
best-effort). Parents see their tickets and status in the Support Tickets section of
`/parent/orders` (`GET /api/tickets`); status transitions are admin-side. Ticket shaping is
pure and unit-tested (`src/lib/tickets.ts`).

**Order pipeline transparency**: `src/lib/order-timeline.ts` derives a five-step parent-facing
timeline (placed → quality review → sent to printer → printing → shipped) from the fifteen
internal `MixamOrderStatus` values, plus filter buckets and an honestly-labelled turnaround
estimate (`systemConfig/orderTransparency`, default 10–15 business days). Per the server-first
principle the derivation runs **in the API** (`GET /api/printOrders/my-orders`, and the initial
timeline in the `POST /api/printOrders/mixam` response for the new confirmation screen);
`OrderTimelineView` only renders. Unknown future statuses degrade gracefully to "just placed";
`on_hold`/`validation_failed` surface as a calm attention note rather than raw status strings.

**Rationale**: prompts are deliberately non-blocking (no modals, no required interaction) so
the activation funnel is untouched; suppression lives server-side so prompt-fatigue rules can
change without client updates; status mapping lives server-side so new Mixam states never
require a client release.

### 11. Server Foundations (`src/server`)

Phase 4 of the architecture rebuild (`docs/architecture/REVIEW_PLAN.md`) added the modules the
rebuilt slices are built on. They are used by the server-side Book pipeline (§12) and Story creation (§13); everything in
sections 1–10 still runs on the code it always did. How a slice uses each module is in
[`architecture/target/foundations.md`](architecture/target/foundations.md).

| Module | What it is |
|--------|------------|
| `src/server/errors.ts` | Typed errors (`BadRequest` 400, `Unauthenticated` 401, `PaymentRequired` 402, `Forbidden` 403, `NotFound` 404, `Conflict` 409, `DataIntegrity` 500, `ServiceUnavailable` 503) shared by all modules |
| `src/server/http` | `withRoute({ auth: 'public' \| 'user' \| 'admin' \| 'internal', body })`: verifies the Firebase ID token from the `Authorization` header only (no `?idToken=`), or a Cloud Tasks OIDC token for `internal`; validates the body with zod; maps errors to one envelope (`{ ok: true, data }` / `{ ok: false, error: { code, message, details? } }`). Ownership helpers `assertOwner` / `loadOwned` check `ownerUid` (admin/writer exempt) and the child-persona scope |
| `src/server/data` | Repositories over the **target** collections (`jobs`, `stories` + `turns`, `manuscripts` + `pages`, `books` + `pages` / `castSheets` / `renders`). Reads are parsed with zod (malformed docs throw `DataIntegrityError`), writes are validated and stamped with `createdAt` / `updatedAt` |
| `src/server/jobs` | The job runner (ADR-0002/0003): `JobRegistry` (kind → handler, queue group; kinds registered in `kinds.ts`), `enqueue` (job id derived from the idempotency key), `runJob` (transactional lease, retry with backoff up to `maxAttempts`, fan-in to the coordinator job), and two dispatchers: in-process (default) and Cloud Tasks (`JOBS_DISPATCHER=cloud-tasks`) |
| `src/server/ai` | The AI harness (ADR-0008): `AIModelRegistry` resolves a model by purpose from `config/aiModels` (30 s cache) with code defaults equal to today's flow models; `aiCall` / `aiGenerateText` / `aiGenerateImage` add the shared circuit breaker + retry (`ai-circuit-breaker.server.ts`) and one `aiFlowLogs` entry per call when `systemConfig/diagnostics.enableAIFlowLogging` is on |
| `src/server/config` | `ConfigService`: one typed loader with one cache (60 s default TTL), schema validation, in-flight read sharing and explicit `invalidate()`, replacing the per-file `*-config.server.ts` pattern for new code |
| `src/server/catalog` | Form, Style and Layout in target shapes, read from today's `storyOutputTypes`, `imageStyles` and `printLayouts` until config is re-seeded under the target names |

**Internal job route**: `POST /api/internal/jobs/run` (`withRoute({ auth: 'internal' })`)
accepts only an OIDC token whose audience is `JOBS_OIDC_AUDIENCE` (default `JOBS_RUN_URL`) and
whose email is `JOBS_INVOKER_SERVICE_ACCOUNT`; without that configuration it rejects every call.

**Configuration**: `apphosting.yaml` sets `JOBS_DISPATCHER=cloud-tasks`, `JOBS_TASKS_PROJECT`,
`JOBS_TASKS_LOCATION` (`europe-west1`; Cloud Tasks has no europe-west4, where the backend runs), `JOBS_RUN_URL` and `JOBS_INVOKER_SERVICE_ACCOUNT`
(`JOBS_QUEUE_PREFIX`, `JOBS_OIDC_AUDIENCE` unset). The queues (`ai-text`, `ai-image`, `tts`,
`render`, `mixam`), the invoker service account and its IAM bindings are created by
`scripts/setup-cloud-tasks.sh`, run once by the owner (`docs/DEPLOYMENT.md` §9). Locally and in
tests the in-process dispatcher runs jobs in the same process.

**Lint guard**: `eslint.config.mjs` forbids importing `@/server/*` or `@/ai/flows/*` from
`src/components`, `src/hooks`, `src/contexts` and `src/app/**/page.tsx` / `layout.tsx`.

**Rationale**: the rebuild replaces browser-driven, per-flow plumbing with one route guard, one
data access path with schemas, one job model and one AI harness, so each Phase 5 slice can move
onto them and delete its old code.

### 12. Server-side Book pipeline (Story → Manuscript → Book)

Slice 5.1 of the rebuild (ADR-0001; [`architecture/target/slices/5.1-book-server.md`](architecture/target/slices/5.1-book-server.md)).
It takes a `stories/{storyId}` document as the Story (today's legacy shape, or a `complete` target Story made by §13) and produces:

```
POST /api/manuscripts | POST /api/books        (withRoute, owner + persona, one transaction each)
   │ Manuscript (status paginating)              Book (illustrating) + pages; allowance charged
   ▼
manuscript.paginate (ai-text) ─ ready ─┬─▶ manuscript.narrate × pages (tts) → pages.narrationUrl
                                       └─▶ book.prepareCast (for each Book waiting)
book.prepareCast ─▶ book.castSheet × cast (ai-image) ─ fan-in ─▶ book.illustrate
book.illustrate  ─▶ book.pageArt × pages (ai-image)  ─ fan-in ─▶ Book ready | partial | failed
POST /api/books/{id}/pages/{n}/retry → a new book.illustrate for that page
POST /api/books/{id}/lock | /unlock (unlock runs bookUnlockHooks: share-link revocation seam)
```

- **Server-driven**: every step is a Job on Cloud Tasks; closing the browser changes nothing. The
  browser reads `manuscripts`, `books` and `jobs` (own documents) for progress; only the server
  writes (rules: owner read, admin write).
- **Manuscript** (`src/server/books/pagination.ts`): one model call (`manuscript.text` purpose)
  with today's loose schema, 3 temperatures for degenerate output, deterministic scene repair and
  continuity, fitted to exactly the chosen length (picture books 12, 16 or 24). Page text is stored
  with names resolved; `scene.presentCast` lists cast ids so prompts never scrape text.
- **Cast and likeness** (`cast.ts`): the child and `story.actors`, looked up only inside the
  owner's family. Cast sheets are drawn from `canonicalImageUrl` (the portrait), else original
  photos, else the `imageDescription` text (from original photos, CLAUDE.md rule); `avatarUrl` and
  placeholder images are never a likeness.
- **Art** (`jobs.ts`, `art-prompts.ts`): page prompts from the scene, the present cast's sheets
  and the Style's scene reference / example images; each job attempt simplifies the prompt (style
  images dropped, then all images), as today's flow did within one request.
- **Files** are stored per Book (or Manuscript) and per job attempt, so two Books never collide and
  a retry never overwrites a referenced file.
- **TEST_MODE** (`isTestMode()`): every handler writes fixtures (text split deterministically,
  `TEST_MODE_IMAGE_DATA_URL`, `TEST_MODE_AUDIO_DATA_URL`) without AI or TTS, so the pipeline runs
  end to end in the emulator with the in-process dispatcher.
- **Allowance**: `storybook_allowance` is consumed in the transaction that creates the Book, with
  the ledger semantics of `src/lib/entitlements` (free tier, child pool then family).

**Used by** the web app and the kids PWA (§3). **Not yet**: print (no `book.render`, layouts or
orders for Books; the print slice adds them) and the mobile app.

### 13. Server-side Story creation (five modes, one interface)

Slice 5.3 of the rebuild (ADR-0004, ADR-0009; [`architecture/target/creation.md`](architecture/target/creation.md),
[`architecture/target/slices/5.3-creation-server.md`](architecture/target/slices/5.3-creation-server.md)).
**On the server, not yet used by the clients**: today's clients still run the Story Session Engine
(§2); slice 5.4 moves web, kids PWA and mobile onto these routes and deletes §2.

```
POST /api/stories {childId, modeId, castIds?, idempotencyKey}
   child owned + persona │ mode live (enabledForKids for a child persona) │ story_allowance available (check)
   ▼  StoryContext (one builder) ─▶ engine.start ─▶ one transaction: Story (creating) + turn 0 (+ characters)
POST /api/stories/{id}/turns {input, idempotencyKey}
   claim (tx, pendingTurn lease) ─▶ engine.respond (model calls, no tx) ─▶ tx: input + reply turns, cast,
   modeState; on done: text, status finishing, enqueue story.finish
story.finish (ai-text job): synopsis + title ─▶ one tx: status complete + one story_allowance consumed
POST /api/stories/{id}/abandon   creating → abandoned
POST /api/stories/{id}/finish    failed → finishing (new job)
```

- **Engines** (`src/server/creation/engines/`): `wizard`, `freeplay` (today's gemini3), `guided`
  (gemini4), `friends`, `adventure` (the beat engine with StoryType arcs and a chosen ending), each
  `start(ctx) → Turn` and `respond(ctx, input) → Turn | Done`. Ported from today's flows with their
  prompts; prompts come from `storyGenerators` (and `storyTypes.promptConfig` for adventure) through
  the CreationMode adapter (`modes.ts`). Engines never write Firestore; their state between turns is
  `Story.modeState`, never the client.
- **One StoryContext builder** (`context.ts`): the Story, its turns, the owner-scoped family roster
  (hero, siblings, characters in the child's scope), likeness summaries (`imageDescription`, from
  original photos), preferences, mode config, StoryType.
- **Cast tokens** (`tokens.ts`): stored text, prompts and options use `[[cast:<castId>]]`
  (`castId` = the child/character document id); model output in any token form (`$$id$$`, `$id$`, a
  name) is normalised against the roster, so another family's id can never be stored. Turns also
  store the resolved words (`promptDisplay`, option `display`) so clients render without lookups.
- **AI-introduced characters**: created in `characters` (`origin: 'story'`, `ownerParentUid`,
  scoped to the hero) and added to the cast in the transaction that records the turn.
- **Concurrency**: one turn at a time per Story, claimed in a transaction keyed by the request's
  idempotency key (`pendingTurn` with a lease, so a crashed request does not block for long); a
  repeated key returns the recorded reply; a different turn meanwhile gets 409.
- **Models**: every call through the AI harness with purpose `creation.text`; a mode's
  `defaultModel` is the only override (ADR-0008). Model failures are 503 and record nothing.
- **Allowance**: checked when a Story starts (402 before anything is created), consumed exactly once
  by `story.finish` in the transaction that sets `complete`. Every mode ends through it (today
  Wizard and Friends skip compile and are never charged).
- **TEST_MODE**: every engine and `story.finish` model call returns a deterministic fixture, so the
  emulator E2E (slice 5.4) can create a Story end to end through the UI.
- **Books**: `src/server/books/story-source.ts` reads both shapes (target Stories must be
  `complete`); the legacy branch is deleted in 5.4. Rules: owner reads target Stories and turns; no
  client writes.
- **Trial-data reset** (`scripts/reset-trial-data.mjs`, `docs/DEPLOYMENT.md` §10) ships with 5.4.

---

## Data Flow Diagrams

### Story Creation Flow

```
┌─────────────┐     ┌──────────────┐     ┌─────────────┐
│   Child     │────▶│  /api/*      │────▶│  Firestore  │
│   (React)   │◀────│  (Genkit)    │◀────│  (NoSQL)    │
└─────────────┘     └──────────────┘     └─────────────┘
                           │
                           ▼
                    ┌──────────────┐
                    │  Gemini AI   │
                    │  (Text Gen)  │
                    └──────────────┘
```

### Book Flow

```
┌──────────┐ POST /api/books ┌──────────────┐ jobs (Cloud Tasks / in-process) ┌──────────────────┐
│ Browser  │────────────────▶│ books route  │────────────────────────────────▶│ /api/internal/   │
│ (Form +  │                 │ (one tx:     │                                 │ jobs/run         │
│  Style)  │                 │ Book, pages, │   manuscript.paginate ─▶ narrate │ (Gemini, image   │
│          │◀── listeners ───│ allowance)   │   cast sheets ─▶ page art        │  model, TTS)     │
└──────────┘  books/{id},    └──────────────┘                                 └──────────────────┘
              manuscripts/{id} (+ pages)  ◀───────────── server writes ─────────────────┘
```

### Print Order Flow

```
┌───────────┐    ┌───────────┐    ┌───────────┐    ┌───────────┐
│ Storybook │───▶│  Print    │───▶│   Admin   │───▶│   Mixam   │
│ Finalized │    │  Order    │    │  Approval │    │   API     │
└───────────┘    └───────────┘    └───────────┘    └───────────┘
                                                         │
                                                         ▼
                                                  ┌───────────┐
                                                  │  Webhook  │
                                                  │  Updates  │
                                                  └───────────┘
```

---

## Security Model

### Authentication
- Firebase Auth with email/password — **one account per family** (the parent's). Children are data (`children/{childId}` docs), not auth principals.
- Parent PIN for the child-lock feature (client-side gate, server-verified)
- Custom claims for role-based access (`isAdmin`/`isWriter`); `isParent` falls back to the profile doc (claims are never provisioned at signup, and doc-roles must never grant admin because users can write their own doc)

### Child persona model (Sprint W4-A)

"A child is playing" is primarily client state (React `activeChildId`, the kids-PWA localStorage lock). The **persona cookie** gives that state server-side meaning:

- **What child-mode means server-side**: a signed httpOnly cookie `storypic.persona` (HMAC-SHA256 over `{uid, childId, iat}`; `sameSite=lax`; 30-day lifetime — personas are device-level, not session-level). Signing key: `PERSONA_COOKIE_SECRET`, falling back to the Secret Manager-provisioned `INTERNAL_API_SECRET`. Implementation: `src/lib/persona.ts` (pure, unit-tested) + `src/lib/persona.server.ts` (request plumbing).
- **Transition map** (all fire-and-forget via `POST/DELETE /api/persona`; no UI friction is ever added to entering/switching child personas):
  - Enter/switch child ("Who is playing?" tap, "Play as <child>", kids-PWA `lockToChild`) → POST sets the cookie for that child (child→child switching stays PIN-free by owner decision)
  - Switch to parent (header, `switchToParentMode`), kids-PWA unlock (PIN-gated), sign-out → DELETE clears the cookie
  - `help-*` demo profiles → cookie cleared (no real child doc backs them)
- **Enforcement**: the story/book chokepoints (`storySession`, `storyWizard`, `storyCompile`, and the Book routes `/api/manuscripts`, `/api/books/**` through `assertOwner`) call `enforcePersonaScope`. A **valid** cookie whose `uid` matches the request's principal and whose `childId` differs from the request's effective child → `403 PERSONA_SCOPE_MISMATCH` (user-safe message). Admin/writer principals are exempt (admin tooling operates across children).
- **Fail-open rule (and why)**: an absent, malformed, tampered, or expired cookie means *behave exactly as before* — parentUid ownership checks only. The mobile app and `@storypic/api-client` authenticate with bearer tokens and never carry cookies; enforcing on cookie absence would break every non-browser client. Cookie present + valid = enforce; anything else = legacy.

### Parent PIN guard
- PIN stored as scrypt hash + salt on `users/{uid}`; verification is timing-safe (`POST /api/parent/verify-pin`)
- **Brute-force lockout**: 5 consecutive failures → 5-minute lock (`429 PIN_LOCKED`), tracked transactionally on the user doc (`pinFailedAttempts`, `pinLockedUntil`); state machine in `src/lib/pin-lockout.ts`
- The client guard persists its 5-minute grace window in sessionStorage; modal-open decisions are deferred until that value hydrates so a hard reload inside the window never re-prompts (`isGuardHydrated` in `use-parent-guard`)

### Authorization
- **Two separate enforcement points.** Firestore security rules govern direct client reads and writes (the web app's client SDK and the `/kids/*` PWA). API routes use the Admin SDK, which **bypasses the rules entirely**, so every route must enforce access itself.
- **Rules protect server-trusted fields.** Owners may write only the fields the browser legitimately changes: roles and PIN state, session allowance/compile-lock fields, story content, and storybook lock, finalization, art and generation state are server-only; owner fields cannot change on update; `help-*` documents and all of `systemConfig` except `diagnostics` are admin-only. `tests/firestore-rules/check-rules.mjs` (`npm run test:rules`, run in CI) checks every allowed browser write and every protected field against the emulator. The threat model is in `docs/architecture/security/threat-model.md`.
- **Route ownership guards** (`src/lib/route-auth.server.ts`): a route that acts on a session, story, child, character or print storybook loads the doc and compares its owner field (`parentUid`, `ownerParentUid` or `ownerUserId`) with the token uid. A missing owner field counts as not owned. Admin and writer principals are exempt (admin test tools work across families). The guard also applies the persona scope with the token uid. Owner and child IDs for new records come from the verified parent record, never from the request body.
- **Clients send the ID token** through `authFetch` (`src/lib/auth-fetch.ts`) on the web, which attaches it only to same-origin `/api/` URLs. The mobile app and `packages/api-client` attach it on every request.
- **Server actions are public endpoints too.** Any exported function in a `'use server'` module that client code imports can be called from any browser with any arguments. Genkit flows must never be imported into client components; a page that needs a server action gets a dedicated one that verifies the caller's ID token and ownership first (e.g. `src/app/kids/create/actions.ts`).
- The per-route rules are listed in `docs/architecture/route-auth-matrix.md`.
- Soft delete pattern: `deletedAt` hides from non-admins

### Data Isolation
- Parents only see their own children/stories
- Writers can manage content config but not user data
- Admins have full access for support/debugging
- Within a family, the persona cookie scopes child-mode browsers to the active child at the generation/mutation chokepoints (see "Child persona model")

---

## Performance Considerations

### Caching
- System config cached server-side (60s TTL)
- Static assets via CDN (Firebase Hosting)

### Rate Limiting
- AI-intensive endpoints have request limits
- Image generation: 10 req/min
- TTS generation: 20 req/min

### Optimizations
- Images generated at print-ready resolution (300 DPI)
- PDF generation uses streaming for large files
- Firestore queries use composite indexes

---

## Error Handling

### AI Flow Errors
- Logged to `aiFlowLogs` collection (raw error strings, stacks, retry metadata — operators only)
- Shared reliability utilities:
  - `src/lib/ai-retry.ts`: `classifyError` (transient / rate_limit / permanent), `computeBackoffMs`
    (exponential + full jitter, low cap), `withRetry` (low retry cap, default 2; retries ONLY
    classified-transient errors — never 4xx/quota/safety), and the in-memory `CircuitBreaker`
    primitive.
  - `src/lib/ai-circuit-breaker.server.ts`: the **systemConfig-backed distributed circuit breaker**.
    Per-provider counters (`gemini-text`, `gemini-image`, `elevenlabs-tts`) persist in
    `systemConfig/circuitBreakers` with transactional updates and a ~5s in-memory TTL cache per
    instance (same pattern as `systemConfig/aiModels`), so the breaker trips consistently across
    serverless instances. On sustained transient/rate-limit failure it opens and every instance
    **fast-fails to graceful degradation instead of retrying** — a provider outage never becomes a
    token-burning retry storm. Breaker-store failures fail open. `withProviderReliability(provider,
    fn)` is the standard wrapper (breaker pre-check → withRetry → per-attempt breaker accounting →
    abandon retries if any instance trips the circuit mid-flight).
  - `src/lib/ai-error-map.ts`: the exhaustive, unit-tested raw→user-safe message table
    (`toUserSafeMessage` / `categorizeError`).
- **Retry adoption**: `storyWizardFlow` (both LLM calls) and `avatarAnimationFlow` run under
  `withProviderReliability`; the Book pipeline's `book.pageArt` job simplifies its prompt per job
  attempt (a flow-specific recovery) and goes through the AI harness (shared classifier, backoff and
  breakers). ElevenLabs TTS flows use the SDK's built-in
  `maxRetries`/timeout.
- **No raw error reaches a child/parent — at every layer**:
  - *Routes*: every interactive generation route (`tts`, `storyWizard`, `storyFriends`, `storyArc`,
    `storyEnding`, `storyBeat`, `gemini3`, `gemini4`, `warmupReply`, `storyCompile`,
    `generateAvatar`, `generateCharacterAvatar`) maps catch-block errors through
    `toUserSafeMessage`.
  - *Flow results*: flows that return `{ error | errorMessage }` result objects return user-safe
    strings (routes pass these through verbatim). Raw detail stays in `aiFlowLogs` and
    diagnostics-gated `debug` payloads.
  - *Documents*: every client-readable `*.lastErrorMessage` field (storybook pages, image/page/audio
    generation status, avatar/canonical/description generation) is written user-safe; raw stacks are
    no longer stored on page documents.
  - *Kids PWA*: `/kids/*` error/empty states use age-appropriate copy + mascot/emoji (no technical
    text); unexpected client-side exceptions render a kid-safe fallback, never `err.message`.

### Graceful Degradation (partial Books)
- **Books**: `partial` is an outcome, not an error (ADR-0003). The job runner rolls the Book's art up
  from its pages (`art {total, done, failed}`) and sets `ready`, `partial` or `failed`. A partial Book
  is readable and lockable; each failed page shows a calm placeholder and, for a parent, a retry
  that starts a new job for that page.
- **Old storybooks** keep the earlier contract read-only: `StoryBookArtStatus` /
  `deriveStorybookArtStatus` (`src/lib/storybook-status.ts`) still gate their viewer, print layout
  and the Mixam order (`evaluateOrderArtGate`), with the persisted `artStatus` written before the
  `storybookV2` routes were removed.

### Perceived Latency (wizard)
- `storyWizardFlow` returns server-authoritative `questionNumber`/`totalQuestions`; the kids create
  page renders "Question N of 4" plus a questions+story progress strip, and the long final
  story-writing call has distinct expectation-setting copy. `StoryGeneratorResponse` carries the
  same fields for the parent `StoryBrowser` badge.

### Testing seam (`TEST_MODE`)
- `src/lib/test-mode.ts` (`TEST_MODE`/`E2E_FAKE_AI`): when set, the Book pipeline's job handlers
  write deterministic fixtures (pages, cast sheets, art, narration) and advance the real Firestore
  documents without calling Gemini/ElevenLabs — enabling deterministic E2E with the in-process job
  dispatcher. Default (unset) behaviour is unchanged.
- Firebase client config is emulator-aware via `NEXT_PUBLIC_FIREBASE_USE_EMULATOR` (+ host/port vars);
  default points at prod. Playwright E2E lives in `e2e/`; the funnel spec (blocking in CI) makes a
  Book through `POST /api/books` and reads it.

### Entitlements
- `src/lib/entitlements/` + `entitlementLedgers` collection model per-family balances granted by the
  catalog (purchase/free-tier/gift) and consumed at creation. Server-authoritative — only the admin
  SDK ever writes a ledger.
- **Enforcement (wired for story + storybook).** Pure `canConsume`/`consume` (scope-resolved: child
  pool first, then family) are wrapped by two server helpers in `ledger.server.ts`:
  `checkEntitlement` (read-only pre-flight, treats a missing ledger as free-tier-seeded in memory)
  and `consumeEntitlement` (the authoritative decrement — a Firestore **transaction** read-modify-
  writes the ledger so concurrent creates cannot double-spend, seeding the free tier on first use).
  - **Story creation (`story_allowance`)**: enforced at the **completion chokepoint**. Every flow
    (kids and the six parent `/story/start/*` flows) finishes a story through `POST /api/storyCompile`,
    so that route both (a) **pre-flight blocks** with a `402` when the family is at its limit (no
    story doc is produced → the whole funnel is blocked) and (b) **consumes one `story_allowance` on
    success**, idempotently via a `storyAllowanceConsumed` flag. This is *consume-on-completion*:
    abandoned creates never burn quota. `kids/create` additionally calls the non-consuming
    `POST /api/entitlements/check` at start purely for an early, friendly block (fails *open* on
    transport errors — enforcement still holds at compile).
  - **Book creation (`storybook_allowance`)**: `POST /api/books` consumes one unit in the same
    transaction that creates the Book (`src/server/books/allowance.ts`, same ledger semantics), so a
    Book exists if and only if a unit was charged; `402 ENTITLEMENT_LIMIT` at the limit. A repeated
    idempotency key returns the same Book without charging.
  - **`print_credit` is intentionally NOT enforced yet**: the free tier grants none and there is no
    purchase flow to grant it (Stripe is a later sprint), so enforcing it would block *every* print
    order. It lands with the purchase/grant work. See `docs/PRODUCTS.md`.
  - **Visibility (UI)**: `GET /api/entitlements/summary` is a read-only roll-up (server-resolved
    child + family remaining) consumed by `src/components/entitlements/entitlement-summary.tsx` —
    a "Your plan" card on the parent overview and a "N stories left" badge on the kids create
    screen, so the limits are visible before a user hits a `402`.

### Order Errors
- Status history tracks all state changes
- Process log captures detailed events
- Admin dashboard shows error details

---

## Monitoring & Diagnostics

### Product Analytics & Monitoring (PostHog)
- **Single observability vendor**: PostHog (EU region) provides product analytics, funnel analysis,
  session replay, Web Vitals/RUM, and error tracking. Chosen over Sentry (no usable free tier) to
  consolidate to one vendor/DPA — see `docs/sprints/SPRINT-01-MEASUREMENT-SPINE.md`.
- **Vendor-agnostic core** (`src/lib/analytics/`): `track` / `identify` / `captureException` behind an
  injected sink. The PostHog SDK is isolated in `posthog-sink.ts`; the core enforces a **no-PII guard**
  (`events.ts findPiiViolation`), a runtime kill-switch, Do-Not-Track, and identify-on-uid+role-only.
  Event taxonomy is a fixed registry (`ANALYTICS_EVENTS`).
- **Wiring**: `PostHogAnalyticsProvider` (`src/components/analytics/`) mounts inside `DiagnosticsProvider`
  + `FirebaseClientProvider`. PostHog only initialises when enabled, so nothing loads/sends while dark.
- **Kill-switch**: `systemConfig/diagnostics.enableAnalytics` (default **false**), toggled from the admin
  dashboard. Off until the PostHog DPA + consent are in place (children's data / ICO Children's Code).
  Build-time hard-off via `NEXT_PUBLIC_ANALYTICS_ENABLED=false`.
- **Privacy**: autocapture off, session-replay masks all inputs/text, identify sends only uid + role,
  events carry ids/counts/enums only (enforced by the no-PII guard).

### Ops/KPI Dashboard (`/admin/ops`)
One admin page answers "where are users dropping off and what's broken now?" (Sprint W3-A).
Backed by `GET /api/admin/ops/metrics`, which aggregates from two deliberately separate sources:

- **User behaviour (DAU/WAU/MAU, signup→order funnel with drop-off)** — read from **PostHog's
  query API** via a thin cached server module (`src/lib/posthog-query.server.ts`, HogQL queries,
  5-minute in-memory cache, 15s timeout), NOT from Firestore collection-group scans.
  *Rationale*: Firestore is the operational store; deriving behavioural metrics from it would
  require unbounded scans and duplicate the analytics pipeline. While PostHog is dark behind the
  compliance gate (no `POSTHOG_PERSONAL_API_KEY`/`POSTHOG_PROJECT_ID`), each analytics widget
  shows an honest "analytics not yet enabled" state (`available: false`) rather than fake zeros —
  the PostHog-backed path is fully implemented and lights up via env vars alone.
- **Operational metrics** — where an operational Firestore source legitimately covers a metric,
  bounded indexed queries are used (never unbounded scans): generation error rate from
  `aiFlowLogs` (last 24h, limit 1000) and print-order pipeline/conversion from `printOrders`
  (last 30 days, limit 500).

### Health Checks & Alerts
`POST /api/admin/ops/health-check` (admin token or `X-Internal-Secret` — callable from the ops
dashboard, the daily system test, or a cron) runs three checks with pure, unit-tested logic in
`src/lib/ops/health-checks.ts`:

- `art_pending` — storybook art generation running/rate-limited > N hours (default 4). Scans the
  storybooks of the 50 most recently updated stories; collection-group queries are deliberately
  avoided because no collection-group indexes are deployed.
- `orders_unreviewed` — print orders awaiting approval > N hours (default 24).
- `error_rate_spike` — `aiFlowLogs` error rate over a recent window (default >30% over 60 min,
  minimum 5 samples so low traffic doesn't false-positive).

Thresholds live in `systemConfig/opsHealth.thresholds` (standard systemConfig pattern). Breaches
fire `notifyMaintenanceError` (existing maintenance-email path) **deduped** via per-check
`lastAlertedAt` + a cooldown (default 6h) stored on the same doc — a persistent condition alerts
once per cooldown window, not on every run. Last run results are persisted for the dashboard.

### Mixam Admin State Machine
Each Mixam webhook advances the admin-facing order state: alongside the status update, the
handler persists `adminNextAction` (`{ action, label, urgent }`), `needsAdminAttention`, and a
one-line `failureSummary` on the order doc. The status→action mapping is a pure module
(`src/lib/mixam/order-state.ts`) shared by the webhook (persist on change) and the admin list API
(derive fresh on read, so actions stay correct after manual admin operations). **Conservative by
design**: webhooks only update state and flag/queue actions — they never auto-confirm or
auto-cancel. The admin print-orders list shows the action chips/failure summaries and polls every
30s so webhook-driven changes appear without manual refresh.

### System Config
- `systemConfig/diagnostics` controls logging levels
- `systemConfig/opsHealth` holds health-check thresholds, per-check alert dedup state, and last run results
- Toggle client/server/AI flow logging independently
- API documentation exposed via diagnostic switch

### Tracing
- `aiRunTraces` aggregates all AI calls per session
- Includes token usage, costs, latencies
- Accessible via Admin > Run Traces

### AI Flow Logging
- `aiFlowLogs` collection records individual AI flow executions
- Includes: flow name, prompt, response, token usage, latency, status
- Enhanced fields for debugging: `storyId`, `storybookId`, `imageUrl` (for image generation)
- `failure` status with `failureReason` for calls that complete but produce no usable output
- Accessible via Admin > AI Logs with export/selection functionality

### Health Endpoints
- `GET /api/health` — canary/rollback probe: build identity (`version` = git SHA baked at build
  time), uptime, Cloud Run revision, and a timeout-guarded Firestore dependency probe. Returns
  HTTP 503 when `degraded` so monitors can alert on status code. No secrets/logs in the response.
- `GET /api/healthz` — older endpoint; additionally exposes `recentLogs` when `ENABLE_DEV_LOGS=true`.

---

## Deployment & Release

Full runbook: `docs/DEPLOYMENT.md` (supersedes `docs/DEPLOYMENT_ROLLOUT.md`).

### Current state
Production is **Firebase App Hosting** (`apphosting.yaml`): every push to `main` auto-builds and
rolls out to 100% immediately. `cloudbuild.yaml` is a legacy Cloud Run pipeline with a stale
secrets list — it must not be triggered. `ci.yml` (GitHub Actions) gates merges with typecheck,
unit tests, and the funnel E2E, but does not deploy.

### Staged rollout (Sprint W3-B machinery — opt-in until owner enablement)
- **Build-once**: `.github/workflows/release.yml` (`workflow_dispatch` only) runs
  typecheck/test/build gates, then `cloudbuild.release.yaml` builds ONE immutable image tagged
  with the commit SHA and deploys it as a **zero-traffic** Cloud Run revision (tag `rc-<sha7>`)
  for staging smoke tests. No mutable `:latest` tag.
- **Canary / promote / rollback**: `scripts/deploy/` (`status.sh`, `deploy-staging.sh`,
  `canary-promote.sh`, `promote-full.sh`, `rollback.sh`) move traffic between existing revisions
  via Cloud Run traffic splitting — promotion and rollback never rebuild. All mutating scripts
  are dry-run by default and require `--execute`.
- **Rationale**: App Hosting offers no artifact reuse, staging step, traffic splitting, or fast
  rollback; plain Cloud Run provides all four with the same container. The cutover (domain
  mapping + disabling App Hosting auto-rollouts) is an explicit owner action documented in the
  runbook — nothing in the repo changes live deploy behaviour on merge.

### Feature Flags (second control plane)
- **Registry + defaults**: `src/lib/feature-flags.ts` (`FLAG_DEFAULTS`). Server evaluation:
  `src/lib/feature-flags.server.ts`; clients read server-evaluated values via `GET /api/flags`
  and the `useFeatureFlag` hook (server-first rule — no Remote Config SDK in the client bundle).
- **Precedence** (each layer fails open to the next): env override `FLAG_<KEY>` → Firebase
  Remote Config server template (percentage rollouts keyed on UID `randomizationId`; `uid` /
  `emailDomain` custom signals for allowlists) → Firestore `systemConfig/featureFlags` fallback
  doc → in-code default. Per-instance caches (RC 60s, Firestore 30s) mean a flag flip reaches
  production in ~1 minute without a deploy.
- **Worked example**: `health_verbose` switches `GET /api/health` between the full body
  (dependency probes) and a minimal `{status, version}` body.

---

## Directory Structure

```
/
├── packages/                    # Shared packages (npm workspaces)
│   ├── shared-types/           # TypeScript types for API contracts
│   │   └── src/index.ts        # Child-facing type definitions
│   └── api-client/             # Typed API client for child features
│       └── src/client.ts       # StoryPicClient class
├── src/
│   ├── app/                    # Next.js App Router
│   │   ├── api/               # API route handlers
│   │   ├── admin/             # Admin dashboard pages
│   │   ├── parent/            # Parent-facing pages
│   │   ├── kids/              # Kids PWA pages
│   │   ├── story/             # Story creation pages
│   │   └── storybook/         # Storybook viewing pages
│   ├── components/            # React components
│   │   ├── ui/               # Base UI components (shadcn)
│   │   └── admin/            # Admin-specific components
│   ├── contexts/              # React contexts
│   │   └── api-client-context.tsx  # API client provider
│   ├── hooks/                 # Custom React hooks
│   ├── server/                # Rebuild foundations (server-only): http, data, jobs, ai, config
│   ├── lib/                   # Shared utilities
│   │   ├── types.ts          # Full TypeScript type definitions
│   │   ├── genkit/           # AI flow definitions
│   │   └── firestore-hooks.ts # Firestore React hooks
│   └── firebase/             # Firebase client setup
└── mobile/                    # (Future) Expo React Native app
```

### Workspace Packages

The project uses npm workspaces to share code between the web app and future mobile clients:

**@storypic/shared-types**: TypeScript type definitions for API contracts
- Child-facing types only (ChildProfile, Story, StoryBookOutput, etc.)
- API request/response types
- Used by both web app and API client

**@storypic/api-client**: Typed HTTP client for child-facing features
- `StoryPicClient` class with methods for story creation, storybook generation
- Used via `ApiClientProvider` context in React components
- Designed for reuse in mobile apps

---

## Key Files Reference

| Purpose | Location |
|---------|----------|
| Type definitions | `src/lib/types.ts` |
| API contract types | `packages/shared-types/src/index.ts` |
| API client | `packages/api-client/src/client.ts` |
| API client context | `src/contexts/api-client-context.tsx` |
| Firestore rules | `firestore.rules` |
| AI flows | `src/ai/flows/*.ts` |
| Book client hooks and calls | `src/hooks/use-books.ts`, `src/lib/books/` |
| Book UI (chooser, progress, reader) | `src/components/books/` |
| AI flow logger | `src/lib/ai-flow-logger.ts` |
| Animation presets | `src/lib/animation-presets.ts` |
| API routes | `src/app/api/*/route.ts` |
| Admin dashboard | `src/app/admin/page.tsx` |
| Kids PWA layout | `src/app/kids/layout.tsx` |
| Diagnostics hook | `src/hooks/use-diagnostics.tsx` |
| Route wrapper (rebuild) | `src/server/http/with-route.ts` |
| Repositories + schemas (rebuild) | `src/server/data/` |
| Job runner (rebuild) | `src/server/jobs/runner.ts` |
| Book pipeline (rebuild) | `src/server/books/` (services, job kinds), `src/server/catalog/`, `src/app/api/manuscripts`, `src/app/api/books` |
| Cloud Tasks setup | `scripts/setup-cloud-tasks.sh` |
| AI harness (rebuild) | `src/server/ai/harness.ts` |

---

## Future Considerations

### Planned Enhancements
- **Mobile Clients**: Expo React Native apps for Android and iOS using the API client
- Payment integration for print orders
- Multi-language support
- Collaborative story creation (multiple children)

### Mobile Client Architecture
The `/packages` workspace structure prepares for mobile development:
1. `@storypic/shared-types` - Shared types used by all clients
2. `@storypic/api-client` - HTTP client for child-facing API calls
3. `/mobile` (future) - Expo React Native app sharing the API client

Mobile scope is strictly child-facing: story creation, story reading and reading old storybooks. Book creation is switched off in the app for now (make books in the web app); `@storypic/api-client` has `createBook` for when it returns. No parent management or print ordering in mobile.

### Technical Debt
- Legacy `storyBooks` collection migration to new nested structure
- Some prompt configs still use old field names
- Test coverage for AI flows needs expansion
- Gradual migration of direct fetch calls in components to use API client

---

## Related Documentation

- [SCHEMA.md](./SCHEMA.md) - Database schema reference
- [API.md](./API.md) - API route documentation
- [DEPLOYMENT.md](./DEPLOYMENT.md) - Deployment runbook (staged rollout, feature flags, rollback)
- [CLAUDE.md](../CLAUDE.md) - Development workflow rules
- [CHANGES.md](./CHANGES.md) - Change history by commit
