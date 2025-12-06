
'use server';

/**
 * @fileOverview A Genkit flow to generate a cartoon avatar from a child's photos.
 */

import { ai } from '@/ai/genkit';
import { initFirebaseAdminApp } from '@/firebase/admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { z } from 'genkit';
import type { ChildProfile } from '@/lib/types';
import { Gaxios, GaxiosError } from 'gaxios';
import { getStoryBucket } from '@/firebase/admin/storage';
import { randomUUID } from 'crypto';

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
      metadata: {
        ownerParentUid: params.parentUid,
        childId: params.childId,
        firebaseStorageDownloadTokens: downloadToken,
      },
    },
    cacheControl: 'public,max-age=3600',
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

    if (photoUrls.length === 0) {
      throw new Error('No photos available to generate an avatar.');
    }

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
      throw new Error('Could not load any of the provided photos. This might be due to a network or permission issue when fetching from Cloud Storage.');
    }
    
    const promptParts = [
      ...imageParts,
      {
        text: `Based on the provided photo(s) of a child, generate a single, simple, friendly, cartoon-style avatar. The avatar should be a head and shoulders shot on a plain, soft-colored background. Focus on capturing a happy expression. ${
          feedback || ''
        }`,
      },
    ];

    const llmResponse = await ai.generate({
      model: 'googleai/gemini-2.5-flash-image-preview',
      prompt: promptParts,
      config: {
        responseModalities: ['TEXT', 'IMAGE'],
      },
    });

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
    
    return { imageUrl };
  }
);
