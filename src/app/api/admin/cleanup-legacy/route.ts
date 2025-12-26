import { NextResponse } from 'next/server';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { initFirebaseAdminApp } from '@/firebase/admin/app';
import { requireAdminUser } from '@/lib/server-auth';
import { AuthError } from '@/lib/auth-error';

type CleanupAction = 'delete' | 'archive' | 'preview';

type CleanupRequest = {
  action: CleanupAction;
  targets: Array<{
    type: 'legacy_outputs' | 'orphaned_storybooks' | 'invalid_stories';
    storyId?: string;
  }>;
};

type CleanupResult = {
  timestamp: string;
  action: CleanupAction;
  results: Array<{
    type: string;
    documentsFound: number;
    documentsProcessed: number;
    paths: string[];
    errors: string[];
  }>;
};

async function cleanupLegacyOutputs(
  firestore: FirebaseFirestore.Firestore,
  action: CleanupAction,
  storyId?: string
): Promise<{
  documentsFound: number;
  documentsProcessed: number;
  paths: string[];
  errors: string[];
}> {
  const paths: string[] = [];
  const errors: string[] = [];
  let documentsFound = 0;
  let documentsProcessed = 0;

  try {
    // Get stories to check for legacy outputs
    let storiesQuery = firestore.collection('stories').limit(100);
    if (storyId) {
      // Only process specific story
      const storyDoc = await firestore.collection('stories').doc(storyId).get();
      if (!storyDoc.exists) {
        errors.push(`Story ${storyId} not found`);
        return { documentsFound, documentsProcessed, paths, errors };
      }

      const outputsSnap = await storyDoc.ref.collection('outputs').get();
      documentsFound = outputsSnap.size;

      for (const outputDoc of outputsSnap.docs) {
        const outputPath = `stories/${storyId}/outputs/${outputDoc.id}`;
        paths.push(outputPath);

        if (action === 'delete') {
          // Delete pages subcollection first
          const pagesSnap = await outputDoc.ref.collection('pages').get();
          const batch = firestore.batch();
          for (const pageDoc of pagesSnap.docs) {
            batch.delete(pageDoc.ref);
          }
          batch.delete(outputDoc.ref);
          await batch.commit();
          documentsProcessed++;
        } else if (action === 'archive') {
          // Move to deletedOutputs collection for archival
          const data = outputDoc.data();
          await firestore.collection('deletedOutputs').doc(`${storyId}_${outputDoc.id}`).set({
            ...data,
            originalPath: outputPath,
            archivedAt: FieldValue.serverTimestamp(),
          });

          // Then delete
          const pagesSnap = await outputDoc.ref.collection('pages').get();
          const batch = firestore.batch();
          for (const pageDoc of pagesSnap.docs) {
            batch.delete(pageDoc.ref);
          }
          batch.delete(outputDoc.ref);
          await batch.commit();
          documentsProcessed++;
        }
        // For 'preview', just count and list paths
      }
    } else {
      // Process all stories
      const storiesSnap = await storiesQuery.get();

      for (const storyDoc of storiesSnap.docs) {
        const outputsSnap = await storyDoc.ref.collection('outputs').get();
        documentsFound += outputsSnap.size;

        for (const outputDoc of outputsSnap.docs) {
          const outputPath = `stories/${storyDoc.id}/outputs/${outputDoc.id}`;
          paths.push(outputPath);

          if (action === 'delete') {
            const pagesSnap = await outputDoc.ref.collection('pages').get();
            const batch = firestore.batch();
            for (const pageDoc of pagesSnap.docs) {
              batch.delete(pageDoc.ref);
            }
            batch.delete(outputDoc.ref);
            await batch.commit();
            documentsProcessed++;
          } else if (action === 'archive') {
            const data = outputDoc.data();
            await firestore.collection('deletedOutputs').doc(`${storyDoc.id}_${outputDoc.id}`).set({
              ...data,
              originalPath: outputPath,
              archivedAt: FieldValue.serverTimestamp(),
            });

            const pagesSnap = await outputDoc.ref.collection('pages').get();
            const batch = firestore.batch();
            for (const pageDoc of pagesSnap.docs) {
              batch.delete(pageDoc.ref);
            }
            batch.delete(outputDoc.ref);
            await batch.commit();
            documentsProcessed++;
          }
        }
      }
    }
  } catch (error: any) {
    errors.push(`Error processing legacy outputs: ${error.message}`);
  }

  return { documentsFound, documentsProcessed, paths, errors };
}

async function findOrphanedStorybooks(
  firestore: FirebaseFirestore.Firestore,
  action: CleanupAction
): Promise<{
  documentsFound: number;
  documentsProcessed: number;
  paths: string[];
  errors: string[];
}> {
  const paths: string[] = [];
  const errors: string[] = [];
  let documentsFound = 0;
  let documentsProcessed = 0;

  try {
    // Get all stories
    const storiesSnap = await firestore.collection('stories').limit(100).get();

    for (const storyDoc of storiesSnap.docs) {
      const storybooksSnap = await storyDoc.ref.collection('storybooks').get();

      for (const storybookDoc of storybooksSnap.docs) {
        const data = storybookDoc.data();

        // Check if storybook is orphaned (missing required parent references)
        const isOrphaned =
          !data.childId ||
          !data.parentUid ||
          !data.storyId ||
          data.storyId !== storyDoc.id;

        if (isOrphaned) {
          documentsFound++;
          const path = `stories/${storyDoc.id}/storybooks/${storybookDoc.id}`;
          paths.push(path);

          if (action === 'delete') {
            const pagesSnap = await storybookDoc.ref.collection('pages').get();
            const batch = firestore.batch();
            for (const pageDoc of pagesSnap.docs) {
              batch.delete(pageDoc.ref);
            }
            batch.delete(storybookDoc.ref);
            await batch.commit();
            documentsProcessed++;
          }
        }
      }
    }
  } catch (error: any) {
    errors.push(`Error finding orphaned storybooks: ${error.message}`);
  }

  return { documentsFound, documentsProcessed, paths, errors };
}

async function findInvalidStories(
  firestore: FirebaseFirestore.Firestore,
  action: CleanupAction
): Promise<{
  documentsFound: number;
  documentsProcessed: number;
  paths: string[];
  errors: string[];
}> {
  const paths: string[] = [];
  const errors: string[] = [];
  let documentsFound = 0;
  let documentsProcessed = 0;

  try {
    const storiesSnap = await firestore.collection('stories').limit(200).get();

    for (const storyDoc of storiesSnap.docs) {
      const data = storyDoc.data();

      // Check for invalid/incomplete stories
      const isInvalid =
        !data.storySessionId ||
        !data.childId ||
        !data.parentUid ||
        !data.storyText ||
        (typeof data.storyText === 'string' && data.storyText.trim().length === 0);

      if (isInvalid) {
        documentsFound++;
        const path = `stories/${storyDoc.id}`;
        paths.push(path);

        // Don't auto-delete stories - just report them
        // Stories require manual review before deletion
      }
    }
  } catch (error: any) {
    errors.push(`Error finding invalid stories: ${error.message}`);
  }

  return { documentsFound, documentsProcessed, paths, errors };
}

export async function POST(request: Request) {
  try {
    await initFirebaseAdminApp();
    await requireAdminUser(request);

    const body = (await request.json()) as CleanupRequest;
    const { action = 'preview', targets } = body;

    if (!['delete', 'archive', 'preview'].includes(action)) {
      return NextResponse.json({ error: 'Invalid action. Use: delete, archive, or preview' }, { status: 400 });
    }

    if (!targets || !Array.isArray(targets) || targets.length === 0) {
      return NextResponse.json({ error: 'No targets specified' }, { status: 400 });
    }

    const firestore = getFirestore();
    const results: CleanupResult['results'] = [];

    for (const target of targets) {
      let result;

      switch (target.type) {
        case 'legacy_outputs':
          result = await cleanupLegacyOutputs(firestore, action, target.storyId);
          results.push({ type: 'legacy_outputs', ...result });
          break;

        case 'orphaned_storybooks':
          result = await findOrphanedStorybooks(firestore, action);
          results.push({ type: 'orphaned_storybooks', ...result });
          break;

        case 'invalid_stories':
          result = await findInvalidStories(firestore, action);
          results.push({ type: 'invalid_stories', ...result });
          break;

        default:
          results.push({
            type: target.type,
            documentsFound: 0,
            documentsProcessed: 0,
            paths: [],
            errors: [`Unknown target type: ${target.type}`],
          });
      }
    }

    const cleanupResult: CleanupResult = {
      timestamp: new Date().toISOString(),
      action,
      results,
    };

    return NextResponse.json(cleanupResult);
  } catch (error: any) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error('[cleanup-legacy] Error:', error);
    return NextResponse.json({ error: error.message || 'Cleanup failed' }, { status: 500 });
  }
}

// GET endpoint for quick preview of what would be cleaned
export async function GET(request: Request) {
  try {
    await initFirebaseAdminApp();
    await requireAdminUser(request);

    const firestore = getFirestore();

    // Quick count of legacy outputs
    let legacyOutputCount = 0;
    const storiesSnap = await firestore.collection('stories').limit(100).get();
    for (const storyDoc of storiesSnap.docs) {
      const outputsSnap = await storyDoc.ref.collection('outputs').get();
      legacyOutputCount += outputsSnap.size;
    }

    return NextResponse.json({
      preview: true,
      timestamp: new Date().toISOString(),
      legacyOutputsCount: legacyOutputCount,
      message: legacyOutputCount > 0
        ? `Found ${legacyOutputCount} legacy output documents that should be migrated or deleted`
        : 'No legacy output documents found',
      actions: [
        'POST with { "action": "preview", "targets": [{ "type": "legacy_outputs" }] } to see detailed list',
        'POST with { "action": "archive", "targets": [{ "type": "legacy_outputs" }] } to archive and delete',
        'POST with { "action": "delete", "targets": [{ "type": "legacy_outputs" }] } to delete permanently',
      ],
    });
  } catch (error: any) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error('[cleanup-legacy] Error:', error);
    return NextResponse.json({ error: error.message || 'Preview failed' }, { status: 500 });
  }
}
