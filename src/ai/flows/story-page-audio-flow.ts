'use server';

/**
 * @fileOverview A flow to generate audio narration for individual storybook pages using Gemini Pro TTS.
 * This generates audio for each page so it can be played during the interactive book reader.
 */

import { initFirebaseAdminApp } from '@/firebase/admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { getStoryBucket } from '@/firebase/admin/storage';
import { randomUUID } from 'crypto';
import { GoogleGenAI } from '@google/genai';
import type { Story, ChildProfile, StoryOutputPage } from '@/lib/types';
import { DEFAULT_TTS_VOICE } from '@/lib/tts-config';
import {
  resolveEntitiesInText,
  replacePlaceholdersInText,
  buildActorDescriptionsForAudio,
  type EntityMap,
} from '@/lib/resolve-placeholders.server';
import { logAIFlow } from '@/lib/ai-flow-logger';

export type PageAudioFlowInput = {
  storyId: string;
  storybookId?: string; // If provided, use new model path: stories/{storyId}/storybooks/{storybookId}/pages
  pageId?: string; // If provided, only generate audio for this page
  forceRegenerate?: boolean;
  voiceConfig?: {
    voiceName?: string;
  };
};

export type PageAudioResult = {
  pageId: string;
  pageNumber: number;
  audioUrl: string;
  durationSeconds?: number;
};

export type PageAudioFlowOutput = {
  ok: boolean;
  results?: PageAudioResult[];
  errorMessage?: string;
  pagesProcessed?: number;
  pagesSkipped?: number;
};

/**
 * Convert raw PCM audio data to WAV format by adding proper headers.
 */
function pcmToWav(pcmBuffer: Buffer, sampleRate: number = 24000, channels: number = 1, bitsPerSample: number = 16): Buffer {
  const byteRate = sampleRate * channels * (bitsPerSample / 8);
  const blockAlign = channels * (bitsPerSample / 8);
  const dataSize = pcmBuffer.length;
  const headerSize = 44;
  const fileSize = headerSize + dataSize - 8;

  const wavBuffer = Buffer.alloc(headerSize + dataSize);

  // RIFF header
  wavBuffer.write('RIFF', 0);
  wavBuffer.writeUInt32LE(fileSize, 4);
  wavBuffer.write('WAVE', 8);

  // fmt subchunk
  wavBuffer.write('fmt ', 12);
  wavBuffer.writeUInt32LE(16, 16);
  wavBuffer.writeUInt16LE(1, 20);
  wavBuffer.writeUInt16LE(channels, 22);
  wavBuffer.writeUInt32LE(sampleRate, 24);
  wavBuffer.writeUInt32LE(byteRate, 28);
  wavBuffer.writeUInt16LE(blockAlign, 32);
  wavBuffer.writeUInt16LE(bitsPerSample, 34);

  // data subchunk
  wavBuffer.write('data', 36);
  wavBuffer.writeUInt32LE(dataSize, 40);

  // Copy PCM data
  pcmBuffer.copy(wavBuffer, headerSize);

  return wavBuffer;
}

/**
 * Parse sample rate from mime type like "audio/L16;codec=pcm;rate=24000"
 */
function parseSampleRate(mimeType: string): number {
  const rateMatch = mimeType.match(/rate=(\d+)/);
  return rateMatch ? parseInt(rateMatch[1], 10) : 24000;
}

/**
 * Calculate child's age from date of birth
 */
function calculateAge(dateOfBirth: any): number | null {
  if (!dateOfBirth) return null;
  const dob = dateOfBirth?.toDate ? dateOfBirth.toDate() : new Date(dateOfBirth);
  const today = new Date();
  let age = today.getFullYear() - dob.getFullYear();
  const monthDiff = today.getMonth() - dob.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < dob.getDate())) {
    age--;
  }
  return age > 0 ? age : null;
}

/**
 * Generate audio for a single page
 */
async function generatePageAudio(
  page: StoryOutputPage,
  storyId: string,
  parentUid: string | null,
  voiceName: string,
  ageHint: string,
  pronunciationHint: string,
  genai: GoogleGenAI,
  bucket: any,
  entityMap?: EntityMap
): Promise<{ audioUrl: string; metadata: any } | null> {
  // Get the base text to narrate - prefer displayText (resolved placeholders) over bodyText
  let textToNarrate = page.displayText || page.bodyText || page.title;

  // If we have bodyText with placeholders, resolve them
  if (!textToNarrate && page.bodyText && entityMap) {
    textToNarrate = await replacePlaceholdersInText(page.bodyText, entityMap);
  }

  if (!textToNarrate || textToNarrate.trim().length === 0) {
    console.log(`[page-audio-flow] Page ${page.pageNumber} has no text to narrate, skipping`);
    return null;
  }

  // Build actor descriptions for the characters on this page
  let actorDescriptions = '';
  if (entityMap && page.entityIds && page.entityIds.length > 0) {
    actorDescriptions = await buildActorDescriptionsForAudio(page.entityIds, entityMap);
    console.log(`[page-audio-flow] Page ${page.pageNumber} has ${page.entityIds.length} actors`);
  }

  // Build a prompt for this page with actor context
  // The actor descriptions provide context about who the characters are
  const prompt = `Read aloud in a way suitable for a ${ageHint} child. Use a British English accent. Read warmly and engagingly, with appropriate pauses and expression for a bedtime story.${pronunciationHint}${actorDescriptions}\n\nStory text to read:\n${textToNarrate}`;

  console.log(`[page-audio-flow] Generating audio for page ${page.pageNumber}: "${textToNarrate.slice(0, 50)}..."`);

  // Generate audio using Gemini Pro TTS
  const modelName = 'gemini-2.5-pro-preview-tts';
  const startTime = Date.now();
  let response;
  try {
    response = await genai.models.generateContent({
      model: modelName,
      contents: prompt,
      config: {
        responseModalities: ['AUDIO'],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: {
              voiceName: voiceName,
            },
          },
        },
      },
    });
    // Log success - note: TTS response doesn't have text, just audio data
    await logAIFlow({
      flowName: 'storyPageAudioFlow',
      sessionId: storyId,
      parentId: parentUid,
      prompt,
      response: {
        text: `[Audio generated for page ${page.pageNumber}]`,
        finishReason: response.candidates?.[0]?.finishReason,
        model: modelName,
      },
      startTime,
      modelName,
    });
  } catch (e: any) {
    await logAIFlow({
      flowName: 'storyPageAudioFlow',
      sessionId: storyId,
      parentId: parentUid,
      prompt,
      error: e,
      startTime,
      modelName,
    });
    throw e;
  }

  // Extract audio data from response
  const audioData = response.candidates?.[0]?.content?.parts?.[0]?.inlineData;
  if (!audioData?.data) {
    throw new Error(`Gemini TTS returned no audio content for page ${page.pageNumber}`);
  }

  // Decode base64 audio data
  const rawAudioBuffer = Buffer.from(audioData.data, 'base64');
  const rawMimeType = audioData.mimeType || 'audio/wav';

  // Convert PCM to WAV if needed
  let audioBuffer: Buffer;
  let mimeType: string;
  let fileExtension: string;

  if (rawMimeType.includes('L16') || rawMimeType.includes('pcm')) {
    const sampleRate = parseSampleRate(rawMimeType);
    audioBuffer = pcmToWav(rawAudioBuffer, sampleRate);
    mimeType = 'audio/wav';
    fileExtension = 'wav';
  } else if (rawMimeType.includes('mp3')) {
    audioBuffer = rawAudioBuffer;
    mimeType = rawMimeType;
    fileExtension = 'mp3';
  } else if (rawMimeType.includes('wav')) {
    audioBuffer = rawAudioBuffer;
    mimeType = rawMimeType;
    fileExtension = 'wav';
  } else {
    audioBuffer = pcmToWav(rawAudioBuffer);
    mimeType = 'audio/wav';
    fileExtension = 'wav';
  }

  // Upload to Firebase Storage
  const downloadToken = randomUUID();
  const storagePath = `stories/${storyId}/audio/page-${String(page.pageNumber).padStart(3, '0')}-${Date.now()}.${fileExtension}`;

  await bucket.file(storagePath).save(audioBuffer, {
    contentType: mimeType,
    resumable: false,
    metadata: {
      cacheControl: 'public,max-age=86400',
      metadata: {
        storyId,
        pageNumber: String(page.pageNumber),
        voiceId: voiceName,
        model: 'gemini-2.5-pro-preview-tts',
        firebaseStorageDownloadTokens: downloadToken,
      },
    },
  });

  // Generate download URL
  const audioUrl = `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(storagePath)}?alt=media&token=${downloadToken}`;

  // Estimate duration (~150 words per minute)
  const wordCount = textToNarrate.split(/\s+/).length;
  const estimatedDurationSeconds = Math.round((wordCount / 150) * 60);

  return {
    audioUrl,
    metadata: {
      storagePath,
      downloadToken,
      durationSeconds: estimatedDurationSeconds,
      voiceId: voiceName,
      sizeBytes: audioBuffer.byteLength,
    },
  };
}

/**
 * Main flow to generate audio narration for storybook pages
 */
export async function storyPageAudioFlow(input: PageAudioFlowInput): Promise<PageAudioFlowOutput> {
  const { storyId, storybookId, pageId, forceRegenerate = false, voiceConfig } = input;

  // Determine if using new model (storybookId provided) or legacy model
  const isNewModel = !!storybookId;

  console.log(`[page-audio-flow] Starting for storyId: ${storyId}, storybookId: ${storybookId || 'none (legacy)'}, pageId: ${pageId || 'all'}, forceRegenerate: ${forceRegenerate}`);

  try {
    console.log(`[page-audio-flow] Initializing Firebase Admin...`);
    await initFirebaseAdminApp();
    const firestore = getFirestore();
    console.log(`[page-audio-flow] Firebase Admin initialized successfully`);

    // Load story document
    const storyRef = firestore.collection('stories').doc(storyId);
    const storySnap = await storyRef.get();
    if (!storySnap.exists) {
      return { ok: false, errorMessage: `Story ${storyId} not found` };
    }

    const story = { id: storySnap.id, ...storySnap.data() } as Story;

    // Load child profile to get age, voice preference, and name pronunciation
    let childAge: number | null = null;
    let preferredVoice = DEFAULT_TTS_VOICE;
    let childName: string | null = null;
    let namePronunciation: string | null = null;

    if (story.childId) {
      const childSnap = await firestore.collection('children').doc(story.childId).get();
      if (childSnap.exists) {
        const childProfile = childSnap.data() as ChildProfile;
        childAge = calculateAge(childProfile.dateOfBirth);
        childName = childProfile.displayName || null;
        namePronunciation = childProfile.namePronunciation || null;
        if (childProfile.preferredVoiceId) {
          preferredVoice = childProfile.preferredVoiceId;
        }
      }
    }

    // Voice from input takes priority
    const voiceName = voiceConfig?.voiceName || preferredVoice;

    // Build context strings
    const ageHint = childAge ? `${childAge} year old` : 'young';
    let pronunciationHint = '';
    if (childName && namePronunciation) {
      pronunciationHint = `\n\nIMPORTANT: The name "${childName}" should be pronounced as "${namePronunciation}".`;
    }

    // Load pages - path depends on model:
    // New model: stories/{storyId}/storybooks/{storybookId}/pages
    // Legacy model: stories/{storyId}/outputs/storybook/pages
    const pagesCollectionRef = isNewModel
      ? firestore
          .collection('stories')
          .doc(storyId)
          .collection('storybooks')
          .doc(storybookId!)
          .collection('pages')
      : firestore
          .collection('stories')
          .doc(storyId)
          .collection('outputs')
          .doc('storybook')
          .collection('pages');

    console.log(`[page-audio-flow] Using ${isNewModel ? 'new' : 'legacy'} model path for pages`);

    let pagesQuery: FirebaseFirestore.Query;
    if (pageId) {
      // Single page mode
      pagesQuery = pagesCollectionRef.where('__name__', '==', pageId);
    } else {
      // All pages mode
      pagesQuery = pagesCollectionRef.orderBy('pageNumber', 'asc');
    }

    console.log(`[page-audio-flow] Querying pages collection...`);
    const pagesSnap = await pagesQuery.get();
    console.log(`[page-audio-flow] Pages query returned ${pagesSnap.size} documents`);

    if (pagesSnap.empty) {
      console.log(`[page-audio-flow] No pages found for storyId: ${storyId}, pageId: ${pageId || 'all'}`);
      return { ok: false, errorMessage: 'No pages found for this storybook' };
    }

    const pages = pagesSnap.docs.map((doc: FirebaseFirestore.QueryDocumentSnapshot) => ({ id: doc.id, ...doc.data() } as StoryOutputPage));
    console.log(`[page-audio-flow] Found ${pages.length} pages to process`);

    // Build entity map for all actors in the story (for actor descriptions)
    // Collect all unique entity IDs from all pages
    const allEntityIds = new Set<string>();
    for (const page of pages) {
      if (page.entityIds) {
        page.entityIds.forEach(id => allEntityIds.add(id));
      }
    }
    // Also include story actors if available
    if (story.actors) {
      story.actors.forEach(id => allEntityIds.add(id));
    }

    // Resolve all entities for the story
    const entityIdsText = Array.from(allEntityIds).map(id => `$$${id}$$`).join(' ');
    const entityMap = await resolveEntitiesInText(entityIdsText);
    console.log(`[page-audio-flow] Resolved ${entityMap.size} entities for actor descriptions`);

    // Initialize Gemini client
    console.log(`[page-audio-flow] Initializing Gemini client...`);
    const genai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });
    const bucket = await getStoryBucket();
    console.log(`[page-audio-flow] Gemini client and storage bucket ready`);

    const results: PageAudioResult[] = [];
    let pagesProcessed = 0;
    let pagesSkipped = 0;

    // Filter pages that need audio generation
    const pagesToProcess: StoryOutputPage[] = [];
    const pagesToSkip: StoryOutputPage[] = [];

    for (const page of pages) {
      if (!forceRegenerate && page.audioStatus === 'ready' && page.audioUrl) {
        console.log(`[page-audio-flow] Page ${page.pageNumber} already has audio, will skip`);
        pagesToSkip.push(page);
      } else {
        pagesToProcess.push(page);
      }
    }

    pagesSkipped = pagesToSkip.length;
    console.log(`[page-audio-flow] Processing ${pagesToProcess.length} pages in parallel, skipping ${pagesSkipped}`);

    // Update all pages to 'generating' status in parallel
    await Promise.all(
      pagesToProcess.map(async (page) => {
        const pageRef = pagesCollectionRef.doc(page.id!);
        await pageRef.update({
          audioStatus: 'generating',
          'audioMetadata.lastErrorMessage': null,
          updatedAt: FieldValue.serverTimestamp(),
        });
      })
    );

    // Process all pages in parallel
    const audioPromises = pagesToProcess.map(async (page) => {
      const pageRef = pagesCollectionRef.doc(page.id!);

      try {
        console.log(`[page-audio-flow] Generating audio for page ${page.pageNumber}...`);
        const result = await generatePageAudio(
          page,
          storyId,
          story.parentUid || null,
          voiceName,
          ageHint,
          pronunciationHint,
          genai,
          bucket,
          entityMap
        );

        if (result) {
          console.log(`[page-audio-flow] Audio generated for page ${page.pageNumber}, updating Firestore...`);
          await pageRef.update({
            audioUrl: result.audioUrl,
            audioStatus: 'ready',
            audioMetadata: {
              ...result.metadata,
              generatedAt: FieldValue.serverTimestamp(),
              model: 'gemini-2.5-pro-preview-tts',
            },
            updatedAt: FieldValue.serverTimestamp(),
          });

          return {
            success: true,
            result: {
              pageId: page.id!,
              pageNumber: page.pageNumber,
              audioUrl: result.audioUrl,
              durationSeconds: result.metadata.durationSeconds,
            } as PageAudioResult,
          };
        } else {
          console.log(`[page-audio-flow] Page ${page.pageNumber} has no text, marking as ready with no audio`);
          await pageRef.update({
            audioStatus: 'ready',
            audioUrl: null,
            updatedAt: FieldValue.serverTimestamp(),
          });
          return { success: true, skipped: true };
        }
      } catch (pageError: any) {
        console.error(`[page-audio-flow] Error generating audio for page ${page.pageNumber}:`, pageError.message || pageError);
        await pageRef.update({
          audioStatus: 'error',
          'audioMetadata.lastErrorMessage': pageError.message || 'Unknown error',
          updatedAt: FieldValue.serverTimestamp(),
        });
        return { success: false, error: pageError.message };
      }
    });

    // Wait for all audio generation to complete
    const audioResults = await Promise.all(audioPromises);

    // Collect results
    for (const res of audioResults) {
      if (res.success && res.result) {
        results.push(res.result);
        pagesProcessed++;
      } else if (res.success && res.skipped) {
        pagesSkipped++;
      }
    }

    console.log(`[page-audio-flow] Completed: ${pagesProcessed} processed, ${pagesSkipped} skipped`);

    // Update storybook audio generation status if using new model
    if (isNewModel) {
      try {
        const storybookRef = firestore
          .collection('stories')
          .doc(storyId)
          .collection('storybooks')
          .doc(storybookId!);

        await storybookRef.update({
          'audioGeneration.status': 'ready',
          'audioGeneration.pagesReady': pagesProcessed,
          'audioGeneration.lastCompletedAt': FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        });
        console.log(`[page-audio-flow] Updated storybook ${storybookId} audio generation status to ready`);
      } catch (updateErr) {
        console.warn(`[page-audio-flow] Failed to update storybook audio status:`, updateErr);
      }
    }

    return {
      ok: true,
      results,
      pagesProcessed,
      pagesSkipped,
    };
  } catch (error: any) {
    console.error(`[page-audio-flow] Error:`, error);

    // Update storybook audio generation status to error if using new model
    if (storybookId) {
      try {
        await initFirebaseAdminApp();
        const firestore = getFirestore();
        const storybookRef = firestore
          .collection('stories')
          .doc(storyId)
          .collection('storybooks')
          .doc(storybookId);

        await storybookRef.update({
          'audioGeneration.status': 'error',
          'audioGeneration.lastErrorMessage': error.message || 'Unknown error',
          updatedAt: FieldValue.serverTimestamp(),
        });
      } catch (updateErr) {
        console.warn(`[page-audio-flow] Failed to update storybook audio error status:`, updateErr);
      }
    }

    return {
      ok: false,
      errorMessage: error.message || 'Failed to generate page audio',
    };
  }
}
