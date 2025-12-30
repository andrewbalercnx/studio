
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
import type { StorySession, ChatMessage, StoryType, Character, ChildProfile, ArcStep } from '@/lib/types';
import { resolvePromptConfigForSession } from '@/lib/prompt-config-resolver';
import { logServerSessionEvent } from '@/lib/session-events.server';
import { summarizeChildPreferences } from '@/lib/child-preferences';
import { replacePlaceholdersWithDescriptions, resolveEntitiesInText, replacePlaceholdersInText, extractEntityMetadataFromText } from '@/lib/resolve-placeholders.server';
import { logAIFlow } from '@/lib/ai-flow-logger';
import { initializeRunTrace, logAICallToTrace } from '@/lib/ai-run-trace';
import { buildStoryContext } from '@/lib/story-context-builder';
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

            // 2. Load StoryType
            debug.stage = 'loading_storyType';
            const storyTypeDoc = await firestore.collection('storyTypes').doc(storyTypeId).get();
            if (!storyTypeDoc.exists) {
                return { ok: false, sessionId, errorMessage: `StoryType with id ${storyTypeId} not found.` };
            }
            const storyType = storyTypeDoc.data() as StoryType;

            // Load unified story context (child, siblings, characters)
            // Pass supportingCharacterIds so we can highlight newly introduced story characters
            const { data: contextData, formatted: contextFormatted } = await buildStoryContext(
                parentUid,
                session.childId,
                session.mainCharacterId,
                session.supportingCharacterIds
            );
            const childProfile = contextData.mainChild;
            const childAge = contextData.childAge;
            const childPreferenceSummary = summarizeChildPreferences(childProfile);
            debug.details.childPreferenceSummary = childPreferenceSummary.slice(0, 400);
            debug.details.childAge = childAge;
            debug.details.siblingsCount = contextData.siblings.length;
            debug.details.charactersCount = contextData.characters.length + (contextData.mainCharacter ? 1 : 0);

            // Initialize run trace for this session (if not already initialized)
            await initializeRunTrace({
                sessionId,
                parentUid,
                childId: session.childId,
                storyTypeId,
                storyTypeName: storyType.name,
            });

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

            // Count messages to track story length
            const messageCountSnapshot = await firestore
                .collection('storySessions')
                .doc(sessionId)
                .collection('messages')
                .count()
                .get();
            const messageCount = messageCountSnapshot.data().count || 0;
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
            const messagesSnapshot = await firestore
                .collection('storySessions')
                .doc(sessionId)
                .collection('messages')
                .orderBy('createdAt', 'asc')
                .get();

            // Build structured messages array for ai.generate() using Genkit MessageData format
            const conversationMessages: MessageData[] = [];
            for (const doc of messagesSnapshot.docs) {
                const data = doc.data() as ChatMessage;
                const resolvedText = await replacePlaceholdersWithDescriptions(data.text);
                conversationMessages.push({
                    role: data.sender === 'assistant' ? 'model' : 'user',
                    content: [{ text: resolvedText }],
                });
            }

            // Also build storySoFar string for legacy system (which doesn't use messages array)
            const storySoFar = conversationMessages
                .map(m => {
                    // Extract text from the content parts array
                    const textContent = m.content.map(part =>
                        typeof part === 'object' && 'text' in part ? part.text : ''
                    ).join('');
                    return `${m.role === 'model' ? 'Story Guide' : 'Child'}: ${textContent}`;
                })
                .join('\n');


            // 5. Build prompt - use new system if storyType has promptConfig, otherwise fallback to legacy
            debug.stage = 'building_prompt';
            let finalPrompt: string;
            let resolvedPromptConfigId: string | null = null;
            let modelTemperature = 0.7;
            let maxOutputTokens = 10000;

            // Fetch global prompt prefix
            const globalPrefix = await getGlobalPrefix();

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
                };

                finalPrompt = buildStoryBeatPrompt(promptContext);

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

            // Determine model name from storyType or use default
            const modelName = storyType.promptConfig?.model?.name || 'googleai/gemini-2.5-pro';

            let llmResponse;
            const startTime = Date.now();

            // Prepare user messages for trace logging
            const userMessagesForTrace = conversationMessages.map(m => ({
                role: m.role === 'model' ? 'model' as const : 'user' as const,
                content: m.content.map(part =>
                    typeof part === 'object' && 'text' in part ? part.text : ''
                ).join(''),
            }));

            try {
                if (debug.usedNewPromptSystem && conversationMessages.length > 0) {
                    // NEW SYSTEM: Use messages array for conversation history
                    // The system prompt contains role, context, and output requirements
                    // The messages array contains the actual conversation history
                    // Using output parameter for structured schema validation
                    llmResponse = await ai.generate({
                        model: modelName,
                        system: finalPrompt,
                        messages: conversationMessages,
                        output: { schema: StoryBeatOutputSchema },
                        config: {
                            temperature: modelTemperature,
                            maxOutputTokens: maxOutputTokens,
                        }
                    });
                } else {
                    // LEGACY SYSTEM: Use prompt with embedded STORY SO FAR
                    // Using output parameter for structured schema validation
                    llmResponse = await ai.generate({
                        model: modelName,
                        prompt: finalPrompt,
                        output: { schema: StoryBeatOutputSchema },
                        config: {
                            temperature: modelTemperature,
                            maxOutputTokens: maxOutputTokens,
                        }
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

                            const allText = [manualOutput.storyContinuation, ...manualOutput.options.map(o => o.text)].join(' ');
                            const entityMap = await resolveEntitiesInText(allText);
                            const resolvedStoryContinuation = await replacePlaceholdersInText(manualOutput.storyContinuation, entityMap);
                            const resolvedOptions = await Promise.all(
                                manualOutput.options.map(async (option) => ({
                                    ...option,
                                    text: await replacePlaceholdersInText(option.text, entityMap),
                                    entities: await extractEntityMetadataFromText(option.text, entityMap),
                                }))
                            );

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
                                debug: {
                                    storySoFarLength: storySoFar.length,
                                    messagesCount: conversationMessages.length,
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

            // Resolve placeholders in text for display
            // Collect all text that needs resolution to build a complete entityMap
            const allText = [
                structuredOutput.storyContinuation,
                ...structuredOutput.options.map(o => o.text)
            ].join(' ');
            const entityMap = await resolveEntitiesInText(allText);
            const resolvedStoryContinuation = await replacePlaceholdersInText(structuredOutput.storyContinuation, entityMap);
            const resolvedOptions = await Promise.all(
                structuredOutput.options.map(async (option) => ({
                    ...option,
                    text: await replacePlaceholdersInText(option.text, entityMap),
                    entities: await extractEntityMetadataFromText(option.text, entityMap),
                }))
            );

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
                debug: {
                    storySoFarLength: storySoFar.length,
                    messagesCount: conversationMessages.length,
                    usedMessagesArray: debug.usedNewPromptSystem && conversationMessages.length > 0,
                    arcStepIndex: safeArcStepIndex,
                    modelName,
                    maxOutputTokens,
                    temperature: modelTemperature,
                    usedNewPromptSystem: debug.usedNewPromptSystem,
                    promptSystem: debug.details.promptSystem,
                    promptPreview: finalPrompt.substring(0, 500) + '...',
                    fullPrompt: finalPrompt, // Include full prompt for diagnostics
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

    