
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
import { initializeRunTrace, completeRunTrace } from '@/lib/ai-run-trace';
import { logAIFlow } from '@/lib/ai-flow-logger';
import { storyTextCompileFlow } from './story-text-compile-flow';
import { updateCharacterUsage } from '@/lib/character-usage';

/**
 * Extract all $$id$$ and $id$ placeholders from text
 * Supports both double-dollar (correct) and single-dollar (AI fallback) formats
 */
function extractActorIds(text: string): string[] {
  const ids = new Set<string>();
  // Double $$ format (correct format)
  const doubleRegex = /\$\$([a-zA-Z0-9_-]+)\$\$/g;
  let match;
  while ((match = doubleRegex.exec(text)) !== null) {
    ids.add(match[1]);
  }
  // Single $ format (fallback for AI that didn't follow instructions)
  // Only match IDs that look like Firestore document IDs (15+ alphanumeric chars)
  const singleRegex = /\$([a-zA-Z0-9_-]{15,})\$/g;
  while ((match = singleRegex.exec(text)) !== null) {
    ids.add(match[1]);
  }
  return Array.from(ids);
}

/**
 * Generate a synopsis for a story using AI.
 * Includes validation to ensure the response is complete and well-formed.
 */
async function generateSynopsis(
  storyText: string,
  sessionId: string,
  parentUid: string,
  flowSuffix: string
): Promise<string> {
  const synopsisModelName = 'googleai/gemini-2.5-flash';
  const synopsisStartTime = Date.now();

  // Improved prompt with explicit completion requirements and action trigger
  const synopsisPrompt = `You are writing a brief summary for parents to see on their child's story card.

STORY TO SUMMARIZE:
${storyText}

INSTRUCTIONS:
Write exactly 1-2 complete sentences summarizing this children's story for parents.

Requirements:
- Capture the main adventure or heartwarming moment
- Be engaging and help parents quickly understand the story
- Be suitable for display on a story card

Output format:
- Return ONLY the summary text with no labels, prefixes, or formatting
- Your response must be grammatically complete sentences
- End with proper punctuation (period)

Example of correct output:
A young explorer and their animal friend discover a hidden treasure while learning the importance of teamwork and courage.

Now write the summary:`;

  try {
    const synopsisResponse = await ai.generate({
      model: synopsisModelName,
      prompt: synopsisPrompt,
      config: {
        temperature: 0.3,
        maxOutputTokens: 200, // Increased from 150 to ensure complete responses
        stopSequences: [], // Don't stop early
      },
    });

    let synopsis = synopsisResponse.text?.trim() || '';

    // Validate the response - ensure it's not truncated
    if (synopsis && !synopsis.match(/[.!?]$/)) {
      // Response doesn't end with sentence-ending punctuation - likely truncated
      console.warn(`[storyCompileFlow:synopsis] Response appears truncated: "${synopsis}"`);
      // Try to salvage by adding a period if it looks like a near-complete sentence
      if (synopsis.length > 20) {
        synopsis = synopsis + '.';
      } else {
        // Too short to be useful, use fallback
        synopsis = 'A delightful adventure story for young readers.';
      }
    }

    // Validate minimum length
    if (!synopsis || synopsis.length < 10) {
      console.warn(`[storyCompileFlow:synopsis] Response too short: "${synopsis}"`);
      synopsis = 'A delightful adventure story for young readers.';
    }

    await logAIFlow({
      flowName: `storyCompileFlow:synopsis:${flowSuffix}`,
      sessionId,
      parentId: parentUid,
      prompt: synopsisPrompt,
      response: synopsisResponse,
      startTime: synopsisStartTime,
      modelName: synopsisModelName
    });

    return synopsis;
  } catch (err: any) {
    console.error(`[storyCompileFlow:synopsis:${flowSuffix}] Failed to generate synopsis:`, err);
    await logAIFlow({
      flowName: `storyCompileFlow:synopsis:${flowSuffix}`,
      sessionId,
      parentId: parentUid,
      prompt: synopsisPrompt,
      error: err,
      startTime: synopsisStartTime,
      modelName: synopsisModelName
    });
    return 'A delightful adventure story for young readers.';
  }
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

            // For gemini4/gemini3/wizard/friends modes, the story is already complete - skip AI compilation
            const isGeminiMode = storyMode === 'gemini4' || storyMode === 'gemini3';
            const isWizardMode = storyMode === 'wizard';
            const isFriendsMode = storyMode === 'friends';
            const geminiFinalStory = gemini4FinalStory || gemini3FinalStory;

            // Handle friends mode - story was already created by the friends flow
            // This is similar to wizard mode - we just need to run background tasks
            if (isFriendsMode) {
                debug.details.mode = 'friends';
                debug.details.childId = childId;
                debug.details.parentUid = parentUid;

                // Load the existing story document created by friends flow
                const storyRef = firestore.collection('stories').doc(sessionId);
                const existingStorySnap = await storyRef.get();

                if (!existingStorySnap.exists) {
                    throw new Error('Friends story document not found');
                }

                const existingStory = existingStorySnap.data() as Story;
                const storyText = existingStory.storyText || '';

                // Load the output type for metadata (optional)
                let storyOutputType: StoryOutputType | null = null;
                if (storyOutputTypeId) {
                    const storyOutputTypeRef = firestore.collection('storyOutputTypes').doc(storyOutputTypeId);
                    const storyOutputTypeDoc = await storyOutputTypeRef.get();
                    if (storyOutputTypeDoc.exists) {
                        storyOutputType = storyOutputTypeDoc.data() as StoryOutputType;
                    }
                }

                // Extract actors - friends flow stores actors in session and story
                const sessionActors = session.actors || [];
                const actorSet = new Set([childId, ...sessionActors]);
                const actors = [childId, ...Array.from(actorSet).filter(id => id !== childId)];

                // Resolve placeholders for display (friends flow stores unresolved text)
                const resolvedStoryText = await replacePlaceholdersWithDescriptions(storyText);
                const paragraphCount = resolvedStoryText.split(/\n\n+/).filter(p => p.trim()).length;

                // Initialize run trace
                await initializeRunTrace({
                    sessionId,
                    parentUid,
                    childId,
                    storyTypeId: storyTypeId || undefined,
                });

                // Generate synopsis for the friends story if not already present
                let synopsis = existingStory.synopsis || '';
                if (!synopsis) {
                    synopsis = await generateSynopsis(resolvedStoryText, sessionId, parentUid, 'friends');
                }

                // Mark run trace as completed
                await completeRunTrace(sessionId);

                // Update session
                const sessionUpdate: Record<string, any> = {
                    currentPhase: 'final',
                    status: 'completed',
                    updatedAt: FieldValue.serverTimestamp(),
                };
                if (storyOutputTypeId) {
                    sessionUpdate.storyOutputTypeId = storyOutputTypeId;
                }
                await sessionRef.update(sessionUpdate);

                // Update Story document with actors, synopsis, and generation statuses
                // NOTE: We intentionally do NOT update storyText here. The friends-flow saved
                // the unresolved text (with $$id$$ placeholders) which is needed for page
                // generation to extract entityIds. Overwriting with resolved text would break
                // downstream processes like pagination and image generation.
                const now = FieldValue.serverTimestamp();
                const storyPayload: Partial<Story> = {
                    synopsis,
                    actors,
                    storyMode: 'friends',
                    metadata: {
                        ...existingStory.metadata,
                        paragraphs: paragraphCount,
                        ...(storyOutputTypeId && { storyOutputTypeId }),
                        ...(storyOutputType?.name && { storyOutputTypeName: storyOutputType.name }),
                        ...(storyOutputType?.aiHints?.style && { artStyleHint: storyOutputType.aiHints.style }),
                    },
                    // Set initial generation statuses for background tasks
                    titleGeneration: { status: 'pending' },
                    synopsisGeneration: { status: 'ready' },
                    actorAvatarGeneration: { status: 'pending' },
                    updatedAt: now,
                };

                await storyRef.update(storyPayload);

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
                    rawStoryText: storyText, // Unresolved text with $$id$$ placeholders
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

            // Handle wizard mode - story was already created by the wizard flow
            if (isWizardMode) {
                debug.details.mode = 'wizard';
                debug.details.childId = childId;
                debug.details.parentUid = parentUid;

                // Load the existing story document created by wizard flow
                const storyRef = firestore.collection('stories').doc(sessionId);
                const existingStorySnap = await storyRef.get();

                if (!existingStorySnap.exists) {
                    throw new Error('Wizard story document not found');
                }

                const existingStory = existingStorySnap.data() as Story;
                // The wizard flow now stores unresolved text with $$id$$ placeholders
                const rawStoryText = existingStory.storyText || '';

                // Resolve placeholders for display
                const resolvedStoryText = await replacePlaceholdersWithDescriptions(rawStoryText);

                // Load the output type for metadata (optional)
                let storyOutputType: StoryOutputType | null = null;
                if (storyOutputTypeId) {
                    const storyOutputTypeRef = firestore.collection('storyOutputTypes').doc(storyOutputTypeId);
                    const storyOutputTypeDoc = await storyOutputTypeRef.get();
                    if (storyOutputTypeDoc.exists) {
                        storyOutputType = storyOutputTypeDoc.data() as StoryOutputType;
                    }
                }

                // Extract actors from the raw story text (contains $$id$$ placeholders)
                const textActorIds = extractActorIds(rawStoryText);
                const sessionActors = session.actors || [];
                const actorSet = new Set([childId, ...sessionActors, ...textActorIds]);
                const actors = [childId, ...Array.from(actorSet).filter(id => id !== childId)];

                const paragraphCount = resolvedStoryText.split(/\n\n+/).filter(p => p.trim()).length;

                // Initialize run trace
                await initializeRunTrace({
                    sessionId,
                    parentUid,
                    childId,
                    storyTypeId: storyTypeId || undefined,
                });

                // Generate synopsis for the wizard story (use resolved text for AI to understand context)
                let synopsis = existingStory.synopsis || '';
                if (!synopsis) {
                    synopsis = await generateSynopsis(resolvedStoryText, sessionId, parentUid, 'wizard');
                }

                // Mark run trace as completed
                await completeRunTrace(sessionId);

                // Update session
                const sessionUpdate: Record<string, any> = {
                    currentPhase: 'final',
                    status: 'completed',
                    updatedAt: FieldValue.serverTimestamp(),
                };
                if (storyOutputTypeId) {
                    sessionUpdate.storyOutputTypeId = storyOutputTypeId;
                }
                await sessionRef.update(sessionUpdate);

                // Update Story document with actors, synopsis, and generation statuses
                const now = FieldValue.serverTimestamp();
                const storyPayload: Partial<Story> = {
                    synopsis,
                    actors,
                    storyMode: storyMode || 'wizard', // Copy from session
                    metadata: {
                        ...existingStory.metadata,
                        paragraphs: paragraphCount,
                        ...(storyOutputTypeId && { storyOutputTypeId }),
                        ...(storyOutputType?.name && { storyOutputTypeName: storyOutputType.name }),
                        ...(storyOutputType?.aiHints?.style && { artStyleHint: storyOutputType.aiHints.style }),
                    },
                    // Set initial generation statuses for background tasks
                    titleGeneration: { status: 'pending' },
                    synopsisGeneration: { status: 'ready' },
                    actorAvatarGeneration: { status: 'pending' },
                    updatedAt: now,
                };

                await storyRef.update(storyPayload);

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
                    rawStoryText, // Unresolved text with $$id$$ placeholders
                    synopsis,
                    metadata: { paragraphs: paragraphCount },
                    storyId: storyRef.id,
                    debug: process.env.NODE_ENV === 'development' ? {
                        ...debug,
                        storyLength: resolvedStoryText.length,
                        rawStoryLength: rawStoryText.length,
                        synopsisLength: synopsis.length,
                        paragraphs: paragraphCount,
                    } : undefined,
                };
            }

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
                const synopsis = await generateSynopsis(resolvedStoryText, sessionId, parentUid, 'gemini');

                // Mark run trace as completed for Gemini mode
                await completeRunTrace(sessionId);

                // Update session
                const sessionUpdate: Record<string, any> = {
                    currentPhase: 'final',
                    status: 'completed',
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
                    // Store unresolved text (with $$id$$ placeholders) for downstream processes
                    // like pagination and image generation which need to extract entity IDs
                    storyText: geminiFinalStory,
                    storyMode, // Copy from session (gemini3 or gemini4)
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
                    rawStoryText: geminiFinalStory, // Text with $$id$$ placeholders
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

            const rawStoryText = textCompileResult.storyText; // Text with $$id$$ placeholders
            const resolvedStoryText = await replacePlaceholdersWithDescriptions(rawStoryText);
            const synopsis = textCompileResult.synopsis || 'A magical adventure story.';
            const finalActorIds = textCompileResult.actors || [childId];

            debug.stage = 'ai_generate_result';
            debug.details.storyTextLength = resolvedStoryText?.length;
            debug.details.synopsisLength = synopsis?.length;
            debug.details.finalActorIds = finalActorIds;

            // Calculate paragraph count
            const paragraphCount = resolvedStoryText.split(/\n\n+/).filter((p: string) => p.trim()).length;
            const metadata = { paragraphs: paragraphCount };

            // --- Phase State Correction ---
            const sessionUpdateStandard: Record<string, any> = {
                currentPhase: 'final',
                status: 'completed',
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
                // Store unresolved text (with $$id$$ placeholders) for downstream processes
                // like pagination and image generation which need to extract entity IDs
                storyText: rawStoryText,
                storyMode: storyMode || 'chat', // Copy from session (default to chat for standard flow)
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
                    storyLength: resolvedStoryText.length,
                },
            });

            return {
                ok: true,
                sessionId,
                storyText: resolvedStoryText,
                rawStoryText, // Text with $$id$$ placeholders
                synopsis,
                metadata,
                storyId: storyRef.id,
                // Always include actor info for debugging
                actors: finalActorIds,
                debug: process.env.NODE_ENV === 'development' ? {
                    ...debug,
                    storyLength: resolvedStoryText.length,
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

    