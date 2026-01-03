
'use server';

import { ai } from '@/ai/genkit';
import { initFirebaseAdminApp } from '@/firebase/admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { z } from 'genkit';
import type { MessageData } from 'genkit';
import type { ChildProfile, Character, Story, StoryWizardAnswer, StoryWizardChoice, StoryWizardInput, StoryWizardOutput, StoryGenerator } from '@/lib/types';
import { logAIFlow } from '@/lib/ai-flow-logger';
import { replacePlaceholdersInText, type EntityMap } from '@/lib/resolve-placeholders.server';
import { buildStoryContext } from '@/lib/story-context-builder';
import { getGlobalPrefix } from '@/lib/global-prompt-config.server';

// Default prompts - used when no custom prompt is set in Firestore
const DEFAULT_QUESTION_GEN_PROMPT = `You are a friendly Story Wizard who helps a young child create a story by asking simple multiple-choice questions.

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
   }`;

const DEFAULT_STORY_GEN_PROMPT = `You are a master storyteller for young children. Your task is to write a complete, short story based on a child's choices from the conversation above.

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
   }`;

/**
 * Fills in template variables in a prompt string
 * Variables use {{variableName}} syntax
 */
function fillPromptTemplate(template: string, vars: Record<string, string>): string {
  let result = template;
  for (const [key, value] of Object.entries(vars)) {
    // Use a simple string replace approach to avoid regex issues
    const placeholder = '{{' + key + '}}';
    while (result.includes(placeholder)) {
      result = result.replace(placeholder, value);
    }
  }
  // Special handling for CHILD_ID_PLACEHOLDER in story generation
  if (vars['childId']) {
    result = result.replace(/\$\$CHILD_ID_PLACEHOLDER\$\$/g, `$$${vars['childId']}$$`);
  }
  return result;
}

/**
 * Load generator config from Firestore
 */
async function loadGeneratorConfig(firestore: FirebaseFirestore.Firestore): Promise<StoryGenerator | null> {
  try {
    const generatorDoc = await firestore.collection('storyGenerators').doc('wizard').get();
    if (generatorDoc.exists) {
      return { id: generatorDoc.id, ...generatorDoc.data() } as StoryGenerator;
    }
  } catch (e) {
    console.warn('[storyWizardFlow] Failed to load generator config, using defaults:', e);
  }
  return null;
}


// Helper to get child's age in years
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

const StoryWizardChoiceSchema = z.object({
  text: z.string().describe('A short, child-friendly option for the story.'),
});

const StoryWizardAnswerSchema = z.object({
  question: z.string(),
  answer: z.string(),
});

const StoryWizardInputSchema = z.object({
  childId: z.string(),
  sessionId: z.string(),
  answers: z.array(StoryWizardAnswerSchema).optional().default([]),
});

// Internal schema for final story generation output
const WizardStoryGenOutputSchema = z.object({
  title: z.string().describe('A suitable title for the story'),
  vibe: z.string().describe('A one-word vibe for the story (e.g., funny, magical, adventure)'),
  storyText: z.string().describe('The full story text, using $$document-id$$ for characters'),
});

// Internal schema for question generation output
const WizardQuestionGenOutputSchema = z.object({
  question: z.string().describe('The next simple question for the child'),
  choices: z.array(StoryWizardChoiceSchema).min(2).max(4).describe('2-4 short, imaginative choices'),
});

const StoryWizardOutputSchema = z.discriminatedUnion('state', [
  z.object({
    state: z.literal('asking'),
    question: z.string().describe('The next question to ask the child.'),
    choices: z.array(StoryWizardChoiceSchema).min(2).max(4).describe('A list of choices for the child to pick from.'),
    answers: z.array(StoryWizardAnswerSchema),
    ok: z.literal(true),
  }),
  z.object({
    state: z.literal('finished'),
    title: z.string().describe('A suitable title for the generated story.'),
    vibe: z.string().describe('The overall vibe or genre of the story.'),
    storyText: z.string().describe('The complete, generated story text.'),
    storyId: z.string().describe('The ID of the created Story document.'),
    ok: z.literal(true),
  }),
  z.object({
    state: z.literal('error'),
    error: z.string(),
    ok: z.literal(false),
  }),
]);


const storyWizardFlowInternal = ai.defineFlow(
  {
    name: 'storyWizardFlow',
    inputSchema: StoryWizardInputSchema,
    outputSchema: StoryWizardOutputSchema,
  },
  async ({ childId, sessionId, answers }) => {
    const flowName = 'storyWizardFlow';
    await initFirebaseAdminApp();
    const firestore = getFirestore();

    const buildCharacterDescription = (character: Character) => {
        const likes = character.likes?.length ? `, likes ${character.likes.join(', ')}` : '';
        return `${character.displayName} (a ${character.type}${likes})`;
    };


    try {
      // 1. Fetch child profile
      const childRef = firestore.collection('children').doc(childId);
      const childSnap = await childRef.get();
      if (!childSnap.exists) {
        return { state: 'error' as const, error: 'Child profile not found.', ok: false as const };
      }
      const child = childSnap.data() as ChildProfile;

      // 2. Fetch session to get mainCharacterId
      const sessionRef = firestore.collection('storySessions').doc(sessionId);
      const sessionSnap = await sessionRef.get();
      const session = sessionSnap.exists ? sessionSnap.data() : null;

      // 3. Load unified story context (child, siblings, characters)
      const { data: contextData, formatted: contextFormatted } = await buildStoryContext(
        child.ownerParentUid,
        childId,
        session?.mainCharacterId
      );

      const childAge = contextData.childAge;
      const ageDescription = childAge ? `The child is ${childAge} years old.` : "The child's age is unknown.";

      const MAX_QUESTIONS = 4;

      // Fetch global prompt prefix once for this flow
      const globalPrefix = await getGlobalPrefix();

      // Load generator config for custom prompts
      const generator = await loadGeneratorConfig(firestore);
      const templateVars = {
        ageDescription,
        context: contextFormatted.fullContext,
        childId,
      };

      if (answers.length >= MAX_QUESTIONS) {
        // 3. All questions answered, generate the final story
        // Build messages array from the wizard Q&A history
        const wizardMessages: MessageData[] = answers.flatMap(a => [
          { role: 'model' as const, content: [{ text: a.question }] },
          { role: 'user' as const, content: [{ text: a.answer }] },
        ]);

        // Use custom prompt from Firestore if available, otherwise use default
        const storyGenPromptTemplate = generator?.prompts?.storyGeneration || DEFAULT_STORY_GEN_PROMPT;
        const baseStoryGenSystemPrompt = fillPromptTemplate(storyGenPromptTemplate, templateVars);
        const storyGenSystemPrompt = globalPrefix ? `${globalPrefix}\n\n${baseStoryGenSystemPrompt}` : baseStoryGenSystemPrompt;

        let llmResponse;
        const startTime = Date.now();
        const modelName = 'googleai/gemini-2.5-pro';
        try {
          // Using output parameter for structured schema validation
          llmResponse = await ai.generate({
            model: modelName,
            system: storyGenSystemPrompt,
            messages: wizardMessages,
            output: { schema: WizardStoryGenOutputSchema },
            config: { temperature: 0.7 },
          });
          await logAIFlow({ flowName: `${flowName}:generateStory`, sessionId, parentId: child.ownerParentUid, prompt: storyGenSystemPrompt, response: llmResponse, startTime, modelName });
        } catch (e: any) {
          await logAIFlow({ flowName: `${flowName}:generateStory`, sessionId, parentId: child.ownerParentUid, prompt: storyGenSystemPrompt, error: e, startTime, modelName });
          throw e;
        }

        try {
          // Extract structured output using Genkit's output parameter
          let parsed = llmResponse.output;

          if (!parsed) {
            // Fallback: try manual parsing if output is null
            const rawText = llmResponse.text;
            const jsonMatch = rawText.match(/```json\n([\s\S]*?)\n```/);
            const jsonToParse = jsonMatch ? jsonMatch[1].trim() : rawText.trim();
            const manualParsed = JSON.parse(jsonToParse);
            const validation = WizardStoryGenOutputSchema.safeParse(manualParsed);
            if (!validation.success) {
              throw new Error('Missing required fields in story generation output.');
            }
            parsed = validation.data;
          }

          // Build entity map including the main child and all characters
          const entityMap: EntityMap = new Map();
          // Add characters
          contextData.characters.forEach(c => {
            entityMap.set(c.id, { displayName: c.displayName, document: c });
          });
          // Add the main child to the entity map so $$childId$$ placeholders resolve
          entityMap.set(childId, { displayName: child.displayName, document: child });
          // Add siblings if available
          contextData.siblings?.forEach(sibling => {
            entityMap.set(sibling.id, { displayName: sibling.displayName, document: sibling });
          });
          const resolvedStoryText = await replacePlaceholdersInText(parsed.storyText, entityMap);

          // Create the Story document
          const storyRef = firestore.collection('stories').doc(sessionId);
          const storyPayload: Story = {
            storySessionId: sessionId,
            childId,
            parentUid: child.ownerParentUid,
            storyText: resolvedStoryText, // Use the resolved text
            status: 'text_ready',
            metadata: {
              title: parsed.title,
              vibe: parsed.vibe,
            },
            pageGeneration: { status: 'idle' },
            imageGeneration: { status: 'idle' },
            createdAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
          };
          await storyRef.set(storyPayload, { merge: true });

          return { state: 'finished' as const, ok: true as const, title: parsed.title, vibe: parsed.vibe, storyText: resolvedStoryText, storyId: storyRef.id };
        } catch (e) {
          console.error("Failed to parse story generation JSON:", llmResponse.text, e);
          return { state: 'error' as const, ok: false as const, error: 'The wizard had trouble writing the final story. Please try again.' };
        }
      } else {
        // 2. Not enough answers, ask the next question
        // Build messages array from previous Q&A if any
        const previousMessages: MessageData[] = answers.flatMap(a => [
          { role: 'model' as const, content: [{ text: a.question }] },
          { role: 'user' as const, content: [{ text: a.answer }] },
        ]);

        // Use custom prompt from Firestore if available, otherwise use default
        const questionGenPromptTemplate = generator?.prompts?.questionGeneration || DEFAULT_QUESTION_GEN_PROMPT;
        const baseQuestionGenSystemPrompt = fillPromptTemplate(questionGenPromptTemplate, templateVars);
        const questionGenSystemPrompt = globalPrefix ? `${globalPrefix}\n\n${baseQuestionGenSystemPrompt}` : baseQuestionGenSystemPrompt;

        let llmResponse;
        const startTime2 = Date.now();
        const modelName2 = 'googleai/gemini-2.5-pro';
        try {
          // Using output parameter for structured schema validation
          // When no previous messages, use prompt instead of messages to avoid Genkit issues with empty arrays
          if (previousMessages.length > 0) {
            llmResponse = await ai.generate({
              model: modelName2,
              system: questionGenSystemPrompt,
              messages: previousMessages,
              output: { schema: WizardQuestionGenOutputSchema },
              config: { temperature: 0.8 },
            });
          } else {
            llmResponse = await ai.generate({
              model: modelName2,
              prompt: questionGenSystemPrompt,
              output: { schema: WizardQuestionGenOutputSchema },
              config: { temperature: 0.8 },
            });
          }
          await logAIFlow({ flowName: `${flowName}:askQuestion`, sessionId, parentId: child.ownerParentUid, prompt: questionGenSystemPrompt, response: llmResponse, startTime: startTime2, modelName: modelName2 });
        } catch (e: any) {
          await logAIFlow({ flowName: `${flowName}:askQuestion`, sessionId, parentId: child.ownerParentUid, prompt: questionGenSystemPrompt, error: e, startTime: startTime2, modelName: modelName2 });
          throw e;
        }

        try {
          // Extract structured output using Genkit's output parameter
          let parsed = llmResponse.output;

          if (!parsed) {
            // Fallback: try manual parsing if output is null
            const rawText = llmResponse.text;
            const jsonMatch = rawText.match(/```json\n([\s\S]*?)\n```/);
            const jsonToParse = jsonMatch ? jsonMatch[1].trim() : rawText.trim();
            const manualParsed = JSON.parse(jsonToParse);
            const validation = WizardQuestionGenOutputSchema.safeParse(manualParsed);
            if (!validation.success) {
              throw new Error('Missing required fields in question generation output.');
            }
            parsed = validation.data;
          }

          return { state: 'asking' as const, ok: true as const, answers, question: parsed.question, choices: parsed.choices };
        } catch (e) {
          console.error("Failed to parse question generation JSON:", llmResponse.text, e);
          return { state: 'error' as const, ok: false as const, error: 'The wizard got stuck thinking of a question. Please try again.' };
        }
      }
    } catch (e: any) {
      console.error('Error in storyWizardFlow:', e);
      return { state: 'error' as const, ok: false as const, error: e.message || 'An unexpected error occurred.' };
    }
  }
);

export async function storyWizardFlow(input: StoryWizardInput): Promise<StoryWizardOutput> {
    return await storyWizardFlowInternal({
        ...input,
        answers: input.answers ?? [],
    });
}
