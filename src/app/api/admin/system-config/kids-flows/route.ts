import { NextResponse } from 'next/server';
import { initFirebaseAdminApp } from '@/firebase/admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { requireParentOrAdminUser } from '@/lib/server-auth';
import { AuthError } from '@/lib/auth-error';
import { clearKidsFlowConfigCache } from '@/lib/kids-flow-config.server';
import type { KidsFlowConfig } from '@/lib/types';
import { DEFAULT_KIDS_FLOW_CONFIG } from '@/lib/types';

const KIDS_FLOW_DOC_PATH = 'systemConfig/kidsFlows';

/**
 * GET: Fetch the current kids flow configuration
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
    const docRef = firestore.doc(KIDS_FLOW_DOC_PATH);
    const doc = await docRef.get();

    if (!doc.exists) {
      return NextResponse.json({
        ok: true,
        config: DEFAULT_KIDS_FLOW_CONFIG,
      });
    }

    const config = doc.data() as KidsFlowConfig;
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

    console.error('[admin/system-config/kids-flows] GET Error:', error);
    return NextResponse.json(
      { ok: false, errorMessage: error?.message || 'Unexpected error' },
      { status: 500 }
    );
  }
}

/**
 * PUT: Update the kids flow configuration
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
    const { wizardEnabled, chatEnabled, gemini3Enabled, gemini4Enabled, friendsEnabled } = body;

    if (typeof wizardEnabled !== 'boolean') {
      return NextResponse.json(
        { ok: false, errorMessage: 'wizardEnabled must be a boolean' },
        { status: 400 }
      );
    }

    if (typeof chatEnabled !== 'boolean') {
      return NextResponse.json(
        { ok: false, errorMessage: 'chatEnabled must be a boolean' },
        { status: 400 }
      );
    }

    if (typeof gemini3Enabled !== 'boolean') {
      return NextResponse.json(
        { ok: false, errorMessage: 'gemini3Enabled must be a boolean' },
        { status: 400 }
      );
    }

    if (typeof gemini4Enabled !== 'boolean') {
      return NextResponse.json(
        { ok: false, errorMessage: 'gemini4Enabled must be a boolean' },
        { status: 400 }
      );
    }

    if (typeof friendsEnabled !== 'boolean') {
      return NextResponse.json(
        { ok: false, errorMessage: 'friendsEnabled must be a boolean' },
        { status: 400 }
      );
    }

    const firestore = getFirestore();
    const docRef = firestore.doc(KIDS_FLOW_DOC_PATH);

    await docRef.set({
      wizardEnabled,
      chatEnabled,
      gemini3Enabled,
      gemini4Enabled,
      friendsEnabled,
      updatedAt: FieldValue.serverTimestamp(),
      updatedBy: user.email || user.uid,
    }, { merge: true });

    // Clear the server-side cache so the new config takes effect immediately
    clearKidsFlowConfigCache();

    return NextResponse.json({
      ok: true,
      message: 'Kids flow configuration updated successfully',
    });

  } catch (error: any) {
    if (error instanceof AuthError) {
      return NextResponse.json(
        { ok: false, errorMessage: error.message },
        { status: error.status }
      );
    }

    console.error('[admin/system-config/kids-flows] PUT Error:', error);
    return NextResponse.json(
      { ok: false, errorMessage: error?.message || 'Unexpected error' },
      { status: 500 }
    );
  }
}
