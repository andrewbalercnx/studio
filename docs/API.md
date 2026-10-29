# API Documentation

> **Last Updated**: 2026-10-29 (Phase 5.4: every client creates Stories with the creation routes; new `GET /api/creation-modes`; `GET /api/stories?childId` and `GET /api/stories/[storyId]` rewritten for Stories (names resolved on the server; the latter also returns the turns); removed `POST /api/storyWizard`, `/api/gemini3`, `/api/gemini4`, `/api/storyFriends`, `/api/storyBeat`, `/api/storyEnding`, `/api/storyCompile`, `/api/storySession`, `/api/warmupReply`, `/api/ai-warmup`, `/api/storyArc`, `/api/characterTraits`, `/api/characters/create`, `/api/storyBook/audio`, `/api/storyBook/actorAvatar`, `GET /api/kids-flows`, `GET /api/kids-generators`, `GET/PUT /api/admin/system-config/kids-flows`, `GET /api/admin/sessions`, `GET /api/parent/storybooks`, `POST /api/parent/storybooks/thumbnails`, `GET /api/stories/[storyId]/storybooks` and its `pages` route; api-client: `listCreationModes`, `createStory`, `sendTurn`, `abandonStory`, `retryFinish`. Phase 5.3: new `POST /api/stories`, `POST /api/stories/[storyId]/turns`, `POST /api/stories/[storyId]/abandon`, `POST /api/stories/[storyId]/finish` — Story creation in five modes on the server, not yet used by the UI; `POST /api/manuscripts` and `POST /api/books` also accept Stories made by these routes once `complete`. Phase 5.2: the web app and kids PWA create Books with `POST /api/books` and read them from Firestore; removed `POST /api/storybookV2/{create,pages,images,finalize,pageEdit}`, `POST /api/storyPagination` and `POST /api/storyBook/pageAudio`; api-client `createBook` replaces `createStorybook`/`generatePages`/`generateImages`; `POST /api/internal/system-test` runs the Book pipeline. Phase 5.1: new `POST /api/manuscripts`, `POST /api/books`, `POST /api/books/[bookId]/pages/[pageNumber]/retry`, `POST /api/books/[bookId]/lock`, `POST /api/books/[bookId]/unlock` — the server-side Book pipeline, not yet used by the UI; the job route now runs the pipeline's job kinds. Phase 4: new internal `POST /api/internal/jobs/run`, Cloud Tasks OIDC only, no job kinds registered yet; Phase 3: header-only tokens; Mixam webhook order-id match, final-state guard and 500 on internal errors; `my-orders` returns an allowlist; `GET /api/children*` documented and exclude soft-deleted children; persona scope on `storyFriends`). 2026-10-28 (Phase 0 route auth: session/story/print ownership required on the story-flow, avatar, audio, pagination, print-layout and `storyBook/[bookId]` routes; `characters/create` and gemini4 `createCharacter` take owner and child from the session; `postcode/lookup` and `ai-warmup` require sign-in; Mixam webhook requires a signature; `healthz` logs admin-only; removed orphaned `POST /api/storybookV2/exemplars` and the undocumented-but-nonexistent `PATCH /api/storyBook/[bookId]`. Earlier: 2026-06-11 W4-A: new `POST/DELETE /api/persona` signed child-persona cookie; persona-scope enforcement (403 `PERSONA_SCOPE_MISMATCH`) on `storySession`, `storyWizard`, `storyCompile`, and `storybookV2` create/pages/images/finalize/pageEdit/exemplars; `POST /api/parent/verify-pin` brute-force lockout (429 `PIN_LOCKED`) + `dryRun`; Security: `POST /api/storybookV2/pages` and `POST /api/storybookV2/images` now require authentication + `story.parentUid` ownership; W3-A: new `GET /api/admin/ops/metrics`, `POST /api/admin/ops/health-check`, `GET /api/admin/sessions`; `adminNextAction`/`failureSummary` on `GET /api/admin/print-orders` and the Mixam webhook; W3-B: new `GET /api/health` canary/rollback probe, `GET /api/flags` server-evaluated feature flags; W3-C: new `POST /api/feedback`, `GET /api/feedback/eligibility`, `POST /api/feedback/testimonial`, `GET /api/tickets`; `POST /api/report-issue` creates a tracked ticket; `GET /api/printOrders/my-orders` returns server-derived `timeline` + `estimatedTurnaround`; W2-C: new `POST /api/storybookV2/pageEdit`; degraded-order gate + `saveAddress` on `POST /api/printOrders/mixam`; `artStatus` rollup on `GET /api/parent/storybooks` and `GET /api/storyBook/[bookId]`; W2-B: `/api/user/onboarding` — server-derived first-run checklist + time-to-first-book instrumentation)
>
> **IMPORTANT**: This document must be updated whenever API routes change.
> See [CLAUDE.md](../CLAUDE.md) for standing rules on documentation maintenance.

## Overview

StoryPic Kids API uses Next.js App Router API routes. All endpoints require authentication unless otherwise noted. Routes that act on a user's data also check ownership; the per-route rules are summarised in [`docs/architecture/route-auth-matrix.md`](architecture/route-auth-matrix.md).

**Base URL**: `/api`

**Authentication**: Firebase ID token in `Authorization: Bearer <token>` header. Tokens in the query string (`?idToken=`) are not accepted.

---

## API Client Library

`@storypic/api-client` (`packages/api-client`) is the typed client for child-facing operations. The
web app calls the routes directly with `authFetch` (`src/lib/stories/api.ts`, `src/lib/books/api.ts`);
the mobile app carries its own copy with the same methods (`mobile/src/contexts/ApiClientContext.tsx`).

```typescript
import { StoryPicClient } from '@storypic/api-client';
const client = new StoryPicClient({ baseUrl: '/api', getToken: () => user.getIdToken() });
```

### Client Methods

**Story creation** (one key per user action, repeated on a retry of that action):
- `listCreationModes()` - `GET /api/creation-modes`
- `createStory({ childId, modeId, castIds?, storyTypeId?, idempotencyKey })` - `POST /api/stories`
- `sendTurn(storyId, input, idempotencyKey)` - `POST /api/stories/{id}/turns`; `input` is
  `{ kind: 'choice', optionId }`, `{ kind: 'text', text }` or `{ kind: 'castPick', castIds }`
- `abandonStory(storyId)`, `retryFinish(storyId)`

**Books:**
- `createBook({ storyId, formId, styleId, idempotencyKey })` - `POST /api/books`; make the key once per
  user action and repeat it on a retry of that action. Progress is read from Firestore (`books/{id}`),
  not polled through the client.

**Catalog:**
- `getOutputTypes()` - Get available story output types (Forms)
- `getImageStyles()` - Get available image styles

**Reading/Viewing:**
- `getMyStories(childId)` - `GET /api/stories?childId=` (names resolved, server status)
- `getStory(storyId)` - `GET /api/stories/{id}` (the Story and its turns)

**TTS:**
- `speak(text, voiceId, childId)` - Generate text-to-speech audio

---

## Table of Contents

- [Authentication](#authentication)
- [Parent Routes](#parent-routes)
- [Children Routes](#children-routes)
- [Characters Routes](#characters-routes)
- [Storybook Routes](#storybook-routes)
- [Story Creation Routes](#story-creation-routes)
- [Manuscript and Book Routes](#manuscript-and-book-routes)
- [Entitlement Routes](#entitlement-routes)
- [Print Routes](#print-routes)
- [Admin Routes](#admin-routes)
- [Voice Routes](#voice-routes)
- [Music Routes](#music-routes)
- [Story Output Types Routes](#story-output-types-routes)
- [Issue Reporting Routes](#issue-reporting-routes)
- [System Routes](#system-routes)
- [Feedback Routes](#feedback-routes)
- [Internal Routes](#internal-routes)
- [Webhook Routes](#webhook-routes)
- [User Onboarding Routes](#user-onboarding-routes)
- [Address Routes](#address-routes)
- [Postcode Routes](#postcode-routes)
- [Sound Effects Routes](#sound-effects-routes)

---

## Authentication

All API routes (except webhooks) require Firebase authentication.

### Headers
```
Authorization: Bearer <firebase_id_token>
```

### Common Error Responses

| Status | Description |
|--------|-------------|
| 401 | Unauthorized - Missing or invalid token |
| 403 | Forbidden - Insufficient permissions |
| 403 `PERSONA_SCOPE_MISMATCH` | A valid child-persona cookie is present and the request's effective child does not match it. Story/book chokepoints only (`/api/stories/**` (POST and GET), `/api/manuscripts`, `/api/books/**`). Absent/invalid cookie = legacy behaviour, so bearer-only clients (mobile, api-client) never see this. |
| 404 | Not Found - Resource doesn't exist |
| 500 | Internal Server Error |

---

## Parent Routes

### POST `/api/parent/set-pin`

Set or update parent PIN for child-lock feature.

**Request Body**:
```json
{
  "pin": "1234"
}
```

**Response**: `200 OK`
```json
{
  "success": true
}
```

**Errors**:
- `400` - Invalid PIN format (must be 4-6 digits)

---

### POST `/api/parent/verify-pin`

Verify parent PIN (timing-safe scrypt comparison against `users/{uid}.pinHash`/`pinSalt`).

**Request Body**:
```json
{
  "pin": "1234"
}
```

**Response**: `200 OK`
```json
{
  "ok": true,
  "message": "PIN verified."
}
```

**Brute-force lockout**: failed attempts are tracked server-side on the user doc (`pinFailedAttempts`). After **5 consecutive failures** verification is locked for **5 minutes** (`pinLockedUntil`); while locked every call returns `429` without comparing the PIN. The counter resets on success and when a lock is set (an expired lock grants a fresh window of 5 attempts).

**Errors**:
- `400 INVALID_PIN_FORMAT` - PIN must be exactly 4 digits
- `400 PIN_NOT_SET` - No PIN configured for this account
- `401 INCORRECT_PIN` - Wrong PIN (counts toward the lockout)
- `429 PIN_LOCKED` - Too many incorrect attempts; body includes `retryAfterMs` and a user-safe message
- `401` - Missing/invalid token

**Dry run** (regression/diagnostics; non-destructive): `{ "dryRun": true }` returns the lockout policy and current state without comparing a PIN or recording an attempt:
```json
{
  "ok": true,
  "dryRun": true,
  "lockout": { "maxAttempts": 5, "lockoutMs": 300000 },
  "locked": false,
  "failedAttempts": 0
}
```

---

### POST `/api/persona`

Set (or clear) the device's **active child persona** — a signed httpOnly cookie (`storypic.persona`, HMAC-SHA256 over `{uid, childId, iat}`, 30-day lifetime) that gives the client-side "a child is playing" state server-side meaning. Story/storybook generation and mutation chokepoints reject requests whose effective child does not match a valid persona cookie; an **absent or invalid cookie always behaves as before** (parentUid ownership only), so bearer-token-only clients (mobile app, `@storypic/api-client`) are unaffected. See `docs/SYSTEM_DESIGN.md` ("Child persona model").

Called fire-and-forget by the web clients whenever a child persona is entered, switched, or cleared — it never adds UI friction.

**Request Body**:
```json
{
  "childId": "child123"
}
```
`{ "childId": null }` clears the cookie (parent / unscoped).

**Response**: `200 OK` (sets/clears the `storypic.persona` cookie)
```json
{
  "ok": true,
  "persona": { "childId": "child123" }
}
```

**Errors**:
- `400 INVALID_CHILD_ID` - childId must be a non-empty string or null
- `400 CHILD_DELETED` / `400 CHILD_PLACEHOLDER` - profile not usable as a persona
- `401` - Missing/invalid token
- `403 NOT_OWNER` - child is not owned by the caller
- `404 CHILD_NOT_FOUND` - no such child
- `503 PERSONA_UNAVAILABLE` - no signing secret configured (`PERSONA_COOKIE_SECRET` / `INTERNAL_API_SECRET`)

### DELETE `/api/persona`

Clears the persona cookie. **No authentication required by design**: it runs on sign-out (after the bearer token is gone) and removing one's own cookie grants nothing.

**Response**: `200 OK` `{ "ok": true, "persona": null }`

---

## Children Routes

### GET `/api/children`

List the caller's children, excluding soft-deleted ones.

**Authentication**: Bearer token; returns only children whose `ownerParentUid` is the caller.

**Response**: `200 OK` with an array of child documents (`id` plus fields).

---

### GET `/api/children/[childId]`

One child. 404 if it does not exist or is soft-deleted; 403 if it belongs to another family.

**Authentication**: Bearer token; caller must own the child.

---

### POST `/api/children/photos`

Upload photos for a child profile. Triggers image description generation in background.

**Request Body**: `multipart/form-data`
- `childId` (string, required) - Child document ID
- `photos` (File[], required) - Photo files to upload

**Response**: `200 OK`
```json
{
  "urls": ["https://storage.googleapis.com/..."]
}
```

**Side Effects**: Triggers `imageDescriptionFlow` to generate a text description of the child's physical appearance from the photos.

---

## Characters Routes

### POST `/api/characters/photos`

Upload photos for a character. Triggers image description generation in background.

**Request Body**: `multipart/form-data`
- `characterId` (string, required) - Character document ID
- `photos` (File[], required) - Photo files to upload

**Response**: `200 OK`
```json
{
  "urls": ["https://storage.googleapis.com/..."]
}
```

**Side Effects**: Triggers `imageDescriptionFlow` to generate a text description of the character's physical appearance from the photos.

---

### POST `/api/regenerate-image-description`

Manually trigger regeneration of the image description for a child or character. Useful after photo changes.

**Request Body**:
```json
{
  "entityId": "child-or-character-id",
  "entityType": "child" | "character"
}
```

**Response**: `200 OK`
```json
{
  "ok": true,
  "status": "pending"
}
```

**Authorization**: Parents can regenerate for their own entities; admins can regenerate for any entity.

---

## Storybook Routes

### GET `/api/storyBook/[bookId]`

**Authentication**: Bearer token. The caller must own the story (`stories.parentUid`); admin and writer principals are exempt. Child-persona scope applies. 401 without a token, 403 not the owner, 404 missing. Kept for the old storybooks' order page until the print slice. Help-tour sample stories (`help-*` IDs) are readable by any signed-in user. A `printStoryBookId` is honoured only if that print storybook's `storyId` equals `bookId`.

Get storybook details.

**Path Parameters**:
- `bookId` (string, required) - Storybook document ID

**Response**: `200 OK`
```json
{
  "id": "book-id",
  "title": "My Adventure",
  "pages": [...],
  "finalization": {...},
  "artStatus": {
    "completeness": "degraded",
    "pagesTotal": 12,
    "pagesReady": 10,
    "pagesFailed": 2,
    "pagesPending": 0,
    "failedPageIds": ["page7", "page9"],
    "isViewable": true,
    "isOrderable": true
  }
}
```

`artStatus` (Sprint W2-C) is the persisted degraded-book rollup from the new-model storybook
subcollection document; `null` for legacy books or when no `storybookId` query param is provided.
The order page uses it for the proactive "pages will print without art" banner.

---

### POST `/api/storyBook/share`

Create or revoke share link for a finalized storybook.

**Authentication**: Required (parent or admin)

**Request Body**:
```json
{
  "bookId": "story-id",
  "storybookId": "storybook-id",  // For new model only
  "action": "create",             // "create" or "revoke"
  "expiresInDays": 14,            // 1-90, default 14
  "protectWithCode": true,        // Whether to require passcode
  "passcode": "optional-passcode" // 4+ chars, or auto-generated 6-digit
}
```

**Response (create)**: `200 OK`
```json
{
  "ok": true,
  "action": "create",
  "bookId": "story-id",
  "storybookId": "storybook-id",
  "shareId": "abc12345",
  "shareLink": "/storybook/share/abc12345",
  "requiresPasscode": true,
  "passcode": "123456",
  "expiresAt": "2025-01-17T00:00:00.000Z"
}
```

**Response (revoke)**: `200 OK`
```json
{
  "ok": true,
  "action": "revoke",
  "bookId": "story-id",
  "storybookId": "storybook-id"
}
```

---

### GET `/api/storyBook/share`

View a shared storybook (public endpoint - no authentication required).

**Query Parameters**:
- `shareId` (required): The share link ID
- `token` (optional): Passcode if the share is protected

**Response (success)**: `200 OK`
```json
{
  "ok": true,
  "storyId": "story-id",
  "storybookId": "storybook-id",
  "bookId": "story-id",
  "shareId": "abc12345",
  "finalizationVersion": 1,
  "metadata": {
    "bookTitle": "The Adventure",
    "childName": "Emma"
  },
  "pages": [
    {
      "pageNumber": 1,
      "kind": "cover_front",
      "title": "The Adventure",
      "bodyText": null,
      "displayText": null,
      "imageUrl": "https://storage.googleapis.com/...",
      "audioUrl": "https://storage.googleapis.com/..."
    }
  ],
  "share": {
    "expiresAt": "2025-01-17T00:00:00.000Z",
    "requiresPasscode": true,
    "passcodeHint": "56"
  }
}
```

**Response (passcode required)**: `401 Unauthorized`
```json
{
  "ok": false,
  "errorMessage": "Passcode required",
  "requiresToken": true,
  "passcodeHint": "56"
}
```

**Response (expired/revoked)**: `410 Gone`
```json
{
  "ok": false,
  "errorMessage": "This share link has expired"
}
```

---

### POST `/api/storyBook/printable`

Generate printable PDF for storybook.

**Request Body**:
```json
{
  "bookId": "book-id",
  "printLayoutId": "a4-portrait-spread-v1"
}
```

**Response**: `200 OK`
```json
{
  "ok": true,
  "coverPdfUrl": "https://...",
  "interiorPdfUrl": "https://..."
}
```

---

## Story Creation Routes

A child and the AI create a **Story** in one of five creation modes, behind one interface and these
routes (slices 5.3 and 5.4; [`creation.md`](architecture/target/creation.md),
[`5.3-creation-server.md`](architecture/target/slices/5.3-creation-server.md),
[`5.4-creation-clients.md`](architecture/target/slices/5.4-creation-clients.md)). The web app, the
kids PWA and the mobile app all use them; the mode-specific routes of the retired flows are deleted.

| Mode id | Mode | Today's generator |
|---------|------|-------------------|
| `wizard` | Story Wizard: four multiple-choice questions, then the whole story | `wizard` |
| `freeplay` | Free Play: open conversation (choices or typed answers) | `gemini3` |
| `guided` | Guided Story: phased questions, A–C plus M "tell me more" | `gemini4` |
| `friends` | Fun with my friends: pick companions → scenario → synopsis → story | `friends` |
| `adventure` | Choose Your Adventure: StoryType arc beats (A–C), then three endings | `beat` |

**Client usage** (slice 5.4):

0. `GET /api/creation-modes` lists the modes to offer (kid-safe names, one `recommended`).
1. `POST /api/stories` with the child, the mode and a key made once per tap. The response carries
   the first **turn** (the mode's prompt and options).
2. For each answer, `POST /api/stories/{storyId}/turns` with the input and a new key; the response
   carries the reply turn. Show `promptDisplay` and each option's `display` (names resolved); send
   back option ids. `expects` says which input the prompt wants.
3. When a reply's `kind` is `done` the Story is `finishing`; watch `stories/{storyId}` (or poll
   `GET /api/stories/{storyId}`) until it is `complete` (title, synopsis) and then make a Book with
   `POST /api/books`.
4. The web app reads `stories/{storyId}` and `stories/{storyId}/turns` (filter on
   `ownerUid == uid`) with listeners while playing; mobile reads `GET /api/stories/{storyId}`. Nobody
   writes them from a client (rules). Lists and readers use `GET /api/stories?childId=…`.

Common to all of them:

- `withRoute({ auth: 'user' })`: `Authorization: Bearer <Firebase ID token>`; 401 `UNAUTHENTICATED`.
- Ownership: the child / Story must be the caller's (`ownerUid`; for a child, `ownerParentUid`);
  admins and writers are exempt. Not the owner → 403 `FORBIDDEN`. A child-persona cookie for another
  child → 403 `PERSONA_SCOPE_MISMATCH`.
- Envelope `{ "ok": true, "data": … }` / `{ "ok": false, "error": { "code", "message", "details"? } }`.
- A model failure is 503 `AI_UNAVAILABLE` / `AI_BAD_OUTPUT`: nothing was recorded; repeat the same
  request (same key).

**Turn** (as returned, and as stored in `stories/{storyId}/turns/{index}`):
```json
{
  "index": 2, "kind": "prompt",
  "prompt": "Where does [[cast:c1]] go?", "promptDisplay": "Where does Emma go?",
  "options": [{ "id": "A", "text": "To [[cast:ch1]]'s house", "display": "To Rex's house", "preselected": false }],
  "expects": "choice", "progress": { "step": 2, "of": 4 }, "addedCast": []
}
```
`kind` is `prompt` or `done` for replies. `expects`: `choice` (send `optionId`), `text` (free text),
`castPick` (send castIds; `preselected` marks the mode's proposal). `addedCast`: castIds that joined
the Story's cast with this turn (an AI-introduced character is created in `characters` with
`origin: 'story'`).

### POST `/api/stories`

Start creating a Story.

**Request Body**:
```json
{ "childId": "c1", "modeId": "friends", "castIds": ["ch1"], "idempotencyKey": "5f0e…" }
```

| Field | Required | Notes |
|-------|----------|-------|
| `childId` | yes | One of the caller's children (not soft-deleted); else 404 `CHILD_NOT_FOUND` |
| `modeId` | yes | `wizard`, `freeplay`, `guided`, `friends` or `adventure` (else 400). The mode's config must exist (404 `MODE_NOT_FOUND`), be `live` (403 `MODE_NOT_LIVE`; admins and writers may use drafts) and, under a child persona, be `enabledForKids` (403 `MODE_NOT_FOR_KIDS`) |
| `castIds` | no | Family members joining the hero at setup: the owner's children or characters (family-wide or this child's); else 400 `CAST_NOT_FOUND` |
| `storyTypeId` | no | `adventure` only (400 otherwise): skip the story-type question. A live `storyTypes` id, else 404 `STORY_TYPE_NOT_FOUND` |
| `idempotencyKey` | **yes** | 8–128 chars, one per tap. A repeat returns the same Story and first turn (200, `created: false`); reusing it for another child or mode → 409 `IDEMPOTENCY_KEY_REUSED` |

Checks the `story_allowance` is available (402 `ENTITLEMENT_LIMIT`, `details.remaining`) **before**
creating anything; the allowance is consumed only when the Story completes (`story.finish`).

**Response** (201 Created, or 200 OK for a repeated key):
```json
{ "ok": true, "data": { "storyId": "st_…", "status": "creating", "created": true, "turn": { "index": 0, "kind": "prompt", … } } }
```

### POST `/api/stories/[storyId]/turns`

The child's input to a Story that is `creating`.

**Request Body**:
```json
{ "input": { "kind": "choice", "optionId": "B" }, "idempotencyKey": "9a1c…" }
```
`input` is one of `{ "kind": "choice", "optionId" }`, `{ "kind": "text", "text" }` (1–2000 chars),
`{ "kind": "castPick", "castIds": [...] }`. `idempotencyKey` (required, 8–128 chars) is one per child
action.

Records the input and the mode's reply as two turns, with any cast changes, in one transaction. When
the reply is `done`: the Story gets `text`, moves to `finishing`, and the `story.finish` job is
enqueued (title, synopsis, then `complete` with one `story_allowance` consumed).

**Response** (201 Created, or 200 OK with the recorded reply for a repeated key):
```json
{ "ok": true, "data": { "storyId": "st_…", "status": "creating", "created": true, "turn": { "index": 4, "kind": "prompt", … } } }
```

**Errors**: 400 `INPUT_NOT_EXPECTED` (an option that is not on offer, a castPick the prompt does not
take, someone outside the family); 404 story not found; 409 `STORY_NOT_CREATING`; 409
`TURN_CONFLICT` (another turn is being processed or was recorded first — reload the turns); 409
`TURN_IN_PROGRESS` (this key is still being processed — repeat it shortly); 503 as above.

### POST `/api/stories/[storyId]/abandon`

Stop creating: `creating` → `abandoned`. Idempotent. Nothing is charged.

**Response** (200 OK): `{ "ok": true, "data": { "storyId": "st_…", "status": "abandoned" } }`

**Errors**: 409 `STORY_NOT_CREATING` (already finishing or finished).

### POST `/api/stories/[storyId]/finish`

Finish again after `story.finish` failed: `failed` → `finishing` with a new job. Idempotent for a
Story that is `finishing` or `complete` (returns its status).

**Response** (200 OK): `{ "ok": true, "data": { "storyId": "st_…", "status": "finishing" } }`

**Errors**: 409 `STORY_NOT_FAILED` (`creating` or `abandoned`).

---

### GET `/api/creation-modes`

The ways a child can make a story: modes that are `live` and `enabledForKids`, in display order,
presented kid-safely (model names scrubbed; `kidFriendlyName` / `kidFriendlyDescription` overrides),
exactly one `recommended` (the configured one when offered, else the wizard, else the first). The
chooser is a child surface on every client, so every caller gets the same list. Replaces
`GET /api/kids-generators`.

**Response** (200 OK):
```json
{ "ok": true, "data": { "modes": [
  { "modeId": "wizard", "name": "Story Wizard", "description": "Answer four quick questions…",
    "icon": "Wand2", "gradient": "bg-gradient-to-br from-amber-400 to-orange-500", "darkGradient": null,
    "loadingMessage": "Summoning the Story Wizard...", "recommended": true }
] } }
```

### GET `/api/stories`

The child's Stories, newest first; abandoned ones are left out. Every text is rendered with names on
the server; `status` is the server's (`creating`, `finishing`, `complete`, `failed`).

**Query Parameters**: `childId` (required; 400 `INVALID_QUERY` without it).

**Errors**: 404 `CHILD_NOT_FOUND` (missing or soft-deleted child), 403 not the caller's child,
403 `PERSONA_SCOPE_MISMATCH`.

**Response** (200 OK):
```json
{ "ok": true, "data": { "stories": [ {
  "id": "st_…", "childId": "c1", "modeId": "wizard", "storyTypeId": null, "status": "complete",
  "title": "Emma's Big Day", "synopsis": "Emma has a wonderful adventure.",
  "text": "Once upon a time, Emma woke up early…",
  "cast": [{ "castId": "c1", "kind": "child", "role": "hero", "displayName": "Emma", "avatarUrl": "https://…" }],
  "turnCount": 9, "error": null,
  "createdAt": "2026-10-29T12:00:00.000Z", "updatedAt": "…", "completedAt": "…"
} ] } }
```
`title`, `synopsis` and `text` are null until `story.finish` has run (`text` is set when the mode
finishes). A title the model proposed with a cast token is resolved too.

### GET `/api/stories/[storyId]`

One of the caller's Stories (owner and persona scope checked) and its turns in order, as the play
screens need them (mobile plays through this; the web app uses listeners). Turns carry only the
display words, never the token text.

**Errors**: 404 `STORY_NOT_FOUND` (missing, or a document that is not a Story), 403 not the owner,
403 `PERSONA_SCOPE_MISMATCH`.

**Response** (200 OK):
```json
{ "ok": true, "data": {
  "story": { "id": "st_…", "status": "creating", "title": null, "text": null, "cast": [ … ], "…": "as in the list" },
  "turns": [
    { "index": 0, "role": "ai", "kind": "prompt", "promptDisplay": "Where should the story happen?",
      "options": [{ "id": "A", "display": "In a castle", "preselected": false }],
      "expects": "choice", "progress": { "step": 1, "of": 4 }, "inputDisplay": null, "addedCast": [] },
    { "index": 1, "role": "child", "kind": "input", "promptDisplay": null, "options": null,
      "expects": null, "progress": null, "inputDisplay": "In a castle", "addedCast": [] }
  ]
} }
```

**Renaming**: there is no rename route; a Story's title comes from its mode or `story.finish`.

---

## Manuscript and Book Routes

The Story → Manuscript → Book pipeline (slices 5.1 and 5.2;
[`5.1-book-server.md`](architecture/target/slices/5.1-book-server.md),
[`5.2-book-clients.md`](architecture/target/slices/5.2-book-clients.md)). The only way to make a book:
the web app and the kids PWA call `POST /api/books`; the mobile app does not make books for now.

**Client usage** (web, kids PWA):

1. The child picks a Form (`GET /api/storyOutputTypes`) and a Style (`GET /api/imageStyles`) once the
   story is finished. The client calls `POST /api/books` with `{ storyId, formId, styleId,
   idempotencyKey }`, making the key once per choice (`crypto.randomUUID()`, kept for that choice so a
   double tap or a retry repeats it). Length and density default from the Form.
2. It then only watches Firestore (`src/hooks/use-books.ts`): `books/{bookId}` for `status` and the
   `art` rollup, `manuscripts/{manuscriptId}` for pagination, and the pages of both for the reader.
   List queries filter on `ownerUid == uid` (the rules require it). Closing the page changes nothing.
3. A parent (PIN guard) retries a failed picture with `POST …/pages/{n}/retry` and locks or unlocks
   with `POST …/lock` / `…/unlock`. Printing is not available for these Books yet (print slice).

Common to all five:

- Built on `withRoute({ auth: 'user' })`: `Authorization: Bearer <Firebase ID token>`; 401
  `UNAUTHENTICATED` without one.
- Ownership: the caller must own the story / manuscript / book (`ownerUid`; for today's stories,
  `stories.parentUid`); admins and writers are exempt. Not the owner → 403 `FORBIDDEN`. A child
  persona cookie for another child → 403 `PERSONA_SCOPE_MISMATCH`.
- Envelope: `{ "ok": true, "data": … }` / `{ "ok": false, "error": { "code", "message", "details"? } }`.
  Invalid JSON or body → 400 `INVALID_JSON` / `INVALID_BODY`.
- Reads: clients read `manuscripts/{id}` (+ `/pages`), `books/{id}` (+ `/pages`, `/castSheets`) and
  `jobs` (filtered on `ownerUid`) directly from Firestore for live progress (ADR-0005). There are no
  GET routes for them yet.
- Work happens in jobs (Cloud Tasks → `POST /api/internal/jobs/run`), never in these requests.

### POST `/api/manuscripts`

Create (or reuse) the Manuscript for a story in a Form: the words split into story pages with scene
notes, plus narration per page.

**Request Body**:
```json
{ "storyId": "abc", "formId": "picture_book_standard_v1", "length": 16, "density": "balanced" }
```

| Field | Required | Notes |
|-------|----------|-------|
| `storyId` | yes | A `stories/{storyId}`: a Story made by `POST /api/stories` must be `complete`; a legacy story must have `storyText` and `childId` (else 409 `STORY_NOT_READY`) |
| `formId` | yes | A `storyOutputTypes` id with status `live` (admins may use drafts); else 404 `FORM_NOT_FOUND` |
| `length` | no | Story pages. Picture books: 12, 16 or 24; other Forms: their one length. Default from the Form. Else 400 `INVALID_LENGTH` |
| `density` | no | `picture-led`, `balanced` or `text-led` (as the Form allows). Default from the Form. Else 400 `INVALID_DENSITY` |

**Idempotent** per (story, form, length, density): the id is derived from them, so a repeat returns
the same Manuscript. A Manuscript that `failed` is paginated again.

**Response** (201 Created, or 200 OK when it already existed):
```json
{ "ok": true, "data": { "manuscriptId": "ms_…", "status": "paginating", "created": true } }
```
`status` is `paginating`, `ready` or (never returned on create) `failed`. Pagination runs as the
`manuscript.paginate` job; on `ready` one `manuscript.narrate` job per page writes `narrationUrl`.

### POST `/api/books`

Create a Book: a Manuscript drawn in a Style, optionally with a print Layout. Charges one
`storybook_allowance` (child pool first, then family) in the same transaction that creates the Book.

**Request Body** — either an existing Manuscript:
```json
{ "manuscriptId": "ms_…", "styleId": "watercolour", "layoutId": "square-8in", "idempotencyKey": "7b0c…" }
```
or a story and Form (the child-facing flow: the child picks Form and Style; the Manuscript is created
or reused with the Form's defaults unless `length`/`density` are given):
```json
{ "storyId": "abc", "formId": "picture_book_standard_v1", "styleId": "watercolour" }
```

| Field | Required | Notes |
|-------|----------|-------|
| `manuscriptId` | one of | Must not be `failed` (409 `MANUSCRIPT_FAILED`) |
| `storyId` + `formId` | one of | As for `POST /api/manuscripts`; `length`, `density` optional |
| `styleId` | yes | An `imageStyles` id; else 404 `STYLE_NOT_FOUND` |
| `layoutId` | no | A `printLayouts` id; must fit the length (page rules) else 400 `LAYOUT_INCOMPATIBLE`; 404 `LAYOUT_NOT_FOUND`. Omit for a screen Book |
| `idempotencyKey` | **yes** | 8–128 chars, one per user action (a missing key is 400, so a double tap cannot create and charge two Books). Repeating it returns the same Book (200, `created: false`) without charging again; reusing it for another story → 409 `IDEMPOTENCY_KEY_REUSED` |

**Response** (201 Created, or 200 OK for a repeated `idempotencyKey`):
```json
{ "ok": true, "data": { "bookId": "…", "manuscriptId": "ms_…", "status": "illustrating", "created": true } }
```

**Errors**: 402 `ENTITLEMENT_LIMIT` (`details.remaining`) when no allowance is left; 404 story not
found; 400/403/404/409 as above.

The Book gets pages `1` (cover) and `2…length+1` (story pages); `art: { total: length + 1, done: 0,
failed: 0 }`. Jobs: cast sheets (`book.castSheet`, one per cast member) start now if the Manuscript is
`ready`, otherwise when pagination finishes; then page art (`book.pageArt`, one per page). The Book
ends `ready` (all art), `partial` (some pages failed after retries) or `failed` (none).

### POST `/api/books/[bookId]/pages/[pageNumber]/retry`

Draw again a page whose picture failed. Starts a new job (new idempotency key per retry); the Book
returns to `illustrating` and is rolled up again when the page finishes.

**Request Body**: none.

**Response** (200 OK):
```json
{ "ok": true, "data": { "bookId": "…", "pageNumber": 4, "status": "illustrating" } }
```

**Errors**: 400 `INVALID_PAGE` (not a positive integer); 404 book or page not found (or a page
without art); 409 `PAGE_NOT_FAILED` (the page has art or is still being drawn); 409 `BOOK_LOCKED`.

### POST `/api/books/[bookId]/lock`

Freeze a finished Book (`ready` or `partial`) before printing or sharing. Idempotent.

**Response** (200 OK): `{ "ok": true, "data": { "bookId": "…", "status": "locked" } }`

**Errors**: 409 `BOOK_NOT_FINISHED` (still `illustrating`, or `failed`).

### POST `/api/books/[bookId]/unlock`

Allow changes again; the Book returns to `ready` or `partial` from its art. Share links will be revoked
here (a later slice registers the revocation in `bookUnlockHooks`). Idempotent: unlocking a Book that
is not locked returns its status.

**Response** (200 OK): `{ "ok": true, "data": { "bookId": "…", "status": "ready" } }`

---

## Entitlement Routes

### POST `/api/entitlements/check`

Non-consuming **pre-flight** check of an allowance (no client calls it for stories any more:
`POST /api/stories` itself refuses with 402 `ENTITLEMENT_LIMIT` before creating anything). It **only reads**
the ledger (never writes) and reports remaining capacity, scoped to the named child (child pool
first, then the family pool — see `docs/PRODUCTS.md`). A brand-new family is treated as free-tier
seeded (1 story) in memory.

The authoritative **decrement** happens server-side at completion — `story.finish` consumes one
`story_allowance` in the transaction that sets the Story `complete` (every mode alike). Only `story_allowance` may be checked here; `storybook_allowance`
is charged inside `POST /api/books` (in the transaction that creates the Book), and `print_credit` is reserved for print time (not yet
enforced — see `docs/PRODUCTS.md`).

**Auth**: Bearer ID token required.

**Request Body**:
```json
{
  "component": "story_allowance",
  "childId": "child-id"
}
```

**Response**: `200 OK`
```json
{
  "ok": true,
  "allowed": true,
  "remaining": 1,
  "source": "child"
}
```

**Errors**:
- `400 Bad Request`: Missing/unsupported `component` (only `story_allowance` is permitted)
- `401 Unauthorized`: Missing or invalid token
- `402 Payment Required`: Story allowance exhausted (`allowed: false`, `code: "ENTITLEMENT_LIMIT"`, `remaining`)
- `403 Forbidden`: `childId` does not belong to the caller

---

### GET `/api/entitlements/summary`

Read-only roll-up of how much the caller's family has left to create, for "X stories left" UI
(parent overview card + kids create badge). Server-first: remaining counts are resolved server-side
(child pool + family pool — see `docs/PRODUCTS.md`) so every client renders the same numbers. Never
writes the ledger; a brand-new family is treated as free-tier seeded in memory.

**Auth**: Bearer ID token required.

**Query params**:
- `childId?` — when supplied (and owned by the caller), the counts include that child's own pool
  plus the family pool; otherwise only the family pool is reported.

**Response**: `200 OK`
```json
{
  "ok": true,
  "story": { "remaining": 1 },
  "storybook": { "remaining": 2 }
}
```

**Errors**:
- `401 Unauthorized`: Missing or invalid token
- `403 Forbidden`: `childId` does not belong to the caller

---

## Avatar Routes

### POST `/api/generateAvatar`

**Authentication**: Bearer token, parent or admin. The caller must own the child (`children.ownerParentUid`); admin and writer principals are exempt.

Generate avatar from uploaded photo.

**Request Body**:
```json
{
  "childId": "child-id",
  "photoUrl": "https://..."
}
```

**Response**: `200 OK`
```json
{
  "ok": true,
  "avatarUrl": "https://storage.googleapis.com/..."
}
```

---

### POST `/api/generateAvatar/animation`

**Authentication**: Bearer token, parent or admin. The caller must own the child (`children.ownerParentUid`) and/or character (`characters.ownerParentUid`) named; admin and writer principals are exempt.

Generate animated avatar (dancing).

**Request Body**:
```json
{
  "childId": "child-id"
}
```

**Response**: `200 OK`
```json
{
  "ok": true,
  "animationUrl": "https://storage.googleapis.com/..."
}
```

---

### POST `/api/generateCharacterAvatar`

**Authentication**: Bearer token, parent or admin. The caller must own the character (`characters.ownerParentUid`); admin and writer principals are exempt.

Generate avatar for a character.

**Request Body**:
```json
{
  "characterId": "character-id",
  "photoUrl": "https://..."
}
```

**Response**: `200 OK`
```json
{
  "ok": true,
  "avatarUrl": "https://storage.googleapis.com/..."
}
```

---

## Print Routes

### GET `/api/printOrders/products`

Get available print products.

**Response**: `200 OK`
```json
{
  "products": [
    {
      "id": "hardcover-a4",
      "name": "Premium Hardcover",
      "description": "...",
      "pricingTiers": [...]
    }
  ]
}
```

---

### GET `/api/printOrders/my-orders`

Get current user's print orders with server-derived presentation fields (Sprint W3-C,
server-first principle: clients render the timeline, they never re-map statuses).
Orders are matched on both `parentUid` and the legacy `ownerUserId` field and sorted
newest-first.

Each order is an **allowlist** of parent-facing fields: `id`, `version`, `storyId`, `outputId`,
`printProductId`, `quantity`, `trimSize`, `pageCount`, `shippingAddress`, `contactEmail`,
`paymentStatus`, `fulfillmentStatus`, `approvalStatus`, `rejectedReason`, `mixamTrackingUrl`,
`mixamTrackingNumber`, `mixamCarrier`, `mixamEstimatedDeliveryIso`, plus the derived fields below.
Internal fields (cost snapshots, product spec, process log, Mixam validation, admin ids) are not
returned.

**Authentication**: Required (Bearer token, parent or admin).

**Response**: `200 OK`
```json
{
  "ok": true,
  "orders": [
    {
      "id": "order-id",
      "storyId": "story-id",
      "fulfillmentStatus": "submitted",
      "createdAtIso": "2026-06-01T10:00:00.000Z",
      "updatedAtIso": "2026-06-02T09:00:00.000Z",
      "rejectedAtIso": null,
      "statusCategory": "in_progress",
      "timeline": {
        "steps": [
          { "id": "placed", "label": "Order placed", "state": "complete", "at": "2026-06-01T10:00:00.000Z" },
          { "id": "review", "label": "Quality review", "state": "complete" },
          { "id": "submitted", "label": "Sent to printer", "state": "complete" },
          { "id": "printing", "label": "Printing", "state": "current" },
          { "id": "shipped", "label": "Shipped", "state": "upcoming" }
        ],
        "state": "active",
        "currentStepId": "printing",
        "attention": false
      }
    }
  ],
  "estimatedTurnaround": {
    "minBusinessDays": 10,
    "maxBusinessDays": 15,
    "label": "Estimated 10–15 business days from order to delivery — this is an estimate, not a guarantee."
  }
}
```

| Derived field | Description |
|---------------|-------------|
| `timeline` | Parent-facing progress (placed → review → sent to printer → printing → shipped) derived from `fulfillmentStatus` by `deriveOrderTimeline` (`src/lib/order-timeline.ts`). `state` is `active`/`shipped`/`delivered`/`cancelled`/`failed`; `attention` + `attentionNote` flag `on_hold`/`validation_failed`. |
| `statusCategory` | Filter bucket: `pending` / `in_progress` / `completed` / `cancelled`. |
| `createdAtIso` etc. | Firestore timestamps serialised to ISO strings. |
| `estimatedTurnaround` | From `systemConfig/orderTransparency` (defaults 10–15 business days), honestly labelled as an estimate. |

---

### POST `/api/printOrders`

Create a new print order.

**Request Body**:
```json
{
  "storyId": "story-id",
  "outputId": "output-id",
  "printProductId": "hardcover-a4",
  "quantity": 1,
  "shippingAddress": {
    "name": "John Doe",
    "line1": "123 Main St",
    "city": "London",
    "state": "Greater London",
    "postalCode": "SW1A 1AA",
    "country": "GB"
  },
  "contactEmail": "john@example.com"
}
```

**Response**: `200 OK`
```json
{
  "orderId": "order-id",
  "estimatedCost": {
    "total": 29.99,
    "currency": "GBP"
  }
}
```

---

### POST `/api/printOrders/[orderId]/pay`

Mark order as paid.

**Path Parameters**:
- `orderId` (string, required) - Order document ID

**Response**: `200 OK`
```json
{
  "success": true
}
```

---

### POST `/api/printOrders/mixam`

Create a Mixam print order (parent checkout). Validates the product, ownership, printable PDFs,
UK shipping address, and the degraded-book order gate.

**Authentication**: Required (Bearer token, parent or admin).

**Request Body**:
```json
{
  "storyId": "story-id",
  "storybookId": "storybook-id",
  "printStoryBookId": "optional-print-storybook-id",
  "productId": "hardcover-8x10",
  "quantity": 1,
  "customOptions": { "endPaperColor": "white", "headTailBandColor": "white" },
  "shippingAddress": { "name": "...", "line1": "...", "city": "...", "state": "", "postalCode": "SW1A 1AA", "country": "GB" },
  "acknowledgeDegraded": false,
  "saveAddress": true,
  "addressLabel": "Home"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| acknowledgeDegraded | boolean | No | Sprint W2-C: explicit confirmation that a degraded (partial-art) book may print with art-less pages. Required (server-enforced) when the book's `artStatus.completeness` is `degraded`. |
| saveAddress | boolean | No | Sprint W2-C: save `shippingAddress` to `users/{uid}/addresses` (deduped on line1+postcode; first address becomes default). Best-effort — never fails the order. |
| addressLabel | string | No | Optional label for the saved address (max 50 chars). |

**Degraded-book order gate** (`evaluateOrderArtGate` in `src/lib/storybook-status.ts`):
- `complete` art → allowed.
- `degraded` art → allowed **only** with `acknowledgeDegraded: true`; otherwise
  `409 { ok: false, code: "degraded_confirmation_required", artStatus }` and the client shows the
  explicit confirmation dialog.
- `failed` / `in_progress` art → `400 { ok: false, code: "not_orderable", artStatus }`.
- No rollup available (legacy paths) → gate fails open; the printable-PDF checks remain the backstop.

When a degraded order is acknowledged, the order document records `degradedArtAcknowledged: true`,
an `artStatusSnapshot`, and a `degraded_art_acknowledged` processLog entry.

**Response**: `200 OK`
```json
{
  "ok": true,
  "orderId": "order-id",
  "estimatedCost": { "unitPrice": 15.0, "subtotal": 15.0, "shipping": 5.0, "setupFee": 0, "total": 20.0, "currency": "GBP" },
  "timeline": { "steps": [ "…initial timeline (review current)…" ], "state": "active", "currentStepId": "review", "attention": false },
  "estimatedTurnaround": { "minBusinessDays": 10, "maxBusinessDays": 15, "label": "Estimated 10–15 business days …" }
}
```

`timeline` and `estimatedTurnaround` (Sprint W3-C) feed the post-order confirmation screen —
same shapes as `GET /api/printOrders/my-orders`.

---

### POST `/api/printStoryBooks/[printStoryBookId]/auto-layout`

**Authentication**: Bearer token. The caller must own the print storybook (`printStoryBooks.ownerUserId`) and the story it lays out (`stories.parentUid`); admin and writer principals are exempt.

Auto-layout print storybook pages.

**Path Parameters**:
- `printStoryBookId` (string, required) - PrintStoryBook document ID

**Response**: `200 OK`
```json
{
  "ok": true,
  "pages": [...]
}
```

---

### POST `/api/printStoryBooks/[printStoryBookId]/generate-pdfs`

**Authentication**: Bearer token. The caller must own the print storybook (`printStoryBooks.ownerUserId`); admin and writer principals are exempt.

Generate PDFs for print storybook.

**Path Parameters**:
- `printStoryBookId` (string, required) - PrintStoryBook document ID

**Response**: `200 OK`
```json
{
  "ok": true,
  "coverPdfUrl": "https://...",
  "interiorPdfUrl": "https://..."
}
```

---

## Voice Routes

### POST `/api/voices/preview`

Preview a voice with sample text.

**Request Body**:
```json
{
  "voiceId": "voice-id",
  "text": "Hello, this is a test."
}
```

**Response**: `200 OK`
```json
{
  "ok": true,
  "audioUrl": "https://..."
}
```

---

### POST `/api/tts`

Generate text-to-speech audio.

**Request Body**:
```json
{
  "text": "Text to speak",
  "voiceId": "voice-id"
}
```

**Response**: `200 OK`
```json
{
  "ok": true,
  "audioUrl": "https://..."
}
```

---

### GET `/api/voices/clone`

List all cloned voices for the authenticated parent.

**Response**: `200 OK`
```json
{
  "ok": true,
  "voices": [
    {
      "id": "voice-id",
      "parentUid": "user-uid",
      "name": "Mum",
      "elevenLabsVoiceId": "voice-id",
      "sampleAudioUrl": "https://...",
      "createdAt": "2025-01-05T12:00:00Z"
    }
  ]
}
```

---

### POST `/api/voices/clone`

Create a new cloned voice from uploaded audio using ElevenLabs Instant Voice Cloning.

**Request Body**: `multipart/form-data`

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | Yes | Display name for the voice (e.g., "Mum", "Dad") |
| `audio` | File | Yes | Audio recording (max 10MB, recommended: 1-2 minutes) |

**Response**: `200 OK`
```json
{
  "ok": true,
  "voice": {
    "id": "voice-id",
    "parentUid": "user-uid",
    "name": "Mum",
    "elevenLabsVoiceId": "voice-id",
    "sampleAudioUrl": "https://...",
    "createdAt": "2025-01-05T12:00:00Z"
  }
}
```

**Error Responses**:
- `400` - Missing name or audio file, or file too large
- `429` - Voice cloning limit reached
- `503` - Voice service not configured (missing API key)
- `500` - Voice creation failed

**Notes**:
- Audio sample is stored in Firebase Storage at `users/{uid}/voice-samples/{voiceId}.webm`
- Voice metadata is stored in Firestore at `users/{uid}/voices/{voiceId}`
- Background noise removal is enabled by default

---

### DELETE `/api/voices/clone`

Delete a cloned voice.

**Request Body**:
```json
{
  "voiceId": "voice-id"
}
```

**Response**: `200 OK`
```json
{
  "ok": true,
  "childrenUpdated": 2
}
```

| Field | Type | Description |
|-------|------|-------------|
| `childrenUpdated` | number | Number of children whose voice preference was reset to default |

**Error Responses**:
- `400` - Missing voiceId
- `404` - Voice not found
- `503` - Voice service not configured

**Notes**:
- Deletes voice from ElevenLabs, Firebase Storage, and Firestore
- Children using the deleted voice are automatically switched to the default voice

---

## Music Routes

### POST `/api/music/generate`

Generate background music for a story type using ElevenLabs Music API.

**Authorization**: Requires `isAdmin` or `isWriter` role.

**Request Body**:
```json
{
  "storyTypeId": "animal_adventure_v1",
  "prompt": "gentle whimsical lullaby with soft piano and magical sparkles",
  "durationMs": 45000
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `storyTypeId` | string | Yes | Target story type ID |
| `prompt` | string | No | Music prompt (uses story type's saved prompt if not provided) |
| `durationMs` | number | No | Duration in ms (30000-60000, default 45000) |

**Response**: `200 OK`
```json
{
  "ok": true,
  "audioUrl": "https://firebasestorage.googleapis.com/...",
  "durationMs": 45000
}
```

**Error Responses**:
- `400` - Missing storyTypeId or no prompt provided
- `403` - Not admin or writer
- `404` - Story type not found
- `503` - Music service not configured (missing API key)
- `500` - Generation failed

**Notes**:
- Music is uploaded to Firebase Storage at `story-types/{storyTypeId}/background-music.mp3`
- Updates `backgroundMusic` field on the story type document
- Generation status is tracked in `backgroundMusic.generation.status`

---

## Story Output Types Routes

### GET `/api/storyOutputTypes`

Get available story output types for storybook creation.

**Authentication**: Required

**Response**: `200 OK`
```json
{
  "ok": true,
  "outputTypes": [
    {
      "id": "picture_book_standard_v1",
      "name": "Picture Book",
      "childFacingLabel": "Picture Book",
      "status": "live",
      "imageUrl": "https://...",
      "defaultPrintLayoutId": "a4-portrait-spread-v1"
    }
  ]
}
```

**Notes**:
- Server-side filtering: Only returns output types with `status === 'live'`
- Server-side sorting: Results sorted alphabetically by `name`

---

### GET `/api/imageStyles`

Get available image styles for storybook illustrations.

**Authentication**: Required

**Response**: `200 OK`
```json
{
  "ok": true,
  "imageStyles": [
    {
      "id": "watercolor",
      "title": "Watercolor",
      "description": "Soft, dreamy watercolor illustrations",
      "preferred": true,
      "sampleImageUrl": "https://..."
    }
  ]
}
```

**Notes**:
- Server-side sorting: Preferred styles first, then alphabetically by `title`

---

### POST `/api/storyOutputTypes/generateImage`

Generate an image for a story output type using AI.

**Request Body**:
```json
{
  "storyOutputTypeId": "picture_book_standard_v1"
}
```

**Response**: `200 OK`
```json
{
  "ok": true,
  "imageUrl": "https://firebasestorage.googleapis.com/..."
}
```

**Errors**:
- `400` - Missing storyOutputTypeId
- `403` - Admin access required
- `404` - Story output type not found or missing imagePrompt
- `500` - Image generation failed

---

### POST `/api/storyOutputTypes/uploadImage`

Upload an image for a story output type.

**Request Body**:
```json
{
  "storyOutputTypeId": "picture_book_standard_v1",
  "dataUrl": "data:image/png;base64,...",
  "fileName": "book-cover.png"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `storyOutputTypeId` | string | Yes | Target story output type ID |
| `dataUrl` | string | Yes | Base64 data URL of the image |
| `fileName` | string | No | Original file name (for extension) |

**Response**: `200 OK`
```json
{
  "ok": true,
  "imageUrl": "https://firebasestorage.googleapis.com/...",
  "objectPath": "storyOutputTypes/picture_book_standard_v1/...",
  "contentType": "image/png",
  "size": 245678
}
```

**Errors**:
- `400` - Missing storyOutputTypeId, missing dataUrl, invalid data URL, or not an image
- `403` - Admin access required
- `404` - Story output type not found
- `413` - Image exceeds maximum size (8MB)
- `500` - Upload failed

---

## Issue Reporting Routes

### POST `/api/report-issue`

Allow any authenticated parent or admin user to report an issue. Sprint W3-C: the report is
persisted as a **tracked ticket** in the `tickets` collection (status `open`, see
`GET /api/tickets`) and the maintenance email (all users with `maintenanceUser: true`) is sent
best-effort — an email failure never loses the ticket.

**Request Body**:
```json
{
  "message": "Description of the issue",
  "pagePath": "/current/page/path",
  "diagnostics": {
    "userAgent": "...",
    "screenSize": "1920x1080",
    "timestamp": "2025-01-03T12:00:00.000Z"
  }
}
```

**Response**: `200 OK`
```json
{
  "ok": true,
  "ticketId": "ticket-id",
  "message": "Issue reported successfully"
}
```

**Error Responses**:
- `400` - Missing required fields (message or pagePath)
- `401` - Not authenticated

---

### GET `/api/tickets`

List the calling parent's support tickets (Sprint W3-C), newest first. Status moves
`open` → `in_progress` → `resolved` via admin tooling; parents read status here (surfaced in the
Support Tickets section of `/parent/orders`).

**Authentication**: Required (Bearer token, parent or admin).

**Response**: `200 OK`
```json
{
  "ok": true,
  "tickets": [
    {
      "id": "ticket-id",
      "message": "Description of the issue",
      "pagePath": "/storybook/abc",
      "status": "open",
      "resolutionNote": null,
      "createdAtIso": "2026-06-11T10:00:00.000Z",
      "updatedAtIso": "2026-06-11T10:00:00.000Z"
    }
  ]
}
```

---

## Feedback Routes

Sprint W3-C: post-moment ratings, NPS and consented testimonials. Prompts are parent-facing
only, non-modal, and shown at most once per trigger+subject (suppression is server-backed).
Triggers: `book_first_view` (subject = storybook id) and `order_placed` (subject = order id).

### POST `/api/feedback`

Record a parent's response to a rating prompt — a submission (1–5 stars, optional NPS 0–10 and
comment) or a dismissal. Exactly one document is kept per parent+trigger+subject; a repeat POST
returns `{ ok: true, duplicate: true }`.

**Authentication**: Required (Bearer token, parent or admin).

**Request Body**:
```json
{
  "trigger": "book_first_view",
  "subjectId": "storybook-id",
  "action": "submitted",
  "rating": 5,
  "nps": 9,
  "comment": "Optional free text",
  "pagePath": "/storybook/abc"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| trigger | string | Yes | `book_first_view` or `order_placed` |
| subjectId | string | Yes | Storybook id / print order id |
| action | string | Yes | `submitted` or `dismissed` (dismissals carry no rating) |
| rating | integer 1–5 | When submitted | Star rating |
| nps | integer 0–10 | No | Net promoter score |
| comment | string ≤2000 | No | Free-text comment (stored in Firestore, never sent to analytics) |

**Response**: `200 OK` — `{ "ok": true, "feedbackId": "..." }` (or `"duplicate": true`)

**Error Responses**: `400` validation (see `validateFeedbackSubmission` in
`src/lib/feedback/triggers.ts`), `401`/`403` auth.

---

### GET `/api/feedback/eligibility`

Cross-device "never show twice" check: eligible only while no feedback doc (submission OR
dismissal) exists for this parent+trigger+subject. Clients call this before showing a prompt.

**Query Parameters**: `trigger` (required), `subjectId` (required).

**Response**: `200 OK` — `{ "ok": true, "eligible": true }`

---

### POST `/api/feedback/testimonial`

Attach the optional "share your story" testimonial to an existing **4–5 star** feedback doc the
caller owns: explicit consent flag, quote (≤1000 chars), optional photo (data URL ≤8 MB,
uploaded server-side to `users/{uid}/feedback/{feedbackId}/…` following the children-photos
pattern). Capture only — nothing is displayed publicly yet.

**Authentication**: Required (Bearer token, parent or admin).

**Request Body**:
```json
{
  "feedbackId": "feedback-id",
  "consent": true,
  "quote": "My daughter asks for her own story every night now…",
  "photoDataUrl": "data:image/jpeg;base64,..."
}
```

**Response**: `200 OK` — `{ "ok": true, "feedbackId": "..." }`

**Error Responses**:
- `400` - Missing/invalid fields; `consent` must be explicitly `true`
- `403` - Not the feedback owner
- `404` - Feedback not found
- `409` - Feedback is not a 4–5 star submission
- `413` - Photo too large

---

## Catalog Routes

Commercial catalog (products + prices). Payment-agnostic. See `docs/PRODUCTS.md`.

### GET `/api/catalog`
Returns active products with their active prices, assembled server-side. Auth: any authenticated user.
Response: `{ ok: true, catalog: CatalogEntry[] }` where `CatalogEntry = Product & { prices: Price[] }`.

### `/api/admin/products` (admin only)
- `GET` — list all products (incl. inactive), ordered by `sortOrder`.
- `POST` — create. Body: Product fields (`name`, `kind`, `scope`, `interval?`, `grants[]`, `printProductId?`, `active`, `sortOrder?`). Server-validated (`validateProduct`).
- `PUT` — update. Body as POST plus `productId`.
- `DELETE` — `?productId=` — deletes the product and its prices.

### `/api/admin/prices` (admin only)
- `GET` — `?productId=` (optional) — list prices.
- `POST` — create. Body: `{ productId, currency, amountMinor, interval?, active, externalPriceId? }`. Server-validated.
- `PUT` — update. Body as POST plus `priceId`.
- `DELETE` — `?priceId=`.

---

## Admin Routes

> All admin routes require `isAdmin` or `isWriter` role.

### GET `/api/admin/cleanup-exemplars`

Count exemplar images in Firebase Storage. Used to preview cleanup before deletion.

**Response**: `200 OK`
```json
{
  "ok": true,
  "totalFiles": 25,
  "storiesWithExemplars": 5,
  "storyCounts": {
    "story-123": 3,
    "story-456": 5
  }
}
```

---

### DELETE `/api/admin/cleanup-exemplars`

Delete all exemplar images from Firebase Storage. Exemplars are temporary character reference sheets stored at `stories/{storyId}/exemplars/`.

**Response**: `200 OK`
```json
{
  "ok": true,
  "deleted": 25,
  "failed": 0,
  "total": 25,
  "errors": []
}
```

---

### POST `/api/admin/test-email`

Send a test email to verify Microsoft Graph configuration. Admin only.

Uses the configurable test email template from `systemConfig/email`. The sender address and email content are pulled from the email configuration.

**Request Body** (optional):
```json
{
  "email": "recipient@example.com"
}
```

If `email` is not provided, sends to the authenticated admin's email.

**Response**: `200 OK`
```json
{
  "ok": true,
  "message": "Test email sent to recipient@example.com",
  "recipient": "recipient@example.com"
}
```

**Error Responses**:
- `400` - Test email template is disabled in configuration
- `503` - Microsoft Graph not configured (missing environment variables)

---

### GET `/api/admin/ai-models`

Get current AI models configuration. Admin only.

**Response**: `200 OK`
```json
{
  "ok": true,
  "config": {
    "imageGenerationModel": "googleai/gemini-2.5-flash-image",
    "primaryTextModel": "googleai/gemini-2.5-pro",
    "lightweightTextModel": "googleai/gemini-2.5-flash",
    "legacyTextModel": "googleai/gemini-2.0-flash",
    "availabilityCheck": {
      "lastCheckedAt": "...",
      "status": "ok",
      "issues": []
    }
  },
  "usageMap": {
    "imageGenerationModel": ["avatar-flow.ts", "character-avatar-flow.ts", ...],
    "primaryTextModel": ["gemini3-flow.ts", ...],
    ...
  },
  "envOverrides": {
    "imageGenerationModel": "googleai/custom-model"
  },
  "isDefault": false
}
```

---

### PUT `/api/admin/ai-models`

Update AI models configuration. Admin only.

**Request Body**:
```json
{
  "imageGenerationModel": "googleai/gemini-2.5-flash-image",
  "primaryTextModel": "googleai/gemini-2.5-pro",
  "lightweightTextModel": "googleai/gemini-2.5-flash",
  "legacyTextModel": "googleai/gemini-2.0-flash"
}
```

**Response**: `200 OK`
```json
{
  "ok": true,
  "message": "AI models configuration updated successfully"
}
```

---

### POST `/api/admin/ai-models/check-availability`

Check if configured models are available in the Google AI API. Admin only.

**Request Body** (optional):
```json
{
  "sendAlerts": true
}
```

When `sendAlerts` is true and issues are found, maintenance users will be notified via email.

**Response**: `200 OK`
```json
{
  "ok": true,
  "status": "ok",
  "issues": [],
  "availableModels": {
    "image": [...],
    "text": [...],
    "embedding": [...],
    "other": [...]
  },
  "totalModels": 50,
  "configuredModels": {
    "imageGenerationModel": {
      "model": "googleai/gemini-2.5-flash-image",
      "status": "available",
      "usedBy": ["avatar-flow.ts", ...]
    },
    ...
  },
  "alertsSent": false
}
```

**Status values**:
- `ok` - All configured models are available
- `warning` - Some non-critical models have issues
- `error` - Critical models (image generation) are unavailable

---

### GET `/api/admin/dev-todos`

Get all development todo items. Admin only.

**Response**: `200 OK`
```json
{
  "ok": true,
  "todos": [
    {
      "id": "abc123",
      "title": "Add rate limiting to print order submission",
      "description": "## Context\nThe endpoint needs protection...",
      "status": "pending",
      "priority": "medium",
      "category": "security",
      "createdBy": "claude",
      "createdAt": "...",
      "updatedAt": "..."
    }
  ]
}
```

---

### POST `/api/admin/dev-todos`

Create a new development todo item. Admin only.

**Request Body**:
```json
{
  "title": "Add rate limiting",
  "description": "## Context\n...",
  "priority": "medium",
  "category": "security",
  "createdBy": "claude",
  "relatedFiles": ["src/app/api/print-orders/route.ts"]
}
```

**Required Fields**: `title`

**Optional Fields**: `description`, `priority` (default: 'medium'), `category`, `createdBy` (default: 'admin'), `relatedFiles`

**Response**: `200 OK`
```json
{
  "ok": true,
  "todoId": "abc123",
  "message": "Dev todo created successfully"
}
```

---

### PUT `/api/admin/dev-todos`

Update an existing development todo item. Admin only.

**Request Body**:
```json
{
  "todoId": "abc123",
  "status": "completed",
  "completedBy": "claude",
  "completionSummary": "Implemented incremental loading for storybooks page...",
  "commitId": "b01742d"
}
```

**Required Fields**: `todoId`

**Optional Fields**: `title`, `description`, `status`, `priority`, `partialComment`, `category`, `relatedFiles`, `completedBy`, `completionSummary`, `commitId`

**Notes**:
- When setting `status` to `completed`, you can optionally provide `completionSummary` (what was done) and `commitId` (git commit reference)
- When reopening a completed item (setting `status` to `pending` or `in_progress`), completion fields are automatically cleared

**Response**: `200 OK`
```json
{
  "ok": true,
  "message": "Dev todo updated successfully"
}
```

---

### DELETE `/api/admin/dev-todos`

Delete a development todo item. Admin only.

**Query Parameters**:
- `todoId` (required) - ID of the todo to delete

**Response**: `200 OK`
```json
{
  "ok": true,
  "message": "Dev todo deleted successfully"
}
```

---

### GET `/api/admin/print-orders`

List all print orders (admin view).

**Query Parameters**:
- `status` (string, optional) - Filter by fulfillment status
- `limit` (number, optional) - Limit results (default: 50)

**Response**: `200 OK`
```json
{
  "orders": [...]
}
```

Each order additionally includes server-computed fields (Sprint W3-A — server-first):
- `adminNextAction` — `{ action, label, urgent, source: 'derived' }`, the next required admin
  action derived fresh from current order state (mapping in `src/lib/mixam/order-state.ts`)
- `needsAdminAttention` — boolean rollup of `adminNextAction.urgent`
- `failureSummary` — one-line failure summary (artwork errors > validation > rejection >
  Mixam status reason), or `null`

---

### GET `/api/admin/ops/metrics`

Aggregated metrics for the ops/KPI dashboard (`/admin/ops`). Sprint W3-A.

**Authentication**: Admin only (Bearer token).

**Data sources**: user-behaviour metrics come from PostHog's query API via the cached server
module `src/lib/posthog-query.server.ts` (NOT Firestore scans); operational metrics use bounded,
indexed Firestore queries (`aiFlowLogs` last 24h limit 1000; `printOrders` last 30d limit 500).
While PostHog is dark behind the compliance gate, the analytics sections return
`{ "available": false, "reason": "not_configured" }`.

**Response**: `200 OK`
```json
{
  "ok": true,
  "generatedAt": "2026-06-11T12:00:00.000Z",
  "analytics": {
    "source": "posthog",
    "activeUsers": { "available": true, "cached": false, "data": { "dau": 3, "wau": 10, "mau": 42 } },
    "funnel": { "available": false, "reason": "not_configured" }
  },
  "generation": {
    "source": "firestore:aiFlowLogs",
    "windowHours": 24,
    "total": 120,
    "errors": 6,
    "errorRate": 0.05,
    "sampleLimitReached": false,
    "topErrorFlows": [{ "flowName": "storyImageFlow", "count": 4, "lastMessage": "..." }]
  },
  "printOrders": {
    "source": "firestore:printOrders",
    "windowDays": 30,
    "placed": 12,
    "paid": 10,
    "submittedOrBeyond": 9,
    "shippedOrDelivered": 6,
    "needingAttention": 2,
    "unreviewedOver24h": 1,
    "byStatus": { "awaiting_approval": 2, "in_production": 3 },
    "conversion": { "placedToSubmitted": 0.75, "placedToShipped": 0.5 }
  },
  "health": {
    "lastRunAtMs": 1750000000000,
    "results": [{ "id": "art_pending", "breached": false, "summary": "..." }],
    "thresholds": { "artPendingHours": 4 }
  }
}
```

`health` is `null` until the first health-check run.

**Env (optional, server-side)**: `POSTHOG_PERSONAL_API_KEY`, `POSTHOG_PROJECT_ID`,
`POSTHOG_API_HOST` (default `https://eu.posthog.com`). PostHog query results are cached
in-memory for 5 minutes.

---

### POST `/api/admin/ops/health-check`

Runs the operational health checks and alerts maintenance users on breaches. Sprint W3-A.
Designed to be called from the ops dashboard ("Run checks now"), the daily system test, or a cron.

**Authentication**: Admin Bearer token OR `X-Internal-Secret` header (`INTERNAL_API_SECRET`).

**Query Parameters**:
- `dryRun` (optional) - `1` evaluates the checks but sends no alerts and persists nothing
  (used by the regression suite)

**Checks** (thresholds from `systemConfig/opsHealth.thresholds`, defaults in
`src/lib/ops/health-checks.ts`):
| Check id | Condition | Default threshold |
|----------|-----------|-------------------|
| `art_pending` | Storybook `imageGeneration` running/pending/rate_limited for too long (scans storybooks of the 50 most recently updated stories — no collection-group queries) | 4 hours |
| `orders_unreviewed` | Print orders in `awaiting_approval`/`ready_to_submit` older than threshold | 24 hours |
| `error_rate_spike` | `aiFlowLogs` error+failure rate over a recent window above threshold (with a minimum-sample floor) | 30% over 60 min, min 5 samples |

**Alert dedup**: on breach, `notifyMaintenanceError` fires only if the check's
`lastAlertedAt` (stored on `systemConfig/opsHealth`) is older than `alertCooldownHours`
(default 6h) — a persistent condition alerts once per cooldown window, not per run.

**Response**: `200 OK`
```json
{
  "ok": true,
  "healthy": false,
  "dryRun": false,
  "results": [
    { "id": "art_pending", "breached": true, "summary": "1 storybook(s) with art generation pending > 4h", "details": { "count": 1, "storybookIds": ["stories/x/storybooks/y"] } },
    { "id": "orders_unreviewed", "breached": false, "summary": "No print orders un-reviewed > 24h" },
    { "id": "error_rate_spike", "breached": false, "summary": "Generation error rate 5% over last 60m (6/120)" }
  ],
  "alertsSent": ["art_pending"],
  "thresholds": { "artPendingHours": 4, "ordersUnreviewedHours": 24, "errorRateWindowMinutes": 60, "errorRateThreshold": 0.3, "errorRateMinSamples": 5, "alertCooldownHours": 6 },
  "checkedAt": "2026-06-11T12:00:00.000Z"
}
```

---

### GET `/api/admin/print-orders/[orderId]`

Get detailed order info.

**Response**: `200 OK`
```json
{
  "order": {...}
}
```

---

### POST `/api/admin/print-orders/[orderId]/approve`

Approve order for submission.

**Response**: `200 OK`
```json
{
  "success": true
}
```

---

### POST `/api/admin/print-orders/[orderId]/reject`

Reject order.

**Request Body**:
```json
{
  "reason": "Rejection reason"
}
```

**Response**: `200 OK`
```json
{
  "success": true
}
```

---

### POST `/api/admin/print-orders/[orderId]/submit`

Submit order to Mixam.

**Response**: `200 OK`
```json
{
  "success": true,
  "mixamOrderId": "..."
}
```

---

### POST `/api/admin/print-orders/[orderId]/reset`

Reset order status.

**Response**: `200 OK`
```json
{
  "success": true
}
```

---

### POST `/api/admin/print-orders/[orderId]/cancel`

Cancel an order. If already submitted to Mixam, will attempt to cancel with them (only works if not in production).

**Request Body** (optional):
```json
{
  "reason": "Cancellation reason"
}
```

**Response**: `200 OK`
```json
{
  "ok": true,
  "orderId": "...",
  "mixamCancelled": true
}
```

**Error Responses**:
- `400 Bad Request` - Order cannot be cancelled from current status
- `403 Forbidden` - Admin access required
- `404 Not Found` - Order not found
- `409 Conflict` - Order already in production with Mixam

---

### POST `/api/admin/print-orders/[orderId]/confirm`

Confirm an order with Mixam using the Mixam Public API. This moves the order from `submitted` or `on_hold` status to `confirmed`.

**Requirements**:
- Order must be in `submitted` or `on_hold` status
- Order must have a valid `mixamOrderId`

**Response**: `200 OK`
```json
{
  "ok": true,
  "orderId": "...",
  "mixamStatus": "confirmed"
}
```

**Error Responses**:
- `400 Bad Request` - Order not in confirmable status or missing Mixam order ID
- `403 Forbidden` - Admin access required
- `404 Not Found` - Order not found
- `500 Internal Server Error` - Failed to confirm with Mixam API

---

### POST `/api/admin/print-orders/[orderId]/resubmit`

Resubmit an on_hold order to Mixam. This cancels the previous Mixam order (if possible) and creates a new one using the existing PDFs.

**Requirements**:
- Order must be in `on_hold` status
- Cover and interior PDFs must already be generated
- Interior page count must meet binding requirements

**Response**: `200 OK`
```json
{
  "ok": true,
  "mixamJobNumber": "UK123456",
  "mixamOrderId": "abc-123-def",
  "previousMixamOrderId": "old-order-id",
  "previousMixamJobNumber": "UK123455",
  "previousOrderCancelled": true
}
```

**Error Responses**:
- `400 Bad Request` - Order not on_hold, missing PDFs, or page count issues
- `403 Forbidden` - Admin access required
- `404 Not Found` - Order not found
- `500 Internal Server Error` - Mixam submission failed

---

### POST `/api/admin/print-orders/[orderId]/refresh-status`

Refresh order status from Mixam.

**Response**: `200 OK`
```json
{
  "success": true,
  "status": "in_production"
}
```

---

### Mixam Order Management

After an order is submitted to Mixam, it can be viewed in the Mixam dashboard at:

```
https://mixam.co.uk/orders/{mixamOrderId}
```

Where `{mixamOrderId}` is the order ID returned from the `/api/admin/print-orders/[orderId]/submit` endpoint.

---

### GET `/api/admin/system-config/prompts`

Get global prompt configuration.

**Response**: `200 OK`
```json
{
  "globalPrefix": "...",
  "enabled": true
}
```

---

### PUT `/api/admin/system-config/prompts`

Update global prompt configuration.

**Request Body**:
```json
{
  "globalPrefix": "New prefix...",
  "enabled": true
}
```

**Response**: `200 OK`
```json
{
  "success": true
}
```

---

### GET `/api/admin/system-config/compile-prompt`

Get compile prompt configuration.

**Response**: `200 OK`
```json
{
  "compilePrompt": "...",
  "enabled": true
}
```

---

### PUT `/api/admin/system-config/compile-prompt`

Update compile prompt configuration.

**Response**: `200 OK`
```json
{
  "success": true
}
```

---

### GET `/api/admin/system-config/pagination-prompt`

Get pagination prompt configuration.

**Auth**: Admin only

**Response**: `200 OK`
```json
{
  "ok": true,
  "config": {
    "paginationPrompt": "You are a children's book pagination expert...",
    "enabled": true
  }
}
```

---

### PUT `/api/admin/system-config/pagination-prompt`

Update pagination prompt configuration.

**Auth**: Admin only

**Request Body**:
```json
{
  "paginationPrompt": "Your custom pagination prompt...",
  "enabled": true
}
```

**Response**: `200 OK`
```json
{
  "ok": true,
  "message": "Pagination prompt configuration updated successfully"
}
```

---

### GET `/api/admin/system-config/image-prompt`

Get image prompt configuration for global image generation settings.

**Auth**: Admin only

**Response**: `200 OK`
```json
{
  "ok": true,
  "config": {
    "imagePrompt": "Create an illustration for a children's picture book...",
    "enabled": false
  }
}
```

---

### PUT `/api/admin/system-config/image-prompt`

Update image prompt configuration. When enabled, this prompt is prepended to all image generation requests.

**Auth**: Admin only

**Request Body**:
```json
{
  "imagePrompt": "Your custom image generation prompt...",
  "enabled": true
}
```

**Response**: `200 OK`
```json
{
  "ok": true,
  "message": "Image prompt configuration updated successfully"
}
```

---

### GET `/api/admin/system-config/voice`

Fetch voice configuration (recording script text).

**Required Role**: Parent (authenticated)

**Response**: `200 OK`
```json
{
  "ok": true,
  "config": {
    "voiceRecordingText": "Voice Clone Training Script..."
  }
}
```

---

### PUT `/api/admin/system-config/voice`

Update voice configuration.

**Required Role**: Admin

**Request Body**:
```json
{
  "voiceRecordingText": "Custom script text..."
}
```

**Response**: `200 OK`
```json
{
  "ok": true,
  "message": "Voice configuration updated successfully"
}
```

---

### POST `/api/admin/system-config/seed`

Seed default system configuration.

**Response**: `200 OK`
```json
{
  "success": true
}
```

---

### POST `/api/admin/print-products/seed`

Seed print product catalog.

**Response**: `200 OK`
```json
{
  "success": true,
  "count": 3
}
```

---

### POST `/api/admin/help-sample-data`

Seed sample data for Help Wizard demonstrations. Creates demo documents with "help-*" IDs in multiple collections (children, characters, storySessions, stories, storyBooks, printStoryBooks, printOrders).

**Required Role**: Admin or Writer

**Response**: `200 OK`
```json
{
  "ok": true,
  "message": "Help sample data seeded successfully",
  "seededDocs": [
    "children/help-child",
    "characters/help-character",
    "storySessions/help-session",
    "stories/help-story",
    "storyBooks/help-storybook",
    "printStoryBooks/help-print-storybook",
    "printOrders/help-print-order"
  ]
}
```

---

### GET `/api/admin/help-sample-data`

Check which help sample documents exist.

**Required Role**: Admin or Writer

**Response**: `200 OK`
```json
{
  "ok": true,
  "existingDocs": ["children/help-child", ...],
  "missingDocs": [],
  "allSeeded": true
}
```

---

### POST `/api/admin/print-products/validate-mixam`

Validate print product against Mixam catalog.

**Request Body**:
```json
{
  "productId": "product-id"
}
```

**Response**: `200 OK`
```json
{
  "valid": true,
  "warnings": []
}
```

---

### GET `/api/admin/mixam-catalogue`

Fetch Mixam product catalogue.

**Response**: `200 OK`
```json
{
  "catalogue": {...}
}
```

---

### GET `/api/admin/token-usage`

Get AI token usage statistics.

**Query Parameters**:
- `days` (number, optional) - Days of history (default: 7)

**Response**: `200 OK`
```json
{
  "totalTokens": 150000,
  "totalCost": 12.50,
  "byFlow": {...}
}
```

---

### POST `/api/admin/database/listDocuments`

List documents in a collection.

**Request Body**:
```json
{
  "collection": "children",
  "limit": 20
}
```

**Response**: `200 OK`
```json
{
  "documents": [...]
}
```

---

### GET `/api/admin/audit-collections`

Audit Firestore collections.

**Response**: `200 OK`
```json
{
  "collections": {...}
}
```

---

### GET `/api/admin/cleanup`

Scan database for orphaned, incomplete, or deprecated data.

**Response**: `200 OK`
```json
{
  "timestamp": "2025-12-31T12:00:00.000Z",
  "categories": [
    {
      "name": "Orphaned Children",
      "description": "Child profiles not belonging to the production parent account",
      "items": [
        {
          "id": "child-123",
          "collection": "children",
          "path": "children/child-123",
          "reason": "Belongs to non-production parent",
          "details": {
            "displayName": "Test Child",
            "ownerParentUid": "user-456"
          },
          "canDelete": true
        }
      ],
      "totalCount": 5
    }
  ],
  "summary": {
    "totalItems": 42,
    "deletableItems": 40,
    "categoryCounts": {
      "Orphaned Children": 5,
      "Orphaned Characters": 8
    }
  }
}
```

**Categories scanned**:
- Orphaned Children (not belonging to `parent@rcnx.io`)
- Orphaned Characters
- Orphaned/Incomplete Sessions (in_progress for >24 hours)
- Orphaned Stories
- Non-Production Users (excluding admins)
- Orphaned Print Documents
- Old AI Logs (>30 days)
- Deprecated Collections (legacy storyBooks, outputs)

---

### POST `/api/admin/cleanup`

Delete selected cleanup items.

**Request Body**:
```json
{
  "items": [
    {
      "id": "child-123",
      "collection": "children",
      "path": "children/child-123",
      "canDelete": true
    }
  ]
}
```

**Response**: `200 OK`
```json
{
  "success": true,
  "deleted": 5,
  "failed": 0,
  "errors": [],
  "deletedItems": ["children/child-123", "..."]
}
```

---

### DELETE `/api/admin/cleanup`

Delete all items in a category.

**Query Parameters**:
- `category` (string, required) - Category name to delete

**Response**: `200 OK`
```json
{
  "success": true,
  "deleted": 15,
  "failed": 0,
  "errors": [],
  "deletedItems": ["..."]
}
```

---

### POST `/api/imageStyles/seed`

Seed image styles catalog.

**Response**: `200 OK`
```json
{
  "success": true,
  "count": 5
}
```

---

### POST `/api/imageStyles/generateSample`

Generate sample image for style.

**Request Body**:
```json
{
  "styleId": "watercolor"
}
```

**Response**: `200 OK`
```json
{
  "ok": true,
  "sampleImageUrl": "https://..."
}
```

---

### POST `/api/imageStyles/uploadExampleImage`

Upload an example image for AI style reference. Accepts either a base64 data URL or a source URL to fetch.

**Authentication**: Admin only

**Request Body**:
```json
{
  "imageStyleId": "style-id",
  "dataUrl": "data:image/png;base64,..." // OR
  "sourceUrl": "https://example.com/image.jpg"
}
```

**Response**: `200 OK`
```json
{
  "ok": true,
  "exampleImage": {
    "id": "uuid",
    "url": "https://firebasestorage.googleapis.com/...",
    "storagePath": "imageStyles/style-id/examples/uuid.png",
    "uploadedAt": "2024-01-01T00:00:00.000Z"
  },
  "totalImages": 3
}
```

**Errors**:
- `400` - Missing imageStyleId, invalid image, or max 5 images reached
- `403` - Admin access required
- `404` - Image style not found
- `413` - Image exceeds 8MB limit

---

### POST `/api/imageStyles/deleteExampleImage`

Delete an example image from a style.

**Authentication**: Admin only

**Request Body**:
```json
{
  "imageStyleId": "style-id",
  "exampleImageId": "uuid"
}
```

**Response**: `200 OK`
```json
{
  "ok": true,
  "deletedImageId": "uuid",
  "remainingImages": 2
}
```

**Errors**:
- `400` - Missing parameters
- `403` - Admin access required
- `404` - Image style or example image not found

---

## User Routes

### GET `/api/user/shipping-address`

Get user's saved shipping address.

**Response**: `200 OK`
```json
{
  "address": {
    "name": "John Doe",
    "line1": "123 Main St",
    ...
  }
}
```

---

### PUT `/api/user/shipping-address`

Save user's shipping address.

**Request Body**:
```json
{
  "name": "John Doe",
  "line1": "123 Main St",
  "city": "London",
  "state": "Greater London",
  "postalCode": "SW1A 1AA",
  "country": "GB"
}
```

**Response**: `200 OK`
```json
{
  "success": true
}
```

---

## System Routes

Operational endpoints for deployment, canary monitoring, and feature flags. See `docs/DEPLOYMENT.md`.

### GET `/api/health`

Health probe for canary monitoring and rollback decisions (Sprint W3-B). Returns the build identity (git SHA baked at build time), uptime, and a cheap Firestore dependency probe (single doc read, 2s hard timeout). No secrets in the response.

**Authentication**: None.

**Response** (200 OK — healthy, verbose mode):
```json
{
  "status": "ok",
  "version": "abc1234",
  "revision": "studio-00042-abc",
  "service": "studio",
  "uptimeSeconds": 1234,
  "timestamp": "2026-06-11T10:00:00.000Z",
  "checks": {
    "firestore": { "ok": true, "latencyMs": 12 }
  }
}
```

**Response** (503 Service Unavailable — dependency probe failed):
```json
{
  "status": "degraded",
  "version": "abc1234",
  "revision": "studio-00042-abc",
  "service": "studio",
  "uptimeSeconds": 1234,
  "timestamp": "2026-06-11T10:00:00.000Z",
  "checks": {
    "firestore": { "ok": false, "latencyMs": 2001, "error": "timeout after 2000ms" }
  }
}
```

**Feature flag (worked example)**: when the `health_verbose` flag is `false`, the response is the minimal `{ "status": "ok", "version": "abc1234" }` and the dependency probe is skipped — see `docs/DEPLOYMENT.md` § Feature flags.

**Notes**:
- `revision`/`service` come from Cloud Run's `K_REVISION`/`K_SERVICE` env vars (`null` locally).
- Distinct from `GET /api/healthz` (older endpoint). `/api/healthz` returns `recentLogs` only when `ENABLE_DEV_LOGS=true` **and** the caller presents an admin Bearer token; `/api/health` never exposes logs.

### GET `/api/flags`

Server-evaluated feature flags for clients (server-first rule: clients never evaluate Remote Config themselves). Evaluation precedence: env override → Firebase Remote Config (with `uid`/`emailDomain` custom signals and UID-based percentage rollouts) → Firestore `systemConfig/featureFlags` → in-code default. Flag values are not secrets.

**Authentication**: Optional Bearer token. When present, the user's uid/email feed Remote Config conditions; anonymous callers get unconditioned values.

**Response** (200 OK):
```json
{
  "ok": true,
  "flags": {
    "health_verbose": true
  },
  "authenticated": false
}
```

**Client usage**: `useFeatureFlag('health_verbose')` from `src/hooks/use-feature-flag.ts` (returns the in-code default until loaded; 30s shared cache).

---

## Internal Routes

Internal APIs for automated tools and the job queue. They do not accept user tokens.

### POST `/api/internal/jobs/run`

Runs one job attempt. Called only by Google Cloud Tasks (one task per job attempt); see
`docs/architecture/target/pipeline.md` and `docs/architecture/target/foundations.md`. Built on
`withRoute({ auth: 'internal' })`. Runs the Book pipeline's job kinds (`manuscript.paginate`,
`manuscript.narrate`, `book.prepareCast`, `book.castSheet`, `book.illustrate`, `book.pageArt`;
registered in `src/server/jobs/kinds.ts`).

**Authentication**: `Authorization: Bearer <OIDC token>` minted by Cloud Tasks. The token must
verify with audience `JOBS_OIDC_AUDIENCE` (default `JOBS_RUN_URL`) and carry the verified email
`JOBS_INVOKER_SERVICE_ACCOUNT`. If either setting is missing every call is rejected (401).

**Request Body**:
```json
{ "jobId": "job_…" }
```

**Response** (200 OK) — the delivery was handled. Handler failures are recorded on the job and
retried by the runner itself, so they also answer 200:
```json
{ "ok": true, "data": { "outcome": "succeeded", "jobId": "job_…" } }
```
`outcome` is one of `succeeded`, `retry_scheduled` (with `delayMs`, `error`), `failed` (with
`error: { code, message, retryable }`), `skipped` (already terminal, with `status`), `missing`
(no such job) or `lease_lost`.

**Response** (409 Conflict) — another runner holds the job's lease; Cloud Tasks redelivers later:
```json
{ "ok": false, "error": { "code": "LEASE_HELD", "message": "Job is leased by another runner", "details": { "outcome": "busy", "jobId": "job_…", "leaseUntilMs": 1730000000000 } } }
```

**Errors**: 400 `INVALID_BODY` / `INVALID_JSON`; 401 `UNAUTHENTICATED` (missing, invalid or
wrong-account token, or not configured); 500 `INTERNAL`.

### Shared-secret routes

These use a shared secret instead of user authentication.

**Authentication**: `X-Internal-Secret` header with value matching `INTERNAL_API_SECRET` environment variable.

### POST `/api/internal/system-test`

The daily live pipeline check (`.github/workflows/system-tests.yml`). Seeds a throwaway child and
story, creates a Book through the same service as `POST /api/books`, and runs only the jobs it needs
in process with the real models: `manuscript.paginate`, the cast sheet and the cover's
`book.pageArt` (narration and the other pages stay queued). Cleans up the documents, jobs, ledger and
Storage files afterwards.

**Response** (200 when every check passes, else 500):
```json
{ "ok": true, "results": [{ "name": "pagination_scene_tags", "pass": true, "message": "…", "durationMs": 9000 }], "totalDurationMs": 30000, "timestamp": "…" }
```
Checks: `pagination_scene_tags` (every Manuscript page has a valid scene tag), `location_keys`,
`cover_image`; `setup` appears only when the run could not start.

### POST `/api/internal/dev-todos`

Create a dev todo item. Used by Claude Code to track follow-up work items.

**Request Headers**:
- `X-Internal-Secret` - Internal API secret (required)

**Request Body**:
```json
{
  "title": "string (required)",
  "description": "string (optional, supports markdown)",
  "priority": "low|medium|high (default: medium)",
  "category": "string (optional, e.g. 'integration', 'security', 'performance')",
  "relatedFiles": ["array of file paths (optional)"]
}
```

**Response** (200 OK):
```json
{
  "ok": true,
  "todoId": "firestore-doc-id",
  "message": "Dev todo created successfully"
}
```

**Response** (401 Unauthorized):
```json
{
  "ok": false,
  "errorMessage": "Invalid or missing internal secret"
}
```

---

## Webhook Routes

### POST `/api/webhooks/mixam`

Mixam webhook for order status updates. Called by Mixam when order status changes.

**Authentication**: A valid `X-Mixam-Signature` (HMAC-SHA256 of the raw body with `MIXAM_WEBHOOK_SECRET`) is required. Missing or invalid signature → 401. Secret not configured → 503.

**Behaviour**:
- The payload's `metadata.externalOrderId` selects our order; the update is applied only if the payload's `orderId` equals that order's stored `mixamOrderId`. Otherwise the webhook is acknowledged (200, `warning`) and ignored.
- An order in a final state (`delivered`, `cancelled`) keeps its status; the payload is still recorded.
- Internal processing errors return **500** so Mixam retries. Retries are safe: the status and the admin email change only when the status actually differs.

**Request Headers**:
- `X-Mixam-Signature` - HMAC-SHA256 signature (required)

**Request Body** (Mixam webhook payload):
```json
{
  "orderId": "mixam-order-id",
  "status": "PENDING|INPRODUCTION|DISPATCHED|ONHOLD|etc",
  "statusReason": "Optional reason for status",
  "metadata": {
    "externalOrderId": "our-print-order-id",
    "statusCallbackUrl": "webhook-url"
  },
  "items": [
    {
      "itemId": "item-id",
      "metadata": { "externalItemId": "our-item-id" },
      "errors": [
        { "filename": "file.pdf", "page": 1, "message": "Error description" }
      ],
      "hasErrors": false
    }
  ],
  "hasErrors": false,
  "artworkComplete": true,
  "shipments": [
    {
      "trackingUrl": "https://tracking.example.com/...",
      "consignmentNumber": "TRACK123",
      "courier": "Royal Mail",
      "parcelNumbers": ["PKG001"],
      "date": { "date": "2025-01-15", "timestamp": 1736899200 }
    }
  ]
}
```

**Response**: `200 OK`
```json
{
  "received": true,
  "orderId": "our-print-order-id",
  "status": "in_production"
}
```

**Status Mapping**:
| Mixam Status | Internal Status |
|--------------|-----------------|
| PENDING, RECEIVED | submitted |
| CONFIRMED, ACCEPTED | confirmed |
| INPRODUCTION, PRINTING | in_production |
| DISPATCHED, SHIPPED | shipped |
| DELIVERED | delivered |
| CANCELLED, CANCELED | cancelled |
| ONHOLD, ON_HOLD | on_hold |

**Fields Updated on PrintOrder**:
- `mixamStatus` - Raw Mixam status
- `mixamArtworkComplete` - Whether artwork processing is complete
- `mixamHasErrors` - Whether there are artwork errors
- `mixamStatusReason` - Reason for current status
- `mixamArtworkErrors` - Array of detailed artwork errors
- `mixamTrackingUrl` - Shipment tracking URL
- `mixamTrackingNumber` - Consignment number
- `mixamCarrier` - Courier name
- `mixamParcelNumbers` - Array of parcel numbers
- `mixamShipmentDate` - Shipment date
- `mixamShipments` - Full shipments array
- `lastWebhookPayload` - Full webhook payload (for debugging)
- `lastWebhookAt` - Timestamp of last webhook
- `fulfillmentStatus` - Mapped internal status
- `statusHistory` - Appended with new status entry
- `adminNextAction` - Sprint W3-A: next required admin action `{ action, label, urgent, setAt, source: 'webhook' }` (mapping in `src/lib/mixam/order-state.ts`)
- `needsAdminAttention` - Sprint W3-A: rollup of `adminNextAction.urgent`
- `failureSummary` - Sprint W3-A: one-line failure summary, `null` clears a stale summary

**Admin state machine (Sprint W3-A)**: each webhook advances the admin-facing order state and
records the next required admin action on the order doc. Conservative by design — webhooks only
update state and flag/queue actions; they never trigger irreversible operations (no auto-confirm,
no auto-cancel).

| Internal status after webhook | adminNextAction.action | urgent |
|------------------------------|------------------------|--------|
| validation_failed (or any non-terminal status with artwork errors) | `fix_artwork` | yes |
| ready_to_submit / awaiting_approval | `review_approval` | yes |
| approved | `submit_to_mixam` | yes |
| submitted | `confirm_order` | yes |
| on_hold | `investigate_hold` | yes |
| failed | `investigate_failure` | yes |
| validating / submitting / confirmed / in_production / shipped | `monitor` | no |
| draft / delivered / cancelled | `none` | no |

### GET `/api/webhooks/mixam`

Health check endpoint to verify webhook is accessible.

**Response**: `200 OK`
```json
{
  "service": "Mixam Webhook Handler",
  "status": "ready",
  "timestamp": "2025-01-15T12:00:00.000Z",
  "endpoint": "/api/webhooks/mixam"
}
```

---

## Error Response Format

All errors return a consistent format:

```json
{
  "ok": false,
  "error": "Error message",
  "code": "ERROR_CODE"
}
```

Common error codes:
- `UNAUTHORIZED` - Authentication required
- `FORBIDDEN` - Insufficient permissions
- `NOT_FOUND` - Resource not found
- `VALIDATION_ERROR` - Invalid request data
- `INTERNAL_ERROR` - Server error

---

## Rate Limiting

Some AI-intensive endpoints have rate limiting:
- Image generation: 10 requests/minute
- Story compilation: 5 requests/minute
- TTS generation: 20 requests/minute

Rate-limited responses return status `429` with:
```json
{
  "ok": false,
  "error": "Rate limit exceeded",
  "retryAfter": 60
}
```

---

## User Onboarding Routes

### GET `/api/user/onboarding`

First-run "create your first book" checklist for the authenticated parent. Step completion is **derived server-side** from real account state (children, Stories and Books with their server status) and the snapshot is persisted to `users/{uid}.onboardingState`, including the `signupAtMs`/`firstBookAtMs` time-to-first-book pair. Once the state is `dismissed` or complete the route short-circuits on the cached state (no Firestore fan-out).

**Authentication**: Required

**Response**: `200 OK`
```json
{
  "ok": true,
  "steps": [
    { "id": "createChild", "title": "Create a profile for your child", "description": "...", "href": "/parent/children", "complete": true },
    { "id": "addPhoto", "title": "Add a photo of your child", "description": "...", "href": "/parent/children", "complete": false },
    { "id": "createStory", "title": "Make up a story together", "description": "...", "href": "/", "complete": false },
    { "id": "generateArt", "title": "Turn the story into a picture book", "description": "...", "href": "/", "complete": false },
    { "id": "previewBook", "title": "Preview the finished book", "description": "...", "href": "/parent/storybooks", "complete": false }
  ],
  "complete": false,
  "dismissed": false,
  "newlyCompletedStepIds": ["createChild"],
  "firstBookJustReady": false,
  "signupAtMs": 1750000000000,
  "firstBookAtMs": null,
  "timeToFirstBookMs": null,
  "tipsSeen": { "storyCreation": true }
}
```

**Notes**:
- `newlyCompletedStepIds` lists steps that flipped to complete since the previous derivation — clients emit one `onboarding.step_completed` analytics event per id.
- `firstBookJustReady` is `true` exactly once (the call that first observes a viewable book); clients emit `onboarding.first_book_ready` with `timeToFirstBookMs`.
- Step derivation logic lives in `src/lib/onboarding.ts` (pure, unit-tested).

### POST `/api/user/onboarding`

Record a user choice on the onboarding state.

**Authentication**: Required

**Request Body**:
```json
{ "action": "dismiss" }
```
or `{ "action": "restore" }` or `{ "action": "tipSeen", "tipId": "storyCreation" | "artGeneration" }`

**Response**: `200 OK`
```json
{ "ok": true }
```

**Errors**: `400` for an unknown `action` or `tipId`.

---

## Address Routes

### GET `/api/user/addresses`

List all saved addresses for the authenticated user.

**Authentication**: Required

**Response**: `200 OK`
```json
{
  "ok": true,
  "addresses": [
    {
      "id": "addr_123",
      "name": "John Doe",
      "line1": "123 Main Street",
      "line2": "Flat 4",
      "city": "London",
      "state": "Greater London",
      "postalCode": "SW1A 1AA",
      "country": "GB",
      "label": "Home",
      "isDefault": true,
      "createdAt": "2026-01-13T10:00:00.000Z",
      "updatedAt": "2026-01-13T10:00:00.000Z"
    }
  ]
}
```

**Notes**:
- Auto-migrates legacy `savedShippingAddress` from user profile to addresses subcollection on first access
- Returns addresses sorted by creation date (most recent first)

---

### POST `/api/user/addresses`

Create a new saved address.

**Authentication**: Required

**Request Body**:
```json
{
  "name": "John Doe",
  "line1": "123 Main Street",
  "line2": "Flat 4",
  "city": "London",
  "state": "Greater London",
  "postalCode": "SW1A 1AA",
  "country": "GB",
  "label": "Home"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | Yes | Recipient name |
| `line1` | string | Yes | Address line 1 |
| `line2` | string | No | Address line 2 |
| `city` | string | Yes | City/Town |
| `state` | string | No | County/Region |
| `postalCode` | string | Yes | Postcode |
| `country` | string | Yes | Country code (e.g., "GB") |
| `label` | string | No | User label (e.g., "Home", "Work") |

**Response**: `201 Created`
```json
{
  "ok": true,
  "address": {
    "id": "addr_123",
    "name": "John Doe",
    "line1": "123 Main Street",
    "isDefault": true,
    ...
  }
}
```

**Notes**:
- First address is automatically set as default
- UK address validation is applied

**Error Responses**:
- `400` - Missing required fields or validation failed
- `401` - Not authenticated

---

### PUT `/api/user/addresses/[id]`

Update an existing address.

**Path Parameters**:
- `id` (string, required) - Address document ID

**Authentication**: Required

**Request Body**: Same as POST `/api/user/addresses`

**Response**: `200 OK`
```json
{
  "ok": true,
  "address": { ... }
}
```

**Error Responses**:
- `400` - Validation failed
- `401` - Not authenticated
- `404` - Address not found

---

### DELETE `/api/user/addresses/[id]`

Delete a saved address.

**Path Parameters**:
- `id` (string, required) - Address document ID

**Authentication**: Required

**Response**: `200 OK`
```json
{
  "ok": true,
  "deletedId": "addr_123",
  "newDefaultId": "addr_456"
}
```

**Notes**:
- If deleting the default address, another address is automatically set as default
- `newDefaultId` is included if default was reassigned

**Error Responses**:
- `401` - Not authenticated
- `404` - Address not found

---

### POST `/api/user/addresses/[id]/default`

Set an address as the default.

**Path Parameters**:
- `id` (string, required) - Address document ID

**Authentication**: Required

**Response**: `200 OK`
```json
{
  "ok": true,
  "defaultAddressId": "addr_123"
}
```

**Error Responses**:
- `401` - Not authenticated
- `404` - Address not found

---

### GET `/api/admin/system-config/addresses`

Get system addresses configuration.

**Authentication**: Admin required

**Response**: `200 OK`
```json
{
  "ok": true,
  "config": {
    "addresses": [
      {
        "id": "sys_123",
        "name": "StoryPic Ltd",
        "line1": "123 Business Park",
        "city": "London",
        "postalCode": "EC1A 1BB",
        "country": "GB",
        "label": "Head Office"
      }
    ],
    "mixamBillToAddressId": "sys_123",
    "updatedAt": "2026-01-13T10:00:00.000Z",
    "updatedBy": "admin@example.com"
  }
}
```

---

### PUT `/api/admin/system-config/addresses`

Update system addresses configuration.

**Authentication**: Admin required

**Request Body**:
```json
{
  "addresses": [
    {
      "id": "sys_123",
      "name": "StoryPic Ltd",
      "line1": "123 Business Park",
      "city": "London",
      "postalCode": "EC1A 1BB",
      "country": "GB",
      "label": "Head Office"
    }
  ],
  "mixamBillToAddressId": "sys_123"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `addresses` | SavedAddress[] | Yes | Array of system addresses |
| `mixamBillToAddressId` | string \| null | No | ID of address to use for Mixam billing |

**Response**: `200 OK`
```json
{
  "ok": true,
  "message": "System addresses updated successfully"
}
```

**Notes**:
- The `mixamBillToAddressId` must reference an address in the `addresses` array
- This billing address is used when submitting print orders to Mixam

**Error Responses**:
- `400` - Validation failed
- `403` - Admin access required

---

### GET `/api/admin/system-config/mixam`

Get Mixam API configuration.

**Authentication**: Admin required

**Response**: `200 OK`
```json
{
  "ok": true,
  "config": {
    "paymentMethod": "ACCOUNT"
  }
}
```

---

### PUT `/api/admin/system-config/mixam`

Update Mixam API configuration.

**Authentication**: Admin required

**Request Body**:
```json
{
  "paymentMethod": "ACCOUNT"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `paymentMethod` | string | Yes | Must be one of: `TEST_ORDER`, `ACCOUNT`, `CARD_ON_FILE` |

**Payment Method Values**:
- `TEST_ORDER` - For testing/integration (orders not processed by Mixam)
- `ACCOUNT` - Bill to Mixam account (production)
- `CARD_ON_FILE` - Use card on file with Mixam

**Response**: `200 OK`
```json
{
  "ok": true,
  "config": {
    "paymentMethod": "ACCOUNT"
  }
}
```

**Error Responses**:
- `400` - Invalid payment method
- `403` - Admin access required

---

## Postcode Routes

### GET `/api/postcode/lookup`

Look up addresses from a UK postcode using getAddress.io API.

**Authentication**: Bearer token (any signed-in user). Each lookup is billed to the getAddress.io key.

**Query Parameters**:
- `postcode` (string, required) - UK postcode to look up

**Response**: `200 OK`
```json
{
  "ok": true,
  "postcode": "SW1A 1AA",
  "addresses": [
    {
      "displayAddress": "Buckingham Palace, London, SW1A 1AA",
      "line1": "Buckingham Palace",
      "line2": "",
      "city": "London",
      "county": "Greater London",
      "postalCode": "SW1A 1AA",
      "country": "GB"
    }
  ]
}
```

**Notes**:
- Proxies requests to getAddress.io to keep API key server-side
- Returns formatted addresses suitable for form population
- Supports all valid UK postcode formats (with or without space)

**Error Responses**:
- `400` - Missing postcode parameter
- `401` - Not authenticated
- `404` - No addresses found for postcode
- `503` - Postcode lookup service not configured (missing API key)

---

## Sound Effects Routes

Routes for managing Q&A answer animations and their sound effects.

### POST `/api/soundEffects/seed`

Seed the answerAnimations collection with default animation configurations.

**Authentication**: Required (admin or writer role)

**Response**: `200 OK`
```json
{
  "ok": true,
  "message": "Seeded 11 answer animations",
  "results": [
    { "id": "exit-slide-left", "action": "created" },
    { "id": "exit-slide-right", "action": "updated" }
  ]
}
```

**Notes**:
- Creates 10 exit animations and 1 selection animation
- Preserves existing sound effect URLs if already generated
- Safe to call multiple times (idempotent)

---

### POST `/api/soundEffects/generate`

Generate a sound effect for an answer animation using ElevenLabs Text-to-Sound-Effects API.

**Authentication**: Required (admin or writer role)

**Request Body**:
```json
{
  "animationId": "exit-slide-left",
  "prompt": "quick whoosh sound swooping left",
  "durationSeconds": 0.5,
  "promptInfluence": 0.3
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `animationId` | string | Yes | Animation document ID |
| `prompt` | string | No | Override stored prompt |
| `durationSeconds` | number | No | Sound duration (0.5-30, defaults to animation config) |
| `promptInfluence` | number | No | ElevenLabs prompt influence (0-1, default 0.3) |

**Response**: `200 OK`
```json
{
  "ok": true,
  "audioUrl": "https://firebasestorage.googleapis.com/...",
  "durationSeconds": 0.5
}
```

**Notes**:
- Generated audio is uploaded to Firebase Storage at `animations/{animationId}/sound-effect.mp3`
- The animation document is updated with the audio URL and status
- Uses ElevenLabs Text-to-Sound-Effects API
- Updates animation's `soundEffect.generation.status` through 'generating' → 'ready' or 'error'

**Error Responses**:
- `400` - Missing animationId or no prompt provided
- `403` - Not admin or writer
- `404` - Animation not found
- `500` - Generation failed
- `503` - ElevenLabs API not configured

---

## Version History

| Date | Changes |
|------|---------|
| 2026-06-11 | W3-C: Feedback routes (feedback, eligibility, testimonial), tracked tickets (report-issue + GET /api/tickets), server-derived order timeline/turnaround on my-orders and mixam order creation |
| 2026-01-14 | Added sound effects routes (seed, generate) for Q&A animations |
| 2026-01-13 | Added address management endpoints (user addresses CRUD, system addresses, postcode lookup) |
| 2026-01-04 | Added /api/storyFriends endpoint for "Fun with my friends" story generator |
| 2025-12-31 | Added /api/admin/cleanup endpoints for database cleanup |
| 2025-12-31 | Added storyOutputTypes/uploadImage endpoint |
| 2025-12-29 | Initial documentation created |
