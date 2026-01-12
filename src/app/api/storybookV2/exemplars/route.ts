import { NextResponse } from 'next/server';
import { actorExemplarFlow } from '@/ai/flows/actor-exemplar-flow';
import { initFirebaseAdminApp } from '@/firebase/admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { createLogger, generateRequestId } from '@/lib/server-logger';
import type { StoryOutputPage, ActorExemplar } from '@/lib/types';

// Allow up to 5 minutes for exemplar generation (multiple actors)
export const maxDuration = 300;

// Process exemplars with limited concurrency to avoid rate limits
const CONCURRENCY_LIMIT = 2;

type ExemplarJobRequest = {
  storyId: string;
  storybookId: string;
  forceRegenerate?: boolean;
};

/**
 * Validate that a value is a valid Firestore document ID.
 */
function isValidDocumentId(id: unknown): id is string {
  return typeof id === 'string' && id.trim().length > 0;
}

/**
 * Extract unique actor IDs from all pages in a storybook
 */
async function extractActorIds(
  firestore: FirebaseFirestore.Firestore,
  storyId: string,
  storybookId: string,
  mainChildId?: string
): Promise<string[]> {
  const pagesSnap = await firestore
    .collection('stories')
    .doc(storyId)
    .collection('storybooks')
    .doc(storybookId)
    .collection('pages')
    .get();

  const actorIds = new Set<string>();

  // Always include the main child
  if (isValidDocumentId(mainChildId)) {
    actorIds.add(mainChildId);
  }

  // Extract entity IDs from all pages
  for (const pageDoc of pagesSnap.docs) {
    const page = pageDoc.data() as StoryOutputPage;
    if (page.entityIds?.length) {
      for (const entityId of page.entityIds) {
        if (isValidDocumentId(entityId)) {
          actorIds.add(entityId);
        }
      }
    }
  }

  return Array.from(actorIds);
}

/**
 * Determine the actor type by checking which collection contains the document
 */
async function determineActorType(
  firestore: FirebaseFirestore.Firestore,
  actorId: string
): Promise<'child' | 'character' | null> {
  // Check children collection first
  const childSnap = await firestore.collection('children').doc(actorId).get();
  if (childSnap.exists) {
    return 'child';
  }

  // Check characters collection
  const charSnap = await firestore.collection('characters').doc(actorId).get();
  if (charSnap.exists) {
    return 'character';
  }

  return null;
}

/**
 * Check if an existing exemplar can be reused
 */
async function findExistingExemplar(
  firestore: FirebaseFirestore.Firestore,
  actorId: string,
  imageStyleId: string
): Promise<ActorExemplar | null> {
  const query = await firestore
    .collection('exemplars')
    .where('actorId', '==', actorId)
    .where('imageStyleId', '==', imageStyleId)
    .where('status', '==', 'ready')
    .limit(1)
    .get();

  if (query.empty) {
    return null;
  }

  return { id: query.docs[0].id, ...query.docs[0].data() } as ActorExemplar;
}

/**
 * API route for generating exemplar character reference sheets for a storybook.
 * This should be called before image generation to create consistent character references.
 */
export async function POST(request: Request) {
  const requestId = generateRequestId();
  const logger = createLogger({ route: '/api/storybookV2/exemplars', method: 'POST', requestId });
  const allLogs: string[] = [];
  const startTime = Date.now();

  try {
    const body = (await request.json()) as ExemplarJobRequest;
    const { storyId, storybookId, forceRegenerate = false } = body;

    logger.info('Request received', { storyId, storybookId, forceRegenerate });

    if (!storyId || typeof storyId !== 'string') {
      logger.warn('Missing storyId in request');
      return NextResponse.json({ ok: false, errorMessage: 'Missing storyId', requestId }, { status: 400 });
    }

    if (!storybookId || typeof storybookId !== 'string') {
      logger.warn('Missing storybookId in request');
      return NextResponse.json({ ok: false, errorMessage: 'Missing storybookId', requestId }, { status: 400 });
    }

    await initFirebaseAdminApp();
    const firestore = getFirestore();

    // Load story document for childId
    const storyRef = firestore.collection('stories').doc(storyId);
    const storySnap = await storyRef.get();
    if (!storySnap.exists) {
      return NextResponse.json({ ok: false, errorMessage: `Story not found at stories/${storyId}` }, { status: 404 });
    }
    const storyData = storySnap.data()!;
    const mainChildId = storyData.childId;

    // Load storybook document
    const storybookRef = storyRef.collection('storybooks').doc(storybookId);
    const storybookSnap = await storybookRef.get();
    if (!storybookSnap.exists) {
      return NextResponse.json(
        { ok: false, errorMessage: `Storybook not found at stories/${storyId}/storybooks/${storybookId}` },
        { status: 404 }
      );
    }

    const storybookData = storybookSnap.data()!;
    if (storybookData.isLocked) {
      return NextResponse.json({ ok: false, errorMessage: 'Storybook is locked.' }, { status: 409 });
    }

    const imageStyleId = storybookData.imageStyleId;
    const imageStylePrompt = storybookData.imageStylePrompt;
    const parentUid = storybookData.parentUid;

    if (!isValidDocumentId(imageStyleId) || !imageStylePrompt) {
      return NextResponse.json(
        { ok: false, errorMessage: 'Storybook missing imageStyleId or imageStylePrompt' },
        { status: 400 }
      );
    }

    // Check if exemplars are already ready (and not forcing regeneration)
    // Also check that actorExemplars is not empty - if it's empty, we need to regenerate
    const existingExemplars = storybookData.actorExemplars || {};
    const hasExistingExemplars = Object.keys(existingExemplars).length > 0;

    if (!forceRegenerate && storybookData.exemplarGeneration?.status === 'ready' && hasExistingExemplars) {
      allLogs.push(`[skip] Exemplars already generated (${Object.keys(existingExemplars).length} actors)`);
      return NextResponse.json({
        ok: true,
        storyId,
        storybookId,
        status: 'ready',
        actorExemplars: existingExemplars,
        logs: allLogs,
        requestId,
      });
    }

    // Log why we're regenerating
    if (storybookData.exemplarGeneration?.status === 'ready' && !hasExistingExemplars) {
      allLogs.push('[regenerate] Status was ready but actorExemplars was empty, regenerating...');
    }

    // Update status to running
    await storybookRef.update({
      'exemplarGeneration.status': 'running',
      'exemplarGeneration.lastRunAt': FieldValue.serverTimestamp(),
      'exemplarGeneration.lastErrorMessage': null,
      updatedAt: FieldValue.serverTimestamp(),
    });

    // Extract all unique actor IDs from the storybook
    const actorIds = await extractActorIds(firestore, storyId, storybookId, mainChildId);
    allLogs.push(`[actors] Found ${actorIds.length} unique actors: ${actorIds.join(', ')}`);

    if (actorIds.length === 0) {
      // No actors to generate exemplars for
      await storybookRef.update({
        'exemplarGeneration.status': 'ready',
        'exemplarGeneration.lastCompletedAt': FieldValue.serverTimestamp(),
        'exemplarGeneration.actorsTotal': 0,
        'exemplarGeneration.actorsReady': 0,
        actorExemplars: {},
        updatedAt: FieldValue.serverTimestamp(),
      });

      return NextResponse.json({
        ok: true,
        storyId,
        storybookId,
        status: 'ready',
        actorExemplars: {},
        logs: allLogs,
        requestId,
      });
    }

    // Initialize progress
    await storybookRef.update({
      'exemplarGeneration.actorsTotal': actorIds.length,
      'exemplarGeneration.actorsReady': 0,
    });

    // Prepare jobs for each actor
    type ExemplarJob = {
      actorId: string;
      actorType: 'child' | 'character';
      existingExemplar: ActorExemplar | null;
    };

    const jobs: ExemplarJob[] = [];
    for (const actorId of actorIds) {
      const actorType = await determineActorType(firestore, actorId);
      if (!actorType) {
        allLogs.push(`[warn] Actor ${actorId} not found in children or characters collection, skipping`);
        continue;
      }

      const existingExemplar = forceRegenerate
        ? null
        : await findExistingExemplar(firestore, actorId, imageStyleId);

      jobs.push({ actorId, actorType, existingExemplar });
    }

    // Process jobs with controlled concurrency
    const results: { actorId: string; exemplarId: string | null; imageUrl: string | null; error?: string }[] = [];
    let actorsReady = 0;

    for (let i = 0; i < jobs.length; i += CONCURRENCY_LIMIT) {
      const batch = jobs.slice(i, i + CONCURRENCY_LIMIT);
      allLogs.push(`[batch] Processing batch ${Math.floor(i / CONCURRENCY_LIMIT) + 1}/${Math.ceil(jobs.length / CONCURRENCY_LIMIT)} (${batch.length} actors)`);

      const batchPromises = batch.map(async (job) => {
        try {
          // Reuse existing exemplar if available
          if (job.existingExemplar) {
            allLogs.push(`[reuse] Reusing existing exemplar ${job.existingExemplar.id} for actor ${job.actorId}`);

            // Track storybook usage
            await firestore.collection('exemplars').doc(job.existingExemplar.id).update({
              usedByStorybookIds: FieldValue.arrayUnion(storybookId),
              updatedAt: FieldValue.serverTimestamp(),
            });

            return {
              actorId: job.actorId,
              exemplarId: job.existingExemplar.id,
              imageUrl: job.existingExemplar.imageUrl!,
            };
          }

          // Generate new exemplar
          allLogs.push(`[generate] Generating exemplar for ${job.actorType} ${job.actorId}`);
          const flowResult = await actorExemplarFlow({
            actorId: job.actorId,
            actorType: job.actorType,
            imageStyleId,
            imageStylePrompt,
            ownerParentUid: parentUid,
            storybookId,
          });

          if (flowResult.ok) {
            allLogs.push(`[success] Generated exemplar ${flowResult.exemplarId} for actor ${job.actorId}`);
            return {
              actorId: job.actorId,
              exemplarId: flowResult.exemplarId,
              imageUrl: flowResult.imageUrl,
            };
          } else {
            allLogs.push(`[error] Failed to generate exemplar for ${job.actorId}: ${flowResult.errorMessage}`);
            return {
              actorId: job.actorId,
              exemplarId: flowResult.exemplarId ?? null,
              imageUrl: null,
              error: flowResult.errorMessage,
            };
          }
        } catch (error: any) {
          const errorMessage = error?.message ?? 'Unknown error';
          allLogs.push(`[error] Exception generating exemplar for ${job.actorId}: ${errorMessage}`);
          return {
            actorId: job.actorId,
            exemplarId: null,
            imageUrl: null,
            error: errorMessage,
          };
        }
      });

      const batchResults = await Promise.all(batchPromises);
      results.push(...batchResults);

      // Update progress after each batch
      actorsReady = results.filter(r => r.imageUrl !== null).length;
      await storybookRef.update({
        'exemplarGeneration.actorsReady': actorsReady,
        updatedAt: FieldValue.serverTimestamp(),
      });
    }

    // Build the actor -> exemplar mapping (only for successful generations)
    const actorExemplars: Record<string, string> = {};
    for (const result of results) {
      if (result.exemplarId && result.imageUrl) {
        actorExemplars[result.actorId] = result.exemplarId;
      }
    }

    // Determine final status
    const failedCount = results.filter(r => r.error).length;
    const finalStatus = failedCount === 0 ? 'ready' : failedCount === results.length ? 'error' : 'ready';
    const errorMessage = failedCount > 0
      ? `${failedCount} of ${results.length} exemplars failed to generate (continuing with fallback for those actors)`
      : null;

    // Update storybook with results
    await storybookRef.update({
      'exemplarGeneration.status': finalStatus,
      'exemplarGeneration.lastCompletedAt': FieldValue.serverTimestamp(),
      'exemplarGeneration.lastErrorMessage': errorMessage,
      'exemplarGeneration.actorsReady': actorsReady,
      actorExemplars,
      updatedAt: FieldValue.serverTimestamp(),
    });

    const durationMs = Date.now() - startTime;
    if (failedCount === 0) {
      logger.info('Request completed successfully', { storyId, storybookId, actorsTotal: jobs.length, actorsReady, durationMs });
    } else {
      logger.warn('Request completed with some failures', { storyId, storybookId, actorsTotal: jobs.length, actorsReady, failedCount, durationMs });
    }

    return NextResponse.json({
      ok: true,
      storyId,
      storybookId,
      status: finalStatus,
      actorsTotal: jobs.length,
      actorsReady,
      failedCount,
      actorExemplars,
      logs: allLogs,
      requestId,
    });
  } catch (error: any) {
    const durationMs = Date.now() - startTime;
    const errorMessage = error?.message ?? 'Unknown error';
    logger.error('Unhandled exception in route', error, { durationMs });

    return NextResponse.json(
      { ok: false, errorMessage, logs: allLogs, requestId },
      { status: 500 }
    );
  }
}
