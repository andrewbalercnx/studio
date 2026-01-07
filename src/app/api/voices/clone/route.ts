import { NextResponse } from 'next/server';
import { ElevenLabsClient } from '@elevenlabs/elevenlabs-js';
import { initFirebaseAdminApp } from '@/firebase/admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { requireParentOrAdminUser } from '@/lib/server-auth';
import { AuthError } from '@/lib/auth-error';
import type { ParentVoice } from '@/lib/types';
import { DEFAULT_TTS_VOICE } from '@/lib/tts-config';

// Allow up to 120 seconds for voice cloning
export const maxDuration = 120;

/**
 * GET: List all cloned voices for the authenticated parent
 */
export async function GET(request: Request) {
  try {
    const authUser = await requireParentOrAdminUser(request);
    await initFirebaseAdminApp();
    const firestore = getFirestore();

    // Fetch all voices for this user
    const voicesSnapshot = await firestore
      .collection('users')
      .doc(authUser.uid)
      .collection('voices')
      .orderBy('createdAt', 'desc')
      .get();

    const voices: ParentVoice[] = voicesSnapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    })) as ParentVoice[];

    return NextResponse.json({
      ok: true,
      voices,
    });
  } catch (e: any) {
    if (e instanceof AuthError) {
      return NextResponse.json(
        { ok: false, errorMessage: e.message },
        { status: e.status }
      );
    }

    console.error('[api/voices/clone] GET Error:', e);
    return NextResponse.json(
      { ok: false, errorMessage: e.message || 'Failed to list voices' },
      { status: 500 }
    );
  }
}

/**
 * POST: Create a new cloned voice from uploaded audio
 * Expects FormData with:
 * - name: string (display name for the voice)
 * - audio: File (audio recording)
 */
export async function POST(request: Request) {
  try {
    const authUser = await requireParentOrAdminUser(request);
    await initFirebaseAdminApp();

    // Parse FormData
    // Note: request.formData() returns the web FormData type which has .get()
    const formData = await request.formData() as unknown as globalThis.FormData;
    const name = formData.get('name') as string;
    const audioFile = formData.get('audio') as File;

    if (!name || typeof name !== 'string' || !name.trim()) {
      return NextResponse.json(
        { ok: false, errorMessage: 'Voice name is required' },
        { status: 400 }
      );
    }

    if (!audioFile || !(audioFile instanceof File)) {
      return NextResponse.json(
        { ok: false, errorMessage: 'Audio file is required' },
        { status: 400 }
      );
    }

    // Validate file size (max 10MB for voice cloning)
    const maxSize = 10 * 1024 * 1024; // 10MB
    if (audioFile.size > maxSize) {
      return NextResponse.json(
        { ok: false, errorMessage: 'Audio file too large (max 10MB)' },
        { status: 400 }
      );
    }

    // Check for API key
    const apiKey = process.env.ELEVENLABS_API_KEY;
    if (!apiKey) {
      console.error('[api/voices/clone] ELEVENLABS_API_KEY environment variable not set');
      return NextResponse.json(
        { ok: false, errorMessage: 'Voice cloning service is not configured. Please contact support.' },
        { status: 503 }
      );
    }

    // Convert File to Buffer for ElevenLabs
    const audioBuffer = Buffer.from(await audioFile.arrayBuffer());

    // Initialize ElevenLabs client
    const elevenlabs = new ElevenLabsClient({ apiKey });

    // Create the voice clone using Instant Voice Cloning (IVC)
    console.log('[api/voices/clone] Creating voice clone for user:', authUser.uid);

    const cloneResponse = await elevenlabs.voices.ivc.create(
      {
        name: `${name.trim()} (${authUser.uid.substring(0, 8)})`, // Include partial UID for uniqueness
        files: [new Blob([audioBuffer], { type: audioFile.type || 'audio/webm' })],
        removeBackgroundNoise: true,
        description: `Family voice created by ${authUser.email || authUser.uid}`,
      },
      {
        timeoutInSeconds: 90,
        maxRetries: 1,
      }
    );

    const elevenLabsVoiceId = cloneResponse.voiceId;
    console.log('[api/voices/clone] Voice created with ID:', elevenLabsVoiceId);

    // Upload the original audio to Firebase Storage for backup
    const storage = getStorage();
    const bucket = storage.bucket();
    const storagePath = `users/${authUser.uid}/voice-samples/${elevenLabsVoiceId}.webm`;
    const file = bucket.file(storagePath);

    await file.save(audioBuffer, {
      metadata: {
        contentType: audioFile.type || 'audio/webm',
        metadata: {
          uploadedBy: authUser.uid,
          voiceName: name.trim(),
        },
      },
    });

    // Make the file publicly accessible for playback
    await file.makePublic();
    const sampleAudioUrl = `https://storage.googleapis.com/${bucket.name}/${storagePath}`;

    // Store voice metadata in Firestore
    const firestore = getFirestore();
    const voiceData: Omit<ParentVoice, 'id'> = {
      parentUid: authUser.uid,
      name: name.trim(),
      elevenLabsVoiceId,
      sampleAudioUrl,
      sampleStoragePath: storagePath,
      createdAt: FieldValue.serverTimestamp(),
    };

    // Use the ElevenLabs voice ID as the document ID for easy lookup
    await firestore
      .collection('users')
      .doc(authUser.uid)
      .collection('voices')
      .doc(elevenLabsVoiceId)
      .set(voiceData);

    const voice: ParentVoice = {
      id: elevenLabsVoiceId,
      ...voiceData,
      createdAt: new Date(), // For immediate client use
    };

    console.log('[api/voices/clone] Voice metadata saved to Firestore');

    return NextResponse.json({
      ok: true,
      voice,
    });
  } catch (e: any) {
    if (e instanceof AuthError) {
      return NextResponse.json(
        { ok: false, errorMessage: e.message },
        { status: e.status }
      );
    }

    console.error('[api/voices/clone] POST Error:', e);

    // Handle specific ElevenLabs errors
    const errorMessage = e.message || 'Failed to create voice';
    if (errorMessage.includes('quota') || errorMessage.includes('limit')) {
      return NextResponse.json(
        { ok: false, errorMessage: 'Voice cloning limit reached. Please try again later or contact support.' },
        { status: 429 }
      );
    }

    return NextResponse.json(
      { ok: false, errorMessage },
      { status: 500 }
    );
  }
}

/**
 * DELETE: Delete a cloned voice
 * Expects JSON body with:
 * - voiceId: string (ElevenLabs voice ID)
 */
export async function DELETE(request: Request) {
  try {
    const authUser = await requireParentOrAdminUser(request);
    await initFirebaseAdminApp();

    const body = await request.json();
    const { voiceId } = body;

    if (!voiceId || typeof voiceId !== 'string') {
      return NextResponse.json(
        { ok: false, errorMessage: 'Voice ID is required' },
        { status: 400 }
      );
    }

    const firestore = getFirestore();

    // Verify the voice belongs to this user
    const voiceDoc = await firestore
      .collection('users')
      .doc(authUser.uid)
      .collection('voices')
      .doc(voiceId)
      .get();

    if (!voiceDoc.exists) {
      return NextResponse.json(
        { ok: false, errorMessage: 'Voice not found' },
        { status: 404 }
      );
    }

    const voiceData = voiceDoc.data() as ParentVoice;

    // Check for API key
    const apiKey = process.env.ELEVENLABS_API_KEY;
    if (!apiKey) {
      console.error('[api/voices/clone] ELEVENLABS_API_KEY environment variable not set');
      return NextResponse.json(
        { ok: false, errorMessage: 'Voice service is not configured. Please contact support.' },
        { status: 503 }
      );
    }

    // Delete from ElevenLabs
    const elevenlabs = new ElevenLabsClient({ apiKey });

    try {
      await elevenlabs.voices.delete(voiceId, {
        timeoutInSeconds: 30,
      });
      console.log('[api/voices/clone] Voice deleted from ElevenLabs:', voiceId);
    } catch (deleteError: any) {
      // Log but continue - voice may have already been deleted from ElevenLabs
      console.warn('[api/voices/clone] Failed to delete from ElevenLabs (may already be deleted):', deleteError.message);
    }

    // Delete audio sample from Storage if exists
    if (voiceData.sampleStoragePath) {
      try {
        const storage = getStorage();
        const bucket = storage.bucket();
        await bucket.file(voiceData.sampleStoragePath).delete();
        console.log('[api/voices/clone] Audio sample deleted from Storage');
      } catch (storageError: any) {
        console.warn('[api/voices/clone] Failed to delete audio sample:', storageError.message);
      }
    }

    // Delete from Firestore
    await firestore
      .collection('users')
      .doc(authUser.uid)
      .collection('voices')
      .doc(voiceId)
      .delete();

    console.log('[api/voices/clone] Voice metadata deleted from Firestore');

    // Update any children using this voice to use the default voice
    const childrenSnapshot = await firestore
      .collection('children')
      .where('ownerParentUid', '==', authUser.uid)
      .where('preferredVoiceId', '==', voiceId)
      .get();

    let childrenUpdated = 0;
    if (!childrenSnapshot.empty) {
      const batch = firestore.batch();
      childrenSnapshot.docs.forEach((doc) => {
        batch.update(doc.ref, { preferredVoiceId: DEFAULT_TTS_VOICE });
        childrenUpdated++;
      });
      await batch.commit();
      console.log('[api/voices/clone] Updated', childrenUpdated, 'children to default voice');
    }

    return NextResponse.json({
      ok: true,
      childrenUpdated,
    });
  } catch (e: any) {
    if (e instanceof AuthError) {
      return NextResponse.json(
        { ok: false, errorMessage: e.message },
        { status: e.status }
      );
    }

    console.error('[api/voices/clone] DELETE Error:', e);
    return NextResponse.json(
      { ok: false, errorMessage: e.message || 'Failed to delete voice' },
      { status: 500 }
    );
  }
}
