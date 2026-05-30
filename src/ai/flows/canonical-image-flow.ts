'use server';

/**
 * @fileOverview Generates a clean naturalistic portrait of a child or character from their
 * uploaded photos. This is Stage 1 of the two-stage reference image pipeline:
 *
 *   Stage 1 (this flow): raw photos → canonicalImageUrl (naturalistic portrait, style-agnostic)
 *   Stage 2 (actor-exemplar-flow): canonicalImageUrl → style exemplar (character sheet in book style)
 *
 * The canonical is computed once per entity per photo update and reused across all storybooks.
 */

import { ai } from '@/ai/genkit';
import { initFirebaseAdminApp } from '@/firebase/admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { z } from 'genkit';
import type { ChildProfile, Character } from '@/lib/types';
import { getStoryBucket } from '@/firebase/admin/storage';
import { randomUUID } from 'crypto';
import { logAIFlow } from '@/lib/ai-flow-logger';
import { Gaxios, GaxiosError } from 'gaxios';
import { getImageGenerationModel } from '@/lib/ai-model-config';

const FALLBACK_IMAGE_MODEL = 'googleai/gemini-2.5-flash-image';

const CanonicalImageFlowInputSchema = z.object({
  entityId: z.string(),
  entityType: z.enum(['child', 'character']),
});

export type CanonicalImageFlowInput = z.infer<typeof CanonicalImageFlowInputSchema>;

const CanonicalImageFlowOutputSchema = z.object({
  ok: z.boolean(),
  canonicalImageUrl: z.string().optional(),
  errorMessage: z.string().optional(),
});

export type CanonicalImageFlowOutput = z.infer<typeof CanonicalImageFlowOutputSchema>;

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
      console.error(`[canonical-image-flow] Gaxios error fetching ${url}: ${error.message}`);
    } else {
      console.error(`[canonical-image-flow] Error fetching ${url}:`, error);
    }
    return null;
  }
}

function parseDataUrl(dataUrl: string): { mimeType: string; buffer: Buffer } {
  const match = /^data:(.+);base64,(.*)$/i.exec(dataUrl);
  if (match) {
    return { mimeType: match[1], buffer: Buffer.from(match[2], 'base64') };
  }
  // Raw base64 fallback
  const buf = Buffer.from(dataUrl.trim(), 'base64');
  if (buf[0] === 0x89 && buf[1] === 0x50) return { mimeType: 'image/png', buffer: buf };
  if (buf[0] === 0xFF && buf[1] === 0xD8) return { mimeType: 'image/jpeg', buffer: buf };
  return { mimeType: 'image/png', buffer: buf };
}

async function uploadCanonicalToStorage(params: {
  buffer: Buffer;
  mimeType: string;
  entityId: string;
  ownerParentUid: string;
}): Promise<{ imageUrl: string; storagePath: string }> {
  const bucket = await getStoryBucket();
  const extension = params.mimeType === 'image/png' ? 'png' : 'jpg';
  const storagePath = `canonicals/${params.ownerParentUid}/${params.entityId}/portrait.${extension}`;
  const downloadToken = randomUUID();

  await bucket.file(storagePath).save(params.buffer, {
    contentType: params.mimeType,
    resumable: false,
    metadata: {
      cacheControl: 'public,max-age=3600',
      metadata: {
        ownerParentUid: params.ownerParentUid,
        entityId: params.entityId,
        firebaseStorageDownloadTokens: downloadToken,
      },
    },
  });

  const imageUrl = `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(storagePath)}?alt=media&token=${downloadToken}`;
  return { imageUrl, storagePath };
}

function buildCanonicalPrompt(entity: ChildProfile | Character, entityType: 'child' | 'character'): string {
  const displayName = entity.displayName || 'the subject';
  const imageDescription = entity.imageDescription || '';
  const description = entity.description || '';

  const contextParts: string[] = [];
  if (imageDescription) contextParts.push(`Known appearance: ${imageDescription}`);
  if (description) contextParts.push(`Description: ${description}`);
  const context = contextParts.length > 0 ? `\n\n${contextParts.join('\n')}` : '';

  const subjectLabel = entityType === 'child'
    ? 'child'
    : ('type' in entity ? (entity as Character).type.toLowerCase() : 'character');

  return `Create a clean, naturalistic portrait of ${displayName} (a ${subjectLabel}) based on the reference photos provided.${context}

Requirements:
1. PORTRAIT STYLE: Photorealistic or clean naturalistic rendering — no cartoon, no art style, no painterly effects
2. LIKENESS: Accurately reproduce the subject's appearance from the photos — hair color/style, eye color, skin tone, distinctive features
3. POSE: Front-facing or slight 3/4 view; shoulders and face clearly visible; friendly expression
4. BACKGROUND: Plain white or very light neutral background — no scenery, no props
5. LIGHTING: Soft, even, flattering light — no harsh shadows
6. QUALITY: High detail on facial features — this image will be used as a reference for character consistency across illustrated storybooks

This is a reference portrait used for downstream AI image generation. Accuracy of likeness is the highest priority.`;
}

export const canonicalImageFlow = ai.defineFlow(
  {
    name: 'canonicalImageFlow',
    inputSchema: CanonicalImageFlowInputSchema,
    outputSchema: CanonicalImageFlowOutputSchema,
  },
  async ({ entityId, entityType }) => {
    const startTime = Date.now();

    try {
      await initFirebaseAdminApp();
      const firestore = getFirestore();
      const imageModel = await getImageGenerationModel().catch(() => FALLBACK_IMAGE_MODEL);

      const collectionName = entityType === 'child' ? 'children' : 'characters';
      const entityRef = firestore.collection(collectionName).doc(entityId);
      let entitySnap = await entityRef.get();

      if (!entitySnap.exists) {
        throw new Error(`${entityType} ${entityId} not found`);
      }

      let entity = entitySnap.data() as ChildProfile | Character;
      let photoUrls = entity.photos || [];

      // Wait and re-read if no photos — guards against race with photo upload
      if (photoUrls.length === 0) {
        await new Promise(resolve => setTimeout(resolve, 1000));
        entitySnap = await entityRef.get();
        if (entitySnap.exists) {
          entity = entitySnap.data() as ChildProfile | Character;
          photoUrls = entity.photos || [];
        }
      }

      if (photoUrls.length === 0) {
        await entityRef.update({
          canonicalImageUrl: FieldValue.delete(),
          'canonicalImageGeneration.status': 'idle',
          'canonicalImageGeneration.lastCompletedAt': FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        });
        await logAIFlow({
          flowName: 'canonicalImageFlow:noPhotos',
          sessionId: entityId,
          parentId: entity.ownerParentUid,
          prompt: `No photos for ${entityType} ${entityId} — skipping canonical generation`,
          response: { text: '', finishReason: 'SKIPPED', model: 'none' },
          startTime,
        });
        return { ok: true };
      }

      await entityRef.update({
        'canonicalImageGeneration.status': 'generating',
        'canonicalImageGeneration.lastRunAt': FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });

      // Fetch up to 5 photos as data URIs
      const photoParts = (await Promise.all(
        photoUrls.slice(0, 5).map(async (url) => {
          const dataUri = await fetchImageAsDataUri(url);
          return dataUri ? { media: { url: dataUri } } : null;
        })
      )).filter((p): p is { media: { url: string } } => p !== null);

      if (photoParts.length === 0) {
        await entityRef.update({
          'canonicalImageGeneration.status': 'error',
          'canonicalImageGeneration.lastErrorMessage': 'Failed to fetch any photos',
          updatedAt: FieldValue.serverTimestamp(),
        });
        return { ok: false, errorMessage: 'Failed to fetch any photos for canonical generation' };
      }

      const promptText = buildCanonicalPrompt(entity, entityType);
      const promptParts: any[] = [...photoParts, { text: promptText }];

      const llmResponse = await ai.generate({
        model: imageModel,
        prompt: promptParts,
        config: {
          responseModalities: ['TEXT', 'IMAGE'],
          imageConfig: { aspectRatio: '1:1' },
        },
      });

      await logAIFlow({
        flowName: 'canonicalImageFlow',
        sessionId: entityId,
        parentId: entity.ownerParentUid,
        prompt: `Canonical portrait for ${entityType} with ${photoParts.length} photo(s)`,
        response: llmResponse,
        startTime,
        modelName: imageModel,
      });

      const mediaUrl = llmResponse.media?.url;
      if (!mediaUrl) {
        const reason = `No image returned. finishReason=${llmResponse.finishReason}, text=${llmResponse.text?.substring(0, 200) || 'none'}`;
        await entityRef.update({
          'canonicalImageGeneration.status': 'error',
          'canonicalImageGeneration.lastErrorMessage': reason,
          updatedAt: FieldValue.serverTimestamp(),
        });
        return { ok: false, errorMessage: reason };
      }

      const { mimeType, buffer } = parseDataUrl(mediaUrl);
      const { imageUrl } = await uploadCanonicalToStorage({
        buffer,
        mimeType,
        entityId,
        ownerParentUid: entity.ownerParentUid,
      });

      await entityRef.update({
        canonicalImageUrl: imageUrl,
        'canonicalImageGeneration.status': 'ready',
        'canonicalImageGeneration.lastCompletedAt': FieldValue.serverTimestamp(),
        'canonicalImageGeneration.lastErrorMessage': null,
        updatedAt: FieldValue.serverTimestamp(),
      });

      return { ok: true, canonicalImageUrl: imageUrl };

    } catch (e: any) {
      console.error(`[canonicalImageFlow] Error for ${entityType} ${entityId}:`, e?.message ?? e);

      try {
        await initFirebaseAdminApp();
        const firestore = getFirestore();
        const collectionName = entityType === 'child' ? 'children' : 'characters';
        await firestore.collection(collectionName).doc(entityId).update({
          'canonicalImageGeneration.status': 'error',
          'canonicalImageGeneration.lastErrorMessage': e?.message || 'Unknown error',
          updatedAt: FieldValue.serverTimestamp(),
        });
      } catch (_) { /* best effort */ }

      return { ok: false, errorMessage: e?.message || 'Unknown error' };
    }
  }
);
