# Collection Ownership (as-is)

> Phase 1 of `../REVIEW_PLAN.md`. Who reads and writes each Firestore collection today.
> **A** = Admin SDK (server routes and flows; bypasses `firestore.rules`).
> **C** = client SDK from the browser (governed only by `firestore.rules`).
> Detail and file:line citations are in the area maps under `areas/`.

The pattern that matters most: the **web app writes core records from the browser**. Sessions,
storybooks, characters and children are created client-side in several places, each with its own
document shape, while the API routes that do the same job (used by mobile and part of the kids
PWA) write a different shape. Only mobile goes through the API for everything.

## User data (wiped on reset)

| Collection | Readers | Writers | Notes |
|------------|---------|---------|-------|
| `children` | A: entity flows, context builder, resolvers, `/api/children*`. C: ~35 pages | C: `EntityEditor`, parent pages, toggles, story/start pages (backfill `ownerParentUid`). A: photo routes (status), entity flows | `/api/children` returns soft-deleted children and internal fields |
| `children/{id}/sessions` | C: `/stories` | C: at creation only (some paths), never updated | Mirror of sessions; drifts |
| `characters` | A: flows, resolvers. C: parent/admin pages, StoryBrowser | C: `EntityEditor`, soft delete, session page traits. A: `createStoryCharacterFlow`, usage counts | AI-created characters always child-specific |
| `storySessions` | A + C everywhere | C: **created in 8 places** with different shapes; also `storyTypeId`, `arcStepIndex`, `actors`, ending choice, kids `status: 'completed'`. A: wizard/friends/gemini flows, beat (`worldState`), ending, compile (lock, phase, allowance), `/api/storySession` (mobile only) | Rules let the owner write any field, including `status` and `storyAllowanceConsumed`, which compile trusts |
| `storySessions/{id}/messages` | A: beat, ending, gemini, text-compile | **C only** (StoryBrowser, legacy session page) | The transcript the AI compiles from is client-written |
| `storySessions/{id}/events` | C | C | |
| `stories` | A + C | A: wizard/friends flows, compile, title, story audio, group avatar, pagination (`locationRegistry`), legacy finalization, pay route. C: title edit, select-image-style, soft delete | `storyId == sessionId` |
| `stories/{id}/storybooks` | A + C | A: all `storybookV2` routes and flows. **C: created directly** in `story/[storyId]` and `child/create-book` (skips entitlement), `recoveryNotified`, soft delete | Rules let the owner write lock and status fields |
| `stories/{id}/storybooks/{sb}/pages` | A + C | A only (product code) | |
| `stories/{id}/shareTokens`, `shareLinks` | A | A | Client access to `shareLinks` denied |
| `stories/{id}/outputs/storybook[/pages]` | Read fallbacks only | Nothing live | Legacy |
| `storyBooks` (top level) | Rules test page | Help-sample seeding only | Legacy |
| `exemplars` | Dead flow only | Dead flow only | |
| `printStoryBooks` | A: layout/PDF/order routes. C: print pages | C: create (draft). A: auto-layout, generate-pdfs | Rules tightened in the Phase 0 follow-up |
| `printOrders` | A: order/admin/webhook/ops routes. C: owner read | A: routes and webhook. C: regression page (admin) | Rules tightened in the Phase 0 follow-up |
| `users` (+ `addresses`, `voices`) | A + C | C: signup, startup wizard. A: address API, order route, onboarding, PIN lockout | `roles.isParent` is self-writable |
| `entitlementLedgers` | A | A (transactions) | |
| `feedback`, `tickets` | A, owner read | A | |

## Configuration (kept across a reset — see `config-inventory.md`)

| Collection | Readers | Writers |
|------------|---------|---------|
| `storyGenerators` | C: StoryBrowser, start pages. A: kids-generators, storySession, flows | A: seed route (replaces whole docs). Admin UI |
| `storyTypes`, `storyOutputTypes`, `promptConfigs`, `storyPhases` | C: story pages, writer. A: flows | C: writer and admin pages |
| `imageStyles` | A: image flow. C: pickers | Admin UI; A: scene-exemplar flow (`sceneExemplars`), seed route (duplicates on each run) |
| `printLayouts`, `printProducts`, `products`, `prices` | A + C | Admin UI / admin APIs / seed |
| `answerAnimations`, `helpWizards` | C | Admin UI, seed routes, client batch seed |
| `systemConfig/*` | A: loaders (8 copy-pasted 60 s caches). C: diagnostics, email | Admin UI and admin APIs; `email` written from the client |

## Operational (not product content)

| Collection | Writers |
|------------|---------|
| `aiFlowLogs`, `aiRunTraces` | A: every flow (logging toggles have no effect server-side) |
| `devTodos` | Internal API, admin UI |
| `systemConfig/{circuitBreakers, opsHealth}` (run state), `aiModels.availabilityCheck` | A |
