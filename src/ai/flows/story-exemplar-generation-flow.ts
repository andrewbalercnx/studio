'use server';

/**
 * @fileOverview Generates exemplar images for all actors in a storybook.
 * Called after pagination completes, in parallel with audio generation.
 * Each actor gets their own AI flow call, producing entries in aiFlowLogs.
 */

import { ai } from '@/ai/genkit';
import { initFirebaseAdminApp } from '@/firebase/admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { z } from 'genkit';
import type { Character, ChildProfile, Story, ImageStyle } from '@/lib/types';
import { getStoryBucket } from '@/firebase/admin/storage';
import { randomUUID } from 'crypto';
import { logAIFlow } from '@/lib/ai-flow-logger';
import { Gaxios, GaxiosError } from 'gaxios';

const DEFAULT_IMAGE_MODEL = process.env.STORYBOOK_IMAGE_MODEL ?? 'googleai/gemini-2.5-flash-image-preview';
// Use 1:1 (square) for character reference sheets with 2x2 grid layout
// Valid options: '1:1', '2:3', '3:2', '3:4', '4:3', '4:5', '5:4', '9:16', '16:9', '21:9'
const EXEMPLAR_ASPECT_RATIO = '1:1';

const StoryExemplarGenerationFlowInputSchema = z.object({
  storyId: z.string(),
  storybookId: z.string(),
});

export type StoryExemplarGenerationFlowInput = z.infer<typeof StoryExemplarGenerationFlowInputSchema>;

const StoryExemplarGenerationFlowOutputSchema = z.object({
  ok: z.boolean(),
  actorExemplarUrls: z.record(z.string()).optional(), // actorId -> imageUrl
  errorMessage: z.string().optional(),
});

export type StoryExemplarGenerationFlowOutput = z.infer<typeof StoryExemplarGenerationFlowOutputSchema>;

async function fetchImageAsDataUri(url: string): Promise<string | null> {
  if (!url || typeof url !== 'string') return null;

  try {
    const gaxios = new Gaxios();
    const urlObject = new URL(url);
    if (process.env.GEMINI_API_KEY) {
      urlObject.searchParams.append('key', process.env.GEMINI_API_KEY);
    }

    const response = await gaxios.request<ArrayBuffer>({
      url: urlObject.toString(),
      responseType: 'arraybuffer',
    });

    if (response.status !== 200 || !response.data) return null;

    const mimeType = response.headers['content-type'] || 'image/jpeg';
    const buffer = Buffer.from(response.data);
    return `data:${mimeType};base64,${buffer.toString('base64')}`;
  } catch (error) {
    if (error instanceof GaxiosError) {
      console.error(`[story-exemplar-generation-flow] Error fetching ${url}: ${error.message}`);
    }
    return null;
  }
}

function parseDataUrl(dataUrl: string): { mimeType: string; buffer: Buffer } {
  const match = /^data:(.+);base64,(.*)$/i.exec(dataUrl);
  if (match) {
    return { mimeType: match[1], buffer: Buffer.from(match[2], 'base64') };
  }
  throw new Error('Invalid data URL format');
}

async function uploadExemplarToStorage(params: {
  buffer: Buffer;
  mimeType: string;
  storyId: string;
  actorId: string;
  parentUid: string;
}): Promise<string> {
  const bucket = await getStoryBucket();
  const extension = params.mimeType === 'image/png' ? 'png' : 'jpg';
  const storagePath = `stories/${params.storyId}/exemplars/${params.actorId}.${extension}`;
  const downloadToken = randomUUID();

  await bucket.file(storagePath).save(params.buffer, {
    contentType: params.mimeType,
    resumable: false,
    metadata: {
      cacheControl: 'public,max-age=3600',
      metadata: {
        ownerParentUid: params.parentUid,
        storyId: params.storyId,
        actorId: params.actorId,
        firebaseStorageDownloadTokens: downloadToken,
      },
    },
  });

  return `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(storagePath)}?alt=media&token=${downloadToken}`;
}

/**
 * Generate a single exemplar for one actor
 */
async function generateExemplarForActor(params: {
  actor: ChildProfile | Character;
  actorId: string;
  actorType: 'child' | 'character';
  imageStylePrompt: string;
  styleExampleUrls: string[];  // URLs of style example images to guide the art style
  storyId: string;
  parentUid: string;
}): Promise<{ ok: true; imageUrl: string } | { ok: false; errorMessage: string }> {
  const { actor, actorId, actorType, imageStylePrompt, styleExampleUrls, storyId, parentUid } = params;
  const startTime = Date.now();
  const flowName = 'storyExemplarGenerationFlow';

  const displayName = actor.displayName || 'the character';
  const pronouns = actor.pronouns || 'they/them';
  const imageDescription = actor.imageDescription || '';
  const description = actor.description || '';

  // Build appearance context
  const appearanceParts: string[] = [];
  if (imageDescription) appearanceParts.push(`Physical appearance: ${imageDescription}`);
  if (description) appearanceParts.push(`Description: ${description}`);
  if (actor.likes?.length) appearanceParts.push(`Likes: ${actor.likes.join(', ')}`);
  const appearanceContext = appearanceParts.length > 0 ? `\n\n${appearanceParts.join('\n')}` : '';

  const characterType = actorType === 'character' && 'type' in actor ? (actor as Character).type : null;
  const typeContext = characterType ? ` (${characterType.toLowerCase()})` : '';

  const promptText = `Create a character reference sheet for a children's storybook character.

=== ART STYLE (CRITICAL - MUST FOLLOW EXACTLY) ===
${imageStylePrompt}

${styleExampleUrls.length > 0 ? `STYLE REFERENCE IMAGES: The first ${styleExampleUrls.length} image(s) provided show the EXACT art style you must use. Study these carefully and replicate:` : 'Apply this art style consistently:'}
- The exact rendering technique (watercolor, digital, pencil, realistic, etc.)
- Color palette, saturation levels, and color harmony
- Line weight, edge treatment, and outline style
- Level of detail, texture, and shading approach
- Overall aesthetic, mood, and visual tone

The art style is NON-NEGOTIABLE. The character reference sheet MUST look like it belongs in the same book as the style examples.

=== CHARACTER TO DEPICT ===
Name: ${displayName}${typeContext}
Pronouns: ${pronouns}${appearanceContext}

=== REFERENCE SHEET LAYOUT (CRITICAL - MUST BE EXACTLY AS SPECIFIED) ===

IMAGE LAYOUT: Create a SQUARE image divided into 4 EQUAL QUADRANTS (2 rows × 2 columns):

┌─────────────────┬─────────────────┐
│   TOP-LEFT:     │   TOP-RIGHT:    │
│   FRONT VIEW    │   BACK VIEW     │
│   (full body)   │   (full body)   │
├─────────────────┼─────────────────┤
│   BOTTOM-LEFT:  │   BOTTOM-RIGHT: │
│   3/4 VIEW      │   FACE CLOSE-UP │
│   (full body)   │   (HEAD ONLY)   │
└─────────────────┴─────────────────┘

QUADRANT DETAILS:
1. TOP-LEFT: Full body FRONT view - character facing the viewer, head to feet visible
2. TOP-RIGHT: Full body BACK view - character facing AWAY from viewer, head to feet visible
3. BOTTOM-LEFT: Full body 3/4 view - character turned slightly to show depth, head to feet visible
4. BOTTOM-RIGHT: FACE CLOSE-UP - HEAD AND SHOULDERS ONLY, NOT full body. This is a portrait showing the face in detail.

CRITICAL: The bottom-right quadrant MUST be a FACE CLOSE-UP (head and shoulders portrait), NOT another full-body view. This is essential for capturing facial details.

=== STRICT REQUIREMENTS ===
1. Use a plain WHITE or very light neutral background - no scenery, no props
2. All FOUR views MUST show the EXACT SAME character with IDENTICAL:
   - Clothing, accessories, and any distinctive items
   - Hair style, color, and texture
   - Skin tone and facial features
   - Body proportions and build
   - Art style rendering
3. The three full-body poses should be simple standing poses - neutral, not action poses
4. The face close-up MUST clearly show: eyes, nose, mouth, eyebrows, and any distinctive facial features
5. Make the character friendly and appealing to young children
6. Each quadrant should be clearly separated with equal spacing

This reference sheet will be used to maintain character consistency across multiple story illustrations.`;

  // Fetch style example images first (these set the visual style)
  const styleExampleParts = (await Promise.all(
    styleExampleUrls.map(async (url) => {
      const dataUri = await fetchImageAsDataUri(url);
      return dataUri ? { media: { url: dataUri } } : null;
    })
  )).filter((part): part is { media: { url: string } } => part !== null);

  // Collect reference photos from actor (these show who the character should look like)
  const referencePhotoUrls: string[] = [];
  if (actor.avatarUrl) referencePhotoUrls.push(actor.avatarUrl);
  if (actor.photos?.length) referencePhotoUrls.push(...actor.photos.slice(0, 3));

  const referencePhotoParts = (await Promise.all(
    referencePhotoUrls.map(async (url) => {
      const dataUri = await fetchImageAsDataUri(url);
      return dataUri ? { media: { url: dataUri } } : null;
    })
  )).filter((part): part is { media: { url: string } } => part !== null);

  // Build prompt with style examples first, then character references, then text
  // Order matters: style examples set the aesthetic, character references show appearance
  const promptParts: any[] = [...styleExampleParts, ...referencePhotoParts, { text: promptText }];
  const promptTextForLogging = `${promptText} [${styleExampleParts.length} style example(s), ${referencePhotoParts.length} reference photo(s)]`;

  try {
    console.log(`[story-exemplar-generation-flow] Generating exemplar for ${actorType} ${actorId} (${displayName})`);

    const llmResponse = await ai.generate({
      model: DEFAULT_IMAGE_MODEL,
      prompt: promptParts,
      config: {
        responseModalities: ['TEXT', 'IMAGE'],
        imageConfig: { aspectRatio: EXEMPLAR_ASPECT_RATIO },
      },
    });

    const mediaUrl = llmResponse.media?.url;
    if (!mediaUrl) {
      const finishReason = llmResponse.finishReason;
      const finishMessage = llmResponse.finishMessage;
      const textResponse = llmResponse.text?.substring(0, 200);
      const failureReason = `No image returned. finishReason=${finishReason}, finishMessage=${finishMessage || 'none'}, text=${textResponse || 'none'}`;

      await logAIFlow({
        flowName,
        sessionId: actorId,
        parentId: parentUid,
        prompt: promptTextForLogging,
        response: llmResponse,
        startTime,
        modelName: DEFAULT_IMAGE_MODEL,
        isFailure: true,
        failureReason,
      });

      return { ok: false, errorMessage: failureReason };
    }

    const { buffer, mimeType } = parseDataUrl(mediaUrl);
    const imageUrl = await uploadExemplarToStorage({
      buffer,
      mimeType,
      storyId,
      actorId,
      parentUid,
    });

    await logAIFlow({
      flowName,
      sessionId: actorId,
      parentId: parentUid,
      prompt: promptTextForLogging,
      response: llmResponse,
      startTime,
      modelName: DEFAULT_IMAGE_MODEL,
      imageUrl,
    });

    console.log(`[story-exemplar-generation-flow] Successfully generated exemplar for ${displayName}: ${imageUrl}`);
    return { ok: true, imageUrl };

  } catch (error: any) {
    const errorMessage = error?.message ?? 'Unknown error';
    console.error(`[story-exemplar-generation-flow] Error generating exemplar for ${actorId}:`, errorMessage);

    await logAIFlow({
      flowName,
      sessionId: actorId,
      parentId: parentUid,
      prompt: promptTextForLogging,
      error,
      startTime,
      modelName: DEFAULT_IMAGE_MODEL,
    });

    return { ok: false, errorMessage };
  }
}

export const storyExemplarGenerationFlow = ai.defineFlow(
  {
    name: 'storyExemplarGenerationFlow',
    inputSchema: StoryExemplarGenerationFlowInputSchema,
    outputSchema: StoryExemplarGenerationFlowOutputSchema,
  },
  async ({ storyId, storybookId }) => {
    console.log(`[story-exemplar-generation-flow] Starting for storyId=${storyId}, storybookId=${storybookId}`);

    try {
      await initFirebaseAdminApp();
      const firestore = getFirestore();

      // Load story to get actors list
      const storyRef = firestore.collection('stories').doc(storyId);
      const storySnap = await storyRef.get();
      if (!storySnap.exists) {
        return { ok: false, errorMessage: `Story ${storyId} not found` };
      }
      const story = storySnap.data() as Story;

      // Load storybook to get imageStylePrompt and imageStyleId
      const storybookRef = storyRef.collection('storybooks').doc(storybookId);
      const storybookSnap = await storybookRef.get();
      if (!storybookSnap.exists) {
        return { ok: false, errorMessage: `Storybook ${storybookId} not found` };
      }
      const storybook = storybookSnap.data()!;
      const imageStylePrompt = storybook.imageStylePrompt;
      const imageStyleId = storybook.imageStyleId;

      if (!imageStylePrompt) {
        return { ok: false, errorMessage: 'Storybook has no imageStylePrompt' };
      }

      // Load style example images from imageStyles collection
      // These are critical for getting the AI to match the target art style
      let styleExampleUrls: string[] = [];
      if (imageStyleId && typeof imageStyleId === 'string' && imageStyleId.trim().length > 0) {
        try {
          const styleSnap = await firestore.collection('imageStyles').doc(imageStyleId).get();
          if (styleSnap.exists) {
            const styleData = styleSnap.data() as ImageStyle;
            if (styleData.exampleImages && styleData.exampleImages.length > 0) {
              // Use manually uploaded example images
              styleExampleUrls = styleData.exampleImages.map(img => img.url);
              console.log(`[story-exemplar-generation-flow] Loaded ${styleExampleUrls.length} style example images from ${imageStyleId}`);
            } else if (styleData.sampleImageUrl) {
              // Fall back to the generated sample image
              styleExampleUrls = [styleData.sampleImageUrl];
              console.log(`[story-exemplar-generation-flow] Using generated sample image as style reference for ${imageStyleId}`);
            }
          }
        } catch (styleError: any) {
          console.warn(`[story-exemplar-generation-flow] Failed to load style ${imageStyleId}: ${styleError?.message}`);
        }
      }

      // Get actor IDs from story
      const actorIds = story.actors || [];
      // Always include the main child
      if (story.childId && !actorIds.includes(story.childId)) {
        actorIds.unshift(story.childId);
      }

      if (actorIds.length === 0) {
        console.log('[story-exemplar-generation-flow] No actors to generate exemplars for');
        await storybookRef.update({
          'exemplarGeneration.status': 'ready',
          'exemplarGeneration.lastCompletedAt': FieldValue.serverTimestamp(),
          'exemplarGeneration.actorsTotal': 0,
          'exemplarGeneration.actorsReady': 0,
          actorExemplarUrls: {},
          updatedAt: FieldValue.serverTimestamp(),
        });
        return { ok: true, actorExemplarUrls: {} };
      }

      // Update status to running
      await storybookRef.update({
        'exemplarGeneration.status': 'running',
        'exemplarGeneration.lastRunAt': FieldValue.serverTimestamp(),
        'exemplarGeneration.lastErrorMessage': null,
        'exemplarGeneration.actorsTotal': actorIds.length,
        'exemplarGeneration.actorsReady': 0,
        updatedAt: FieldValue.serverTimestamp(),
      });

      console.log(`[story-exemplar-generation-flow] Generating exemplars for ${actorIds.length} actor(s): ${actorIds.join(', ')}`);

      // Generate exemplars for all actors in parallel
      const results = await Promise.all(
        actorIds.map(async (actorId) => {
          // Determine if this is a child or character
          const childSnap = await firestore.collection('children').doc(actorId).get();
          if (childSnap.exists) {
            const child = childSnap.data() as ChildProfile;
            return {
              actorId,
              result: await generateExemplarForActor({
                actor: child,
                actorId,
                actorType: 'child',
                imageStylePrompt,
                styleExampleUrls,
                storyId,
                parentUid: story.parentUid,
              }),
            };
          }

          const charSnap = await firestore.collection('characters').doc(actorId).get();
          if (charSnap.exists) {
            const character = charSnap.data() as Character;
            return {
              actorId,
              result: await generateExemplarForActor({
                actor: character,
                actorId,
                actorType: 'character',
                imageStylePrompt,
                styleExampleUrls,
                storyId,
                parentUid: story.parentUid,
              }),
            };
          }

          console.warn(`[story-exemplar-generation-flow] Actor ${actorId} not found in children or characters`);
          return { actorId, result: { ok: false as const, errorMessage: 'Actor not found' } };
        })
      );

      // Build the actorId -> imageUrl mapping (only successful ones)
      const actorExemplarUrls: Record<string, string> = {};
      let successCount = 0;
      let failCount = 0;

      for (const { actorId, result } of results) {
        if (result.ok) {
          actorExemplarUrls[actorId] = result.imageUrl;
          successCount++;
        } else {
          failCount++;
          console.warn(`[story-exemplar-generation-flow] Failed for ${actorId}: ${result.errorMessage}`);
        }
      }

      // Update storybook with results
      const finalStatus = failCount === actorIds.length ? 'error' : 'ready';
      await storybookRef.update({
        'exemplarGeneration.status': finalStatus,
        'exemplarGeneration.lastCompletedAt': FieldValue.serverTimestamp(),
        'exemplarGeneration.actorsReady': successCount,
        'exemplarGeneration.lastErrorMessage': failCount > 0 ? `${failCount} of ${actorIds.length} exemplars failed` : null,
        actorExemplarUrls,
        updatedAt: FieldValue.serverTimestamp(),
      });

      console.log(`[story-exemplar-generation-flow] Completed: ${successCount} success, ${failCount} failed`);

      return { ok: true, actorExemplarUrls };

    } catch (error: any) {
      const errorMessage = error?.message ?? 'Unknown error';
      console.error('[story-exemplar-generation-flow] Error:', errorMessage);
      return { ok: false, errorMessage };
    }
  }
);
