
'use server';

/**
 * @fileOverview A Genkit flow to compile a story session into a single narrative text.
 */

import { ai } from '@/ai/genkit';
import { FieldValue } from 'firebase-admin/firestore';
import { getServerFirestore } from '@/lib/server-firestore';
import { z } from 'genkit';
import type { StorySession, StoryOutputType, Story } from '@/lib/types';
import { logServerSessionEvent } from '@/lib/session-events.server';
import { replacePlaceholdersWithDescriptions } from '@/lib/resolve-placeholders.server';
import { initializeRunTrace, logAICallToTrace, completeRunTrace } from '@/lib/ai-run-trace';
import { storyTextCompileFlow } from './story-text-compile-flow';
import { updateCharacterUsage } from '@/lib/character-usage';

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

type StoryCompileDebugInfo = {
    stage: 'init' | 'loading_session' | 'loading_dependencies' | 'ai_generate' | 'ai_generate_result' | 'unknown';
    details: Record<string, any>;
};


export const storyCompileFlow = ai.defineFlow(
    {
        name: 'storyCompileFlow',
        inputSchema: z.object({ sessionId: z.string(), storyOutputTypeId: z.string().optional() }),
        outputSchema: z.any(), // Using any to allow for custom error/success shapes
    },
    async ({ sessionId, storyOutputTypeId }) => {
        let debug: StoryCompileDebugInfo = { stage: 'init', details: { sessionId, storyOutputTypeId } };

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
            const { childId, storyTypeId, parentUid, mainCharacterId, storyMode, gemini4FinalStory, gemini3FinalStory } = session;

            // For gemini4/gemini3 modes, the story is already complete - skip AI compilation
            const isGeminiMode = storyMode === 'gemini4' || storyMode === 'gemini3';
            const geminiFinalStory = gemini4FinalStory || gemini3FinalStory;

            if (isGeminiMode && geminiFinalStory) {
                debug.details.mode = 'gemini_direct';
                debug.details.childId = childId;
                debug.details.parentUid = parentUid;

                // Load the output type for metadata (optional)
                let storyOutputType: StoryOutputType | null = null;
                if (storyOutputTypeId) {
                    const storyOutputTypeRef = firestore.collection('storyOutputTypes').doc(storyOutputTypeId);
                    const storyOutputTypeDoc = await storyOutputTypeRef.get();
                    if (storyOutputTypeDoc.exists) {
                        storyOutputType = storyOutputTypeDoc.data() as StoryOutputType;
                    }
                }

                // Resolve placeholders in the story text
                const resolvedStoryText = await replacePlaceholdersWithDescriptions(geminiFinalStory);
                const paragraphCount = resolvedStoryText.split(/\n\n+/).filter(p => p.trim()).length;

                // Extract actors from the original story text (before placeholder resolution)
                // Start with actors tracked during the session, then add any from final story
                const sessionActors = session.actors || [];
                const storyActorIds = extractActorIds(geminiFinalStory);
                const actorSet = new Set([childId, ...sessionActors, ...storyActorIds]);
                const actors = [childId, ...Array.from(actorSet).filter(id => id !== childId)];

                // Initialize run trace for Gemini mode
                await initializeRunTrace({
                    sessionId,
                    parentUid,
                    childId,
                    storyTypeId: storyTypeId || undefined,
                });

                // Generate synopsis for the Gemini story
                let synopsis = '';
                const synopsisStartTime = Date.now();
                const synopsisModelName = 'googleai/gemini-2.5-flash';
                const synopsisPrompt = `Write a brief 1-2 sentence summary of this children's story suitable for a parent to read. Should capture the main adventure or theme.\n\nSTORY:\n${resolvedStoryText}\n\nSYNOPSIS:`;
                try {
                    const synopsisResponse = await ai.generate({
                        model: synopsisModelName,
                        prompt: synopsisPrompt,
                        config: { temperature: 0.3, maxOutputTokens: 150 },
                    });
                    synopsis = synopsisResponse.text?.trim() || '';

                    await logAICallToTrace({
                        sessionId,
                        flowName: 'storyCompileFlow:synopsis',
                        modelName: synopsisModelName,
                        temperature: 0.3,
                        maxOutputTokens: 150,
                        systemPrompt: synopsisPrompt,
                        response: synopsisResponse,
                        startTime: synopsisStartTime,
                    });
                } catch (err: any) {
                    console.error('[storyCompileFlow] Failed to generate synopsis for Gemini story:', err);
                    synopsis = 'A magical adventure story.';
                    await logAICallToTrace({
                        sessionId,
                        flowName: 'storyCompileFlow:synopsis',
                        modelName: synopsisModelName,
                        temperature: 0.3,
                        maxOutputTokens: 150,
                        systemPrompt: synopsisPrompt,
                        error: err,
                        startTime: synopsisStartTime,
                    });
                }

                // Mark run trace as completed for Gemini mode
                await completeRunTrace(sessionId);

                // Update session
                const sessionUpdate: Record<string, any> = {
                    currentPhase: 'final',
                    status: 'completed',
                    finalStoryText: resolvedStoryText,
                    updatedAt: FieldValue.serverTimestamp(),
                };
                if (storyOutputTypeId) {
                    sessionUpdate.storyOutputTypeId = storyOutputTypeId;
                }
                await sessionRef.update(sessionUpdate);

                // Create Story document
                const storyRef = firestore.collection('stories').doc(sessionId);
                const existingStorySnap = await storyRef.get();
                const now = FieldValue.serverTimestamp();
                const createdAtValue = existingStorySnap.exists
                    ? (existingStorySnap.data()?.createdAt ?? FieldValue.serverTimestamp())
                    : now;

                const storyPayload: Story = {
                    storySessionId: sessionId,
                    childId,
                    parentUid,
                    storyText: resolvedStoryText,
                    synopsis, // Generated for Gemini mode
                    metadata: {
                        paragraphs: paragraphCount,
                        ...(storyOutputTypeId && { storyOutputTypeId }),
                        ...(storyOutputType?.name && { storyOutputTypeName: storyOutputType.name }),
                        ...(storyOutputType?.aiHints?.style && { artStyleHint: storyOutputType.aiHints.style }),
                    },
                    actors,
                    // Set initial generation statuses for background tasks
                    titleGeneration: { status: 'pending' },
                    synopsisGeneration: { status: 'ready' }, // Already generated
                    actorAvatarGeneration: { status: 'pending' },
                    createdAt: createdAtValue,
                    updatedAt: now,
                };

                await storyRef.set(storyPayload, { merge: true });

                // Update character usage statistics
                await updateCharacterUsage(actors, childId);

                await logServerSessionEvent({
                    firestore,
                    sessionId,
                    event: 'compile.completed',
                    status: 'completed',
                    source: 'server',
                    attributes: {
                        storyMode,
                        storyOutputTypeId,
                        storyId: storyRef.id,
                        storyLength: resolvedStoryText.length,
                    },
                });

                return {
                    ok: true,
                    sessionId,
                    storyText: resolvedStoryText,
                    synopsis,
                    metadata: { paragraphs: paragraphCount },
                    storyId: storyRef.id,
                    debug: process.env.NODE_ENV === 'development' ? {
                        ...debug,
                        storyLength: resolvedStoryText.length,
                        synopsisLength: synopsis.length,
                        paragraphs: paragraphCount,
                    } : undefined,
                };
            }

            // Standard wizard/chat flow requires storyTypeId
            if (!childId || !storyTypeId || !parentUid) {
                throw new Error(`Session is missing childId, storyTypeId, or parentUid.`);
            }
            debug.details.childId = childId;
            debug.details.storyTypeId = storyTypeId;
            debug.details.parentUid = parentUid;

            // 2. Load output type for metadata (optional)
            debug.stage = 'loading_dependencies';
            let storyOutputType: StoryOutputType | null = null;
            if (storyOutputTypeId) {
                const storyOutputTypeRef = firestore.collection('storyOutputTypes').doc(storyOutputTypeId);
                const storyOutputTypeDoc = await storyOutputTypeRef.get();
                if (storyOutputTypeDoc.exists) {
                    storyOutputType = storyOutputTypeDoc.data() as StoryOutputType;
                }
            }

            debug.details.storyOutputTypeName = storyOutputType?.name;

            // 3. Call the story-text-compile-flow to compile messages into story text + synopsis
            debug.stage = 'ai_generate';
            const textCompileResult = await storyTextCompileFlow({ sessionId });

            if (!textCompileResult.ok) {
                throw new Error(textCompileResult.errorMessage || 'storyTextCompileFlow failed');
            }

            const storyText = textCompileResult.storyText;
            const synopsis = textCompileResult.synopsis || 'A magical adventure story.';
            const finalActorIds = textCompileResult.actors || [childId];

            debug.stage = 'ai_generate_result';
            debug.details.storyTextLength = storyText?.length;
            debug.details.synopsisLength = synopsis?.length;
            debug.details.finalActorIds = finalActorIds;

            // Calculate paragraph count
            const paragraphCount = storyText.split(/\n\n+/).filter((p: string) => p.trim()).length;
            const metadata = { paragraphs: paragraphCount };

            // --- Phase State Correction ---
            const sessionUpdateStandard: Record<string, any> = {
                currentPhase: 'final',
                status: 'completed',
                finalStoryText: storyText,
                updatedAt: FieldValue.serverTimestamp(),
            };
            if (storyOutputTypeId) {
                sessionUpdateStandard.storyOutputTypeId = storyOutputTypeId;
            }
            await sessionRef.update(sessionUpdateStandard);
            debug.details.phaseCorrected = `Set currentPhase to 'final' and status to 'completed'`;

            // --- Story upsert ---
            const storyRef = firestore.collection('stories').doc(sessionId);
            const existingStorySnap = await storyRef.get();
            const now = FieldValue.serverTimestamp();
            const createdAtValue = existingStorySnap.exists
                ? (existingStorySnap.data()?.createdAt ?? FieldValue.serverTimestamp())
                : now;

            const storyPayload: Story = {
                storySessionId: sessionId,
                childId,
                parentUid,
                storyText,
                synopsis, // Generated alongside story text
                metadata: {
                    ...(metadata || {}),
                    ...(storyOutputTypeId && { storyOutputTypeId }),
                    ...(storyOutputType?.name && { storyOutputTypeName: storyOutputType.name }),
                    ...(storyOutputType?.aiHints?.style && { artStyleHint: storyOutputType.aiHints.style }),
                },
                actors: finalActorIds,
                // Set initial generation statuses for background tasks
                titleGeneration: { status: 'pending' },
                synopsisGeneration: { status: 'ready' }, // Already generated with compile
                actorAvatarGeneration: { status: 'pending' },
                createdAt: createdAtValue,
                updatedAt: now,
            };

            await storyRef.set(storyPayload, { merge: true });
            debug.details.storyDocId = storyRef.id;

            // Update character usage statistics
            await updateCharacterUsage(finalActorIds, childId);

            await logServerSessionEvent({
                firestore,
                sessionId,
                event: 'compile.completed',
                status: 'completed',
                source: 'server',
                attributes: {
                    storyTypeId,
                    storyOutputTypeId,
                    storyId: storyRef.id,
                    storyLength: storyText.length,
                },
            });

            return {
                ok: true,
                sessionId,
                storyText,
                synopsis,
                metadata,
                storyId: storyRef.id,
                // Always include actor info for debugging
                actors: finalActorIds,
                debug: process.env.NODE_ENV === 'development' ? {
                    ...debug,
                    storyLength: storyText.length,
                    synopsisLength: synopsis.length,
                    paragraphs: metadata?.paragraphs,
                } : undefined,
            };

        } catch (e: any) {
            debug.details.error = e.message || String(e);
            return {
                ok: false,
                sessionId,
                errorMessage: `Unexpected error in storyCompileFlow: ${e.message || String(e)}`,
                debug,
            };
        }
    }
);

    