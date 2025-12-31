import { NextResponse } from 'next/server';
import { initFirebaseAdminApp } from '@/firebase/admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { requireParentOrAdminUser } from '@/lib/server-auth';
import { AuthError } from '@/lib/auth-error';
import { clearPaginationPromptConfigCache } from '@/lib/pagination-prompt-config.server';
import type { PaginationPromptConfig } from '@/lib/types';
import { DEFAULT_PAGINATION_PROMPT_CONFIG } from '@/lib/types';

const PAGINATION_PROMPT_DOC_PATH = 'systemConfig/paginationPrompt';

/**
 * GET: Fetch the current pagination prompt configuration
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
    const docRef = firestore.doc(PAGINATION_PROMPT_DOC_PATH);
    const doc = await docRef.get();

    if (!doc.exists) {
      return NextResponse.json({
        ok: true,
        config: DEFAULT_PAGINATION_PROMPT_CONFIG,
      });
    }

    const config = doc.data() as PaginationPromptConfig;
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

    console.error('[admin/system-config/pagination-prompt] GET Error:', error);
    const message = error instanceof Error ? error.message : 'Unexpected error';
    return NextResponse.json(
      { ok: false, errorMessage: message },
      { status: 500 }
    );
  }
}

/**
 * PUT: Update the pagination prompt configuration
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
    const { paginationPrompt, enabled } = body;

    if (typeof paginationPrompt !== 'string') {
      return NextResponse.json(
        { ok: false, errorMessage: 'paginationPrompt must be a string' },
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
    const docRef = firestore.doc(PAGINATION_PROMPT_DOC_PATH);

    await docRef.set({
      paginationPrompt,
      enabled,
      updatedAt: FieldValue.serverTimestamp(),
      updatedBy: user.email || user.uid,
    }, { merge: true });

    // Clear the server-side cache so the new config takes effect immediately
    await clearPaginationPromptConfigCache();

    return NextResponse.json({
      ok: true,
      message: 'Pagination prompt configuration updated successfully',
    });

  } catch (error: unknown) {
    if (error instanceof AuthError) {
      return NextResponse.json(
        { ok: false, errorMessage: error.message },
        { status: error.status }
      );
    }

    console.error('[admin/system-config/pagination-prompt] PUT Error:', error);
    const message = error instanceof Error ? error.message : 'Unexpected error';
    return NextResponse.json(
      { ok: false, errorMessage: message },
      { status: 500 }
    );
  }
}
