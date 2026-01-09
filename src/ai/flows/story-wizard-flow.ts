
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

// Retry configuration
const MAX_RETRIES = 2;
const INITIAL_BACKOFF_MS = 1000;

/** Check if an error is transient and should be retried */
function isRetryableError(errorMessage: string): boolean {
  const retryablePatterns = [
    'RESOURCE_EXHAUSTED',
    'UNAVAILABLE',
    'DEADLINE_EXCEEDED',
    'timed out',
    'timeout',
    '429',
    '503',
    '500',
    'quota',
    'rate limit',
    'temporarily',
    'overloaded',
    'capacity',
    'fetch failed',
    'ECONNRESET',
    'ETIMEDOUT',
  ];
  const lowerMessage = errorMessage.toLowerCase();
  return retryablePatterns.some(pattern => lowerMessage.includes(pattern.toLowerCase()));
}

/** Categorize error for user-friendly messages */
function categorizeError(errorMessage: string): { category: string; userMessage: string } {
  const lowerMessage = errorMessage.toLowerCase();

  if (lowerMessage.includes('resource_exhausted') || lowerMessage.includes('429') || lowerMessage.includes('quota') || lowerMessage.includes('rate')) {
    return {
      category: 'rate_limit',
      userMessage: 'The story wizard is very busy right now. Please wait a moment and try again.',
    };
  }

  if (lowerMessage.includes('deadline_exceeded') || lowerMessage.includes('timed out') || lowerMessage.includes('timeout')) {
    return {
      category: 'timeout',
      userMessage: 'The story wizard took too long to respond. Please try again.',
    };
  }

  if (lowerMessage.includes('unavailable') || lowerMessage.includes('503') || lowerMessage.includes('temporarily')) {
    return {
      category: 'unavailable',
      userMessage: 'The story wizard is taking a short nap. Please try again in a moment.',
    };
  }

  if (lowerMessage.includes('fetch failed') || lowerMessage.includes('econnreset') || lowerMessage.includes('etimedout')) {
    return {
      category: 'network',
      userMessage: 'Had trouble reaching the story wizard. Please check your connection and try again.',
    };
  }

  return {
    category: 'unknown',
    userMessage: 'The story wizard encountered an unexpected problem. Please try again.',
  };
}

/** Sleep for a given number of milliseconds */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/** Convert MessageData array to simple log format */
function formatMessagesForLog(messages: MessageData[]): Array<{ role: string; content: string }> {
  return messages.map(msg => ({
    role: msg.role,
    content: msg.content.map(c => ('text' in c ? c.text : '[non-text content]')).join(''),
  }));
}

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

/** Format age for prompts. Handles 0 (babies under 1) correctly. */
function formatAgeDescription(childAge: number | null): string {
  if (childAge === null) return "The child's age is unknown.";
  if (childAge === 0) return "The child is under 1 year old (a baby).";
  return `The child is ${childAge} years old.`;
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
      const ageDescription = formatAgeDescription(childAge);

      const MAX_QUESTIONS = 4;

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
        // Note: We don't use globalPrefix here as it contains character introduction
        // guidance which is not applicable to the wizard flow (no interactive choices)
        const storyGenPromptTemplate = generator?.prompts?.storyGeneration || DEFAULT_STORY_GEN_PROMPT;
        const storyGenSystemPrompt = fillPromptTemplate(storyGenPromptTemplate, templateVars);

        let llmResponse;
        const modelName = 'googleai/gemini-2.5-pro';
        let lastError: Error | null = null;

        // Retry loop for story generation
        for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
          const startTime = Date.now();
          try {
            if (attempt > 0) {
              const backoffMs = INITIAL_BACKOFF_MS * Math.pow(2, attempt - 1);
              console.log(`[storyWizardFlow:generateStory] Retry attempt ${attempt}/${MAX_RETRIES} after ${backoffMs}ms backoff`);
              await sleep(backoffMs);
            }

            // Using output parameter for structured schema validation
            llmResponse = await ai.generate({
              model: modelName,
              system: storyGenSystemPrompt,
              messages: wizardMessages,
              output: { schema: WizardStoryGenOutputSchema },
              config: { temperature: 0.7 },
            });
            await logAIFlow({
              flowName: `${flowName}:generateStory`,
              sessionId,
              parentId: child.ownerParentUid,
              prompt: storyGenSystemPrompt,
              messages: formatMessagesForLog(wizardMessages),
              response: llmResponse,
              startTime,
              modelName,
              attemptNumber: attempt + 1,
              maxAttempts: MAX_RETRIES + 1,
            });
            // Success - break out of retry loop
            break;
          } catch (e: any) {
            lastError = e;
            const errorMessage = e?.message || String(e);
            const { category } = categorizeError(errorMessage);

            await logAIFlow({
              flowName: `${flowName}:generateStory`,
              sessionId,
              parentId: child.ownerParentUid,
              prompt: storyGenSystemPrompt,
              messages: formatMessagesForLog(wizardMessages),
              error: e,
              startTime,
              modelName,
              attemptNumber: attempt + 1,
              maxAttempts: MAX_RETRIES + 1,
              retryReason: attempt < MAX_RETRIES && isRetryableError(errorMessage)
                ? `${category}: ${errorMessage.substring(0, 100)}`
                : undefined,
            });

            // Check if we should retry
            if (attempt < MAX_RETRIES && isRetryableError(errorMessage)) {
              console.warn(`[storyWizardFlow:generateStory] Retryable error (${category}): ${errorMessage}`);
              continue;
            }

            // Non-retryable error or max retries reached
            throw e;
          }
        }

        // If we exited the loop without llmResponse, throw the last error
        if (!llmResponse) {
          throw lastError || new Error('Failed to generate story after retries');
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
          // This is used for resolving text returned to the client (for display)
          // but the story document should store the unresolved text with $$id$$ placeholders
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
          // Resolve text for display in the client response only
          const resolvedStoryText = await replacePlaceholdersInText(parsed.storyText, entityMap);

          // Create the Story document - store UNRESOLVED text with $$id$$ placeholders
          // This allows the compile and pagination flows to work with placeholders
          const storyRef = firestore.collection('stories').doc(sessionId);
          const storyPayload: Story = {
            storySessionId: sessionId,
            childId,
            parentUid: child.ownerParentUid,
            storyText: parsed.storyText, // Store unresolved text with $$id$$ placeholders
            storyMode: 'wizard', // Identifies this story was created via the wizard flow
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

          // Return resolved text to the client for immediate display
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
        const questionGenSystemPrompt = fillPromptTemplate(questionGenPromptTemplate, templateVars);

        let llmResponse;
        const modelName2 = 'googleai/gemini-2.5-pro';
        let lastError: Error | null = null;

        // Retry loop for question generation
        for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
          const startTime2 = Date.now();
          try {
            if (attempt > 0) {
              const backoffMs = INITIAL_BACKOFF_MS * Math.pow(2, attempt - 1);
              console.log(`[storyWizardFlow:askQuestion] Retry attempt ${attempt}/${MAX_RETRIES} after ${backoffMs}ms backoff`);
              await sleep(backoffMs);
            }

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
            await logAIFlow({
              flowName: `${flowName}:askQuestion`,
              sessionId,
              parentId: child.ownerParentUid,
              prompt: questionGenSystemPrompt,
              messages: previousMessages.length > 0 ? formatMessagesForLog(previousMessages) : undefined,
              response: llmResponse,
              startTime: startTime2,
              modelName: modelName2,
              attemptNumber: attempt + 1,
              maxAttempts: MAX_RETRIES + 1,
            });
            // Success - break out of retry loop
            break;
          } catch (e: any) {
            lastError = e;
            const errorMessage = e?.message || String(e);
            const { category } = categorizeError(errorMessage);

            await logAIFlow({
              flowName: `${flowName}:askQuestion`,
              sessionId,
              parentId: child.ownerParentUid,
              prompt: questionGenSystemPrompt,
              messages: previousMessages.length > 0 ? formatMessagesForLog(previousMessages) : undefined,
              error: e,
              startTime: startTime2,
              modelName: modelName2,
              attemptNumber: attempt + 1,
              maxAttempts: MAX_RETRIES + 1,
              retryReason: attempt < MAX_RETRIES && isRetryableError(errorMessage)
                ? `${category}: ${errorMessage.substring(0, 100)}`
                : undefined,
            });

            // Check if we should retry
            if (attempt < MAX_RETRIES && isRetryableError(errorMessage)) {
              console.warn(`[storyWizardFlow:askQuestion] Retryable error (${category}): ${errorMessage}`);
              continue;
            }

            // Non-retryable error or max retries reached
            throw e;
          }
        }

        // If we exited the loop without llmResponse, throw the last error
        if (!llmResponse) {
          throw lastError || new Error('Failed to generate question after retries');
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

          // Build entity map for resolving placeholders in question and choices
          const entityMap: EntityMap = new Map();
          contextData.characters.forEach(c => {
            entityMap.set(c.id, { displayName: c.displayName, document: c });
          });
          entityMap.set(childId, { displayName: child.displayName, document: child });
          contextData.siblings?.forEach(sibling => {
            entityMap.set(sibling.id, { displayName: sibling.displayName, document: sibling });
          });

          // Resolve placeholders in question and choice texts
          const resolvedQuestion = await replacePlaceholdersInText(parsed.question, entityMap);
          const resolvedChoices = await Promise.all(
            parsed.choices.map(async (choice) => ({
              ...choice,
              text: await replacePlaceholdersInText(choice.text, entityMap),
            }))
          );

          return { state: 'asking' as const, ok: true as const, answers, question: resolvedQuestion, choices: resolvedChoices };
        } catch (e) {
          console.error("Failed to parse question generation JSON:", llmResponse.text, e);
          return { state: 'error' as const, ok: false as const, error: 'The wizard got stuck thinking of a question. Please try again.' };
        }
      }
    } catch (e: any) {
      const errorMessage = e?.message || String(e);
      const { category, userMessage } = categorizeError(errorMessage);
      console.error(`[storyWizardFlow] Error (${category}):`, errorMessage);
      return { state: 'error' as const, ok: false as const, error: userMessage };
    }
  }
);

export async function storyWizardFlow(input: StoryWizardInput): Promise<StoryWizardOutput> {
    return await storyWizardFlowInternal({
        ...input,
        answers: input.answers ?? [],
    });
}
