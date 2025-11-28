'use server';

import { NextResponse } from 'next/server';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import type { Firestore } from 'firebase-admin/firestore';
import { getStoryBucket } from '@/firebase/admin/storage';
import { randomUUID } from 'crypto';
import { requireParentOrAdminUser } from '@/lib/server-auth';
import { AuthError } from '@/lib/auth-error';
import { initFirebaseAdminApp } from '@/firebase/admin/app';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

type PrintableRequest = {
  bookId: string;
  forceRegenerate?: boolean;
  regressionTag?: string;
};

const PRINT_DPI = 300;
const TRIM_SIZE = '8.5in x 11in';
const PAGE_WIDTH = 8.5 * 72;
const PAGE_HEIGHT = 11 * 72;
const PAGE_MARGIN = 36;

function respondError(status: number, message: string) {
  return NextResponse.json({ ok: false, errorMessage: message }, { status });
}

async function loadStoryBook(firestore: Firestore, bookId: string) {
  const snap = await firestore.collection('storyBooks').doc(bookId).get();
  return snap;
}

async function fetchImageBytes(url: string): Promise<ArrayBuffer | null> {
  try {
    const response = await fetch(url);
    if (!response.ok) {
      console.warn('[printable] Failed to fetch image', url, response.status);
      return null;
    }
    const buffer = await response.arrayBuffer();
    return buffer;
  } catch (error) {
    console.warn('[printable] Image fetch error', url, error);
    return null;
  }
}

async function renderPrintablePdf(pages: Array<Record<string, any>>) {
  const pdfDoc = await PDFDocument.create();
  const bodyFont = await pdfDoc.embedFont(StandardFonts.TimesRoman);
  const titleFont = await pdfDoc.embedFont(StandardFonts.TimesBold);

  for (const page of pages) {
    const pdfPage = pdfDoc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    let cursorY = PAGE_HEIGHT - PAGE_MARGIN;
    const title = page?.title ?? page?.kind?.replace(/_/g, ' ');
    if (title) {
      pdfPage.drawText(String(title), {
        x: PAGE_MARGIN,
        y: cursorY - 24,
        size: 20,
        font: titleFont,
        color: rgb(0.1, 0.1, 0.1),
      });
      cursorY -= 48;
    }

    if (page?.imageUrl) {
      const bytes = await fetchImageBytes(page.imageUrl);
      if (bytes) {
        try {
          let image;
          const buffer = new Uint8Array(bytes);
          try {
            image = await pdfDoc.embedPng(buffer);
          } catch {
            image = await pdfDoc.embedJpg(buffer);
          }
          if (image) {
            const maxWidth = PAGE_WIDTH - PAGE_MARGIN * 2;
            const maxHeight = PAGE_HEIGHT / 2;
            const scale = Math.min(maxWidth / image.width, maxHeight / image.height, 1);
            const drawWidth = image.width * scale;
            const drawHeight = image.height * scale;
            const x = (PAGE_WIDTH - drawWidth) / 2;
            const y = cursorY - drawHeight - 12;
            pdfPage.drawImage(image, { x, y, width: drawWidth, height: drawHeight });
            cursorY = y - 24;
          }
        } catch (error) {
          console.warn('[printable] Failed to embed image', error);
        }
      }
    }

    const bodyText: string = page?.bodyText ?? '';
    if (bodyText) {
      const words = bodyText.split(/\s+/);
      const lines: string[] = [];
      let currentLine = '';
      const maxWidth = PAGE_WIDTH - PAGE_MARGIN * 2;
      for (const word of words) {
        const tentative = currentLine ? `${currentLine} ${word}` : word;
        const width = bodyFont.widthOfTextAtSize(tentative, 14);
        if (width > maxWidth && currentLine) {
          lines.push(currentLine);
          currentLine = word;
        } else {
          currentLine = tentative;
        }
      }
      if (currentLine) lines.push(currentLine);
      for (const line of lines) {
        if (cursorY < PAGE_MARGIN + 40) {
          cursorY = PAGE_HEIGHT - PAGE_MARGIN;
        }
        pdfPage.drawText(line, {
          x: PAGE_MARGIN,
          y: cursorY - 18,
          size: 14,
          font: bodyFont,
          color: rgb(0.15, 0.15, 0.15),
        });
        cursorY -= 20;
      }
    }

    pdfPage.drawText(`Kind: ${page?.kind ?? 'page'} · Page #${page?.pageNumber ?? '?'}`, {
      x: PAGE_MARGIN,
      y: 18,
      size: 10,
      font: bodyFont,
      color: rgb(0.4, 0.4, 0.4),
    });
  }

  return await pdfDoc.save();
}

async function uploadPdf(buffer: Uint8Array, bookId: string, version: number, regressionTag?: string) {
  const bucket = await getStoryBucket();
  const versionLabel = `v${String(version).padStart(3, '0')}`;
  const objectPath = `storybook_printables/${bookId}/${versionLabel}/storybook-${versionLabel}.pdf`;
  const downloadToken = randomUUID();
  const metadata: Record<string, string> = {
    bookId,
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
    const { bookId, regressionTag } = body;
    if (!bookId) {
      return respondError(400, 'Missing bookId');
    }
    const user = await requireParentOrAdminUser(request);
    const firestore = getFirestore();
    const bookSnap = await loadStoryBook(firestore, bookId);
    if (!bookSnap.exists) {
      return respondError(404, 'Storybook not found');
    }
    const bookData = bookSnap.data() as Record<string, any>;
    const parentUid = bookData?.parentUid;
    const isPrivileged = user.claims.isAdmin || user.claims.isWriter;
    if (!isPrivileged && parentUid && parentUid !== user.uid) {
      return respondError(403, 'You do not own this storybook.');
    }
    if (!bookData?.isLocked || !Array.isArray(bookData?.finalizedPages)) {
      return respondError(409, 'Finalize the storybook before generating a printable PDF.');
    }

    await bookSnap.ref.update({
      'storybookFinalization.printableStatus': 'generating',
      'storybookFinalization.printableErrorMessage': null,
    });

    const printableMetadata = {
      dpi: PRINT_DPI,
      trimSize: TRIM_SIZE,
      pageCount: bookData.finalizedPages.length,
      spreadCount: Math.ceil(bookData.finalizedPages.length / 2),
    };
    let printableUrl: string | null = null;

    try {
      const pdfBytes = await renderPrintablePdf(bookData.finalizedPages);
      const upload = await uploadPdf(pdfBytes, bookId, bookData?.storybookFinalization?.version ?? 1, regressionTag);
      printableUrl = upload.url;
      await bookSnap.ref.update({
        'storybookFinalization.printablePdfUrl': upload.url,
        'storybookFinalization.printableGeneratedAt': FieldValue.serverTimestamp(),
        'storybookFinalization.printableStoragePath': upload.objectPath,
        'storybookFinalization.printableMetadata': printableMetadata,
        'storybookFinalization.printableStatus': 'ready',
        'storybookFinalization.status': 'printable_ready',
        ...(regressionTag
          ? {
              regressionTest: true,
              regressionTag,
            }
          : {}),
      });
    } catch (generationError: any) {
      await bookSnap.ref.update({
        'storybookFinalization.printableStatus': 'error',
        'storybookFinalization.printableErrorMessage': generationError?.message ?? 'Failed to generate printable PDF.',
      });
      throw generationError;
    }

    if (bookData.storySessionId) {
      try {
        await firestore
          .collection('storySessions')
          .doc(bookData.storySessionId)
          .collection('events')
          .add({
            event: 'storybook.printable_generated',
            status: 'completed',
            source: 'server',
            attributes: {
              bookId,
              version: bookData?.storybookFinalization?.version ?? 1,
            },
            createdAt: FieldValue.serverTimestamp(),
          });
      } catch (error) {
        console.warn('[printable] Failed to log session event', error);
      }
    }

    return NextResponse.json({
      ok: true,
      bookId,
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
