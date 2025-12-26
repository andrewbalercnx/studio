'use server';

/**
 * @fileOverview A flow to generate audio narration for stories using Gemini Pro TTS.
 * Generates high-quality audio optimized for children's stories with UK English.
 */

import { initFirebaseAdminApp } from '@/firebase/admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { getStoryBucket } from '@/firebase/admin/storage';
import { randomUUID } from 'crypto';
import { GoogleGenAI } from '@google/genai';
import type { Story, ChildProfile } from '@/lib/types';
import { DEFAULT_TTS_VOICE } from '@/lib/tts-config';
import type { StoryAudioFlowInput, StoryAudioFlowOutput } from '@/lib/tts-config';

/**
 * Convert raw PCM audio data to WAV format by adding proper headers.
 * Gemini TTS returns audio/L16 (16-bit linear PCM) which browsers cannot play directly.
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
  wavBuffer.writeUInt32LE(16, 16); // Subchunk1Size (16 for PCM)
  wavBuffer.writeUInt16LE(1, 20); // AudioFormat (1 for PCM)
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
 * Main flow to generate audio narration for a story using Gemini Pro TTS
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
        // Use child's preferred voice if set
        if (childProfile.preferredVoiceId) {
          preferredVoice = childProfile.preferredVoiceId;
        }
      }
    }

    // Voice from input takes priority
    const voiceName = voiceConfig?.voiceName || preferredVoice;

    // Update status to generating
    await storyRef.update({
      'audioGeneration.status': 'generating',
      'audioGeneration.lastRunAt': FieldValue.serverTimestamp(),
      'audioGeneration.lastErrorMessage': null,
      updatedAt: FieldValue.serverTimestamp(),
    });

    // Build the prompt for Gemini TTS
    // Use UK English and age-appropriate reading style
    const ageHint = childAge ? `${childAge} year old` : 'young';

    // Build pronunciation guidance if available
    let pronunciationHint = '';
    if (childName && namePronunciation) {
      pronunciationHint = `\n\nIMPORTANT: The name "${childName}" should be pronounced as "${namePronunciation}".`;
    }

    const prompt = `Read aloud in a way suitable for a ${ageHint} child. Use a British English accent. Read warmly and engagingly, with appropriate pauses and expression for a bedtime story.${pronunciationHint}\n\n${story.storyText}`;

    console.log(`[story-audio-flow] Calling Gemini Pro TTS with voice: ${voiceName}, age hint: ${ageHint}${namePronunciation ? `, pronunciation hint for ${childName}` : ''}`);

    // Initialize Gemini client
    const genai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });

    // Generate audio using Gemini Pro TTS
    const response = await genai.models.generateContent({
      model: 'gemini-2.5-pro-preview-tts',
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

    // Extract audio data from response
    const audioData = response.candidates?.[0]?.content?.parts?.[0]?.inlineData;
    if (!audioData?.data) {
      throw new Error('Gemini TTS returned no audio content');
    }

    // Decode base64 audio data
    const rawAudioBuffer = Buffer.from(audioData.data, 'base64');
    const rawMimeType = audioData.mimeType || 'audio/wav';

    console.log(`[story-audio-flow] Received audio: ${rawAudioBuffer.byteLength} bytes, type: ${rawMimeType}`);

    // Convert PCM to WAV if needed (Gemini TTS returns audio/L16 which browsers can't play)
    let audioBuffer: Buffer;
    let mimeType: string;
    let fileExtension: string;

    if (rawMimeType.includes('L16') || rawMimeType.includes('pcm')) {
      const sampleRate = parseSampleRate(rawMimeType);
      console.log(`[story-audio-flow] Converting PCM to WAV (sample rate: ${sampleRate})`);
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
      // Default: assume it might be PCM and convert to be safe
      console.log(`[story-audio-flow] Unknown format ${rawMimeType}, attempting PCM to WAV conversion`);
      audioBuffer = pcmToWav(rawAudioBuffer);
      mimeType = 'audio/wav';
      fileExtension = 'wav';
    }

    console.log(`[story-audio-flow] Final audio: ${audioBuffer.byteLength} bytes, type: ${mimeType}`);

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
          voiceId: voiceName,
          model: 'gemini-2.5-pro-preview-tts',
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
      voiceId: voiceName,
      sizeBytes: audioBuffer.byteLength,
    };

    // Update story document with audio info
    await storyRef.update({
      audioUrl,
      audioMetadata: {
        ...audioMetadata,
        generatedAt: FieldValue.serverTimestamp(),
        model: 'gemini-2.5-pro-preview-tts',
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
