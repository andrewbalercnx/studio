import { NextResponse } from 'next/server';
import { initFirebaseAdminApp } from '@/firebase/admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { requireParentOrAdminUser } from '@/lib/server-auth';
import { AuthError } from '@/lib/auth-error';
import type { StoryGenerator } from '@/lib/types';

/**
 * Default prompts for each generator.
 * These are the same prompts that are hardcoded in the flow files as fallbacks.
 * Pre-populating them in the seed makes them visible and editable in the admin UI.
 */
const DEFAULT_WIZARD_PROMPTS = {
  questionGeneration: `You are a friendly Story Wizard who helps a young child create a story by asking simple multiple-choice questions.

CHILD'S PROFILE:
{{ageDescription}}

CONTEXT:
{{context}}

INSTRUCTIONS:
1. Based on the conversation above (if any), devise the *next* simple, fun question to ask the child. Questions should guide the story's theme, setting, or a simple plot point.
2. Create 2 to 4 short, imaginative choices for the child to pick from.
3. Keep questions and choices very simple (a few words).
4. You MUST output a valid JSON object with the following structure, and nothing else:
   {
     "question": "The next simple question for the child",
     "choices": [
       { "text": "Choice one" },
       { "text": "Choice two" }
     ]
   }`,
  storyGeneration: `You are a master storyteller for young children. Your task is to write a complete, short story based on a child's choices from the conversation above.

CHILD'S PROFILE:
{{ageDescription}}

CONTEXT:
{{context}}

INSTRUCTIONS:
1. Write a complete, gentle, and engaging story of about 5-7 paragraphs.
2. The story MUST use the character placeholders (e.g., $$character-id$$) instead of their names. The main character (the child) is $$CHILD_ID_PLACEHOLDER$$.
3. The story should be simple and easy for a young child to understand.
4. Conclude the story with a happy and reassuring ending.
5. You MUST output a valid JSON object with the following structure, and nothing else:
   {
     "title": "A suitable title for the story",
     "vibe": "A one-word vibe for the story (e.g., funny, magical, adventure)",
     "storyText": "The full story text, using $$document-id$$ for characters."
   }`,
};

const DEFAULT_GEMINI3_PROMPTS = {
  systemPrompt: `{{systemMessage}}

=== GEMINI 3 MODE ===
You have complete creative freedom to craft an amazing story through conversation.
Ask creative questions, build the story based on answers, and guide toward a satisfying conclusion.
{{temperatureGuidance}}

=== CURRENT SESSION ===
Child's inspirations: {{childPreferenceSummary}}

{{sessionContext}}

=== OUTPUT FORMAT ===
When CONTINUING: { "question": "...", "options": [...], "isStoryComplete": false, "finalStory": null }
When ENDING: { "question": "", "options": [], "isStoryComplete": true, "finalStory": "complete story (5-7 paragraphs)" }`,
};

const DEFAULT_GEMINI4_PROMPTS = {
  systemPrompt: `{{systemMessage}}

=== GEMINI 4 MODE ===
Guide the child through a structured story creation with focused questions.
Provide 4 options: A, B, C (story choices) and M ("Tell me more").
{{phaseGuidance}}

=== CURRENT SESSION ===
Child's inspirations: {{childPreferenceSummary}}

=== OUTPUT FORMAT ===
{
  "question": "...",
  "options": [{ "id": "A", "text": "...", "isMoreOption": false, "introducesCharacter": false, "newCharacterName": "", "newCharacterLabel": "", "newCharacterType": "", "existingCharacterId": "" }],
  "isStoryComplete": false,
  "finalStory": "",
  "questionPhase": "opening|setting|characters|conflict|resolution|complete"
}

When story complete: question="", options=[], isStoryComplete=true, finalStory="full story with $$id$$ placeholders"`,
  phase_opening: `**OPENING QUESTION (Phase 1/{{maxQuestions}})**
Ask an exciting opening question to understand what kind of adventure the child wants.
Focus on: What does $$childId$$ want to do today? Where do they want to go?
Include options that reference existing characters if available.`,
  phase_setting: `**SETTING QUESTION (Phase 2/{{maxQuestions}})**
Build on their first choice. Establish where the story takes place.
Focus on: Describe the setting with sensory details. What does $$childId$$ see, hear, smell?`,
  phase_characters: `**CHARACTER QUESTION (Phase 3/{{maxQuestions}})**
Introduce or involve characters in the story.
Focus on: Who does $$childId$$ meet? Consider siblings and existing characters.
Options should involve known characters or introduce new ones.`,
  phase_conflict: `**PROBLEM/CONFLICT QUESTION (Phase 4/{{maxQuestions}})**
Introduce a challenge or exciting situation.
Focus on: What problem arises? What needs to be solved or discovered?`,
  phase_action: `**ACTION QUESTION (Phase 5/{{maxQuestions}})**
The child takes action to address the challenge.
Focus on: How does $$childId$$ respond? What do they decide to do?`,
  phase_resolution: `**RESOLUTION QUESTION (Final Phase)**
Time to wrap up the story with a satisfying conclusion.
Focus on: How does the adventure end? What did $$childId$$ learn or accomplish?
After this response, you should complete the story.`,
  phase_development: `**DEVELOPMENT QUESTION (Phase {{phase}}/{{maxQuestions}})**
Continue developing the story based on their choices.
Build tension or add interesting developments.`,
};

const DEFAULT_FRIENDS_PROMPTS = {
  characterProposal: `You are a friendly story helper for children.

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
}`,
  scenarioGeneration: `You are creating WILDLY IMAGINATIVE adventure scenarios for a children's story!

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
6. CRITICAL: Write using the characters' real names exactly as shown above. Do NOT use any special formatting, codes, or placeholders - just plain names like "Emma", "Dad", "Fluffy".

OUTPUT FORMAT:
{
  "scenarios": [
    { "id": "A", "title": "Catchy, exciting title!", "description": "1-2 sentences capturing the magical premise and what makes it exciting" },
    { "id": "B", "title": "...", "description": "..." }
  ]
}`,
  synopsisGeneration: `You are a children's story writer drafting story ideas.

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
5. CRITICAL: Write using the characters' real names exactly as shown above. Do NOT use any special formatting, codes, or placeholders - just plain names like "Emma", "Dad", "Fluffy".

OUTPUT FORMAT:
{
  "synopses": [
    { "id": "A", "title": "Story Title", "summary": "2-3 sentence synopsis..." },
    { "id": "B", "title": "...", "summary": "..." }
  ]
}`,
  storyGeneration: `You are a master storyteller for young children.

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
}`,
};

/**
 * Default story generator configurations.
 * These define the capabilities and styling for each story generation mode.
 */
const defaultGenerators: Omit<StoryGenerator, 'createdAt' | 'updatedAt'>[] = [
  {
    id: 'wizard',
    name: 'Story Wizard',
    description: 'A 4-question wizard that gathers story preferences before generating a complete story.',
    status: 'live',
    enabledForKids: true,
    capabilities: {
      minChoices: 2,
      maxChoices: 4,
      supportsMoreOptions: false,
      supportsCharacterIntroduction: false,
      supportsFinalStory: true,
      requiresStoryType: false,
    },
    apiEndpoint: '/api/storyWizard',
    styling: {
      gradient: 'from-purple-50 to-pink-50',
      darkGradient: 'dark:from-purple-950 dark:to-pink-950',
      icon: 'Sparkles',
      loadingMessage: 'The wizard is creating your adventure...',
    },
    prompts: DEFAULT_WIZARD_PROMPTS,
  },
  {
    id: 'gemini3',
    name: 'Gemini Free',
    description: 'Open-ended creative story generation with full AI freedom.',
    status: 'live',
    enabledForKids: true,
    capabilities: {
      minChoices: 2,
      maxChoices: 4,
      supportsMoreOptions: false,
      supportsCharacterIntroduction: true,
      supportsFinalStory: true,
      requiresStoryType: false,
    },
    apiEndpoint: '/api/gemini3',
    styling: {
      gradient: 'from-blue-50 to-cyan-50',
      darkGradient: 'dark:from-blue-950 dark:to-cyan-950',
      icon: 'Sparkles',
      loadingMessage: 'Gemini is crafting your story...',
    },
    prompts: DEFAULT_GEMINI3_PROMPTS,
  },
  {
    id: 'gemini4',
    name: 'Guided Story',
    description: 'AI-guided story creation with structured phases (opening, setting, characters, conflict, resolution).',
    status: 'live',
    enabledForKids: true,
    capabilities: {
      minChoices: 2,
      maxChoices: 4,
      supportsMoreOptions: true,
      supportsCharacterIntroduction: true,
      supportsFinalStory: true,
      requiresStoryType: false, // Uses internal phase system, not story types
    },
    apiEndpoint: '/api/gemini4',
    styling: {
      gradient: 'from-emerald-50 to-teal-50',
      darkGradient: 'dark:from-emerald-950 dark:to-teal-950',
      icon: 'Sparkles',
      loadingMessage: 'Creating the next chapter...',
    },
    prompts: DEFAULT_GEMINI4_PROMPTS,
  },
  {
    id: 'beat',
    name: 'Story Beats',
    description: 'Turn-by-turn story generation with structured narrative beats and arcs.',
    status: 'live',
    capabilities: {
      minChoices: 2,
      maxChoices: 4,
      supportsMoreOptions: true,
      supportsCharacterIntroduction: true,
      supportsFinalStory: false,
      requiresStoryType: true,
    },
    apiEndpoint: '/api/storyBeat',
    styling: {
      gradient: 'from-indigo-50 to-violet-50',
      darkGradient: 'dark:from-indigo-950 dark:to-violet-950',
      icon: 'Sparkles',
      loadingMessage: 'Creating the next story beat...',
    },
    // Note: beat generator uses storyType prompts, not generator-level prompts
  },
  {
    id: 'friends',
    name: 'Fun with my friends',
    description: 'Create an adventure story featuring your characters and friends. Choose your companions, pick a scenario, and watch your story come to life!',
    status: 'live',
    enabledForKids: true,
    capabilities: {
      minChoices: 3,
      maxChoices: 5,
      supportsMoreOptions: true,
      supportsCharacterIntroduction: false, // Characters selected upfront
      supportsFinalStory: true,
      requiresStoryType: false,
    },
    apiEndpoint: '/api/storyFriends',
    styling: {
      gradient: 'from-amber-50 to-orange-50',
      darkGradient: 'dark:from-amber-950 dark:to-orange-950',
      icon: 'Users',
      loadingMessage: 'Gathering your friends for an adventure...',
    },
    prompts: DEFAULT_FRIENDS_PROMPTS,
  },
];

/**
 * Seeds the storyGenerators collection with default configurations.
 * Admin-only endpoint.
 */
export async function POST(request: Request) {
  try {
    await initFirebaseAdminApp();
    const user = await requireParentOrAdminUser(request);

    if (!user.claims.isAdmin) {
      return NextResponse.json(
        { ok: false, errorMessage: 'Admin access required' },
        { status: 403 }
      );
    }

    const firestore = getFirestore();
    const batch = firestore.batch();
    const results: { id: string; action: 'created' | 'updated' }[] = [];

    for (const generator of defaultGenerators) {
      const docRef = firestore.collection('storyGenerators').doc(generator.id);
      const existingDoc = await docRef.get();

      if (existingDoc.exists) {
        // Update existing document (preserve createdAt, backgroundMusic, and user-configured prompts)
        // Use set with merge to ensure nested objects like capabilities are fully replaced
        const existingData = existingDoc.data();
        // For prompts: if user has customized them, keep their version; otherwise use defaults
        const promptsToUse = existingData?.prompts && Object.keys(existingData.prompts).length > 0
          ? existingData.prompts
          : generator.prompts;
        batch.set(docRef, {
          ...generator,
          // Preserve user-configured fields (only include if they exist to avoid undefined values)
          ...(existingData?.backgroundMusic && { backgroundMusic: existingData.backgroundMusic }),
          ...(promptsToUse && { prompts: promptsToUse }),
          ...(existingData?.createdAt && { createdAt: existingData.createdAt }),
          updatedAt: FieldValue.serverTimestamp(),
        }, { merge: false }); // Replace entire document to ensure capabilities is updated
        results.push({ id: generator.id, action: 'updated' });
      } else {
        // Create new document
        batch.set(docRef, {
          ...generator,
          createdAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        });
        results.push({ id: generator.id, action: 'created' });
      }
    }

    await batch.commit();

    return NextResponse.json({
      ok: true,
      message: `Seeded ${results.length} story generators`,
      results,
    });

  } catch (error: any) {
    if (error instanceof AuthError) {
      return NextResponse.json(
        { ok: false, errorMessage: error.message },
        { status: error.status }
      );
    }

    console.error('[admin/story-generators/seed] Error:', error);
    return NextResponse.json(
      { ok: false, errorMessage: error?.message || 'Unexpected error' },
      { status: 500 }
    );
  }
}
