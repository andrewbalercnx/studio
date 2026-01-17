import { NextResponse } from 'next/server';
import { initFirebaseAdminApp } from '@/firebase/admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { requireParentOrAdminUser } from '@/lib/server-auth';
import { AuthError } from '@/lib/auth-error';
import { clearModelConfigCache } from '@/lib/ai-model-config';
import { MODEL_USAGE_MAP } from '@/lib/ai-model-usage-map';
import type { AIModelsConfig } from '@/lib/types';
import { DEFAULT_AI_MODELS_CONFIG } from '@/lib/types';

const AI_MODELS_DOC_PATH = 'systemConfig/aiModels';

/**
 * GET: Fetch the current AI models configuration
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
    const docRef = firestore.doc(AI_MODELS_DOC_PATH);
    const doc = await docRef.get();

    // Build config with explicit defaults for each field
    // This handles cases where doc exists but is missing some model fields
    const docData = doc.exists ? doc.data() : {};
    const config: AIModelsConfig = {
      imageGenerationModel: docData?.imageGenerationModel || DEFAULT_AI_MODELS_CONFIG.imageGenerationModel,
      primaryTextModel: docData?.primaryTextModel || DEFAULT_AI_MODELS_CONFIG.primaryTextModel,
      lightweightTextModel: docData?.lightweightTextModel || DEFAULT_AI_MODELS_CONFIG.lightweightTextModel,
      legacyTextModel: docData?.legacyTextModel || DEFAULT_AI_MODELS_CONFIG.legacyTextModel,
    };

    let isDefault = false;

    // If document doesn't have the model fields, seed them now
    if (!doc.exists || !docData?.imageGenerationModel) {
      await docRef.set({
        ...config,
        createdAt: FieldValue.serverTimestamp(),
        createdBy: 'system-auto-seed',
      }, { merge: true });
      isDefault = !doc.exists;
    }

    return NextResponse.json({
      ok: true,
      config,
      usageMap: MODEL_USAGE_MAP,
      isDefault,
    });

  } catch (error: unknown) {
    if (error instanceof AuthError) {
      return NextResponse.json(
        { ok: false, errorMessage: error.message },
        { status: error.status }
      );
    }

    console.error('[admin/ai-models] GET Error:', error);
    return NextResponse.json(
      { ok: false, errorMessage: error instanceof Error ? error.message : 'Unexpected error' },
      { status: 500 }
    );
  }
}

/**
 * PUT: Update the AI models configuration
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
    const {
      imageGenerationModel,
      primaryTextModel,
      lightweightTextModel,
      legacyTextModel,
    } = body;

    // Validate required fields
    if (typeof imageGenerationModel !== 'string' || !imageGenerationModel.trim()) {
      return NextResponse.json(
        { ok: false, errorMessage: 'imageGenerationModel must be a non-empty string' },
        { status: 400 }
      );
    }

    if (typeof primaryTextModel !== 'string' || !primaryTextModel.trim()) {
      return NextResponse.json(
        { ok: false, errorMessage: 'primaryTextModel must be a non-empty string' },
        { status: 400 }
      );
    }

    if (typeof lightweightTextModel !== 'string' || !lightweightTextModel.trim()) {
      return NextResponse.json(
        { ok: false, errorMessage: 'lightweightTextModel must be a non-empty string' },
        { status: 400 }
      );
    }

    if (typeof legacyTextModel !== 'string' || !legacyTextModel.trim()) {
      return NextResponse.json(
        { ok: false, errorMessage: 'legacyTextModel must be a non-empty string' },
        { status: 400 }
      );
    }

    const firestore = getFirestore();
    const docRef = firestore.doc(AI_MODELS_DOC_PATH);

    const updateData: Partial<AIModelsConfig> = {
      imageGenerationModel: imageGenerationModel.trim(),
      primaryTextModel: primaryTextModel.trim(),
      lightweightTextModel: lightweightTextModel.trim(),
      legacyTextModel: legacyTextModel.trim(),
      updatedAt: FieldValue.serverTimestamp() as unknown as Date,
      updatedBy: user.email || user.uid,
    };

    await docRef.set(updateData, { merge: true });

    // Clear the server-side cache so the new config takes effect immediately
    await clearModelConfigCache();

    return NextResponse.json({
      ok: true,
      message: 'AI models configuration updated successfully',
    });

  } catch (error: unknown) {
    if (error instanceof AuthError) {
      return NextResponse.json(
        { ok: false, errorMessage: error.message },
        { status: error.status }
      );
    }

    console.error('[admin/ai-models] PUT Error:', error);
    return NextResponse.json(
      { ok: false, errorMessage: error instanceof Error ? error.message : 'Unexpected error' },
      { status: 500 }
    );
  }
}
