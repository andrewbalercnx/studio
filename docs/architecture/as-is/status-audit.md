# Status Audit (as-is)

> Phase 1 of `../REVIEW_PLAN.md`. Every status-like field, its values, and the problems with
> them. Setters and file:line references are in the area maps under `areas/`.

## The core problem

There is no shared vocabulary for "a job is under way". The same state is spelled `running`
(storybook pages, images, exemplars), `generating` (entity assets, page images, story audio) and
`in_progress` (art completeness, sessions). Several declared values are never written, several
written values are not in the type, and some statuses are set by the browser.

Nothing on the server moves a storybook from one step to the next: the open browser tab sees
`pages: ready` and calls the images route. Close the tab and the book stops.

## Creation

| Field | Values written | Problems |
|-------|----------------|----------|
| `storySessions.status` | `in_progress` (client), `active` (mobile API, not in the type), `completed` (wizard route, kids client, gemini/friends flows, compile) | Three writers, two meanings of "started" |
| `storySessions.currentPhase` | `warmup`, `story`, `ending`, `final`, `completed`, plus `wizard`, `friends`, `gemini3`, `gemini4`, `beat` | Doubles as the mode marker; `beat` is outside the typed union |
| `friendsPhase` | `character_selection`, `scenario_selection`, `synopsis_selection`, `complete` | `story_generation` typed, never set |
| `arcStepIndex` | integer | Incremented by the browser |
| `compileInProgress`, `storyAllowanceConsumed` | boolean | Not in the `StorySession` type; client-writable under the rules |
| `stories.status` | `text_ready` (wizard/friends only) | `images_pending` never written |
| `titleGeneration`, `synopsisGeneration`, `actorAvatarGeneration` | `pending`, `ready` (avatar also `generating`, `error`) | |

**Wizard and Friends never run compile:** they mark the session `completed` and write the story
first, so `/api/storyCompile` returns `alreadyCompiled`. No synopsis, no post-compile audio,
title or group avatar, and no `story_allowance` charge.

## Characters and children

| Field | Values | Problems |
|-------|--------|----------|
| `imageDescriptionGeneration`, `canonicalImageGeneration`, `avatarAnimationGeneration` | `idle`, `pending`, `generating`, `ready`, `error` | Animation also writes an undeclared `generatedWith` |
| avatar | none | No status at all; `avatarUrl` may be a random picsum image |

## Storybook

| Field | Values | Problems |
|-------|--------|----------|
| `pageGeneration.status` | `idle`, `running`, `ready`, `error` | `rate_limited` declared, never written |
| `imageGeneration.status` | `idle`, `running`, `ready`, `error`, `rate_limited` | Lock is a read, not a transaction; a timeout leaves `running` and every retry gets 409. A degraded book (some art) is marked `error`, so list APIs hide orderable books. `rateLimitRetryAt` never read |
| `exemplarGeneration.status` | `pending`, `running`, `ready`, `error` | Stuck `running` on exception |
| `audioGeneration` (not in the type) | `pending`, `ready`, `error` (+ `running` in test mode) | `ready` written even when pages failed |
| `artStatus.completeness` | `none`, `in_progress`, `complete`, `degraded`, `failed` | Page totals disagree with `imageGeneration` counters |
| `finalization.status` | `draft`, `finalized`, `printable_ready`, `ordered` | `ready_to_finalize`, `printable_pending` never written |
| page `imageStatus`, `audioStatus` | `pending`, `generating`, `ready`, `error` | `imageStatus` missing at creation |
| story `audioGeneration` | `idle`, `generating`, `ready`, `error` | Different values from the storybook's |
| `shareTokens.status` | `active`, `revoked`, `expired` | Unlocking a book does not revoke links |

## Print and orders

| Field | Values | Problems |
|-------|--------|----------|
| `printStoryBooks.pdfStatus` | `draft`, `generating_pdfs`, `ready`, `error` | |
| `printableStatus` | `idle`, `generating`, `ready`, `error` | Second PDF model on the storybook |
| `fulfillmentStatus` | 15 typed values | `draft`, `ready_to_submit`, `submitting`, `failed` never set; `pending` and `printed` written but not in the type; unknown Mixam statuses map to `submitted` |
| `paymentStatus` | `unpaid`, `paid` | `refunded` never set; nothing checks payment |
| `approvalStatus` | `rejected` | The only value ever written |
| `storybookFinalization.status` | `ordered` | Set by `/pay` on the **story**, not the storybook |
| `adminNextAction` | 8 action ids | |

## Config

| Field | Values |
|-------|--------|
| `storyGenerators.status`, `storyTypes.status`, `storyOutputTypes.status` | `live`, `draft` (+ `archived` on some) |
| `devTodos.status` | `pending`, `in_progress`, `partial`, `completed` |
