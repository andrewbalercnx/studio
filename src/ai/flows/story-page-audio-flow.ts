'use server';

/**
 * @fileOverview A flow to generate audio narration for individual storybook pages using ElevenLabs TTS.
 * This generates audio for each page so it can be played during the interactive book reader.
 */

import { initFirebaseAdminApp } from '@/firebase/admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { getStoryBucket } from '@/firebase/admin/storage';
import { randomUUID } from 'crypto';
import { ElevenLabsClient } from '@elevenlabs/elevenlabs-js';
import type { Story, ChildProfile, StoryOutputPage } from '@/lib/types';
import { DEFAULT_TTS_VOICE, ELEVENLABS_MODEL } from '@/lib/tts-config';
import {
  resolveEntitiesInText,
  replacePlaceholdersForTTS,
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
 * Convert a readable stream to a buffer
 */
async function streamToBuffer(stream: ReadableStream<Uint8Array>): Promise<Buffer> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) chunks.push(value);
  }

  return Buffer.concat(chunks);
}

/**
 * Generate audio for a single page
 */
async function generatePageAudio(
  page: StoryOutputPage,
  storyId: string,
  parentUid: string | null,
  voiceId: string,
  elevenlabs: ElevenLabsClient,
  bucket: any,
  entityMap?: EntityMap
): Promise<{ audioUrl: string; metadata: any } | null> {
  // Get the base text to narrate - prefer displayText (resolved placeholders) over bodyText
  let textToNarrate = page.displayText || page.bodyText || page.title;

  // If we have bodyText with placeholders, resolve them for TTS
  // This uses namePronunciation when available for correct name pronunciation
  if (!textToNarrate && page.bodyText && entityMap) {
    textToNarrate = await replacePlaceholdersForTTS(page.bodyText, entityMap);
  }

  if (!textToNarrate || textToNarrate.trim().length === 0) {
    console.log(`[page-audio-flow] Page ${page.pageNumber} has no text to narrate, skipping`);
    return null;
  }

  console.log(`[page-audio-flow] Generating audio for page ${page.pageNumber}: "${textToNarrate.slice(0, 50)}..."`);

  // Generate audio using ElevenLabs TTS
  const startTime = Date.now();
  let audioStream;
  try {
    audioStream = await elevenlabs.textToSpeech.convert(voiceId, {
      text: textToNarrate,
      modelId: ELEVENLABS_MODEL,
      languageCode: 'en-GB',
    });

    // Log success
    await logAIFlow({
      flowName: 'storyPageAudioFlow',
      sessionId: storyId,
      parentId: parentUid,
      prompt: textToNarrate,
      response: {
        text: `[Audio generated for page ${page.pageNumber}]`,
        model: ELEVENLABS_MODEL,
      },
      startTime,
      modelName: ELEVENLABS_MODEL,
    });
  } catch (e: any) {
    await logAIFlow({
      flowName: 'storyPageAudioFlow',
      sessionId: storyId,
      parentId: parentUid,
      prompt: textToNarrate,
      error: e,
      startTime,
      modelName: ELEVENLABS_MODEL,
    });
    throw e;
  }

  // Convert stream to buffer
  const audioBuffer = await streamToBuffer(audioStream as unknown as ReadableStream<Uint8Array>);

  // ElevenLabs returns MP3 by default
  const mimeType = 'audio/mpeg';
  const fileExtension = 'mp3';

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
        voiceId: voiceId,
        model: ELEVENLABS_MODEL,
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
      voiceId: voiceId,
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

    // Load child profile to get voice preference
    let preferredVoice = DEFAULT_TTS_VOICE;

    if (story.childId) {
      const childSnap = await firestore.collection('children').doc(story.childId).get();
      if (childSnap.exists) {
        const childProfile = childSnap.data() as ChildProfile;
        if (childProfile.preferredVoiceId) {
          preferredVoice = childProfile.preferredVoiceId;
        }
      }
    }

    // Voice from input takes priority
    const voiceId = voiceConfig?.voiceName || preferredVoice;

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

    // Build entity map for all actors in the story (for resolving placeholders)
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
    console.log(`[page-audio-flow] Resolved ${entityMap.size} entities`);

    // Check for API key before initializing client
    const apiKey = process.env.ELEVENLABS_API_KEY;
    if (!apiKey) {
      console.error('[page-audio-flow] ELEVENLABS_API_KEY environment variable not set');
      return { ok: false, errorMessage: 'Text-to-speech service is not configured' };
    }

    // Initialize ElevenLabs client
    console.log(`[page-audio-flow] Initializing ElevenLabs client...`);
    const elevenlabs = new ElevenLabsClient({
      apiKey,
    });
    const bucket = await getStoryBucket();
    console.log(`[page-audio-flow] ElevenLabs client and storage bucket ready`);

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
          voiceId,
          elevenlabs,
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
              model: ELEVENLABS_MODEL,
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
