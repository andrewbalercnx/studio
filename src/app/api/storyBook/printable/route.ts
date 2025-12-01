
'use server';

import { NextResponse } from 'next/server';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import type { Firestore } from 'firebase-admin/firestore';
import { getStoryBucket } from '@/firebase/admin/storage';
import { randomUUID } from 'crypto';
import { requireParentOrAdminUser } from '@/lib/server-auth';
import { AuthError } from '@/lib/auth-error';
import { initFirebaseAdminApp } from '@/firebase/admin/app';
import { PDFDocument, StandardFonts, rgb, PDFFont } from 'pdf-lib';
import type { PrintLayout, StoryOutputPage } from '@/lib/types';

type PrintableRequest = {
  storyId: string;
  outputId: string;
  printLayoutId: string;
  forceRegenerate?: boolean;
  regressionTag?: string;
};

const INCH_TO_POINTS = 72;

function respondError(status: number, message: string) {
  return NextResponse.json({ ok: false, errorMessage: message }, { status });
}

async function loadDocs(firestore: Firestore, storyId: string, outputId: string, printLayoutId: string) {
  const storySnap = await firestore.collection('stories').doc(storyId).get();
  const outputSnap = await storySnap.ref.collection('outputs').doc(outputId).get();
  const printLayoutSnap = await firestore.collection('printLayouts').doc(printLayoutId).get();
  return { storySnap, outputSnap, printLayoutSnap };
}

async function fetchImageBytes(url: string): Promise<{ buffer: ArrayBuffer; mimeType: string } | null> {
  try {
    const response = await fetch(url);
    if (!response.ok) {
      console.warn('[printable] Failed to fetch image', url, response.status);
      return null;
    }
    const buffer = await response.arrayBuffer();
    const mimeType = response.headers.get('content-type') || 'image/jpeg';
    return { buffer, mimeType };
  } catch (error) {
    console.warn('[printable] Image fetch error', url, error);
    return null;
  }
}

async function renderPrintablePdf(pages: StoryOutputPage[], layout: PrintLayout) {
  const pdfDoc = await PDFDocument.create();
  const bodyFont = await pdfDoc.embedFont(StandardFonts.TimesRoman);
  
  for (const page of pages) {
    const pdfPage = pdfDoc.addPage([
      layout.leafWidth * INCH_TO_POINTS,
      layout.leafHeight * INCH_TO_POINTS
    ]);
    const { width: pageWidth, height: pageHeight } = pdfPage.getSize();

    if (page.imageUrl && layout.imageBoxes.length > 0) {
      const imageData = await fetchImageBytes(page.imageUrl);
      if (imageData) {
        try {
          const imageBox = layout.imageBoxes[0]; // Assuming one image box for now
          let image;
          if (imageData.mimeType === 'image/png') {
            image = await pdfDoc.embedPng(imageData.buffer);
          } else {
            image = await pdfDoc.embedJpg(imageData.buffer);
          }

          if (image) {
            const box = {
              x: imageBox.x * INCH_TO_POINTS,
              y: imageBox.y * INCH_TO_POINTS,
              width: imageBox.width * INCH_TO_POINTS,
              height: imageBox.height * INCH_TO_POINTS,
            };
            pdfPage.drawImage(image, {
              x: box.x,
              y: pageHeight - box.y - box.height, // Y is from bottom in PDF-lib
              width: box.width,
              height: box.height,
            });
          }
        } catch (error) {
          console.warn('[printable] Failed to embed image', error);
        }
      }
    }

    if (page.displayText && layout.textBoxes.length > 0) {
        const textBox = layout.textBoxes[0]; // Assuming one text box for now
        const box = {
            x: textBox.x * INCH_TO_POINTS,
            y: textBox.y * INCH_TO_POINTS,
            width: textBox.width * INCH_TO_POINTS,
            height: textBox.height * INCH_TO_POINTS,
        };
        
        pdfPage.drawText(page.displayText, {
            x: box.x,
            y: pageHeight - box.y - 14, // Simple alignment, needs improvement
            font: bodyFont,
            size: 12,
            color: rgb(0, 0, 0),
            maxWidth: box.width,
            lineHeight: 14,
        });
    }
  }

  return await pdfDoc.save();
}

async function uploadPdf(buffer: Uint8Array, storyId: string, outputId: string, version: number, regressionTag?: string) {
  const bucket = await getStoryBucket();
  const versionLabel = `v${String(version).padStart(3, '0')}`;
  const objectPath = `storybook_printables/${storyId}/${outputId}/storybook-${versionLabel}.pdf`;
  const downloadToken = randomUUID();
  const metadata: Record<string, string> = {
    storyId,
    outputId,
    version: String(version),
    firebaseStorageDownloadTokens: downloadToken,
  };
  if (regressionTag) {
    metadata.regressionTag = regressionTag;
    metadata.regressionTest = 'true';
  }
  await bucket.file(objectPath).save(Buffer.from(buffer), {
    resumable: false,
    contentType: 'application/pdf',
    metadata: {
      metadata,
    },
    cacheControl: 'private,max-age=0',
  });
  const url = `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(objectPath)}?alt=media&token=${downloadToken}`;
  return { url, objectPath };
}

export async function POST(request: Request) {
  try {
    await initFirebaseAdminApp();
    const body = (await request.json()) as PrintableRequest;
    const { storyId, outputId, printLayoutId, regressionTag } = body;
    if (!storyId || !outputId || !printLayoutId) {
      return respondError(400, 'Missing storyId, outputId, or printLayoutId');
    }
    const user = await requireParentOrAdminUser(request);
    const firestore = getFirestore();
    const { storySnap, outputSnap, printLayoutSnap } = await loadDocs(firestore, storyId, outputId, printLayoutId);
    if (!storySnap.exists()) return respondError(404, 'Story not found');
    if (!outputSnap.exists()) return respondError(404, 'Story Output not found');
    if (!printLayoutSnap.exists()) return respondError(404, 'Print Layout not found');
    
    const storyData = storySnap.data() as Record<string, any>;
    const outputData = outputSnap.data() as Record<string, any>;
    const printLayout = printLayoutSnap.data() as PrintLayout;
    
    const parentUid = storyData?.parentUid;
    const isPrivileged = user.claims.isAdmin || user.claims.isWriter;
    if (!isPrivileged && parentUid && parentUid !== user.uid) {
      return respondError(403, 'You do not own this story.');
    }
    
    const finalization = outputData?.finalization;
    if (finalization?.status !== 'finalized') {
       return respondError(409, 'The story output must be finalized before generating a printable PDF.');
    }
    
    const pagesSnap = await outputSnap.ref.collection('pages').orderBy('pageNumber', 'asc').get();
    if (pagesSnap.empty) {
        return respondError(409, 'No pages found for this story output.');
    }
    const pages = pagesSnap.docs.map(doc => doc.data() as StoryOutputPage);

    await outputSnap.ref.update({
      'finalization.printableStatus': 'generating',
      'finalization.printableErrorMessage': null,
    });

    const printableMetadata: PrintableAssetMetadata = {
      dpi: 300,
      trimSize: `${printLayout.leafWidth}in x ${printLayout.leafHeight}in`,
      pageCount: pages.length,
      spreadCount: Math.ceil(pages.length / printLayout.leavesPerSpread),
      printLayoutId: printLayout.id,
    };
    let printableUrl: string | null = null;

    try {
      const pdfBytes = await renderPrintablePdf(pages, printLayout);
      const upload = await uploadPdf(pdfBytes, storyId, outputId, finalization?.version ?? 1, regressionTag);
      printableUrl = upload.url;
      const updateData: Record<string, any> = {
        'finalization.printablePdfUrl': upload.url,
        'finalization.printableGeneratedAt': FieldValue.serverTimestamp(),
        'finalization.printableStoragePath': upload.objectPath,
        'finalization.printableMetadata': printableMetadata,
        'finalization.printableStatus': 'ready',
        'finalization.status': 'printable_ready',
      };
      if (regressionTag) {
        updateData['regressionTag'] = regressionTag;
        updateData['regressionTest'] = true;
      }
      await outputSnap.ref.update(updateData);
    } catch (generationError: any) {
      await outputSnap.ref.update({
        'finalization.printableStatus': 'error',
        'finalization.printableErrorMessage': generationError?.message ?? 'Failed to generate printable PDF.',
      });
      throw generationError;
    }

    if (storyData.storySessionId) {
      try {
        await firestore
          .collection('storySessions')
          .doc(storyData.storySessionId)
          .collection('events')
          .add({
            event: 'storybook.printable_generated',
            status: 'completed',
            source: 'server',
            attributes: {
              storyId,
              outputId,
              version: finalization?.version ?? 1,
            },
            createdAt: FieldValue.serverTimestamp(),
          });
      } catch (error) {
        console.warn('[printable] Failed to log session event', error);
      }
    }

    return NextResponse.json({
      ok: true,
      storyId,
      outputId,
      printablePdfUrl: printableUrl,
      metadata: printableMetadata,
    });
  } catch (error: any) {
    if (error instanceof AuthError) {
      return respondError(error.status, error.message);
    }
    console.error('[storybook/printable] error', error);
    return respondError(500, error?.message ?? 'Unexpected printable error');
  }
}
