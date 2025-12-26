
'use server';

/**
 * @fileOverview A Genkit flow to generate a question about a character's traits.
 */

import { ai } from '@/ai/genkit';
import { getServerFirestore } from '@/lib/server-firestore';
import { z } from 'genkit';
import type { MessageData } from 'genkit';
import type { StorySession, Character, ChatMessage } from '@/lib/types';
import { logAIFlow } from '@/lib/ai-flow-logger';

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
        const debug: any = { 
            stage: 'init',
            input: { sessionId, characterId }
        };

        try {
            const firestore = await getServerFirestore();

            // 1. Load session
            debug.stage = 'loading_session';
            const sessionDoc = await firestore.collection('storySessions').doc(sessionId).get();
            if (!sessionDoc.exists) {
                throw new Error(`Session with id ${sessionId} not found.`);
            }
            const session = sessionDoc.data() as StorySession;
            debug.sessionExists = true;
            
            // 2. Load character
            debug.stage = 'loading_character';
            const characterDoc = await firestore.collection('characters').doc(characterId).get();
            if (!characterDoc.exists) {
                throw new Error(`Character with id ${characterId} not found.`);
            }
            const character = characterDoc.data() as Character;
            debug.characterExists = true;
            debug.characterName = character.displayName;
            debug.characterRole = character.role;


            // 3. Load last 10 messages for context and build messages array
            debug.stage = 'loading_messages';
            const messagesSnapshot = await firestore
                .collection('storySessions')
                .doc(sessionId)
                .collection('messages')
                .orderBy('createdAt', 'desc')
                .limit(10)
                .get();

            // Build structured messages array for ai.generate()
            const conversationMessages: MessageData[] = messagesSnapshot.docs
                .reverse() // chronological order
                .map(d => {
                    const msg = d.data() as ChatMessage;
                    return {
                        role: msg.sender === 'assistant' ? 'model' : 'user',
                        content: [{ text: msg.text }],
                    } as MessageData;
                });
            debug.messagesLoaded = conversationMessages.length;

            // 4. Construct system prompt (story history will be passed via messages array)
            debug.stage = 'build_prompt';
            const systemPrompt = `You are the Story Guide. You help very young children (3–5) talk about story characters. You speak in very short, simple sentences. You do not use scary topics, lists, or emojis.

You will be given the character's name, their kind (e.g., toy, pet), and any traits we already know. The conversation history above shows the story so far.
Your job is to:
1. Generate ONE very short, child-friendly question about what the character is like. For example: "Is your teddy bear very soft or very squishy?".
2. Suggest a small updated list of traits for the character that includes any existing traits plus at least one new trait consistent with the question. Traits should be short (one or two words each).

CONTEXT:
Character Name: ${character.displayName}
Character Kind: ${character.role}
Existing Traits: ${character.traits?.join(', ') || 'none'}

Output your response as a single JSON object with this exact structure:
{
  "question": "one short question to ask the child",
  "suggestedTraits": ["trait one", "trait two"]
}

Important: Return only a single JSON object. Do not include any extra text, explanation, or formatting. Do not wrap the JSON in markdown or code fences. The output must start with { and end with }.`;
            debug.promptLength = systemPrompt.length;
            debug.promptPreview = systemPrompt.slice(0, 200);

            // 5. Call Genkit AI with messages array
            debug.stage = 'ai_generate';
            const maxOutputTokens = 2000;
            const temperature = 0.5;
            debug.modelName = 'googleai/gemini-2.5-pro';
            debug.temperature = temperature;
            debug.maxOutputTokens = maxOutputTokens;
            debug.usedMessagesArray = conversationMessages.length > 0;

            let llmResponse;
            const startTime = Date.now();
            const modelName = 'googleai/gemini-2.5-pro';
            try {
                // Using output parameter for structured schema validation
                llmResponse = await ai.generate({
                    model: modelName,
                    system: systemPrompt,
                    messages: conversationMessages,
                    output: { schema: CharacterTraitsOutputSchema },
                    config: { temperature, maxOutputTokens }
                });
                await logAIFlow({ flowName: 'characterTraitsFlow', sessionId, parentId: session.parentUid, prompt: systemPrompt, response: llmResponse, startTime, modelName });
            } catch (e: any) {
                await logAIFlow({ flowName: 'characterTraitsFlow', sessionId, parentId: session.parentUid, prompt: systemPrompt, error: e, startTime, modelName });
                throw e;
            }

            debug.stage = 'ai_generate_result';
            debug.responseKeys = Object.keys(llmResponse ?? {});
            debug.hasRaw = !!(llmResponse as any).raw;
            debug.hasCandidatesArray = Array.isArray((llmResponse as any).raw?.candidates);
            debug.candidatesLength = Array.isArray((llmResponse as any).raw?.candidates) ? (llmResponse as any).raw.candidates.length : 0;
            debug.topLevelFinishReason = (llmResponse as any).finishReason ?? null;
            debug.firstCandidateFinishReason = Array.isArray((llmResponse as any).raw?.candidates) && (llmResponse as any).raw.candidates.length > 0 ? (llmResponse as any).raw.candidates[0]?.finishReason ?? null : null;

            // 6. Extract structured output using Genkit's output parameter
            let structuredOutput = llmResponse.output;

            if (!structuredOutput) {
                // Fallback: try manual parsing if output is null
                const rawText = llmResponse.text;

                if (!rawText || rawText.trim() === '') {
                    if (debug.firstCandidateFinishReason === 'MAX_TOKENS' || debug.topLevelFinishReason === 'length') {
                        throw new Error("Model hit MAX_TOKENS during characterTraits; increase maxOutputTokens or simplify the prompt.");
                    }
                    throw new Error("Model returned empty text for characterTraits.");
                }

                debug.stage = 'json_parse';
                try {
                    const jsonMatch = rawText.match(/```json\n([\s\S]*?)\n```/);
                    const jsonToParse = jsonMatch ? jsonMatch[1].trim() : rawText.trim();
                    const parsed = JSON.parse(jsonToParse);
                    const manualValidation = CharacterTraitsOutputSchema.safeParse(parsed);
                    if (manualValidation.success) {
                        structuredOutput = manualValidation.data;
                        debug.usedFallbackParsing = true;
                    } else {
                        throw new Error(`Model JSON does not match expected characterTraits shape. Errors: ${manualValidation.error.message}`);
                    }
                } catch (err) {
                    throw new Error("Model output is not valid JSON for characterTraits.");
                }
            }

            const { question, suggestedTraits } = structuredOutput;

            return {
                ok: true,
                sessionId,
                characterId,
                question,
                suggestedTraits,
                debug: process.env.NODE_ENV === 'development' ? debug : null,
            };

        } catch (e: any) {
            console.error('Unexpected error in characterTraitsFlow:', e, debug);
            return {
                ok: false,
                sessionId,
                characterId,
                errorMessage: `Unexpected error in characterTraitsFlow: ${e?.message || String(e)}`,
                debug,
            };
        }
    }
);
