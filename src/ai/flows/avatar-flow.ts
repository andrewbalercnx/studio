
'use server';

/**
 * @fileOverview A Genkit flow to generate a cartoon avatar from a child's photos or description.
 * Can generate avatars with or without photos - uses profile description when photos aren't available.
 */

import { ai } from '@/ai/genkit';
import { initFirebaseAdminApp } from '@/firebase/admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { z } from 'genkit';
import type { ChildProfile } from '@/lib/types';
import { Gaxios, GaxiosError } from 'gaxios';
import { getStoryBucket } from '@/firebase/admin/storage';
import { randomUUID } from 'crypto';
import { logAIFlow } from '@/lib/ai-flow-logger';
import { avatarAnimationFlow } from './avatar-animation-flow';

const AvatarFlowInputSchema = z.object({
  childId: z.string(),
  feedback: z.string().optional(),
});

export type AvatarFlowInput = z.infer<typeof AvatarFlowInputSchema>;

const AvatarFlowOutputSchema = z.object({
  imageUrl: z.string().describe('The generated avatar image as a public Firebase Storage URL.'),
});

async function fetchImageAsDataUri(url: string): Promise<string | null> {
  if (!url || typeof url !== 'string') {
    console.error(`[avatar-flow] Invalid URL provided: ${url}`);
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
      console.warn(`[avatar-flow] Failed to fetch image ${finalUrl}, status: ${response.status}`);
      return null;
    }

    const mimeType = response.headers['content-type'] || 'image/jpeg';
    const buffer = Buffer.from(response.data);
    return `data:${mimeType};base64,${buffer.toString('base64')}`;
  } catch (error) {
    if (error instanceof GaxiosError) {
      console.error(`[avatar-flow] Gaxios error fetching ${url}: ${error.message}. Status: ${error.response?.status}. Data: ${error.response?.data}`);
    } else if (error instanceof TypeError && error.message.includes('Invalid URL')) {
      console.error(`[avatar-flow] Invalid URL provided: ${url}`);
    } else {
      console.error(`[avatar-flow] Unexpected error fetching ${url}:`, error);
    }
    return null;
  }
}

function parseDataUrl(dataUrl: string): {mimeType: string; buffer: Buffer} {
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
  childId: string;
  parentUid: string;
}): Promise<string> {
  const bucket = await getStoryBucket();
  const objectPath = `users/${params.parentUid}/children/${params.childId}/avatars/avatar-${Date.now()}.png`;
  const downloadToken = randomUUID();

  await bucket.file(objectPath).save(params.buffer, {
    contentType: params.mimeType,
    resumable: false,
    metadata: {
      cacheControl: 'public,max-age=3600',
      metadata: {
        ownerParentUid: params.parentUid,
        childId: params.childId,
        firebaseStorageDownloadTokens: downloadToken,
      },
    },
  });

  return `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(objectPath)}?alt=media&token=${downloadToken}`;
}


export const avatarFlow = ai.defineFlow(
  {
    name: 'avatarFlow',
    inputSchema: AvatarFlowInputSchema,
    outputSchema: AvatarFlowOutputSchema,
  },
  async ({ childId, feedback }) => {
    await initFirebaseAdminApp();
    const firestore = getFirestore();
    const childRef = firestore.collection('children').doc(childId);
    const childSnap = await childRef.get();

    if (!childSnap.exists) {
      throw new Error(`Child with id ${childId} not found.`);
    }

    const child = childSnap.data() as ChildProfile;
    const photoUrls = child.photos || [];

    // Fetch up to 3 photos and convert them to data URIs (if available)
    const imageParts = (
      await Promise.all(
        photoUrls.slice(0, 3).map(async (url) => {
          const dataUri = await fetchImageAsDataUri(url);
          return dataUri ? { media: { url: dataUri } } : null;
        })
      )
    ).filter((part): part is { media: { url: string } } => part !== null);

    // Build context from child profile
    const calculateAge = (dob: any): number | null => {
      if (!dob) return null;
      let date: Date | null = null;
      if (typeof dob?.toDate === 'function') {
        date = dob.toDate();
      } else {
        const parsed = new Date(dob);
        date = isNaN(parsed.getTime()) ? null : parsed;
      }
      if (!date) return null;
      const diff = Date.now() - date.getTime();
      if (diff <= 0) return null;
      return Math.floor(diff / (1000 * 60 * 60 * 24 * 365.25));
    };

    const age = child.dateOfBirth ? calculateAge(child.dateOfBirth) : null;
    const ageContext = age ? `a ${age}-year-old ` : '';

    const contextParts: string[] = [];
    if (child.description) {
      contextParts.push(`Description: ${child.description}`);
    }
    if (child.likes?.length) {
      contextParts.push(`Likes: ${child.likes.join(', ')}`);
    }
    if (child.dislikes?.length) {
      contextParts.push(`Dislikes: ${child.dislikes.join(', ')}`);
    }
    const context = contextParts.length > 0 ? `\n\nContext about the child:\n${contextParts.join('\n')}` : '';

    // Build prompt based on whether we have photos or not
    let promptParts: any[];
    let promptText: string;

    if (imageParts.length > 0) {
      // Photo-based avatar generation
      promptParts = [
        ...imageParts,
        {
          text: `Based on the provided photo(s) of ${ageContext}child named ${child.displayName || 'the child'}, generate a single, simple, friendly, cartoon-style avatar. The avatar should be a head and shoulders shot on a plain, soft-colored background. Focus on capturing a happy expression.${context}${feedback ? `\n\nAdditional guidance: ${feedback}` : ''}`,
        },
      ];
      promptText = `Avatar generation with ${imageParts.length} photo(s)${feedback ? ` and feedback: ${feedback}` : ''}`;
    } else {
      // Description-based avatar generation (no photos)
      const descriptiveContext = contextParts.length > 0
        ? `\n\n${contextParts.join('\n')}`
        : '';

      promptParts = [
        {
          text: `Generate a single, simple, friendly, cartoon-style avatar for ${ageContext}child named ${child.displayName || 'a child'}. The avatar should be a head and shoulders shot on a plain, soft-colored background. Focus on capturing a happy, cheerful expression.${descriptiveContext}${feedback ? `\n\nAdditional guidance: ${feedback}` : ''}\n\nSince no photos are available, create an imaginative, age-appropriate cartoon character that would appeal to young children.`,
        },
      ];
      promptText = `Avatar generation from description only (no photos)${feedback ? ` with feedback: ${feedback}` : ''}`;
    }

    let llmResponse;
    const startTime = Date.now();
    const modelName = 'googleai/gemini-2.5-flash-image-preview';
    try {
      llmResponse = await ai.generate({
        model: modelName,
        prompt: promptParts,
        config: {
          responseModalities: ['TEXT', 'IMAGE'],
        },
      });
      await logAIFlow({ flowName: 'avatarFlow', sessionId: childId, parentId: child.ownerParentUid, prompt: promptText, response: llmResponse, startTime, modelName });
    } catch (e: any) {
      await logAIFlow({ flowName: 'avatarFlow', sessionId: childId, parentId: child.ownerParentUid, prompt: promptText, error: e, startTime, modelName });
      throw e;
    }

    const dataUrl = llmResponse.media?.url;
    if (!dataUrl) {
      throw new Error('The model did not return an image.');
    }

    const { buffer, mimeType } = parseDataUrl(dataUrl);

    const imageUrl = await uploadAvatarToStorage({
      buffer,
      mimeType,
      childId,
      parentUid: child.ownerParentUid,
    });

    // Update child profile with avatar URL
    await childRef.update({
      avatarUrl: imageUrl,
      updatedAt: FieldValue.serverTimestamp(),
      // Set animation generation to pending
      'avatarAnimationGeneration.status': 'pending',
    });

    // Trigger avatar animation generation in background (fire-and-forget)
    avatarAnimationFlow({ childId, avatarUrl: imageUrl }).catch((err) => {
      console.error('[avatarFlow] Background animation generation failed:', err);
    });

    return { imageUrl };
  }
);
