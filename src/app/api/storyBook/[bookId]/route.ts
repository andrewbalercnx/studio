import { NextRequest, NextResponse } from 'next/server';
import { getFirestore } from 'firebase-admin/firestore';
import { initFirebaseAdminApp } from '@/firebase/admin/app';
import type { PrintStoryBook } from '@/lib/types';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ bookId: string }> }
) {
  try {
    const { bookId } = await params;

    if (!bookId) {
      return NextResponse.json(
        { error: 'Missing bookId parameter' },
        { status: 400 }
      );
    }

    // Check for query parameters
    const { searchParams } = new URL(request.url);
    const printStoryBookId = searchParams.get('printStoryBookId');
    const storybookId = searchParams.get('storybookId'); // For new model: stories/{storyId}/storybooks/{storybookId}

    await initFirebaseAdminApp();
    const db = getFirestore();

    // Fetch the story document
    const storyDoc = await db.collection('stories').doc(bookId).get();

    if (!storyDoc.exists) {
      return NextResponse.json(
        { error: 'Story not found' },
        { status: 404 }
      );
    }

    const storyData = storyDoc.data();

    // Fetch the storybook output document for finalization data (legacy workflow)
    const storybookOutputDoc = await db
      .collection('stories')
      .doc(bookId)
      .collection('outputs')
      .doc('storybook')
      .get();

    const storybookOutputData = storybookOutputDoc.exists
      ? storybookOutputDoc.data()
      : null;

    // Build finalization data from various sources
    let finalization = storybookOutputData?.finalization || null;
    let printStoryBookData: PrintStoryBook | null = null;
    let storybookSubcollectionData: Record<string, any> | null = null;

    // Debug info
    const debugInfo: Record<string, any> = {
      hasPrintStoryBookId: !!printStoryBookId,
      hasStorybookId: !!storybookId,
      printStoryBookId: printStoryBookId || null,
      storybookId: storybookId || null,
    };

    // Option 1: If storybookId is provided, fetch from the storybooks subcollection
    // This is the new model: stories/{storyId}/storybooks/{storybookId}
    if (storybookId) {
      const storybookDoc = await db
        .collection('stories')
        .doc(bookId)
        .collection('storybooks')
        .doc(storybookId)
        .get();

      debugInfo.storybookSubcollection = {
        requested: true,
        docExists: storybookDoc.exists,
      };

      if (storybookDoc.exists) {
        storybookSubcollectionData = storybookDoc.data() || null;
        debugInfo.storybookSubcollection.hasFinalization = !!storybookSubcollectionData?.finalization;

        // Use finalization data from storybooks subcollection
        if (storybookSubcollectionData?.finalization) {
          finalization = storybookSubcollectionData.finalization;
        }
      } else {
        console.warn(`[storyBook/[bookId]] Storybook subcollection document not found: stories/${bookId}/storybooks/${storybookId}`);
      }
    }

    // Option 2: If printStoryBookId is provided, try to fetch from the printStoryBooks collection first,
    // then fall back to treating it as a storybookId (storybooks subcollection)
    // This handles the case where the ID was incorrectly passed as printStoryBookId but is actually a storybookId
    if (printStoryBookId) {
      const printStoryBookDoc = await db
        .collection('printStoryBooks')
        .doc(printStoryBookId)
        .get();

      debugInfo.printStoryBook = {
        requested: true,
        docExists: printStoryBookDoc.exists,
      };

      if (printStoryBookDoc.exists) {
        const docData = printStoryBookDoc.data();
        debugInfo.printStoryBook.pdfStatus = docData?.pdfStatus;
        printStoryBookData = {
          id: printStoryBookDoc.id,
          ...docData,
        } as PrintStoryBook;

        // Map printStoryBook fields to finalization if PDFs are ready
        const hasPdfs = printStoryBookData.coverPdfUrl && printStoryBookData.interiorPdfUrl;
        if (printStoryBookData.pdfStatus === 'ready' || hasPdfs) {
          finalization = {
            ...finalization,
            status: 'printable_ready',
            printableCoverPdfUrl: printStoryBookData.coverPdfUrl,
            printableInteriorPdfUrl: printStoryBookData.interiorPdfUrl,
            printableMetadata: printStoryBookData.printableMetadata,
          };
        }
      } else {
        // Fallback: try the storybooks subcollection in case printStoryBookId is actually a storybookId
        console.warn(`[storyBook/[bookId]] PrintStoryBook document not found: ${printStoryBookId}, trying storybooks subcollection...`);

        const storybookFallbackDoc = await db
          .collection('stories')
          .doc(bookId)
          .collection('storybooks')
          .doc(printStoryBookId)
          .get();

        debugInfo.printStoryBookFallback = {
          triedStorybooksSubcollection: true,
          docExists: storybookFallbackDoc.exists,
        };

        if (storybookFallbackDoc.exists) {
          const fallbackData = storybookFallbackDoc.data() || null;
          debugInfo.printStoryBookFallback.hasFinalization = !!fallbackData?.finalization;

          // Use finalization data from storybooks subcollection
          if (fallbackData?.finalization) {
            finalization = fallbackData.finalization;
          }
        }
      }
    }

    // Combine the data into a StoryOutput-like structure
    const story = {
      id: storyDoc.id,
      ...storyData,
      title: storyData?.metadata?.title || printStoryBookData?.title || 'Untitled Story',
      // Add finalization data
      finalization,
      // Also include as storybookFinalization for compatibility
      storybookFinalization: finalization,
      // Include printStoryBook data if available
      printStoryBook: printStoryBookData,
      // Debug info for diagnostics
      _debug: debugInfo,
    };

    return NextResponse.json({ story });
  } catch (error: any) {
    console.error('[storyBook/[bookId]] Error:', error);
    return NextResponse.json(
      { error: error?.message || 'Failed to fetch story' },
      { status: 500 }
    );
  }
}
