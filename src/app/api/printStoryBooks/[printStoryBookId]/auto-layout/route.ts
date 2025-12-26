import { NextRequest, NextResponse } from 'next/server';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { initFirebaseAdminApp } from '@/firebase/admin/app';
import type { PrintStoryBookPage, PrintLayout, StoryOutputPage } from '@/lib/types';

/**
 * Auto-Layout Engine
 *
 * Distributes story content across pages according to selected print layout
 *
 * Algorithm:
 * 1. Fetch story pages (text and images)
 * 2. Fetch selected print layout
 * 3. Create cover pages (front and back)
 * 4. Create endpaper pages (if needed for hardcover)
 * 5. Distribute interior content across pages
 * 6. Ensure total interior page count is divisible by 4
 */

// Helper to remove undefined values from objects (Firestore doesn't allow undefined)
function removeUndefined<T extends Record<string, any>>(obj: T): Partial<T> {
  const result: any = {};
  for (const key in obj) {
    if (obj[key] !== undefined) {
      result[key] = obj[key];
    }
  }
  return result;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ printStoryBookId: string }> }
) {
  try {
    const { printStoryBookId } = await params;
    console.log('[auto-layout] Starting auto-layout for:', printStoryBookId);
    await initFirebaseAdminApp();
    const db = getFirestore();

    // Parse request body for optional printLayoutId
    let requestBody: { printLayoutId?: string } = {};
    try {
      const text = await request.text();
      console.log('[auto-layout] Request body text:', text);
      if (text) {
        requestBody = JSON.parse(text);
        console.log('[auto-layout] Parsed request body:', requestBody);
      }
    } catch (e) {
      // No body or invalid JSON, continue without it
      console.log('[auto-layout] No request body or invalid JSON:', e);
    }

    // Fetch the PrintStoryBook document
    const printStoryBookRef = db.collection('printStoryBooks').doc(printStoryBookId);
    const printStoryBookDoc = await printStoryBookRef.get();

    if (!printStoryBookDoc.exists) {
      console.error('[auto-layout] Print storybook not found:', printStoryBookId);
      return NextResponse.json(
        { error: 'Print storybook not found' },
        { status: 404 }
      );
    }

    const printStoryBook = printStoryBookDoc.data();
    if (!printStoryBook) {
      console.error('[auto-layout] Print storybook data is invalid');
      return NextResponse.json(
        { error: 'Print storybook data is invalid' },
        { status: 400 }
      );
    }

    // Use printLayoutId from request body if document field is not yet set
    // (This handles the case where serverTimestamp() causes fields to not be immediately readable)
    const printLayoutId = printStoryBook.printLayoutId || requestBody.printLayoutId;

    console.log('[auto-layout] Found print storybook:', {
      storyId: printStoryBook.storyId,
      printLayoutId: printLayoutId,
      fromDocument: !!printStoryBook.printLayoutId,
      fromRequest: !!requestBody.printLayoutId,
    });

    if (!printLayoutId) {
      console.error('[auto-layout] No printLayoutId available');
      return NextResponse.json(
        { error: 'Print layout ID is missing' },
        { status: 400 }
      );
    }

    // Fetch the print layout
    const layoutRef = db.collection('printLayouts').doc(printLayoutId);
    const layoutDoc = await layoutRef.get();

    if (!layoutDoc.exists) {
      console.error('[auto-layout] Print layout not found:', printLayoutId);
      return NextResponse.json(
        { error: 'Print layout not found', details: `Layout ID: ${printLayoutId}` },
        { status: 404 }
      );
    }

    const layout = layoutDoc.data() as PrintLayout;
    console.log('[auto-layout] Found print layout:', layout.id, layout.name);

    // Fetch story pages - support both new and legacy model paths
    // New model: stories/{storyId}/storybooks/{storybookId}/pages
    // Legacy model: stories/{storyId}/outputs/storybook/pages
    let storyPagesSnapshot;
    const storybookId = printStoryBook.storybookId;

    if (storybookId) {
      // New model path
      console.log('[auto-layout] Using new model path with storybookId:', storybookId);
      storyPagesSnapshot = await db
        .collection('stories')
        .doc(printStoryBook.storyId)
        .collection('storybooks')
        .doc(storybookId)
        .collection('pages')
        .orderBy('pageNumber', 'asc')
        .get();
    } else {
      // Legacy model path
      console.log('[auto-layout] Using legacy model path (no storybookId)');
      storyPagesSnapshot = await db
        .collection('stories')
        .doc(printStoryBook.storyId)
        .collection('outputs')
        .doc('storybook')
        .collection('pages')
        .orderBy('pageNumber', 'asc')
        .get();
    }

    console.log('[auto-layout] Found story pages:', storyPagesSnapshot.docs.length);

    const storyPages = storyPagesSnapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    } as StoryOutputPage));

    // Log all page kinds for debugging
    console.log('[auto-layout] All page kinds:', storyPages.map((p: any) => ({ pageNumber: p.pageNumber, kind: p.kind, hasImageUrl: !!p.imageUrl })));

    // Filter interior pages (exclude covers)
    // text: story content pages, image: decorative images, title_page: title/credit page, blank: empty decorative pages
    const textPages = storyPages.filter((p: any) => p.kind === 'text');
    const imagePages = storyPages.filter((p: any) => p.kind === 'image');
    const titlePages = storyPages.filter((p: any) => p.kind === 'title_page');
    const blankPages = storyPages.filter((p: any) => p.kind === 'blank');

    console.log('[auto-layout] Text pages:', textPages.length, 'Image pages:', imagePages.length, 'Title pages:', titlePages.length, 'Blank pages:', blankPages.length);

    // Log image pages with their URLs
    if (imagePages.length > 0) {
      console.log('[auto-layout] Image page URLs:', imagePages.map((p: any) => ({ pageNumber: p.pageNumber, imageUrl: p.imageUrl?.substring(0, 80) })));
    } else {
      console.log('[auto-layout] WARNING: No image pages found! Checking if text pages have imageUrl...');
      const textPagesWithImages = textPages.filter((p: any) => p.imageUrl);
      console.log('[auto-layout] Text pages with imageUrl:', textPagesWithImages.length);
    }

    // Build the print pages array
    const printPages: PrintStoryBookPage[] = [];
    let pageNumber = 1;

    // 1. Front Cover (page 1)
    const frontCover = storyPages.find((p: any) => p.kind === 'cover_front');
    printPages.push(removeUndefined({
      pageNumber: pageNumber++,
      type: 'cover_front',
      displayText: frontCover?.title || printStoryBook.title,
      imageUrl: frontCover?.imageUrl,
      printLayoutId: layout.id,
    }) as PrintStoryBookPage);

    // 2. Front Endpaper (page 2)
    printPages.push(removeUndefined({
      pageNumber: pageNumber++,
      type: 'endpaper_front',
      printLayoutId: layout.id,
    }) as PrintStoryBookPage);

    // 3. Interior Pages
    // For each text page, create a spread with text and corresponding image
    // Note: Images can come from either:
    //   1. Separate "image" pages (imagePages array)
    //   2. The text page itself (textPage.imageUrl)
    const interiorStartPage = pageNumber;

    for (let i = 0; i < textPages.length; i++) {
      const textPage = textPages[i] as any;
      const imagePage = imagePages[i] as any; // Corresponding image page (if separate)

      // Get image URL from either the separate image page OR from the text page itself
      const imageUrl = imagePage?.imageUrl || textPage?.imageUrl;

      console.log(`[auto-layout] Processing text page ${i}: hasText=${!!textPage.displayText || !!textPage.bodyText}, imageUrl=${imageUrl?.substring(0, 60) || 'NONE'}`);

      if (layout.leavesPerSpread === 2) {
        // Two-page spread: text on left, image on right
        printPages.push(removeUndefined({
          pageNumber: pageNumber++,
          type: 'interior',
          displayText: textPage.displayText || textPage.bodyText,
          printLayoutId: layout.id,
        }) as PrintStoryBookPage);

        // Only add image page if we have an image URL
        if (imageUrl) {
          printPages.push(removeUndefined({
            pageNumber: pageNumber++,
            type: 'interior',
            imageUrl: imageUrl,
            printLayoutId: layout.id,
          }) as PrintStoryBookPage);
        } else {
          // Add blank page to maintain spread structure
          printPages.push(removeUndefined({
            pageNumber: pageNumber++,
            type: 'interior',
            printLayoutId: layout.id,
          }) as PrintStoryBookPage);
        }
      } else {
        // Single page: text and image on same page
        printPages.push(removeUndefined({
          pageNumber: pageNumber++,
          type: 'interior',
          displayText: textPage.displayText || textPage.bodyText,
          imageUrl: imageUrl,
          printLayoutId: layout.id,
        }) as PrintStoryBookPage);
      }
    }

    // Note: We no longer pad to multiple of 4 here.
    // The printable PDF generation adds a separate padding PDF with blank pages
    // to meet Mixam's requirements (minimum 24 interior pages, multiple of 4).
    // This keeps the storybook content clean and separates concerns.

    // 4. Back Endpaper (second to last page)
    printPages.push(removeUndefined({
      pageNumber: pageNumber++,
      type: 'endpaper_back',
      printLayoutId: layout.id,
    }) as PrintStoryBookPage);

    // 5. Back Cover (last page)
    const backCover = storyPages.find((p: any) => p.kind === 'cover_back');
    printPages.push(removeUndefined({
      pageNumber: pageNumber++,
      type: 'cover_back',
      displayText: backCover?.bodyText,
      imageUrl: backCover?.imageUrl,
      printLayoutId: layout.id,
    }) as PrintStoryBookPage);

    // Update the PrintStoryBook with generated pages
    console.log('[auto-layout] Updating print storybook with', printPages.length, 'pages');
    await printStoryBookRef.update({
      pages: printPages,
      updatedAt: FieldValue.serverTimestamp(),
    });

    console.log('[auto-layout] Auto-layout completed successfully');
    return NextResponse.json({
      success: true,
      pageCount: printPages.length,
      interiorPageCount: printPages.filter((p) => p.type === 'interior').length,
      message: 'Auto-layout completed successfully',
    });
  } catch (error) {
    console.error('[auto-layout] Error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    const errorStack = error instanceof Error ? error.stack : undefined;
    console.error('[auto-layout] Stack:', errorStack);

    return NextResponse.json(
      {
        error: 'Failed to generate auto-layout',
        details: errorMessage,
        stack: errorStack
      },
      { status: 500 }
    );
  }
}
