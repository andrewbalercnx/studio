# API Documentation

> **Last Updated**: 2026-01-08 (added storyOutputTypes, imageStyles, and stories list endpoints; enhanced stories API with resolved placeholders)
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
- [Print Routes](#print-routes)
- [Admin Routes](#admin-routes)
- [Voice Routes](#voice-routes)
- [Music Routes](#music-routes)
- [Story Output Types Routes](#story-output-types-routes)
- [Issue Reporting Routes](#issue-reporting-routes)
- [Webhook Routes](#webhook-routes)

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

Compile story session into final story text.

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

Get story generators that are enabled for kids. This endpoint fetches from the `storyGenerators` collection, filtering to include only generators where `status === 'live'` and `enabledForKids === true`.

**Authentication**: None required (public endpoint)

**Response**: `200 OK`
```json
{
  "ok": true,
  "generators": [
    {
      "id": "wizard",
      "name": "Magic Story Wizard",
      "description": "Answer questions to create your story!",
      "status": "live",
      "order": 1,
      "enabledForKids": true,
      "styling": {
        "gradient": "bg-gradient-to-br from-amber-400 to-orange-500",
        "icon": "Wand2",
        "loadingMessage": "Creating your adventure..."
      },
      "capabilities": {...},
      "apiEndpoint": "/api/storyWizard"
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
  "finalization": {...}
}
```

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

### POST `/api/storybookV2/pages`

Generate storybook pages from story.

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

---

### POST `/api/storybookV2/images`

Generate images for storybook pages.

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
  "rateLimited": false,
  "logs": []
}
```

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

Get Mixam pricing quote.

**Request Body**:
```json
{
  "printProductId": "hardcover-a4",
  "quantity": 1,
  "pageCount": 24
}
```

**Response**: `200 OK`
```json
{
  "quote": {
    "printCost": 15.00,
    "shippingCost": 5.00,
    "total": 20.00,
    "currency": "GBP"
  }
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

## Admin Routes

> All admin routes require `isAdmin` or `isWriter` role.

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

## Version History

| Date | Changes |
|------|---------|
| 2026-01-04 | Added /api/storyFriends endpoint for "Fun with my friends" story generator |
| 2025-12-31 | Added /api/admin/cleanup endpoints for database cleanup |
| 2025-12-31 | Added storyOutputTypes/uploadImage endpoint |
| 2025-12-29 | Initial documentation created |
