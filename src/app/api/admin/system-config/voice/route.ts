import { NextResponse } from 'next/server';
import { initFirebaseAdminApp } from '@/firebase/admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { requireParentOrAdminUser } from '@/lib/server-auth';
import { AuthError } from '@/lib/auth-error';
import type { VoiceConfig } from '@/lib/types';
import { DEFAULT_VOICE_CONFIG } from '@/lib/types';

const VOICE_CONFIG_DOC_PATH = 'systemConfig/voice';

/**
 * GET: Fetch the current voice configuration
 * This endpoint is accessible to all authenticated parents (not just admins)
 * so they can see the recording text when creating a family voice.
 */
export async function GET(request: Request) {
  try {
    await initFirebaseAdminApp();
    await requireParentOrAdminUser(request);

    const firestore = getFirestore();
    const docRef = firestore.doc(VOICE_CONFIG_DOC_PATH);
    const doc = await docRef.get();

    if (!doc.exists) {
      return NextResponse.json({
        ok: true,
        config: DEFAULT_VOICE_CONFIG,
      });
    }

    const config = doc.data() as VoiceConfig;
    return NextResponse.json({
      ok: true,
      config,
    });

  } catch (error: any) {
    if (error instanceof AuthError) {
      return NextResponse.json(
        { ok: false, errorMessage: error.message },
        { status: error.status }
      );
    }

    console.error('[admin/system-config/voice] GET Error:', error);
    return NextResponse.json(
      { ok: false, errorMessage: error?.message || 'Unexpected error' },
      { status: 500 }
    );
  }
}

/**
 * PUT: Update the voice configuration (admin only)
 */
export async function PUT(request: Request) {
  try {
    await initFirebaseAdminApp();
    const user = await requireParentOrAdminUser(request);

    if (!user.claims.isAdmin) {
      return NextResponse.json(
        { ok: false, errorMessage: 'Admin access required' },
        { status: 403 }
      );
    }

    const body = await request.json();
    const { voiceRecordingText } = body;

    if (typeof voiceRecordingText !== 'string') {
      return NextResponse.json(
        { ok: false, errorMessage: 'voiceRecordingText must be a string' },
        { status: 400 }
      );
    }

    const firestore = getFirestore();
    const docRef = firestore.doc(VOICE_CONFIG_DOC_PATH);

    await docRef.set({
      voiceRecordingText,
      updatedAt: FieldValue.serverTimestamp(),
      updatedBy: user.email || user.uid,
    }, { merge: true });

    return NextResponse.json({
      ok: true,
      message: 'Voice configuration updated successfully',
    });

  } catch (error: any) {
    if (error instanceof AuthError) {
      return NextResponse.json(
        { ok: false, errorMessage: error.message },
        { status: error.status }
      );
    }

    console.error('[admin/system-config/voice] PUT Error:', error);
    return NextResponse.json(
      { ok: false, errorMessage: error?.message || 'Unexpected error' },
      { status: 500 }
    );
  }
}
