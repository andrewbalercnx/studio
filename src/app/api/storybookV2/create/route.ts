import { NextResponse } from 'next/server';
import { initFirebaseAdminApp } from '@/firebase/admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { createLogger, generateRequestId } from '@/lib/server-logger';
import { requireAuthenticatedUser } from '@/lib/server-auth';
import { AuthError } from '@/lib/auth-error';

/**
 * POST /api/storybookV2/create
 *
 * Creates a new StoryBookOutput document for a story.
 * This endpoint handles all the server-side logic for storybook creation:
 * - Validates ownership (story belongs to authenticated user)
 * - Looks up print layout dimensions from the output type
 * - Creates the StoryBookOutput document with proper initialization
 *
 * Request body:
 * - storyId: string - The story to create a storybook for
 * - outputTypeId: string - The story output type (e.g., "picture-book", "poem")
 * - styleId: string - The image style ID
 * - imageStylePrompt: string - The style prompt for image generation
 *
 * Response:
 * - ok: boolean
 * - storybookId: string - The ID of the created storybook
 * - errorMessage?: string
 */
export async function POST(request: Request) {
  const requestId = generateRequestId();
  const logger = createLogger({ route: '/api/storybookV2/create', method: 'POST', requestId });

  try {
    // Verify authentication
    const user = await requireAuthenticatedUser(request);
    const uid = user.uid;

    // Parse request body
    const { storyId, outputTypeId, styleId, imageStylePrompt } = await request.json();
    logger.info('Request received', { storyId, outputTypeId, styleId, uid });

    // Validate required fields
    if (!storyId || typeof storyId !== 'string') {
      return NextResponse.json({ ok: false, errorMessage: 'Missing storyId', requestId }, { status: 400 });
    }
    if (!outputTypeId || typeof outputTypeId !== 'string') {
      return NextResponse.json({ ok: false, errorMessage: 'Missing outputTypeId', requestId }, { status: 400 });
    }
    if (!styleId || typeof styleId !== 'string') {
      return NextResponse.json({ ok: false, errorMessage: 'Missing styleId', requestId }, { status: 400 });
    }
    if (!imageStylePrompt || typeof imageStylePrompt !== 'string') {
      return NextResponse.json({ ok: false, errorMessage: 'Missing imageStylePrompt', requestId }, { status: 400 });
    }

    await initFirebaseAdminApp();
    const firestore = getFirestore();

    // Get the story document
    const storyRef = firestore.collection('stories').doc(storyId);
    const storySnap = await storyRef.get();
    if (!storySnap.exists) {
      return NextResponse.json({ ok: false, errorMessage: 'Story not found', requestId }, { status: 404 });
    }

    const storyData = storySnap.data();

    // Verify ownership
    if (storyData?.parentUid !== uid) {
      logger.warn('Ownership verification failed', { storyParentUid: storyData?.parentUid, requestUid: uid });
      return NextResponse.json({ ok: false, errorMessage: 'Unauthorized', requestId }, { status: 403 });
    }

    // Get the output type to find the print layout
    const outputTypeRef = firestore.collection('storyOutputTypes').doc(outputTypeId);
    const outputTypeSnap = await outputTypeRef.get();
    if (!outputTypeSnap.exists) {
      return NextResponse.json({ ok: false, errorMessage: 'Output type not found', requestId }, { status: 404 });
    }

    const outputTypeData = outputTypeSnap.data();
    const printLayoutId = outputTypeData?.defaultPrintLayoutId || null;

    // Calculate image dimensions from print layout (if specified)
    let imageWidthPx: number | undefined;
    let imageHeightPx: number | undefined;

    if (printLayoutId) {
      const printLayoutRef = firestore.collection('printLayouts').doc(printLayoutId);
      const printLayoutSnap = await printLayoutRef.get();

      if (printLayoutSnap.exists) {
        const layoutData = printLayoutSnap.data();
        const PRINT_DPI = 300;

        // Calculate dimensions - use spread dimensions if available, otherwise image dimensions
        const widthInches = layoutData?.spreadWidthInches || layoutData?.imageWidthInches;
        const heightInches = layoutData?.spreadHeightInches || layoutData?.imageHeightInches;

        if (widthInches && heightInches) {
          imageWidthPx = Math.round(widthInches * PRINT_DPI);
          imageHeightPx = Math.round(heightInches * PRINT_DPI);
          logger.info('Calculated image dimensions', { printLayoutId, widthInches, heightInches, imageWidthPx, imageHeightPx });
        }
      } else {
        logger.warn('Print layout not found, using defaults', { printLayoutId });
      }
    }

    // Default dimensions if no print layout
    if (!imageWidthPx || !imageHeightPx) {
      // Default to a reasonable size for digital viewing
      imageWidthPx = 1024;
      imageHeightPx = 1024;
      logger.info('Using default image dimensions', { imageWidthPx, imageHeightPx });
    }

    // Create the StoryBookOutput document
    const storybooksCollection = storyRef.collection('storybooks');
    const newStorybookRef = storybooksCollection.doc();

    const storybookData = {
      id: newStorybookRef.id,
      storyId,
      childId: storyData?.childId,
      parentUid: uid,
      storyOutputTypeId: outputTypeId,
      imageStyleId: styleId,
      imageStylePrompt,
      printLayoutId,
      imageWidthPx,
      imageHeightPx,
      pageGeneration: { status: 'idle' },
      imageGeneration: { status: 'idle' },
      title: storyData?.metadata?.title || null,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    };

    await newStorybookRef.set(storybookData);
    logger.info('Created storybook', { storybookId: newStorybookRef.id, storyId });

    return NextResponse.json({
      ok: true,
      storybookId: newStorybookRef.id,
      requestId,
    });
  } catch (error: any) {
    // Handle authentication errors with proper status codes
    if (error instanceof AuthError) {
      const statusCode = error.code === 'UNAUTHENTICATED' ? 401 : 403;
      return NextResponse.json(
        { ok: false, errorMessage: error.message, requestId },
        { status: statusCode }
      );
    }

    logger.error('Unhandled exception', error);
    return NextResponse.json(
      { ok: false, errorMessage: error?.message || 'Failed to create storybook', requestId },
      { status: 500 }
    );
  }
}
