
'use server';

/**
 * @fileOverview A Genkit flow to generate a composite avatar from all actors in a story.
 * Creates a group avatar featuring the child and any characters in the story.
 * Runs in the background after story compilation.
 */

import { ai } from '@/ai/genkit';
import { FieldValue } from 'firebase-admin/firestore';
import { getServerFirestore } from '@/lib/server-firestore';
import { z } from 'genkit';
import type { Story } from '@/lib/types';
import { getStoryBucket } from '@/firebase/admin/storage';
import { randomUUID } from 'crypto';
import { logAIFlow } from '@/lib/ai-flow-logger';
import {
  extractActorIdsFromText,
  getActorsDetailsWithImageData,
  buildActorDescription,
  type ActorDetailsWithImageData,
} from '@/lib/story-context-builder';

const StoryActorAvatarFlowInputSchema = z.object({
  storyId: z.string(),
  forceRegenerate: z.boolean().optional(),
});

export type StoryActorAvatarFlowInput = z.infer<typeof StoryActorAvatarFlowInputSchema>;

const StoryActorAvatarFlowOutputSchema = z.object({
  ok: z.boolean(),
  actorAvatarUrl: z.string().optional(),
  errorMessage: z.string().optional(),
});

export type StoryActorAvatarFlowOutput = z.infer<typeof StoryActorAvatarFlowOutputSchema>;

function parseDataUrl(dataUrl: string): { mimeType: string; buffer: Buffer } {
  const match = /^data:(.+);base64,(.*)$/i.exec(dataUrl);
  if (!match) {
    throw new Error('Model returned an invalid media payload.');
  }
  return {
    mimeType: match[1],
    buffer: Buffer.from(match[2], 'base64'),
  };
}

async function uploadAvatarToStorage(params: {
  buffer: Buffer;
  mimeType: string;
  storyId: string;
  parentUid: string;
}): Promise<string> {
  const bucket = await getStoryBucket();
  const objectPath = `stories/${params.storyId}/actor-avatar-${Date.now()}.png`;
  const downloadToken = randomUUID();

  await bucket.file(objectPath).save(params.buffer, {
    contentType: params.mimeType,
    resumable: false,
    metadata: {
      cacheControl: 'public,max-age=3600',
      metadata: {
        ownerParentUid: params.parentUid,
        storyId: params.storyId,
        firebaseStorageDownloadTokens: downloadToken,
      },
    },
  });

  return `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(objectPath)}?alt=media&token=${downloadToken}`;
}

export const storyActorAvatarFlow = ai.defineFlow(
  {
    name: 'storyActorAvatarFlow',
    inputSchema: StoryActorAvatarFlowInputSchema,
    outputSchema: StoryActorAvatarFlowOutputSchema,
  },
  async ({ storyId, forceRegenerate }) => {
    const firestore = await getServerFirestore();
    const storyRef = firestore.collection('stories').doc(storyId);

    try {
      // Load story
      const storyDoc = await storyRef.get();
      if (!storyDoc.exists) {
        return { ok: false, errorMessage: `Story ${storyId} not found.` };
      }

      const story = storyDoc.data() as Story;

      // Check if already generated (unless forcing)
      if (!forceRegenerate && story.actorAvatarUrl && story.actorAvatarGeneration?.status === 'ready') {
        return { ok: true, actorAvatarUrl: story.actorAvatarUrl };
      }

      // Mark as generating
      await storyRef.update({
        'actorAvatarGeneration.status': 'generating',
        'actorAvatarGeneration.lastRunAt': FieldValue.serverTimestamp(),
      });

      // Get actors from story (or extract from text if not set)
      let actorIds = story.actors || [];
      if (actorIds.length === 0) {
        // Fallback: extract from story text
        actorIds = extractActorIdsFromText(story.storyText);
        if (!actorIds.includes(story.childId)) {
          actorIds.unshift(story.childId);
        }
      }

      // Load all actors with their details and image data URIs
      const actors = await getActorsDetailsWithImageData(
        firestore,
        actorIds,
        story.childId
      );

      // Collect actors with avatars and build image parts for the prompt
      const actorsWithAvatars = actors.filter(a => a.avatarDataUri);
      const imageParts = actorsWithAvatars
        .slice(0, 5)
        .map(a => ({ media: { url: a.avatarDataUri! } }));

      // Build actor descriptions for the prompt
      const detailedDescriptions = actors.map((actor, idx) =>
        `${idx + 1}. ${buildActorDescription(actor)}`
      ).join('\n');

      // Build list showing which actors have images
      const fullActorList = actors.map((actor, idx) => {
        const hasImage = actor.avatarDataUri ? ' [has reference image]' : ' [no reference image]';
        return `${idx + 1}. ${actor.displayName}${hasImage}`;
      }).join('\n');

      // Build prompt
      let promptParts: any[];
      let promptText: string;

      if (imageParts.length > 0) {
        // Build list showing which images correspond to which actors
        const imageReferenceList = actorsWithAvatars.slice(0, imageParts.length).map((actor, idx) =>
          `Image ${idx + 1}: ${actor.displayName}${actor.isMainChild ? ' (main child)' : ''}`
        ).join('\n');

        // Use existing avatars as reference
        promptParts = [
          ...imageParts,
          {
            text: `Create an avatar image containing all the following characters together in a group scene.

REFERENCE IMAGES PROVIDED:
${imageReferenceList}

ALL CHARACTERS TO INCLUDE (use reference images where available, create consistent characters for others):
${detailedDescriptions}

Requirements:
- Create a colorful, child-friendly cartoon group scene
- Include ALL ${actors.length} characters listed above
- Show all characters together in a friendly pose (waving, hugging, or standing together)
- For characters with reference images: maintain their appearance and style
- For characters without reference images: create them in a matching style
- Use a soft, warm background color
- Make it look like a storybook "cast of characters" group photo
- Keep the style consistent and cheerful across all characters`,
          },
        ];
        promptText = `Create group avatar with ${actors.length} characters (${imageParts.length} have reference images): ${fullActorList}`;
      } else {
        // Generate from descriptions only
        promptParts = [
          {
            text: `Create an avatar image containing all the following characters together in a group scene.

ALL CHARACTERS TO INCLUDE:
${detailedDescriptions}

Requirements:
- Create a colorful, child-friendly cartoon group scene
- Include ALL ${actors.length} characters listed above
- Show all characters together in a friendly pose (waving, hugging, or standing together)
- Use a soft, warm background color
- Make it look like a storybook "cast of characters" group photo
- Keep the style consistent and cheerful
- Characters should be cute and age-appropriate for young children`,
          },
        ];
        promptText = `Create group avatar with ${actors.length} characters (no reference images): ${fullActorList}`;
      }

      let llmResponse;
      const startTime = Date.now();
      try {
        llmResponse = await ai.generate({
          model: 'googleai/gemini-2.5-flash-image-preview',
          prompt: promptParts,
          config: {
            responseModalities: ['TEXT', 'IMAGE'],
          },
        });
        await logAIFlow({ flowName: 'storyActorAvatarFlow', sessionId: storyId, parentId: story.parentUid, prompt: promptText, response: llmResponse, startTime });
      } catch (e: any) {
        await logAIFlow({ flowName: 'storyActorAvatarFlow', sessionId: storyId, parentId: story.parentUid, prompt: promptText, error: e, startTime });
        throw e;
      }

      const dataUrl = llmResponse.media?.url;
      if (!dataUrl) {
        throw new Error('The model did not return an image.');
      }

      const { buffer, mimeType } = parseDataUrl(dataUrl);

      const actorAvatarUrl = await uploadAvatarToStorage({
        buffer,
        mimeType,
        storyId,
        parentUid: story.parentUid,
      });

      // Update story with generated avatar
      await storyRef.update({
        actorAvatarUrl,
        'actorAvatarGeneration.status': 'ready',
        'actorAvatarGeneration.lastCompletedAt': FieldValue.serverTimestamp(),
        'actorAvatarGeneration.lastErrorMessage': null,
        updatedAt: FieldValue.serverTimestamp(),
      });

      return { ok: true, actorAvatarUrl };

    } catch (e: any) {
      console.error('[storyActorAvatarFlow] Error:', e);

      // Mark as error
      await storyRef.update({
        'actorAvatarGeneration.status': 'error',
        'actorAvatarGeneration.lastErrorMessage': e.message || 'Unknown error',
      });

      return { ok: false, errorMessage: e.message || 'Failed to generate actor avatar.' };
    }
  }
);
