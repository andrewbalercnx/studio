'use server';

/**
 * @fileOverview A flow to generate audio narration for stories using ElevenLabs TTS.
 * Generates high-quality audio optimized for children's stories.
 */

import { initFirebaseAdminApp } from '@/firebase/admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { getStoryBucket } from '@/firebase/admin/storage';
import { randomUUID } from 'crypto';
import { ElevenLabsClient } from '@elevenlabs/elevenlabs-js';
import type { Story, ChildProfile } from '@/lib/types';
import { DEFAULT_TTS_VOICE, ELEVENLABS_MODEL } from '@/lib/tts-config';
import type { StoryAudioFlowInput, StoryAudioFlowOutput } from '@/lib/tts-config';
import { resolveEntitiesInText, replacePlaceholdersForTTS } from '@/lib/resolve-placeholders.server';

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
 * Main flow to generate audio narration for a story using ElevenLabs TTS
 */
export async function storyAudioFlow(input: StoryAudioFlowInput): Promise<StoryAudioFlowOutput> {
  const { storyId, forceRegenerate = false, voiceConfig } = input;

  console.log(`[story-audio-flow] Starting for storyId: ${storyId}, forceRegenerate: ${forceRegenerate}`);

  try {
    await initFirebaseAdminApp();
    const firestore = getFirestore();
    const storyRef = firestore.collection('stories').doc(storyId);

    // Load story document
    const storySnap = await storyRef.get();
    if (!storySnap.exists) {
      return { ok: false, errorMessage: `Story ${storyId} not found` };
    }

    const story = { id: storySnap.id, ...storySnap.data() } as Story;

    // Check if audio already exists and we're not forcing regeneration
    if (!forceRegenerate && story.audioGeneration?.status === 'ready' && story.audioUrl) {
      console.log(`[story-audio-flow] Audio already exists for story ${storyId}`);
      return {
        ok: true,
        audioUrl: story.audioUrl,
        audioMetadata: story.audioMetadata as StoryAudioFlowOutput['audioMetadata'],
      };
    }

    // Validate story has text to narrate
    if (!story.storyText || story.storyText.trim().length === 0) {
      return { ok: false, errorMessage: 'Story has no text to narrate' };
    }

    // Load child profile to get age and voice preference
    let childAge: number | null = null;
    let preferredVoice = DEFAULT_TTS_VOICE;

    if (story.childId) {
      const childSnap = await firestore.collection('children').doc(story.childId).get();
      if (childSnap.exists) {
        const childProfile = childSnap.data() as ChildProfile;
        childAge = calculateAge(childProfile.dateOfBirth);
        // Use child's preferred voice if set
        if (childProfile.preferredVoiceId) {
          preferredVoice = childProfile.preferredVoiceId;
        }
      }
    }

    // Voice from input takes priority
    const voiceId = voiceConfig?.voiceName || preferredVoice;

    // Update status to generating
    await storyRef.update({
      'audioGeneration.status': 'generating',
      'audioGeneration.lastRunAt': FieldValue.serverTimestamp(),
      'audioGeneration.lastErrorMessage': null,
      updatedAt: FieldValue.serverTimestamp(),
    });

    console.log(`[story-audio-flow] Calling ElevenLabs TTS with voice: ${voiceId}, model: ${ELEVENLABS_MODEL}`);

    // Check for API key before initializing client
    const apiKey = process.env.ELEVENLABS_API_KEY;
    if (!apiKey) {
      console.error('[story-audio-flow] ELEVENLABS_API_KEY environment variable not set');
      return { ok: false, errorMessage: 'Text-to-speech service is not configured' };
    }

    // Initialize ElevenLabs client
    const elevenlabs = new ElevenLabsClient({
      apiKey,
    });

    // Resolve placeholders in story text for TTS
    // This replaces $$childId$$ and $$characterId$$ with actual names (using pronunciation if available)
    let textForTTS = story.storyText;
    if (story.storyText.includes('$$')) {
      console.log(`[story-audio-flow] Resolving placeholders in story text`);
      const entityMap = await resolveEntitiesInText(story.storyText);
      textForTTS = await replacePlaceholdersForTTS(story.storyText, entityMap);
      console.log(`[story-audio-flow] Resolved text length: ${textForTTS.length} chars`);
    }

    // Generate audio using ElevenLabs TTS
    // Note: eleven_multilingual_v2 auto-detects language and doesn't support languageCode parameter
    const audioStream = await elevenlabs.textToSpeech.convert(voiceId, {
      text: textForTTS,
      modelId: ELEVENLABS_MODEL,
    });

    // Convert stream to buffer
    const audioBuffer = await streamToBuffer(audioStream as unknown as ReadableStream<Uint8Array>);

    console.log(`[story-audio-flow] Received audio: ${audioBuffer.byteLength} bytes`);

    // ElevenLabs returns MP3 by default
    const mimeType = 'audio/mpeg';
    const fileExtension = 'mp3';

    // Upload to Firebase Storage
    const bucket = await getStoryBucket();
    const downloadToken = randomUUID();
    const storagePath = `stories/${storyId}/audio/narration-${Date.now()}.${fileExtension}`;

    await bucket.file(storagePath).save(audioBuffer, {
      contentType: mimeType,
      resumable: false,
      metadata: {
        cacheControl: 'public,max-age=86400', // Cache for 24 hours
        metadata: {
          storyId,
          parentUid: story.parentUid,
          voiceId: voiceId,
          model: ELEVENLABS_MODEL,
          firebaseStorageDownloadTokens: downloadToken,
        },
      },
    });

    // Generate download URL
    const audioUrl = `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(storagePath)}?alt=media&token=${downloadToken}`;

    console.log(`[story-audio-flow] Uploaded audio to: ${storagePath}`);

    // Estimate duration (rough estimate: ~150 words per minute)
    const wordCount = story.storyText.split(/\s+/).length;
    const estimatedDurationSeconds = Math.round((wordCount / 150) * 60);

    const audioMetadata = {
      storagePath,
      downloadToken,
      durationSeconds: estimatedDurationSeconds,
      voiceId: voiceId,
      sizeBytes: audioBuffer.byteLength,
    };

    // Update story document with audio info
    await storyRef.update({
      audioUrl,
      audioMetadata: {
        ...audioMetadata,
        generatedAt: FieldValue.serverTimestamp(),
        model: ELEVENLABS_MODEL,
      },
      'audioGeneration.status': 'ready',
      'audioGeneration.lastCompletedAt': FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });

    console.log(`[story-audio-flow] Successfully generated audio for story ${storyId}`);

    return {
      ok: true,
      audioUrl,
      audioMetadata,
    };
  } catch (error: any) {
    console.error(`[story-audio-flow] Error:`, error);

    // Update story with error status
    try {
      await initFirebaseAdminApp();
      const firestore = getFirestore();
      await firestore.collection('stories').doc(storyId).update({
        'audioGeneration.status': 'error',
        'audioGeneration.lastErrorMessage': error.message || 'Unknown error',
        updatedAt: FieldValue.serverTimestamp(),
      });
    } catch (updateError) {
      console.error(`[story-audio-flow] Failed to update error status:`, updateError);
    }

    return {
      ok: false,
      errorMessage: error.message || 'Failed to generate audio',
    };
  }
}
