
'use server';

/**
 * @fileOverview A Genkit flow to generate a question about a character's traits.
 */

import { ai } from '@/ai/genkit';
import { initializeFirebase } from '@/firebase';
import { getDoc, doc, collection, getDocs, query, orderBy, limit } from 'firebase/firestore';
import { z } from 'genkit';
import type { StorySession, Character, ChatMessage } from '@/lib/types';

type FlowDebugInfo = {
    stage: 'loading_session' | 'loading_character' | 'loading_messages' | 'ai_generate' | 'json_parse' | 'json_validate' | 'unknown';
    details: Record<string, any>;
};

// Zod schema for the expected JSON output from the model
const CharacterTraitsOutputSchema = z.object({
  question: z.string().describe("ONE very short, child-friendly question about what the character is like."),
  suggestedTraits: z.array(z.string()).min(1).describe("A list of one or more short, simple traits (adjectives) for the character, consistent with the question."),
});

export const characterTraitsFlow = ai.defineFlow(
    {
        name: 'characterTraitsFlow',
        inputSchema: z.object({ sessionId: z.string(), characterId: z.string() }),
        outputSchema: z.any(), // Using any to allow for custom error/success shapes
    },
    async ({ sessionId, characterId }) => {
        let debug: FlowDebugInfo = { stage: 'unknown', details: {} };

        try {
            const { firestore } = initializeFirebase();

            // 1. Load session
            debug.stage = 'loading_session';
            const sessionRef = doc(firestore, 'storySessions', sessionId);
            const sessionDoc = await getDoc(sessionRef);
            if (!sessionDoc.exists()) {
                return { ok: false, sessionId, errorMessage: `Session with id ${sessionId} not found.` };
            }
            
            // 2. Load character
            debug.stage = 'loading_character';
            const characterRef = doc(firestore, 'characters', characterId);
            const characterDoc = await getDoc(characterRef);
            if (!characterDoc.exists()) {
                return { ok: false, characterId, errorMessage: `Character with id ${characterId} not found.` };
            }
            const character = characterDoc.data() as Character;

            // 3. Load last 10 messages for context
            debug.stage = 'loading_messages';
            const messagesRef = collection(firestore, `storySessions/${sessionId}/messages`);
            const messagesQuery = query(messagesRef, orderBy('createdAt', 'desc'), limit(10));
            const messagesSnapshot = await getDocs(messagesQuery);
            const storySoFar = messagesSnapshot.docs
                .reverse() // chronological order
                .map(d => {
                    const msg = d.data() as ChatMessage;
                    return `${msg.sender === 'assistant' ? 'Story Guide' : 'Child'}: ${msg.text}`;
                })
                .join('\n');

            // 4. Construct prompt
            const systemPrompt = "You are the Story Guide. You help very young children (3–5) talk about story characters. You speak in very short, simple sentences. You do not use scary topics, lists, or emojis.";
            const modeInstructions = `
You will be given the character's name, their kind (e.g., toy, pet), any traits we already know, and a short summary of the story so far.
Your job is to:
1. Generate ONE very short, child-friendly question about what the character is like. For example: "Is your teddy bear very soft or very squishy?".
2. Suggest a small updated list of traits for the character that includes any existing traits plus at least one new trait consistent with the question. Traits should be short (one or two words each).

Output your response as a single JSON object with this exact structure:
{
  "question": "one short question to ask the child",
  "suggestedTraits": ["trait one", "trait two"]
}

Important: Return only a single JSON object. Do not include any extra text, explanation, or formatting. Do not wrap the JSON in markdown or code fences. The output must start with { and end with }.
`;

            const finalPrompt = `
${systemPrompt}

${modeInstructions}

CONTEXT:
Character Name: ${character.name}
Character Kind: ${character.role}
Existing Traits: ${character.traits?.join(', ') || 'none'}
Story So Far:
${storySoFar}

Now, generate the question and suggested traits as a single JSON object.
`;

            // 5. Call Genkit AI
            debug.stage = 'ai_generate';
            const maxOutputTokens = 500;
            const temperature = 0.5;
            
            const llmResponse = await ai.generate({
                model: 'googleai/gemini-2.5-flash',
                prompt: finalPrompt,
                config: { temperature, maxOutputTokens }
            });
            
            const rawText = llmResponse.text;

            if (!rawText || rawText.trim() === '') {
                throw new Error("Model returned empty text for characterTraits.");
            }
            
            // 6. Parse and validate
            debug.stage = 'json_parse';
            let parsed: z.infer<typeof CharacterTraitsOutputSchema>;
            try {
                const jsonMatch = rawText.match(/```json\n([\s\S]*?)\n```/);
                const jsonToParse = jsonMatch ? jsonMatch[1].trim() : rawText.trim();
                parsed = JSON.parse(jsonToParse);
            } catch (err) {
                throw new Error("Model output is not valid JSON for characterTraits.");
            }

            debug.stage = 'json_validate';
            const validationResult = CharacterTraitsOutputSchema.safeParse(parsed);

            if (!validationResult.success) {
                 throw new Error(`Model JSON does not match expected characterTraits shape. Errors: ${validationResult.error.message}`);
            }

            const { question, suggestedTraits } = validationResult.data;

            return {
                ok: true,
                sessionId,
                characterId,
                question,
                suggestedTraits,
                debug: {
                    traitsCount: suggestedTraits.length,
                    modelName: 'googleai/gemini-2.5-flash',
                    maxOutputTokens,
                    temperature,
                }
            };

        } catch (e: any) {
            const errorMessage = e instanceof Error ? e.message : JSON.stringify(e);
            debug.details.error = errorMessage;
            return {
                ok: false,
                sessionId,
                characterId,
                errorMessage: `Unexpected error in characterTraitsFlow: ${errorMessage}`,
                debug,
            };
        }
    }
);
