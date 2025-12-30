# API Documentation

> **Last Updated**: 2025-12-29
>
> **IMPORTANT**: This document must be updated whenever API routes change.
> See [CLAUDE.md](../CLAUDE.md) for standing rules on documentation maintenance.

## Overview

StoryPic Kids API uses Next.js App Router API routes. All endpoints require authentication unless otherwise noted.

**Base URL**: `/api`

**Authentication**: Firebase ID token in `Authorization: Bearer <token>` header.

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

Upload photos for a child profile.

**Request Body**: `multipart/form-data`
- `childId` (string, required) - Child document ID
- `photos` (File[], required) - Photo files to upload

**Response**: `200 OK`
```json
{
  "urls": ["https://storage.googleapis.com/..."]
}
```

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

Upload photos for a character.

**Request Body**: `multipart/form-data`
- `characterId` (string, required) - Character document ID
- `photos` (File[], required) - Photo files to upload

**Response**: `200 OK`
```json
{
  "urls": ["https://storage.googleapis.com/..."]
}
```

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

Generate story beat options.

**Request Body**:
```json
{
  "sessionId": "session-id",
  "childId": "child-id",
  "selectedOptionId": "opt1",
  "moreOptions": false
}
```

**Response**: `200 OK`
```json
{
  "ok": true,
  "text": "The brave hero entered the forest...",
  "options": [
    {"id": "beat1", "text": "Follow the mysterious path"},
    {"id": "beat2", "text": "Climb the tall tree"}
  ],
  "arcStepIndex": 2
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

Create or manage share link for storybook.

**Request Body**:
```json
{
  "bookId": "book-id",
  "action": "create",
  "expiresInDays": 7,
  "passcode": "optional-passcode"
}
```

**Response**: `200 OK`
```json
{
  "shareId": "share-id",
  "shareLink": "https://app.storypic.com/share/..."
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
  "imageStyleId": "watercolor"
}
```

**Response**: `200 OK`
```json
{
  "ok": true,
  "pagesReady": 12,
  "pagesTotal": 12
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

## Admin Routes

> All admin routes require `isAdmin` or `isWriter` role.

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

### POST `/api/admin/audit-collections`

Audit Firestore collections.

**Response**: `200 OK`
```json
{
  "collections": {...}
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

Mixam webhook for order status updates.

**Note**: This endpoint uses Mixam's webhook signature for authentication.

**Request Body**: Mixam webhook payload

**Response**: `200 OK`
```json
{
  "received": true
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
| 2025-12-29 | Initial documentation created |
