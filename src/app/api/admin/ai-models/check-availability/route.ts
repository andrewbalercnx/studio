import { NextResponse } from 'next/server';
import { initFirebaseAdminApp } from '@/firebase/admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { requireParentOrAdminUser } from '@/lib/server-auth';
import { AuthError } from '@/lib/auth-error';
import { clearModelConfigCache } from '@/lib/ai-model-config';
import { MODEL_USAGE_MAP } from '@/lib/ai-model-usage-map';
import type { AIModelsConfig, AIModelAvailabilityCheck, AIModelIssue, GoogleAIModelInfo } from '@/lib/types';
import { DEFAULT_AI_MODELS_CONFIG } from '@/lib/types';
import { notifyMaintenanceError } from '@/lib/email/notify-admins';

const AI_MODELS_DOC_PATH = 'systemConfig/aiModels';

// Google AI API endpoint for listing models
const GOOGLE_AI_MODELS_URL = 'https://generativelanguage.googleapis.com/v1beta/models';

/**
 * Fetch available models from the Google AI API
 */
async function fetchAvailableModels(): Promise<GoogleAIModelInfo[]> {
  const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;

  if (!apiKey) {
    throw new Error('GEMINI_API_KEY or GOOGLE_API_KEY environment variable not set');
  }

  const response = await fetch(`${GOOGLE_AI_MODELS_URL}?pageSize=100&key=${apiKey}`);

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Failed to fetch models from Google AI API: ${response.status} ${errorText}`);
  }

  const data = await response.json();
  const models: GoogleAIModelInfo[] = [];

  for (const model of data.models || []) {
    // Determine category based on supported methods and name
    let category: 'text' | 'image' | 'embedding' | 'other' = 'other';
    let isImageGeneration = false;

    const methods = model.supportedGenerationMethods || [];
    const name = model.name || '';

    if (methods.includes('embedContent')) {
      category = 'embedding';
    } else if (name.includes('image') || name.includes('imagen')) {
      category = 'image';
      isImageGeneration = true;
    } else if (methods.includes('generateContent')) {
      // Check if it supports image output
      if (name.includes('image')) {
        category = 'image';
        isImageGeneration = true;
      } else {
        category = 'text';
      }
    }

    models.push({
      name: model.name,
      displayName: model.displayName || model.name,
      description: model.description,
      version: model.version,
      inputTokenLimit: model.inputTokenLimit,
      outputTokenLimit: model.outputTokenLimit,
      supportedGenerationMethods: methods,
      category,
      isImageGeneration,
    });
  }

  return models;
}

/**
 * Convert a Genkit model name to Google AI API format
 * e.g., 'googleai/gemini-2.5-flash-image' -> 'models/gemini-2.5-flash-image'
 */
function toGoogleApiModelName(genkitName: string | undefined | null): string {
  if (!genkitName) {
    return 'models/unknown';
  }
  // Remove the 'googleai/' prefix if present
  const baseName = genkitName.replace(/^googleai\//, '');
  return `models/${baseName}`;
}

/**
 * Check if a model is available in the list of available models
 */
function checkModelAvailability(
  modelName: string,
  configKey: keyof AIModelsConfig,
  availableModels: GoogleAIModelInfo[]
): AIModelIssue | null {
  const googleApiName = toGoogleApiModelName(modelName);

  const found = availableModels.find(m => m.name === googleApiName);

  if (!found) {
    return {
      model: modelName,
      configKey,
      issue: 'unavailable',
      message: `Model "${modelName}" is not available in the Google AI API. It may have been deprecated or renamed.`,
    };
  }

  return null;
}

/**
 * POST: Check availability of configured models against Google AI API
 */
export async function POST(request: Request) {
  try {
    await initFirebaseAdminApp();
    const user = await requireParentOrAdminUser(request);

    if (!user.claims.isAdmin) {
      return NextResponse.json(
        { ok: false, errorMessage: 'Admin access required' },
        { status: 403 }
      );
    }

    const body = await request.json().catch(() => ({}));
    const sendAlerts = body.sendAlerts === true;

    // Fetch available models from Google AI API
    let availableModels: GoogleAIModelInfo[];
    try {
      availableModels = await fetchAvailableModels();
    } catch (fetchError) {
      console.error('[admin/ai-models/check-availability] Failed to fetch models:', fetchError);
      return NextResponse.json({
        ok: false,
        errorMessage: fetchError instanceof Error ? fetchError.message : 'Failed to fetch available models',
      }, { status: 500 });
    }

    // Get current configuration
    const firestore = getFirestore();
    const docRef = firestore.doc(AI_MODELS_DOC_PATH);
    const doc = await docRef.get();

    // Hardcoded fallbacks in case DEFAULT_AI_MODELS_CONFIG import has issues
    const FALLBACK_IMAGE_MODEL = 'googleai/gemini-2.5-flash-image';
    const FALLBACK_PRIMARY_MODEL = 'googleai/gemini-2.5-pro';
    const FALLBACK_LIGHTWEIGHT_MODEL = 'googleai/gemini-2.5-flash';
    const FALLBACK_LEGACY_MODEL = 'googleai/gemini-2.0-flash';

    // Build config with explicit defaults for each field
    // This handles cases where doc exists but is missing some model fields
    const docData = doc.exists ? doc.data() : {};
    const config: AIModelsConfig = {
      imageGenerationModel: docData?.imageGenerationModel || DEFAULT_AI_MODELS_CONFIG?.imageGenerationModel || FALLBACK_IMAGE_MODEL,
      primaryTextModel: docData?.primaryTextModel || DEFAULT_AI_MODELS_CONFIG?.primaryTextModel || FALLBACK_PRIMARY_MODEL,
      lightweightTextModel: docData?.lightweightTextModel || DEFAULT_AI_MODELS_CONFIG?.lightweightTextModel || FALLBACK_LIGHTWEIGHT_MODEL,
      legacyTextModel: docData?.legacyTextModel || DEFAULT_AI_MODELS_CONFIG?.legacyTextModel || FALLBACK_LEGACY_MODEL,
    };

    // If document doesn't have the model fields, seed them now
    if (!doc.exists || !docData?.imageGenerationModel) {
      // Use explicit object to avoid any undefined values
      const seedData = {
        imageGenerationModel: config.imageGenerationModel,
        primaryTextModel: config.primaryTextModel,
        lightweightTextModel: config.lightweightTextModel,
        legacyTextModel: config.legacyTextModel,
        createdAt: FieldValue.serverTimestamp(),
        createdBy: 'system-auto-seed',
      };
      await docRef.set(seedData, { merge: true });
    }

    // Check each configured model
    const issues: AIModelIssue[] = [];

    const modelChecks: Array<{ key: keyof AIModelsConfig; value: string }> = [
      { key: 'imageGenerationModel', value: config.imageGenerationModel },
      { key: 'primaryTextModel', value: config.primaryTextModel },
      { key: 'lightweightTextModel', value: config.lightweightTextModel },
      { key: 'legacyTextModel', value: config.legacyTextModel },
    ];

    for (const { key, value } of modelChecks) {
      const issue = checkModelAvailability(value, key, availableModels);
      if (issue) {
        issues.push(issue);
      }
    }

    // Determine overall status
    let status: 'ok' | 'warning' | 'error' = 'ok';
    if (issues.length > 0) {
      // If image generation model is unavailable, it's an error (critical)
      const hasImageIssue = issues.some(i => i.configKey === 'imageGenerationModel');
      status = hasImageIssue ? 'error' : 'warning';
    }

    // Build availability check result
    const availabilityCheck: AIModelAvailabilityCheck = {
      lastCheckedAt: FieldValue.serverTimestamp(),
      status,
      issues,
      availableModels,
    };

    // Store the check results (without the full model list to save space)
    // Ensure all issue fields are defined to avoid Firestore undefined value errors
    const sanitizedIssues = issues.map(issue => ({
      model: issue.model || 'unknown',
      configKey: issue.configKey || 'unknown',
      issue: issue.issue || 'unknown',
      message: issue.message || 'Unknown issue',
    }));

    const storedCheck = {
      lastCheckedAt: FieldValue.serverTimestamp(),
      status,
      issues: sanitizedIssues,
    };

    await docRef.set({
      availabilityCheck: storedCheck,
    }, { merge: true });

    // Clear cache since we updated the doc
    await clearModelConfigCache();

    // Send alerts if requested and there are issues
    if (sendAlerts && issues.length > 0) {
      const issuesList = issues.map(i => `- ${i.configKey}: ${i.message}`).join('\n');
      await notifyMaintenanceError(firestore, {
        flowName: 'AIModelAvailabilityCheck',
        errorType: status === 'error' ? 'CriticalModelUnavailable' : 'ModelWarning',
        errorMessage: `AI model availability check found ${issues.length} issue(s):\n\n${issuesList}`,
        pagePath: '/admin/ai-models',
        diagnostics: {
          issues,
          configuredModels: {
            imageGenerationModel: config.imageGenerationModel,
            primaryTextModel: config.primaryTextModel,
            lightweightTextModel: config.lightweightTextModel,
            legacyTextModel: config.legacyTextModel,
          },
        },
        timestamp: new Date(),
      });
    }

    // Build response with model info organized by category
    const modelsByCategory = {
      image: availableModels.filter(m => m.category === 'image'),
      text: availableModels.filter(m => m.category === 'text'),
      embedding: availableModels.filter(m => m.category === 'embedding'),
      other: availableModels.filter(m => m.category === 'other'),
    };

    return NextResponse.json({
      ok: true,
      status,
      issues,
      availableModels: modelsByCategory,
      totalModels: availableModels.length,
      configuredModels: {
        imageGenerationModel: {
          model: config.imageGenerationModel,
          status: issues.find(i => i.configKey === 'imageGenerationModel') ? 'unavailable' : 'available',
          usedBy: MODEL_USAGE_MAP.imageGenerationModel,
        },
        primaryTextModel: {
          model: config.primaryTextModel,
          status: issues.find(i => i.configKey === 'primaryTextModel') ? 'unavailable' : 'available',
          usedBy: MODEL_USAGE_MAP.primaryTextModel,
        },
        lightweightTextModel: {
          model: config.lightweightTextModel,
          status: issues.find(i => i.configKey === 'lightweightTextModel') ? 'unavailable' : 'available',
          usedBy: MODEL_USAGE_MAP.lightweightTextModel,
        },
        legacyTextModel: {
          model: config.legacyTextModel,
          status: issues.find(i => i.configKey === 'legacyTextModel') ? 'unavailable' : 'available',
          usedBy: MODEL_USAGE_MAP.legacyTextModel,
        },
      },
      alertsSent: sendAlerts && issues.length > 0,
    });

  } catch (error: unknown) {
    if (error instanceof AuthError) {
      return NextResponse.json(
        { ok: false, errorMessage: error.message },
        { status: error.status }
      );
    }

    console.error('[admin/ai-models/check-availability] POST Error:', error);
    return NextResponse.json(
      { ok: false, errorMessage: error instanceof Error ? error.message : 'Unexpected error' },
      { status: 500 }
    );
  }
}
