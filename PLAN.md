# Plan: Global Prompt Configuration

## Overview
Add a global prompt configuration that gets prepended to all AI prompts. This configuration will be stored in Firestore and editable via an admin interface.

## Architecture

### Storage
- **Collection**: `systemConfig/prompts`
- **Schema**:
  ```typescript
  interface GlobalPromptConfig {
    globalPrefix: string;        // Text prepended to all prompts
    enabled: boolean;            // Toggle to enable/disable
    updatedAt: Timestamp;
    updatedBy: string;
  }
  ```

### Implementation Approach

Following the existing pattern used by `systemConfig/diagnostics`:

1. **Types** (`src/lib/types.ts`)
   - Add `GlobalPromptConfig` interface
   - Add `DEFAULT_GLOBAL_PROMPT_CONFIG` constant

2. **Server Helper** (`src/lib/global-prompt-config.server.ts`)
   - `getGlobalPromptConfig()` - Fetches config from Firestore with caching
   - Used by all AI flows on the server side

3. **Modify `buildStorySystemMessage`** (`src/lib/build-story-system-message.ts`)
   - Accept optional `globalPrefix` parameter
   - Prepend to the system message when provided

4. **Modify `buildStoryBeatPrompt`** (`src/lib/prompt-builders/story-beat-prompt-builder.ts`)
   - Accept optional `globalPrefix` parameter
   - Prepend to the built prompt when provided

5. **Update AI Flows** (all flows in `src/ai/flows/`)
   - At the start of each flow, call `getGlobalPromptConfig()`
   - Pass the `globalPrefix` to the prompt builder
   - Flows affected:
     - `story-beat-flow.ts`
     - `ending-flow.ts`
     - `story-compile-flow.ts`
     - `warmup-reply-flow.ts`
     - `story-wizard-flow.ts`
     - `character-traits-flow.ts`
     - `story-page-flow.ts`
     - `story-synopsis-flow.ts`
     - And others with `ai.generate()` calls

6. **Admin API** (`src/app/api/admin/system-config/prompts/route.ts`)
   - GET: Fetch current config
   - PUT: Update config

7. **Admin UI** (`src/app/admin/prompts/page.tsx`)
   - Simple form to edit the global prefix text
   - Toggle to enable/disable
   - Save button

## Files to Create
- `src/lib/global-prompt-config.server.ts`
- `src/app/api/admin/system-config/prompts/route.ts`
- `src/app/admin/prompts/page.tsx`

## Files to Modify
- `src/lib/types.ts` - Add types
- `src/lib/build-story-system-message.ts` - Accept globalPrefix
- `src/lib/prompt-builders/story-beat-prompt-builder.ts` - Accept globalPrefix
- `src/ai/flows/story-beat-flow.ts` - Fetch and use global config
- `src/ai/flows/ending-flow.ts` - Fetch and use global config
- `src/ai/flows/story-compile-flow.ts` - Fetch and use global config
- `src/ai/flows/warmup-reply-flow.ts` - Fetch and use global config
- `src/ai/flows/story-wizard-flow.ts` - Fetch and use global config
- (Additional flows as needed)

## Caching Strategy
The `getGlobalPromptConfig()` function will cache the config in memory with a short TTL (e.g., 60 seconds) to avoid hitting Firestore on every AI request while still allowing reasonably quick updates.
