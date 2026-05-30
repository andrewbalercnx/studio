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
import { extractEntityIds } from '@/lib/entity-utils';
import { getGlobalPrefix } from '@/lib/global-prompt-config.server';
import { getCompilePrompt } from '@/lib/compile-prompt-config.server';
import {
    type ActorInfo,
    buildActorListForPrompt,
    getActorsDetails,
} from '@/lib/story-context-builder';

/**
 * Sanitize and parse JSON response from the model.
 * Handles:
 * - Markdown code fences (```json ... ```)
 * - Truncated JSON (attempts to repair)
 * - Various quote styles
 */
function parseAndSanitizeJsonResponse(
    rawText: string,
    schema: typeof StoryTextCompileResultSchema,
    debug: StoryTextCompileDebugInfo
): { storyText: string; synopsis: string } {
    let jsonToParse = rawText.trim();

    // Remove markdown code fences if present (various formats)
    // Handle ```json\n...\n``` or ```\n...\n``` or just ```...```
    const codeBlockMatch = jsonToParse.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
    if (codeBlockMatch) {
        jsonToParse = codeBlockMatch[1].trim();
        debug.details.removedCodeFences = true;
    }

    // Try to parse as-is first
    try {
        const parsed = JSON.parse(jsonToParse);
        const validation = schema.safeParse(parsed);
        if (validation.success) {
            return validation.data;
        }
        // If it parsed but didn't validate, throw to try repairs
        throw new Error(`Schema validation failed: ${validation.error.message}`);
    } catch (firstError: any) {
        debug.details.firstParseError = firstError.message;

        // Attempt to repair truncated JSON
        // Common issue: JSON cut off mid-string like: {"storyText": "Once upon a time...
        let repaired = jsonToParse;

        // Count open braces/brackets to detect truncation
        const openBraces = (repaired.match(/{/g) || []).length;
        const closeBraces = (repaired.match(/}/g) || []).length;

        if (openBraces > closeBraces) {
            debug.details.attemptingJsonRepair = true;

            // Try to close the JSON structure
            // First, check if we're in the middle of a string (odd number of unescaped quotes)
            const quoteMatches = repaired.match(/(?<!\\)"/g) || [];
            if (quoteMatches.length % 2 !== 0) {
                // Close the open string
                repaired += '"';
            }

            // Add missing closing braces
            for (let i = 0; i < openBraces - closeBraces; i++) {
                repaired += '}';
            }

            try {
                const repairedParsed = JSON.parse(repaired);
                const validation = schema.safeParse(repairedParsed);
                if (validation.success) {
                    debug.details.jsonRepairSucceeded = true;
                    return validation.data;
                }
            } catch (repairError: any) {
                debug.details.jsonRepairFailed = repairError.message;
            }
        }

        // If all else fails, throw the original error
        throw new Error(`Model JSON does not match expected shape: ${firstError.message}`);
    }
}

// Default compile prompt used when admin prompt is not configured
const DEFAULT_COMPILE_INSTRUCTIONS = `You are a master storyteller who specializes in polishing story text into a beautifully written narrative for a very young child (age 3-5). The story must be gentle, warm, and safe, with very short, simple sentences. It must be written in the third person. The final text should read like a classic, calm picture-book narrative.

**Your Task:**
You will be given a DRAFT STORY TEXT that was assembled from story beats. Your job is to:
1. Polish and smooth the text so it flows naturally as a single, coherent story
2. Fix any awkward transitions between sections
3. Ensure consistent tone and style throughout
4. Keep the story faithful to the original - do not add new plot points or characters
5. Write a brief synopsis (1-2 sentences, maximum 30 words) suitable for a parent to read

**Character References:**
If $$id$$ placeholders appear in the draft, replace them with the actual character name from the CHARACTER REFERENCE section below. The final story text must use real names — this makes it readable in the finished book.`;

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
            const beatMessages = messages.filter(m => m.kind === 'beat_continuation');
            const beatContinuations = beatMessages.map(m => m.text);
            // Collect actor IDs from scene annotations — includes implicit actors text extraction misses
            const sceneActorIds = new Set<string>();
            beatMessages.forEach(m => m.scene?.presentActors?.forEach(id => sceneActorIds.add(id)));

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
- **Main Character:** ${mainCharacterName}

**CHARACTER REFERENCE (replace these $$id$$ placeholders with the names shown):**
${actorIdMapping}

**CHARACTER DETAILS (for context):**
${characterRoster}

**DRAFT STORY TEXT TO POLISH:**
${draftStoryText}

**OUTPUT FORMAT — STRICT:**
Your entire response must be a single raw JSON object. No markdown. No code fences. No explanation before or after. The response must begin with { and end with }. Any deviation makes the story unreadable.

{
  "storyText": "The polished story text with character names resolved (no $$id$$ placeholders).",
  "synopsis": "A brief 1-2 sentence summary of the story suitable for a parent to read, using character names."
}

Respond with only the JSON object now.`;

            const systemPrompt = globalPrefix ? `${globalPrefix}\n\n${baseSystemPrompt}` : baseSystemPrompt;
            debug.details.promptLength = systemPrompt.length;
            debug.details.usedAdminPrompt = !!adminCompilePrompt;

            // 4. Call AI
            debug.stage = 'ai_generate';
            // Increased from 4000 to 8192 to prevent truncation of longer stories
            // The story text + synopsis JSON can exceed 4000 tokens for longer narratives
            const maxOutputTokens = 8192;
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
                    structuredOutput = parseAndSanitizeJsonResponse(rawText, StoryTextCompileResultSchema, debug);
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
                            // Fallback: use the draft story text as-is since AI compilation failed
                            console.warn(`[storyTextCompileFlow] Model returned empty text on retry, falling back to draft story text`);
                            debug.details.fallbackToDraft = true;
                            structuredOutput = {
                                storyText: draftStoryText,
                                synopsis: 'A magical adventure story.',
                            };
                        } else {
                            debug.stage = 'json_parse';
                            try {
                                structuredOutput = parseAndSanitizeJsonResponse(rawText, StoryTextCompileResultSchema, debug);
                            } catch (parseErr: any) {
                                // Fallback on parse failure
                                console.warn(`[storyTextCompileFlow] JSON parse failed on retry, falling back to draft story text: ${parseErr.message}`);
                                debug.details.fallbackToDraft = true;
                                debug.details.parseError = parseErr.message;
                                structuredOutput = {
                                    storyText: draftStoryText,
                                    synopsis: 'A magical adventure story.',
                                };
                            }
                        }
                    } catch (retryErr: any) {
                        // On any retry error, fall back to draft story text
                        console.warn(`[storyTextCompileFlow] Retry failed, falling back to draft story text: ${retryErr.message}`);
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
                        debug.details.fallbackToDraft = true;
                        debug.details.retryError = retryErr.message;
                        structuredOutput = {
                            storyText: draftStoryText,
                            synopsis: 'A magical adventure story.',
                        };
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

            // Resolve any remaining placeholders in the synopsis (story text should already have names from compile step)
            const resolvedSynopsis = await replacePlaceholdersWithDescriptions(synopsis);

            // Extract actor IDs from the story text
            const storyActorIds = extractEntityIds(storyText);
            const sessionActors = session.actors || [];
            const actorSet = new Set([childId, ...sessionActors, ...storyActorIds]);
            const finalActorIds = [childId, ...Array.from(actorSet).filter(id => id !== childId)];

            debug.details.extractedActorIds = storyActorIds;
            debug.details.finalActorIds = finalActorIds;
            debug.details.sceneAnnotatedActorCount = sceneActorIds.size;

            // Mark the run trace as completed since this is typically the final AI call
            await completeRunTrace(sessionId);

            return {
                ok: true,
                sessionId,
                storyText,
                synopsis: resolvedSynopsis,
                actors: finalActorIds,
                // Actor IDs from scene annotations — more accurate than text extraction
                // because they include actors referenced implicitly or grammatically
                sceneAnnotatedActorIds: sceneActorIds.size > 0 ? [...sceneActorIds] : undefined,
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
