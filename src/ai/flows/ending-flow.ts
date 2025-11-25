
'use server';

/**
 * @fileOverview A Genkit flow to generate three possible story endings.
 */

import { ai } from '@/ai/genkit';
import { initializeFirebase } from '@/firebase';
import { getDoc, doc, collection, getDocs, query, orderBy, where, updateDoc } from 'firebase/firestore';
import { z } from 'genkit';
import type { StorySession, ChatMessage, StoryType, Character } from '@/lib/types';

type EndingFlowDebugInfo = {
    stage: 'loading_session' | 'loading_storyType' | 'loading_messages_and_characters' | 'ai_generate' | 'ai_generate_result' | 'json_parse' | 'json_validate' | 'unknown';
    details: Record<string, any>;
};

// Zod schema for the expected JSON output from the model
const EndingFlowOutputSchema = z.object({
  endings: z.array(z.object({
    id: z.string().describe("A single uppercase letter, e.g., 'A', 'B', 'C'."),
    text: z.string().describe("Two to three very short sentences that provide a gentle, happy ending to the story."),
  })).min(3).max(3).describe("An array of exactly 3 possible endings for the story.")
});


export const endingFlow = ai.defineFlow(
    {
        name: 'endingFlow',
        inputSchema: z.object({ sessionId: z.string() }),
        outputSchema: z.any(), // Using any to allow for custom error/success shapes
    },
    async ({ sessionId }) => {
        let debug: EndingFlowDebugInfo = { stage: 'unknown', details: {} };

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
            const { storyTypeId, arcStepIndex } = session;
            if (!storyTypeId || typeof arcStepIndex !== 'number') {
                return { ok: false, sessionId, errorMessage: `Session is missing storyTypeId or arcStepIndex.` };
            }
            debug.details.storyTypeId = storyTypeId;
            debug.details.arcStepIndex = arcStepIndex;
            
            // --- Phase State Correction ---
            if (session.currentPhase !== 'ending') {
                await updateDoc(sessionRef, {
                    currentPhase: 'ending',
                    storyPhaseId: 'ending_phase_v1'
                });
                debug.details.phaseCorrected = `Set currentPhase to 'ending'`;
            }


            // 2. Load StoryType
            debug.stage = 'loading_storyType';
            const storyTypeRef = doc(firestore, 'storyTypes', storyTypeId);
            const storyTypeDoc = await getDoc(storyTypeRef);
            if (!storyTypeDoc.exists()) {
                return { ok: false, sessionId, errorMessage: `StoryType with id ${storyTypeId} not found.` };
            }
            const storyType = storyTypeDoc.data() as StoryType;
            const arcSteps = storyType.arcTemplate?.steps ?? [];
            const maxIndex = arcSteps.length > 0 ? arcSteps.length - 1 : 0;
            const isAtFinalStep = arcStepIndex >= maxIndex;
            debug.details.isAtFinalStep = isAtFinalStep;
            debug.details.lastStepId = arcSteps[maxIndex];

            // 3. Load Characters and Messages
            debug.stage = 'loading_messages_and_characters';
            const charactersQuery = query(collection(firestore, 'characters'), where('sessionId', '==', sessionId));
            const charactersSnapshot = await getDocs(charactersQuery);
            const characterRoster = charactersSnapshot.docs.map(d => {
                const char = d.data() as Character;
                return `- ${char.name} (role: ${char.role}, traits: ${char.traits?.join(', ') || 'none'})`;
            }).join('\n');

            const messagesQuery = query(collection(firestore, `storySessions/${sessionId}/messages`), orderBy('createdAt', 'asc'));
            const messagesSnapshot = await getDocs(messagesQuery);
            const storySoFar = messagesSnapshot.docs.map(d => {
                const msg = d.data() as ChatMessage;
                return `${msg.sender === 'assistant' ? 'Story Guide' : 'Child'}: ${msg.text}`;
            }).join('\n');
            debug.details.storySoFarLength = storySoFar.length;
            debug.details.characterCount = charactersSnapshot.size;


            // 4. Build Final Prompt
            const finalPrompt = `You are the Story Guide, a gentle storyteller for very young children (3-5). Your task is to propose three possible happy endings for a story.
- Your tone must be warm, gentle, and safe.
- Endings must be short (2-3 very simple sentences).
- Do not use scary topics, complex words, lists, or emojis.

CONTEXT:
Story Type: ${storyType.name}
Characters:
${characterRoster || '- No characters found.'}

STORY SO FAR:
${storySoFar}

OUTPUT FORMAT (important):
You MUST return a single JSON object with this exact shape:
{
  "endings": [
    { "id": "A", "text": "ending one in 2 or 3 very short sentences" },
    { "id": "B", "text": "ending two in 2 or 3 very short sentences" },
    { "id": "C", "text": "ending three in 2 or 3 very short sentences" }
  ]
}

Rules:
- The value of "endings" MUST be an array of exactly 3 objects.
- Each object MUST have an "id" field with one of "A", "B", or "C".
- Each object MUST have a "text" field that is a single string.
- Do NOT return an array of strings. Each item MUST be an object with "id" and "text".
- Do NOT include code fences.
- Do NOT include markdown.
- Do NOT include any explanation or extra fields.
- The entire response MUST be valid JSON starting with { and ending with }.

Based on all the above, return ONLY the JSON object containing three endings.`;

            debug.details.promptLength = finalPrompt.length;
            debug.details.promptPreview = finalPrompt.slice(0, 500) + '...';

            // 5. Call Genkit AI
            debug.stage = 'ai_generate';
            const modelConfig = {
                temperature: 0.4,
                maxOutputTokens: 2000,
            };
            debug.details.modelConfig = modelConfig;
            
            const llmResponse = await ai.generate({
                model: 'googleai/gemini-2.5-flash',
                prompt: finalPrompt,
                config: modelConfig,
            });
            
            debug.stage = 'ai_generate_result';
            const rawText = llmResponse.text;
            debug.details.finishReason = (llmResponse as any).finishReason ?? (llmResponse as any).raw?.candidates?.[0]?.finishReason;
            debug.details.topLevelFinishReason = (llmResponse as any).finishReason ?? null;
            debug.details.firstCandidateFinishReason = (llmResponse as any).raw?.candidates?.[0]?.finishReason ?? null;
            debug.details.rawTextPreview = rawText ? rawText.slice(0, 200) : null;


            if (!rawText || rawText.trim() === '') {
                if (debug.details.firstCandidateFinishReason === 'MAX_TOKENS' || debug.details.topLevelFinishReason === 'length') {
                     throw new Error("Model hit MAX_TOKENS during ending generation; increase maxOutputTokens.");
                }
                throw new Error("Model returned empty text for ending generation.");
            }
            
            // 6. Parse and validate
            debug.stage = 'json_parse';
            let parsed: z.infer<typeof EndingFlowOutputSchema>;
            try {
                const jsonMatch = rawText.match(/```json\n([\s\S]*?)\n```/);
                const jsonToParse = jsonMatch ? jsonMatch[1].trim() : rawText.trim();
                parsed = JSON.parse(jsonToParse);
            } catch (err: any) {
                debug.details.parseError = err.message;
                throw new Error("Model output is not valid JSON for endings.");
            }

            debug.stage = 'json_validate';
            const validationResult = EndingFlowOutputSchema.safeParse(parsed);
            if (!validationResult.success) {
                debug.details.validationErrors = validationResult.error.issues;
                 throw new Error(`Model JSON does not match expected ending shape. Errors: ${validationResult.error.message}`);
            }

            return {
                ok: true,
                sessionId,
                storyTypeId: storyType.id,
                arcStep: arcSteps[arcStepIndex] || null,
                endings: validationResult.data.endings,
                debug: process.env.NODE_ENV === 'development' ? debug : undefined,
            };

        } catch (e: any) {
            debug.details.error = e.message || String(e);
            return {
                ok: false,
                sessionId,
                errorMessage: `Unexpected error in endingFlow: ${e.message || String(e)}`,
                debug,
            };
        }
    }
);
