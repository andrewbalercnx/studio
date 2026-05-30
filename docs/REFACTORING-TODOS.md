# Entity Reference System — Refactoring Plan

> **Context**: Produced following a full audit of the `$$id$$` entity placeholder system (May 2026).
> These todos describe a migration from text-embedded entity tags to a formal two-layer architecture:
> a structured **world state** (who is in the scene, authoritative) and a **surface text** (clean natural
> language, no embedded IDs). See `docs/CHANGES.md` entries `cf74114` and `330193e` for the
> performance work that preceded this.

---

## Dependency order

```
Todo 1  (scene annotation schema)
  └─► Todo 3  (image generation migration)
        └─► Todo 5  (remove $$ from narrative text — final cleanup)

Todo 2  (fix display path / two-field contract)  ← independent, fixes live bug

Todo 4  (centralise resolution library)  ← independent, low risk

Todo 6  (world state persistence)  ← depends on Todo 1

Todo 7  (TTS scene-based context)  ← depends on Todo 1, parallel with Todo 3
```

---

## Todo 1 — Add scene annotation to story beat output schema and prompt

**Priority**: high  
**Category**: architecture  
**Status**: not started

### Context

The foundational architectural change enabling scene-driven image generation and implicit actor
tracking. Currently the beat output is `storyContinuation + options` — narrative text with `$$id$$`
tags. The AI implicitly knows which actors are in the scene but this knowledge is never captured
in any structured field. Image generation must scrape text for `$$id$$` tags, missing actors
referenced implicitly ("both of them", "everyone"). This externalises that implicit knowledge.

### What changes

**`src/lib/schemas/story-beat-output.ts`**  
Add a `scene` field to `StoryBeatOutputSchema`:
```typescript
scene: z.object({
  presentActors: z.array(z.string()),  // ALL actor IDs present in scene
  location: z.string().optional(),
})
```

**`src/lib/prompt-builders/story-beat-prompt-builder.ts`**  
Add instructions to the beat schema/output section: the AI must populate `scene.presentActors`
with ALL actor IDs currently in the scene — including those only grammatically referenced
("both of them" → list both IDs, "everyone was happy" → list all present IDs). The AI
receives the character list with `$$id$$` mappings in context so it already knows the IDs.
Include an explicit example showing the three cases:
- explicit mention: "$$aliceId$$ jumped" → `presentActors: ["aliceId"]`
- grammatical collapse: "they both jumped" → `presentActors: ["aliceId", "samId"]`
- implied presence: "everyone cheered" → `presentActors: ["aliceId", "samId", "charId"]`

**`src/lib/types.ts`**  
Add `scene?: { presentActors: string[]; location?: string }` to `ChatMessage`.

**`src/app/story/session/[sessionId]/page.tsx`**  
When writing the `beat_continuation` message to Firestore, include the `scene` field from the
beat response.

### Notes
- Backward compatible — old messages without `scene` fall back to text extraction for entityIds.
- `presentActors` should always include the main child ID.
- Schema constraint is a simple string array; AI compliance with Gemini 2.5 is high.
- The `$$id$$` format remains in the INPUT context (how the AI is told which ID maps to which
  character). Only the OUTPUT narrative text eventually loses it (see Todo 5).

### Related files
- `src/lib/schemas/story-beat-output.ts`
- `src/lib/prompt-builders/story-beat-prompt-builder.ts`
- `src/lib/build-story-system-message.ts`
- `src/app/story/session/[sessionId]/page.tsx`
- `src/lib/types.ts`

---

## Todo 2 — Fix the display path: two-field ChatMessage contract

**Priority**: high  
**Category**: bug  
**Status**: not started

### Context

The primary cause of `$$id$$` leaking to users. `storyBeatFlow` already returns both
`storyContinuation` (raw, `$$id$$` intact) and `storyContinuationResolved` (display-ready). The
session page at line 554 ignores the resolved version and writes the raw version to Firestore.
On render, a `useEffect` triggers client-side Firestore reads to resolve the text. Until that
async resolution completes — or if it fails — users see `$$abc123$$` in the UI.

### What changes

**`src/lib/types.ts`**  
Add `displayText?: string` to `ChatMessage` and `displayText?: string` to `Choice`. Document
the contract explicitly:
- `text` = raw AI output, `$$id$$` intact; used by compile pipeline, TTS, AI conversation history
- `displayText` = resolved at server write-time; used by all UI rendering; never needs re-resolution

**`src/app/story/session/[sessionId]/page.tsx`** — beat write (line ~554)  
Change to write both fields:
```typescript
const { storyContinuation, storyContinuationResolved, options, optionsResolved } = flowResult;
// beat_continuation:
{ text: storyContinuation, displayText: storyContinuationResolved, ... }
// beat_options:
{ options: options.map((opt, i) => ({ ...opt, displayText: optionsResolved[i].text })), ... }
```

**`src/app/story/session/[sessionId]/page.tsx`** — ending write  
Similarly write `displayText` for `ending_options` and `child_ending_choice` messages. The
ending flow already resolves endings before returning; ensure it returns both raw and resolved.

**`src/ai/flows/ending-flow.ts`**  
Return both `text` (raw) and `displayText` (resolved) per ending option, mirroring beat flow.

**`src/app/story/session/[sessionId]/page.tsx`** — render path  
- Remove the `resolveAllPlaceholders` useEffect (~lines 289–317)
- Remove `resolvedTexts` Map state
- Remove `getResolvedText` helper
- Replace all `getResolvedText(msg.text)` render calls with `msg.displayText ?? msg.text`

### Notes
- The `?? msg.text` fallback handles legacy Firestore documents that predate this change.
- `child_choice` messages (what the child tapped) should also get `displayText` set.
- This fix is independent of Todo 1 and can be shipped immediately.

### Related files
- `src/lib/types.ts`
- `src/app/story/session/[sessionId]/page.tsx`
- `src/ai/flows/ending-flow.ts`

---

## Todo 3 — Migrate image generation to scene-driven actor lists

**Priority**: high  
**Category**: architecture  
**Status**: not started — depends on Todo 1

### Context

Currently the image generation pipeline determines which actors appear in each page image by:
1. Extracting `$$id$$` patterns from story text (misses implicit references)
2. Falling back to `story.actors` (all story actors, not page-specific)

With Todo 1 in place, every beat message carries `scene.presentActors` — the authoritative list
of which actors the AI intended to be in that scene. The pagination flow should use this data
to populate `entityIds` per page, replacing the text-scraping approach.

### What changes

**`src/ai/flows/story-pagination-flow.ts`**  
When the story text has been compiled from beats that each carry `scene.presentActors`, the
pagination flow should look up the beat messages to find scene annotations and propagate the
actor lists into the paginated output. For each page, `actors` in the AI output should reflect
who was in the source beats, not just who is textually mentioned.

The pagination prompt should be updated to tell the AI: "For each page, list the actor IDs
present in that scene. These are provided in the scene annotations in the character reference
section — include all of them."

**`src/ai/flows/story-page-flow.ts`**  
When AI pagination provides `entityIds` per page (already supported via `aiPaginatedEntityIds`),
these now come from the scene annotation data rather than text extraction. The fallback to
`extractEntityIds(text)` is retained for legacy/non-annotated stories.

**`src/ai/flows/story-compile-flow.ts`** / **`src/ai/flows/story-text-compile-flow.ts`**  
The compiled story should carry a `sceneActors` array per beat (assembled from beat messages'
`scene.presentActors`) alongside the compiled text. This feeds into pagination.

### Notes
- The `entityIds` per page already flow correctly into image generation (story-image-flow.ts
  loads full actor data by ID). No change needed in the image generation flow itself.
- Graceful degradation: if `scene` is absent (old data), fall back to `extractEntityIds(text)`.
- This directly fixes the three broken cases: explicit, collapsed, and implied actor references.

### Related files
- `src/ai/flows/story-pagination-flow.ts`
- `src/ai/flows/story-page-flow.ts`
- `src/ai/flows/story-compile-flow.ts`
- `src/ai/flows/story-text-compile-flow.ts`

---

## Todo 4 — Centralise and rename the resolution library

**Priority**: medium  
**Category**: tech-debt  
**Status**: not started — independent

### Context

The resolution library has accumulated issues:
1. `extractEntityIds` is duplicated identically in four flow files
2. Function names (`replacePlaceholdersInText`, `replacePlaceholdersForTTS`, etc.) describe
   mechanism, not consumer — it's not obvious which function to call where
3. `replacePlaceholdersInText` silently strips ElevenLabs TTS directive tags as a side-effect
   of the display path — this coupling is hidden

### What changes

**`src/lib/resolve-placeholders.server.ts`**  
- Add `export function extractEntityIds(text: string): string[]` — the single canonical
  implementation (double-`$$` + single-`$` fallback, 15-char minimum)
- Rename exports (with deprecated aliases retained during transition):
  - `replacePlaceholdersInText` → `resolveForDisplay`
  - `replacePlaceholdersForTTS` → `resolveForTTS`
  - `replacePlaceholdersWithDescriptions` → `resolveForImageDescription`
  - `resolveEntitiesInText` → `buildEntityMapFromText`
- Add a JSDoc comment to each function stating its consumer: UI rendering / TTS / image prompts

**Four flow files** — delete local `extractEntityIds`/`extractActorIds` and import the shared one:
- `src/ai/flows/story-page-flow.ts`
- `src/ai/flows/story-compile-flow.ts`
- `src/ai/flows/story-text-compile-flow.ts`
- `src/ai/flows/story-pagination-flow.ts`

**`src/lib/story-context-builder.ts`** — uses its own `extractActorIdsFromText`; unify with the
shared version.

### Notes
- Keep deprecated name aliases for one release cycle to avoid big-bang rename.
- The `stripTTSDirectiveTags` side-effect in `resolveForDisplay` should be documented clearly
  or moved to a separate explicit call.

### Related files
- `src/lib/resolve-placeholders.server.ts`
- `src/ai/flows/story-page-flow.ts`
- `src/ai/flows/story-compile-flow.ts`
- `src/ai/flows/story-text-compile-flow.ts`
- `src/ai/flows/story-pagination-flow.ts`
- `src/lib/story-context-builder.ts`

---

## Todo 5 — Remove `$$id$$` from narrative text output (final stage)

**Priority**: medium  
**Category**: architecture  
**Status**: not started — depends on Todos 1, 2, 3

### Context

Once image generation uses `scene.presentActors` (Todo 3) and the display path uses pre-resolved
`displayText` (Todo 2), the `$$id$$` format in narrative text output has no remaining consumers.
This step removes the requirement for `$$` in narrative text, making the AI instruction simpler,
eliminating the compliance failure mode, and allowing the resolution library to shrink to just
context-building helpers.

### What changes

**Beat and ending prompts**  
Remove the "CRITICAL: use $$id$$ in narrative text" instruction. The AI still receives `$$id$$`
mappings in the input context (so it can populate `scene.presentActors`), but is no longer
required to use them in the narrative text. Update the instruction to: "In the narrative text,
use the character's display name. In the `scene.presentActors` field, use their `$$id$$`."

**`src/ai/flows/story-text-compile-flow.ts`**  
Remove `DEFAULT_COMPILE_INSTRUCTIONS` clause "preserve all $$id$$ placeholders exactly".
Change the synopsis instruction to use display names (not `$$id$$`).

**`src/ai/flows/story-pagination-flow.ts`**  
Remove "preserve $$id$$ placeholders exactly" from the pagination prompt.

**`src/lib/resolve-placeholders.server.ts`**  
The display-path and TTS-path resolution functions become unnecessary for new data (no `$$` in
narrative text). Retain `buildEntityMapFromText` and `resolveForImageDescription` for legacy
data and context building. Mark display-path functions as legacy/deprecated.

**`src/lib/resolve-placeholders.ts`** (client-side) and **`src/hooks/use-resolve-placeholders.ts`**  
Can be deleted or reduced to a clearly-labelled legacy shim for reading old Firestore data.
Add a comment: "Only for legacy documents predating the two-field ChatMessage contract."

### Notes
- This is a migration step — old Firestore data still has `$$` in `text` fields; resolution
  must remain available as a fallback.
- After this step, the AI compliance problem (`$$` leaking to display) is architecturally
  impossible: the display path never looks at text with `$$` in it.
- Coordinate with a Firestore data migration if old sessions need to be backfilled with
  `displayText`.

### Related files
- `src/lib/prompt-builders/story-beat-prompt-builder.ts`
- `src/lib/build-story-system-message.ts`
- `src/ai/flows/story-text-compile-flow.ts`
- `src/ai/flows/story-pagination-flow.ts`
- `src/lib/resolve-placeholders.server.ts`
- `src/lib/resolve-placeholders.ts`
- `src/hooks/use-resolve-placeholders.ts`

---

## Todo 6 — World state persistence for cross-beat actor continuity

**Priority**: medium  
**Category**: architecture  
**Status**: not started — depends on Todo 1

### Context

Even with scene annotations (Todo 1), each beat independently lists its present actors. But
there is no formal mechanism for actor *persistence* — if Sam was introduced in beat 3 and beat
5 says "everyone sat down", the AI must infer that Sam is still present from context alone.
A running `WorldState` document formalises this: the AI is given explicit current scene state
as input, and its `scene` output is a delta to that state.

### What changes

**`src/lib/types.ts`**  
Add `WorldState` type:
```typescript
type WorldState = {
  presentActors: string[];  // who is currently in the scene
  location?: string;
  beatNumber: number;
}
```
Add `worldState?: WorldState` to `StorySession`.

**`src/ai/flows/story-beat-flow.ts`**  
- Load `session.worldState` alongside other session data (parallel fetch)
- Include current world state in the beat prompt context: "Current scene: [actors], [location]"
- After beat generation, update `session.worldState` with the beat's `scene` output
- The update is a Firestore write to the session document (fire-and-forget acceptable)

**`src/lib/prompt-builders/story-beat-prompt-builder.ts`**  
Add a `CURRENT WORLD STATE` section to the prompt when world state is provided. This gives
the AI explicit grounding: it knows Sam is still in the garden from beat 3 without having to
infer from conversation history alone.

### Notes
- World state is a small document (a few fields) merged into the session document.
- The write is non-blocking — if it fails, the next beat regenerates world state from context.
- This also enables the AI to write better transitions ("Sam, who had been watching quietly...")
  because it has explicit knowledge of who is present.

### Related files
- `src/lib/types.ts`
- `src/ai/flows/story-beat-flow.ts`
- `src/lib/prompt-builders/story-beat-prompt-builder.ts`
- `docs/SCHEMA.md` (update with WorldState field on sessions)

---

## Todo 7 — TTS scene-based context (pronunciation + actor introductions)

**Priority**: medium  
**Category**: feature  
**Status**: not started — depends on Todo 1

### Context

`buildActorDescriptionsForAudio` is fully implemented in `resolve-placeholders.server.ts` but
never called. It builds spoken actor introductions like "[Characters in this scene: Alice is
the main character. She uses she/her pronouns.]" before the narrated text. With `scene.presentActors`
available from Todo 1, the actor list for each page is known without text parsing, making this
straightforward to wire up.

The TTS path also currently builds its entity map from a synthetic text string
(`$$id1$$ $$id2$$...`). With `scene.presentActors` available, this can be built directly.

### What changes

**`src/ai/flows/story-page-audio-flow.ts`**  
In `generatePageAudio()`:
- Use `page.entityIds` (which will be populated from `scene.presentActors` after Todo 3) to
  build entity map directly rather than constructing a synthetic `$$id$$` string
- Call `buildActorDescriptionsForAudio(page.entityIds, entityMap)` and prepend the result
  to `textToNarrate`

**`src/ai/flows/story-audio-flow.ts`**  
Similar: use actor list from story metadata rather than scanning story text.

**`src/app/api/tts/route.ts`** (on-demand TTS)  
This path receives arbitrary text and correctly handles `$$id$$` already. No change needed
until Todo 5 removes `$$` from text — at that point, the caller will need to pass actor IDs
explicitly if pronunciation context is needed.

### Notes
- The actor description prefix improves pronunciation accuracy for unusual names and gives
  the TTS model persona/voice context.
- Test with a name that has a `namePronunciation` field set to verify the pronunciation hint
  is being used.

### Related files
- `src/ai/flows/story-page-audio-flow.ts`
- `src/ai/flows/story-audio-flow.ts`
- `src/lib/resolve-placeholders.server.ts` (buildActorDescriptionsForAudio)
