# System Design Document

> **Last Updated**: 2026-06-11
>
> This document describes the current architecture of StoryPic Kids. It should be read at the beginning of any major piece of work to understand the system before making changes.

---

## Overview

StoryPic Kids is an interactive story creation platform for children. Children create personalized stories through guided conversations with an AI, which are then transformed into illustrated storybooks that can be viewed digitally or printed as physical books.

### Core User Flows

1. **Story Creation**: Child interacts with AI through warmup → story beats → ending → compilation
2. **Storybook Generation**: Story text is paginated, images are generated, audio narration is added
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

### 3. Storybook Generation Pipeline

```
Story → Pages → Exemplars + Audio (parallel) → Images → Finalization
```

**Data Model** (new structure):
```
stories/{storyId}
  └── storybooks/{storybookId}
        └── pages/{pageId}
```

**Pipeline Steps**:
1. **Pagination** (`/api/storybookV2/pages`): Story text → page structure
2. **Exemplar Generation** (parallel with audio): Character reference sheets generated for each actor
3. **Audio Generation** (parallel with exemplars): Text → TTS narration via ElevenLabs
4. **Image Generation** (`/api/storybookV2/images`): Page descriptions → illustrations (using exemplars for character consistency)
5. **Finalization** (`/api/storybookV2/finalize`): Lock content version

**Exemplar System**:
Character reference sheets ("exemplars") ensure consistent character appearance across all storybook pages:
- After pagination, the system generates a 2x2 reference sheet for each actor showing: face close-up (top-left), front view, 3/4 view, and back view
- Exemplars are generated in the storybook's selected art style
- The image generation flow uses these reference sheets instead of raw photos
- Exemplar URLs are stored on the storybook document (`actorExemplarUrls`) for reuse
- If exemplar generation fails, the system falls back to using photos/avatars directly

**Shared Book-View Components (Sprint W2-C)**:

Parent and child book views render pages through the same components in
`src/components/book-reader/`:

```
BookPageSpread        — THE single-page renderer (full-bleed art + bottom
                        gradient + overlaid text). Purely presentational.
  ├── ImmersivePlayer — kids reader (/kids/read/[bookId]): fullscreen,
  │                     audio autoplay, fit="cover"
  └── ParentBookView  — parent view (/storybook/[bookId] Step 1): the same
                        presentation + navigation affordances, fit="contain"
                        (full artwork visible for review), with ONE addition —
                        an Edit button on each page
BookReader            — page-by-page reader with audio controls
                        (/storybook/[bookId]/read)
```

**Rationale**: the parent's view of a child's book must look like what the child sees (one
canonical page presentation, fixed in one place) while carrying parent-only editing power as an
overlay, not a fork. Interaction (navigation, audio, editing) lives in the hosts; `BookPageSpread`
stays dependency-free.

**Parent clean-up vs print — two distinct stages** (`/storybook/[bookId]`):
1. **Step 1 · Clean up the pages**: `ParentBookView` + `PageEditorDialog`
   (`src/components/storybook/page-editor-dialog.tsx`). The dialog edits page text and/or the
   image prompt via `POST /api/storybookV2/pageEdit` (server-first; placeholder round-trip via
   `replaceNamesWithPlaceholders`), and triggers single-page repaints through the existing
   `POST /api/storybookV2/images` `{ pageId, forceRegenerate, additionalPrompt }` path — generation
   logic, locking, concurrency guards, and `artStatus` rollups are never duplicated. Single-page
   regeneration consumes no entitlement.
2. **Step 2 · Print & share**: print layout, finalize/unlock, and share links — a clearly
   subsequent step, gated on `artStatus.isOrderable`.

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
| `imageGenerationModel` | Image generation | story-image-flow, avatar-flow, character-avatar-flow, etc. |
| `primaryTextModel` | Complex text generation | story-beat-flow, story-compile-flow, character-traits-flow |
| `lightweightTextModel` | Simple text tasks | story-synopsis-flow, image-description-flow |
| `legacyTextModel` | Specific older use cases | story-title-flow, story-pagination-flow |

**Implementation**:
- Central module at `src/lib/ai-model-config.ts` with 1-minute caching
- Flows call `getImageGenerationModel()`, `getPrimaryTextModel()`, etc.
- Admin UI includes availability checking against Google AI API
- Alerts can be sent to maintenance users when models become unavailable

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

### Storybook Generation Flow

```
┌──────────┐    ┌───────────┐    ┌─────────────────────┐    ┌───────────┐    ┌──────────┐
│  Story   │───▶│  Pages    │───▶│ Exemplars + Audio   │───▶│  Images   │───▶│ Finalize │
│  Text    │    │  API      │    │   (parallel)        │    │  API      │    │  API     │
└──────────┘    └───────────┘    └─────────────────────┘    └───────────┘    └──────────┘
                     │                 │       │                  │
                     ▼                 ▼       ▼                  ▼
               ┌───────────┐    ┌─────────┐ ┌───────────┐   ┌───────────┐
               │  Gemini   │    │ Imagen  │ │ ElevenLabs│   │  Imagen   │
               │  (Layout) │    │(Ref Sht)│ │  (TTS)    │   │  (Art)    │
               └───────────┘    └─────────┘ └───────────┘   └───────────┘
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
- Firebase Auth with email/password
- Parent PIN for child-lock feature (client-side gate)
- Custom claims for role-based access

### Authorization
- Firestore security rules enforce document-level access
- API routes verify auth token and check claims
- Soft delete pattern: `deletedAt` hides from non-admins

### Data Isolation
- Parents only see their own children/stories
- Writers can manage content config but not user data
- Admins have full access for support/debugging

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
  `withProviderReliability`; `storyImageFlow` keeps its progressive-prompt-simplification loop (a
  flow-specific recovery) but uses the shared classifier, the shared jittered backoff schedule, and
  the shared `gemini-image` breaker. ElevenLabs TTS flows use the SDK's built-in
  `maxRetries`/timeout.
- **No raw error reaches a child/parent — at every layer**:
  - *Routes*: every interactive generation route (`tts`, `storyWizard`, `storyFriends`, `storyArc`,
    `storyEnding`, `storyBeat`, `gemini3`, `gemini4`, `warmupReply`, `storyCompile`,
    `storybookV2/*`, `generateAvatar`, `generateCharacterAvatar`) maps catch-block errors through
    `toUserSafeMessage`.
  - *Flow results*: flows that return `{ error | errorMessage }` result objects return user-safe
    strings (routes pass these through verbatim). Raw detail stays in `aiFlowLogs` and
    diagnostics-gated `debug` payloads.
  - *Documents*: every client-readable `*.lastErrorMessage` field (storybook pages, image/page/audio
    generation status, avatar/canonical/description generation) is written user-safe; raw stacks are
    no longer stored on page documents.
  - *Kids PWA*: `/kids/*` error/empty states use age-appropriate copy + mascot/emoji (no technical
    text); unexpected client-side exceptions render a kid-safe fallback, never `err.message`.

### Graceful Degradation (degraded-book contract)
- **Contract**: `StoryBookArtStatus` in `src/lib/types.ts`, canonically derived from per-page
  `imageStatus` by `deriveStorybookArtStatus` (`src/lib/storybook-status.ts`) — pure and shared by
  server and client. Completeness: `none | in_progress | complete | degraded | failed`, with
  explicit `isViewable` / `isOrderable` flags.
- `/api/storybookV2/images` persists the rollup as `artStatus` on the storybook after every run and
  detects **recovery** (degraded/failed → complete sets `recoveredAt` + `recoveryNotified=false`).
- **A text + partial-art book is viewable AND orderable**: the storybook viewer offers Read Book
  whenever the book has pages and print/finalize whenever `isOrderable`; `/api/storybookV2/finalize`
  gates on `isOrderable` (degraded allowed; only in-progress or fully-failed art blocks). Failed
  pages show a calm per-page note with a retry action instead of a dead Error badge.
- **Recovery notification**: the viewer shows a one-time "your book is complete" toast when
  `recoveredAt` is set and unacknowledged, then writes `artStatus.recoveryNotified=true`. The kids
  generating page routes degraded books to "Your Book is Ready to Read!" instead of an error screen.

### Perceived Latency (wizard)
- `storyWizardFlow` returns server-authoritative `questionNumber`/`totalQuestions`; the kids create
  page renders "Question N of 4" plus a questions+story progress strip, and the long final
  story-writing call has distinct expectation-setting copy. `StoryGeneratorResponse` carries the
  same fields for the parent `StoryBrowser` badge.

### Testing seam (`TEST_MODE`)
- `src/lib/test-mode.ts` (`TEST_MODE`/`E2E_FAKE_AI`): when set, the storybook generation flows/routes
  short-circuit to deterministic fixtures and advance Firestore `*Generation.status` without calling
  Gemini/ElevenLabs/fal — enabling deterministic E2E. Default (unset) behaviour is unchanged.
- Firebase client config is emulator-aware via `NEXT_PUBLIC_FIREBASE_USE_EMULATOR` (+ host/port vars);
  default points at prod. Playwright E2E lives in `e2e/` (report-only CI job).

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
  - **Storybook creation (`storybook_allowance`)**: `POST /api/storybookV2/create` consumes inline,
    after validation and immediately before the create, returning `402` at the limit.
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
| Exemplar generation | `src/ai/flows/story-exemplar-generation-flow.ts` |
| Image generation | `src/ai/flows/story-image-flow.ts` |
| AI flow logger | `src/lib/ai-flow-logger.ts` |
| Animation presets | `src/lib/animation-presets.ts` |
| API routes | `src/app/api/*/route.ts` |
| Admin dashboard | `src/app/admin/page.tsx` |
| Kids PWA layout | `src/app/kids/layout.tsx` |
| Diagnostics hook | `src/hooks/use-diagnostics.tsx` |

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

Mobile scope is strictly child-facing: story creation, story reading, storybook generation, storybook viewing. No parent management or print ordering in mobile.

### Technical Debt
- Legacy `storyBooks` collection migration to new nested structure
- Some prompt configs still use old field names
- Test coverage for AI flows needs expansion
- Gradual migration of direct fetch calls in components to use API client

---

## Related Documentation

- [SCHEMA.md](./SCHEMA.md) - Database schema reference
- [API.md](./API.md) - API route documentation
- [CLAUDE.md](../CLAUDE.md) - Development workflow rules
- [CHANGES.md](./CHANGES.md) - Change history by commit
