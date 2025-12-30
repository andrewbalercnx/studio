# Database Schema Documentation

> **Last Updated**: 2025-12-29 (added namePronunciation to characters for TTS)
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

**Subcollections**:
- `voices/{voiceId}` - Parent's cloned voices for TTS (see `ParentVoice` type)

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
| `ownerParentUid` | string | Yes | Parent's Firebase UID |
| `createdAt` | timestamp | Yes | Creation time |
| `updatedAt` | timestamp | No | Last update time |
| `namePronunciation` | string | No | Phonetic pronunciation for TTS |
| `preferredVoiceId` | string | No | Preferred TTS voice ID |
| `speechModeEnabled` | boolean | No | **Deprecated**: Use `autoReadAloud` instead |
| `autoReadAloud` | boolean | No | Enable TTS for stories (story creation & reader) |
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
| `currentPhase` | string | Yes | 'warmup' \| 'story' \| 'ending' \| 'final' \| 'wizard' \| 'gemini3' \| 'gemini4' \| 'completed' |
| `currentStepIndex` | number | Yes | Current step in flow |
| `storyTitle` | string | No | Story title |
| `storyVibe` | string | No | Story mood/vibe |
| `finalStoryText` | string | No | Compiled story text |
| `storyTypeId` | string | No | Selected story type |
| `storyTypeName` | string | No | Story type name |
| `arcStepIndex` | number | No | Current arc step |
| `mainCharacterId` | string | No | Main character ID |
| `supportingCharacterIds` | string[] | No | Supporting character IDs |
| `storyMode` | 'gemini3' \| 'gemini4' \| 'wizard' \| 'chat' | No | Story generation mode |
| `actors` | string[] | No | Actor IDs ($$id$$ placeholders) |
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
- `storybooks/{storybookId}` - Storybook outputs (see `StoryBookOutput`)
- `storybooks/{storybookId}/pages/{pageId}` - Storybook pages (see `StoryOutputPage`)
- `shareTokens/{tokenId}` - Share links (see `StoryBookShareToken`)

**Security**: Parents can CRUD their own stories; admins have full access.

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
| `printableMetadata` | object | No | Print metadata |
| `createdAt` | timestamp | Yes | Creation time |
| `updatedAt` | timestamp | Yes | Last update time |

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
| `statusHistory` | array | Yes | Status change history |
| `processLog` | array | No | Detailed event log |
| `createdAt` | timestamp | Yes | Creation time |
| `updatedAt` | timestamp | Yes | Last update time |

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
| `mixamSpec` | object | Yes | Mixam MxJdf specifications |
| `pricingTiers` | array | Yes | Pricing tiers |
| `shippingCost` | object | Yes | Shipping rates |
| `displayOrder` | number | Yes | Display order |
| `createdAt` | timestamp | Yes | Creation time |
| `updatedAt` | timestamp | Yes | Last update time |

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
| `createdAt` | timestamp | No | Creation time |
| `updatedAt` | timestamp | No | Last update time |

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
| `createdAt` | timestamp | Yes | Creation time |
| `updatedAt` | timestamp | Yes | Last update time |

**Security**: Admin only for writes; authenticated users can read.

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

#### `systemConfig/kids-flows`
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `wizardEnabled` | boolean | Yes | Enable wizard flow |
| `chatEnabled` | boolean | Yes | Enable chat flow |
| `gemini3Enabled` | boolean | Yes | Enable Gemini 3 flow |
| `gemini4Enabled` | boolean | Yes | Enable Gemini 4 flow |
| `updatedAt` | timestamp | No | Last update time |
| `updatedBy` | string | No | Email of last updater |

**Security**: Admin only.

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
| `createdAt` | timestamp | Yes | Creation time |
| `updatedAt` | timestamp | Yes | Last update time |

**Security**: Read/write by writers and admins; help-* docs readable by authenticated users.

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

### `Pronouns`
```typescript
'he/him' | 'she/her' | 'they/them'
```

### `ChatMessage`
```typescript
{
  id: string;
  sender: 'child' | 'assistant' | 'system';
  text: string;
  createdAt: any;
  kind?: string; // Message type
  options?: Choice[]; // Available choices
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

---

## Version History

| Date | Changes |
|------|---------|
| 2025-12-29 | Initial documentation created |
