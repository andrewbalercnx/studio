
'use server';

/**
 * @fileOverview A Genkit flow to generate three possible story endings.
 *
 * This flow uses the new structured prompt system:
 * - Schema: @/lib/schemas/ending-output
 * - Prompt Builder: @/lib/prompt-builders/ending-prompt-builder
 *
 * For story types with promptConfig, uses the new system.
 * For legacy story types, falls back to hardcoded prompt.
 */

import { ai } from '@/ai/genkit';
import { FieldValue } from 'firebase-admin/firestore';
import { getServerFirestore } from '@/lib/server-firestore';
import { z } from 'genkit';
import type { MessageData } from 'genkit';
import type { StorySession, ChatMessage, StoryType, ArcStep } from '@/lib/types';
import { summarizeChildPreferences } from '@/lib/child-preferences';
import { logServerSessionEvent } from '@/lib/session-events.server';
import { logAIFlow } from '@/lib/ai-flow-logger';
import { resolveEntitiesInText, replacePlaceholdersInText } from '@/lib/resolve-placeholders.server';
import { buildStoryContext } from '@/lib/story-context-builder';
import { buildStorySystemMessage } from '@/lib/build-story-system-message';
import { getGlobalPrefix } from '@/lib/global-prompt-config.server';
// New structured prompt system
import { EndingOutputSchema } from '@/lib/schemas/ending-output';
import { buildEndingPrompt, type EndingPromptContext } from '@/lib/prompt-builders/ending-prompt-builder';

/**
 * Normalizes arc steps to handle both legacy string format and new ArcStep object format.
 */
function normalizeArcSteps(steps: (string | ArcStep)[]): ArcStep[] {
  return steps.map(step =>
    typeof step === 'string'
      ? { id: step, label: step.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()) }
      : step
  );
}

type EndingFlowDebugInfo = {
    stage: 'loading_session' | 'loading_storyType' | 'loading_messages_and_characters' | 'building_prompt' | 'ai_generate' | 'ai_generate_result' | 'json_parse' | 'json_validate' | 'unknown';
    details: Record<string, any>;
    usedNewPromptSystem?: boolean;
};


export const endingFlow = ai.defineFlow(
    {
        name: 'endingFlow',
        inputSchema: z.object({ sessionId: z.string() }),
        outputSchema: z.any(), // Using any to allow for custom error/success shapes
    },
    async ({ sessionId }) => {
        let debug: EndingFlowDebugInfo = { stage: 'unknown', details: {} };

        try {
            const firestore = await getServerFirestore();

            // 1. Load session
            debug.stage = 'loading_session';
            const sessionRef = firestore.collection('storySessions').doc(sessionId);
            const sessionDoc = await sessionRef.get();
            if (!sessionDoc.exists) {
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
                await sessionRef.update({
                    currentPhase: 'ending',
                    storyPhaseId: 'ending_phase_v1'
                });
                debug.details.phaseCorrected = `Set currentPhase to 'ending'`;
            }


            // 2. Load StoryType
            debug.stage = 'loading_storyType';
            const storyTypeDoc = await firestore.collection('storyTypes').doc(storyTypeId).get();
            if (!storyTypeDoc.exists) {
                return { ok: false, sessionId, errorMessage: `StoryType with id ${storyTypeId} not found.` };
            }
            const storyType = storyTypeDoc.data() as StoryType;

            // Load unified story context (child, siblings, characters)
            const { data: contextData, formatted: contextFormatted } = await buildStoryContext(
                session.parentUid || '',
                session.childId,
                session.mainCharacterId
            );
            const childProfile = contextData.mainChild;
            const childAge = contextData.childAge;
            const childPreferenceSummary = summarizeChildPreferences(childProfile);
            debug.details.childPreferenceSummary = childPreferenceSummary.slice(0, 400);
            debug.details.childAge = childAge;
            debug.details.siblingsCount = contextData.siblings.length;
            debug.details.charactersCount = contextData.characters.length + (contextData.mainCharacter ? 1 : 0);

            const rawArcSteps = storyType.arcTemplate?.steps ?? [];
            const arcSteps = normalizeArcSteps(rawArcSteps);
            const maxIndex = arcSteps.length > 0 ? arcSteps.length - 1 : 0;
            const isAtFinalStep = arcStepIndex >= maxIndex;
            const currentArcStepObj = arcSteps[Math.min(arcStepIndex, maxIndex)] || null;
            debug.details.isAtFinalStep = isAtFinalStep;
            debug.details.lastStepId = arcSteps[maxIndex]?.id;
            debug.details.currentArcStepId = currentArcStepObj?.id;

            // 3. Load Messages and build messages array
            debug.stage = 'loading_messages_and_characters';
            const messagesSnapshot = await firestore
                .collection('storySessions')
                .doc(sessionId)
                .collection('messages')
                .orderBy('createdAt', 'asc')
                .get();

            // Build structured messages array for ai.generate()
            const conversationMessages: MessageData[] = messagesSnapshot.docs.map(d => {
                const msg = d.data() as ChatMessage;
                return {
                    role: msg.sender === 'assistant' ? 'model' : 'user',
                    content: [{ text: msg.text }],
                } as MessageData;
            });
            debug.details.messagesCount = conversationMessages.length;

            // 4. Build System Prompt
            debug.stage = 'building_prompt';
            const globalPrefix = await getGlobalPrefix();
            let systemPrompt: string;
            let modelTemperature = 0.4;
            let maxOutputTokens = 2000;

            if (storyType.promptConfig) {
                // NEW SYSTEM: Use structured prompt builder
                debug.usedNewPromptSystem = true;

                const promptContext: EndingPromptContext = {
                    storyType,
                    formattedContext: contextFormatted,
                    childAge,
                    childPreferenceSummary,
                    levelBand: session.promptConfigLevelBand,
                    useMessagesArray: true, // Story history will be passed via messages parameter
                    useSchemaOutput: true,  // Schema is passed to model separately
                    globalPrefix,
                };

                systemPrompt = buildEndingPrompt(promptContext);

                // Use model settings from storyType.promptConfig
                modelTemperature = storyType.promptConfig.model?.temperature ?? 0.4;
                maxOutputTokens = storyType.promptConfig.model?.maxOutputTokens ?? 2000;

                debug.details.promptSystem = 'new';
            } else {
                // LEGACY SYSTEM: Fallback to hardcoded prompt
                debug.usedNewPromptSystem = false;
                const systemMessage = buildStorySystemMessage(contextFormatted, childAge, 'ending', globalPrefix);

                systemPrompt = `${systemMessage}

=== CURRENT SESSION ===
Story Type: ${storyType.name}

Child's inspirations: ${childPreferenceSummary}

=== YOUR TASK ===
Based on the story conversation above, generate three possible endings for the story.

=== OUTPUT FORMAT ===
Return a single valid JSON object (no markdown, no explanation):
{
  "endings": [
    { "id": "A", "text": "ending one in 2-3 short sentences" },
    { "id": "B", "text": "ending two in 2-3 short sentences" },
    { "id": "C", "text": "ending three in 2-3 short sentences" }
  ]
}`;
                debug.details.promptSystem = 'legacy';
            }

            debug.details.promptLength = systemPrompt.length;
            debug.details.promptPreview = systemPrompt.slice(0, 500) + '...';

            // 5. Call Genkit AI with messages array
            debug.stage = 'ai_generate';
            const modelConfig = {
                temperature: modelTemperature,
                maxOutputTokens: maxOutputTokens,
            };
            debug.details.modelConfig = modelConfig;
            debug.details.usedMessagesArray = conversationMessages.length > 0;

            // Determine model name from storyType or use default
            const modelName = storyType.promptConfig?.model?.name || 'googleai/gemini-2.5-pro';

            let llmResponse;
            const startTime = Date.now();
            try {
                // Use system prompt + messages array for better conversation context
                // Using output parameter for structured schema validation
                llmResponse = await ai.generate({
                    model: modelName,
                    system: systemPrompt,
                    messages: conversationMessages,
                    output: { schema: EndingOutputSchema },
                    config: modelConfig,
                });
                await logAIFlow({ flowName: 'endingFlow', sessionId, parentId: session.parentUid, prompt: systemPrompt, response: llmResponse, startTime, modelName });
            } catch (e: any) {
                await logAIFlow({ flowName: 'endingFlow', sessionId, parentId: session.parentUid, prompt: systemPrompt, error: e, startTime, modelName });
                throw e;
            }

            debug.stage = 'ai_generate_result';
            debug.details.finishReason = (llmResponse as any).finishReason ?? (llmResponse as any).raw?.candidates?.[0]?.finishReason;
            debug.details.topLevelFinishReason = (llmResponse as any).finishReason ?? null;
            debug.details.firstCandidateFinishReason = (llmResponse as any).raw?.candidates?.[0]?.finishReason ?? null;

            // 6. Extract structured output using Genkit's output parameter
            let validationResult = llmResponse.output;

            if (!validationResult) {
                // Fallback: try manual parsing if output is null
                const rawText = llmResponse.text;
                debug.details.rawTextPreview = rawText ? rawText.slice(0, 200) : null;

                if (!rawText || rawText.trim() === '') {
                    if (debug.details.firstCandidateFinishReason === 'MAX_TOKENS' || debug.details.topLevelFinishReason === 'length') {
                        throw new Error("Model hit MAX_TOKENS during ending generation; increase maxOutputTokens.");
                    }
                    throw new Error("Model returned empty text for ending generation.");
                }

                debug.stage = 'json_parse';
                try {
                    const jsonMatch = rawText.match(/```json\n([\s\S]*?)\n```/);
                    const jsonToParse = jsonMatch ? jsonMatch[1].trim() : rawText.trim();
                    const parsed = JSON.parse(jsonToParse);
                    const manualValidation = EndingOutputSchema.safeParse(parsed);
                    if (manualValidation.success) {
                        validationResult = manualValidation.data;
                        debug.details.usedFallbackParsing = true;
                    } else {
                        debug.details.validationErrors = manualValidation.error.issues;
                        throw new Error(`Model JSON does not match expected ending shape. Errors: ${manualValidation.error.message}`);
                    }
                } catch (err: any) {
                    debug.details.parseError = err.message;
                    throw new Error("Model output is not valid JSON for endings.");
                }
            }

            await sessionRef.update({
                'progress.endingGeneratedAt': FieldValue.serverTimestamp(),
            });

            await logServerSessionEvent({
                firestore,
                sessionId,
                event: 'ending.generated',
                status: 'completed',
                source: 'server',
                attributes: {
                    storyTypeId: storyType.id,
                    arcStep: currentArcStepObj?.id || null,
                    arcStepLabel: currentArcStepObj?.label || null,
                },
            });

            // Replace placeholders in ending texts
            const allEndingTexts = validationResult.endings.map(e => e.text).join(' ');
            const entityMap = await resolveEntitiesInText(allEndingTexts);
            const endingsWithResolvedNames = await Promise.all(
                validationResult.endings.map(async (ending) => ({
                    id: ending.id,
                    text: await replacePlaceholdersInText(ending.text, entityMap),
                }))
            );

            return {
                ok: true,
                sessionId,
                storyTypeId: storyType.id,
                arcStep: currentArcStepObj?.id || null,
                arcStepLabel: currentArcStepObj?.label || null,
                endings: endingsWithResolvedNames,
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

    