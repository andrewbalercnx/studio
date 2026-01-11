'use server';

/**
 * @fileOverview A Genkit flow to generate exemplar character reference sheets.
 * Creates a single image showing front, side, and back views of a character
 * in a specific art style for consistent character depiction across storybook pages.
 */

import { ai } from '@/ai/genkit';
import { initFirebaseAdminApp } from '@/firebase/admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { z } from 'genkit';
import type { Character, ChildProfile, ImageStyle, ActorExemplar } from '@/lib/types';
import { getStoryBucket } from '@/firebase/admin/storage';
import { randomUUID } from 'crypto';
import { logAIFlow } from '@/lib/ai-flow-logger';
import { Gaxios, GaxiosError } from 'gaxios';

const DEFAULT_IMAGE_MODEL = process.env.STORYBOOK_IMAGE_MODEL ?? 'googleai/gemini-2.5-flash-image-preview';

// Exemplar images are landscape format to fit 3 views side by side
const EXEMPLAR_WIDTH_PX = 2400;
const EXEMPLAR_HEIGHT_PX = 1200;
const EXEMPLAR_ASPECT_RATIO = '2:1';

const ActorExemplarFlowInputSchema = z.object({
  actorId: z.string(),
  actorType: z.enum(['child', 'character']),
  imageStyleId: z.string(),
  imageStylePrompt: z.string(),
  ownerParentUid: z.string(),
  storybookId: z.string().optional(), // Optional: track which storybook is using this
});

export type ActorExemplarFlowInput = z.infer<typeof ActorExemplarFlowInputSchema>;

const ActorExemplarFlowOutputSchema = z.object({
  ok: z.literal(true),
  exemplarId: z.string(),
  imageUrl: z.string(),
}).or(z.object({
  ok: z.literal(false),
  exemplarId: z.string().optional(),
  errorMessage: z.string(),
}));

export type ActorExemplarFlowOutput = z.infer<typeof ActorExemplarFlowOutputSchema>;

/**
 * Validate that a value is a valid Firestore document ID.
 */
function isValidDocumentId(id: unknown): id is string {
  return typeof id === 'string' && id.trim().length > 0;
}

async function fetchImageAsDataUri(url: string): Promise<string | null> {
  if (!url || typeof url !== 'string') {
    console.error(`[actor-exemplar-flow] Invalid URL provided: ${url}`);
    return null;
  }

  try {
    const gaxios = new Gaxios();
    const urlObject = new URL(url);
    if (process.env.GEMINI_API_KEY) {
      urlObject.searchParams.append('key', process.env.GEMINI_API_KEY);
    }
    const finalUrl = urlObject.toString();

    const response = await gaxios.request<ArrayBuffer>({
      url: finalUrl,
      responseType: 'arraybuffer',
    });

    if (response.status !== 200 || !response.data) {
      console.warn(`[actor-exemplar-flow] Failed to fetch image ${finalUrl}, status: ${response.status}`);
      return null;
    }

    const mimeType = response.headers['content-type'] || 'image/jpeg';
    const buffer = Buffer.from(response.data);
    return `data:${mimeType};base64,${buffer.toString('base64')}`;
  } catch (error) {
    if (error instanceof GaxiosError) {
      console.error(`[actor-exemplar-flow] Gaxios error fetching ${url}: ${error.message}`);
    } else if (error instanceof TypeError && error.message.includes('Invalid URL')) {
      console.error(`[actor-exemplar-flow] Invalid URL provided: ${url}`);
    } else {
      console.error(`[actor-exemplar-flow] Unexpected error fetching ${url}:`, error);
    }
    return null;
  }
}

function parseDataUrl(dataUrl: string): { mimeType: string; buffer: Buffer } {
  // Handle standard data URL format
  const match = /^data:(.+);base64,(.*)$/i.exec(dataUrl);
  if (match) {
    return {
      mimeType: match[1],
      buffer: Buffer.from(match[2], 'base64'),
    };
  }

  // Handle raw base64 (detect by magic bytes)
  const base64Pattern = /^[A-Za-z0-9+/=]+$/;
  const trimmedUrl = dataUrl.trim();
  if (trimmedUrl.length > 100 && base64Pattern.test(trimmedUrl.substring(0, 100))) {
    const buffer = Buffer.from(trimmedUrl, 'base64');
    // Check for PNG magic bytes
    if (buffer.length > 8 && buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4E && buffer[3] === 0x47) {
      return { mimeType: 'image/png', buffer };
    }
    // Check for JPEG magic bytes
    if (buffer.length > 3 && buffer[0] === 0xFF && buffer[1] === 0xD8 && buffer[2] === 0xFF) {
      return { mimeType: 'image/jpeg', buffer };
    }
    // Default to PNG
    if (buffer.length > 1000) {
      return { mimeType: 'image/png', buffer };
    }
  }

  throw new Error('Model returned an invalid media payload - not a valid data URL or raw base64.');
}

async function uploadExemplarToStorage(params: {
  buffer: Buffer;
  mimeType: string;
  exemplarId: string;
  ownerParentUid: string;
}): Promise<{ imageUrl: string; storagePath: string }> {
  const bucket = await getStoryBucket();
  const extension = params.mimeType === 'image/png' ? 'png' : params.mimeType === 'image/jpeg' ? 'jpg' : 'png';
  const storagePath = `exemplars/${params.ownerParentUid}/${params.exemplarId}/image.${extension}`;
  const downloadToken = randomUUID();

  await bucket.file(storagePath).save(params.buffer, {
    contentType: params.mimeType,
    resumable: false,
    metadata: {
      cacheControl: 'public,max-age=3600',
      metadata: {
        ownerParentUid: params.ownerParentUid,
        exemplarId: params.exemplarId,
        firebaseStorageDownloadTokens: downloadToken,
      },
    },
  });

  const imageUrl = `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(storagePath)}?alt=media&token=${downloadToken}`;
  return { imageUrl, storagePath };
}

/**
 * Load actor data (child or character) from Firestore
 */
async function loadActorData(
  firestore: FirebaseFirestore.Firestore,
  actorId: string,
  actorType: 'child' | 'character'
): Promise<{ actor: Character | ChildProfile; parentUid: string }> {
  const collection = actorType === 'child' ? 'children' : 'characters';
  const actorSnap = await firestore.collection(collection).doc(actorId).get();

  if (!actorSnap.exists) {
    throw new Error(`${actorType} with id ${actorId} not found.`);
  }

  const actor = actorSnap.data() as Character | ChildProfile;
  return { actor, parentUid: actor.ownerParentUid };
}

/**
 * Load style example images from the imageStyles collection
 */
async function loadStyleExamples(
  firestore: FirebaseFirestore.Firestore,
  imageStyleId: string
): Promise<string[]> {
  if (!isValidDocumentId(imageStyleId)) {
    return [];
  }

  try {
    const styleSnap = await firestore.collection('imageStyles').doc(imageStyleId).get();
    if (!styleSnap.exists) {
      console.warn(`[actor-exemplar-flow] Style ${imageStyleId} not found`);
      return [];
    }

    const styleData = styleSnap.data() as ImageStyle;
    if (styleData.exampleImages && styleData.exampleImages.length > 0) {
      return styleData.exampleImages.map(img => img.url);
    }
    if (styleData.sampleImageUrl) {
      return [styleData.sampleImageUrl];
    }
    return [];
  } catch (error: any) {
    console.error(`[actor-exemplar-flow] Failed to load style ${imageStyleId}:`, error?.message ?? error);
    return [];
  }
}

/**
 * Build the prompt for exemplar generation
 */
function buildExemplarPrompt(
  actor: Character | ChildProfile,
  imageStylePrompt: string,
  actorType: 'child' | 'character'
): string {
  const displayName = actor.displayName || 'the character';
  const pronouns = actor.pronouns || 'they/them';
  const imageDescription = actor.imageDescription || '';
  const description = actor.description || '';

  // Build appearance context
  const appearanceParts: string[] = [];
  if (imageDescription) {
    appearanceParts.push(`Physical appearance: ${imageDescription}`);
  }
  if (description) {
    appearanceParts.push(`Description: ${description}`);
  }
  if (actor.likes?.length) {
    appearanceParts.push(`Likes: ${actor.likes.join(', ')}`);
  }
  const appearanceContext = appearanceParts.length > 0
    ? `\n\n${appearanceParts.join('\n')}`
    : '';

  // Check if it's a character with a type
  const characterType = actorType === 'character' && 'type' in actor
    ? (actor as Character).type
    : null;
  const typeContext = characterType ? ` (${characterType.toLowerCase()})` : '';

  return `Create a character reference sheet for a children's storybook character.

Art Style: ${imageStylePrompt}

IMPORTANT: Use the provided style example images to match the artistic style exactly. The character sheet should look like it belongs in the same book as the style examples.

Character to depict: ${displayName}${typeContext}
Pronouns: ${pronouns}${appearanceContext}

Requirements:
1. Show THREE views of the character arranged horizontally:
   - LEFT: Front view (facing the viewer directly)
   - CENTER: 3/4 view (turned slightly, showing depth)
   - RIGHT: Back view (facing away from viewer)
2. Use a plain WHITE background - no scenery, no props
3. Character should be full body (head to feet visible in all three views)
4. All three views MUST show the SAME character with IDENTICAL:
   - Clothing and accessories
   - Hair style and color
   - Body proportions
   - Art style matching the examples
5. The poses should be simple standing poses - neutral, not action poses
6. Make the character friendly and appealing to young children
7. Leave adequate spacing between the three views

This is a reference sheet for character consistency across multiple story illustrations, NOT a story scene.`;
}

export const actorExemplarFlow = ai.defineFlow(
  {
    name: 'actorExemplarFlow',
    inputSchema: ActorExemplarFlowInputSchema,
    outputSchema: ActorExemplarFlowOutputSchema,
  },
  async ({ actorId, actorType, imageStyleId, imageStylePrompt, ownerParentUid, storybookId }) => {
    const startTime = Date.now();
    let exemplarId: string | undefined;
    let promptTextForLogging: string = `Exemplar generation for ${actorType} ${actorId}`;

    try {
      await initFirebaseAdminApp();
      const firestore = getFirestore();

      // Check if an exemplar already exists for this actor + style combination
      const existingQuery = await firestore
        .collection('exemplars')
        .where('actorId', '==', actorId)
        .where('imageStyleId', '==', imageStyleId)
        .where('status', '==', 'ready')
        .limit(1)
        .get();

      if (!existingQuery.empty) {
        const existing = existingQuery.docs[0];
        const existingData = existing.data() as ActorExemplar;
        console.log(`[actor-exemplar-flow] Found existing exemplar ${existing.id} for actor ${actorId}`);

        // Optionally track storybook usage
        if (storybookId && !existingData.usedByStorybookIds?.includes(storybookId)) {
          await existing.ref.update({
            usedByStorybookIds: FieldValue.arrayUnion(storybookId),
            updatedAt: FieldValue.serverTimestamp(),
          });
        }

        return {
          ok: true as const,
          exemplarId: existing.id,
          imageUrl: existingData.imageUrl!,
        };
      }

      // Create exemplar document in pending state
      const exemplarRef = firestore.collection('exemplars').doc();
      exemplarId = exemplarRef.id;

      await exemplarRef.set({
        actorId,
        actorType,
        imageStyleId,
        status: 'generating',
        ownerParentUid,
        usedByStorybookIds: storybookId ? [storybookId] : [],
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });

      // Load actor data
      const { actor } = await loadActorData(firestore, actorId, actorType);
      console.log(`[actor-exemplar-flow] Loaded ${actorType} ${actorId}: ${actor.displayName}`);

      // Load style examples
      const styleExampleUrls = await loadStyleExamples(firestore, imageStyleId);
      console.log(`[actor-exemplar-flow] Loaded ${styleExampleUrls.length} style examples for ${imageStyleId}`);

      // Collect reference photos from actor (avatar + photos)
      const referencePhotoUrls: string[] = [];
      if (actor.avatarUrl) {
        referencePhotoUrls.push(actor.avatarUrl);
      }
      if (actor.photos?.length) {
        referencePhotoUrls.push(...actor.photos.slice(0, 3));
      }
      console.log(`[actor-exemplar-flow] Collected ${referencePhotoUrls.length} reference photos`);

      // Convert all images to data URIs
      const styleExampleParts = (await Promise.all(
        styleExampleUrls.map(async (url) => {
          const dataUri = await fetchImageAsDataUri(url);
          return dataUri ? { media: { url: dataUri } } : null;
        })
      )).filter((part): part is { media: { url: string } } => part !== null);

      const referencePhotoParts = (await Promise.all(
        referencePhotoUrls.map(async (url) => {
          const dataUri = await fetchImageAsDataUri(url);
          return dataUri ? { media: { url: dataUri } } : null;
        })
      )).filter((part): part is { media: { url: string } } => part !== null);

      // Build the prompt
      const promptText = buildExemplarPrompt(actor, imageStylePrompt, actorType);
      promptTextForLogging = `${promptText} [${styleExampleParts.length} style examples, ${referencePhotoParts.length} reference photos]`;

      // Construct prompt parts: style examples first, then reference photos, then text
      const promptParts: any[] = [
        ...styleExampleParts,
        ...referencePhotoParts,
        { text: promptText },
      ];

      console.log(`[actor-exemplar-flow] Generating exemplar with ${styleExampleParts.length} style examples, ${referencePhotoParts.length} reference photos`);

      // Generate the exemplar image
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
        const reason = llmResponse.finishMessage || llmResponse.text?.substring(0, 200) || 'unknown';
        // Log the failed attempt before throwing
        await logAIFlow({
          flowName: 'actorExemplarFlow',
          sessionId: actorId,
          parentId: ownerParentUid,
          prompt: promptTextForLogging,
          response: llmResponse,
          startTime,
          modelName: DEFAULT_IMAGE_MODEL,
        });
        throw new Error(`Model did not return an image. Reason: ${reason}`);
      }

      // Parse and upload the image
      const { buffer, mimeType } = parseDataUrl(mediaUrl);
      const { imageUrl, storagePath } = await uploadExemplarToStorage({
        buffer,
        mimeType,
        exemplarId,
        ownerParentUid,
      });

      // Log success with the final image URL
      await logAIFlow({
        flowName: 'actorExemplarFlow',
        sessionId: actorId,
        parentId: ownerParentUid,
        prompt: promptTextForLogging,
        response: llmResponse,
        startTime,
        modelName: DEFAULT_IMAGE_MODEL,
        imageUrl,
      });

      // Update exemplar document with success
      await exemplarRef.update({
        status: 'ready',
        imageUrl,
        storagePath,
        updatedAt: FieldValue.serverTimestamp(),
      });

      console.log(`[actor-exemplar-flow] Successfully generated exemplar ${exemplarId} for ${actor.displayName}`);

      return {
        ok: true as const,
        exemplarId,
        imageUrl,
      };
    } catch (error: any) {
      const errorMessage = error?.message ?? 'Unknown error in actorExemplarFlow';
      console.error(`[actor-exemplar-flow] Error generating exemplar for ${actorId}:`, errorMessage);

      await logAIFlow({
        flowName: 'actorExemplarFlow',
        sessionId: actorId,
        parentId: ownerParentUid,
        prompt: promptTextForLogging,
        error,
        startTime,
        modelName: DEFAULT_IMAGE_MODEL,
      });

      // Update exemplar document with error if we created one
      if (exemplarId) {
        try {
          await initFirebaseAdminApp();
          const firestore = getFirestore();
          await firestore.collection('exemplars').doc(exemplarId).update({
            status: 'error',
            lastErrorMessage: errorMessage,
            updatedAt: FieldValue.serverTimestamp(),
          });
        } catch (updateError) {
          console.error('[actor-exemplar-flow] Failed to update exemplar error status:', updateError);
        }
      }

      return {
        ok: false as const,
        exemplarId,
        errorMessage,
      };
    }
  }
);
