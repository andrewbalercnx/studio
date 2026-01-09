'use server';

/**
 * @fileOverview A Genkit flow to generate a cartoon avatar for a character.
 * Can generate avatars with or without photos - uses character description when photos aren't available.
 */

import { ai } from '@/ai/genkit';
import { initFirebaseAdminApp } from '@/firebase/admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { z } from 'genkit';
import type { Character } from '@/lib/types';
import { getStoryBucket } from '@/firebase/admin/storage';
import { randomUUID } from 'crypto';
import { logAIFlow } from '@/lib/ai-flow-logger';
import { Gaxios, GaxiosError } from 'gaxios';
import { avatarAnimationFlow } from './avatar-animation-flow';
import { imageDescriptionFlow } from './image-description-flow';

const CharacterAvatarFlowInputSchema = z.object({
  characterId: z.string(),
  feedback: z.string().optional(),
});

export type CharacterAvatarFlowInput = z.infer<typeof CharacterAvatarFlowInputSchema>;

const CharacterAvatarFlowOutputSchema = z.object({
  imageUrl: z.string().describe('The generated avatar image as a public Firebase Storage URL.'),
});

async function fetchImageAsDataUri(url: string): Promise<string | null> {
  if (!url || typeof url !== 'string') {
    console.error(`[character-avatar-flow] Invalid URL provided: ${url}`);
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
      console.warn(`[character-avatar-flow] Failed to fetch image ${finalUrl}, status: ${response.status}`);
      return null;
    }

    const mimeType = response.headers['content-type'] || 'image/jpeg';
    const buffer = Buffer.from(response.data);
    return `data:${mimeType};base64,${buffer.toString('base64')}`;
  } catch (error) {
    if (error instanceof GaxiosError) {
      console.error(`[character-avatar-flow] Gaxios error fetching ${url}: ${error.message}. Status: ${error.response?.status}. Data: ${error.response?.data}`);
    } else if (error instanceof TypeError && error.message.includes('Invalid URL')) {
      console.error(`[character-avatar-flow] Invalid URL provided: ${url}`);
    } else {
      console.error(`[character-avatar-flow] Unexpected error fetching ${url}:`, error);
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

async function uploadCharacterAvatarToStorage(params: {
  buffer: Buffer;
  mimeType: string;
  characterId: string;
  parentUid: string;
}): Promise<string> {
  const bucket = await getStoryBucket();
  const objectPath = `users/${params.parentUid}/characters/${params.characterId}/avatars/avatar-${Date.now()}.png`;
  const downloadToken = randomUUID();

  await bucket.file(objectPath).save(params.buffer, {
    contentType: params.mimeType,
    resumable: false,
    metadata: {
      cacheControl: 'public,max-age=3600',
      metadata: {
        ownerParentUid: params.parentUid,
        characterId: params.characterId,
        firebaseStorageDownloadTokens: downloadToken,
      },
    },
  });

  return `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(objectPath)}?alt=media&token=${downloadToken}`;
}


export const characterAvatarFlow = ai.defineFlow(
  {
    name: 'characterAvatarFlow',
    inputSchema: CharacterAvatarFlowInputSchema,
    outputSchema: CharacterAvatarFlowOutputSchema,
  },
  async ({ characterId, feedback }) => {
    await initFirebaseAdminApp();
    const firestore = getFirestore();
    const characterRef = firestore.collection('characters').doc(characterId);
    const characterSnap = await characterRef.get();

    if (!characterSnap.exists) {
      throw new Error(`Character with id ${characterId} not found.`);
    }

    const character = characterSnap.data() as Character;
    const photoUrls = character.photos || [];

    // Fetch up to 3 photos and convert them to data URIs (if available)
    const imageParts = (
      await Promise.all(
        photoUrls.slice(0, 3).map(async (url) => {
          const dataUri = await fetchImageAsDataUri(url);
          return dataUri ? { media: { url: dataUri } } : null;
        })
      )
    ).filter((part): part is { media: { url: string } } => part !== null);

    // Build context from character profile
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

    const age = character.dateOfBirth ? calculateAge(character.dateOfBirth) : null;
    const ageContext = age ? `${age}-year-old ` : '';
    const typeContext = character.type ? `${character.type.toLowerCase()} ` : '';

    const contextParts: string[] = [];
    if (character.description) {
      contextParts.push(`Description: ${character.description}`);
    }
    if (character.likes?.length) {
      contextParts.push(`Likes: ${character.likes.join(', ')}`);
    }
    if (character.dislikes?.length) {
      contextParts.push(`Dislikes: ${character.dislikes.join(', ')}`);
    }
    const context = contextParts.length > 0 ? `\n\nContext about the character:\n${contextParts.join('\n')}` : '';

    // Build prompt based on whether we have photos or not
    let promptParts: any[];
    let promptText: string;

    if (imageParts.length > 0) {
      // Photo-based avatar generation
      promptParts = [
        ...imageParts,
        {
          text: `Based on the provided photo(s) of ${ageContext}${typeContext}character named ${character.displayName || 'the character'}, generate a single, simple, friendly, cartoon-style avatar. The avatar should be a head and shoulders shot on a plain, soft-colored background. The character should have a cheerful, friendly expression that would appeal to young children in a storybook.${context}${feedback ? `\n\nAdditional guidance: ${feedback}` : ''}`,
        },
      ];
      promptText = `Character avatar generation for ${character.displayName} with ${imageParts.length} photo(s)${feedback ? ` and feedback: ${feedback}` : ''}`;
    } else {
      // Description-based avatar generation (no photos)
      const descriptiveContext = contextParts.length > 0
        ? `\n\n${contextParts.join('\n')}`
        : '';

      promptParts = [
        {
          text: `Generate a single, simple, friendly, cartoon-style avatar for ${ageContext}${typeContext}character named ${character.displayName || 'a character'}. The avatar should be a head and shoulders shot on a plain, soft-colored background. The character should have a cheerful, friendly expression that would appeal to young children in a storybook.${descriptiveContext}${feedback ? `\n\nAdditional guidance: ${feedback}` : ''}\n\nCreate an imaginative, age-appropriate cartoon character suitable for children's stories.`,
        },
      ];
      promptText = `Character avatar generation for ${character.displayName} from description only (no photos)${feedback ? ` with feedback: ${feedback}` : ''}`;
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
      await logAIFlow({ flowName: 'characterAvatarFlow', sessionId: characterId, parentId: character.ownerParentUid, prompt: promptText, response: llmResponse, startTime, modelName });
    } catch (e: any) {
      await logAIFlow({ flowName: 'characterAvatarFlow', sessionId: characterId, parentId: character.ownerParentUid, prompt: promptText, error: e, startTime, modelName });
      throw e;
    }

    const dataUrl = llmResponse.media?.url;
    if (!dataUrl) {
      throw new Error('The model did not return an image.');
    }

    const { buffer, mimeType } = parseDataUrl(dataUrl);

    const imageUrl = await uploadCharacterAvatarToStorage({
      buffer,
      mimeType,
      characterId,
      parentUid: character.ownerParentUid,
    });

    // Update character profile with avatar URL
    await characterRef.update({
      avatarUrl: imageUrl,
      updatedAt: FieldValue.serverTimestamp(),
    });

    // Only trigger background flows if the character has photos
    // For story-generated characters (no photos), these are unnecessary:
    // - avatarAnimationFlow: Only needed for main child avatar (shown during processing)
    // - imageDescriptionFlow: No-op when there are no photos to describe
    if (photoUrls.length > 0) {
      // Set animation generation to pending
      await characterRef.update({
        'avatarAnimationGeneration.status': 'pending',
      });

      // Trigger avatar animation generation in background (fire-and-forget)
      avatarAnimationFlow({ characterId, avatarUrl: imageUrl }).catch((err) => {
        console.error('[characterAvatarFlow] Background animation generation failed:', err);
      });

      // Trigger image description generation in background (fire-and-forget)
      imageDescriptionFlow({ entityId: characterId, entityType: 'character' }).catch((err) => {
        console.error('[characterAvatarFlow] Background image description generation failed:', err);
      });
    }

    return { imageUrl };
  }
);
