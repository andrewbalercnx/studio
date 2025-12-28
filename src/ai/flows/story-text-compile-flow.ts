'use server';

/**
 * @fileOverview A Genkit flow to compile chat session messages into story text.
 * This flow uses an admin-configurable compile prompt from systemConfig/compilePrompt.
 * It outputs just the story text and actors - synopsis, title, etc. are generated separately.
 */

import { ai } from '@/ai/genkit';
import { getServerFirestore } from '@/lib/server-firestore';
import { z } from 'genkit';
import type { StorySession, ChatMessage, StoryType, ChildProfile } from '@/lib/types';
import { logAIFlow } from '@/lib/ai-flow-logger';
import { logAICallToTrace, completeRunTrace } from '@/lib/ai-run-trace';
import { replacePlaceholdersWithDescriptions } from '@/lib/resolve-placeholders.server';
import { getGlobalPrefix } from '@/lib/global-prompt-config.server';
import { getCompilePrompt } from '@/lib/compile-prompt-config.server';
import {
    type ActorInfo,
    buildActorListForPrompt,
    getActorsDetails,
} from '@/lib/story-context-builder';

/**
 * Extract all $$id$$ placeholders from text
 */
function extractActorIds(text: string): string[] {
  const regex = /\$\$([a-zA-Z0-9_-]+)\$\$/g;
  const ids = new Set<string>();
  let match;
  while ((match = regex.exec(text)) !== null) {
    ids.add(match[1]);
  }
  return Array.from(ids);
}

// Default compile prompt used when admin prompt is not configured
const DEFAULT_COMPILE_INSTRUCTIONS = `You are a master storyteller who specializes in polishing story text into a beautifully written narrative for a very young child (age 3-5). The story must be gentle, warm, and safe, with very short, simple sentences. It must be written in the third person. The final text should read like a classic, calm picture-book narrative.

**Your Task:**
You will be given a DRAFT STORY TEXT that was assembled from story beats. Your job is to:
1. Polish and smooth the text so it flows naturally as a single, coherent story
2. Fix any awkward transitions between sections
3. Ensure consistent tone and style throughout
4. Keep the story faithful to the original - do not add new plot points or characters
5. Write a brief 1-2 sentence synopsis suitable for a parent to read

**CRITICAL - Character References:**
You MUST preserve all $$id$$ placeholders exactly as they appear in the draft. These are character references that will be resolved later. Never replace $$id$$ with actual names.`;

const StoryTextCompileResultSchema = z.object({
  storyText: z.string().min(50, "Story text must be at least 50 characters."),
  synopsis: z.string().min(10, "Synopsis must be at least 10 characters."),
});

type StoryTextCompileDebugInfo = {
    stage: 'init' | 'loading_session' | 'loading_dependencies' | 'building_prompt' | 'ai_generate' | 'ai_generate_result' | 'json_parse' | 'unknown';
    details: Record<string, any>;
};

export const storyTextCompileFlow = ai.defineFlow(
    {
        name: 'storyTextCompileFlow',
        inputSchema: z.object({ sessionId: z.string() }),
        outputSchema: z.any(),
    },
    async ({ sessionId }) => {
        let debug: StoryTextCompileDebugInfo = { stage: 'init', details: { sessionId } };

        try {
            const firestore = await getServerFirestore();

            // 1. Load session
            debug.stage = 'loading_session';
            const sessionRef = firestore.collection('storySessions').doc(sessionId);
            const sessionDoc = await sessionRef.get();
            if (!sessionDoc.exists) {
                throw new Error(`Session with id ${sessionId} not found.`);
            }
            const session = sessionDoc.data() as StorySession;
            const { childId, storyTypeId, parentUid } = session;

            if (!childId || !storyTypeId || !parentUid) {
                throw new Error(`Session is missing childId, storyTypeId, or parentUid.`);
            }
            debug.details.childId = childId;
            debug.details.storyTypeId = storyTypeId;
            debug.details.parentUid = parentUid;

            // 2. Load dependencies
            debug.stage = 'loading_dependencies';
            const childRef = firestore.collection('children').doc(childId);
            const storyTypeRef = firestore.collection('storyTypes').doc(storyTypeId);
            const messagesPromise = firestore
                .collection('storySessions')
                .doc(sessionId)
                .collection('messages')
                .orderBy('createdAt', 'asc')
                .get();

            const [childDoc, storyTypeDoc, messagesSnapshot] = await Promise.all([
                childRef.get(),
                storyTypeRef.get(),
                messagesPromise,
            ]);

            if (!storyTypeDoc.exists) throw new Error(`StoryType with id ${storyTypeId} not found.`);

            const childProfile = childDoc.exists ? (childDoc.data() as ChildProfile) : null;
            const storyType = storyTypeDoc.data() as StoryType;
            const messages = messagesSnapshot.docs.map(d => d.data() as ChatMessage);

            const mainCharacterName = childProfile?.displayName ?? 'The hero';

            // Build actor list from session.actors
            const sessionActorIds = session.actors || [];
            const actorIdsToLoad = [childId, ...sessionActorIds.filter(id => id !== childId)];

            // Load actor details
            const actorDetailsJson = await getActorsDetails(firestore, actorIdsToLoad, childId);
            const loadedActors = JSON.parse(actorDetailsJson) as ActorInfo[];

            debug.details.childName = childProfile?.displayName;
            debug.details.storyTypeName = storyType.name;
            debug.details.sessionActorIds = sessionActorIds;
            debug.details.loadedActorCount = loadedActors.length;
            debug.details.messageCount = messages.length;

            // 3. Assemble draft story text from beat_continuation messages + child_ending_choice
            debug.stage = 'building_prompt';

            // Get story continuation messages (the narrative beats)
            const beatContinuations = messages
                .filter(m => m.kind === 'beat_continuation')
                .map(m => m.text);

            // Get the chosen ending
            const endingChoice = messages.find(m => m.kind === 'child_ending_choice');
            const endingText = endingChoice?.text || '';

            // Assemble the draft story text
            const draftStoryParts = [...beatContinuations];
            if (endingText) {
                draftStoryParts.push(endingText);
            }
            const draftStoryText = draftStoryParts.join('\n\n');

            debug.details.beatContinuationCount = beatContinuations.length;
            debug.details.hasEndingChoice = !!endingChoice;
            debug.details.draftStoryLength = draftStoryText.length;

            if (draftStoryText.trim().length === 0) {
                console.warn(`[storyTextCompileFlow] No story content found for session ${sessionId}.`);
                debug.details.warningNoContent = true;
                // Return the empty draft as-is
                return {
                    ok: true,
                    sessionId,
                    storyText: '',
                    synopsis: 'A magical adventure story.',
                    actors: [childId],
                    debug: process.env.NODE_ENV === 'development' ? debug : undefined,
                };
            }

            // Build detailed character roster for context
            const characterRoster = buildActorListForPrompt(loadedActors);

            // Build ID to name mapping
            const actorIdMapping = loadedActors.map(actor =>
                `$$${actor.id}$$ = ${actor.displayName}`
            ).join('\n');

            // Get admin-configurable compile prompt (or use default)
            const globalPrefix = await getGlobalPrefix();
            const adminCompilePrompt = await getCompilePrompt();
            const compileInstructions = adminCompilePrompt || DEFAULT_COMPILE_INSTRUCTIONS;

            // Build the prompt with the draft story text
            const baseSystemPrompt = `${compileInstructions}

**Story Context:**
- **Story Type:** ${storyType.name} (${storyType.shortDescription})
- **Main Character:** ${mainCharacterName} (use $$${childId}$$ in the story)

**CHARACTER REFERENCE (these $$id$$ placeholders appear in the draft):**
${actorIdMapping}

**CHARACTER DETAILS (for context):**
${characterRoster}

**DRAFT STORY TEXT TO POLISH:**
${draftStoryText}

**Output Format (Crucial):**
You MUST return a single JSON object matching this exact shape. Do not include any markdown, code fences, or explanatory text.

{
  "storyText": "The polished story text, preserving all $$id$$ placeholders exactly as they appear.",
  "synopsis": "A brief 1-2 sentence summary of the story suitable for a parent to read. Use $$id$$ placeholders for character names."
}

Now, generate the JSON object containing the polished story and synopsis.`;

            const systemPrompt = globalPrefix ? `${globalPrefix}\n\n${baseSystemPrompt}` : baseSystemPrompt;
            debug.details.promptLength = systemPrompt.length;
            debug.details.usedAdminPrompt = !!adminCompilePrompt;

            // 4. Call AI
            debug.stage = 'ai_generate';
            const maxOutputTokens = 4000;
            const temperature = 0.5;
            const modelName = 'googleai/gemini-2.5-pro';

            let llmResponse;
            let structuredOutput;
            const startTime = Date.now();

            try {
                llmResponse = await ai.generate({
                    model: modelName,
                    prompt: systemPrompt,
                    output: { schema: StoryTextCompileResultSchema },
                    config: { temperature, maxOutputTokens },
                });
                await logAIFlow({ flowName: 'storyTextCompileFlow', sessionId, parentId: parentUid, prompt: systemPrompt, response: llmResponse, startTime, modelName });
                await logAICallToTrace({
                    sessionId,
                    flowName: 'storyTextCompileFlow',
                    modelName,
                    temperature,
                    maxOutputTokens,
                    systemPrompt,
                    response: llmResponse,
                    startTime,
                });

                debug.stage = 'ai_generate_result';
                debug.details.finishReason = (llmResponse as any).finishReason ?? (llmResponse as any).raw?.candidates?.[0]?.finishReason;

                // Extract structured output
                structuredOutput = llmResponse.output;

                if (!structuredOutput) {
                    const rawText = llmResponse.text;
                    if (!rawText || rawText.trim() === '') {
                        throw new Error("Model returned empty text for story text compilation.");
                    }

                    debug.stage = 'json_parse';
                    const jsonMatch = rawText.match(/```json\n([\s\S]*?)\n```/);
                    const jsonToParse = jsonMatch ? jsonMatch[1].trim() : rawText.trim();
                    const parsed = JSON.parse(jsonToParse);
                    const manualValidation = StoryTextCompileResultSchema.safeParse(parsed);
                    if (manualValidation.success) {
                        structuredOutput = manualValidation.data;
                    } else {
                        throw new Error(`Model JSON does not match expected shape: ${manualValidation.error.message}`);
                    }
                }
            } catch (e: any) {
                // Check if this is a schema validation error (model returned null or invalid JSON)
                const isSchemaError = e.message?.includes('Schema validation failed') ||
                                      e.message?.includes('INVALID_ARGUMENT');

                if (isSchemaError) {
                    console.warn(`[storyTextCompileFlow] Schema validation failed, retrying without schema constraint...`);
                    debug.details.schemaRetry = true;

                    // Retry without schema constraint to get raw text
                    try {
                        const retryStartTime = Date.now();
                        llmResponse = await ai.generate({
                            model: modelName,
                            prompt: systemPrompt,
                            config: { temperature, maxOutputTokens },
                        });
                        await logAIFlow({ flowName: 'storyTextCompileFlow:retry', sessionId, parentId: parentUid, prompt: systemPrompt, response: llmResponse, startTime: retryStartTime, modelName });
                        await logAICallToTrace({
                            sessionId,
                            flowName: 'storyTextCompileFlow:retry',
                            modelName,
                            temperature,
                            maxOutputTokens,
                            systemPrompt,
                            response: llmResponse,
                            startTime: retryStartTime,
                        });

                        const rawText = llmResponse.text;
                        if (!rawText || rawText.trim() === '') {
                            throw new Error("Model returned empty text on retry for story text compilation.");
                        }

                        debug.stage = 'json_parse';
                        const jsonMatch = rawText.match(/```json\n([\s\S]*?)\n```/);
                        const jsonToParse = jsonMatch ? jsonMatch[1].trim() : rawText.trim();
                        const parsed = JSON.parse(jsonToParse);
                        const manualValidation = StoryTextCompileResultSchema.safeParse(parsed);
                        if (manualValidation.success) {
                            structuredOutput = manualValidation.data;
                        } else {
                            throw new Error(`Model JSON does not match expected shape on retry: ${manualValidation.error.message}`);
                        }
                    } catch (retryErr: any) {
                        await logAIFlow({ flowName: 'storyTextCompileFlow:retry', sessionId, parentId: parentUid, prompt: systemPrompt, error: retryErr, startTime, modelName });
                        await logAICallToTrace({
                            sessionId,
                            flowName: 'storyTextCompileFlow:retry',
                            modelName,
                            temperature,
                            maxOutputTokens,
                            systemPrompt,
                            error: retryErr,
                            startTime,
                        });
                        throw retryErr;
                    }
                } else {
                    await logAIFlow({ flowName: 'storyTextCompileFlow', sessionId, parentId: parentUid, prompt: systemPrompt, error: e, startTime, modelName });
                    await logAICallToTrace({
                        sessionId,
                        flowName: 'storyTextCompileFlow',
                        modelName,
                        temperature,
                        maxOutputTokens,
                        systemPrompt,
                        error: e,
                        startTime,
                    });
                    throw e;
                }
            }

            const { storyText, synopsis } = structuredOutput;

            // Resolve placeholders in the synopsis (story text keeps placeholders for later resolution)
            const resolvedSynopsis = await replacePlaceholdersWithDescriptions(synopsis);

            // Extract actor IDs from the story text
            const storyActorIds = extractActorIds(storyText);
            const sessionActors = session.actors || [];
            const actorSet = new Set([childId, ...sessionActors, ...storyActorIds]);
            const finalActorIds = [childId, ...Array.from(actorSet).filter(id => id !== childId)];

            debug.details.extractedActorIds = storyActorIds;
            debug.details.finalActorIds = finalActorIds;

            // Mark the run trace as completed since this is typically the final AI call
            await completeRunTrace(sessionId);

            return {
                ok: true,
                sessionId,
                storyText,
                synopsis: resolvedSynopsis,
                actors: finalActorIds,
                debug: process.env.NODE_ENV === 'development' ? {
                    ...debug,
                    storyLength: storyText.length,
                    synopsisLength: resolvedSynopsis.length,
                } : undefined,
            };

        } catch (e: any) {
            debug.details.error = e.message || String(e);
            return {
                ok: false,
                sessionId,
                errorMessage: `Error in storyTextCompileFlow: ${e.message || String(e)}`,
                debug,
            };
        }
    }
);
