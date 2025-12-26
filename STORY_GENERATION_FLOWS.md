# Story Generation Flows Documentation

This document describes the four story generation flows in the application, their architectures, prompting strategies, and how they produce complete stories.

---

## Overview

| Flow | File | State Model | Completion Trigger | Character Creation | Compilation |
|------|------|-------------|-------------------|-------------------|-------------|
| **Story Wizard** | `story-wizard-flow.ts` | Stateless | Fixed (4 questions) | No | Embedded |
| **Gemini 3** | `gemini3-flow.ts` | Stateful | Dynamic (~15 messages) | Yes (unified flow) | Direct |
| **Gemini 4** | `gemini4-flow.ts` | Stateful | Fixed (6-8 questions) | Yes (unified flow) | Direct |
| **Story Beat** | `story-beat-flow.ts` | Stateful | Arc-driven | Yes (unified flow) | Required (`storyCompileFlow`) |

---

## 1. Story Wizard Flow

**File:** [story-wizard-flow.ts](src/ai/flows/story-wizard-flow.ts)

### System Prompting Strategy

The Story Wizard uses a **minimal, focused system prompt** that varies based on the current phase:

**Question Phase:**
```
You are a friendly Story Wizard who helps a young child create a story by asking simple multiple-choice questions.
```

**Story Generation Phase:**
```
You are a master storyteller for young children. Your task is to write a complete, short story based on a child's choices.
```

Context is provided via `buildStoryContext()` which loads child profile, siblings, and available characters.

### State Management: STATELESS

- No conversation history is persisted in Firestore
- State is carried via an `answers` array passed with each request
- Each call is independent - the accumulated answers array contains all needed context
- Maximum of 4 questions hardcoded as `MAX_QUESTIONS`

### Prompt Strategy at Each Stage

**Stage 1-4: Asking Questions**
- Prompt includes child age, preferences, and any existing characters
- Prior Q&A pairs included as context: `"${question}" -> "${answer}"`
- AI generates next question with 2-4 choices
- Temperature: **0.8** (moderate creativity)

**Stage 5: Story Generation**
- All 4 answers included in prompt
- AI writes complete 5-7 paragraph story in one call
- Character placeholders required: `$$${childId}$$`
- Temperature: **0.7** (more focused)

### Story Progression to Completion

```
answers.length < 4  →  Generate next question + choices
answers.length >= 4 →  Generate final story
```

Linear, deterministic progression - exactly 4 questions, then done.

### Story Assembly

The story is generated **in a single AI call** after all questions are answered:
1. AI outputs JSON with `title`, `vibe`, and `storyText`
2. Placeholders like `$$childId$$` are resolved via `replacePlaceholdersInText()`
3. Story document created directly in Firestore with status `text_ready`

### Output Schema

```typescript
// Asking state
{
  state: 'asking',
  question: string,
  choices: Array<{ text: string }>,  // 2-4 choices
  answers: Array<{ question: string, answer: string }>,
  ok: true
}

// Finished state
{
  state: 'finished',
  title: string,
  vibe: string,
  storyText: string,  // With placeholders resolved
  storyId: string,
  ok: true
}
```

### Character Creation

**Not supported.** This flow uses only the child profile and existing characters from the database. No new characters can be introduced during the wizard process.

### Structural Differences from Other Flows

- **Simplest flow** - pure functional approach with no persistent state
- **No conversation history** - just accumulated answers
- **Single-model architecture** - same model for questions and story
- **Immediate story creation** - no background tasks or compilation step
- **Parent-focused** - designed for quick story generation without child interaction

---

## 2. Gemini 3 Flow (Free-Form Creative)

**File:** [gemini3-flow.ts](src/ai/flows/gemini3-flow.ts)

### System Prompting Strategy

Uses `buildStorySystemMessage()` for a **unified system message** that includes:
- Child profile and age-appropriate guidance
- Available characters with placeholder IDs
- Character creation guidelines
- Narrative guidelines

**Mode-specific additions:**
```
=== GEMINI 3 MODE ===
You have complete creative freedom to craft an amazing story through conversation.
Ask creative questions, build the story based on answers, and guide toward a satisfying conclusion.
```

Temperature guidance dynamically inserted based on completion percentage.

### State Management: STATEFUL

- Full conversation history persisted in Firestore subcollection `/storySessions/{sessionId}/messages`
- Session document tracks `storyMode: 'gemini3'`
- Original story with placeholders stored in `gemini3FinalStory` field
- Each flow invocation loads and includes all prior messages

### Prompt Strategy at Each Stage

**Stage 1: First Message (0 exchanges)**
```
=== STARTING THE STORY ===
Welcome the child warmly and ask an exciting opening question!
```

**Stage 2: Development (0-60% complete)**
```
Continue the story based on what the child has told you.
Ask the next creative question or advance the plot!
```

**Stage 3: Approaching End (60-80% complete)**
```
**IMPORTANT: APPROACHING STORY END**
The story is X% complete. Begin guiding toward the climax and conclusion.
```

**Stage 4: Forced Completion (80%+ complete)**
```
**CRITICAL: STORY CONCLUSION NEEDED**
**YOU MUST END THE STORY NOW.**
Set "isStoryComplete": true
Provide "finalStory": A complete, satisfying story (5-7 paragraphs)
```

**Temperature:** **0.9** (high creativity)

### Story Progression to Completion

Completion driven by message count ratio:
```typescript
const lengthFactor = Math.min(messageCount / 15, 1.0);
const storyTemperature = lengthFactor;
```

| Temperature | Guidance |
|-------------|----------|
| 0-40% | Continue developing |
| 40-60% | Keep moving forward |
| 60-80% | Begin guiding toward climax |
| 80%+ | **MUST end story now** |

The AI sets `isStoryComplete: true` to signal completion.

### Story Assembly

**Direct generation** - no compilation step needed:
1. When `isStoryComplete: true`, AI provides complete `finalStory` field
2. Story includes all placeholder references (`$$characterId$$`)
3. Both original (with placeholders) and resolved versions returned
4. Session updated to `status: 'completed'`
5. Story later compiled via `storyCompileFlow` for final polish

### Output Schema

```typescript
{
  ok: true,
  sessionId: string,
  question: string,           // Original with placeholders (empty when complete)
  questionResolved: string,   // Resolved for display
  options: Array<{
    id: string,               // 'A', 'B', 'C', 'D'
    text: string,
    introducesCharacter?: boolean,
    newCharacterName?: string,
    newCharacterLabel?: string,
    newCharacterType?: 'Family' | 'Friend' | 'Pet' | 'Toy' | 'Other',
    existingCharacterId?: string
  }>,
  optionsResolved: Array<...>,
  isStoryComplete: boolean,
  finalStory: string | null,       // Original with placeholders
  finalStoryResolved: string | null
}
```

### Character Creation

**Fully supported** via the unified `createStoryCharacterFlow`:
- Options can specify `introducesCharacter: true`
- Must include `newCharacterName`, `newCharacterLabel`, and `newCharacterType`
- Example: `{ introducesCharacter: true, newCharacterName: "Nutsy", newCharacterLabel: "a friendly squirrel who loves acorns", newCharacterType: "Pet" }`
- Client calls `/api/characters/create` which invokes `createStoryCharacterFlow`
- Flow uses `generateCharacterProfile()` to generate **pronouns**, description, likes, and dislikes
- Character document created with full profile in Firestore

### Structural Differences from Other Flows

- **Highest temperature (0.9)** - maximum creative freedom
- **No fixed structure** - AI controls pacing entirely
- **Message-based completion** - uses message count, not arc steps
- **Dynamic character introduction** - integrated into choice options
- **Flexible story length** - aims for ~15 exchanges but adapts

---

## 3. Gemini 4 Flow (Structured Guided)

**File:** [gemini4-flow.ts](src/ai/flows/gemini4-flow.ts)

### System Prompting Strategy

Uses `buildStorySystemMessage()` plus **phase-specific guidance** via `getQuestionPhaseGuidance()`:

```typescript
function getQuestionPhaseGuidance(questionCount: number, childAge: number | null): string {
  // Returns detailed guidance based on current phase
}
```

**Mode-specific additions:**
```
=== GEMINI 4 MODE ===
Guide the child through a structured story creation with focused questions.
Provide 4 options: A, B, C (story choices) and M ("Tell me more").
```

### State Management: STATEFUL (with Genkit Chat API)

- Uses **Genkit beta `aiBeta.chat()` API** for stateful conversations
- Conversation history stored in Firestore and loaded as `MessageData[]`
- Session tracks `questionCount` for phase determination
- Uses `gemini4FinalStory` field for completed stories

```typescript
const chat = aiBeta.chat({
  model: 'googleai/gemini-2.5-pro',
  system: systemPrompt,
  messages: chatHistory,  // Prior conversation
  output: { schema: Gemini4OutputSchema }
});
const response = await chat.send(userMessage);
```

### Prompt Strategy at Each Stage

**Phase 1: Opening (Question 1)**
```
**OPENING QUESTION (Phase 1/8)**
Ask an exciting opening question to understand what kind of adventure the child wants.
Focus on: What does $$childId$$ want to do today? Where do they want to go?
```

**Phase 2: Setting (Question 2)**
```
**SETTING QUESTION (Phase 2/8)**
Build on their first choice. Establish where the story takes place.
Focus on: Describe the setting with sensory details.
```

**Phase 3: Characters (Question 3)**
```
**CHARACTER QUESTION (Phase 3/8)**
Introduce or involve characters in the story.
Focus on: Who does $$childId$$ meet?
```

**Phase 4: Problem/Conflict (Question 4)**
```
**PROBLEM/CONFLICT QUESTION (Phase 4/8)**
Introduce a challenge or exciting situation.
```

**Phase 5: Action (Question 5)**
```
**ACTION QUESTION (Phase 5/8)**
The child takes action to address the challenge.
```

**Phase 6+: Resolution (Final)**
```
**RESOLUTION QUESTION (Final Phase)**
Time to wrap up the story with a satisfying conclusion.
After this response, you should complete the story.
```

**Temperature:** **0.85**

### Story Progression to Completion

Fixed question count based on child age:
```typescript
const maxQuestions = childAge && childAge <= 5 ? 6 : 8;
```

| Child Age | Max Questions |
|-----------|---------------|
| ≤5 years | 6 questions |
| >5 years | 8 questions |

When `questionCount >= maxQuestions - 1`, AI is instructed to complete the story.

### Story Assembly

**Direct generation** like Gemini 3:
1. AI sets `isStoryComplete: true` at final phase
2. Complete `finalStory` provided with placeholders
3. Session updated with `gemini4FinalStory`
4. Later compiled via `storyCompileFlow`

### Output Schema

```typescript
{
  ok: true,
  sessionId: string,
  question: string,
  questionResolved: string,
  options: Array<{
    id: 'A' | 'B' | 'C' | 'M',  // M = "Tell me more"
    text: string,
    isMoreOption: boolean,
    introducesCharacter: boolean,
    newCharacterName: string,    // Empty string if not introducing
    newCharacterLabel: string,
    newCharacterType: string,
    existingCharacterId: string
  }>,
  optionsResolved: Array<...>,
  isStoryComplete: boolean,
  finalStory: string,
  finalStoryResolved: string | null,
  questionPhase: 'opening' | 'setting' | 'characters' | 'conflict' | 'resolution' | 'complete',
  questionNumber: number
}
```

### Character Creation

**Full integration with the unified `createStoryCharacterFlow`:**

**File:** [create-story-character-flow.ts](src/ai/flows/create-story-character-flow.ts)

```typescript
export const createStoryCharacterFlow = ai.defineFlow({
  name: 'createStoryCharacterFlow',
  inputSchema: z.object({
    sessionId: z.string(),
    parentUid: z.string(),
    childId: z.string(),
    characterLabel: z.string(),
    characterName: z.string().optional(),
    characterType: z.enum(['Family', 'Friend', 'Pet', 'Toy', 'Other']),
    storyContext: z.string(),
    childAge: z.number().nullable(),
    generateAvatar: z.boolean().optional().default(false),
  }),
  // ...
});

// Alias for backward compatibility
export const gemini4CreateCharacterFlow = createStoryCharacterFlow;
```

When an option introduces a character:
1. Client calls `/api/characters/create` endpoint
2. API invokes `createStoryCharacterFlow` with character details
3. Flow uses `generateCharacterProfile()` for **pronouns**, traits, likes, and dislikes
4. Character document created in Firestore with full profile
5. Session updated with `supportingCharacterIds`

This is the **same flow used by all story modes** (Gemini 3, Gemini 4, and Story Beat).

### Structural Differences from Other Flows

- **Most structured** - rigid phase progression (opening → resolution)
- **"Tell me more" option** - allows elaboration without advancing story
- **Genkit beta chat API** - true stateful conversation within request
- **Age-adaptive length** - 6 questions for young children, 8 for older
- **Dedicated character creation flow** - cleanest separation of concerns

---

## 4. Story Beat Flow (Arc-Based)

**File:** [story-beat-flow.ts](src/ai/flows/story-beat-flow.ts)

### System Prompting Strategy

Uses `buildStorySystemMessage()` plus **PromptConfig** system:

```typescript
const { promptConfig } = await resolvePromptConfigForSession(sessionId, 'storyBeat');
```

The prompt includes:
- Unified system message with child context
- PromptConfig's `systemPrompt` and `modeInstructions`
- StoryType name and current arc step
- Temperature guidance based on combined progress
- Full "Story So Far" from conversation history

### State Management: STATEFUL

- Full conversation history in Firestore subcollection
- Session tracks `arcStepIndex` - position in story arc
- StoryType document provides `arcTemplate.steps` array
- Arc index bounded safely to prevent out-of-bounds errors

```typescript
const arcSteps = storyType.arcTemplate?.steps ?? [];
const safeArcStepIndex = Math.max(0, Math.min(rawArcStepIndex, arcSteps.length - 1));
const arcStep = arcSteps[safeArcStepIndex];  // e.g., "introduce_character", "conflict", "resolution"
```

### Prompt Strategy at Each Stage

**Dynamic temperature guidance** based on combined progress:

```typescript
const arcProgress = arcStepIndex / (arcSteps.length - 1);
const lengthFactor = Math.min(messageCount / 20, 1.0);
const combinedTemperature = (arcProgress * 0.7) + (lengthFactor * 0.3);
```

| Combined Temp | Guidance |
|---------------|----------|
| 0-30% | Continue developing plot |
| 30-50% | Keep moving forward |
| 50-70% | Begin setting up climax |
| 70%+ | Start guiding toward satisfying conclusion |

**Temperature:** Configurable via PromptConfig (default **0.7**)

### Story Progression to Completion

Arc-driven progression:
1. Frontend advances `arcStepIndex` based on user choices
2. Each beat generates one paragraph + 3 options
3. StoryType's `arcTemplate.steps` defines the journey
4. Common arc: `["introduce_character", "establish_world", "inciting_incident", "rising_action", "climax", "resolution"]`

**Note:** The Story Beat flow does NOT produce a complete story - it produces individual beats that must be compiled.

### Story Assembly

**Requires post-processing via `storyCompileFlow`:**

1. Individual beats are stored as messages in conversation history
2. After final beat, `storyCompileFlow` is called
3. Compile flow loads all messages and rewrites into cohesive narrative:

```typescript
const systemPrompt = `You are a master storyteller who specializes in
compiling interactive chat sessions into a single, beautifully written story...`;
```

4. Story document created with resolved text

### Output Schema

```typescript
{
  ok: true,
  sessionId: string,
  promptConfigId: string,
  arcStep: string,           // Current arc step label
  storyTypeId: string,
  storyTypeName: string,
  storyContinuation: string,          // Next paragraph (with placeholders)
  storyContinuationResolved: string,  // Resolved for display
  options: Array<{
    id: 'A' | 'B' | 'C',
    text: string,
    introducesCharacter?: boolean,
    newCharacterName?: string,
    newCharacterLabel?: string,
    newCharacterType?: 'Family' | 'Friend' | 'Pet' | 'Toy' | 'Other',
    existingCharacterId?: string,
    avatarUrl?: string    // Resolved from existing characters
  }>,
  optionsResolved: Array<...>
}
```

### Character Creation

**Supported via the unified `createStoryCharacterFlow`:**
- Options can include `introducesCharacter: true`
- Character metadata embedded in option (name, label, type)
- Avatar URLs resolved for existing characters
- New characters created via `/api/characters/create` endpoint
- Uses `generateCharacterProfile()` for **pronouns**, description, likes, and dislikes
- Same flow as Gemini 3 and Gemini 4 for consistent character handling

### Structural Differences from Other Flows

- **Most rigid structure** - arc template strictly controls progression
- **Beat-by-beat generation** - not a complete story per call
- **Requires compilation** - `storyCompileFlow` assembles final narrative
- **StoryType integration** - each story type has its own arc template
- **PromptConfig system** - prompts can be customized per configuration
- **Most sophisticated temperature** - combines arc progress (70%) + length (30%)

---

## Story Compile Flow

**File:** [story-compile-flow.ts](src/ai/flows/story-compile-flow.ts)

The compile flow handles two scenarios:

### Scenario 1: Gemini 3/4 Stories (Direct)

For stories from Gemini 3 or Gemini 4 flows:
```typescript
if (isGeminiMode && geminiFinalStory) {
  // Story already complete - just resolve placeholders
  const resolvedStoryText = await replacePlaceholdersWithDescriptions(geminiFinalStory);
  // Create Story document directly
}
```

### Scenario 2: Story Beat Stories (Full Compilation)

For Story Beat flow stories:
1. Load all messages from conversation history
2. Build story skeleton from filtered messages
3. Call AI to rewrite into cohesive narrative
4. Parse and validate JSON output
5. Create Story document with metadata

**Prompt:**
```
You are a master storyteller who specializes in compiling interactive
chat sessions into a single, beautifully written story for a very young child.
```

**Temperature:** **0.5** (focused, consistent output)

---

## Shared Infrastructure

### Unified Character Creation Flow

**File:** [create-story-character-flow.ts](src/ai/flows/create-story-character-flow.ts)

All story flows (Gemini 3, Gemini 4, and Story Beat) use a single, unified character creation flow to ensure consistent character handling with proper pronoun generation.

**API Endpoint:** `/api/characters/create`

**Flow:** `createStoryCharacterFlow`

```typescript
// Input
{
  sessionId: string,
  parentUid: string,
  childId: string,
  characterLabel: string,        // e.g., "a friendly squirrel who loves acorns"
  characterName: string,         // e.g., "Nutsy" (optional - AI can generate)
  characterType: 'Family' | 'Friend' | 'Pet' | 'Toy' | 'Other',
  storyContext: string,          // Current story context for AI
  childAge: number | null,
  generateAvatar: boolean        // Whether to trigger avatar generation
}

// Output
{
  characterId: string,           // Firestore document ID
  displayName: string,           // Generated or provided name
  pronouns: string,              // e.g., "he/him", "she/her", "they/them"
  description: string,
  likes: string[],
  dislikes: string[]
}
```

**Key Features:**
- Uses `generateCharacterProfile()` to generate **pronouns**, description, likes, and dislikes
- Creates character document in Firestore with full profile
- Updates session's `supportingCharacterIds` array
- Backward compatible via `gemini4CreateCharacterFlow` alias

### Story Context Builder

**File:** [story-context-builder.ts](src/lib/story-context-builder.ts)

Loads and formats context for all flows:
- Main child profile with preferences
- Siblings (other children of same parent)
- Available characters (including main character if specified)
- Calculates child age from date of birth

### System Message Builder

**File:** [build-story-system-message.ts](src/lib/build-story-system-message.ts)

Generates unified system prompts with:
- Role definition ("master storyteller")
- Child profile and age-appropriate guidance
- Character roster with placeholder IDs
- Character creation guidelines
- Flow-specific instructions

### Placeholder Resolution

**File:** [resolve-placeholders.server.ts](src/lib/resolve-placeholders.server.ts)

Handles `$$entityId$$` placeholder replacement:
- `resolveEntitiesInText()` - builds entity map from text
- `replacePlaceholdersInText()` - replaces IDs with display names
- `extractEntityMetadataFromText()` - extracts entity info for UI

---

## Comparison Summary

| Aspect | Wizard | Gemini 3 | Gemini 4 | Story Beat |
|--------|--------|----------|----------|------------|
| **State Model** | Stateless | Stateful | Stateful (Chat API) | Stateful |
| **Temperature** | 0.7-0.8 | 0.9 | 0.85 | Configurable |
| **Max Steps** | 4 fixed | ~15 messages | 6-8 questions | Arc steps |
| **Character Creation** | No | Yes (unified) | Yes (unified) | Yes (unified) |
| **Completion Logic** | Fixed count | Message-based | Question count | Arc-driven |
| **Output per Call** | Q or Story | Q or Story | Q or Story | Single beat |
| **Needs Compilation** | No | Optional | Optional | **Required** |
| **Creative Freedom** | Low | High | Medium | Low |
| **Structure** | Minimal | None | Phase-guided | Arc-template |
| **Best For** | Quick generation | Creative exploration | Age-appropriate guidance | Incremental co-creation |
