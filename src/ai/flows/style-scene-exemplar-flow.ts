'use server';

/**
 * @fileOverview Generates scene-contextual style reference images for an image style.
 *
 * For each of the 4 scene tags (indoor-day, outdoor-day, indoor-night, outdoor-night),
 * this flow generates an illustration in the target art style using the scene's generation
 * prompt. The results are stored under imageStyles/{styleId}.sceneExemplars and in
 * Firebase Storage at sceneExemplars/{styleId}/{tag}/image.{ext}.
 *
 * These scene exemplars are used by story-image-flow as scene-contextual style references,
 * replacing the generic exampleImages when a page's sceneTag is known.
 *
 * Rate limiting: tags within a style are processed sequentially with a 2 s gap to avoid
 * hitting Gemini image API rate limits. The caller is responsible for staggering calls
 * across multiple styles.
 */

import { ai } from '@/ai/genkit';
import { initFirebaseAdminApp } from '@/firebase/admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { z } from 'genkit';
import type { ImageStyle } from '@/lib/types';
import { getStoryBucket } from '@/firebase/admin/storage';
import { randomUUID } from 'crypto';
import { logAIFlow } from '@/lib/ai-flow-logger';
import { Gaxios, GaxiosError } from 'gaxios';
import { getImageGenerationModel } from '@/lib/ai-model-config';
import {
  DEFAULT_SCENE_EXEMPLAR_DEFINITIONS,
  SCENE_EXEMPLAR_TAGS,
  type SceneExemplarDefinition,
} from '@/lib/scene-exemplar-config';

const FALLBACK_IMAGE_MODEL = 'googleai/gemini-2.5-flash-image';
const TAG_DELAY_MS = 2000; // 2 s gap between tags — rate limit headroom

const StyleSceneExemplarFlowInputSchema = z.object({
  styleId: z.string(),
  /** If provided, only generate exemplars for these tags. Defaults to all 4. */
  tags: z.array(z.string()).optional(),
});

export type StyleSceneExemplarFlowInput = z.infer<typeof StyleSceneExemplarFlowInputSchema>;

const StyleSceneExemplarFlowOutputSchema = z.object({
  ok: z.boolean(),
  styleId: z.string(),
  results: z.record(z.string(), z.object({
    ok: z.boolean(),
    imageUrl: z.string().optional(),
    errorMessage: z.string().optional(),
  })),
});

export type StyleSceneExemplarFlowOutput = z.infer<typeof StyleSceneExemplarFlowOutputSchema>;

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
    return `data:${mimeType};base64,${Buffer.from(response.data).toString('base64')}`;
  } catch (error) {
    if (error instanceof GaxiosError) {
      console.error(`[style-scene-exemplar-flow] Gaxios error fetching ${url}: ${error.message}`);
    } else {
      console.error(`[style-scene-exemplar-flow] Error fetching ${url}:`, error);
    }
    return null;
  }
}

function parseDataUrl(dataUrl: string): { mimeType: string; buffer: Buffer } {
  const match = /^data:(.+);base64,(.*)$/i.exec(dataUrl);
  if (match) return { mimeType: match[1], buffer: Buffer.from(match[2], 'base64') };
  const buf = Buffer.from(dataUrl.trim(), 'base64');
  if (buf[0] === 0x89 && buf[1] === 0x50) return { mimeType: 'image/png', buffer: buf };
  if (buf[0] === 0xFF && buf[1] === 0xD8) return { mimeType: 'image/jpeg', buffer: buf };
  return { mimeType: 'image/png', buffer: buf };
}

async function uploadSceneExemplarToStorage(params: {
  buffer: Buffer;
  mimeType: string;
  styleId: string;
  tag: string;
}): Promise<{ imageUrl: string; storagePath: string }> {
  const bucket = await getStoryBucket();
  const extension = params.mimeType === 'image/png' ? 'png' : 'jpg';
  const storagePath = `sceneExemplars/${params.styleId}/${params.tag}/image.${extension}`;
  const downloadToken = randomUUID();

  await bucket.file(storagePath).save(params.buffer, {
    contentType: params.mimeType,
    resumable: false,
    metadata: {
      cacheControl: 'public,max-age=3600',
      metadata: {
        styleId: params.styleId,
        sceneTag: params.tag,
        firebaseStorageDownloadTokens: downloadToken,
      },
    },
  });

  const imageUrl = `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(storagePath)}?alt=media&token=${downloadToken}`;
  return { imageUrl, storagePath };
}

/** Load scene exemplar definitions from Firestore, merging any admin overrides with defaults */
async function loadSceneExemplarDefinitions(
  firestore: FirebaseFirestore.Firestore
): Promise<SceneExemplarDefinition[]> {
  try {
    const configSnap = await firestore.collection('systemConfig').doc('sceneExemplars').get();
    if (!configSnap.exists) return DEFAULT_SCENE_EXEMPLAR_DEFINITIONS;

    const overrides = configSnap.data() as Record<string, Partial<SceneExemplarDefinition>>;
    return DEFAULT_SCENE_EXEMPLAR_DEFINITIONS.map(def => ({
      ...def,
      ...(overrides[def.tag] ?? {}),
    }));
  } catch {
    return DEFAULT_SCENE_EXEMPLAR_DEFINITIONS;
  }
}

async function generateOneTag(params: {
  firestore: FirebaseFirestore.Firestore;
  styleId: string;
  style: ImageStyle;
  definition: SceneExemplarDefinition;
  styleExampleParts: Array<{ media: { url: string } }>;
  imageModel: string;
}): Promise<{ ok: boolean; imageUrl?: string; errorMessage?: string }> {
  const { firestore, styleId, style, definition, styleExampleParts, imageModel } = params;
  const startTime = Date.now();
  const { tag, generationPrompt } = definition;

  // Mark as generating
  await firestore.collection('imageStyles').doc(styleId).update({
    [`sceneExemplars.${tag}.status`]: 'generating',
    [`sceneExemplars.${tag}.generatedAt`]: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });

  const promptText = `${generationPrompt}

Art Style: ${style.stylePrompt}

IMPORTANT: The style example images provided show the target art style. Generate this scene in the EXACT same artistic style — match the line weight, color palette, rendering technique, character proportions, and overall aesthetic from the examples.

This image will be used as a scene-type style reference for AI illustration generation. Accuracy of style match is the highest priority.`;

  const promptParts: any[] = [
    ...styleExampleParts,
    { text: promptText },
  ];

  try {
    const llmResponse = await ai.generate({
      model: imageModel,
      prompt: promptParts,
      config: {
        responseModalities: ['TEXT', 'IMAGE'],
        imageConfig: { aspectRatio: '4:3' },
      },
    });

    await logAIFlow({
      flowName: 'styleSceneExemplarFlow',
      sessionId: styleId,
      parentId: styleId,
      prompt: `Scene exemplar [${tag}] for style "${style.title}"`,
      response: llmResponse,
      startTime,
      modelName: imageModel,
    });

    const mediaUrl = llmResponse.media?.url;
    if (!mediaUrl) {
      const reason = `No image returned. finishReason=${llmResponse.finishReason}, text=${llmResponse.text?.substring(0, 200) || 'none'}`;
      await firestore.collection('imageStyles').doc(styleId).update({
        [`sceneExemplars.${tag}.status`]: 'error',
        [`sceneExemplars.${tag}.errorMessage`]: reason,
        updatedAt: FieldValue.serverTimestamp(),
      });
      return { ok: false, errorMessage: reason };
    }

    const { mimeType, buffer } = parseDataUrl(mediaUrl);
    const { imageUrl, storagePath } = await uploadSceneExemplarToStorage({ buffer, mimeType, styleId, tag });

    await firestore.collection('imageStyles').doc(styleId).update({
      [`sceneExemplars.${tag}.imageUrl`]: imageUrl,
      [`sceneExemplars.${tag}.storagePath`]: storagePath,
      [`sceneExemplars.${tag}.status`]: 'ready',
      [`sceneExemplars.${tag}.errorMessage`]: null,
      [`sceneExemplars.${tag}.generatedAt`]: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });

    return { ok: true, imageUrl };

  } catch (e: any) {
    const msg = e?.message || 'Unknown error';
    console.error(`[style-scene-exemplar-flow] Error generating [${tag}] for style ${styleId}:`, msg);

    await firestore.collection('imageStyles').doc(styleId).update({
      [`sceneExemplars.${tag}.status`]: 'error',
      [`sceneExemplars.${tag}.errorMessage`]: msg,
      updatedAt: FieldValue.serverTimestamp(),
    }).catch(() => {});

    await logAIFlow({
      flowName: 'styleSceneExemplarFlow',
      sessionId: styleId,
      parentId: styleId,
      prompt: `Scene exemplar [${tag}] for style "${style.title}"`,
      error: e,
      startTime,
    });

    return { ok: false, errorMessage: msg };
  }
}

export const styleSceneExemplarFlow = ai.defineFlow(
  {
    name: 'styleSceneExemplarFlow',
    inputSchema: StyleSceneExemplarFlowInputSchema,
    outputSchema: StyleSceneExemplarFlowOutputSchema,
  },
  async ({ styleId, tags }) => {
    try {
      await initFirebaseAdminApp();
      const firestore = getFirestore();
      const imageModel = await getImageGenerationModel().catch(() => FALLBACK_IMAGE_MODEL);

      const styleSnap = await firestore.collection('imageStyles').doc(styleId).get();
      if (!styleSnap.exists) {
        return { ok: false, styleId, results: {}, };
      }
      const style = { id: styleSnap.id, ...styleSnap.data() } as ImageStyle;

      // Load style example images for style reference
      const exampleUrls: string[] = [];
      if (style.exampleImages && style.exampleImages.length > 0) {
        exampleUrls.push(...style.exampleImages.slice(0, 3).map(img => img.url));
      } else if (style.sampleImageUrl) {
        exampleUrls.push(style.sampleImageUrl);
      }

      const styleExampleParts = (await Promise.all(
        exampleUrls.map(async (url) => {
          const dataUri = await fetchImageAsDataUri(url);
          return dataUri ? { media: { url: dataUri } } : null;
        })
      )).filter((p): p is { media: { url: string } } => p !== null);

      if (styleExampleParts.length === 0) {
        return {
          ok: false,
          styleId,
          results: Object.fromEntries(
            SCENE_EXEMPLAR_TAGS.map(t => [t, { ok: false, errorMessage: 'Style has no example images to derive style from' }])
          ),
        };
      }

      const definitions = await loadSceneExemplarDefinitions(firestore);
      const requestedTags = tags && tags.length > 0
        ? tags
        : [...SCENE_EXEMPLAR_TAGS];

      const results: Record<string, { ok: boolean; imageUrl?: string; errorMessage?: string }> = {};

      for (let i = 0; i < requestedTags.length; i++) {
        const tag = requestedTags[i];
        const definition = definitions.find(d => d.tag === tag);
        if (!definition) {
          results[tag] = { ok: false, errorMessage: `Unknown scene tag: ${tag}` };
          continue;
        }

        // Delay between tags to respect rate limits (skip delay for first tag)
        if (i > 0) {
          await new Promise(resolve => setTimeout(resolve, TAG_DELAY_MS));
        }

        results[tag] = await generateOneTag({
          firestore, styleId, style, definition, styleExampleParts, imageModel,
        });
      }

      const allOk = Object.values(results).every(r => r.ok);
      return { ok: allOk, styleId, results };

    } catch (e: any) {
      console.error(`[styleSceneExemplarFlow] Fatal error for style ${styleId}:`, e?.message ?? e);
      return {
        ok: false,
        styleId,
        results: Object.fromEntries(
          SCENE_EXEMPLAR_TAGS.map(t => [t, { ok: false, errorMessage: e?.message || 'Unknown error' }])
        ),
      };
    }
  }
);
