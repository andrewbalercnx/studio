
'use server';

/**
 * @fileOverview A Genkit flow to generate a dancing animation from an avatar image.
 * Uses Google's video generation capabilities (Veo 2) when available.
 * Can be triggered for both children and characters after their avatar is created.
 */

import { ai } from '@/ai/genkit';
import { FieldValue } from 'firebase-admin/firestore';
import { getServerFirestore } from '@/lib/server-firestore';
import { z } from 'genkit';
import type { ChildProfile, Character } from '@/lib/types';
import { getStoryBucket } from '@/firebase/admin/storage';
import { randomUUID } from 'crypto';
import { logAIFlow } from '@/lib/ai-flow-logger';
import { Gaxios } from 'gaxios';

const AvatarAnimationFlowInputSchema = z.object({
  // Either childId or characterId must be provided
  childId: z.string().optional(),
  characterId: z.string().optional(),
  // Optional: provide avatar URL directly (otherwise fetched from profile)
  avatarUrl: z.string().optional(),
  forceRegenerate: z.boolean().optional(),
});

export type AvatarAnimationFlowInput = z.infer<typeof AvatarAnimationFlowInputSchema>;

const AvatarAnimationFlowOutputSchema = z.object({
  ok: z.boolean(),
  animationUrl: z.string().optional(),
  // Output type: 'video' for Veo-generated MP4/WebM, 'image' for static dance pose fallback
  outputType: z.enum(['video', 'image']).optional(),
  errorMessage: z.string().optional(),
  // Debug info for diagnosing Veo issues
  debugInfo: z.object({
    veoAttempted: z.boolean().optional(),
    veoError: z.string().optional(),
    veoErrorCode: z.string().optional(),
    veoResponse: z.string().optional(),
    fallbackUsed: z.boolean().optional(),
  }).optional(),
});

export type AvatarAnimationFlowOutput = z.infer<typeof AvatarAnimationFlowOutputSchema>;

async function fetchImageAsDataUri(url: string): Promise<string | null> {
  if (!url || typeof url !== 'string') {
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
      return null;
    }

    const mimeType = response.headers['content-type'] || 'image/jpeg';
    const buffer = Buffer.from(response.data);
    return `data:${mimeType};base64,${buffer.toString('base64')}`;
  } catch (error) {
    console.error(`[avatar-animation-flow] Error fetching image ${url}:`, error);
    return null;
  }
}

async function parseMediaUrl(mediaUrl: string): Promise<{ mimeType: string; buffer: Buffer }> {
  if (!mediaUrl || typeof mediaUrl !== 'string') {
    throw new Error(
      `Model returned invalid media payload: expected string, got ${typeof mediaUrl}. ` +
      `The model may have returned text instead of an image.`
    );
  }

  // Try parsing as a data URL first (standard format: data:image/png;base64,...)
  const match = /^data:(.+);base64,(.*)$/i.exec(mediaUrl);
  if (match) {
    const mimeType = match[1];
    const base64 = match[2];

    if (!base64 || base64.length === 0) {
      throw new Error(
        `Model returned data URL with empty base64 content. MIME type: ${mimeType}.`
      );
    }

    return {
      mimeType,
      buffer: Buffer.from(base64, 'base64'),
    };
  }

  // Check if it's a regular URL (https:// or http://)
  if (mediaUrl.startsWith('https://') || mediaUrl.startsWith('http://')) {
    console.log('[avatar-animation-flow] Model returned URL, fetching image:', mediaUrl.substring(0, 100));
    try {
      const gaxios = new Gaxios();
      const response = await gaxios.request({
        url: mediaUrl,
        responseType: 'arraybuffer',
        timeout: 30000,
      });

      const buffer = Buffer.from(response.data as ArrayBuffer);
      const contentType = response.headers?.['content-type'] as string || 'image/png';
      const mimeType = contentType.split(';')[0].trim();

      return { mimeType, buffer };
    } catch (fetchError: any) {
      throw new Error(`Failed to fetch image from URL: ${fetchError.message}`);
    }
  }

  // Handle case where model returns raw base64 without data URL prefix
  const base64Pattern = /^[A-Za-z0-9+/=]+$/;
  const trimmedUrl = mediaUrl.trim();
  if (trimmedUrl.length > 100 && base64Pattern.test(trimmedUrl.substring(0, 100))) {
    console.log('[avatar-animation-flow] Model returned raw base64, attempting to decode');
    try {
      const buffer = Buffer.from(trimmedUrl, 'base64');
      // Check for PNG magic bytes
      if (buffer.length > 8 && buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4E && buffer[3] === 0x47) {
        return { mimeType: 'image/png', buffer };
      }
      // Check for JPEG magic bytes
      if (buffer.length > 3 && buffer[0] === 0xFF && buffer[1] === 0xD8 && buffer[2] === 0xFF) {
        return { mimeType: 'image/jpeg', buffer };
      }
      // Default to PNG if decoded successfully
      if (buffer.length > 1000) {
        return { mimeType: 'image/png', buffer };
      }
    } catch {
      // Fall through to error
    }
  }

  // The model returned something that doesn't look like an image
  const preview = mediaUrl.length > 200 ? mediaUrl.substring(0, 200) + '...' : mediaUrl;
  throw new Error(
    `The string did not match the expected pattern. ` +
    `The model returned text instead of generating an image. ` +
    `Response preview: "${preview}"`
  );
}

async function uploadAnimationToStorage(params: {
  buffer: Buffer;
  mimeType: string;
  entityType: 'child' | 'character';
  entityId: string;
  parentUid: string;
}): Promise<string> {
  const bucket = await getStoryBucket();
  const extension = params.mimeType.includes('mp4') ? 'mp4'
    : params.mimeType.includes('webm') ? 'webm'
    : params.mimeType.includes('gif') ? 'gif'
    : params.mimeType.includes('png') ? 'png'
    : 'jpg';
  const objectPath = params.entityType === 'child'
    ? `users/${params.parentUid}/children/${params.entityId}/animations/avatar-dance-${Date.now()}.${extension}`
    : `characters/${params.entityId}/animations/avatar-dance-${Date.now()}.${extension}`;
  const downloadToken = randomUUID();

  await bucket.file(objectPath).save(params.buffer, {
    contentType: params.mimeType,
    resumable: false,
    metadata: {
      cacheControl: 'public,max-age=3600',
      metadata: {
        ownerParentUid: params.parentUid,
        entityId: params.entityId,
        entityType: params.entityType,
        firebaseStorageDownloadTokens: downloadToken,
      },
    },
  });

  return `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(objectPath)}?alt=media&token=${downloadToken}`;
}

export const avatarAnimationFlow = ai.defineFlow(
  {
    name: 'avatarAnimationFlow',
    inputSchema: AvatarAnimationFlowInputSchema,
    outputSchema: AvatarAnimationFlowOutputSchema,
  },
  async ({ childId, characterId, avatarUrl: providedAvatarUrl, forceRegenerate }) => {
    const firestore = await getServerFirestore();

    // Validate input - must have either childId or characterId
    if (!childId && !characterId) {
      return { ok: false, errorMessage: 'Either childId or characterId must be provided.' };
    }

    const entityType = childId ? 'child' : 'character';
    const entityId = childId || characterId!;
    const collectionName = childId ? 'children' : 'characters';
    const entityRef = firestore.collection(collectionName).doc(entityId);

    try {
      // Load entity
      const entityDoc = await entityRef.get();
      if (!entityDoc.exists) {
        return { ok: false, errorMessage: `${entityType} ${entityId} not found.` };
      }

      const entity = entityDoc.data() as (ChildProfile | Character);

      // Check if already generated (unless forcing)
      if (!forceRegenerate && entity.avatarAnimationUrl && entity.avatarAnimationGeneration?.status === 'ready') {
        return { ok: true, animationUrl: entity.avatarAnimationUrl };
      }

      // Get avatar URL
      const avatarUrl = providedAvatarUrl || entity.avatarUrl;
      if (!avatarUrl) {
        return { ok: false, errorMessage: `No avatar URL available for ${entityType} ${entityId}. Generate avatar first.` };
      }

      // Mark as generating
      await entityRef.update({
        'avatarAnimationGeneration.status': 'generating',
        'avatarAnimationGeneration.lastRunAt': FieldValue.serverTimestamp(),
      });

      // Fetch avatar image
      const avatarDataUri = await fetchImageAsDataUri(avatarUrl);
      if (!avatarDataUri) {
        throw new Error('Failed to fetch avatar image for animation generation.');
      }

      // Build prompt for video/animation generation
      const promptText = `Create a short, fun dancing animation of this cartoon character.
The character should:
- Do a simple, cute dance move (like swaying side to side, bouncing, or waving)
- Stay in place (no walking or moving across the frame)
- Have smooth, looping animation suitable for a 2-3 second loop
- Maintain the same art style and character appearance
- Look happy and energetic
- Be appropriate for young children

Generate a short animated loop of this character dancing happily.`;

      // Try to generate animation using Veo 2 via Vertex AI or fall back to animated image
      let llmResponse;
      let animationUrl: string;
      const debugInfo: {
        veoAttempted?: boolean;
        veoError?: string;
        veoErrorCode?: string;
        veoResponse?: string;
        fallbackUsed?: boolean;
      } = {};

      // Check if Vertex AI is configured (needed for Veo)
      const gcpProject = process.env.GOOGLE_CLOUD_PROJECT || process.env.GCP_PROJECT_ID;
      const useVeo = !!gcpProject;

      let veoStartTime: number | undefined;
      if (useVeo) {
        console.log('[avatarAnimationFlow] Attempting Veo video generation via Vertex AI');
        debugInfo.veoAttempted = true;
        veoStartTime = Date.now();

        try {
          // Use Veo 2 for video generation via Vertex AI
          // Veo requires async operation handling with polling
          const veoPrompt = `Create a short 5 second looping animation of this cartoon character doing a cute, simple dance.
The character should:
- Sway side to side or bounce gently
- Wave their arms or do a simple dance move
- Look happy and energetic
- Stay in place (no walking)
- Maintain the exact same art style and appearance
- Be appropriate for young children

Output a smooth, looping video suitable for a profile animation.`;

          // Use Vertex AI model for Veo (veo-2.0-generate-exp is the recommended model ID)
          const veoModelName = 'vertexai/veo-2.0-generate-exp';
          const veoResult = await ai.generate({
            model: veoModelName,
            prompt: [
              { media: { url: avatarDataUri } },
              { text: veoPrompt },
            ],
          });

          // Veo returns an operation that needs polling
          let operation = (veoResult as any).operation;

          if (operation) {
            console.log('[avatarAnimationFlow] Veo operation started, polling for completion...');

            // Poll for up to 2 minutes (24 x 5 second intervals)
            const maxPolls = 24;
            for (let i = 0; i < maxPolls && !operation.done; i++) {
              await new Promise((resolve) => setTimeout(resolve, 5000));
              operation = await ai.checkOperation(operation);
              console.log(`[avatarAnimationFlow] Poll ${i + 1}/${maxPolls}, done: ${operation.done}`);
            }

            if (operation.error) {
              throw new Error(`Veo operation failed: ${operation.error.message}`);
            }

            if (!operation.done) {
              throw new Error('Veo operation timed out after 2 minutes');
            }

            // Extract video from completed operation
            const videoContent = operation.output?.message?.content?.find((p: any) => !!p.media);
            if (videoContent?.media?.url) {
              const videoUrl = videoContent.media.url;
              console.log('[avatarAnimationFlow] Veo video URL received');

              await logAIFlow({ flowName: 'avatarAnimationFlow', sessionId: entityId, parentId: entity.ownerParentUid, prompt: veoPrompt, response: { media: { url: videoUrl } }, startTime: veoStartTime, modelName: veoModelName });

              const { buffer, mimeType } = await parseMediaUrl(videoUrl);
              console.log('[avatarAnimationFlow] Veo video buffer size:', buffer.length, 'mimeType:', mimeType);

              animationUrl = await uploadAnimationToStorage({
                buffer,
                mimeType: mimeType.includes('mp4') ? 'video/mp4' : mimeType,
                entityType,
                entityId,
                parentUid: entity.ownerParentUid,
              });

              console.log('[avatarAnimationFlow] Veo video uploaded:', animationUrl);
              debugInfo.veoResponse = 'Video generated successfully';

              // Update entity with generated animation
              await entityRef.update({
                avatarAnimationUrl: animationUrl,
                'avatarAnimationGeneration.status': 'ready',
                'avatarAnimationGeneration.lastCompletedAt': FieldValue.serverTimestamp(),
                'avatarAnimationGeneration.lastErrorMessage': null,
                'avatarAnimationGeneration.generatedWith': 'veo',
                updatedAt: FieldValue.serverTimestamp(),
              });

              return { ok: true, animationUrl, debugInfo };
            }
          }

          // Check for direct media response (non-operation response)
          const directVideoUrl = veoResult.media?.url;
          if (directVideoUrl) {
            console.log('[avatarAnimationFlow] Veo direct response received');
            await logAIFlow({ flowName: 'avatarAnimationFlow', sessionId: entityId, parentId: entity.ownerParentUid, prompt: veoPrompt, response: veoResult, startTime: veoStartTime, modelName: veoModelName });

            const { buffer, mimeType } = await parseMediaUrl(directVideoUrl);
            console.log('[avatarAnimationFlow] Veo video buffer size:', buffer.length, 'mimeType:', mimeType);

            animationUrl = await uploadAnimationToStorage({
              buffer,
              mimeType: mimeType.includes('mp4') ? 'video/mp4' : mimeType,
              entityType,
              entityId,
              parentUid: entity.ownerParentUid,
            });

            console.log('[avatarAnimationFlow] Veo video uploaded:', animationUrl);
            debugInfo.veoResponse = 'Video generated successfully (direct)';

            await entityRef.update({
              avatarAnimationUrl: animationUrl,
              'avatarAnimationGeneration.status': 'ready',
              'avatarAnimationGeneration.lastCompletedAt': FieldValue.serverTimestamp(),
              'avatarAnimationGeneration.lastErrorMessage': null,
              'avatarAnimationGeneration.generatedWith': 'veo',
              updatedAt: FieldValue.serverTimestamp(),
            });

            return { ok: true, animationUrl, debugInfo };
          }

          // If no video in response, fall through to fallback
          console.log('[avatarAnimationFlow] Veo did not return video, falling back to image');
          debugInfo.veoError = 'Veo response did not contain video';
          debugInfo.fallbackUsed = true;

        } catch (veoError: any) {
          console.error('[avatarAnimationFlow] Veo error:', veoError);
          debugInfo.veoError = veoError.message || 'Unknown Veo error';
          debugInfo.veoErrorCode = veoError.code ? String(veoError.code) : undefined;
          debugInfo.fallbackUsed = true;
          // Fall through to fallback image generation
        }
      } else {
        console.log('[avatarAnimationFlow] Vertex AI not configured (no GCP project), using image fallback');
        debugInfo.veoAttempted = false;
        debugInfo.fallbackUsed = true;
        debugInfo.veoError = 'Vertex AI not configured - set GOOGLE_CLOUD_PROJECT environment variable';
      }

      // Fallback: Generate a dance pose image
      console.log('[avatarAnimationFlow] Using image-based animation fallback');

      // Use a more explicit prompt that clearly requests image generation, not description
      const fallbackPrompt = `Generate a new image based on this avatar. Create a fun dancing pose variation:
- Arms raised or moving in a dance gesture
- A happy, energetic expression
- The same art style and character appearance
- A slight bounce or movement feel to the pose
- Keep the same background style

Output the generated image directly. Do not describe what you would create - actually generate and output the image.`;

      const fallbackModelName = 'googleai/gemini-2.5-flash-image-preview';
      console.log('[avatarAnimationFlow] Using fallback model:', fallbackModelName);

      // Retry logic - sometimes the model returns text instead of an image
      const MAX_RETRIES = 2;
      let imageUrl: string | undefined;

      for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        const fallbackStartTime = Date.now();

        if (attempt > 0) {
          console.log(`[avatarAnimationFlow] Retry attempt ${attempt}/${MAX_RETRIES}`);
          await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
        }

        llmResponse = await ai.generate({
          model: fallbackModelName,
          prompt: [
            { media: { url: avatarDataUri } },
            { text: fallbackPrompt },
          ],
          config: {
            responseModalities: ['TEXT', 'IMAGE'],
          },
        });

        console.log('[avatarAnimationFlow] Image response received:', {
          hasMedia: !!llmResponse.media,
          mediaUrl: llmResponse.media?.url ? `${llmResponse.media.url.substring(0, 50)}...` : 'null',
          hasText: !!llmResponse.text,
          textPreview: llmResponse.text?.substring(0, 100),
        });

        await logAIFlow({ flowName: 'avatarAnimationFlow', sessionId: entityId, parentId: entity.ownerParentUid, prompt: fallbackPrompt, response: llmResponse, startTime: fallbackStartTime, modelName: fallbackModelName });

        imageUrl = llmResponse.media?.url;

        // Check if we got an actual image (not just text)
        if (imageUrl && imageUrl.startsWith('data:')) {
          // Successfully got an image
          break;
        }

        // If we got text instead of an image, log and retry
        if (llmResponse.text && !imageUrl) {
          console.warn(`[avatarAnimationFlow] Model returned text instead of image (attempt ${attempt + 1}):`, llmResponse.text.substring(0, 150));
        }

        if (attempt === MAX_RETRIES) {
          console.error('[avatarAnimationFlow] Image generation failed after retries - no media URL. Response keys:', Object.keys(llmResponse));
          const textPreview = llmResponse.text ? llmResponse.text.substring(0, 200) : 'No text returned';
          throw new Error(
            `Failed to generate animation frame image. The model returned text instead of generating an image. ` +
            `Model response: "${textPreview}"`
          );
        }
      }

      if (!imageUrl) {
        throw new Error('Failed to generate animation frame image after retries.');
      }

      console.log('[avatarAnimationFlow] Image URL received, length:', imageUrl.length);
      const { buffer, mimeType } = await parseMediaUrl(imageUrl);
      console.log('[avatarAnimationFlow] Parsed image buffer size:', buffer.length, 'mimeType:', mimeType);

      // Store as a static dance pose
      animationUrl = await uploadAnimationToStorage({
        buffer,
        mimeType: 'image/png',
        entityType,
        entityId,
        parentUid: entity.ownerParentUid,
      });

      console.log('[avatarAnimationFlow] Dance pose image uploaded:', animationUrl);

      // Update entity with generated animation
      await entityRef.update({
        avatarAnimationUrl: animationUrl,
        'avatarAnimationGeneration.status': 'ready',
        'avatarAnimationGeneration.lastCompletedAt': FieldValue.serverTimestamp(),
        'avatarAnimationGeneration.lastErrorMessage': null,
        'avatarAnimationGeneration.generatedWith': 'imagen-fallback',
        updatedAt: FieldValue.serverTimestamp(),
      });

      return { ok: true, animationUrl, debugInfo };

    } catch (e: any) {
      console.error('[avatarAnimationFlow] Error:', e);

      // Mark as error
      await entityRef.update({
        'avatarAnimationGeneration.status': 'error',
        'avatarAnimationGeneration.lastErrorMessage': e.message || 'Unknown error',
      });

      return { ok: false, errorMessage: e.message || 'Failed to generate avatar animation.', debugInfo: { veoAttempted: true, veoError: e.message } };
    }
  }
);
