'use server';

/**
 * @fileOverview AI-driven pagination flow that transforms story text into paginated output.
 * This flow uses the storyOutputType's paginationPrompt (or a default) to:
 * 1. Apply storyOutputType styling to the story text
 * 2. Generate paginated output with actor tracking per page
 *
 * This replaces the old chunkSentences algorithm with AI-driven pagination.
 */

import { ai } from '@/ai/genkit';
import { getServerFirestore } from '@/lib/server-firestore';
import { z } from 'genkit';
import type { Story, StoryOutputType, ChildProfile, PrintLayout, PrintProduct, ImageScene } from '@/lib/types';
import { DEFAULT_PAGINATION_PROMPT } from '@/lib/types';
import { logAIFlow } from '@/lib/ai-flow-logger';
import { toUserSafeMessage } from '@/lib/ai-error-map';
import { logAICallToTrace } from '@/lib/ai-run-trace';
import { getPaginationPrompt } from '@/lib/pagination-prompt-config.server';
import {
    type ActorInfo,
    buildActorListForPrompt,
    getActorsDetails,
} from '@/lib/story-context-builder';
import {
    resolvePageConstraints,
    buildPageCountInstruction,
    type ResolvedPageConstraints,
} from '@/lib/print-constraints';
import { replacePlaceholdersWithDescriptions, stripTTSDirectiveTags } from '@/lib/resolve-placeholders.server';
import { extractEntityIds } from '@/lib/entity-utils';

// Schema for the AI's paginated output
// Note: We use permissive string validation here to avoid schema errors.
// Empty strings are filtered out during post-processing.
const ImageSceneActorSchema = z.object({
  id: z.string(),
  action: z.string(),
  facing: z.string().optional(),
});

// atmosphere is optional at the schema layer: Genkit rejects the WHOLE response
// if any one page omits a required field, and gemini-2.5-flash occasionally
// drops atmosphere on a page. A missing atmosphere is recoverable (defaulted
// from sceneTag below); losing all pagination to the sentence-chunking
// fallback is not.
const ImageSceneSchema = z.object({
  locationKey: z.string(),
  locationDescription: z.string(),
  actors: z.array(ImageSceneActorSchema),
  atmosphere: z.string().optional(),
  sceneTag: z.enum(['indoor-day', 'outdoor-day', 'indoor-night', 'outdoor-night']),
});

const DEFAULT_ATMOSPHERE: Record<string, string> = {
  'indoor-day': 'warm, bright daylight, cheerful indoor scene',
  'outdoor-day': 'bright, sunny, open-air and cheerful',
  'indoor-night': 'soft, cozy lamplight, calm night-time mood',
  'outdoor-night': 'gentle moonlight, calm and magical night air',
};

const PaginationAIOutputSchema = z.object({
  pages: z.array(z.object({
    pageNumber: z.number().int().positive(),
    text: z.string(),
    actors: z.array(z.string()),
    imageScene: ImageSceneSchema.optional(),
  })),
});

type PaginationDebugInfo = {
    stage: 'init' | 'loading' | 'building_prompt' | 'ai_generate' | 'processing' | 'done' | 'error';
    details: Record<string, any>;
};

export const storyPaginationFlow = ai.defineFlow(
    {
        name: 'storyPaginationFlow',
        inputSchema: z.object({
            storyId: z.string(),
            storyOutputTypeId: z.string(),
        }),
        outputSchema: z.any(),
    },
    async ({ storyId, storyOutputTypeId }) => {
        let debug: PaginationDebugInfo = { stage: 'init', details: { storyId, storyOutputTypeId } };

        try {
            debug.details.step = 'getFirestore';
            const firestore = await getServerFirestore();
            debug.stage = 'loading';

            // Load story
            debug.details.step = 'loadStory';
            const storyRef = firestore.collection('stories').doc(storyId);
            const storySnap = await storyRef.get();
            if (!storySnap.exists) {
                throw new Error(`Story ${storyId} not found.`);
            }
            const story = storySnap.data() as Story;
            debug.details.step = 'storyLoaded';

            if (!story.storyText || story.storyText.trim().length === 0) {
                throw new Error(`Story ${storyId} has no storyText.`);
            }

            // Load storyOutputType
            debug.details.step = 'loadOutputType';
            const outputTypeRef = firestore.collection('storyOutputTypes').doc(storyOutputTypeId);
            const outputTypeSnap = await outputTypeRef.get();
            if (!outputTypeSnap.exists) {
                throw new Error(`StoryOutputType ${storyOutputTypeId} not found.`);
            }
            const storyOutputType = outputTypeSnap.data() as StoryOutputType;
            debug.details.step = 'outputTypeLoaded';

            // Load child profile for context
            debug.details.step = 'loadChildProfile';
            let childProfile: ChildProfile | null = null;
            if (story.childId) {
                const childSnap = await firestore.collection('children').doc(story.childId).get();
                if (childSnap.exists) {
                    childProfile = { id: childSnap.id, ...childSnap.data() } as ChildProfile;
                }
            }
            debug.details.step = 'childProfileLoaded';

            // Get target page count from output type (0 = flexible)
            const targetPageCount = storyOutputType.layoutHints?.pageCount || 0;

            // Load print layout and product for page constraints
            debug.details.step = 'loadPrintConstraints';
            let printLayout: PrintLayout | null = null;
            let printProduct: PrintProduct | null = null;
            let resolvedConstraints: ResolvedPageConstraints = {
                minPages: 0,
                maxPages: 0,
                pageMultiple: 4,
                source: 'default',
            };

            if (storyOutputType.defaultPrintLayoutId) {
                try {
                    const layoutSnap = await firestore.collection('printLayouts').doc(storyOutputType.defaultPrintLayoutId).get();
                    if (layoutSnap.exists) {
                        printLayout = { id: layoutSnap.id, ...layoutSnap.data() } as PrintLayout;

                        // Load linked product if specified
                        if (printLayout.printProductId) {
                            const productSnap = await firestore.collection('printProducts').doc(printLayout.printProductId).get();
                            if (productSnap.exists) {
                                printProduct = { id: productSnap.id, ...productSnap.data() } as PrintProduct;
                            }
                        }

                        // Resolve constraints from the chain
                        resolvedConstraints = resolvePageConstraints(printLayout, printProduct);
                    }
                } catch (constraintError: any) {
                    debug.details.constraintLoadError = constraintError.message || String(constraintError);
                    // Continue with default constraints
                }
            }

            debug.details.resolvedConstraints = resolvedConstraints;
            debug.details.step = 'constraintsResolved';

            // Load actor details for context
            // Use story.actors if available, otherwise extract from story text (fallback for wizard/legacy stories)
            debug.details.step = 'loadActorDetails';
            let actorIds = story.actors || [];
            if (actorIds.length === 0) {
                // Fallback: extract actor IDs from story text placeholders ($$id$$ format)
                actorIds = extractEntityIds(story.storyText);
                debug.details.actorIdsSource = 'extracted_from_text';
            } else {
                debug.details.actorIdsSource = 'story.actors';
            }
            // Always ensure childId is included as first actor
            if (story.childId && !actorIds.includes(story.childId)) {
                actorIds = [story.childId, ...actorIds];
            }
            debug.details.actorIdsRaw = actorIds;

            // Filter out any empty or invalid actor IDs
            const validActorIds = actorIds.filter((id: string) => id && typeof id === 'string' && id.trim().length > 0);
            debug.details.validActorIds = validActorIds;

            let loadedActors: ActorInfo[] = [];
            let characterRoster = 'No actors found.';

            if (validActorIds.length > 0) {
                try {
                    const actorDetailsJson = await getActorsDetails(firestore, validActorIds, story.childId);
                    loadedActors = JSON.parse(actorDetailsJson) as ActorInfo[];
                    characterRoster = buildActorListForPrompt(loadedActors);
                } catch (actorError: any) {
                    debug.details.actorLoadError = actorError.message || String(actorError);
                    // Continue without actors rather than failing completely
                    loadedActors = [];
                    characterRoster = 'Error loading actor details.';
                }
            }
            debug.details.step = 'actorDetailsLoaded';

            // Build ID to name mapping
            const actorIdMapping = loadedActors.map(actor =>
                `$$${actor.id}$$ = ${actor.displayName}`
            ).join('\n');

            debug.details.storyLength = story.storyText.length;
            debug.details.targetPageCount = targetPageCount;
            debug.details.actorCount = actorIds.length;
            debug.details.outputTypeName = storyOutputType.name;

            // Build the pagination prompt
            debug.stage = 'building_prompt';

            // NOTE: We intentionally skip the global prefix for pagination.
            // The global prefix contains story generation guidance (character introduction, etc.)
            // which is not relevant for pagination - we're just splitting existing text into pages.
            //
            // Prompt structure:
            // 1. Output type's paginationPrompt (if set) - prepended as type-specific guidance
            // 2. Global pagination prompt (from system config or default) - always included
            const systemPaginationPrompt = await getPaginationPrompt();
            const basePaginationPrompt = systemPaginationPrompt || DEFAULT_PAGINATION_PROMPT;

            // If output type has a custom pagination prompt, prepend it to the base prompt
            const paginationInstructions = storyOutputType.paginationPrompt
                ? `**OUTPUT TYPE SPECIFIC INSTRUCTIONS:**\n${storyOutputType.paginationPrompt}\n\n**GENERAL PAGINATION INSTRUCTIONS:**\n${basePaginationPrompt}`
                : basePaginationPrompt;

            // Build page count instruction using resolved constraints
            const pageCountInstruction = buildPageCountInstruction(targetPageCount, resolvedConstraints);

            const styleInstruction = storyOutputType.aiHints?.style
                ? `STYLE: ${storyOutputType.aiHints.style}`
                : '';

            const rhymeInstruction = storyOutputType.aiHints?.allowRhyme
                ? `IMPORTANT: This story has rhyming verse. Maintain the rhyme scheme across page breaks. Never split a rhyming couplet across two pages — if two lines rhyme, keep them together on the same page.`
                : '';

            const systemPrompt = `${paginationInstructions}

${styleInstruction}
${rhymeInstruction}

${pageCountInstruction}

**CHARACTER REFERENCE (IDs for image generation — use these in imageScene):**
${actorIdMapping}

**CHARACTER DETAILS (for context):**
${characterRoster}

**STORY TEXT TO PAGINATE:**
${story.storyText}

**OUTPUT FORMAT (Crucial):**
Return a JSON object with this exact structure:
{
  "pages": [
    {
      "pageNumber": 1,
      "text": "The exact story text for this page (copy verbatim — do not rewrite)",
      "actors": ["actor-id-1", "actor-id-2"],
      "imageScene": {
        "locationKey": "kitchen",
        "locationDescription": "a cozy farmhouse kitchen with a round wooden table, yellow walls, and morning sunlight streaming through a checked curtain",
        "actors": [
          { "id": "actor-id-1", "action": "standing at the table, reaching for a cookie jar, eyes wide with excitement" },
          { "id": "actor-id-2", "action": "sitting on the kitchen floor, looking up with a big grin, tail wagging" }
        ],
        "atmosphere": "warm, bright morning light, cheerful and playful",
        "sceneTag": "indoor-day"
      }
    },
    ...
  ]
}

IMPORTANT:
- pageNumber starts at 1 and increments sequentially
- text is copied verbatim from the story — do NOT rewrite, summarise, or add content
- each page should have at least 2 sentences; avoid pages with fewer than 10 words
- actors is an array of actor IDs (without the $$ markers) for ALL characters physically present on this page — include everyone who is visible in the scene, whether they are the active subject, watching, observing, reacting, or otherwise present. Only exclude a character if they are genuinely absent (e.g., not yet introduced, or they left the location)
- imageScene describes the illustration for this page in structured form:
  * locationKey: a short, consistent label for the setting (e.g., "kitchen", "garden", "bedroom"). Use the EXACT same key for the same location across pages — this enforces visual consistency
  * locationDescription: a detailed visual description of the environment. For the FIRST use of a locationKey, describe it fully. For SUBSEQUENT pages at the SAME locationKey, set locationDescription to an empty string ("") — the system stores the first description in a registry and fills it in automatically
  * actors: list EVERY character from the actors array above — no more, no fewer. Each entry must have the actor's ID (without $$) and a vivid, specific action. For observers and bystanders, describe exactly how they are watching or reacting (e.g., "eyes wide, mouth open in amazement, leaning forward to look" is correct; vague entries like "standing nearby" are not)
  * atmosphere: mood, lighting, time of day, and emotional tone of the scene
  * sceneTag: classify the scene as exactly one of: indoor-day (interior in daylight/morning), outdoor-day (outside in daylight), indoor-night (interior at night/bedtime with lamp or moonlight), outdoor-night (outside at night/twilight/magical setting)
  * CRITICAL: actors in imageScene MUST exactly match the actors array. If actors has 2 IDs, imageScene.actors must have exactly 2 entries with those same IDs.

Generate the paginated output now.`;

            const finalPrompt = systemPrompt;

            debug.details.promptLength = finalPrompt.length;
            debug.details.hasOutputTypePaginationPrompt = !!storyOutputType.paginationPrompt;
            debug.details.outputTypePaginationPrompt = storyOutputType.paginationPrompt || null;
            debug.details.prompt = finalPrompt;

            // Call AI for pagination
            debug.stage = 'ai_generate';
            // Flash tier suffices: pagination is straightforward. gemini-2.0-flash
            // was retired by Google (404s since ~June 2026) and silently pushed every
            // book onto the no-imageScene fallback path.
            const modelName = 'googleai/gemini-2.5-flash';
            const startTime = Date.now();

            let llmResponse;
            try {
                // Structured-output misses are stochastic: the model occasionally
                // omits required imageScene fields. Two failure shapes, both worth
                // fresh attempts (unlike a true 4xx they usually succeed on retry):
                //  1. Genkit rejects the WHOLE response (INVALID_ARGUMENT,
                //     "Schema validation failed") when a present imageScene is
                //     missing a required property.
                //  2. The response passes the schema but a text page omits
                //     imageScene entirely (it is .optional() so blank/divider pages
                //     do not hard-fail) — semantically a miss: every non-empty text
                //     page needs a scene for image generation.
                // Other errors propagate immediately.
                const isSchemaMiss = (e: any) =>
                    typeof e?.message === 'string' && e.message.includes('Schema validation failed');
                const VALID_SCENE_TAGS = ['indoor-day', 'outdoor-day', 'indoor-night', 'outdoor-night'];
                const semanticMiss = (resp: any): string | null => {
                    const pages = resp?.output?.pages;
                    if (!Array.isArray(pages)) return null; // manual-parse path handles downstream
                    const textPages = pages.filter((p: any) => p.text && p.text.trim().length > 0);
                    if (textPages.length === 0) return 'no non-empty text pages';
                    const bad = textPages.filter((p: any) => !VALID_SCENE_TAGS.includes(p.imageScene?.sceneTag));
                    return bad.length > 0
                        ? `${bad.length}/${textPages.length} text page(s) missing valid imageScene.sceneTag`
                        : null;
                };
                const MAX_SCHEMA_ATTEMPTS = 3;
                let attempt = 0;
                for (;;) {
                    attempt += 1;
                    try {
                        llmResponse = await ai.generate({
                            model: modelName,
                            prompt: finalPrompt,
                            output: { schema: PaginationAIOutputSchema },
                            config: { temperature: 0.3, maxOutputTokens: 8000 },
                        });
                        const miss = semanticMiss(llmResponse);
                        if (miss && attempt < MAX_SCHEMA_ATTEMPTS) {
                            console.warn(`[storyPaginationFlow] semantic miss on attempt ${attempt}/${MAX_SCHEMA_ATTEMPTS}, retrying: ${miss}`);
                            debug.details[`semanticMissAttempt${attempt}`] = miss;
                            continue;
                        }
                        break;
                    } catch (e: any) {
                        if (isSchemaMiss(e) && attempt < MAX_SCHEMA_ATTEMPTS) {
                            console.warn(`[storyPaginationFlow] schema miss on attempt ${attempt}/${MAX_SCHEMA_ATTEMPTS}, retrying:`, e.message?.slice(0, 160));
                            debug.details[`schemaMissAttempt${attempt}`] = e.message?.slice(0, 300);
                            continue;
                        }
                        throw e;
                    }
                }
                await logAIFlow({
                    flowName: 'storyPaginationFlow',
                    sessionId: story.storySessionId,
                    parentId: story.parentUid,
                    prompt: finalPrompt,
                    response: llmResponse,
                    startTime,
                    modelName,
                });
                if (story.storySessionId) {
                    await logAICallToTrace({
                        sessionId: story.storySessionId,
                        flowName: 'storyPaginationFlow',
                        modelName,
                        temperature: 0.3,
                        maxOutputTokens: 8000,
                        systemPrompt: finalPrompt,
                        response: llmResponse,
                        startTime,
                    });
                }
            } catch (e: any) {
                await logAIFlow({
                    flowName: 'storyPaginationFlow',
                    sessionId: story.storySessionId,
                    parentId: story.parentUid,
                    prompt: finalPrompt,
                    error: e,
                    startTime,
                    modelName,
                });
                if (story.storySessionId) {
                    await logAICallToTrace({
                        sessionId: story.storySessionId,
                        flowName: 'storyPaginationFlow',
                        modelName,
                        temperature: 0.3,
                        maxOutputTokens: 8000,
                        systemPrompt: finalPrompt,
                        error: e,
                        startTime,
                    });
                }
                throw e;
            }

            debug.stage = 'processing';
            debug.details.rawResponse = llmResponse.text;
            debug.details.durationMs = Date.now() - startTime;

            // Extract structured output
            let structuredOutput = llmResponse.output;

            if (!structuredOutput) {
                const rawText = llmResponse.text;
                if (!rawText || rawText.trim() === '') {
                    throw new Error("Model returned empty text for pagination.");
                }

                try {
                    const jsonMatch = rawText.match(/```json\n([\s\S]*?)\n```/);
                    const jsonToParse = jsonMatch ? jsonMatch[1].trim() : rawText.trim();
                    const parsed = JSON.parse(jsonToParse);
                    const validation = PaginationAIOutputSchema.safeParse(parsed);
                    if (validation.success) {
                        structuredOutput = validation.data;
                    } else {
                        throw new Error(`Pagination output validation failed: ${validation.error.message}`);
                    }
                } catch (err: any) {
                    throw new Error(`Failed to parse pagination output: ${err.message}`);
                }
            }

            const { pages } = structuredOutput;

            // Filter out any pages with empty text (AI sometimes returns empty pages)
            const validPages = pages.filter((page: { text: string }) => page.text && page.text.trim().length > 0);

            if (validPages.length === 0) {
                throw new Error('AI pagination returned no valid pages with text content.');
            }

            debug.details.generatedPageCount = validPages.length;
            debug.details.filteredOutPages = pages.length - validPages.length;
            debug.stage = 'done';

            // Build location registry: first occurrence of each locationKey becomes canonical
            const locationRegistry: Record<string, string> = {};
            for (const page of validPages) {
                const scene = (page as any).imageScene as ImageScene | undefined;
                if (scene?.locationKey && !locationRegistry[scene.locationKey]) {
                    locationRegistry[scene.locationKey] = scene.locationDescription;
                }
            }

            // Resolve placeholders for displayText; apply canonical location descriptions
            const pagesWithDisplayText = await Promise.all(
                validPages.map(async (page: any) => {
                    const imageScene: ImageScene | undefined = page.imageScene;
                    return {
                        pageNumber: page.pageNumber,
                        bodyText: page.text,
                        displayText: await stripTTSDirectiveTags(await replacePlaceholdersWithDescriptions(page.text)),
                        entityIds: page.actors,
                        // Apply canonical location description from registry
                        imageScene: imageScene ? {
                            ...imageScene,
                            atmosphere: imageScene.atmosphere || (imageScene.sceneTag && DEFAULT_ATMOSPHERE[imageScene.sceneTag]) || 'warm, friendly storybook mood',
                            locationDescription: locationRegistry[imageScene.locationKey] ?? imageScene.locationDescription,
                        } : undefined,
                    };
                })
            );

            // Persist location registry to story document so image flow can look it up
            if (Object.keys(locationRegistry).length > 0) {
                await storyRef.update({ locationRegistry }).catch((e: any) =>
                    console.warn('[storyPaginationFlow] Failed to save locationRegistry:', e?.message)
                );
            }

            return {
                ok: true,
                storyId,
                pages: pagesWithDisplayText,
                locationRegistry,
                stats: {
                    pageCount: validPages.length,
                    targetPageCount,
                    resolvedConstraints,
                },
                debug,
            };

        } catch (e: any) {
            // Raw error stays in debug (diagnostics-gated) and server logs; the
            // result errorMessage reaches clients verbatim so it must be user-safe.
            debug.stage = 'error';
            debug.details.error = e.message || String(e);
            console.error('[storyPaginationFlow] Unexpected error:', e);
            return {
                ok: false,
                storyId,
                errorMessage: toUserSafeMessage(e),
                debug,
            };
        }
    }
);
