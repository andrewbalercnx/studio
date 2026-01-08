
'use server';

/**
 * @fileOverview A Genkit flow to generate a text description of a child's or character's
 * physical appearance from their photos. This description is used in image generation
 * prompts as a fallback when photos cannot be used directly.
 */

import { ai } from '@/ai/genkit';
import { initFirebaseAdminApp } from '@/firebase/admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { z } from 'genkit';
import type { ChildProfile, Character } from '@/lib/types';
import { Gaxios, GaxiosError } from 'gaxios';
import { logAIFlow } from '@/lib/ai-flow-logger';

const ImageDescriptionFlowInputSchema = z.object({
  entityId: z.string(),
  entityType: z.enum(['child', 'character']),
});

export type ImageDescriptionFlowInput = z.infer<typeof ImageDescriptionFlowInputSchema>;

const ImageDescriptionFlowOutputSchema = z.object({
  imageDescription: z.string().describe('A text description of the entity\'s physical appearance.'),
});

async function fetchImageAsDataUri(url: string): Promise<string | null> {
  if (!url || typeof url !== 'string') {
    console.error(`[image-description-flow] Invalid URL provided: ${url}`);
    return null;
  }

  try {
    const gaxios = new Gaxios();
    // Use URL to correctly handle query parameters
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
      console.warn(`[image-description-flow] Failed to fetch image ${finalUrl}, status: ${response.status}`);
      return null;
    }

    const mimeType = response.headers['content-type'] || 'image/jpeg';
    const buffer = Buffer.from(response.data);
    return `data:${mimeType};base64,${buffer.toString('base64')}`;
  } catch (error) {
    if (error instanceof GaxiosError) {
      console.error(`[image-description-flow] Gaxios error fetching ${url}: ${error.message}. Status: ${error.response?.status}. Data: ${error.response?.data}`);
    } else if (error instanceof TypeError && error.message.includes('Invalid URL')) {
      console.error(`[image-description-flow] Invalid URL provided: ${url}`);
    } else {
      console.error(`[image-description-flow] Unexpected error fetching ${url}:`, error);
    }
    return null;
  }
}

export const imageDescriptionFlow = ai.defineFlow(
  {
    name: 'imageDescriptionFlow',
    inputSchema: ImageDescriptionFlowInputSchema,
    outputSchema: ImageDescriptionFlowOutputSchema,
  },
  async ({ entityId, entityType }) => {
    await initFirebaseAdminApp();
    const firestore = getFirestore();

    const collectionName = entityType === 'child' ? 'children' : 'characters';
    const entityRef = firestore.collection(collectionName).doc(entityId);
    const entitySnap = await entityRef.get();

    if (!entitySnap.exists) {
      throw new Error(`${entityType} with id ${entityId} not found.`);
    }

    let entity = entitySnap.data() as ChildProfile | Character;
    let photoUrls = entity.photos || [];

    console.log(`[imageDescriptionFlow] Starting for ${entityType} ${entityId}, found ${photoUrls.length} photos`);

    // If no photos found, wait briefly and re-read in case of race condition
    // (e.g., photo upload just happened but document not yet updated in our read)
    if (photoUrls.length === 0) {
      console.log(`[imageDescriptionFlow] No photos found, waiting 1s and re-reading...`);
      await new Promise(resolve => setTimeout(resolve, 1000));
      const freshSnap = await entityRef.get();
      if (freshSnap.exists) {
        entity = freshSnap.data() as ChildProfile | Character;
        photoUrls = entity.photos || [];
        console.log(`[imageDescriptionFlow] After re-read: ${photoUrls.length} photos`);
      }
    }

    if (photoUrls.length === 0) {
      // No photos to analyze - clear any existing description
      console.log(`[imageDescriptionFlow] No photos to analyze, clearing imageDescription`);
      await entityRef.update({
        imageDescription: FieldValue.delete(),
        'imageDescriptionGeneration.status': 'idle',
        'imageDescriptionGeneration.lastCompletedAt': FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
      // Log the early exit so it appears in aiFlowLogs
      await logAIFlow({
        flowName: 'imageDescriptionFlow:noPhotos',
        sessionId: entityId,
        parentId: entity.ownerParentUid,
        prompt: `No photos found for ${entityType} - skipping image description generation`,
        response: { text: '', finishReason: 'SKIPPED', model: 'none' },
        startTime: Date.now(),
      });
      return { imageDescription: '' };
    }

    // Update status to generating
    await entityRef.update({
      'imageDescriptionGeneration.status': 'generating',
      'imageDescriptionGeneration.lastRunAt': FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });

    // Fetch up to 3 photos and convert them to data URIs
    const imageParts = (
      await Promise.all(
        photoUrls.slice(0, 3).map(async (url) => {
          const dataUri = await fetchImageAsDataUri(url);
          return dataUri ? { media: { url: dataUri } } : null;
        })
      )
    ).filter((part): part is { media: { url: string } } => part !== null);

    if (imageParts.length === 0) {
      // Failed to fetch any photos
      await entityRef.update({
        'imageDescriptionGeneration.status': 'error',
        'imageDescriptionGeneration.lastErrorMessage': 'Failed to fetch photos',
        updatedAt: FieldValue.serverTimestamp(),
      });
      throw new Error('Failed to fetch any photos for image description generation.');
    }

    // Build the prompt
    const entityLabel = entityType === 'child' ? 'child' : ('type' in entity ? (entity as Character).type.toLowerCase() : 'character');

    const promptText = `Analyze the provided photo(s) of a ${entityLabel} and generate a concise description of their physical appearance suitable for AI image generation.

Include:
- Hair color and style (e.g., "curly brown hair", "blonde pigtails")
- Eye color (if visible)
- Skin tone
- Approximate age appearance (for children)
- Any distinctive features (glasses, freckles, etc.)

Output 2-3 sentences, approximately 50-100 words. Focus only on visual appearance, not personality. Use neutral, descriptive language suitable for image generation prompts.

Example: "A young child around 5 years old with curly brown hair and bright blue eyes. Fair skin with a few freckles across the nose. Often seen with a cheerful expression."`;

    const promptParts = [
      ...imageParts,
      { text: promptText },
    ];

    let llmResponse;
    const startTime = Date.now();
    const modelName = 'googleai/gemini-2.5-flash';

    try {
      llmResponse = await ai.generate({
        model: modelName,
        prompt: promptParts,
      });
      await logAIFlow({
        flowName: 'imageDescriptionFlow',
        sessionId: entityId,
        parentId: entity.ownerParentUid,
        prompt: `Image description generation for ${entityType} with ${imageParts.length} photo(s)`,
        response: llmResponse,
        startTime,
        modelName,
      });
    } catch (e: any) {
      await logAIFlow({
        flowName: 'imageDescriptionFlow',
        sessionId: entityId,
        parentId: entity.ownerParentUid,
        prompt: `Image description generation for ${entityType} with ${imageParts.length} photo(s)`,
        error: e,
        startTime,
        modelName,
      });

      // Update status to error
      await entityRef.update({
        'imageDescriptionGeneration.status': 'error',
        'imageDescriptionGeneration.lastErrorMessage': e.message || 'Unknown error',
        updatedAt: FieldValue.serverTimestamp(),
      });
      throw e;
    }

    const imageDescription = llmResponse.text?.trim() || '';

    if (!imageDescription) {
      await entityRef.update({
        'imageDescriptionGeneration.status': 'error',
        'imageDescriptionGeneration.lastErrorMessage': 'Model did not return a description',
        updatedAt: FieldValue.serverTimestamp(),
      });
      throw new Error('The model did not return an image description.');
    }

    // Save the description
    await entityRef.update({
      imageDescription,
      'imageDescriptionGeneration.status': 'ready',
      'imageDescriptionGeneration.lastCompletedAt': FieldValue.serverTimestamp(),
      'imageDescriptionGeneration.lastErrorMessage': null,
      updatedAt: FieldValue.serverTimestamp(),
    });

    return { imageDescription };
  }
);
