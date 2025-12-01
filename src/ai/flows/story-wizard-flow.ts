
'use server';

import { ai } from '@/ai/genkit';
import { initializeFirebase } from '@/firebase';
import { doc, getDoc, collection, query, where, getDocs, setDoc, serverTimestamp } from 'firebase/firestore';
import { z } from 'genkit';
import type { ChildProfile, Character, StoryBook, StoryWizardAnswer, StoryWizardChoice, StoryWizardInput, StoryWizardOutput } from '@/lib/types';
import { logAIFlow } from '@/lib/ai-flow-logger';


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
    bookId: z.string().describe('The ID of the created StoryBook document.'),
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
    const { firestore } = initializeFirebase();

    try {
      // 1. Fetch child and character data
      const childRef = doc(firestore, 'children', childId);
      const childSnap = await getDoc(childRef);
      if (!childSnap.exists()) {
        return { state: 'error', error: 'Child profile not found.', ok: false };
      }
      const child = childSnap.data() as ChildProfile;
      const childAge = getChildAgeYears(child);
      const ageDescription = childAge ? `The child is ${childAge} years old.` : "The child's age is unknown.";

      const charactersQuery = query(
        collection(firestore, 'characters'),
        where('ownerParentUid', '==', child.ownerParentUid)
      );
      const charactersSnap = await getDocs(charactersQuery);
      const characters = charactersSnap.docs.map(d => ({ id: d.id, ...d.data() } as Character));
      const mainCharacter = characters.find(c => c.relatedTo === childId && c.role === 'family');

      if (!mainCharacter) {
        return { state: 'error', error: 'Main character for the child not found.', ok: false };
      }

      const characterContext = `
Available Characters:
- Main Character: ${mainCharacter.displayName} (ID: $$${mainCharacter.id}$$)
- Other Characters:
${characters
  .filter(c => c.id !== mainCharacter.id)
  .map(c => `  - ${c.displayName} (${c.role}, ID: $$${c.id}$$)`)
  .join('\n')}
      `.trim();
      
      const MAX_QUESTIONS = 4;

      if (answers.length >= MAX_QUESTIONS) {
        // 3. All questions answered, generate the final story
        const storyGenPrompt = `
You are a master storyteller for young children. Your task is to write a complete, short story based on a child's choices.

CHILD'S PROFILE:
${ageDescription}

CHARACTERS:
${characterContext}

CHILD'S CHOICES:
${answers.map(a => `- When asked "${a.question}", the child chose "${a.answer}"`).join('\n')}

INSTRUCTIONS:
1. Write a complete, gentle, and engaging story of about 5-7 paragraphs.
2. The story MUST use the character placeholders (e.g., $$character-id$$) instead of their names.
3. The story should be simple and easy for a young child to understand.
4. Conclude the story with a happy and reassuring ending.
5. You MUST output a valid JSON object with the following structure, and nothing else:
   {
     "title": "A suitable title for the story",
     "vibe": "A one-word vibe for the story (e.g., funny, magical, adventure)",
     "storyText": "The full story text, using $$document-id$$ for characters."
   }
        `;

        let llmResponse;
        try {
          llmResponse = await ai.generate({
            prompt: storyGenPrompt,
            model: 'googleai/gemini-2.5-flash',
            config: { temperature: 0.7 },
          });
          await logAIFlow({ flowName: `${flowName}:generateStory`, sessionId, prompt: storyGenPrompt, response: llmResponse });
        } catch (e: any) {
          await logAIFlow({ flowName: `${flowName}:generateStory`, sessionId, prompt: storyGenPrompt, error: e });
          throw e;
        }

        const rawText = llmResponse.text;
        try {
          const jsonMatch = rawText.match(/```json\n([\s\S]*?)\n```/);
          const jsonToParse = jsonMatch ? jsonMatch[1].trim() : rawText.trim();
          const parsed = JSON.parse(jsonToParse);
          if (!parsed.title || !parsed.storyText || !parsed.vibe) {
            throw new Error('Missing required fields in story generation output.');
          }

          // Create the StoryBook document
          const bookRef = doc(firestore, 'storyBooks', sessionId);
          const bookPayload: StoryBook = {
            storySessionId: sessionId,
            childId,
            parentUid: child.ownerParentUid,
            storyText: parsed.storyText,
            status: 'text_ready',
            metadata: {
              title: parsed.title,
              vibe: parsed.vibe,
            },
            pageGeneration: { status: 'idle' },
            imageGeneration: { status: 'idle' },
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          };
          await setDoc(bookRef, bookPayload, { merge: true });

          return { state: 'finished', ok: true, ...parsed, bookId: bookRef.id };
        } catch (e) {
          console.error("Failed to parse story generation JSON:", rawText, e);
          return { state: 'error', ok: false, error: 'The wizard had trouble writing the final story. Please try again.' };
        }
      } else {
        // 2. Not enough answers, ask the next question
        const questionGenPrompt = `
You are a friendly Story Wizard who helps a young child create a story by asking simple multiple-choice questions.

CHILD'S PROFILE:
${ageDescription}

CHARACTERS:
${characterContext}

QUESTIONS ALREADY ASKED:
${answers.length > 0 ? answers.map(a => `- "${a.question}" -> "${a.answer}"`).join('\n') : 'None yet.'}

INSTRUCTIONS:
1. Based on the previous answers, devise the *next* simple, fun question to ask the child. Questions should guide the story's theme, setting, or a simple plot point.
2. Create 2 to 4 short, imaginative choices for the child to pick from.
3. Keep questions and choices very simple (a few words).
4. You MUST output a valid JSON object with the following structure, and nothing else:
   {
     "question": "The next simple question for the child",
     "choices": [
       { "text": "Choice one" },
       { "text": "Choice two" }
     ]
   }
        `;

        let llmResponse;
        try {
          llmResponse = await ai.generate({
            prompt: questionGenPrompt,
            model: 'googleai/gemini-2.5-flash',
            config: { temperature: 0.8 },
          });
          await logAIFlow({ flowName: `${flowName}:askQuestion`, sessionId, prompt: questionGenPrompt, response: llmResponse });
        } catch (e: any) {
          await logAIFlow({ flowName: `${flowName}:askQuestion`, sessionId, prompt: questionGenPrompt, error: e });
          throw e;
        }

        const rawText = llmResponse.text;
        try {
          const jsonMatch = rawText.match(/```json\n([\s\S]*?)\n```/);
          const jsonToParse = jsonMatch ? jsonMatch[1].trim() : rawText.trim();
          const parsed = JSON.parse(jsonToParse);
          if (!parsed.question || !Array.isArray(parsed.choices)) {
            throw new Error('Missing required fields in question generation output.');
          }
          return { state: 'asking', ok: true, answers, ...parsed };
        } catch (e) {
          console.error("Failed to parse question generation JSON:", rawText, e);
          return { state: 'error', ok: false, error: 'The wizard got stuck thinking of a question. Please try again.' };
        }
      }
    } catch (e: any) {
      console.error('Error in storyWizardFlow:', e);
      return { state: 'error', ok: false, error: e.message || 'An unexpected error occurred.' };
    }
  }
);

export async function storyWizardFlow(input: StoryWizardInput): Promise<StoryWizardOutput> {
    return await storyWizardFlowInternal(input);
}
