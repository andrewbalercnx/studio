
'use server';
/**
 * @fileOverview A Genkit flow to generate the next story beat.
 */

import { ai } from '@/ai/genkit';
import { initializeFirebase } from '@/firebase';
import { getDoc, doc, collection, getDocs, query, orderBy, where, limit } from 'firebase/firestore';
import { z } from 'genkit';
import type { StorySession, ChatMessage, StoryType, Character, ChildProfile } from '@/lib/types';
import { resolvePromptConfigForSession } from '@/lib/prompt-config-resolver';
import { logSessionEvent } from '@/lib/session-events';
import { summarizeChildPreferences } from '@/lib/child-preferences';
import { replacePlaceholdersWithDescriptions } from '@/lib/resolve-placeholders';

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
    introducesCharacter: z.boolean().optional().describe("Set to true if this option clearly brings a new character into the story."),
    newCharacterLabel: z.string().optional().nullable().describe("If introducesCharacter is true, a short noun phrase for the character (e.g., 'a friendly mailman')."),
    newCharacterKind: z.enum(['toy', 'pet', 'friend', 'family']).optional().nullable().describe("If introducesCharacter is true, the kind of character."),
    existingCharacterId: z.string().optional().nullable().describe("If this choice is about an existing character, provide their ID here."),
    avatarUrl: z.string().optional().nullable().describe("If this choice is about an existing character, provide their avatar URL here."),
  })).min(3).max(3).describe("An array of exactly 3 choices for the child.")
});

const StoryBeatOutputSchemaDescription = JSON.stringify({
  storyContinuation: 'string',
  options: [
    {
      id: 'string',
      text: 'string',
      introducesCharacter: 'boolean (optional)',
      newCharacterLabel: 'string | null (required when introducesCharacter is true)',
      newCharacterKind: "'toy' | 'pet' | 'friend' | 'family' (required when introducesCharacter is true)",
      existingCharacterId: 'string | null (optional)',
      avatarUrl: 'string | null (optional)',
    },
  ],
}, null, 2);

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
            
            const { storyTypeId, mainCharacterId, parentUid } = session;

            if (!storyTypeId) {
                return { ok: false, sessionId, errorMessage: `Session is missing required field: storyTypeId.` };
            }
            if (!parentUid) {
                return { ok: false, sessionId, errorMessage: `Session is missing required field: parentUid.` };
            }

            // 2. Load StoryType
            debug.stage = 'loading_storyType';
            const storyTypeRef = doc(firestore, 'storyTypes', storyTypeId);
            const storyTypeDoc = await getDoc(storyTypeRef);
            if (!storyTypeDoc.exists()) {
                return { ok: false, sessionId, errorMessage: `StoryType with id ${storyTypeId} not found.` };
            }
            const storyType = storyTypeDoc.data() as StoryType;
            let childProfile: ChildProfile | null = null;
            if (session.childId) {
                const childRef = doc(firestore, 'children', session.childId);
                const childDoc = await getDoc(childRef);
                if (childDoc.exists()) {
                    childProfile = childDoc.data() as ChildProfile;
                }
            }
            const childPreferenceSummary = summarizeChildPreferences(childProfile);
            debug.details.childPreferenceSummary = childPreferenceSummary.slice(0, 400);
            
            // BOUND the arc step index
            const arcSteps = storyType.arcTemplate?.steps ?? [];
            const rawArcStepIndex = session.arcStepIndex ?? 0;
            let safeArcStepIndex = 0;
            if (arcSteps.length > 0) {
                const maxIndex = arcSteps.length - 1;
                safeArcStepIndex = Math.max(0, Math.min(rawArcStepIndex, maxIndex));
            }
            const arcStep = arcSteps.length > 0 ? arcSteps[safeArcStepIndex] : "introduce_character";
            debug.details.arcStepIndexRaw = rawArcStepIndex;
            debug.details.arcStepIndexBounded = safeArcStepIndex;
            debug.details.arcStepLabel = arcStep;

            // Load all characters for this parent
            const charactersQuery = query(
                collection(firestore, 'characters'),
                where('ownerParentUid', '==', parentUid),
                limit(10) // Limit to 10 existing characters to avoid overwhelming the prompt
            );
            const charactersSnapshot = await getDocs(charactersQuery);
            const existingCharacters = charactersSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Character));
            const existingCharacterSummary = existingCharacters.map(c => `- ${c.displayName} (ID: ${c.id}, Role: ${c.role})`).join('\n');
            debug.details.existingCharacterCount = existingCharacters.length;
            debug.details.existingCharacterSummary = existingCharacterSummary;

            // 4. Build Story So Far
            const messagesRef = collection(firestore, 'storySessions', sessionId, 'messages');
            const messagesQuery = query(messagesRef, orderBy('createdAt', 'asc'));
            const messagesSnapshot = await getDocs(messagesQuery);
            const rawStorySoFar = messagesSnapshot.docs.map(doc => {
                const data = doc.data() as ChatMessage;
                return `${data.sender === 'assistant' ? 'Story Guide' : 'Child'}: ${data.text}`;
            }).join('\n');
            const storySoFar = await replacePlaceholdersWithDescriptions(rawStorySoFar);


            // 5. Choose PromptConfig using shared helper
            debug.stage = 'loading_promptConfig';
            const { promptConfig, id: resolvedPromptConfigId, debug: resolverDebug } = await resolvePromptConfigForSession(sessionId, 'storyBeat');
            debug.details.resolverDebug = resolverDebug;


            // 6. Build Final Prompt
            const finalPrompt = `
${promptConfig.systemPrompt}

MODE INSTRUCTIONS:
${promptConfig.modeInstructions}

Your goal is to present up to 3 choices. One of those choices should be to introduce an existing character if appropriate for the story.
- If you create an option to use an existing character, you MUST populate 'existingCharacterId' with their ID from the roster.
- For each option, you MUST decide if it introduces a new character.
- Set 'introducesCharacter' to true if the option brings in a new person, animal, or talking object who could appear again.
  - Examples: "a new friend", "a talking squirrel", "a kind robot".
  - If true, you MUST also provide a 'newCharacterLabel' (e.g., "a talking squirrel") and a 'newCharacterKind' ('toy', 'pet', 'friend', or 'family').
- Set 'introducesCharacter' to false if the option is just an action or observation.
  - Examples: "he sings a song", "the sun shines brighter", "he finds a shiny rock".

CONTEXT:
Story Type: ${storyType.name} (${storyTypeId})
Current Arc Step: ${arcStep}
Child Preferences and inspirations:
${childPreferenceSummary}

Existing Character Roster (use these if possible):
${existingCharacterSummary || "No existing characters available."}

STORY SO FAR:
${storySoFar}

Based on all the above, continue the story. Generate the next paragraph and three choices for the child. The next paragraph must use placeholders like '$$characterId$$' instead of names where appropriate. Output your response as a single, valid JSON object that matches this structure:
${StoryBeatOutputSchemaDescription}
Important: Return only a single JSON object. Do not include any extra text, explanation, or formatting. Do not wrap the JSON in markdown or code fences. The output must start with { and end with }.
`;

            // 7. Call Genkit AI
            debug.stage = 'ai_generate';
            const configMax = promptConfig.model?.maxOutputTokens;
            const defaultMax = 1000; // Fallback if not specified in config
            const rawResolved = typeof configMax === 'number' && configMax > 0 ? configMax : defaultMax;
            const maxOutputTokens = Math.max(rawResolved, 10000); // Enforce a high minimum
            
            const llmResponse = await ai.generate({
                model: 'googleai/gemini-2.5-flash',
                prompt: finalPrompt,
                config: {
                    temperature: promptConfig.model?.temperature ?? 0.7,
                    maxOutputTokens: maxOutputTokens,
                }
            });
            
            // 8. Extract raw text robustly
            let rawText: string | null = null;
            if (llmResponse.text) {
                rawText = llmResponse.text;
            } else {
                 const raw = (llmResponse as any).raw ?? (llmResponse as any).custom;
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
                let llmResponseStringified = '[[Could not stringify llmResponse]]';
                try {
                    llmResponseStringified = JSON.stringify(llmResponse, null, 2);
                } catch (e) {
                    // Ignore stringify errors, use the placeholder
                }

                return {
                    ok: false,
                    sessionId,
                    errorMessage: "Model returned empty text for storyBeat.",
                    debug: {
                        stage: 'ai_generate',
                        details: {
                            textPresent: !!rawText,
                            rawTextPreview: rawText ? rawText.slice(0, 500) : null,
                            llmResponseStringified: llmResponseStringified,
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

            // Post-process to add avatar URLs
            for (const option of structuredOutput.options) {
                if (option.existingCharacterId) {
                    const char = existingCharacters.find(c => c.id === option.existingCharacterId);
                    if (char) {
                        option.avatarUrl = char.avatarUrl || null;
                    }
                }
            }


            await logSessionEvent({
                firestore,
                sessionId,
                event: 'storyBeat.generated',
                status: 'completed',
                source: 'server',
                attributes: {
                    arcStep,
                    promptConfigId: resolvedPromptConfigId,
                    storyTypeId,
                },
            });

            return {
                ok: true,
                sessionId,
                promptConfigId: resolvedPromptConfigId,
                arcStep,
                storyTypeId,
                storyTypeName: storyType.name,
                storyContinuation: structuredOutput.storyContinuation,
                options: structuredOutput.options,
                debug: {
                    storySoFarLength: storySoFar.length,
                    arcStepIndex: safeArcStepIndex,
                    modelName: 'googleai/gemini-2.5-flash',
                    maxOutputTokens: maxOutputTokens,
                    temperature: promptConfig.model?.temperature,
                    promptPreview: finalPrompt.substring(0, 500) + '...',
                    resolverDebug: resolverDebug,
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
