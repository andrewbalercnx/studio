
'use server';

/**
 * @fileOverview A Genkit flow to generate a cartoon avatar from a child's photos.
 */

import { ai } from '@/ai/genkit';
import { initializeFirebase } from '@/firebase';
import { getDoc, doc } from 'firebase/firestore';
import { z } from 'genkit';
import type { ChildProfile } from '@/lib/types';
import { Gaxios, GaxiosError } from 'gaxios';

const AvatarFlowInputSchema = z.object({
  childId: z.string(),
  feedback: z.string().optional(),
});

export type AvatarFlowInput = z.infer<typeof AvatarFlowInputSchema>;

const AvatarFlowOutputSchema = z.object({
  imageUrl: z.string().describe('The generated avatar image as a data URI.'),
});

async function fetchImageAsDataUri(url: string): Promise<string | null> {
  try {
    const gaxios = new Gaxios();
    const response = await gaxios.request<ArrayBuffer>({
      url,
      responseType: 'arraybuffer',
    });

    if (response.status !== 200 || !response.data) {
      console.warn(`[avatar-flow] Failed to fetch image ${url}, status: ${response.status}`);
      return null;
    }

    const mimeType = response.headers['content-type'] || 'image/jpeg';
    const buffer = Buffer.from(response.data);
    return `data:${mimeType};base64,${buffer.toString('base64')}`;
  } catch (error) {
    if (error instanceof GaxiosError) {
      console.error(`[avatar-flow] Gaxios error fetching ${url}: ${error.message}`);
    } else {
      console.error(`[avatar-flow] Unexpected error fetching ${url}:`, error);
    }
    return null;
  }
}

export const avatarFlow = ai.defineFlow(
  {
    name: 'avatarFlow',
    inputSchema: AvatarFlowInputSchema,
    outputSchema: AvatarFlowOutputSchema,
  },
  async ({ childId, feedback }) => {
    const { firestore } = initializeFirebase();
    const childRef = doc(firestore, 'children', childId);
    const childSnap = await getDoc(childRef);

    if (!childSnap.exists()) {
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
      throw new Error('Could not load any of the provided photos.');
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

    const imageUrl = llmResponse.media?.url;
    if (!imageUrl) {
      throw new Error('The model did not return an image.');
    }
    
    return { imageUrl };
  }
);
