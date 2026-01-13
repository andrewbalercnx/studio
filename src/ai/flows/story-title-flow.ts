
'use server';

/**
 * @fileOverview A Genkit flow to generate a creative title for a story.
 * Runs in the background after story compilation.
 */

import { ai } from '@/ai/genkit';
import { FieldValue } from 'firebase-admin/firestore';
import { getServerFirestore } from '@/lib/server-firestore';
import { z } from 'genkit';
import type { Story, ChildProfile } from '@/lib/types';
import { logAIFlow } from '@/lib/ai-flow-logger';
import { replacePlaceholdersWithDescriptions } from '@/lib/resolve-placeholders.server';

/**
 * Calculate child's age from date of birth
 */
function calculateChildAge(child: ChildProfile | null): number | null {
  if (!child?.dateOfBirth) return null;
  let dob: Date | null = null;
  if (typeof (child.dateOfBirth as any)?.toDate === 'function') {
    dob = (child.dateOfBirth as any).toDate();
  } else {
    const parsed = new Date(child.dateOfBirth as any);
    dob = isNaN(parsed.getTime()) ? null : parsed;
  }
  if (!dob) return null;
  const diff = Date.now() - dob.getTime();
  if (diff <= 0) return null;
  return Math.floor(diff / (1000 * 60 * 60 * 24 * 365.25));
}

const StoryTitleFlowInputSchema = z.object({
  storyId: z.string(),
  forceRegenerate: z.boolean().optional(),
});

export type StoryTitleFlowInput = z.infer<typeof StoryTitleFlowInputSchema>;

const StoryTitleFlowOutputSchema = z.object({
  ok: z.boolean(),
  title: z.string().optional(),
  errorMessage: z.string().optional(),
});

export type StoryTitleFlowOutput = z.infer<typeof StoryTitleFlowOutputSchema>;

export const storyTitleFlow = ai.defineFlow(
  {
    name: 'storyTitleFlow',
    inputSchema: StoryTitleFlowInputSchema,
    outputSchema: StoryTitleFlowOutputSchema,
  },
  async ({ storyId, forceRegenerate }) => {
    const firestore = await getServerFirestore();
    const storyRef = firestore.collection('stories').doc(storyId);

    try {
      // Load story
      const storyDoc = await storyRef.get();
      if (!storyDoc.exists) {
        console.warn('[storyTitleFlow] Story not found:', storyId);
        return { ok: false, errorMessage: `Story ${storyId} not found.` };
      }

      const story = storyDoc.data() as Story;

      // Check if already generated (unless forcing)
      if (!forceRegenerate && story.metadata?.title && story.titleGeneration?.status === 'ready') {
        console.log('[storyTitleFlow] Title already exists, skipping generation:', story.metadata.title);
        return { ok: true, title: story.metadata.title };
      }

      // Check if already generating (prevent concurrent runs)
      if (!forceRegenerate && story.titleGeneration?.status === 'generating') {
        const lastRunAt = story.titleGeneration?.lastRunAt?.toMillis?.() || 0;
        const elapsedMs = Date.now() - lastRunAt;
        // Allow retry if stuck for more than 2 minutes
        if (elapsedMs < 120000) {
          console.log('[storyTitleFlow] Title generation already in progress, skipping duplicate run');
          return { ok: false, errorMessage: 'Title generation already in progress.' };
        }
        console.log('[storyTitleFlow] Previous title generation timed out, allowing retry');
      }

      // Check if synopsis is available - title generation depends on synopsis
      if (!story.synopsis || story.synopsisGeneration?.status !== 'ready') {
        console.log('[storyTitleFlow] Synopsis not ready yet, cannot generate title');
        return { ok: false, errorMessage: 'Synopsis must be generated before title can be created.' };
      }

      // Mark as generating
      await storyRef.update({
        'titleGeneration.status': 'generating',
        'titleGeneration.lastRunAt': FieldValue.serverTimestamp(),
      });

      // Load child profile to get age
      let childAge: number | null = null;
      if (story.childId) {
        const childDoc = await firestore.collection('children').doc(story.childId).get();
        if (childDoc.exists) {
          const childProfile = childDoc.data() as ChildProfile;
          childAge = calculateChildAge(childProfile);
        }
      }

      // Build age description for the prompt
      const ageDescription = childAge
        ? `aged ${childAge}`
        : 'young';

      // Resolve placeholders in the synopsis to get readable text with character descriptions
      const resolvedSynopsis = await replacePlaceholdersWithDescriptions(story.synopsis);

      // Build prompt using the resolved synopsis - simple prompt, no JSON required
      const prompt = `Generate a short, catchy title for this children's story.

STORY SYNOPSIS:
${resolvedSynopsis}

The title should be suitable for a ${ageDescription} child, fun and engaging, and capture the main theme or adventure. You may include a character's name if appropriate.

Reply with ONLY the title text, nothing else.`;

      let llmResponse;
      const startTime = Date.now();
      const modelName = 'googleai/gemini-2.0-flash';
      try {
        llmResponse = await ai.generate({
          model: modelName,
          prompt,
          config: { temperature: 0.8, maxOutputTokens: 50 },
        });
        await logAIFlow({
          flowName: 'storyTitleFlow',
          sessionId: storyId,
          parentId: story.parentUid,
          prompt,
          response: llmResponse,
          startTime,
          modelName,
        });
      } catch (e: any) {
        await logAIFlow({ flowName: 'storyTitleFlow', sessionId: storyId, parentId: story.parentUid, prompt, error: e, startTime, modelName });
        throw e;
      }

      // Clean up the response - remove quotes if present
      let title = llmResponse.text?.trim() || 'My Story';
      // Remove surrounding quotes if the model added them
      if ((title.startsWith('"') && title.endsWith('"')) || (title.startsWith("'") && title.endsWith("'"))) {
        title = title.slice(1, -1);
      }

      // Update story with generated title
      await storyRef.update({
        'metadata.title': title,
        'titleGeneration.status': 'ready',
        'titleGeneration.lastCompletedAt': FieldValue.serverTimestamp(),
        'titleGeneration.lastErrorMessage': null,
        'titleGeneration._debug': {
          rawResponse: llmResponse.text ?? null,
          finalTitle: title,
          generatedAt: new Date().toISOString(),
        },
        updatedAt: FieldValue.serverTimestamp(),
      });

      return { ok: true, title };

    } catch (e: any) {
      console.error('[storyTitleFlow] Error:', e);

      // Mark as error
      await storyRef.update({
        'titleGeneration.status': 'error',
        'titleGeneration.lastErrorMessage': e.message || 'Unknown error',
      });

      return { ok: false, errorMessage: e.message || 'Failed to generate title.' };
    }
  }
);
