# Schema Cleanup Plan

> **Created**: 2026-01-02
> **Status**: PROPOSED
> **Purpose**: Remove redundant fields and legacy structures to simplify the data model

This document outlines specific changes to remove redundant data storage and simplify the schema. Since legacy support is no longer required, we can be more aggressive with cleanup.

---

## Executive Summary

**Total fields to remove**: ~35+ across 6 collections
**Collections to deprecate**: 1 (`storyBooks` top-level)
**Types to remove**: 2 (`LegacyStoryWithOutput`, `StoryBook` alias)

---

## Phase 1: Resolved Text Fields (Low Risk, High Value)

### 1.1 ChatMessage - Remove Stored Resolved Text

**Collection**: `storySessions/{id}/messages`

**Fields to Remove**:
| Field | Purpose | Replacement |
|-------|---------|-------------|
| `textResolved` | Pre-resolved display text | Use `useResolvePlaceholders(text)` |
| `optionsResolved` | Pre-resolved options | Use `useResolvePlaceholders` on each option |

**Files to Modify**:

1. **Type Definition** - [src/lib/types.ts](../src/lib/types.ts):
```diff
export type ChatMessage = {
    id: string;
    sender: 'child' | 'assistant' | 'system';
    text: string;
    createdAt: any;
    role?: 'user' | 'model' | 'system' | 'tool';
    content?: string;
    kind?: '...' | '...';
    options?: Choice[];
-   optionsResolved?: Choice[];
    selectedOptionId?: string;
-   textResolved?: string;
};
```

2. **Stop Writing** - [src/app/story/play/[sessionId]/page.tsx](../src/app/story/play/%5BsessionId%5D/page.tsx):
   - Lines 242-255: Remove `textResolved` and `optionsResolved` from message writes
   - Lines 427-445: Same for gemini3 flow message writes

3. **Update Readers** to use dynamic resolution:
   - [src/app/story/session/[sessionId]/page.tsx](../src/app/story/session/%5BsessionId%5D/page.tsx)
   - [src/app/story/session/[sessionId]/compiled/page.tsx](../src/app/story/session/%5BsessionId%5D/compiled/page.tsx)

### 1.2 StoryOutputPage - Remove displayText

**Collection**: `stories/{storyId}/storybooks/{storybookId}/pages/{pageId}`

**Fields to Remove**:
| Field | Purpose | Replacement |
|-------|---------|-------------|
| `displayText` | Pre-resolved body text | Use `useResolvePlaceholders(bodyText)` |

**Files to Modify**:

1. **Type Definition** - [src/lib/types.ts](../src/lib/types.ts):
```diff
export type StoryOutputPage = {
    pageNumber: number;
    kind: '...';
    title?: string;
    bodyText?: string;
-   displayText?: string;
    entityIds?: string[];
    imageDescription?: string;
    // ... rest unchanged
};
```

2. **Stop Generating** - [src/ai/flows/story-page-flow.ts](../src/ai/flows/story-page-flow.ts):
   - Remove `displayText` generation logic

3. **Update Readers**:
   - [src/components/book-reader/book-reader.tsx](../src/components/book-reader/book-reader.tsx)
   - [src/components/book-reader/immersive-player.tsx](../src/components/book-reader/immersive-player.tsx)
   - [src/app/storybook/[bookId]/page.tsx](../src/app/storybook/%5BbookId%5D/page.tsx)
   - [src/app/kids/read/[bookId]/page.tsx](../src/app/kids/read/%5BbookId%5D/page.tsx)

---

## Phase 2: Session Redundant Fields (Low Risk)

### 2.1 Remove finalStoryText from StorySession

**Collection**: `storySessions/{id}`

**Field to Remove**:
| Field | Purpose | Replacement |
|-------|---------|-------------|
| `finalStoryText` | Compiled story text | Fetch from `stories/{storyId}.storyText` |

**Files to Modify**:

1. **Type Definition** - [src/lib/types.ts](../src/lib/types.ts):
```diff
export type StorySession = {
    id: string;
    childId: string;
    parentUid: string;
    status: 'in_progress' | 'completed';
    currentPhase: '...';
    currentStepIndex: number;
    storyTitle?: string;
    storyVibe?: string;
-   finalStoryText?: string;
    // ... rest unchanged
};
```

2. **Stop Writing** - [src/ai/flows/story-compile-flow.ts](../src/ai/flows/story-compile-flow.ts)

3. **Update Readers** - fetch from Story document instead

### 2.2 Remove storyTypeName (Denormalized Copy)

**Collection**: `storySessions/{id}`, `aiRunTraces`

**Field to Remove**:
| Field | Purpose | Replacement |
|-------|---------|-------------|
| `storyTypeName` | Display name | Lookup `storyTypes/{storyTypeId}.name` |

**Files to Modify**:

1. **Type Definition** - [src/lib/types.ts](../src/lib/types.ts):
```diff
export type StorySession = {
    // ...
    storyTypeId?: string;
-   storyTypeName?: string;
    // ...
};
```

2. **Stop Writing**:
   - [src/app/story/play/[sessionId]/page.tsx](../src/app/story/play/%5BsessionId%5D/page.tsx)
   - [src/lib/ai-run-trace.ts](../src/lib/ai-run-trace.ts)

3. **Create Helper Hook**:
```typescript
// src/hooks/use-story-type.ts
export function useStoryTypeName(storyTypeId: string | undefined) {
  const firestore = useFirestore();
  const [name, setName] = useState<string | null>(null);
  // ... fetch storyTypes/{storyTypeId}.name
  return name;
}
```

---

## Phase 3: Legacy Story Fields (Medium Risk)

### 3.1 Remove Legacy Image/Page Generation Fields from Story

**Collection**: `stories/{storyId}`

**Fields to Remove** (all moved to `storybooks` subcollection):
| Field | Purpose | Replacement |
|-------|---------|-------------|
| `pageGeneration` | Page gen status | `storybooks/{id}.pageGeneration` |
| `imageGeneration` | Image gen status | `storybooks/{id}.imageGeneration` |
| `selectedImageStyleId` | Image style | `storybooks/{id}.imageStyleId` |
| `selectedImageStylePrompt` | Style prompt | `storybooks/{id}.imageStylePrompt` |
| `storybookFinalization` | Finalization status | `storybooks/{id}.finalization` |
| `isLocked` | Lock status | `storybooks/{id}.isLocked` |

**Files to Modify**:

1. **Type Definition** - [src/lib/types.ts](../src/lib/types.ts):
```diff
export type Story = {
  id?: string;
  storySessionId: string;
  childId: string;
  parentUid: string;
  storyText: string;
  metadata?: { ... };
  status?: StoryStatus;
  createdAt: any;
  updatedAt: any;
  titleGeneration?: { ... };
  synopsis?: string | null;
  synopsisGeneration?: { ... };
  actors?: string[];
  actorAvatarUrl?: string | null;
  actorAvatarGeneration?: { ... };
- // Legacy fields for backward compatibility with wizard flow and old data model
- pageGeneration?: StoryBookPageGenerationStatus;
- imageGeneration?: StoryBookImageGenerationStatus;
- isLocked?: boolean;
- storybookFinalization?: StoryBookFinalization | null;
- selectedImageStyleId?: string;
- selectedImageStylePrompt?: string;
  audioGeneration?: { ... };
  audioUrl?: string | null;
  audioMetadata?: { ... };
  deletedAt?: any;
  deletedBy?: string;
};
```

2. **Update All Readers** to use `storybooks` subcollection:
   - [src/app/stories/page.tsx](../src/app/stories/page.tsx) - lines 36-52
   - [src/app/story/[storyId]/page.tsx](../src/app/story/%5BstoryId%5D/page.tsx)
   - [src/app/parent/storybooks/page.tsx](../src/app/parent/storybooks/page.tsx)
   - [src/app/child/[childId]/page.tsx](../src/app/child/%5BchildId%5D/page.tsx)
   - [src/app/child/[childId]/books/page.tsx](../src/app/child/%5BchildId%5D/books/page.tsx)

### 3.2 Remove LegacyStoryWithOutput Type

**Files to Modify**:

1. **Type Definition** - [src/lib/types.ts](../src/lib/types.ts):
```diff
-/**
- * @deprecated Use StoryBookOutput instead. This type exists for backward compatibility
- * with the old data model where Story contained output-specific fields.
- */
-export type LegacyStoryWithOutput = { ... };
-
-/**
- * @deprecated Use StoryBookOutput instead. Alias kept for backward compatibility.
- */
-export type StoryBook = LegacyStoryWithOutput;
```

2. **Update all imports** that reference these types

---

## Phase 4: Child Profile Legacy Fields (Very Low Risk)

### 4.1 Remove speechModeEnabled (Deprecated)

**Collection**: `children/{childId}`

**Field to Remove**:
| Field | Purpose | Replacement |
|-------|---------|-------------|
| `speechModeEnabled` | TTS toggle | `autoReadAloud` (already unified) |

**Files to Modify**:

1. **Type Definition** - [src/lib/types.ts](../src/lib/types.ts):
```diff
export type ChildProfile = {
    // ...
-   speechModeEnabled?: boolean;
    autoReadAloud?: boolean;
    // ...
};
```

2. **Remove remaining references** (should be none after previous migration)

### 4.2 Remove Legacy Preference Fields

**Collection**: `children/{childId}`

**Fields to Remove**:
| Field | Purpose | Replacement |
|-------|---------|-------------|
| `estimatedLevel` | Reading level | Not used |
| `favouriteGenres` | Story preferences | `likes` array |
| `favouriteCharacterTypes` | Character preferences | `likes` array |
| `preferredStoryLength` | Length preference | Not used |
| `helpPreference` | Scaffolding level | Not used |
| `preferences` | Nested object | `likes`/`dislikes` arrays |

**Files to Modify**:

1. **Type Definition** - [src/lib/types.ts](../src/lib/types.ts):
```diff
export type ChildProfile = {
    // ...
-   // Legacy fields for backwards compatibility with existing flows
-   estimatedLevel?: number;
-   favouriteGenres?: string[];
-   favouriteCharacterTypes?: string[];
-   preferredStoryLength?: 'short' | 'medium' | 'long';
-   helpPreference?: 'more_scaffolding' | 'less_scaffolding';
-   preferences?: ChildPreferences;
    // ...
};

-// Legacy type for migration purposes
-export type ChildPreferences = {
-    favoriteColors?: string[];
-    favoriteFoods?: string[];
-    favoriteGames?: string[];
-    favoriteSubjects?: string[];
-};
```

2. **Update story context building** - [src/lib/child-preferences.ts](../src/lib/child-preferences.ts) if still referencing these

---

## Phase 5: Character Legacy Fields (Very Low Risk)

### 5.1 Remove Deprecated Character Fields

**Collection**: `characters/{characterId}`

**Fields to Remove**:
| Field | Purpose | Replacement |
|-------|---------|-------------|
| `role` | Character role | `type` field |
| `traits` | Character traits | `likes` array |
| `sessionId` | Origin session | Not used |
| `visualNotes` | Visual description | Not used |
| `realPersonRef` | Real person reference | Not used |

**Files to Modify**:

1. **Type Definition** - [src/lib/types.ts](../src/lib/types.ts):
```diff
export type Character = {
    id: string;
    displayName: string;
    pronouns?: Pronouns;
    // ...
    type: 'Family' | 'Friend' | 'Pet' | 'Toy' | 'Other';
    relationship?: string;
    namePronunciation?: string;
    likes: string[];
    dislikes: string[];
    description?: string;
    // ...
-   // Legacy fields for backwards compatibility with existing flows
-   sessionId?: string;
-   role?: string;
-   traits?: string[];
-   visualNotes?: {
-       hair?: string;
-       clothing?: string;
-       specialItem?: string;
-   };
-   realPersonRef?: {
-       kind: 'self' | 'family' | 'friend' | 'pet' | 'toy' | 'other';
-       label: string;
-   };
    deletedAt?: any;
    deletedBy?: string;
};
```

---

## Phase 6: Legacy Collections (Low Risk)

### 6.1 Deprecate Top-Level storyBooks Collection

**Collection**: `storyBooks` (root level)

**Action**: Mark as deprecated in schema, remove from firestore.rules, update cleanup tool

**Files to Modify**:

1. **Firestore Rules** - [firestore.rules](../firestore.rules):
   - Remove rules for `storyBooks` collection
   - Or add deny-all rule with comment explaining deprecation

2. **Help Sample Data** - [src/data/help-sample-data.json](../src/data/help-sample-data.json):
   - Remove `storyBooks` entries

3. **Cleanup Route** - [src/app/api/admin/cleanup/route.ts](../src/app/api/admin/cleanup/route.ts):
   - Move to delete-only mode for this collection

---

## Implementation Order

| Phase | Risk | Effort | Dependencies |
|-------|------|--------|--------------|
| 4.1 speechModeEnabled | Very Low | Very Low | None |
| 4.2 Legacy child prefs | Very Low | Low | None |
| 5.1 Character legacy fields | Very Low | Low | None |
| 2.2 storyTypeName | Low | Low | Create helper hook |
| 1.1 textResolved/optionsResolved | Low | Medium | Update UI to resolve dynamically |
| 1.2 displayText | Low | Medium | Update readers |
| 2.1 finalStoryText | Low | Low | Verify Story doc always exists |
| 3.1 Story legacy fields | Medium | High | Update all viewers |
| 3.2 LegacyStoryWithOutput | Medium | Medium | After 3.1 |
| 6.1 storyBooks collection | Low | Low | After all above |

---

## Testing Strategy

### Before Each Phase

1. **Field Usage Audit**:
```javascript
// Run in admin console or regression tests
const count = await db.collection('storySessions')
  .where('storyTypeName', '!=', null)
  .count().get();
console.log(`Documents with storyTypeName: ${count.data().count}`);
```

2. **Snapshot Comparison** (for resolved text):
```javascript
// Verify dynamic resolution matches stored
for (const msg of messages) {
  const dynamic = await resolvePlaceholders(msg.text);
  assert(dynamic === msg.textResolved || !msg.textResolved);
}
```

### After Each Phase

1. Run full regression test suite
2. Verify no TypeScript errors
3. Test affected UI flows manually

---

## Schema Documentation Updates

After implementing changes, update:
- [docs/SCHEMA.md](./SCHEMA.md) - Remove deprecated fields
- [docs/backend.json](./backend.json) - Update API schemas
- [docs/SYSTEM_DESIGN.md](./SYSTEM_DESIGN.md) - Simplify data flow descriptions

---

## Rollback Plan

Each phase can be rolled back independently:
1. Restore type definitions
2. Re-add write logic
3. Keep existing stored data (never delete during migration)

Data in Firestore is never deleted - only the code stops writing/reading the fields.
