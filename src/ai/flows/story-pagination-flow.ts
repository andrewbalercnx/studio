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
import type { Story, StoryOutputType, ChildProfile, Character } from '@/lib/types';
import { logAIFlow } from '@/lib/ai-flow-logger';
import {
    type ActorInfo,
    buildActorListForPrompt,
    getActorsDetails,
} from '@/lib/story-context-builder';

// Schema for the AI's paginated output
// Note: We use permissive string validation here to avoid schema errors.
// Empty strings are filtered out during post-processing.
const PaginationAIOutputSchema = z.object({
  pages: z.array(z.object({
    pageNumber: z.number().int().positive(),
    text: z.string(),
    actors: z.array(z.string()),
    imageDescription: z.string().optional().default(''),
  })),
});

// Default pagination prompt used when storyOutputType doesn't have one
const DEFAULT_PAGINATION_PROMPT = `You are a children's book pagination expert. Take the story text and divide it into pages suitable for a children's picture book.

RULES:
1. Each page should have a natural amount of text for young children (2-4 short sentences, about 15-40 words)
2. Preserve ALL $$id$$ actor references exactly as they appear - do not change them
3. List which actor IDs (the IDs inside $$...$$) appear on each page in the actors array
4. Create natural narrative breaks between pages - end pages at scene changes or emotional beats
5. Build to a satisfying conclusion
6. Do not add or remove any content from the story - just divide it into pages
7. The first page should be an engaging opening, the last page should provide closure
8. For each page, write an imageDescription that describes what should be illustrated - include setting, action, mood, and which characters are present (use $$id$$ placeholders, same as in the text)`;

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

            // Load actor details for context
            debug.details.step = 'loadActorDetails';
            const actorIds = story.actors || [];
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
            const paginationInstructions = storyOutputType.paginationPrompt || DEFAULT_PAGINATION_PROMPT;

            const pageCountInstruction = targetPageCount > 0
                ? `TARGET PAGE COUNT: Exactly ${targetPageCount} content pages. Distribute the story evenly across these pages.`
                : `PAGE COUNT: Use your judgment to create an appropriate number of pages (typically 8-16 for a picture book). Each page should have enough text to be meaningful but not overwhelming for young children.`;

            const styleInstruction = storyOutputType.aiHints?.style
                ? `STYLE: ${storyOutputType.aiHints.style}`
                : '';

            const rhymeInstruction = storyOutputType.aiHints?.allowRhyme
                ? `IMPORTANT: The text should maintain its rhyming structure across pages.`
                : '';

            const systemPrompt = `${paginationInstructions}

${styleInstruction}
${rhymeInstruction}

${pageCountInstruction}

**CHARACTER REFERENCE (preserve these $$id$$ placeholders exactly):**
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
      "text": "The page text with $$id$$ placeholders preserved...",
      "actors": ["actor-id-1", "actor-id-2"],
      "imageDescription": "A vivid description of the scene for AI image generation..."
    },
    ...
  ]
}

IMPORTANT:
- pageNumber starts at 1 and increments sequentially
- text contains the story content for that page with $$id$$ placeholders preserved
- actors is an array of actor IDs (without the $$ markers) that appear on that page
- imageDescription is a rich, visual description of what should be illustrated on this page:
  * Describe the setting/environment (e.g., "a sunny garden with colorful flowers")
  * Describe the action/pose of characters (e.g., "$$child-id$$ jumping with joy", "$$character-id$$ looking surprised")
  * Include the mood/atmosphere (e.g., "warm and cheerful", "mysterious and exciting")
  * Use $$id$$ placeholders for characters (same as in the text) so they can be resolved later
  * Be specific about visual details that match the story text

Generate the paginated output now.`;

            const finalPrompt = systemPrompt;

            debug.details.promptLength = finalPrompt.length;
            debug.details.usedCustomPrompt = !!storyOutputType.paginationPrompt;
            debug.details.prompt = finalPrompt;

            // Call AI for pagination
            debug.stage = 'ai_generate';
            // Using gemini-2.0-flash for faster response times (pagination is straightforward)
            const modelName = 'googleai/gemini-2.0-flash';
            const startTime = Date.now();

            let llmResponse;
            try {
                llmResponse = await ai.generate({
                    model: modelName,
                    prompt: finalPrompt,
                    output: { schema: PaginationAIOutputSchema },
                    config: { temperature: 0.3, maxOutputTokens: 8000 },
                });
                await logAIFlow({
                    flowName: 'storyPaginationFlow',
                    sessionId: story.storySessionId,
                    parentId: story.parentUid,
                    prompt: finalPrompt,
                    response: llmResponse,
                    startTime,
                    modelName,
                });
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

            return {
                ok: true,
                storyId,
                pages: validPages.map((page: { pageNumber: number; text: string; actors: string[]; imageDescription?: string }) => ({
                    pageNumber: page.pageNumber,
                    bodyText: page.text,
                    entityIds: page.actors,
                    imageDescription: page.imageDescription || undefined,
                })),
                stats: {
                    pageCount: validPages.length,
                    targetPageCount,
                },
                debug,
            };

        } catch (e: any) {
            debug.stage = 'error';
            debug.details.error = e.message || String(e);
            return {
                ok: false,
                storyId,
                errorMessage: `Error in storyPaginationFlow: ${e.message || String(e)}`,
                debug,
            };
        }
    }
);
