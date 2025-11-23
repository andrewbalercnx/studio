
'use server';
/**
 * @fileOverview A Genkit flow to generate the next story beat.
 */

import { ai } from '@/ai/genkit';
import { initializeFirebase } from '@/firebase';
import { getDoc, doc, collection, getDocs, query, orderBy, where, limit } from 'firebase/firestore';
import { z } from 'genkit';
import type { StorySession, ChatMessage, PromptConfig, StoryType, Character } from '@/lib/types';

type StoryBeatDebugInfo = {
    stage: 'loading_session' | 'loading_storyType' | 'loading_promptConfig' | 'ai_generate' | 'json_parse' | 'json_validate' | 'unknown';
    details: Record<string, any>;
};

// Zod schema for the expected JSON output from the model
const StoryBeatOutputSchema = z.object({
  storyContinuation: z.string().describe("The next paragraph of the story, continuing from the story so far."),
  options: z.array(z.object({
    id: z.string().describe("A single uppercase letter, e.g., 'A', 'B', 'C'."),
    text: z.string().describe("A short, child-friendly choice for what happens next."),
  })).min(3).describe("An array of at least 3 choices for the child.")
});


export const storyBeatFlow = ai.defineFlow(
    {
        name: 'storyBeatFlow',
        inputSchema: z.object({ sessionId: z.string() }),
        outputSchema: z.any(), // Using any to allow for custom error/success shapes
    },
    async ({ sessionId }) => {
        let debug: StoryBeatDebugInfo = { stage: 'unknown', details: {} };

        try {
            const { firestore } = initializeFirebase();

            // 1. Load session
            debug.stage = 'loading_session';
            const sessionRef = doc(firestore, 'storySessions', sessionId);
            const sessionDoc = await getDoc(sessionRef);
            if (!sessionDoc.exists()) {
                return { ok: false, sessionId, errorMessage: `Session with id ${sessionId} not found.` };
            }
            const session = sessionDoc.data() as StorySession;
            
            const { storyTypeId, storyPhaseId, arcStepIndex, promptConfigLevelBand, mainCharacterId } = session;

            if (!storyTypeId || !storyPhaseId || !promptConfigLevelBand) {
                return { ok: false, sessionId, errorMessage: `Session is missing one or more required fields: storyTypeId, storyPhaseId, promptConfigLevelBand.` };
            }

            // 2. Load StoryType
            debug.stage = 'loading_storyType';
            const storyTypeRef = doc(firestore, 'storyTypes', storyTypeId);
            const storyTypeDoc = await getDoc(storyTypeRef);
            if (!storyTypeDoc.exists()) {
                return { ok: false, sessionId, errorMessage: `StoryType with id ${storyTypeId} not found.` };
            }
            const storyType = storyTypeDoc.data() as StoryType;
            const arcStep = (arcStepIndex != null && storyType.arcTemplate.steps[arcStepIndex]) 
                ? storyType.arcTemplate.steps[arcStepIndex]
                // Fallback in case index is out of bounds or null
                : "introduce_character";


            // 3. Load Main Character
            let mainCharacterSummary = "Main character: unknown";
            if (mainCharacterId) {
                const charRef = doc(firestore, 'characters', mainCharacterId);
                const charDoc = await getDoc(charRef);
                if (charDoc.exists()) {
                    const char = charDoc.data() as Character;
                    mainCharacterSummary = `Main character: ${char.name}, role: ${char.role}.`;
                    if (char.traits) {
                         mainCharacterSummary += ` Traits: ${Object.values(char.traits).filter(Boolean).join(', ')}.`;
                    }
                }
            }

            // 4. Build Story So Far
            const messagesRef = collection(firestore, `storySessions/${sessionId}/messages`);
            const messagesQuery = query(messagesRef, orderBy('createdAt', 'asc'));
            const messagesSnapshot = await getDocs(messagesQuery);
            const storySoFar = messagesSnapshot.docs.map(doc => {
                const data = doc.data() as ChatMessage;
                return `${data.sender === 'assistant' ? 'Story Guide' : 'Child'}: ${data.text}`;
            }).join('\n');

            // 5. Choose PromptConfig
            debug.stage = 'loading_promptConfig';
            const promptConfigsRef = collection(firestore, 'promptConfigs');
            const q = query(
                promptConfigsRef,
                where('phase', '==', 'storyBeat'),
                where('levelBand', '==', promptConfigLevelBand),
                orderBy('status', 'desc'), // 'live' comes before 'draft'
                limit(1)
            );
            const configSnapshot = await getDocs(q);
            if (configSnapshot.empty) {
                 return { ok: false, sessionId, errorMessage: `No 'storyBeat' prompt config found for levelBand '${promptConfigLevelBand}'.` };
            }
            const promptConfig = configSnapshot.docs[0].data() as PromptConfig;

            // 6. Build Final Prompt
            const finalPrompt = `
${promptConfig.systemPrompt}

MODE INSTRUCTIONS:
${promptConfig.modeInstructions}

CONTEXT:
Story Type: ${storyType.name} (${storyTypeId})
Current Arc Step: ${arcStep}
${mainCharacterSummary}

STORY SO FAR:
${storySoFar}

Based on all the above, continue the story. Generate the next paragraph and three choices for the child. Output your response as a single, valid JSON object that matches this Zod schema:
${JSON.stringify(StoryBeatOutputSchema.jsonSchema, null, 2)}
Important: Return only a single JSON object. Do not include any extra text, explanation, or formatting. Do not wrap the JSON in markdown or code fences. The output must start with { and end with }.
`;

            // 7. Call Genkit AI
            debug.stage = 'ai_generate';
            const temperature = promptConfig.model?.temperature ?? 0.7;
            const maxOutputTokens = promptConfig.model?.maxOutputTokens ?? 1024;
            
            const llmResponse = await ai.generate({
                model: 'googleai/gemini-2.5-flash',
                prompt: finalPrompt,
                config: {
                    temperature,
                    maxOutputTokens,
                }
            });
            
            // 8. Extract raw text robustly
            let rawText: string | null = null;
            if (typeof llmResponse.text === 'function') {
                rawText = await llmResponse.text();
            } else if (typeof llmResponse.text === 'string') {
                rawText = llmResponse.text;
            } else {
                const raw = (llmResponse as any).raw;
                const firstCandidate = raw && Array.isArray(raw.candidates) && raw.candidates.length > 0 ? raw.candidates[0] : null;
                if (firstCandidate) {
                    const content = firstCandidate?.content;
                    const parts = content && Array.isArray(content.parts) ? content.parts : [];
                    const firstPart = parts.length > 0 ? parts[0] : null;
                    const textValue = firstPart && typeof firstPart.text === 'string' ? firstPart.text : null;
                    if (textValue && textValue.trim().length > 0) {
                        rawText = textValue.trim();
                    }
                }
            }


             if (!rawText || rawText.trim() === '') {
                return {
                    ok: false,
                    sessionId,
                    errorMessage: "Model returned empty text for storyBeat.",
                    debug: {
                        stage: 'ai_generate',
                        details: {
                            textPresent: !!rawText,
                            rawResponsePreview: rawText ? rawText.slice(0, 500) : null
                        }
                    }
                };
            }
            

            // 9. Manually parse and validate
            debug.stage = 'json_parse';
            let parsed: z.infer<typeof StoryBeatOutputSchema>;
            try {
                // Sometimes the model wraps the JSON in ```json ... ```, so we need to extract it.
                const jsonMatch = rawText.match(/```json\n([\s\S]*?)\n```/);
                const jsonToParse = jsonMatch ? jsonMatch[1].trim() : rawText.trim();
                parsed = JSON.parse(jsonToParse);
            } catch (err) {
                return {
                    ok: false,
                    sessionId,
                    errorMessage: "Model output is not valid JSON for storyBeat.",
                    debug: {
                        stage: 'json_parse',
                        details: {
                            parseError: String(err),
                            rawTextPreview: rawText.slice(0, 500)
                        }
                    }
                };
            }

            debug.stage = 'json_validate';
            const validationResult = StoryBeatOutputSchema.safeParse(parsed);

            if (!validationResult.success) {
                 return {
                    ok: false,
                    sessionId,
                    errorMessage: `Model JSON does not match expected storyBeat shape. Errors: ${validationResult.error.message}`,
                    debug: {
                        stage: 'json_validate',
                        details: {
                            validationErrors: validationResult.error.issues,
                            rawTextPreview: rawText.slice(0, 500)
                        }
                    }
                };
            }

            const structuredOutput = validationResult.data;

            return {
                ok: true,
                sessionId,
                promptConfigId: promptConfig.id,
                arcStep,
                storyTypeId,
                storyTypeName: storyType.name,
                storyContinuation: structuredOutput.storyContinuation,
                options: structuredOutput.options,
                debug: {
                    storySoFarLength: storySoFar.length,
                    arcStepIndex,
                    modelName: 'googleai/gemini-2.5-flash',
                    maxOutputTokens,
                    temperature,
                    promptPreview: finalPrompt.substring(0, 500) + '...',
                }
            };

        } catch (e: any) {
            const errorMessage = e instanceof Error ? e.message : JSON.stringify(e);
            debug.details.error = errorMessage;
            return {
                ok: false,
                sessionId,
                errorMessage: `Unexpected error in storyBeatFlow: ${errorMessage}`,
                debug,
            };
        }
    }
);
