# API Documentation

> **Last Updated**: 2026-06-11 (Security: `POST /api/storybookV2/pages` and `POST /api/storybookV2/images` now require authentication + `story.parentUid` ownership; W3-A: new `GET /api/admin/ops/metrics`, `POST /api/admin/ops/health-check`, `GET /api/admin/sessions`; `adminNextAction`/`failureSummary` on `GET /api/admin/print-orders` and the Mixam webhook; W3-B: new `GET /api/health` canary/rollback probe, `GET /api/flags` server-evaluated feature flags; W2-C: new `POST /api/storybookV2/pageEdit`; degraded-order gate + `saveAddress` on `POST /api/printOrders/mixam`; `artStatus` rollup on `GET /api/parent/storybooks` and `GET /api/storyBook/[bookId]`; W2-B: `/api/user/onboarding` — server-derived first-run checklist + time-to-first-book instrumentation)
>
> **IMPORTANT**: This document must be updated whenever API routes change.
> See [CLAUDE.md](../CLAUDE.md) for standing rules on documentation maintenance.

## Overview

StoryPic Kids API uses Next.js App Router API routes. All endpoints require authentication unless otherwise noted.

**Base URL**: `/api`

**Authentication**: Firebase ID token in `Authorization: Bearer <token>` header.

---

## API Client Library

For child-facing functionality, use the typed API client (`@storypic/api-client`) instead of direct fetch calls.

### Installation

The API client is available as a workspace package:

```typescript
import { StoryPicClient } from '@storypic/api-client';
```

### React Integration

Use the `ApiClientProvider` context in React components:

```typescript
import { useApiClient, useRequiredApiClient } from '@/contexts/api-client-context';

// Returns null if user not authenticated
const client = useApiClient();

// Throws if user not authenticated (use in components that require auth)
const client = useRequiredApiClient();
```

### Client Methods

The `StoryPicClient` provides typed methods for child-facing operations:

**Story Creation:**
- `sendWizardChoice(sessionId, optionId)` - Wizard generator
- `sendBeatChoice(sessionId, optionId, moreOptions)` - Beat generator
- `sendFriendsAction(sessionId, optionId, action, characterIds)` - Friends generator
- `sendGemini3Choice(sessionId, optionId, userMessage)` - Gemini3 generator
- `sendGemini4Choice(sessionId, optionId, userMessage)` - Gemini4 generator
- `compileStory(sessionId)` - Compile story

**Storybook Generation:**
- `generatePages(storyId, storybookId, storyOutputTypeId)` - Generate pages
- `generateImages(storyId, storybookId, imageStyleId)` - Generate images

**Discovery:**
- `getGenerators()` - Get available story generators
- `getOutputTypes()` - Get available story output types
- `getImageStyles()` - Get available image styles

**Reading/Viewing:**
- `getMyStories(childId)` - Get stories for a child (with resolved placeholders)
- `getStory(storyId)` - Get single story (with resolved placeholders and actors)
- `getMyStorybooks(storyId, includeAll?)` - Get storybooks for a story
- `getStorybookPages(storyId, storybookId)` - Get pages for a storybook

**TTS:**
- `speak(text, voiceId, childId)` - Generate text-to-speech audio

---

## Table of Contents

- [Authentication](#authentication)
- [Parent Routes](#parent-routes)
- [Children Routes](#children-routes)
- [Characters Routes](#characters-routes)
- [Story Session Routes](#story-session-routes)
- [Storybook Routes](#storybook-routes)
- [Entitlement Routes](#entitlement-routes)
- [Print Routes](#print-routes)
- [Admin Routes](#admin-routes)
- [Voice Routes](#voice-routes)
- [Music Routes](#music-routes)
- [Story Output Types Routes](#story-output-types-routes)
- [Issue Reporting Routes](#issue-reporting-routes)
- [System Routes](#system-routes)
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

Verify parent PIN.

**Request Body**:
```json
{
  "pin": "1234"
}
```

**Response**: `200 OK`
```json
{
  "valid": true
}
```

---

### GET `/api/parent/storybooks`

Get all storybooks for the authenticated parent, grouped by child. Optimized for fast loading - returns document-level data without querying pages.

**Query Parameters**:
- `includeThumbnails` (boolean, optional) - If true, queries pages to get thumbnails (slower). Default: false.

**Response**: `200 OK`
```json
{
  "children": [
    {
      "childId": "child123",
      "displayName": "Emma",
      "avatarUrl": "https://...",
      "storybooks": [
        {
          "storybookId": "sb123",
          "storyId": "story456",
          "childId": "child123",
          "title": "The Dragon Adventure",
          "thumbnailUrl": null,
          "imageStyleId": "watercolor",
          "printLayoutId": "mixam-8x10-hardcover",
          "createdAt": "2026-01-15T10:30:00.000Z",
          "imageGenerationStatus": "ready",
          "pageGenerationStatus": "ready",
          "audioStatus": "none",
          "isNewModel": true,
          "printablePdfUrl": null,
          "printableCoverPdfUrl": null,
          "printableInteriorPdfUrl": null,
          "artCompleteness": "degraded",
          "artPagesReady": 10,
          "artPagesTotal": 12,
          "artPagesFailed": 2,
          "isOrderable": true
        }
      ]
    }
  ],
  "totalBooks": 5
}
```

**Degraded-book rollup (Sprint W2-C)**: `artCompleteness` / `artPages*` / `isOrderable` are computed
server-side from the persisted `storybook.artStatus` (written by the images route). They are absent
on books that predate the contract. Clients must use `isOrderable` to gate print actions — degraded
(partial-art) books remain orderable, subject to the checkout confirmation (see
`POST /api/printOrders/mixam`).

---

### POST `/api/parent/storybooks/thumbnails`

Batch fetch thumbnails and audio status for storybooks. Called after initial list load for incremental loading.

**Request Body**:
```json
{
  "storybooks": [
    {
      "storybookId": "sb123",
      "storyId": "story456",
      "isNewModel": true
    }
  ]
}
```

**Response**: `200 OK`
```json
{
  "thumbnails": [
    {
      "storybookId": "sb123",
      "thumbnailUrl": "https://storage.googleapis.com/...",
      "audioStatus": "ready",
      "pagesWithAudio": 12,
      "totalPages": 12,
      "calculatedImageStatus": "ready"
    }
  ]
}
```

**Side Effects**: Caches thumbnailUrl on storybook document for future fast loads.

**Limits**: Maximum 50 storybooks per request.

---

## Children Routes

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

### POST `/api/characters/create`

Create a character from a child profile or parent input.

**Request Body**:
```json
{
  "displayName": "Fluffy",
  "type": "Pet",
  "likes": ["treats", "walks"],
  "dislikes": ["baths"],
  "description": "A friendly golden retriever",
  "childId": "optional-child-id"
}
```

**Response**: `200 OK`
```json
{
  "characterId": "abc123"
}
```

---

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

### POST `/api/characterTraits`

Generate character trait suggestions using AI.

**Request Body**:
```json
{
  "characterLabel": "a friendly squirrel",
  "sessionId": "session-id"
}
```

**Response**: `200 OK`
```json
{
  "ok": true,
  "question": "What makes Nutsy special?",
  "suggestedTraits": ["loves acorns", "very curious", "always helpful"]
}
```

---

## Story Session Routes

All story generation endpoints return a `StoryGeneratorResponse` object with the following common fields:

### StoryGeneratorResponse Format

| Field | Type | Description |
|-------|------|-------------|
| `ok` | boolean | Success status |
| `sessionId` | string | Story session ID |
| `headerText` | string? | Story continuation (beat mode) - with $$placeholders$$ |
| `headerTextResolved` | string? | Story continuation resolved for display |
| `question` | string | Current question/prompt - with $$placeholders$$ |
| `questionResolved` | string? | Question resolved for display |
| `options` | array | Available choices |
| `isStoryComplete` | boolean? | True when story is finished |
| `finalStory` | string? | Complete story text when finished |
| `progress` | number? | Story progress (0.0-1.0), monotonically increasing |
| `debug` | object? | Debug information (dev only) |
| `errorMessage` | string? | Error description when ok=false |

**Progress Field**: The `progress` value (0.0 to 1.0) estimates how far through the story generation we are. This is used to display visual progress indicators to children. Progress is monotonically increasing - it never decreases during a story session.

---

### POST `/api/warmupReply`

Generate warmup phase response.

**Request Body**:
```json
{
  "sessionId": "session-id",
  "childId": "child-id",
  "userMessage": "I want an adventure story!"
}
```

**Response**: `200 OK`
```json
{
  "ok": true,
  "text": "Great choice! Let's create an adventure...",
  "options": [
    {"id": "opt1", "text": "In a magical forest"},
    {"id": "opt2", "text": "In outer space"}
  ]
}
```

---

### POST `/api/storyBeat`

Generate story beat with continuation and options. Uses the standard `StoryGeneratorResponse` format for StoryBrowser compatibility.

**Request Body**:
```json
{
  "sessionId": "session-id",
  "selectedOptionId": "A",
  "moreOptions": false
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `sessionId` | string | Yes | Story session ID |
| `selectedOptionId` | string | No | Option ID from previous beat |
| `moreOptions` | boolean | No | Request alternative options |

**Response**: `200 OK` (StoryGeneratorResponse format)
```json
{
  "ok": true,
  "sessionId": "session-id",
  "headerText": "The brave hero entered the forest...",
  "headerTextResolved": "Emma entered the magical forest...",
  "question": "What happens next?",
  "questionResolved": "What happens next?",
  "options": [
    {"id": "A", "text": "Follow the mysterious path", "textResolved": "Follow the mysterious path"},
    {"id": "B", "text": "Climb the tall tree", "textResolved": "Climb the tall tree"}
  ],
  "isStoryComplete": false,
  "progress": 0.4
}
```

---

### POST `/api/gemini3`

Generate Gemini 3 free-form story questions. Uses the standard `StoryGeneratorResponse` format for StoryBrowser compatibility.

**Request Body**:
```json
{
  "sessionId": "session-id"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `sessionId` | string | Yes | Story session ID |

**Response**: `200 OK` (StoryGeneratorResponse format)
```json
{
  "ok": true,
  "sessionId": "session-id",
  "question": "What kind of adventure would $$childId$$ like?",
  "questionResolved": "What kind of adventure would Emma like?",
  "options": [
    {"id": "A", "text": "A magical journey", "textResolved": "A magical journey"},
    {"id": "B", "text": "A space adventure", "textResolved": "A space adventure"}
  ],
  "isStoryComplete": false,
  "progress": 0.25
}
```

---

### POST `/api/gemini4`

Generate Gemini 4 structured story questions with "Tell me more" support. Uses the standard `StoryGeneratorResponse` format for StoryBrowser compatibility.

**Request Body**:
```json
{
  "sessionId": "session-id",
  "selectedOptionId": "A",
  "userMessage": "I chose the magical journey"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `sessionId` | string | Yes | Story session ID |
| `selectedOptionId` | string | No | Option ID from previous question |
| `userMessage` | string | No | Child's response text |

**Response**: `200 OK` (StoryGeneratorResponse format)
```json
{
  "ok": true,
  "sessionId": "session-id",
  "question": "Where would you like to go?",
  "questionResolved": "Where would you like to go?",
  "options": [
    {"id": "A", "text": "A magical forest", "isMoreOption": false},
    {"id": "B", "text": "A distant planet", "isMoreOption": false},
    {"id": "C", "text": "An underwater kingdom", "isMoreOption": false},
    {"id": "M", "text": "Tell me more", "isMoreOption": true}
  ],
  "isStoryComplete": false,
  "progress": 0.25
}
```

---

### POST `/api/storyWizard`

Generate wizard questions and final story. The wizard asks 4 questions to gather story preferences, then generates a complete story. Uses the standard `StoryGeneratorResponse` format for StoryBrowser compatibility.

**Request Body**:
```json
{
  "sessionId": "session-id",
  "selectedOptionId": "A"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `sessionId` | string | Yes | Story session ID |
| `selectedOptionId` | string | No | Option letter (A, B, C, D) from previous question |

**Response**: `200 OK` (StoryGeneratorResponse format)
```json
{
  "ok": true,
  "sessionId": "session-id",
  "question": "What kind of adventure would you like?",
  "questionResolved": "What kind of adventure would you like?",
  "options": [
    {"id": "A", "text": "A magical journey", "introducesCharacter": false},
    {"id": "B", "text": "A space adventure", "introducesCharacter": false}
  ],
  "isStoryComplete": false,
  "progress": 0.4
}
```

**Response (Story Complete)**: `200 OK`
```json
{
  "ok": true,
  "sessionId": "session-id",
  "question": "Your story is complete!",
  "options": [],
  "isStoryComplete": true,
  "finalStory": "Once upon a time...",
  "finalStoryResolved": "Once upon a time..."
}
```

---

### POST `/api/storyFriends`

Multi-phase "Fun with my friends" story generator. Creates adventure stories featuring the child's characters and friends through a guided 4-phase flow.

**Phases**:
1. `character_selection` - AI proposes adventure companions; child confirms or modifies
2. `scenario_selection` - Child picks an adventure scenario
3. `synopsis_selection` - Child picks from 3 story synopses (can request more)
4. `story_generation` - AI writes the full story

**Request Body**:
```json
{
  "sessionId": "session-id",
  "selectedOptionId": "scenario-id",
  "action": "confirm_characters",
  "selectedCharacterIds": ["char-1", "char-2"]
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `sessionId` | string | Yes | Story session ID |
| `selectedOptionId` | string | No | Selected scenario or synopsis ID |
| `action` | string | No | `confirm_characters`, `change_characters`, or `more_synopses` |
| `selectedCharacterIds` | string[] | No | Character IDs when modifying selection |

**Response (Character Selection)**: `200 OK`
```json
{
  "ok": true,
  "sessionId": "session-id",
  "question": "Here are some friends who'd love to adventure with you!",
  "questionResolved": "Here are some friends who'd love to adventure with you!",
  "options": [],
  "isStoryComplete": false,
  "friendsPhase": "character_selection",
  "proposedCharacters": [
    {"id": "child-id", "displayName": "Emma", "type": "child", "avatarUrl": "...", "isSelected": true},
    {"id": "char-1", "displayName": "Max", "type": "Pet", "avatarUrl": "...", "isSelected": true}
  ],
  "availableCharacters": [...]
}
```

**Response (Scenario Selection)**: `200 OK`
```json
{
  "ok": true,
  "sessionId": "session-id",
  "question": "What adventure would you like?",
  "options": [
    {"id": "scen-1", "text": "The Enchanted Forest: Explore a magical woods..."},
    {"id": "scen-2", "text": "Space Station Rescue: Help friends on a space station..."}
  ],
  "isStoryComplete": false,
  "friendsPhase": "scenario_selection",
  "scenarios": [
    {"id": "scen-1", "title": "The Enchanted Forest", "description": "Explore a magical woods..."},
    {"id": "scen-2", "title": "Space Station Rescue", "description": "Help friends on a space station..."}
  ]
}
```

**Response (Synopsis Selection)**: `200 OK`
```json
{
  "ok": true,
  "sessionId": "session-id",
  "question": "Which story sounds the most fun?",
  "options": [
    {"id": "syn-1", "text": "The Lost Treasure: Emma and Max discover a map..."},
    {"id": "syn-2", "text": "The Magic Key: A mysterious key appears..."},
    {"id": "MORE", "text": "Show me different stories", "isMoreOption": true}
  ],
  "isStoryComplete": false,
  "friendsPhase": "synopsis_selection",
  "synopses": [...]
}
```

**Response (Story Complete)**: `200 OK`
```json
{
  "ok": true,
  "sessionId": "session-id",
  "question": "Your story is complete!",
  "options": [],
  "isStoryComplete": true,
  "finalStory": "Once upon a time, $$childId$$ and $$char-1$$ set off...",
  "finalStoryResolved": "Once upon a time, Emma and Max set off...",
  "friendsPhase": "complete"
}
```

---

### POST `/api/storyArc`

Generate or retrieve story arc structure.

**Request Body**:
```json
{
  "sessionId": "session-id",
  "storyTypeId": "adventure"
}
```

**Response**: `200 OK`
```json
{
  "ok": true,
  "arc": {
    "steps": [
      {"id": "step1", "label": "The Call to Adventure"},
      {"id": "step2", "label": "Meeting the Guide"}
    ]
  }
}
```

---

### POST `/api/storyEnding`

Generate story ending options.

**Request Body**:
```json
{
  "sessionId": "session-id",
  "childId": "child-id"
}
```

**Response**: `200 OK`
```json
{
  "ok": true,
  "endings": [
    {"id": "end1", "text": "They lived happily ever after..."},
    {"id": "end2", "text": "And that was just the beginning..."}
  ]
}
```

---

### POST `/api/storyCompile`

Compile story session into final story text. This is the shared completion chokepoint for **all**
story flows (kids and parent), so it is where `story_allowance` is enforced:

- **Pre-flight block**: before compiling, if the family is already at its `story_allowance` limit
  (and this session hasn't already been counted), the route returns `402` and produces no story doc
  — which blocks the entire downstream funnel (storybook, print).
- **Consume-on-completion**: on a successful compile it decrements one `story_allowance`, scoped to
  the session's child then family pool. Idempotent via a `storyAllowanceConsumed` flag on the
  session, so a retried/timed-out compile never double-charges, and an *abandoned* create (no
  compile) never burns quota. The decrement is non-blocking — a ledger hiccup never fails an
  already-generated story.

**Request Body**:
```json
{
  "sessionId": "session-id"
}
```

**Response**: `200 OK`
```json
{
  "ok": true,
  "storyId": "story-id",
  "storyText": "Once upon a time...",
  "title": "The Great Adventure"
}
```

**Errors**:
- `402 Payment Required`: Story allowance exhausted (`code: "ENTITLEMENT_LIMIT"`, `remaining`)
- `409 Conflict`: A compile is already in progress for this session

---

### POST `/api/storyPagination`

Paginate a compiled story into pages using AI-driven pagination.

**Request Body**:
```json
{
  "storyId": "story-id",
  "storyOutputTypeId": "output-type-id"
}
```

**Response**: `200 OK`
```json
{
  "ok": true,
  "storyId": "story-id",
  "pages": [
    {
      "pageNumber": 1,
      "bodyText": "Once upon a time...",
      "entityIds": ["child-id", "character-id"],
      "imageDescription": "A child standing in a magical forest..."
    }
  ],
  "stats": {
    "pageCount": 12,
    "targetPageCount": 12
  },
  "debug": {
    "stage": "done",
    "details": {}
  }
}
```

**Notes**:
- Uses AI to split story text into pages based on the output type's pagination prompt
- Falls back to sentence-based chunking if AI pagination fails
- Returns `entityIds` (actor IDs) and `imageDescription` for each page

---

### POST `/api/gemini3`

Generate story using Gemini 3 flow.

**Request Body**:
```json
{
  "sessionId": "session-id",
  "childId": "child-id",
  "userMessage": "User's choice or input"
}
```

**Response**: `200 OK`
```json
{
  "ok": true,
  "state": "asking",
  "question": "What happens next?",
  "choices": [{"text": "Option A"}, {"text": "Option B"}]
}
```

---

### POST `/api/gemini4`

Generate story using Gemini 4 flow.

**Request Body**:
```json
{
  "sessionId": "session-id",
  "childId": "child-id",
  "userMessage": "User's choice or input"
}
```

**Response**: `200 OK`
```json
{
  "ok": true,
  "state": "asking",
  "question": "What happens next?",
  "choices": [{"text": "Option A"}, {"text": "Option B"}]
}
```

---

### GET `/api/kids-flows`

Get available story flows configuration.

> **DEPRECATED**: Use `/api/kids-generators` instead, which fetches from the `storyGenerators` collection.

**Response**: `200 OK`
```json
{
  "wizardEnabled": true,
  "chatEnabled": true,
  "gemini3Enabled": true,
  "gemini4Enabled": true
}
```

---

### GET `/api/kids-generators`

Get story generators that are enabled for kids. This endpoint fetches from the `storyGenerators` collection, filtering to include only generators where `status === 'live'` and `enabledForKids === true`, then applies a **user-safe presentation layer** (`src/lib/kids-generator-presentation.ts`):

- Names, descriptions, and loading messages never expose model jargon (e.g. stored name `"Gemini Free"` is served as `"Free Play"`). Admins can override copy per generator via the optional `kidFriendlyName` / `kidFriendlyDescription` doc fields.
- Internal fields are stripped from the response: `prompts`, `promptConfig`, `defaultModel`, `defaultTemperature`, `apiEndpoint`, `backgroundMusic`, `status`, `enabledForKids`.
- Exactly one generator carries `recommended: true` so clients can render a "Recommended for first-timers" badge. Precedence: `recommendedForKids` doc flag, then the `wizard` generator, then the first generator by display order.
- Sorted by `order` (lower first), then by `id`.

Consumed by the kids PWA (`/kids/create`), the parent-side chooser (`/story/start`), and the mobile app.

**Authentication**: None required (public endpoint)

**Response**: `200 OK`
```json
{
  "ok": true,
  "generators": [
    {
      "id": "wizard",
      "name": "Story Wizard",
      "description": "Answer four quick questions and watch a whole story appear. The simplest way to make your first story.",
      "order": 1,
      "capabilities": {...},
      "styling": {
        "gradient": "bg-gradient-to-br from-amber-400 to-orange-500",
        "icon": "Sparkles",
        "loadingMessage": "The wizard is creating your adventure..."
      },
      "recommended": true
    }
  ]
}
```

**Error Response**: `500 Internal Server Error`
```json
{
  "ok": false,
  "errorMessage": "Error message",
  "generators": []
}
```

---

## Storybook Routes

### GET `/api/storyBook/[bookId]`

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

### PATCH `/api/storyBook/[bookId]`

Update storybook details.

**Path Parameters**:
- `bookId` (string, required) - Storybook document ID

**Request Body**:
```json
{
  "title": "Updated Title",
  "selectedImageStyleId": "watercolor"
}
```

**Response**: `200 OK`
```json
{
  "success": true
}
```

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

### POST `/api/storyBook/audio`

Generate full audio narration for storybook.

**Request Body**:
```json
{
  "storyId": "story-id",
  "voiceId": "voice-id"
}
```

**Response**: `200 OK`
```json
{
  "ok": true,
  "audioUrl": "https://storage.googleapis.com/..."
}
```

---

### POST `/api/storyBook/pageAudio`

Generate audio for a specific page.

**Request Body**:
```json
{
  "storyId": "story-id",
  "storybookId": "storybook-id",
  "pageId": "page-id",
  "voiceId": "voice-id"
}
```

**Response**: `200 OK`
```json
{
  "ok": true,
  "audioUrl": "https://storage.googleapis.com/..."
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

### POST `/api/storyBook/actorAvatar`

Generate composite avatar from story actors.

**Request Body**:
```json
{
  "storyId": "story-id"
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

### POST `/api/storybookV2/create`

Create a new StoryBookOutput document for a story. The server handles print layout lookup and image dimension calculation.

**Request Body**:
```json
{
  "storyId": "story-id",
  "outputTypeId": "picture_book",
  "styleId": "watercolor",
  "imageStylePrompt": "watercolor illustration with soft colors..."
}
```

**Response**: `200 OK`
```json
{
  "ok": true,
  "storybookId": "new-storybook-id"
}
```

**Entitlement enforcement**: Before the storybook document is created, the server atomically
checks-and-consumes one `storybook_allowance` unit from the caller's entitlement ledger (the
story's child pool first, then the family pool — see `docs/PRODUCTS.md`). A brand-new family is
seeded with the free tier (2 storybooks) on first use. When the allowance is exhausted the route
returns `402` and creates nothing.

**Errors**:
- `400 Bad Request`: Missing required fields
- `401 Unauthorized`: Missing or invalid token
- `402 Payment Required`: Storybook allowance exhausted (`code: "ENTITLEMENT_LIMIT"`, `remaining`)
- `403 Forbidden`: Story doesn't belong to user
- `404 Not Found`: Story or output type not found

---

### POST `/api/storybookV2/pages`

Generate storybook pages from story.

**Authentication**: Required (Bearer token). Any authenticated Firebase user; ownership is
enforced against `story.parentUid` (admins/writers via custom claims bypass ownership). This is a
cost-bearing AI endpoint — unauthenticated requests are rejected before any generation state is
written.

**Request Body**:
```json
{
  "storyId": "story-id",
  "storybookId": "storybook-id",
  "storyOutputTypeId": "picture_book"
}
```

**Response**: `200 OK`
```json
{
  "ok": true,
  "pagesCount": 12
}
```

**Errors**:
- `400 Bad Request`: Missing `storyId` or `storybookId`
- `401 Unauthorized`: Missing or invalid token
- `403 Forbidden`: Story doesn't belong to user
- `404 Not Found`: Story or storybook not found
- `409 Conflict`: Storybook is locked

---

### POST `/api/storybookV2/images`

Generate images for storybook pages.

**Authentication**: Required (Bearer token). Any authenticated Firebase user; ownership is
enforced against `story.parentUid` (admins/writers via custom claims bypass ownership). This is a
cost-bearing AI endpoint — unauthenticated requests are rejected before any generation state is
written.

**Request Body**:
```json
{
  "storyId": "story-id",
  "storybookId": "storybook-id",
  "pageId": "optional-page-id",
  "forceRegenerate": false,
  "imageStylePrompt": "optional art style override",
  "additionalPrompt": "optional user instructions for image generation"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| storyId | string | Yes | The story document ID |
| storybookId | string | Yes | The storybook document ID |
| pageId | string | No | If provided, only regenerate this specific page |
| forceRegenerate | boolean | No | Force regeneration even if image exists |
| imageStylePrompt | string | No | Override the art style prompt |
| additionalPrompt | string | No | Additional user instructions appended to the image prompt (only used with pageId) |

**Response**: `200 OK`
```json
{
  "ok": true,
  "status": "ready",
  "ready": 12,
  "total": 12,
  "artStatus": { "completeness": "complete", "isOrderable": true, "...": "..." },
  "rateLimited": false,
  "logs": []
}
```

**Single-page repaint (Sprint W2-C)**: the parent book view's per-page "repaint" goes through this
route with `pageId` + `forceRegenerate: true` (+ optional `additionalPrompt`). Single-page
regeneration does **not** consume any entitlement — `storybook_allowance` is only consumed at
`POST /api/storybookV2/create`.

**Errors**:
- `400 Bad Request`: Missing `storyId` or `storybookId`, or no pages available
- `401 Unauthorized`: Missing or invalid token
- `403 Forbidden`: Story doesn't belong to user
- `404 Not Found`: Story or storybook not found
- `409 Conflict`: Storybook is locked, or generation already in progress
- `429 Too Many Requests`: Upstream model rate limit (`rateLimited: true`, `retryAt`)

---

### POST `/api/storybookV2/pageEdit`

Parent per-page clean-up (Sprint W2-C): edit a single page's text and/or image-generation prompt on
a new-model storybook. Image regeneration deliberately stays in `POST /api/storybookV2/images`
(single-page path above) so generation logic is never duplicated.

**Authentication**: Required (Bearer token, parent or admin). Ownership is checked against
`story.parentUid`.

**Request Body**:
```json
{
  "storyId": "story-id",
  "storybookId": "storybook-id",
  "pageId": "page-id",
  "pageText": "New page wording (optional)",
  "imagePrompt": "New picture description (optional)"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| storyId | string | Yes | The story document ID |
| storybookId | string | Yes | The storybook document ID |
| pageId | string | Yes | The page document ID |
| pageText | string | No* | Replaces BOTH `bodyText` and `displayText` (the parent's wording becomes canonical). May be empty (picture-only page). Max 2000 chars. May contain `$$id$$` placeholders. |
| imagePrompt | string | No* | Replaces the page's art prompt. Cannot be blanked. Max 4000 chars. Takes effect on the next (re)generation. |

\* At least one of `pageText` / `imagePrompt` is required.

**Side Effects**:
- Records `lastEditedAt` (server timestamp) and `lastEditedBy` (uid) on the page.
- If the text changed and the page had narration, the stale audio is reset
  (`audioStatus: 'pending'`, `audioUrl: null`) so it can be re-recorded to match.

**Response**: `200 OK`
```json
{
  "ok": true,
  "storyId": "story-id",
  "storybookId": "storybook-id",
  "pageId": "page-id",
  "textChanged": true,
  "promptChanged": false,
  "audioReset": true,
  "requestId": "..."
}
```

**Errors**:
- `400` - Validation failure (missing ids, nothing to update, blank imagePrompt, length limits)
- `401` / `403` - Unauthenticated / not the story's owner
- `404` - Story, storybook, or page not found
- `409` - Storybook is locked for printing (unlock first)

---

### POST `/api/storybookV2/finalize`

Finalize storybook for printing.

**Request Body**:
```json
{
  "storyId": "story-id",
  "storybookId": "storybook-id"
}
```

**Response**: `200 OK`
```json
{
  "ok": true,
  "finalization": {
    "status": "finalized",
    "version": 1
  }
}
```

---

### GET `/api/stories/[storyId]/storybooks`

Get storybooks for a specific story.

**Path Parameters**:
- `storyId` (string, required) - Story document ID

**Query Parameters**:
- `includeAll` (boolean, optional) - If `true`, includes all storybooks regardless of status. Default: `false` (only returns storybooks with `imageGeneration.status === 'ready'`)

**Response**: `200 OK`
```json
[
  {
    "id": "storybook-id",
    "storyId": "story-id",
    "storyOutputTypeId": "picture_book",
    "imageStyleId": "watercolor",
    "imageGeneration": { "status": "ready" },
    "thumbnailUrl": "https://storage.googleapis.com/...",
    "createdAt": { "seconds": 1704672000, "_seconds": 1704672000 }
  }
]
```

**Notes**:
- Server-side filtering: By default only returns storybooks with `imageGeneration.status === 'ready'`. Use `?includeAll=true` to get all storybooks.
- Server-side sorting: Results sorted by `createdAt` descending (most recent first)
- Thumbnails: If `thumbnailUrl` not set, fetches first page's `imageUrl` automatically

---

### GET `/api/stories/[storyId]/storybooks/[storybookId]/pages`

Get pages for a specific storybook with placeholders resolved.

**Path Parameters**:
- `storyId` (string, required) - Story document ID
- `storybookId` (string, required) - Storybook document ID

**Response**: `200 OK`
```json
[
  {
    "id": "page-id",
    "pageNumber": 0,
    "kind": "cover_front",
    "bodyText": "Original text with $$childId$$ placeholders",
    "displayText": "Resolved text with actual names",
    "imageUrl": "https://storage.googleapis.com/...",
    "imageStatus": "ready"
  }
]
```

**Notes**:
- Server-side filtering: Pages with `kind === 'blank'` or `kind === 'title_page'` are excluded (these are for print only)
- Server-side sorting: Results sorted by `pageNumber` ascending
- Placeholder resolution: `displayText` field contains resolved placeholders (child/character names)

---

## Entitlement Routes

### POST `/api/entitlements/check`

Non-consuming **pre-flight** gate for story creation. The kids/parent clients create the
`storySessions` document directly via the client SDK; this route lets a client block a user who is
already at their `story_allowance` limit *before* they invest time in the wizard. It **only reads**
the ledger (never writes) and reports remaining capacity, scoped to the named child (child pool
first, then the family pool — see `docs/PRODUCTS.md`). A brand-new family is treated as free-tier
seeded (1 story) in memory.

The authoritative **decrement** happens server-side at completion — `/api/storyCompile` consumes one
`story_allowance` when a story is compiled (covering kids and parent flows alike), so enforcement
holds even if a client skips this check. Only `story_allowance` may be checked here; `storybook_allowance`
is enforced inside `/api/storybookV2/create`, and `print_credit` is reserved for print time (not yet
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

Get current user's print orders.

**Response**: `200 OK`
```json
{
  "orders": [
    {
      "id": "order-id",
      "storyId": "story-id",
      "fulfillmentStatus": "submitted",
      "createdAt": "..."
    }
  ]
}
```

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
  "estimatedCost": { "unitPrice": 15.0, "subtotal": 15.0, "shipping": 5.0, "setupFee": 0, "total": 20.0, "currency": "GBP" }
}
```

---

### POST `/api/printStoryBooks/[printStoryBookId]/auto-layout`

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

### GET `/api/stories`

Get stories for a specific child with resolved placeholders.

**Authentication**: Required

**Query Parameters**:
- `childId` (string, required) - Child document ID

**Response**: `200 OK`
```json
[
  {
    "id": "story-id",
    "childId": "child-id",
    "metadata": { "title": "The Adventure of $$childId$$" },
    "synopsis": "$$childId$$ goes on an adventure...",
    "titleResolved": "The Adventure of Emma",
    "synopsisResolved": "Emma goes on an adventure...",
    "actors": [
      {
        "id": "child-id",
        "displayName": "Emma",
        "avatarUrl": "https://...",
        "type": "child"
      }
    ],
    "pageGeneration": { "status": "ready" },
    "imageGeneration": { "status": "ready" },
    "createdAt": { "seconds": 1704672000 }
  }
]
```

**Notes**:
- Server-side filtering: Soft-deleted stories are excluded
- Server-side sorting: Results sorted by `createdAt` descending (most recent first)
- Placeholder resolution: `titleResolved` and `synopsisResolved` contain resolved names
- Actor profiles: `actors` array contains resolved displayName and avatarUrl

---

### GET `/api/stories/[storyId]`

Get a single story with fully resolved placeholders.

**Path Parameters**:
- `storyId` (string, required) - Story document ID

**Response**: `200 OK`
```json
{
  "id": "story-id",
  "childId": "child-id",
  "metadata": { "title": "The Adventure" },
  "storyText": "Original text with $$childId$$ placeholders...",
  "titleResolved": "The Adventure",
  "synopsisResolved": "Emma goes on an adventure...",
  "storyTextResolved": "Emma went on a wonderful adventure...",
  "actors": [
    {
      "id": "child-id",
      "displayName": "Emma",
      "avatarUrl": "https://...",
      "type": "child"
    },
    {
      "id": "char-id",
      "displayName": "Max",
      "avatarUrl": "https://...",
      "type": "character"
    }
  ]
}
```

**Notes**:
- Placeholder resolution: All text fields (`titleResolved`, `synopsisResolved`, `storyTextResolved`) contain resolved names
- Actor profiles: `actors` array contains all children and characters mentioned in the story

---

> The following routes require `isAdmin` role:

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

Allow any authenticated parent or admin user to report an issue to maintenance users. This triggers an email notification to all users with `maintenanceUser: true`.

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
  "message": "Issue reported successfully"
}
```

**Error Responses**:
- `400` - Missing required fields (message or pagePath)
- `401` - Not authenticated

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
    "imageGenerationModel": ["story-image-flow.ts", "avatar-flow.ts", ...],
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
      "usedBy": ["story-image-flow.ts", ...]
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

### GET `/api/admin/sessions`

List the 100 most recently updated story sessions with a server-computed `lastError` summary
joined from the most recent 500 `aiFlowLogs` entries (Sprint W3-A — surfaces failure reasons
at a glance without opening each record).

**Authentication**: Admin only (Bearer token).

**Response**: `200 OK`
```json
{
  "ok": true,
  "sessions": [
    {
      "id": "session-id",
      "childId": "child-id",
      "status": "in_progress",
      "currentPhase": "story",
      "storyTitle": "...",
      "storyMode": "wizard",
      "promptConfigId": "...",
      "promptConfigLevelBand": "low",
      "createdAtMs": 1750000000000,
      "updatedAtMs": 1750000000000,
      "lastError": {
        "flowName": "storyImageFlow",
        "message": "Truncated error message (max 300 chars)",
        "status": "error",
        "atMs": 1750000000000
      }
    }
  ]
}
```

`lastError` is `null` when the session has no error/failure in the recent log window.

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

### GET `/api/admin/system-config/kids-flows`

Get kids flow configuration.

**Response**: `200 OK`
```json
{
  "wizardEnabled": true,
  "chatEnabled": true,
  "gemini3Enabled": true,
  "gemini4Enabled": true
}
```

---

### PUT `/api/admin/system-config/kids-flows`

Update kids flow configuration.

**Response**: `200 OK`
```json
{
  "success": true
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
- Distinct from `GET /api/healthz` (older endpoint; returns `recentLogs` when `ENABLE_DEV_LOGS=true`). `/api/health` never exposes logs.

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

Internal APIs for automated tools (Claude Code). These use a shared secret instead of user authentication.

**Authentication**: `X-Internal-Secret` header with value matching `INTERNAL_API_SECRET` environment variable.

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

**Authentication**: HMAC-SHA256 signature verification using `MIXAM_WEBHOOK_SECRET` (optional).

**Request Headers**:
- `X-Mixam-Signature` - HMAC-SHA256 signature (optional)

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

First-run "create your first book" checklist for the authenticated parent. Step completion is **derived server-side** from real account state (children, story sessions, storybook outputs) and the snapshot is persisted to `users/{uid}.onboardingState`, including the `signupAtMs`/`firstBookAtMs` time-to-first-book pair. Once the state is `dismissed` or complete the route short-circuits on the cached state (no Firestore fan-out).

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

**Authentication**: Required

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
| 2026-01-14 | Added sound effects routes (seed, generate) for Q&A animations |
| 2026-01-13 | Added address management endpoints (user addresses CRUD, system addresses, postcode lookup) |
| 2026-01-04 | Added /api/storyFriends endpoint for "Fun with my friends" story generator |
| 2025-12-31 | Added /api/admin/cleanup endpoints for database cleanup |
| 2025-12-31 | Added storyOutputTypes/uploadImage endpoint |
| 2025-12-29 | Initial documentation created |
