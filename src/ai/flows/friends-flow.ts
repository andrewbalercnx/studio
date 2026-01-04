'use server';

import { ai } from '@/ai/genkit';
import { initFirebaseAdminApp } from '@/firebase/admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { z } from 'genkit';
import type {
  ChildProfile,
  Character,
  Story,
  StorySession,
  StoryGenerator,
  FriendsPhase,
  FriendsScenario,
  FriendsSynopsis,
  FriendsCharacterOption,
  AIModelName,
} from '@/lib/types';
import { logAIFlow } from '@/lib/ai-flow-logger';
import { replacePlaceholdersInText, type EntityMap } from '@/lib/resolve-placeholders.server';
import { buildStoryContext } from '@/lib/story-context-builder';
import { getGlobalPrefix } from '@/lib/global-prompt-config.server';

// ============================================================================
// Default Prompts (used when no custom prompt is set in Firestore)
// ============================================================================

const DEFAULT_CHARACTER_PROPOSAL_PROMPT = `You are a friendly story helper for children.

CHILD'S PROFILE:
{{ageDescription}}

AVAILABLE CHARACTERS FOR THE ADVENTURE:
{{availableCharacters}}

INSTRUCTIONS:
1. Select 2-5 characters from the available list who would make for an exciting adventure together.
2. Always include the main child as a character.
3. Choose a diverse mix (e.g., include a pet or toy if available, mix family and friends).
4. Consider what combinations would create interesting story dynamics.
5. Return your selection as a JSON object.

OUTPUT FORMAT:
{
  "proposedCharacterIds": ["id1", "id2", "id3"],
  "rationale": "A brief explanation of why these characters would have fun together"
}`;

const DEFAULT_SCENARIO_GENERATION_PROMPT = `You are creating WILDLY IMAGINATIVE adventure scenarios for a children's story!

CHILD'S PROFILE:
{{ageDescription}}

SELECTED CHARACTERS:
{{selectedCharacters}}

YOUR MISSION:
Create 3-4 absolutely delightful, wonderfully inventive adventure scenarios! Think like a child with boundless imagination - the more creative and unexpected, the better!

INSPIRATION (mix and match, or invent something entirely new!):
- Shrink down to ant-size and explore the garden as a jungle
- Discover the toys come alive at night and need help with a problem
- Find a rainbow bridge to a land made entirely of desserts
- A friendly dragon asks for help finding its lost treasure
- Get swept into a painting and explore the world inside
- Discover the pets can talk and have a secret mission
- Find a magic door in an unexpected place (closet, tree, puddle)
- Help the moon gather lost stars that fell to Earth
- Become superheroes for a day with silly but useful powers
- Explore an upside-down world where everything is backwards

GUIDELINES:
1. Be INVENTIVE - surprise and delight! Avoid generic "go to the park" scenarios.
2. Include a sense of wonder, magic, or whimsy in each option.
3. Make scenarios age-appropriate but never boring.
4. Each scenario should feel like the start of an amazing adventure!
5. Use the characters creatively - what unique role could each play?
6. IMPORTANT: Use the characters' actual names in descriptions, NOT placeholder syntax like $$id$$.

OUTPUT FORMAT:
{
  "scenarios": [
    { "id": "A", "title": "Catchy, exciting title!", "description": "1-2 sentences capturing the magical premise and what makes it exciting" },
    { "id": "B", "title": "...", "description": "..." }
  ]
}`;

const DEFAULT_SYNOPSIS_GENERATION_PROMPT = `You are a children's story writer drafting story ideas.

CHILD'S PROFILE:
{{ageDescription}}

SELECTED CHARACTERS:
{{selectedCharacters}}

CHOSEN SCENARIO:
{{selectedScenario}}

INSTRUCTIONS:
1. Write 3 brief story synopses based on the chosen scenario.
2. Each synopsis should be 2-3 sentences that capture the story arc.
3. Include a beginning, middle (with a small challenge), and happy ending.
4. Make each synopsis distinctly different while fitting the scenario.
5. Use the characters' actual names naturally in the synopses.
6. IMPORTANT: Do NOT use placeholder syntax like $$id$$ - use the real character names.

OUTPUT FORMAT:
{
  "synopses": [
    { "id": "A", "title": "Story Title", "summary": "2-3 sentence synopsis..." },
    { "id": "B", "title": "...", "summary": "..." }
  ]
}`;

const DEFAULT_STORY_GENERATION_PROMPT = `You are a master storyteller for young children.

CHILD'S PROFILE:
{{ageDescription}}

CHARACTERS (use $$id$$ placeholders in your story):
{{selectedCharacters}}

STORY SYNOPSIS:
{{selectedSynopsis}}

INSTRUCTIONS:
1. Write a complete, engaging story of 5-7 paragraphs based on the synopsis.
2. IMPORTANT: Use $$id$$ placeholders for character names (e.g., $$child-abc123$$).
3. The story should be simple and age-appropriate.
4. Include dialogue and action to make it engaging.
5. End with a happy, satisfying conclusion.
6. Keep paragraphs short for young readers.

OUTPUT FORMAT:
{
  "title": "The Story Title",
  "vibe": "One-word mood (e.g., magical, funny, adventurous)",
  "storyText": "The complete story text with $$id$$ placeholders..."
}`;

// ============================================================================
// Input/Output Types
// ============================================================================

export type FriendsFlowInput = {
  childId: string;
  sessionId: string;
  // For character selection phase
  action?: 'confirm_characters' | 'change_characters' | 'more_synopses';
  selectedCharacterIds?: string[];
  // For scenario/synopsis selection
  selectedOptionId?: string;
};

export type FriendsFlowOutput =
  | {
      state: 'character_selection';
      phase: FriendsPhase;
      question: string;
      proposedCharacters: FriendsCharacterOption[];
      availableCharacters: FriendsCharacterOption[];
      ok: true;
    }
  | {
      state: 'scenario_selection';
      phase: FriendsPhase;
      question: string;
      scenarios: FriendsScenario[];
      ok: true;
    }
  | {
      state: 'synopsis_selection';
      phase: FriendsPhase;
      question: string;
      synopses: FriendsSynopsis[];
      ok: true;
    }
  | {
      state: 'finished';
      phase: FriendsPhase;
      title: string;
      vibe: string;
      storyText: string;
      storyId: string;
      ok: true;
    }
  | {
      state: 'error';
      error: string;
      ok: false;
    };

// ============================================================================
// Zod Schemas for AI Output
// ============================================================================

const CharacterProposalSchema = z.object({
  proposedCharacterIds: z.array(z.string()),
  rationale: z.string(),
});

const ScenarioSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string(),
});

const ScenariosOutputSchema = z.object({
  scenarios: z.array(ScenarioSchema).min(2).max(5),
});

const SynopsisSchema = z.object({
  id: z.string(),
  title: z.string(),
  summary: z.string(),
});

const SynopsesOutputSchema = z.object({
  synopses: z.array(SynopsisSchema).min(2).max(4),
});

const StoryOutputSchema = z.object({
  title: z.string(),
  vibe: z.string(),
  storyText: z.string(),
});

// ============================================================================
// Helper Functions
// ============================================================================

function fillPromptTemplate(template: string, vars: Record<string, string>): string {
  let result = template;
  for (const [key, value] of Object.entries(vars)) {
    const placeholder = '{{' + key + '}}';
    while (result.includes(placeholder)) {
      result = result.replace(placeholder, value);
    }
  }
  return result;
}

function getChildAgeYears(child?: ChildProfile | null): number | null {
  if (!child?.dateOfBirth) return null;
  let dob: Date | null = null;
  if (typeof (child.dateOfBirth as any).toDate === 'function') {
    dob = (child.dateOfBirth as any).toDate();
  } else {
    const parsed = new Date(child.dateOfBirth as any);
    dob = isNaN(parsed.getTime()) ? null : parsed;
  }
  if (!dob) return null;
  const diff = Date.now() - dob.getTime();
  if (diff <= 0) return null;
  return Math.floor(diff / (1000 * 60 * 60 * 24 * 365.25));
}

async function loadGeneratorConfig(
  firestore: FirebaseFirestore.Firestore
): Promise<StoryGenerator | null> {
  try {
    const generatorDoc = await firestore.collection('storyGenerators').doc('friends').get();
    if (generatorDoc.exists) {
      return { id: generatorDoc.id, ...generatorDoc.data() } as StoryGenerator;
    }
  } catch (e) {
    console.warn('[friendsFlow] Failed to load generator config, using defaults:', e);
  }
  return null;
}

/**
 * Format character for display in user-facing scenarios/synopses.
 * Uses display name only (no placeholders) since these are selection options.
 */
function formatCharacterForDisplay(char: FriendsCharacterOption): string {
  return `- ${char.displayName}: ${char.type}`;
}

/**
 * Format character for story generation prompt.
 * Uses $$id$$ placeholders so the final story has resolvable placeholders.
 */
function formatCharacterForStory(char: FriendsCharacterOption): string {
  return `- $$${char.id}$$ (${char.displayName}): ${char.type}`;
}

/**
 * Default model and temperatures for friends flow prompts.
 */
const DEFAULT_MODEL: AIModelName = 'googleai/gemini-2.5-pro';
const DEFAULT_TEMPERATURES: Record<string, number> = {
  characterProposal: 0.8,
  scenarioGeneration: 1.2,  // Higher for more inventive scenarios
  synopsisGeneration: 0.9,
  storyGeneration: 0.7,
};

/**
 * Get the AI model and temperature for a specific prompt.
 * Uses per-prompt config if available, falls back to generator defaults, then hardcoded defaults.
 */
function getModelConfig(
  generator: StoryGenerator | null,
  promptKey: string
): { model: AIModelName; temperature: number } {
  // Per-prompt config takes priority
  const promptConfig = generator?.promptConfig?.[promptKey];

  // Get model: per-prompt -> generator default -> hardcoded default
  const model: AIModelName =
    promptConfig?.model ||
    generator?.defaultModel ||
    DEFAULT_MODEL;

  // Get temperature: per-prompt -> generator default -> hardcoded default for this prompt
  const temperature: number =
    promptConfig?.temperature ??
    generator?.defaultTemperature ??
    DEFAULT_TEMPERATURES[promptKey] ??
    0.8;

  return { model, temperature };
}

// ============================================================================
// Phase Handlers
// ============================================================================

async function initializeCharacterSelection(
  firestore: FirebaseFirestore.Firestore,
  session: StorySession,
  child: ChildProfile,
  generator: StoryGenerator | null,
  globalPrefix: string
): Promise<FriendsFlowOutput> {
  const flowName = 'friendsFlow:initCharacterSelection';

  // Load all available characters and siblings
  const parentUid = child.ownerParentUid;

  // Load siblings
  const siblingsSnap = await firestore
    .collection('children')
    .where('ownerParentUid', '==', parentUid)
    .get();

  const siblings = siblingsSnap.docs
    .map((doc) => ({ id: doc.id, ...doc.data() } as ChildProfile))
    .filter((c) => c.id !== session.childId && !c.deletedAt);

  // Load characters
  const charactersSnap = await firestore
    .collection('characters')
    .where('ownerParentUid', '==', parentUid)
    .get();

  const characters = charactersSnap.docs
    .map((doc) => ({ id: doc.id, ...doc.data() } as Character))
    .filter((c) => !c.deletedAt && (!c.childId || c.childId === session.childId));

  // Build available characters list
  const availableCharacters: FriendsCharacterOption[] = [
    // Main child always first
    {
      id: child.id,
      displayName: child.displayName,
      type: 'child',
      avatarUrl: child.avatarUrl,
      isSelected: true, // Main child always selected
    },
    // Siblings
    ...siblings.map((s) => ({
      id: s.id,
      displayName: s.displayName,
      type: 'sibling' as const,
      avatarUrl: s.avatarUrl,
      isSelected: false,
    })),
    // Characters
    ...characters.map((c) => ({
      id: c.id,
      displayName: c.displayName,
      type: c.type,
      avatarUrl: c.avatarUrl,
      isSelected: false,
    })),
  ];

  // Build prompt for AI to propose characters
  const childAge = getChildAgeYears(child);
  const ageDescription = childAge ? `The child is ${childAge} years old.` : "The child's age is unknown.";

  const availableCharsText = availableCharacters
    .map((c) => `- ID: ${c.id}, Name: ${c.displayName}, Type: ${c.type}`)
    .join('\n');

  const promptTemplate = generator?.prompts?.characterProposal || DEFAULT_CHARACTER_PROPOSAL_PROMPT;
  const basePrompt = fillPromptTemplate(promptTemplate, {
    ageDescription,
    availableCharacters: availableCharsText,
  });
  const fullPrompt = globalPrefix ? `${globalPrefix}\n\n${basePrompt}` : basePrompt;

  // Get model and temperature config
  const { model: modelName, temperature } = getModelConfig(generator, 'characterProposal');

  // Call AI to propose characters
  const startTime = Date.now();

  try {
    const response = await ai.generate({
      model: modelName,
      prompt: fullPrompt,
      output: { schema: CharacterProposalSchema },
      config: { temperature },
    });

    await logAIFlow({
      flowName,
      sessionId: session.id,
      parentId: child.ownerParentUid,
      prompt: fullPrompt,
      response,
      startTime,
      modelName,
    });

    const parsed = response.output;
    if (!parsed) {
      throw new Error('Failed to parse AI response');
    }

    // Mark proposed characters as selected
    const proposedIds = new Set(parsed.proposedCharacterIds);
    // Always include main child
    proposedIds.add(child.id);

    const proposedCharacters = availableCharacters.map((c) => ({
      ...c,
      isSelected: proposedIds.has(c.id),
    }));

    // Update session
    await firestore.collection('storySessions').doc(session.id).update({
      friendsPhase: 'character_selection',
      friendsProposedCharacterIds: Array.from(proposedIds),
      updatedAt: FieldValue.serverTimestamp(),
    });

    return {
      state: 'character_selection',
      phase: 'character_selection',
      question: "Here are some friends who'd love to go on an adventure with you!",
      proposedCharacters: proposedCharacters.filter((c) => c.isSelected),
      availableCharacters,
      ok: true,
    };
  } catch (e: any) {
    await logAIFlow({
      flowName,
      sessionId: session.id,
      parentId: child.ownerParentUid,
      prompt: fullPrompt,
      error: e,
      startTime,
      modelName,
    });
    throw e;
  }
}

async function handleScenarioGeneration(
  firestore: FirebaseFirestore.Firestore,
  session: StorySession,
  child: ChildProfile,
  generator: StoryGenerator | null,
  globalPrefix: string
): Promise<FriendsFlowOutput> {
  const flowName = 'friendsFlow:scenarioGeneration';

  const rawSelectedIds = session.friendsSelectedCharacterIds || [];
  // Filter out empty/invalid IDs to prevent Firestore "documentPath must be non-empty" errors
  const selectedIds = rawSelectedIds.filter((id: string) => id && typeof id === 'string' && id.trim().length > 0);

  // Load selected character details
  const allCharacters: FriendsCharacterOption[] = [];

  for (const id of selectedIds) {
    // Try children first
    const childDoc = await firestore.collection('children').doc(id).get();
    if (childDoc.exists) {
      const data = childDoc.data() as ChildProfile;
      allCharacters.push({
        id,
        displayName: data.displayName,
        type: id === session.childId ? 'child' : 'sibling',
        avatarUrl: data.avatarUrl,
        isSelected: true,
      });
      continue;
    }

    // Try characters
    const charDoc = await firestore.collection('characters').doc(id).get();
    if (charDoc.exists) {
      const data = charDoc.data() as Character;
      allCharacters.push({
        id,
        displayName: data.displayName,
        type: data.type,
        avatarUrl: data.avatarUrl,
        isSelected: true,
      });
    }
  }

  const childAge = getChildAgeYears(child);
  const ageDescription = childAge ? `The child is ${childAge} years old.` : "The child's age is unknown.";

  // Use display names (not placeholders) for scenario generation since these are user-facing selections
  const selectedCharsText = allCharacters.map(formatCharacterForDisplay).join('\n');

  const promptTemplate = generator?.prompts?.scenarioGeneration || DEFAULT_SCENARIO_GENERATION_PROMPT;
  const basePrompt = fillPromptTemplate(promptTemplate, {
    ageDescription,
    selectedCharacters: selectedCharsText,
  });
  const fullPrompt = globalPrefix ? `${globalPrefix}\n\n${basePrompt}` : basePrompt;

  // Get model and temperature config
  const { model: modelName, temperature } = getModelConfig(generator, 'scenarioGeneration');

  const startTime = Date.now();

  try {
    const response = await ai.generate({
      model: modelName,
      prompt: fullPrompt,
      output: { schema: ScenariosOutputSchema },
      config: { temperature },
    });

    await logAIFlow({
      flowName,
      sessionId: session.id,
      parentId: child.ownerParentUid,
      prompt: fullPrompt,
      response,
      startTime,
      modelName,
    });

    const parsed = response.output;
    if (!parsed) {
      throw new Error('Failed to parse AI response');
    }

    // Update session
    await firestore.collection('storySessions').doc(session.id).update({
      friendsPhase: 'scenario_selection',
      friendsScenarios: parsed.scenarios,
      updatedAt: FieldValue.serverTimestamp(),
    });

    return {
      state: 'scenario_selection',
      phase: 'scenario_selection',
      question: 'What kind of adventure should we have?',
      scenarios: parsed.scenarios,
      ok: true,
    };
  } catch (e: any) {
    await logAIFlow({
      flowName,
      sessionId: session.id,
      parentId: child.ownerParentUid,
      prompt: fullPrompt,
      error: e,
      startTime,
      modelName,
    });
    throw e;
  }
}

async function handleSynopsisGeneration(
  firestore: FirebaseFirestore.Firestore,
  session: StorySession,
  child: ChildProfile,
  generator: StoryGenerator | null,
  globalPrefix: string,
  isMoreRequest: boolean = false
): Promise<FriendsFlowOutput> {
  const flowName = 'friendsFlow:synopsisGeneration';

  const rawSelectedIds = session.friendsSelectedCharacterIds || [];
  // Filter out empty/invalid IDs to prevent Firestore "documentPath must be non-empty" errors
  const selectedIds = rawSelectedIds.filter((id: string) => id && typeof id === 'string' && id.trim().length > 0);
  const scenarios = session.friendsScenarios || [];
  const selectedScenarioId = session.friendsSelectedScenarioId;

  const selectedScenario = scenarios.find((s) => s.id === selectedScenarioId);
  if (!selectedScenario) {
    return { state: 'error', error: 'No scenario selected', ok: false };
  }

  // Load selected character details
  const allCharacters: FriendsCharacterOption[] = [];

  for (const id of selectedIds) {
    const childDoc = await firestore.collection('children').doc(id).get();
    if (childDoc.exists) {
      const data = childDoc.data() as ChildProfile;
      allCharacters.push({
        id,
        displayName: data.displayName,
        type: id === session.childId ? 'child' : 'sibling',
        avatarUrl: data.avatarUrl,
        isSelected: true,
      });
      continue;
    }

    const charDoc = await firestore.collection('characters').doc(id).get();
    if (charDoc.exists) {
      const data = charDoc.data() as Character;
      allCharacters.push({
        id,
        displayName: data.displayName,
        type: data.type,
        avatarUrl: data.avatarUrl,
        isSelected: true,
      });
    }
  }

  const childAge = getChildAgeYears(child);
  const ageDescription = childAge ? `The child is ${childAge} years old.` : "The child's age is unknown.";

  // Use display names (not placeholders) for synopsis generation since these are user-facing selections
  const selectedCharsText = allCharacters.map(formatCharacterForDisplay).join('\n');
  const scenarioText = `${selectedScenario.title}: ${selectedScenario.description}`;

  let promptTemplate = generator?.prompts?.synopsisGeneration || DEFAULT_SYNOPSIS_GENERATION_PROMPT;

  // Add "more" instruction if this is a re-generation
  if (isMoreRequest) {
    promptTemplate += '\n\nIMPORTANT: Generate completely NEW and DIFFERENT synopses from any previous ones.';
  }

  const basePrompt = fillPromptTemplate(promptTemplate, {
    ageDescription,
    selectedCharacters: selectedCharsText,
    selectedScenario: scenarioText,
  });
  const fullPrompt = globalPrefix ? `${globalPrefix}\n\n${basePrompt}` : basePrompt;

  // Get model and temperature config
  const { model: modelName, temperature: baseTemperature } = getModelConfig(generator, 'synopsisGeneration');
  // Boost temperature for "more" requests to increase variety
  const temperature = isMoreRequest ? Math.min(baseTemperature + 0.2, 2.0) : baseTemperature;

  const startTime = Date.now();

  try {
    const response = await ai.generate({
      model: modelName,
      prompt: fullPrompt,
      output: { schema: SynopsesOutputSchema },
      config: { temperature },
    });

    await logAIFlow({
      flowName,
      sessionId: session.id,
      parentId: child.ownerParentUid,
      prompt: fullPrompt,
      response,
      startTime,
      modelName,
    });

    const parsed = response.output;
    if (!parsed) {
      throw new Error('Failed to parse AI response');
    }

    // Update session - replace synopses (not append)
    await firestore.collection('storySessions').doc(session.id).update({
      friendsPhase: 'synopsis_selection',
      friendsSynopses: parsed.synopses,
      friendsSelectedSynopsisId: null, // Clear previous selection
      updatedAt: FieldValue.serverTimestamp(),
    });

    return {
      state: 'synopsis_selection',
      phase: 'synopsis_selection',
      question: 'Which story sounds the most fun?',
      synopses: parsed.synopses,
      ok: true,
    };
  } catch (e: any) {
    await logAIFlow({
      flowName,
      sessionId: session.id,
      parentId: child.ownerParentUid,
      prompt: fullPrompt,
      error: e,
      startTime,
      modelName,
    });
    throw e;
  }
}

async function handleStoryGeneration(
  firestore: FirebaseFirestore.Firestore,
  session: StorySession,
  child: ChildProfile,
  generator: StoryGenerator | null,
  globalPrefix: string
): Promise<FriendsFlowOutput> {
  const flowName = 'friendsFlow:storyGeneration';

  const rawSelectedIds = session.friendsSelectedCharacterIds || [];
  // Filter out empty/invalid IDs to prevent Firestore "documentPath must be non-empty" errors
  const selectedIds = rawSelectedIds.filter((id: string) => id && typeof id === 'string' && id.trim().length > 0);
  const synopses = session.friendsSynopses || [];
  const selectedSynopsisId = session.friendsSelectedSynopsisId;

  const selectedSynopsis = synopses.find((s) => s.id === selectedSynopsisId);
  if (!selectedSynopsis) {
    return { state: 'error', error: 'No synopsis selected', ok: false };
  }

  // Load selected character details for the prompt
  const allCharacters: FriendsCharacterOption[] = [];

  for (const id of selectedIds) {
    const childDoc = await firestore.collection('children').doc(id).get();
    if (childDoc.exists) {
      const data = childDoc.data() as ChildProfile;
      allCharacters.push({
        id,
        displayName: data.displayName,
        type: id === session.childId ? 'child' : 'sibling',
        avatarUrl: data.avatarUrl,
        isSelected: true,
      });
      continue;
    }

    const charDoc = await firestore.collection('characters').doc(id).get();
    if (charDoc.exists) {
      const data = charDoc.data() as Character;
      allCharacters.push({
        id,
        displayName: data.displayName,
        type: data.type,
        avatarUrl: data.avatarUrl,
        isSelected: true,
      });
    }
  }

  const childAge = getChildAgeYears(child);
  const ageDescription = childAge ? `The child is ${childAge} years old.` : "The child's age is unknown.";

  // Use placeholder format for story generation - these get resolved after the story is generated
  const selectedCharsText = allCharacters.map(formatCharacterForStory).join('\n');
  const synopsisText = `${selectedSynopsis.title}: ${selectedSynopsis.summary}`;

  const promptTemplate = generator?.prompts?.storyGeneration || DEFAULT_STORY_GENERATION_PROMPT;
  const basePrompt = fillPromptTemplate(promptTemplate, {
    ageDescription,
    selectedCharacters: selectedCharsText,
    selectedSynopsis: synopsisText,
  });
  const fullPrompt = globalPrefix ? `${globalPrefix}\n\n${basePrompt}` : basePrompt;

  // Get model and temperature config
  const { model: modelName, temperature } = getModelConfig(generator, 'storyGeneration');

  const startTime = Date.now();

  try {
    const response = await ai.generate({
      model: modelName,
      prompt: fullPrompt,
      output: { schema: StoryOutputSchema },
      config: { temperature },
    });

    await logAIFlow({
      flowName,
      sessionId: session.id,
      parentId: child.ownerParentUid,
      prompt: fullPrompt,
      response,
      startTime,
      modelName,
    });

    const parsed = response.output;
    if (!parsed) {
      throw new Error('Failed to parse AI response');
    }

    // Build entity map for placeholder resolution
    // Cast to EntityMap - replacePlaceholdersInText only uses displayName, not the full document
    const entityMap: EntityMap = new Map();
    for (const char of allCharacters) {
      entityMap.set(char.id, { displayName: char.displayName, document: char as unknown as Character });
    }

    const resolvedStoryText = await replacePlaceholdersInText(parsed.storyText, entityMap);

    // Create the Story document
    const storyRef = firestore.collection('stories').doc(session.id);
    const storyPayload: Story = {
      storySessionId: session.id,
      childId: session.childId,
      parentUid: child.ownerParentUid,
      storyText: resolvedStoryText,
      status: 'text_ready',
      metadata: {
        title: parsed.title,
        vibe: parsed.vibe,
      },
      actors: selectedIds,
      pageGeneration: { status: 'idle' },
      imageGeneration: { status: 'idle' },
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    };
    await storyRef.set(storyPayload, { merge: true });

    // Update session to completed
    await firestore.collection('storySessions').doc(session.id).update({
      status: 'completed',
      friendsPhase: 'complete',
      storyTitle: parsed.title,
      storyVibe: parsed.vibe,
      actors: selectedIds,
      updatedAt: FieldValue.serverTimestamp(),
    });

    return {
      state: 'finished',
      phase: 'complete',
      title: parsed.title,
      vibe: parsed.vibe,
      storyText: resolvedStoryText,
      storyId: storyRef.id,
      ok: true,
    };
  } catch (e: any) {
    await logAIFlow({
      flowName,
      sessionId: session.id,
      parentId: child.ownerParentUid,
      prompt: fullPrompt,
      error: e,
      startTime,
      modelName,
    });
    throw e;
  }
}

// ============================================================================
// Main Flow
// ============================================================================

const friendsFlowInternal = ai.defineFlow(
  {
    name: 'friendsFlow',
    inputSchema: z.object({
      childId: z.string(),
      sessionId: z.string(),
      action: z.enum(['confirm_characters', 'change_characters', 'more_synopses']).optional(),
      selectedCharacterIds: z.array(z.string()).optional(),
      selectedOptionId: z.string().optional(),
    }),
    outputSchema: z.any(), // Complex discriminated union - validate manually
  },
  async (input) => {
    await initFirebaseAdminApp();
    const firestore = getFirestore();

    try {
      // 1. Fetch child profile
      const childRef = firestore.collection('children').doc(input.childId);
      const childSnap = await childRef.get();
      if (!childSnap.exists) {
        return { state: 'error', error: 'Child profile not found.', ok: false };
      }
      const child = { id: childSnap.id, ...childSnap.data() } as ChildProfile;

      // 2. Fetch session
      const sessionRef = firestore.collection('storySessions').doc(input.sessionId);
      const sessionSnap = await sessionRef.get();
      if (!sessionSnap.exists) {
        return { state: 'error', error: 'Session not found.', ok: false };
      }
      const session = { id: sessionSnap.id, ...sessionSnap.data() } as StorySession;

      // 3. Load generator config and global prefix
      const generator = await loadGeneratorConfig(firestore);
      const globalPrefix = await getGlobalPrefix();

      // 4. Determine current phase and handle accordingly
      const currentPhase = session.friendsPhase;

      // Initial call - start character selection
      if (!currentPhase || currentPhase === 'character_selection') {
        // Handle character confirmation
        if (input.action === 'confirm_characters') {
          // Use provided selection or the proposed selection
          const selectedIds = input.selectedCharacterIds || session.friendsProposedCharacterIds || [];

          // Ensure main child is always included
          if (!selectedIds.includes(input.childId)) {
            selectedIds.unshift(input.childId);
          }

          await sessionRef.update({
            friendsSelectedCharacterIds: selectedIds,
            supportingCharacterIds: selectedIds.filter((id) => id !== input.childId),
            actors: selectedIds,
            updatedAt: FieldValue.serverTimestamp(),
          });

          // Update session object for next phase
          session.friendsSelectedCharacterIds = selectedIds;

          // Move to scenario generation
          return handleScenarioGeneration(firestore, session, child, generator, globalPrefix);
        }

        // Initial request - propose characters
        return initializeCharacterSelection(firestore, session, child, generator, globalPrefix);
      }

      // Scenario selection phase
      if (currentPhase === 'scenario_selection') {
        if (input.selectedOptionId) {
          // Save selected scenario and move to synopsis generation
          await sessionRef.update({
            friendsSelectedScenarioId: input.selectedOptionId,
            updatedAt: FieldValue.serverTimestamp(),
          });
          session.friendsSelectedScenarioId = input.selectedOptionId;

          return handleSynopsisGeneration(firestore, session, child, generator, globalPrefix);
        }

        // Re-fetch scenarios
        return {
          state: 'scenario_selection',
          phase: 'scenario_selection',
          question: 'What kind of adventure should we have?',
          scenarios: session.friendsScenarios || [],
          ok: true,
        };
      }

      // Synopsis selection phase
      if (currentPhase === 'synopsis_selection') {
        // Handle "more synopses" request
        if (input.action === 'more_synopses') {
          return handleSynopsisGeneration(firestore, session, child, generator, globalPrefix, true);
        }

        if (input.selectedOptionId) {
          // Save selected synopsis and generate story
          await sessionRef.update({
            friendsSelectedSynopsisId: input.selectedOptionId,
            updatedAt: FieldValue.serverTimestamp(),
          });
          session.friendsSelectedSynopsisId = input.selectedOptionId;

          return handleStoryGeneration(firestore, session, child, generator, globalPrefix);
        }

        // Re-fetch synopses
        return {
          state: 'synopsis_selection',
          phase: 'synopsis_selection',
          question: 'Which story sounds the most fun?',
          synopses: session.friendsSynopses || [],
          ok: true,
        };
      }

      // Story generation phase - should not normally be called directly
      if (currentPhase === 'story_generation') {
        return handleStoryGeneration(firestore, session, child, generator, globalPrefix);
      }

      // Completed
      if (currentPhase === 'complete') {
        // Story already generated - return the existing story
        const storyDoc = await firestore.collection('stories').doc(input.sessionId).get();
        if (storyDoc.exists) {
          const story = storyDoc.data() as Story;
          return {
            state: 'finished',
            phase: 'complete',
            title: story.metadata?.title || 'Your Story',
            vibe: story.metadata?.vibe || 'adventure',
            storyText: story.storyText,
            storyId: storyDoc.id,
            ok: true,
          };
        }
      }

      return { state: 'error', error: 'Unknown phase state', ok: false };
    } catch (e: any) {
      console.error('Error in friendsFlow:', e);
      return { state: 'error', error: e.message || 'An unexpected error occurred.', ok: false };
    }
  }
);

export async function friendsFlow(input: FriendsFlowInput): Promise<FriendsFlowOutput> {
  return await friendsFlowInternal(input);
}
