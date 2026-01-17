# Database Schema Documentation

> **Last Updated**: 2026-01-17 (added storybooks subcollection schema with thumbnailUrl field)
>
> **IMPORTANT**: This document must be updated whenever the Firestore schema changes.
> See [CLAUDE.md](../CLAUDE.md) for standing rules on documentation maintenance.

## Overview

StoryPic Kids uses Cloud Firestore (NoSQL) as its primary database. This document describes all collections, their fields, relationships, and security rules.

---

## Collections

### `users`

User profiles with authentication and role information.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | Yes | Firebase UID |
| `email` | string | Yes | User's email address |
| `roles.isAdmin` | boolean | Yes | Admin role flag |
| `roles.isWriter` | boolean | Yes | Writer/editor role flag |
| `roles.isParent` | boolean | Yes | Parent role flag |
| `createdAt` | timestamp | Yes | Account creation time |
| `pinHash` | string | No | Hashed parent PIN |
| `pinSalt` | string | No | Salt for PIN hash |
| `pinUpdatedAt` | timestamp | No | Last PIN update time |
| `savedShippingAddress` | PrintOrderAddress | No | Default shipping address |
| `canShowWizardTargets` | boolean | No | Allow wizard target overlays |
| `hasCompletedStartupWizard` | boolean | No | True after user has seen default startup wizard |
| `notifiedUser` | boolean | No | Receives admin notifications for print orders |
| `maintenanceUser` | boolean | No | Receives maintenance/error notification emails |

**Subcollections**:
- `voices/{voiceId}` - Parent's cloned voices for TTS (see `ParentVoice` type)
- `addresses/{addressId}` - Parent's saved shipping addresses (see `SavedAddress` type)

**Security**: Read/write by owner; admins have full access.

---

### `users/{uid}/addresses/{addressId}` (Subcollection)

Saved shipping addresses for print orders.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | Yes | Document ID |
| `name` | string | Yes | Recipient name |
| `line1` | string | Yes | Address line 1 |
| `line2` | string | No | Address line 2 |
| `city` | string | Yes | City/Town |
| `state` | string | No | County/Region |
| `postalCode` | string | Yes | Postcode |
| `country` | string | Yes | Country code (e.g., "GB") |
| `label` | string | No | User label (e.g., "Home", "Work") |
| `isDefault` | boolean | No | Default address flag |
| `createdAt` | timestamp | Yes | Creation time |
| `updatedAt` | timestamp | Yes | Last update time |

**Migration**: Legacy `savedShippingAddress` field on user document is auto-migrated to this subcollection on first access.

**Security**: Read/write by owner; admins have full access.

---

### `children`

Child profiles owned by parents.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | Yes | Document ID |
| `displayName` | string | Yes | Child's display name |
| `pronouns` | 'he/him' \| 'she/her' \| 'they/them' | No | Defaults to 'they/them' |
| `dateOfBirth` | timestamp | No | Child's birth date |
| `photos` | string[] | No | Photo URLs |
| `avatarUrl` | string | No | AI-generated avatar URL |
| `avatarAnimationUrl` | string | No | Dancing avatar animation URL |
| `avatarAnimationGeneration` | object | No | Animation generation status |
| `likes` | string[] | Yes | Positive preferences |
| `dislikes` | string[] | Yes | Negative preferences |
| `description` | string | No | Child description |
| `imageDescription` | string | No | AI-generated physical appearance description (internal) |
| `imageDescriptionGeneration` | object | No | Generation status: `{ status, lastRunAt, lastCompletedAt, lastErrorMessage }` |
| `ownerParentUid` | string | Yes | Parent's Firebase UID |
| `createdAt` | timestamp | Yes | Creation time |
| `updatedAt` | timestamp | No | Last update time |
| `namePronunciation` | string | No | Phonetic pronunciation for TTS |
| `preferredVoiceId` | string | No | Preferred TTS voice ID (default: Alice `Xb7hH8MSUJpSbSDYk0k2`) |
| `autoReadAloud` | boolean | No | Enable TTS for stories (story creation & reader) |
| `musicEnabled` | boolean | No | Enable background music during story creation (default: true) |
| `deletedAt` | timestamp | No | Soft delete timestamp |
| `deletedBy` | string | No | UID of user who deleted |

**Security**: Parents can CRUD their own children; admins have full access; soft-deleted items hidden from non-admins.

---

### `characters`

Story characters with traits, owned by parents.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | Yes | Document ID |
| `displayName` | string | Yes | Character name |
| `pronouns` | 'he/him' \| 'she/her' \| 'they/them' | No | Defaults to 'they/them' |
| `type` | 'Family' \| 'Friend' \| 'Pet' \| 'Toy' \| 'Other' | Yes | Character type |
| `relationship` | string | No | Family relationship (for type='Family') |
| `namePronunciation` | string | No | Phonetic pronunciation for TTS |
| `photos` | string[] | No | Photo URLs |
| `avatarUrl` | string | No | AI-generated avatar URL |
| `avatarAnimationUrl` | string | No | Dancing avatar animation URL |
| `likes` | string[] | Yes | Character likes |
| `dislikes` | string[] | Yes | Character dislikes |
| `description` | string | No | Character description |
| `imageDescription` | string | No | AI-generated physical appearance description (internal) |
| `imageDescriptionGeneration` | object | No | Generation status: `{ status, lastRunAt, lastCompletedAt, lastErrorMessage }` |
| `ownerParentUid` | string | Yes | Parent's Firebase UID |
| `childId` | string | No | Optional child-specific (blank = family-wide) |
| `createdAt` | timestamp | Yes | Creation time |
| `updatedAt` | timestamp | Yes | Last update time |
| `isParentGenerated` | boolean | No | true = parent-created, false = AI-generated |
| `usageCount` | number | No | Times used in stories |
| `lastUsedAt` | timestamp | No | Last story usage |
| `deletedAt` | timestamp | No | Soft delete timestamp |
| `deletedBy` | string | No | UID of user who deleted |

**Security**: Parents can CRUD their own characters; admins have full access.

---

### `storySessions`

Interactive story creation sessions.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | Yes | Document ID |
| `childId` | string | Yes | Child's document ID |
| `parentUid` | string | Yes | Parent's Firebase UID |
| `status` | 'in_progress' \| 'completed' | Yes | Session status |
| `currentPhase` | string | Yes | 'warmup' \| 'story' \| 'ending' \| 'final' \| 'wizard' \| 'gemini3' \| 'gemini4' \| 'friends' \| 'completed' |
| `currentStepIndex` | number | Yes | Current step in flow |
| `storyTitle` | string | No | Story title |
| `storyVibe` | string | No | Story mood/vibe |
| `storyTypeId` | string | No | Selected story type |
| `arcStepIndex` | number | No | Current arc step |
| `mainCharacterId` | string | No | Main character ID |
| `supportingCharacterIds` | string[] | No | Supporting character IDs |
| `storyMode` | string | No | Story generator ID (e.g., 'wizard', 'friends', or dynamic generator IDs) |
| `actors` | string[] | No | Actor IDs ($$id$$ placeholders) |
| `wizardAnswers` | object[] | No | Wizard mode Q&A state (question, answer pairs) |
| `wizardLastQuestion` | string | No | Wizard mode: last question asked |
| `wizardLastChoices` | object[] | No | Wizard mode: last choices offered |
| `friendsPhase` | FriendsPhase | No | Friends mode: current phase |
| `friendsProposedCharacterIds` | string[] | No | Friends mode: AI-proposed character IDs |
| `friendsSelectedCharacterIds` | string[] | No | Friends mode: child-confirmed character IDs |
| `friendsScenarios` | FriendsScenario[] | No | Friends mode: generated scenario options |
| `friendsSelectedScenarioId` | string | No | Friends mode: selected scenario ID |
| `friendsSynopses` | FriendsSynopsis[] | No | Friends mode: generated synopsis options |
| `friendsSelectedSynopsisId` | string | No | Friends mode: selected synopsis ID |
| `progress` | object | No | Phase completion timestamps |
| `createdAt` | timestamp | Yes | Creation time |
| `updatedAt` | timestamp | Yes | Last update time |

**Subcollections**:
- `messages/{messageId}` - Chat messages (see `ChatMessage` type)
- `events/{eventId}` - Session analytics events

**Security**: Parents can CRUD their own sessions; admins have full access.

---

### `stories`

Compiled story content.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | Yes | Document ID |
| `storySessionId` | string | Yes | Source session ID |
| `childId` | string | Yes | Child's document ID |
| `parentUid` | string | Yes | Parent's Firebase UID |
| `storyText` | string | Yes | Full story text |
| `storyMode` | string | No | Story generator ID that created this story (copied from session) |
| `metadata` | object | No | Title, vibe, paragraphs, characterIds, etc. |
| `status` | 'text_ready' \| 'images_pending' | No | Story status |
| `titleGeneration` | object | No | Title generation status |
| `synopsis` | string | No | AI-generated synopsis |
| `actors` | string[] | No | Actor IDs used in story |
| `actorAvatarUrl` | string | No | Composite avatar URL |
| `audioGeneration` | object | No | Audio generation status |
| `audioUrl` | string | No | Full audio narration URL |
| `audioMetadata` | object | No | Audio file metadata |
| `selectedImageStyleId` | string | No | Image style ID |
| `selectedImageStylePrompt` | string | No | Image style prompt |
| `deletedAt` | timestamp | No | Soft delete timestamp |
| `deletedBy` | string | No | UID of user who deleted |
| `createdAt` | timestamp | Yes | Creation time |
| `updatedAt` | timestamp | Yes | Last update time |

**Subcollections**:
- `storybooks/{storybookId}` - Storybook outputs (see below)
- `storybooks/{storybookId}/pages/{pageId}` - Storybook pages (see `StoryOutputPage`)
- `shareTokens/{tokenId}` - Share links (see `StoryBookShareToken`)

**Security**: Parents can CRUD their own stories; admins have full access.

---

### `stories/{storyId}/storybooks/{storybookId}` (Subcollection)

A specific rendering of a story with output type, image style, and layout.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | Yes | Document ID |
| `storyId` | string | Yes | Parent story ID |
| `childId` | string | Yes | Child ID |
| `parentUid` | string | Yes | Parent's Firebase UID |
| `storyOutputTypeId` | string | Yes | Output type (e.g., "picture-book") |
| `imageStyleId` | string | Yes | Image style ID |
| `imageStylePrompt` | string | Yes | Style prompt for image generation |
| `printLayoutId` | string | No | Print layout ID (determines image dimensions) |
| `imageWidthPx` | number | No | Width in pixels (layoutWidth × 300 DPI) |
| `imageHeightPx` | number | No | Height in pixels (layoutHeight × 300 DPI) |
| `pageGeneration` | object | Yes | Page generation status |
| `imageGeneration` | object | Yes | Image generation status |
| `exemplarGeneration` | object | No | Character exemplar generation status |
| `actorExemplarUrls` | map | No | Map of actorId → exemplar image URL |
| `isFinalized` | boolean | No | Whether book is finalized |
| `isLocked` | boolean | No | Whether book is locked for edits |
| `finalization` | StoryBookFinalization | No | Finalization/print details |
| `title` | string | No | Override story title |
| `thumbnailUrl` | string | No | Cached cover image URL for fast list loading |
| `deletedAt` | timestamp | No | Soft delete timestamp |
| `deletedBy` | string | No | UID of user who deleted |
| `createdAt` | timestamp | Yes | Creation time |
| `updatedAt` | timestamp | Yes | Last update time |

**Security**: Parents can CRUD their own storybooks; admins have full access.

---

### `stories/{storyId}/shareTokens/{tokenId}` (Subcollection)

Share tokens for public storybook viewing.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | Yes | Share token ID (8-char hex) |
| `storyId` | string | Yes | Parent story ID |
| `storybookId` | string | No | Storybook ID (new model only) |
| `status` | 'active' \| 'revoked' \| 'expired' | Yes | Token status |
| `createdAt` | timestamp | Yes | Creation time |
| `createdBy` | string | Yes | UID of creator |
| `expiresAt` | timestamp | No | Expiration time |
| `requiresPasscode` | boolean | Yes | Whether passcode is required |
| `tokenHash` | string | No | SHA256 hash of passcode |
| `tokenSalt` | string | No | Salt for hash |
| `passcodeHint` | string | No | Last 2 chars of passcode |
| `finalizationVersion` | number | Yes | Storybook version when shared |
| `viewCount` | number | No | Number of views |
| `lastViewedAt` | timestamp | No | Last view time |
| `revokedAt` | timestamp | No | Revocation time |
| `revokedBy` | string | No | UID of revoker |

**Security**: Accessible via public API endpoint with validation; parents can create/revoke for their own stories.

---

### `storyBooks` (Legacy)

Compiled storybooks. **Note**: New data uses `stories/{storyId}/storybooks` subcollection.

See `LegacyStoryWithOutput` type for field definitions.

---

### `printStoryBooks`

Print-ready storybook configurations.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | Yes | Document ID |
| `ownerUserId` | string | Yes | Owner's Firebase UID |
| `storyId` | string | Yes | Source story ID |
| `storybookId` | string | No | Source storybook ID (new model) |
| `title` | string | Yes | Book title |
| `childName` | string | No | Child's name |
| `printLayoutId` | string | Yes | Print layout ID |
| `pages` | PrintStoryBookPage[] | Yes | Page configurations |
| `pdfStatus` | 'draft' \| 'generating_pdfs' \| 'ready' \| 'error' | Yes | PDF generation status |
| `coverPdfUrl` | string | No | Cover PDF URL |
| `interiorPdfUrl` | string | No | Interior PDF URL |
| `combinedPdfUrl` | string | No | Combined PDF URL |
| `printableMetadata` | PrintableAssetMetadata | No | Print metadata |
| `pdfGenerationWarnings` | string[] | No | Warnings from PDF generation (truncation, padding) |
| `createdAt` | timestamp | Yes | Creation time |
| `updatedAt` | timestamp | Yes | Last update time |

**PrintableAssetMetadata** (embedded object):

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `dpi` | number | Yes | PDF resolution (e.g., 300) |
| `trimSize` | string | Yes | Page dimensions (e.g., "8in x 10in") |
| `pageCount` | number | Yes | Total pages in PrintStoryBook |
| `coverPageCount` | number | Yes | Cover pages (2 for hardcover) |
| `interiorPageCount` | number | Yes | Total pages in interior PDF (content + padding) |
| `spreadCount` | number | Yes | Number of spreads |
| `printLayoutId` | string | No | Print layout used |
| `hasSeparatePDFs` | boolean | No | True if cover/interior are separate |
| `paddingPageCount` | number | No | Blank pages added to meet Mixam requirements |
| `contentPageCount` | number | No | Actual content pages (before padding) |

**Security**: Users can CRUD their own printStoryBooks; admins have full access.

---

### `printOrders`

Print fulfillment orders.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | Yes | Document ID |
| `parentUid` | string | Yes | Parent's Firebase UID |
| `storyId` | string | Yes | Source story ID |
| `outputId` | string | Yes | Output ID |
| `version` | number | Yes | Order version |
| `printProductId` | string | Yes | Print product ID |
| `productSnapshot` | PrintProduct | Yes | Frozen product config |
| `quantity` | number | Yes | Order quantity |
| `trimSize` | object | Yes | Width, height, label |
| `pageCount` | number | Yes | Total pages |
| `shippingAddress` | PrintOrderAddress | Yes | Shipping address |
| `contactEmail` | string | Yes | Contact email |
| `paymentStatus` | 'unpaid' \| 'paid' \| 'refunded' | Yes | Payment status |
| `fulfillmentStatus` | MixamOrderStatus | Yes | Fulfillment status |
| `approvalStatus` | 'pending' \| 'approved' \| 'rejected' | Yes | Admin approval |
| `mixamOrderId` | string | No | Mixam order ID |
| `mixamJobNumber` | string | No | Mixam job number |
| `mixamStatus` | string | No | Raw Mixam status from webhook |
| `mixamArtworkComplete` | boolean | No | Whether artwork processing is complete |
| `mixamHasErrors` | boolean | No | Whether there are artwork errors |
| `mixamStatusReason` | string | No | Reason for current Mixam status |
| `mixamArtworkErrors` | array | No | Detailed artwork errors [{itemId, filename, page, message}] |
| `mixamTrackingUrl` | string | No | Shipment tracking URL |
| `mixamTrackingNumber` | string | No | Consignment/tracking number |
| `mixamCarrier` | string | No | Shipping carrier name |
| `mixamParcelNumbers` | string[] | No | Array of parcel numbers |
| `mixamShipmentDate` | string | No | Shipment date |
| `mixamShipments` | array | No | Full shipments array from webhook |
| `lastWebhookPayload` | object | No | Last webhook payload (for debugging) |
| `lastWebhookAt` | timestamp | No | Timestamp of last webhook received |
| `statusHistory` | array | Yes | Status change history |
| `processLog` | array | No | Detailed event log |
| `mixamInteractions` | MixamInteraction[] | No | API request/response and webhook log |
| `createdAt` | timestamp | Yes | Creation time |
| `updatedAt` | timestamp | Yes | Last update time |
| `cancelledAt` | timestamp | No | Cancellation timestamp |
| `cancellationReason` | string | No | Reason for cancellation |
| `cancelledBy` | string | No | Admin UID who cancelled |

**MixamInteraction** (embedded object):

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | Yes | Unique interaction ID (mxi_*) |
| `timestamp` | string | Yes | ISO timestamp |
| `type` | 'api_request' \| 'api_response' \| 'webhook' | Yes | Interaction type |
| `method` | 'GET' \| 'POST' \| 'PUT' \| 'DELETE' | No | HTTP method (for API calls) |
| `endpoint` | string | No | API endpoint path |
| `requestBody` | any | No | Sanitized request payload |
| `statusCode` | number | No | HTTP status code (for responses) |
| `responseBody` | any | No | Sanitized response payload |
| `durationMs` | number | No | Request duration in milliseconds |
| `error` | string | No | Error message if failed |
| `webhookEvent` | string | No | Webhook event type (for webhooks) |
| `webhookPayload` | any | No | Webhook payload |
| `action` | string | No | Human-readable action name |
| `orderId` | string | No | Mixam order ID |

**Security**: Parents can read their own orders; admins have full CRUD.

---

### `printProducts`

Print product catalog.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | Yes | Document ID |
| `name` | string | Yes | Product name |
| `description` | string | Yes | Product description |
| `active` | boolean | Yes | Product availability |
| `blankPages` | number | Yes | Fixed blank pages (e.g., endpapers). Default: 0 |
| `spine` | boolean | Yes | Whether cover PDF includes spine page. Default: true |
| `mixamSpec` | object | Yes | Mixam MxJdf specifications |
| `pricingTiers` | array | Yes | Pricing tiers |
| `shippingCost` | object | Yes | Shipping rates |
| `displayOrder` | number | Yes | Display order |
| `createdAt` | timestamp | Yes | Creation time |
| `updatedAt` | timestamp | Yes | Last update time |

**Page Composition**: The `blankPages` and `spine` fields control PDF generation:
- `blankPages`: Number of fixed blank pages (e.g., front/back endpapers). These are counted in the total page count but not included in the interior PDF.
- `spine`: If true, cover PDF includes front cover + spine + back cover. If false, cover PDF is just front + back.
- Total pages = 2 (cover) + blankPages + interior pages. Must be a multiple of 4.

**Security**: Read by authenticated users; write by admins only.

---

### `promptConfigs`

AI prompt templates for story generation.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | Yes | Document ID |
| `phase` | string | Yes | 'warmup' \| 'storyBeat' \| 'ending' |
| `levelBand` | string | Yes | 'low' \| 'mid' \| 'high' |
| `languageCode` | string | Yes | Language code (e.g., 'en-US') |
| `version` | number | Yes | Config version |
| `status` | 'draft' \| 'live' | Yes | Config status |
| `systemPrompt` | string | Yes | System prompt text |
| `modeInstructions` | string | No | Mode-specific instructions |
| `allowedChatMoves` | string[] | No | Allowed chat moves |
| `model` | object | No | Model name, temperature, maxOutputTokens |

**Security**: Read/write by writers and admins.

---

### `storyPhases`

Story workflow phases.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | Yes | Document ID |
| `name` | string | Yes | Phase name |
| `phaseType` | 'warmup' \| 'storyBeat' \| 'ending' | Yes | Phase type |
| `description` | string | Yes | Phase description |
| `choiceCount` | number | Yes | Number of choices |
| `allowMore` | boolean | Yes | Allow "more options" |
| `status` | 'live' \| 'draft' | Yes | Phase status |
| `orderIndex` | number | Yes | Display order |

**Security**: Read/write by writers and admins.

---

### `storyTypes`

Story format types (Adventure, Mystery, etc.).

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | Yes | Document ID |
| `name` | string | Yes | Story type name |
| `shortDescription` | string | Yes | Brief description |
| `ageFrom` | number | No | Minimum age |
| `ageTo` | number | No | Maximum age |
| `status` | 'live' \| 'draft' | Yes | Type status |
| `tags` | string[] | Yes | Category tags |
| `arcTemplate` | object | Yes | Arc steps configuration |
| `promptConfig` | StoryTypePromptConfig | No | Prompt configuration |
| `levelBandOverrides` | object | No | Age-appropriate adjustments |
| `backgroundMusic` | object | No | Background music for story generation |
| `backgroundMusic.prompt` | string | No | AI prompt for music generation |
| `backgroundMusic.audioUrl` | string | No | Firebase Storage URL for music |
| `backgroundMusic.storagePath` | string | No | Storage path for management |
| `backgroundMusic.durationMs` | number | No | Duration in milliseconds |
| `backgroundMusic.generation` | object | No | Generation status tracking |
| `backgroundMusic.generation.status` | 'idle' \| 'pending' \| 'generating' \| 'ready' \| 'error' | No | Generation status |
| `backgroundMusic.generation.lastRunAt` | timestamp | No | Last generation attempt |
| `backgroundMusic.generation.lastCompletedAt` | timestamp | No | Last successful generation |
| `backgroundMusic.generation.lastErrorMessage` | string | No | Error message if failed |
| `version` | number | No | Config version |
| `createdAt` | timestamp | No | Creation time |
| `updatedAt` | timestamp | No | Last update time |

**Security**: Read/write by writers and admins.

---

### `storyGenerators`

Story generator configurations. Defines capabilities and API endpoints for each story generation mode (wizard, gemini3, gemini4, beat, friends). The `StoryBrowser` component uses these documents to adapt its UI to each generator's capabilities. The `/story/start` page queries this collection to display available generators (filtered by `status='live'` and `enabledForKids=true`).

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | Yes | Document ID (e.g., 'wizard', 'gemini3', 'gemini4', 'beat') |
| `name` | string | Yes | Display name (e.g., 'Story Wizard') |
| `description` | string | Yes | Description for admin UI |
| `status` | 'live' \| 'draft' \| 'archived' | Yes | Generator status |
| `order` | number | No | Display order on story creation pages (lower = first, default: 0) |
| `enabledForKids` | boolean | No | Show this generator in kids story creation flow (default: true) |
| `capabilities.minChoices` | number | Yes | Minimum choices per question |
| `capabilities.maxChoices` | number | Yes | Maximum choices per question |
| `capabilities.supportsMoreOptions` | boolean | Yes | Can request additional choices |
| `capabilities.supportsCharacterIntroduction` | boolean | Yes | Can introduce new characters |
| `capabilities.supportsFinalStory` | boolean | Yes | Generates final compiled story |
| `capabilities.requiresStoryType` | boolean | Yes | Needs story type selection first |
| `apiEndpoint` | string | Yes | API route path (e.g., '/api/storyWizard') |
| `styling.gradient` | string | Yes | Tailwind gradient classes |
| `styling.darkGradient` | string | No | Dark mode gradient classes |
| `styling.icon` | string | No | Lucide icon name or URL |
| `styling.loadingMessage` | string | Yes | Message shown during generation |
| `backgroundMusic.prompt` | string | No | AI prompt for music generation |
| `backgroundMusic.audioUrl` | string | No | Firebase Storage URL for music |
| `backgroundMusic.storagePath` | string | No | Storage path for file management |
| `backgroundMusic.durationMs` | number | No | Music duration in milliseconds |
| `backgroundMusic.generation.status` | 'idle' \| 'generating' \| 'ready' \| 'error' | No | Music generation status |
| `backgroundMusic.generation.lastRunAt` | timestamp | No | Last generation attempt |
| `backgroundMusic.generation.lastCompletedAt` | timestamp | No | Last successful generation |
| `backgroundMusic.generation.lastErrorMessage` | string | No | Error message if failed |
| `prompts` | Record<string, string> | No | Custom AI prompts (keys vary by generator) |
| `defaultModel` | AIModelName | No | Default AI model for this generator |
| `defaultTemperature` | number | No | Default temperature (0.0-2.0) for this generator |
| `promptConfig` | Record<string, PromptConfig> | No | Per-prompt model and temperature overrides |
| `promptConfig.[key].model` | AIModelName | No | AI model for this specific prompt |
| `promptConfig.[key].temperature` | number | No | Temperature for this specific prompt |
| `createdAt` | timestamp | No | Creation time |
| `updatedAt` | timestamp | No | Last update time |

**AIModelName Values**: `'googleai/gemini-2.5-pro'`, `'googleai/gemini-2.5-flash'`, `'googleai/gemini-2.0-flash'`

**Prompts Keys by Generator**:
- **wizard**: `questionGeneration`, `storyGeneration`
- **gemini3**: `systemPrompt`
- **gemini4**: `systemPrompt`, `phase_opening`, `phase_setting`, `phase_characters`, `phase_conflict`, `phase_action`, `phase_resolution`, `phase_development`
- **friends**: `characterProposal`, `scenarioGeneration`, `synopsisGeneration`, `storyGeneration`

**Standard API Response Format**: All generators must return `StoryGeneratorResponse` (see `src/lib/types.ts`).

**Security**: Read by all authenticated users; write by admins only.

---

### `storyOutputTypes`

Output format definitions (Picture Book, Poem, etc.).

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | Yes | Document ID |
| `name` | string | Yes | Output type name |
| `status` | 'live' \| 'draft' \| 'archived' | Yes | Type status |
| `ageRange` | string | Yes | Target age range |
| `shortDescription` | string | Yes | Brief description |
| `childFacingLabel` | string | Yes | Child-friendly label |
| `category` | 'picture_book' \| 'poem' \| 'coloring_pages' \| 'audio_script' | Yes | Output category |
| `defaultPrintLayoutId` | string | No | Print layout ID - determines image dimensions for storybooks |
| `imageUrl` | string | No | Display image URL shown to children when selecting book type |
| `imagePrompt` | string | No | AI prompt for generating the display image |
| `layoutHints` | object | No | Page count, aspect ratio hints |
| `aiHints` | object | No | AI generation hints |
| `paginationPrompt` | string | No | Pagination prompt |
| `tags` | string[] | Yes | Category tags |

**Security**: Read/write by writers and admins.

---

### `printLayouts`

Print layout templates.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | Yes | Document ID |
| `name` | string | Yes | Layout name |
| `leafWidth` | number | Yes | Leaf width in inches |
| `leafHeight` | number | Yes | Leaf height in inches |
| `leavesPerSpread` | 1 \| 2 | Yes | Pages per spread |
| `font` | string | No | Font family |
| `fontSize` | number | No | Font size in points |
| `coverLayout` | PageLayoutConfig | No | Front cover config |
| `backCoverLayout` | PageLayoutConfig | No | Back cover config |
| `insideLayout` | PageLayoutConfig | No | Interior pages config |
| `titlePageLayout` | PageLayoutConfig | No | Title page config |
| `printProductId` | string | No | Link to PrintProduct for trim size and default constraints |
| `pageConstraints` | PrintLayoutPageConstraints | No | Page count constraints (overrides product defaults) |
| `createdAt` | timestamp | No | Creation time |
| `updatedAt` | timestamp | No | Last update time |

**PageLayoutConfig** (embedded object for coverLayout, backCoverLayout, insideLayout, titlePageLayout):

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `textBoxEnabled` | boolean | No | Whether to show text box on this page type (default: true) |
| `imageBoxEnabled` | boolean | No | Whether to show image box on this page type (default: true) |
| `textBox` | TextLayoutBox | No | Text box configuration |
| `imageBox` | PageLayoutBox | No | Image box configuration |

**PageLayoutBox** (embedded object):

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `leaf` | 1 \| 2 | No | Which leaf in a spread (1=left/first, 2=right/second). Only used for insideLayout with leavesPerSpread=2 |
| `x` | number | No | X position in inches from left edge of leaf |
| `y` | number | No | Y position in inches from top edge of leaf |
| `width` | number | No | Width in inches |
| `height` | number | No | Height in inches |

**TextLayoutBox** (extends PageLayoutBox):

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `backgroundColor` | string | No | Hex color for background (e.g., '#F5F5DC') |
| `textColor` | string | No | Hex color for text |
| `borderRadius` | number | No | Corner radius in inches |

**PrintLayoutPageConstraints** (embedded object):

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `minPages` | number | No | Minimum content pages (excluding covers) |
| `maxPages` | number | No | Maximum content pages |
| `pageMultiple` | 1 \| 2 \| 4 | No | Pages must be divisible by this (1=any, 2=even, 4=multiple of 4) |

**Security**: Read/write by writers and admins.

---

### `imageStyles`

Art style configurations for image generation.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | Yes | Document ID |
| `title` | string | Yes | Style title |
| `description` | string | Yes | Style description |
| `ageRange` | string | Yes | Target age range |
| `ageFrom` | number | No | Minimum age |
| `ageTo` | number | No | Maximum age |
| `stylePrompt` | string | Yes | Image generation prompt |
| `sampleDescription` | string | Yes | Sample image description |
| `sampleImageUrl` | string | No | Sample image URL |
| `exampleImages` | array | No | Example images for AI style reference |
| `preferred` | boolean | No | If true, shown first in child-facing selection (sorted alphabetically within preferred/non-preferred groups) |
| `createdAt` | timestamp | Yes | Creation time |
| `updatedAt` | timestamp | Yes | Last update time |

**exampleImages array item structure:**
| Field | Type | Description |
|-------|------|-------------|
| `id` | string | UUID for deletion |
| `url` | string | Firebase Storage URL |
| `storagePath` | string | Storage path for deletion |
| `uploadedAt` | timestamp | Upload time |

**Security**: Admin only for writes; authenticated users can read.

---

### `exemplars`

Actor reference sheets for consistent character depiction in storybook images. Each exemplar shows front/side/back views of a character in a specific art style.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | Yes | Document ID |
| `actorId` | string | Yes | Child or character document ID |
| `actorType` | 'child' \| 'character' | Yes | Type of actor |
| `imageStyleId` | string | Yes | Style this exemplar was generated for |
| `imageUrl` | string | No | Firebase Storage URL (set when ready) |
| `storagePath` | string | No | Storage path for cleanup |
| `status` | 'pending' \| 'generating' \| 'ready' \| 'error' | Yes | Generation status |
| `lastErrorMessage` | string | No | Error message if status is 'error' |
| `ownerParentUid` | string | Yes | Parent's Firebase UID (for cleanup queries) |
| `usedByStorybookIds` | string[] | No | Storybook IDs that reference this exemplar |
| `createdAt` | timestamp | Yes | Creation time |
| `updatedAt` | timestamp | Yes | Last update time |

**Usage**: Exemplars are generated before storybook images and provide consistent character appearance. They are keyed by actorId + imageStyleId combination.

**Cleanup**: Admin processes can query by `ownerParentUid` or `createdAt` to delete old exemplars.

**Security**: Created by system during storybook generation; readable by owner; admin full access.

---

### `systemConfig`

System-wide configuration documents.

#### `systemConfig/diagnostics`
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `showDiagnosticsPanel` | boolean | Yes | Show diagnostic cards |
| `enableClientLogging` | boolean | Yes | Enable browser console logs |
| `enableServerLogging` | boolean | Yes | Enable server-side logs |
| `enableAIFlowLogging` | boolean | Yes | Enable AI flow logging |
| `showApiDocumentation` | boolean | Yes | Expose API docs at /api-documentation |
| `enableMixamWebhookLogging` | boolean | Yes | Enable Mixam webhook debug logging |
| `showReportIssueButton` | boolean | Yes | Show "Report Issue" button in header for all users |
| `elevenLabsApiVersion` | 'v2' \| 'v3' | Yes | ElevenLabs TTS model version. v2=eleven_multilingual_v2 (stable), v3=eleven_v3 (expressive). Default: v3 |
| `updatedAt` | timestamp | No | Last update time |
| `updatedBy` | string | No | Email of last updater |

#### `systemConfig/prompts`
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `globalPrefix` | string | Yes | Global prompt prefix |
| `enabled` | boolean | Yes | Enable global prefix |
| `updatedAt` | timestamp | No | Last update time |
| `updatedBy` | string | No | Email of last updater |

#### `systemConfig/compile-prompt`
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `compilePrompt` | string | Yes | Compile prompt text |
| `enabled` | boolean | Yes | Enable compile prompt |
| `updatedAt` | timestamp | No | Last update time |
| `updatedBy` | string | No | Email of last updater |

#### `systemConfig/paginationPrompt`
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `paginationPrompt` | string | Yes | Default pagination prompt for dividing stories into pages |
| `enabled` | boolean | Yes | When true, use custom prompt; when false, use hardcoded default |
| `updatedAt` | timestamp | No | Last update time |
| `updatedBy` | string | No | Email of last updater |

#### `systemConfig/imagePrompt`
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `imagePrompt` | string | Yes | Global prompt prepended to all image generation requests |
| `enabled` | boolean | Yes | When true, use custom prompt; when false, no global prefix |
| `updatedAt` | timestamp | No | Last update time |
| `updatedBy` | string | No | Email of last updater |

#### `systemConfig/kids-flows`
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `wizardEnabled` | boolean | Yes | Enable wizard flow |
| `chatEnabled` | boolean | Yes | Enable chat flow |
| `gemini3Enabled` | boolean | Yes | Enable Gemini 3 flow |
| `gemini4Enabled` | boolean | Yes | Enable Gemini 4 flow |
| `friendsEnabled` | boolean | Yes | Enable "Fun with my friends" flow |
| `updatedAt` | timestamp | No | Last update time |
| `updatedBy` | string | No | Email of last updater |

#### `systemConfig/email`
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `senderEmail` | string | Yes | From email address (must be valid in M365 tenant) |
| `senderName` | string | No | Display name for sender |
| `footerText` | string | Yes | Footer text for all emails |
| `brandColor` | string | No | Hex color for buttons/accents (e.g., '#2563eb') |
| `templates` | object | Yes | Per-template configuration (see EmailTemplate) |
| `updatedAt` | timestamp | No | Last update time |
| `updatedBy` | string | No | Email of last updater |

**EmailTemplate structure** (one per template type):
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `enabled` | boolean | Yes | Whether this email type is active |
| `subject` | string | Yes | Subject line (supports {{orderId}}, {{status}} placeholders) |
| `heading` | string | Yes | Main heading in email body |
| `bodyText` | string | Yes | Intro paragraph text |
| `buttonText` | string | Yes | Call-to-action button text |
| `buttonUrl` | string | No | Custom button URL (defaults to admin order page) |

Template types: `orderSubmitted`, `orderStatusChanged`, `orderApproved`, `orderRejected`, `orderCancelled`, `testEmail`, `maintenanceError`

**maintenanceError placeholders**: `{{flowName}}`, `{{errorType}}`, `{{errorMessage}}`, `{{errorMessageSnippet}}`

- `{{errorMessage}}` - The full error message
- `{{errorMessageSnippet}}` - First 5 words of the error message followed by ellipsis (e.g., "Failed to generate image for...")

**Security**: Admin only.

#### `systemConfig/voice`
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `voiceRecordingText` | string | Yes | Script text displayed to parents when recording a family voice clone |
| `updatedAt` | timestamp | No | Last update time |
| `updatedBy` | string | No | Email of last updater |

**Security**: Read by authenticated users; write by admin only.

#### `systemConfig/aiModels`
Centralized configuration for AI model selections across the application.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `imageGenerationModel` | string | Yes | Model for image generation (e.g., 'googleai/gemini-2.5-flash-image') |
| `primaryTextModel` | string | Yes | Primary text model for complex tasks (e.g., 'googleai/gemini-2.5-pro') |
| `lightweightTextModel` | string | Yes | Lightweight text model for simple tasks (e.g., 'googleai/gemini-2.5-flash') |
| `legacyTextModel` | string | Yes | Legacy model for specific use cases (e.g., 'googleai/gemini-2.0-flash') |
| `availabilityCheck` | object | No | Last model availability check result |
| `availabilityCheck.lastCheckedAt` | timestamp | No | When availability was last checked |
| `availabilityCheck.status` | 'ok' \| 'warning' \| 'error' | No | Overall availability status |
| `availabilityCheck.issues` | array | No | List of issues found during check |
| `updatedAt` | timestamp | No | Last update time |
| `updatedBy` | string | No | Email of last updater |

**Defaults** (if document doesn't exist):
- `imageGenerationModel`: 'googleai/gemini-2.5-flash-image'
- `primaryTextModel`: 'googleai/gemini-2.5-pro'
- `lightweightTextModel`: 'googleai/gemini-2.5-flash'
- `legacyTextModel`: 'googleai/gemini-2.0-flash'

**Security**: Admin only.

#### `systemConfig/addresses`
System addresses for Mixam billing configuration.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `addresses` | SavedAddress[] | Yes | Array of system addresses |
| `mixamBillToAddressId` | string | No | ID of address to use for Mixam billing |
| `updatedAt` | timestamp | No | Last update time |
| `updatedBy` | string | No | Email of last updater |

**Usage**: When submitting orders to Mixam, the selected `mixamBillToAddressId` address is used for `billingAddress` and `invoiceAddress` fields. The parent's shipping address is used for delivery.

**Security**: Admin only.

---

### `shareLinks`

Lookup collection for share link → story mapping. Used by the share API to find stories without requiring a collectionGroup query (which would need a Firestore index).

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `storyId` | string | Yes | Story document ID |
| `storybookId` | string | No | Storybook subcollection doc ID (new model only) |
| `createdAt` | timestamp | Yes | When the share link was created |

**Note**: Document ID is the shareId (8 hex characters).

**Security**: Server-only - no client access. All operations use Firebase Admin SDK.

---

### `aiFlowLogs`

AI generation audit logs.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | Yes | Document ID |
| `flowName` | string | Yes | AI flow name |
| `status` | 'success' \| 'error' | Yes | Execution status |
| `sessionId` | string | No | Session ID |
| `parentId` | string | No | Parent UID |
| `prompt` | string | Yes | Input prompt |
| `response` | object | No | Response text, finishReason, model |
| `usage` | object | No | Token usage |
| `latencyMs` | number | No | Execution time |
| `errorMessage` | string | No | Error message if failed |
| `createdAt` | timestamp | Yes | Creation time |

**Security**: Admin read/write only.

---

### `aiRunTraces`

Detailed AI call traces per session.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `sessionId` | string | Yes | Session ID |
| `parentUid` | string | Yes | Parent UID |
| `childId` | string | No | Child ID |
| `storyTypeId` | string | No | Story type ID |
| `storyTypeName` | string | No | Story type name |
| `startedAt` | timestamp | Yes | Trace start time |
| `lastUpdatedAt` | timestamp | Yes | Last update time |
| `status` | 'in_progress' \| 'completed' \| 'error' | Yes | Trace status |
| `calls` | AICallTrace[] | Yes | Individual call traces |
| `summary` | object | Yes | Aggregated statistics |

**Security**: Admin only.

---

### `helpWizards`

In-app help wizard configurations.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | Yes | Document ID |
| `title` | string | Yes | Wizard title |
| `pages` | HelpWizardPage[] | Yes | Wizard pages |
| `status` | 'draft' \| 'live' | Yes | Wizard status |
| `role` | 'parent' \| 'writer' \| 'admin' | Yes | Target audience (parents see parent, writers see parent+writer, admins see all) |
| `order` | number | Yes | Display order |
| `isDefaultStartup` | boolean | No | If true, this wizard auto-starts for new users |
| `createdAt` | timestamp | Yes | Creation time |
| `updatedAt` | timestamp | Yes | Last update time |

**Security**: Read/write by writers and admins; help-* docs readable by authenticated users.

---

### `answerAnimations`

CSS animations and sound effects for Q&A answer cards. Used during story creation to animate non-selected answers off screen and celebrate the selected answer.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | Yes | Document ID (e.g., 'exit-slide-left', 'selection-celebrate') |
| `name` | string | Yes | Display name (e.g., 'Slide Left') |
| `type` | 'exit' \| 'selection' | Yes | Animation purpose ('exit' for non-selected, 'selection' for chosen) |
| `cssKeyframes` | string | Yes | CSS @keyframes definition |
| `cssAnimationName` | string | Yes | Name of the animation in @keyframes |
| `durationMs` | number | Yes | Animation duration in milliseconds (default: 500) |
| `easing` | string | Yes | CSS easing function (default: 'ease-out') |
| `isActive` | boolean | Yes | Whether this animation is available for use |
| `order` | number | Yes | Display order in admin |
| `soundEffect.prompt` | string | No | ElevenLabs SFX prompt |
| `soundEffect.durationSeconds` | number | No | Sound duration (0.5-30 seconds) |
| `soundEffect.promptInfluence` | number | No | ElevenLabs prompt influence (0-1) |
| `soundEffect.audioUrl` | string | No | Firebase Storage URL for generated audio |
| `soundEffect.storagePath` | string | No | Storage path for cleanup |
| `soundEffect.generation.status` | 'idle' \| 'generating' \| 'ready' \| 'error' | No | Generation status |
| `soundEffect.generation.lastRunAt` | timestamp | No | Last generation attempt |
| `soundEffect.generation.lastCompletedAt` | timestamp | No | Last successful generation |
| `soundEffect.generation.lastErrorMessage` | string | No | Error message if failed |
| `createdAt` | timestamp | Yes | Creation time |
| `updatedAt` | timestamp | Yes | Last update time |

**Animation Types**:
- **exit**: For non-selected answer cards - randomly chosen to animate cards off screen
- **selection**: For the chosen answer - celebrates then exits to the right

**Security**: Read by authenticated users; write by writers and admins.

---

### `devTodos`

Development todo items for tracking work that should be done for a production-ready system. Both admins and Claude can add items to this list via the admin dashboard or API.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | Yes | Document ID |
| `title` | string | Yes | Short description of the work item |
| `description` | string | No | Detailed description (supports Markdown) |
| `status` | 'pending' \| 'in_progress' \| 'partial' \| 'completed' | Yes | Current status |
| `priority` | 'low' \| 'medium' \| 'high' | Yes | Priority level |
| `partialComment` | string | No | Comment when status is 'partial' explaining what remains |
| `createdBy` | 'admin' \| 'claude' | Yes | Who created this item |
| `createdByEmail` | string | No | Email of admin who created (if admin) |
| `completedBy` | 'admin' \| 'claude' | No | Who completed this item |
| `completedByEmail` | string | No | Email of admin who completed (if admin) |
| `completionSummary` | string | No | Summary of what was done when completing the item |
| `commitId` | string | No | Git commit ID for the completion (if applicable) |
| `category` | string | No | Category (e.g., 'security', 'performance', 'UX', 'testing') |
| `relatedFiles` | string[] | No | Relevant file paths |
| `createdAt` | timestamp | Yes | Creation time |
| `updatedAt` | timestamp | Yes | Last update time |
| `completedAt` | timestamp | No | Completion time |

**Notes**:
- When reopening a completed item (setting status back to 'pending' or 'in_progress'), completion fields are cleared.
- The `completionSummary` field should contain a summary of what was accomplished, useful for audit trail.

**Security**: Admin only.

---

## Common Types

### `PrintOrderAddress`
```typescript
{
  name: string;
  line1: string;
  line2?: string;
  city: string;
  state: string;
  postalCode: string;
  country: string;
}
```

### `SavedAddress`
Extends `PrintOrderAddress` with metadata for address book management.
```typescript
{
  id: string;
  name: string;
  line1: string;
  line2?: string;
  city: string;
  state: string;
  postalCode: string;
  country: string;
  label?: string;        // "Home", "Work", "Grandma's"
  isDefault?: boolean;
  createdAt: timestamp;
  updatedAt: timestamp;
}
```

### `Pronouns`
```typescript
'he/him' | 'she/her' | 'they/them'
```

### `ChatMessage`
```typescript
{
  id: string;
  sender: 'child' | 'assistant' | 'system';
  text: string;  // May contain $$id$$ placeholders - resolve with useResolvePlaceholders hook
  createdAt: any;
  kind?: string; // Message type
  options?: Choice[];  // May contain $$id$$ placeholders
  selectedOptionId?: string; // Selected choice
}
```

### `Choice`
```typescript
{
  id: string;
  text: string;
  value?: string;
  introducesCharacter?: boolean;
  newCharacterName?: string;
  newCharacterLabel?: string;
  newCharacterKind?: 'toy' | 'pet' | 'friend' | 'family';
  existingCharacterId?: string;
  avatarUrl?: string;
}
```

### `HelpWizardPage`
```typescript
{
  title: string;
  description: string;
  route: string;
  highlightSelector?: string;   // CSS selector for element to highlight
  wizardTargetId?: string;      // data-wiz-target attribute value (preferred)
  position?: HelpWizardPosition; // Card position on screen
  action?: 'click';             // Action to perform when advancing (clicks the highlighted element)
}
```

### `HelpWizardPosition`
```typescript
'top-left' | 'top-center' | 'top-right' |
'center-left' | 'center-center' | 'center-right' |
'bottom-left' | 'bottom-center' | 'bottom-right'
```

### `FriendsPhase`
```typescript
'character_selection' | 'scenario_selection' | 'synopsis_selection' | 'story_generation' | 'complete'
```

### `FriendsCharacterOption`
```typescript
{
  id: string;
  displayName: string;
  type: 'child' | 'sibling' | 'Family' | 'Friend' | 'Pet' | 'Toy' | 'Other';
  avatarUrl?: string;
  isSelected: boolean;
}
```

### `FriendsScenario`
```typescript
{
  id: string;
  title: string;
  description: string;
}
```

### `FriendsSynopsis`
```typescript
{
  id: string;
  title: string;
  summary: string;
}
```

---

## Security Rules Summary

| Collection | Read | Write | Notes |
|------------|------|-------|-------|
| `users` | Owner, Admin | Owner, Admin | |
| `children` | Owner, Admin | Owner, Admin | Soft-delete hidden from non-admins |
| `characters` | Owner, Admin | Owner, Admin | Soft-delete hidden from non-admins |
| `storySessions` | Owner, Admin | Owner, Admin | Including subcollections |
| `stories` | Owner, Admin | Owner, Admin | Including subcollections |
| `printOrders` | Owner, Admin | Owner (create), Admin (all) | |
| `printProducts` | Authenticated | Admin | |
| `promptConfigs` | Writer, Admin | Writer, Admin | |
| `storyPhases` | Writer, Admin | Writer, Admin | |
| `storyTypes` | Writer, Admin | Writer, Admin | |
| `storyOutputTypes` | Writer, Admin | Writer, Admin | |
| `printLayouts` | Writer, Admin | Writer, Admin | |
| `imageStyles` | Authenticated | Admin | |
| `systemConfig` | Admin | Admin | |
| `aiFlowLogs` | Admin | Admin | |
| `aiRunTraces` | Admin | Admin | |
| `helpWizards` | Writer, Admin | Writer, Admin | help-* readable by authenticated |
| `answerAnimations` | Authenticated | Writer, Admin | Q&A card animations |
| `devTodos` | Admin | Admin | Development work items |

---

## Version History

| Date | Changes |
|------|---------|
| 2026-01-17 | Added `devTodos` collection for development work tracking |
| 2026-01-14 | Added `textBoxEnabled`/`imageBoxEnabled` flags and `leaf` field to PageLayoutConfig for print layouts; Documented PageLayoutBox and TextLayoutBox types |
| 2026-01-13 | Added `users/{uid}/addresses` subcollection for saved shipping addresses; Added `systemConfig/addresses` for Mixam billing; Added `SavedAddress` common type |
| 2026-01-04 | Added "Fun with my friends" generator: FriendsPhase, FriendsScenario, FriendsSynopsis types, session fields, friends prompts, friendsEnabled config |
| 2026-01-02 | Removed deprecated fields: ChildProfile.speechModeEnabled, StorySession.finalStoryText, StorySession.storyTypeName, ChatMessage.textResolved/optionsResolved |
| 2025-12-29 | Initial documentation created |
