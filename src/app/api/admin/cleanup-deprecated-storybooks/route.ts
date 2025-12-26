import { NextResponse } from 'next/server';
import { headers } from 'next/headers';
import { initFirebaseAdminApp } from '@/firebase/admin/app';
import { auth, firestore } from 'firebase-admin';

initFirebaseAdminApp();

/**
 * Cleans up deprecated storybook data from the old model.
 *
 * OLD format (deprecated):
 * - stories/{storyId}/outputs/storybook/pages/{pageId}
 * - Story document fields: selectedImageStyleId, selectedImageStylePrompt,
 *   selectedStoryOutputTypeId, storyBookGeneration, imageGeneration, etc.
 *
 * NEW format:
 * - stories/{storyId}/storybooks/{storybookId}/pages/{pageId}
 * - Story document contains only narrative data
 * - StoryBookOutput contains all output-specific fields
 */
export async function POST() {
  try {
    // Verify authentication
    const headerList = await headers();
    const authorization = headerList.get('Authorization');

    if (!authorization || !authorization.startsWith('Bearer ')) {
      return NextResponse.json(
        { error: 'Unauthorized: No token provided' },
        { status: 401 }
      );
    }

    const token = authorization.split('Bearer ')[1];
    const decodedToken = await auth().verifyIdToken(token);

    // Check if user is admin
    if (!decodedToken?.isAdmin) {
      return NextResponse.json(
        { error: 'Forbidden: Admin access required' },
        { status: 403 }
      );
    }

    const db = firestore();
    const storiesRef = db.collection('stories');
    const storiesSnapshot = await storiesRef.get();

    let storiesProcessed = 0;
    let outputsDeleted = 0;
    let pagesDeleted = 0;
    let fieldsCleared = 0;
    const errors: string[] = [];

    // Deprecated fields to remove from Story documents
    const deprecatedFields = [
      'selectedImageStyleId',
      'selectedImageStylePrompt',
      'selectedStoryOutputTypeId',
      'storyBookGeneration',
      'imageGeneration',
      'printLayoutId',
      'printOrderId',
      'printStatus',
    ];

    for (const storyDoc of storiesSnapshot.docs) {
      try {
        const storyId = storyDoc.id;
        const storyData = storyDoc.data();

        // Check if this story has the old outputs/storybook subcollection
        const outputsRef = storyDoc.ref.collection('outputs');
        const storybookDoc = await outputsRef.doc('storybook').get();

        if (storybookDoc.exists) {
          // Delete all pages in the old storybook
          const pagesRef = storybookDoc.ref.collection('pages');
          const pagesSnapshot = await pagesRef.get();

          const batch = db.batch();
          let batchCount = 0;

          for (const pageDoc of pagesSnapshot.docs) {
            batch.delete(pageDoc.ref);
            batchCount++;
            pagesDeleted++;

            // Firestore batch limit is 500
            if (batchCount >= 450) {
              await batch.commit();
              batchCount = 0;
            }
          }

          // Delete the storybook document itself
          batch.delete(storybookDoc.ref);
          outputsDeleted++;

          await batch.commit();
        }

        // Clear deprecated fields from the story document
        const fieldsToDelete: Record<string, any> = {};
        for (const field of deprecatedFields) {
          if (storyData[field] !== undefined) {
            fieldsToDelete[field] = firestore.FieldValue.delete();
            fieldsCleared++;
          }
        }

        if (Object.keys(fieldsToDelete).length > 0) {
          await storyDoc.ref.update(fieldsToDelete);
        }

        storiesProcessed++;
      } catch (error: any) {
        errors.push(`Story ${storyDoc.id}: ${error.message}`);
      }
    }

    return NextResponse.json({
      success: errors.length === 0,
      message: errors.length === 0
        ? 'Cleanup completed successfully'
        : 'Cleanup completed with some errors',
      storiesProcessed,
      outputsDeleted,
      pagesDeleted,
      fieldsCleared,
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch (error: any) {
    console.error('Cleanup error:', error);
    return NextResponse.json(
      { error: error.message || 'Cleanup failed' },
      { status: 500 }
    );
  }
}
