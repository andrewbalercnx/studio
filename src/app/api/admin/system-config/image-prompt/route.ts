import { NextResponse } from 'next/server';
import { initFirebaseAdminApp } from '@/firebase/admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { requireParentOrAdminUser } from '@/lib/server-auth';
import { AuthError } from '@/lib/auth-error';
import { clearImagePromptConfigCache } from '@/lib/image-prompt-config.server';
import type { ImagePromptConfig } from '@/lib/types';
import { DEFAULT_IMAGE_PROMPT_CONFIG } from '@/lib/types';

const IMAGE_PROMPT_DOC_PATH = 'systemConfig/imagePrompt';

/**
 * GET: Fetch the current image prompt configuration
 */
export async function GET(request: Request) {
  try {
    await initFirebaseAdminApp();
    const user = await requireParentOrAdminUser(request);

    if (!user.claims.isAdmin) {
      return NextResponse.json(
        { ok: false, errorMessage: 'Admin access required' },
        { status: 403 }
      );
    }

    const firestore = getFirestore();
    const docRef = firestore.doc(IMAGE_PROMPT_DOC_PATH);
    const doc = await docRef.get();

    if (!doc.exists) {
      return NextResponse.json({
        ok: true,
        config: DEFAULT_IMAGE_PROMPT_CONFIG,
      });
    }

    const config = doc.data() as ImagePromptConfig;
    return NextResponse.json({
      ok: true,
      config,
    });

  } catch (error: unknown) {
    if (error instanceof AuthError) {
      return NextResponse.json(
        { ok: false, errorMessage: error.message },
        { status: error.status }
      );
    }

    console.error('[admin/system-config/image-prompt] GET Error:', error);
    const message = error instanceof Error ? error.message : 'Unexpected error';
    return NextResponse.json(
      { ok: false, errorMessage: message },
      { status: 500 }
    );
  }
}

/**
 * PUT: Update the image prompt configuration
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
    const { imagePrompt, enabled } = body;

    if (typeof imagePrompt !== 'string') {
      return NextResponse.json(
        { ok: false, errorMessage: 'imagePrompt must be a string' },
        { status: 400 }
      );
    }

    if (typeof enabled !== 'boolean') {
      return NextResponse.json(
        { ok: false, errorMessage: 'enabled must be a boolean' },
        { status: 400 }
      );
    }

    const firestore = getFirestore();
    const docRef = firestore.doc(IMAGE_PROMPT_DOC_PATH);

    await docRef.set({
      imagePrompt,
      enabled,
      updatedAt: FieldValue.serverTimestamp(),
      updatedBy: user.email || user.uid,
    }, { merge: true });

    // Clear the server-side cache so the new config takes effect immediately
    await clearImagePromptConfigCache();

    return NextResponse.json({
      ok: true,
      message: 'Image prompt configuration updated successfully',
    });

  } catch (error: unknown) {
    if (error instanceof AuthError) {
      return NextResponse.json(
        { ok: false, errorMessage: error.message },
        { status: error.status }
      );
    }

    console.error('[admin/system-config/image-prompt] PUT Error:', error);
    const message = error instanceof Error ? error.message : 'Unexpected error';
    return NextResponse.json(
      { ok: false, errorMessage: message },
      { status: 500 }
    );
  }
}
