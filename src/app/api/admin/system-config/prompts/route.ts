import { NextResponse } from 'next/server';
import { initFirebaseAdminApp } from '@/firebase/admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { requireParentOrAdminUser } from '@/lib/server-auth';
import { AuthError } from '@/lib/auth-error';
import { clearGlobalPromptConfigCache } from '@/lib/global-prompt-config.server';
import type { GlobalPromptConfig } from '@/lib/types';
import { DEFAULT_GLOBAL_PROMPT_CONFIG } from '@/lib/types';

const GLOBAL_PROMPT_DOC_PATH = 'systemConfig/prompts';

/**
 * GET: Fetch the current global prompt configuration
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
    const docRef = firestore.doc(GLOBAL_PROMPT_DOC_PATH);
    const doc = await docRef.get();

    if (!doc.exists) {
      return NextResponse.json({
        ok: true,
        config: DEFAULT_GLOBAL_PROMPT_CONFIG,
      });
    }

    const config = doc.data() as GlobalPromptConfig;
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

    console.error('[admin/system-config/prompts] GET Error:', error);
    return NextResponse.json(
      { ok: false, errorMessage: error?.message || 'Unexpected error' },
      { status: 500 }
    );
  }
}

/**
 * PUT: Update the global prompt configuration
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
    const { globalPrefix, enabled } = body;

    if (typeof globalPrefix !== 'string') {
      return NextResponse.json(
        { ok: false, errorMessage: 'globalPrefix must be a string' },
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
    const docRef = firestore.doc(GLOBAL_PROMPT_DOC_PATH);

    await docRef.set({
      globalPrefix,
      enabled,
      updatedAt: FieldValue.serverTimestamp(),
      updatedBy: user.email || user.uid,
    }, { merge: true });

    // Clear the server-side cache so the new config takes effect immediately
    clearGlobalPromptConfigCache();

    return NextResponse.json({
      ok: true,
      message: 'Global prompt configuration updated successfully',
    });

  } catch (error: any) {
    if (error instanceof AuthError) {
      return NextResponse.json(
        { ok: false, errorMessage: error.message },
        { status: error.status }
      );
    }

    console.error('[admin/system-config/prompts] PUT Error:', error);
    return NextResponse.json(
      { ok: false, errorMessage: error?.message || 'Unexpected error' },
      { status: 500 }
    );
  }
}
