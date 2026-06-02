
'use server';
/**
 * @fileOverview A Genkit flow to generate the next story beat.
 *
 * This flow uses the new structured prompt system:
 * - Schema: @/lib/schemas/story-beat-output
 * - Prompt Builder: @/lib/prompt-builders/story-beat-prompt-builder
 *
 * For story types with promptConfig, uses the new system.
 * For legacy story types, falls back to PromptConfig from Firestore.
 */

import { ai } from '@/ai/genkit';
import { getServerFirestore } from '@/lib/server-firestore';
import { z } from 'genkit';
import type { MessageData } from 'genkit';
import type { StorySession, ChatMessage, StoryType, Character, ChildProfile, ArcStep, WorldState } from '@/lib/types';
import { resolvePromptConfigForSession } from '@/lib/prompt-config-resolver';
import { logServerSessionEvent } from '@/lib/session-events.server';
import { summarizeChildPreferences } from '@/lib/child-preferences';
import { replacePlaceholdersInText, extractEntityMetadataFromText } from '@/lib/resolve-placeholders.server';
import { logAIFlow } from '@/lib/ai-flow-logger';
import { initializeRunTrace, logAICallToTrace } from '@/lib/ai-run-trace';
import { buildStoryContext, buildEntityMapFromContext } from '@/lib/story-context-builder';
import { buildStorySystemMessage } from '@/lib/build-story-system-message';
import { getGlobalPrefix } from '@/lib/global-prompt-config.server';
// New structured prompt system
import { StoryBeatOutputSchema, generateStoryBeatOutputDescription } from '@/lib/schemas/story-beat-output';
import { buildStoryBeatPrompt, type StoryBeatPromptContext } from '@/lib/prompt-builders/story-beat-prompt-builder';

/**
 * Normalizes arc steps to handle both legacy string format and new ArcStep object format.
 * Provides backward compatibility for existing storyTypes in Firestore.
 */
function normalizeArcSteps(steps: (string | ArcStep)[]): ArcStep[] {
  return steps.map(step =>
    typeof step === 'string'
      ? { id: step, label: step.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()) }
      : step
  );
}

type StoryBeatDebugInfo = {
    stage: 'loading_session' | 'loading_storyType' | 'loading_promptConfig' | 'building_prompt' | 'ai_generate' | 'json_parse' | 'json_validate' | 'unknown';
    details: Record<string, any>;
    usedNewPromptSystem?: boolean;
};

export const storyBeatFlow = ai.defineFlow(
    {
        name: 'storyBeatFlow',
        inputSchema: z.object({ sessionId: z.string() }),
        outputSchema: z.any(), // Using any to allow for custom error/success shapes
    },
    async ({ sessionId }) => {
        let debug: StoryBeatDebugInfo = { stage: 'unknown', details: {} };

        // Check for Gemini API key before doing anything else
        const geminiApiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
        if (!geminiApiKey) {
            console.error('[storyBeatFlow] GEMINI_API_KEY or GOOGLE_API_KEY environment variable not set');
            return {
                ok: false,
                sessionId,
                errorMessage: 'Story generation service is not configured. Please contact support.',
            };
        }

        try {
            const firestore = await getServerFirestore();

            // 1. Load session
            debug.stage = 'loading_session';
            const sessionDoc = await firestore.collection('storySessions').doc(sessionId).get();
            if (!sessionDoc.exists) {
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

            // 2. Load storyType, story context, messages, and global prefix in parallel
            debug.stage = 'loading_storyType';
            const [storyTypeDoc, contextResult, messagesSnapshot, globalPrefix] = await Promise.all([
                firestore.collection('storyTypes').doc(storyTypeId).get(),
                buildStoryContext(
                    parentUid,
                    session.childId,
                    session.mainCharacterId,
                    session.supportingCharacterIds
                ),
                firestore.collection('storySessions').doc(sessionId)
                    .collection('messages').orderBy('createdAt', 'asc').get(),
                getGlobalPrefix(),
            ]);

            if (!storyTypeDoc.exists) {
                return { ok: false, sessionId, errorMessage: `StoryType with id ${storyTypeId} not found.` };
            }
            const storyType = storyTypeDoc.data() as StoryType;
            const { data: contextData, formatted: contextFormatted } = contextResult;
            const childProfile = contextData.mainChild;
            const childAge = contextData.childAge;
            const childPreferenceSummary = summarizeChildPreferences(childProfile);
            debug.details.childPreferenceSummary = childPreferenceSummary.slice(0, 400);
            debug.details.childAge = childAge;
            debug.details.siblingsCount = contextData.siblings.length;
            debug.details.charactersCount = contextData.characters.length + (contextData.mainCharacter ? 1 : 0);

            // Fire-and-forget trace initialization (non-blocking write)
            initializeRunTrace({
                sessionId,
                parentUid,
                childId: session.childId,
                storyTypeId,
                storyTypeName: storyType.name,
            }).catch(err => console.error('[storyBeatFlow] initializeRunTrace error:', err));

            // Build entity map from already-loaded context (no extra Firestore reads needed)
            const prebuiltEntityMap = buildEntityMapFromContext(contextData);

            // Build list of existing characters (including mainCharacter if it exists for backward compatibility)
            const existingCharacters = contextData.mainCharacter
                ? [contextData.mainCharacter, ...contextData.characters]
                : contextData.characters;

            // BOUND the arc step index and normalize steps for backward compatibility
            const rawArcSteps = storyType.arcTemplate?.steps ?? [];
            const arcSteps = normalizeArcSteps(rawArcSteps);
            const rawArcStepIndex = session.arcStepIndex ?? 0;
            let safeArcStepIndex = 0;
            if (arcSteps.length > 0) {
                const maxIndex = arcSteps.length - 1;
                safeArcStepIndex = Math.max(0, Math.min(rawArcStepIndex, maxIndex));
            }
            const defaultArcStep: ArcStep = { id: "introduce_character", label: "Introduce Character" };
            const arcStepObj = arcSteps.length > 0 ? arcSteps[safeArcStepIndex] : defaultArcStep;
            debug.details.arcStepIndexRaw = rawArcStepIndex;
            debug.details.arcStepIndexBounded = safeArcStepIndex;
            debug.details.arcStepId = arcStepObj.id;
            debug.details.arcStepLabel = arcStepObj.label;
            debug.details.arcStepGuidance = arcStepObj.guidance || '(none)';

            // Calculate story temperature based on arc progress
            const arcProgress = arcSteps.length > 0 ? safeArcStepIndex / Math.max(arcSteps.length - 1, 1) : 0;

            // Message count from already-fetched snapshot (no separate count query needed)
            const messageCount = messagesSnapshot.docs.length;
            const lengthFactor = Math.min(messageCount / 20, 1.0); // Normalize to 20 beats

            // Combined temperature (70% arc progress, 30% length)
            const combinedTemperature = (arcProgress * 0.7) + (lengthFactor * 0.3);
            debug.details.temperature = {
                arcProgress,
                messageCount,
                lengthFactor,
                combined: combinedTemperature,
            };


            // 4. Build Messages Array for conversation history
            // Cap context window to bound token payload; summarise earlier beats for continuity
            const CONTEXT_WINDOW = 8;
            const allDocs = messagesSnapshot.docs;
            const historicalDocs = allDocs.length > CONTEXT_WINDOW ? allDocs.slice(0, allDocs.length - CONTEXT_WINDOW) : [];
            const recentDocs = allDocs.length > CONTEXT_WINDOW ? allDocs.slice(-CONTEXT_WINDOW) : allDocs;

            // Resolve placeholders for all messages in parallel (uses prebuiltEntityMap — no Firestore reads)
            const [recentResolved, historicalResolved] = await Promise.all([
                Promise.all(recentDocs.map(async (doc) => {
                    const data = doc.data() as ChatMessage;
                    const resolvedText = await replacePlaceholdersInText(data.text, prebuiltEntityMap);
                    return { data, resolvedText };
                })),
                Promise.all(historicalDocs.map(async (doc) => {
                    const data = doc.data() as ChatMessage;
                    const resolvedText = await replacePlaceholdersInText(data.text, prebuiltEntityMap);
                    return { data, resolvedText };
                })),
            ]);

            // Build narrative summary from historical beat_continuation messages (resolved text)
            const narrativeSummaryParts = historicalResolved
                .filter(({ data }) => data.kind === 'beat_continuation')
                .map(({ resolvedText }) => resolvedText);
            const narrativeSummary = narrativeSummaryParts.length > 0
                ? narrativeSummaryParts.join('\n\n')
                : null;

            // Windowed conversation for AI (new system uses last CONTEXT_WINDOW messages only)
            // beat_options messages ("What happens next?") are UI-only — exclude them from the AI
            // context to avoid consecutive model turns and token waste. The selected choice is
            // already carried by the child_choice user message that follows.
            const conversationMessages: MessageData[] = recentResolved
                .filter(({ data }) => data.kind !== 'beat_options')
                .map(({ data, resolvedText }) => ({
                    role: data.sender === 'assistant' ? 'model' : 'user',
                    content: [{ text: resolvedText }],
                }));

            // Full message list for trace logging and legacy storySoFar
            const allConversationMessages = [...historicalResolved, ...recentResolved];

            // Build storySoFar string for legacy system (full history embedded in prompt)
            const storySoFar = allConversationMessages
                .map(({ data, resolvedText }) =>
                    `${data.sender === 'assistant' ? 'Story Guide' : 'Child'}: ${resolvedText}`
                )
                .join('\n');


            // 5. Build prompt - use new system if storyType has promptConfig, otherwise fallback to legacy
            debug.stage = 'building_prompt';
            let finalPrompt: string;
            let resolvedPromptConfigId: string | null = null;
            let modelTemperature = 0.7;
            let maxOutputTokens = 10000;

            if (storyType.promptConfig) {
                // NEW SYSTEM: Use structured prompt builder with messages array
                debug.usedNewPromptSystem = true;

                const promptContext: StoryBeatPromptContext = {
                    storyType,
                    formattedContext: contextFormatted,
                    childAge,
                    arcStep: arcStepObj,
                    arcProgress: combinedTemperature,
                    childPreferenceSummary,
                    levelBand: session.promptConfigLevelBand,
                    useMessagesArray: true, // Story history will be passed via messages parameter
                    useSchemaOutput: true,  // Schema is passed to model separately, no need for text-based output requirements
                    globalPrefix,
                    currentWorldState: session.worldState,
                };

                finalPrompt = buildStoryBeatPrompt(promptContext);

                // Inject narrative summary of earlier beats to maintain story continuity within token budget
                if (narrativeSummary) {
                    finalPrompt += `\n\n=== STORY SO FAR (earlier beats for continuity) ===\n${narrativeSummary}\n\n(The most recent conversation follows in the messages below.)`;
                }

                // Use model settings from storyType.promptConfig
                modelTemperature = storyType.promptConfig.model?.temperature ?? 0.7;
                maxOutputTokens = storyType.promptConfig.model?.maxOutputTokens ?? 10000;

                debug.details.promptSystem = 'new';
                debug.details.storyTypeHasPromptConfig = true;
            } else {
                // LEGACY SYSTEM: Fallback to PromptConfig from Firestore
                debug.usedNewPromptSystem = false;
                debug.stage = 'loading_promptConfig';

                const { promptConfig, id: legacyPromptConfigId, debug: resolverDebug } = await resolvePromptConfigForSession(sessionId, 'storyBeat');
                resolvedPromptConfigId = legacyPromptConfigId;
                debug.details.resolverDebug = resolverDebug;

                // Build legacy prompt
                const temperatureGuidance = combinedTemperature > 0.7
                    ? `\n\nIMPORTANT STORY PROGRESSION: The story is ${Math.round(combinedTemperature * 100)}% complete and should be wrapping up. Start guiding toward a satisfying conclusion. Consider including options that lead to resolution and closure. The story should feel like it's reaching its natural end.`
                    : combinedTemperature > 0.5
                    ? `\n\nSTORY PROGRESSION: The story is ${Math.round(combinedTemperature * 100)}% through its arc. Begin setting up for the climax and resolution. Introduce elements that will help bring the story to a close in the next few beats.`
                    : combinedTemperature > 0.3
                    ? `\n\nSTORY PROGRESSION: The story is ${Math.round(combinedTemperature * 100)}% complete. Continue developing the plot while keeping the story moving forward toward its eventual conclusion.`
                    : '';

                const systemMessage = buildStorySystemMessage(contextFormatted, childAge, 'story_beat', globalPrefix);

                finalPrompt = `
${systemMessage}

=== ADDITIONAL STORY GUIDANCE ===
${promptConfig.systemPrompt}

${promptConfig.modeInstructions}

=== CURRENT SESSION ===
Story Type: ${storyType.name}
Arc Step: ${arcStepObj.id} (${arcStepObj.label})
${arcStepObj.guidance ? `Step Guidance: ${arcStepObj.guidance}` : ''}
${temperatureGuidance}

Child's inspirations: ${childPreferenceSummary}

=== STORY SO FAR ===
${storySoFar}

=== OUTPUT FORMAT ===
Return a single valid JSON object (no markdown, no explanation):
${generateStoryBeatOutputDescription()}
`;

                // Use model settings from legacy promptConfig
                const configMax = promptConfig.model?.maxOutputTokens;
                const defaultMax = 1000;
                const rawResolved = typeof configMax === 'number' && configMax > 0 ? configMax : defaultMax;
                maxOutputTokens = Math.max(rawResolved, 10000);
                modelTemperature = promptConfig.model?.temperature ?? 0.7;

                debug.details.promptSystem = 'legacy';
                debug.details.storyTypeHasPromptConfig = false;
            }

            // 6. Call Genkit AI
            debug.stage = 'ai_generate';

            // Determine model name from storyType or use default (flash for low latency)
            const modelName = storyType.promptConfig?.model?.name || 'googleai/gemini-2.5-flash';
            // Disable thinking for beat generation — story beats don't benefit from extended reasoning,
            // and thinking tokens represent ~28% of cost with no quality gain for this task.
            // Only Flash supports thinkingBudget: 0; Pro requires thinking mode and rejects the call.
            const beatGenConfig = {
                temperature: modelTemperature,
                maxOutputTokens: maxOutputTokens,
                ...(modelName.includes('gemini-2.5-flash') && { thinkingConfig: { thinkingBudget: 0 } }),
            };

            let llmResponse;
            const startTime = Date.now();

            // Prepare user messages for trace logging (full history)
            const userMessagesForTrace = allConversationMessages.map(({ data, resolvedText }) => ({
                role: data.sender === 'assistant' ? 'model' as const : 'user' as const,
                content: resolvedText,
            }));

            try {
                // Check if the last message is from the user (required for messages array)
                const lastMessage = conversationMessages[conversationMessages.length - 1];
                const lastMessageIsFromUser = lastMessage && lastMessage.role === 'user';

                if (debug.usedNewPromptSystem && conversationMessages.length > 0 && lastMessageIsFromUser) {
                    // NEW SYSTEM: Use messages array for conversation history
                    // The system prompt contains role, context, and output requirements
                    // The messages array contains the actual conversation history
                    // Using output parameter for structured schema validation
                    // NOTE: Gemini API requires the last message to be from the user
                    llmResponse = await ai.generate({
                        model: modelName,
                        system: finalPrompt,
                        messages: conversationMessages,
                        output: { schema: StoryBeatOutputSchema },
                        config: beatGenConfig,
                    });
                } else {
                    // LEGACY SYSTEM: Use prompt with embedded STORY SO FAR
                    // Using output parameter for structured schema validation
                    llmResponse = await ai.generate({
                        model: modelName,
                        prompt: finalPrompt,
                        output: { schema: StoryBeatOutputSchema },
                        config: beatGenConfig,
                    });
                }

                // Log to both the individual AI flow log and the run trace
                await logAIFlow({ flowName: 'storyBeatFlow', sessionId, parentId: parentUid, prompt: finalPrompt, response: llmResponse, startTime, modelName });
                await logAICallToTrace({
                    sessionId,
                    flowName: 'storyBeatFlow',
                    modelName,
                    temperature: modelTemperature,
                    maxOutputTokens,
                    systemPrompt: finalPrompt,
                    userMessages: debug.usedNewPromptSystem ? userMessagesForTrace : undefined,
                    response: llmResponse,
                    startTime,
                });
            } catch (e: any) {
                await logAIFlow({ flowName: 'storyBeatFlow', sessionId, parentId: parentUid, prompt: finalPrompt, error: e, startTime, modelName });
                await logAICallToTrace({
                    sessionId,
                    flowName: 'storyBeatFlow',
                    modelName,
                    temperature: modelTemperature,
                    maxOutputTokens,
                    systemPrompt: finalPrompt,
                    userMessages: debug.usedNewPromptSystem ? userMessagesForTrace : undefined,
                    error: e,
                    startTime,
                });
                throw e;
            }
            
            // 8. Extract structured output using Genkit's output parameter
            // The output parameter handles JSON parsing and schema validation automatically
            const structuredOutput = llmResponse.output;

            if (!structuredOutput) {
                // Fallback: try manual parsing if output is null
                const rawText = llmResponse.text;
                if (rawText) {
                    debug.stage = 'json_parse';
                    try {
                        let jsonToParse = rawText.trim();
                        const jsonMarkdownMatch = rawText.match(/```json\n([\s\S]*?)\n```/);
                        if (jsonMarkdownMatch) {
                            jsonToParse = jsonMarkdownMatch[1].trim();
                        } else {
                            const jsonObjectMatch = rawText.match(/\{[\s\S]*"storyContinuation"[\s\S]*\}/);
                            if (jsonObjectMatch) {
                                jsonToParse = jsonObjectMatch[0].trim();
                            }
                        }
                        const parsed = JSON.parse(jsonToParse);
                        const validationResult = StoryBeatOutputSchema.safeParse(parsed);
                        if (validationResult.success) {
                            // Use the manually parsed result
                            const manualOutput = validationResult.data;
                            // Continue with post-processing below
                            for (const option of manualOutput.options) {
                                if (option.existingCharacterId) {
                                    const char = existingCharacters.find(c => c.id === option.existingCharacterId);
                                    if (char) {
                                        option.avatarUrl = char.avatarUrl || undefined;
                                    }
                                }
                            }

                            await logServerSessionEvent({
                                firestore,
                                sessionId,
                                event: 'storyBeat.generated',
                                status: 'completed',
                                source: 'server',
                                attributes: {
                                    arcStep: arcStepObj.id,
                                    arcStepLabel: arcStepObj.label,
                                    promptConfigId: resolvedPromptConfigId,
                                    storyTypeId,
                                    usedFallbackParsing: true,
                                },
                            });

                            const [resolvedStoryContinuation, resolvedOptions] = await Promise.all([
                                replacePlaceholdersInText(manualOutput.storyContinuation, prebuiltEntityMap),
                                Promise.all(
                                    manualOutput.options.map(async (option) => ({
                                        ...option,
                                        text: await replacePlaceholdersInText(option.text, prebuiltEntityMap),
                                        entities: await extractEntityMetadataFromText(option.text, prebuiltEntityMap),
                                    }))
                                ),
                            ]);

                            return {
                                ok: true,
                                sessionId,
                                promptConfigId: resolvedPromptConfigId,
                                arcStep: arcStepObj.id,
                                arcStepLabel: arcStepObj.label,
                                storyTypeId,
                                storyTypeName: storyType.name,
                                storyContinuation: manualOutput.storyContinuation,
                                storyContinuationResolved: resolvedStoryContinuation,
                                options: manualOutput.options,
                                optionsResolved: resolvedOptions,
                                scene: manualOutput.scene,
                                // Progress: arc step completion (0.0 to ~0.9, leaving room for ending)
                                progress: arcSteps.length > 1 ? (safeArcStepIndex + 1) / (arcSteps.length + 1) : 0.5,
                                debug: {
                                    storySoFarLength: storySoFar.length,
                                    messagesCount: conversationMessages.length,
                                    totalMessagesCount: allConversationMessages.length,
                                    contextWindowUsed: CONTEXT_WINDOW,
                                    narrativeSummaryLength: narrativeSummary?.length ?? 0,
                                    usedMessagesArray: debug.usedNewPromptSystem && conversationMessages.length > 0,
                                    arcStepIndex: safeArcStepIndex,
                                    modelName,
                                    maxOutputTokens,
                                    temperature: modelTemperature,
                                    usedNewPromptSystem: debug.usedNewPromptSystem,
                                    promptSystem: debug.details.promptSystem,
                                    usedFallbackParsing: true,
                                }
                            };
                        }
                    } catch (parseErr) {
                        // Fall through to error below
                    }
                }

                return {
                    ok: false,
                    sessionId,
                    errorMessage: "Model failed to generate valid structured output for storyBeat.",
                    debug: {
                        stage: 'output_extraction',
                        details: {
                            outputWasNull: true,
                            rawTextPreview: llmResponse.text?.slice(0, 500) || null,
                        }
                    }
                };
            }

            // Post-process to add avatar URLs
            for (const option of structuredOutput.options) {
                if (option.existingCharacterId) {
                    const char = existingCharacters.find(c => c.id === option.existingCharacterId);
                    if (char) {
                        option.avatarUrl = char.avatarUrl || undefined;
                    }
                }
            }


            await logServerSessionEvent({
                firestore,
                sessionId,
                event: 'storyBeat.generated',
                status: 'completed',
                source: 'server',
                attributes: {
                    arcStep: arcStepObj.id,
                    arcStepLabel: arcStepObj.label,
                    promptConfigId: resolvedPromptConfigId,
                    storyTypeId,
                },
            });

            // Fire-and-forget: persist world state from this beat for next beat's context
            if (structuredOutput.scene) {
                const newWorldState: WorldState = {
                    // Strip any $$…$$ wrappers the model may have echoed back from the prompt;
                    // worldState stores plain IDs and the prompt builder re-wraps them.
                    presentActorIds: (structuredOutput.scene.presentActors || []).map(id =>
                        id.replace(/^\$\$|\$\$$/g, '')
                    ),
                    currentLocation: structuredOutput.scene.location ?? undefined,
                };
                firestore.collection('storySessions').doc(sessionId).update({ worldState: newWorldState })
                    .catch(e => console.warn('[beat-flow] worldState update failed:', e));
            }

            // Resolve placeholders in text for display using prebuiltEntityMap (no extra Firestore reads)
            const [resolvedStoryContinuation, resolvedOptions] = await Promise.all([
                replacePlaceholdersInText(structuredOutput.storyContinuation, prebuiltEntityMap),
                Promise.all(
                    structuredOutput.options.map(async (option) => ({
                        ...option,
                        text: await replacePlaceholdersInText(option.text, prebuiltEntityMap),
                        entities: await extractEntityMetadataFromText(option.text, prebuiltEntityMap),
                    }))
                ),
            ]);

            return {
                ok: true,
                sessionId,
                promptConfigId: resolvedPromptConfigId,
                arcStep: arcStepObj.id,
                arcStepLabel: arcStepObj.label,
                storyTypeId,
                storyTypeName: storyType.name,
                storyContinuation: structuredOutput.storyContinuation, // Original with placeholders
                storyContinuationResolved: resolvedStoryContinuation, // Resolved for display
                options: structuredOutput.options, // Original with placeholders
                optionsResolved: resolvedOptions, // Resolved for display
                scene: structuredOutput.scene, // Authoritative actor list for image generation
                // Progress: arc step completion (0.0 to ~0.9, leaving room for ending)
                progress: arcSteps.length > 1 ? (safeArcStepIndex + 1) / (arcSteps.length + 1) : 0.5,
                debug: {
                    storySoFarLength: storySoFar.length,
                    messagesCount: conversationMessages.length,
                    totalMessagesCount: allConversationMessages.length,
                    contextWindowUsed: CONTEXT_WINDOW,
                    narrativeSummaryLength: narrativeSummary?.length ?? 0,
                    usedMessagesArray: debug.usedNewPromptSystem && conversationMessages.length > 0,
                    arcStepIndex: safeArcStepIndex,
                    modelName,
                    maxOutputTokens,
                    temperature: modelTemperature,
                    usedNewPromptSystem: debug.usedNewPromptSystem,
                    promptSystem: debug.details.promptSystem,
                    promptPreview: finalPrompt.substring(0, 500) + '...',
                    fullPrompt: finalPrompt,
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

    