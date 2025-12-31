import { NextRequest, NextResponse } from 'next/server';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { initFirebaseAdminApp } from '@/firebase/admin/app';
import { getStoryBucket } from '@/firebase/admin/storage';
import { randomUUID } from 'crypto';
import { PDFDocument, StandardFonts, rgb, PDFFont, PDFPage } from 'pdf-lib';
import type { PrintStoryBook, PrintStoryBookPage, PrintLayout, PrintLayoutPageType } from '@/lib/types';
import { getLayoutForPageType } from '@/lib/print-layout-utils';
import { createLogger, generateRequestId, ConcurrencyLimiter } from '@/lib/server-logger';

const INCH_TO_POINTS = 72;

// Limits for image fetching to prevent resource exhaustion
const IMAGE_FETCH_TIMEOUT_MS = 30000; // 30 second timeout per image
const IMAGE_FETCH_CONCURRENCY = 3; // Max 3 concurrent image fetches
const MAX_IMAGE_SIZE_BYTES = 10 * 1024 * 1024; // 10MB max per image

/**
 * Convert hex color string to RGB values (0-1 range for pdf-lib)
 */
function hexToRgb(hex: string): { r: number; g: number; b: number } {
  // Remove # if present
  const cleanHex = hex.replace('#', '');
  const bigint = parseInt(cleanHex, 16);
  return {
    r: ((bigint >> 16) & 255) / 255,
    g: ((bigint >> 8) & 255) / 255,
    b: (bigint & 255) / 255,
  };
}

/**
 * Calculate a contrasting text color (black or white) based on background luminance
 */
function getContrastingTextColor(backgroundColor: string): { r: number; g: number; b: number } {
  const { r, g, b } = hexToRgb(backgroundColor);
  // Calculate relative luminance using the sRGB formula
  const luminance = 0.299 * r + 0.587 * g + 0.114 * b;
  // Return black for light backgrounds, white for dark backgrounds
  return luminance > 0.5 ? { r: 0, g: 0, b: 0 } : { r: 1, g: 1, b: 1 };
}

/**
 * Draw a rounded rectangle path on a PDF page
 * Note: pdf-lib doesn't have built-in rounded rectangle support, so we use moveTo/lineTo/quadraticCurveTo
 */
function drawRoundedRectangle(
  pdfPage: PDFPage,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
  fillColor: { r: number; g: number; b: number }
) {
  // Clamp radius to half of the smaller dimension
  const maxRadius = Math.min(width, height) / 2;
  const r = Math.min(radius, maxRadius);

  if (r <= 0) {
    // No rounding, just draw a rectangle
    pdfPage.drawRectangle({
      x,
      y,
      width,
      height,
      color: rgb(fillColor.r, fillColor.g, fillColor.b),
    });
    return;
  }

  // Draw rounded rectangle using SVG-like path
  // pdf-lib supports drawing paths with moveTo, lineTo, and bezier curves
  // We'll use the drawRectangle with borderRadius approximation via multiple rectangles and circles
  // For simplicity, we'll use overlapping shapes to create the rounded effect

  const { r: fr, g: fg, b: fb } = fillColor;
  const color = rgb(fr, fg, fb);

  // Main body (inner rectangle without corners)
  pdfPage.drawRectangle({
    x: x + r,
    y: y,
    width: width - 2 * r,
    height: height,
    color,
  });
  pdfPage.drawRectangle({
    x: x,
    y: y + r,
    width: width,
    height: height - 2 * r,
    color,
  });

  // Corner circles (ellipses)
  pdfPage.drawEllipse({
    x: x + r,
    y: y + r,
    xScale: r,
    yScale: r,
    color,
  });
  pdfPage.drawEllipse({
    x: x + width - r,
    y: y + r,
    xScale: r,
    yScale: r,
    color,
  });
  pdfPage.drawEllipse({
    x: x + r,
    y: y + height - r,
    xScale: r,
    yScale: r,
    color,
  });
  pdfPage.drawEllipse({
    x: x + width - r,
    y: y + height - r,
    xScale: r,
    yScale: r,
    color,
  });
}

/**
 * PDF Generation API for PrintStoryBooks
 *
 * Generates separate cover and interior PDFs for Mixam printing
 */

// Map font names to StandardFonts
function getStandardFont(fontName?: string): typeof StandardFonts[keyof typeof StandardFonts] {
  switch (fontName?.toLowerCase()) {
    case 'helvetica':
      return StandardFonts.Helvetica;
    case 'helvetica-bold':
      return StandardFonts.HelveticaBold;
    case 'courier':
      return StandardFonts.Courier;
    case 'timesroman':
    case 'times':
      return StandardFonts.TimesRoman;
    default:
      return StandardFonts.Helvetica;
  }
}

// Shared concurrency limiter for image fetches across all render operations
let imageFetchLimiter: ConcurrencyLimiter | null = null;

function getImageFetchLimiter(): ConcurrencyLimiter {
  if (!imageFetchLimiter) {
    imageFetchLimiter = new ConcurrencyLimiter(IMAGE_FETCH_CONCURRENCY);
  }
  return imageFetchLimiter;
}

async function fetchImageBytes(
  url: string,
  logger?: ReturnType<typeof createLogger>
): Promise<{ buffer: ArrayBuffer; mimeType: string } | null> {
  const limiter = getImageFetchLimiter();

  return limiter.run(async () => {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), IMAGE_FETCH_TIMEOUT_MS);

    try {
      const response = await fetch(url, { signal: controller.signal });
      clearTimeout(timeoutId);

      if (!response.ok) {
        logger?.warn('Failed to fetch image', { url: url.substring(0, 100), status: response.status });
        return null;
      }

      // Check content-length header if available to avoid fetching oversized images
      const contentLength = response.headers.get('content-length');
      if (contentLength && parseInt(contentLength, 10) > MAX_IMAGE_SIZE_BYTES) {
        logger?.warn('Image too large, skipping', { url: url.substring(0, 100), contentLength });
        return null;
      }

      const buffer = await response.arrayBuffer();

      // Double-check actual size after download
      if (buffer.byteLength > MAX_IMAGE_SIZE_BYTES) {
        logger?.warn('Image exceeds size limit after download', { url: url.substring(0, 100), size: buffer.byteLength });
        return null;
      }

      const mimeType = response.headers.get('content-type') || 'image/jpeg';
      return { buffer, mimeType };
    } catch (error) {
      clearTimeout(timeoutId);
      if (error instanceof Error && error.name === 'AbortError') {
        logger?.warn('Image fetch timed out', { url: url.substring(0, 100) });
      } else {
        logger?.warn('Image fetch error', { url: url.substring(0, 100), error: String(error) });
      }
      return null;
    }
  });
}

/**
 * Wraps text to fit within a given width, returning an array of lines
 */
function wrapText(text: string, font: PDFFont, fontSize: number, maxWidth: number): string[] {
  const words = text.split(' ');
  const lines: string[] = [];
  let currentLine = '';

  for (const word of words) {
    const testLine = currentLine ? `${currentLine} ${word}` : word;
    const testWidth = font.widthOfTextAtSize(testLine, fontSize);

    if (testWidth > maxWidth && currentLine) {
      lines.push(currentLine);
      currentLine = word;
    } else {
      currentLine = testLine;
    }
  }

  if (currentLine) {
    lines.push(currentLine);
  }

  return lines;
}

/**
 * Renders a title page with full-page centered text (no image)
 * Text is vertically and horizontally centered on the page
 */
async function renderTitlePage(
  pdfPage: PDFPage,
  page: PrintStoryBookPage,
  layout: PrintLayout,
  bodyFont: PDFFont,
  fontSize: number,
  logger?: ReturnType<typeof createLogger>
) {
  const { width: pageWidth, height: pageHeight } = pdfPage.getSize();
  const lineHeight = fontSize * 1.6; // Slightly more spacing for title pages

  if (!page.displayText) {
    logger?.debug('Title page has no text', { pageNumber: page.pageNumber });
    return;
  }

  logger?.debug('Rendering title page', { pageNumber: page.pageNumber });

  // Split text by newlines to preserve the multi-line format
  // Title page text format: "Title" / written by / "Child name" / on / "Date"
  const textLines = page.displayText.split('\n').map(line => line.trim()).filter(Boolean);

  // Calculate total height of all lines
  const totalTextHeight = textLines.length * lineHeight;

  // Center vertically: start from center point minus half of total height
  const startY = (pageHeight / 2) + (totalTextHeight / 2) - fontSize;

  logger?.debug('Title page layout', { pageNumber: page.pageNumber, lines: textLines.length, startY });

  // Draw each line centered horizontally
  textLines.forEach((line, index) => {
    const lineWidth = bodyFont.widthOfTextAtSize(line, fontSize);
    const centerX = (pageWidth / 2) - (lineWidth / 2);
    const y = startY - (index * lineHeight);

    pdfPage.drawText(line, {
      x: centerX,
      y: y,
      font: bodyFont,
      size: fontSize,
      color: rgb(0, 0, 0),
    });
  });
}

/**
 * Renders a single page with image and/or text
 *
 * Coordinate system notes:
 * - PDF uses bottom-left origin (0,0 is bottom-left)
 * - Layout specifies positions from top-left (y increases downward)
 * - We need to convert: pdfY = pageHeight - layoutY - elementHeight
 *
 * Render order (for proper layering):
 * 1. Image (background layer)
 * 2. Text box background color (middle layer)
 * 3. Text (top layer)
 */
async function renderPageContent(
  pdfPage: PDFPage,
  page: PrintStoryBookPage,
  layout: PrintLayout,
  bodyFont: PDFFont,
  fontSize: number,
  pageType: PrintLayoutPageType = 'inside',
  logger?: ReturnType<typeof createLogger>
) {
  // Special handling for title pages - full page centered text
  if (pageType === 'titlePage') {
    await renderTitlePage(pdfPage, page, layout, bodyFont, fontSize, logger);
    return;
  }

  const { width: pageWidth, height: pageHeight } = pdfPage.getSize();
  const pdfDoc = pdfPage.doc;
  const lineHeight = fontSize * 1.4;

  // Get page-type-specific layout configuration
  const pageLayout = getLayoutForPageType(layout, pageType);

  logger?.debug('Rendering page', { pageNumber: page.pageNumber, type: page.type, pageType, hasImage: !!page.imageUrl, hasText: !!page.displayText });

  // 1. Render image first (background layer)
  if (page.imageUrl) {
    logger?.debug('Fetching image', { pageNumber: page.pageNumber, url: page.imageUrl.substring(0, 100) });
    const imageData = await fetchImageBytes(page.imageUrl, logger);
    if (imageData) {
      logger?.debug('Image fetched', { pageNumber: page.pageNumber, mimeType: imageData.mimeType, size: imageData.buffer.byteLength });
      try {
        let image;
        if (imageData.mimeType.includes('png')) {
          image = await pdfDoc.embedPng(imageData.buffer);
        } else {
          image = await pdfDoc.embedJpg(imageData.buffer);
        }

        if (image) {
          // Use imageBox from page-type layout if available
          const imageBox = pageLayout.imageBox;

          if (!imageBox) {
            // Fill entire page with image (scaled to fit)
            const imgAspect = image.width / image.height;
            const pageAspect = pageWidth / pageHeight;

            let drawWidth = pageWidth;
            let drawHeight = pageHeight;
            let drawX = 0;
            let drawY = 0;

            // Scale to cover the page (may crop)
            if (imgAspect > pageAspect) {
              // Image is wider - fit to height, crop width
              drawHeight = pageHeight;
              drawWidth = pageHeight * imgAspect;
              drawX = (pageWidth - drawWidth) / 2;
            } else {
              // Image is taller - fit to width, crop height
              drawWidth = pageWidth;
              drawHeight = pageWidth / imgAspect;
              drawY = (pageHeight - drawHeight) / 2;
            }

            pdfPage.drawImage(image, {
              x: drawX,
              y: drawY,
              width: drawWidth,
              height: drawHeight,
            });
            logger?.debug('Drew full-page image', { pageNumber: page.pageNumber, x: drawX, y: drawY, width: drawWidth, height: drawHeight });
          } else {
            // Use imageBox from page-type layout
            const boxX = Number(imageBox.x) * INCH_TO_POINTS;
            const boxY = Number(imageBox.y) * INCH_TO_POINTS;
            const boxWidth = Number(imageBox.width) * INCH_TO_POINTS;
            const boxHeight = Number(imageBox.height) * INCH_TO_POINTS;

            // Convert from top-left origin to bottom-left origin
            const pdfY = pageHeight - boxY - boxHeight;

            pdfPage.drawImage(image, {
              x: boxX,
              y: pdfY,
              width: boxWidth,
              height: boxHeight,
            });
            logger?.debug('Drew image in box', { pageNumber: page.pageNumber, x: boxX, y: pdfY, width: boxWidth, height: boxHeight });
          }
        }
      } catch (error) {
        logger?.warn('Failed to embed image', { pageNumber: page.pageNumber, error: String(error) });
      }
    } else {
      logger?.warn('Failed to fetch image for page', { pageNumber: page.pageNumber });
    }
  }

  // 2 & 3. Render text box background and text (if present)
  if (page.displayText) {
    // Get textBox from page-type layout
    const textBox = pageLayout.textBox;

    // Default text box: 1 inch margins
    let textBoxX = 1 * INCH_TO_POINTS;
    let textBoxY = 1 * INCH_TO_POINTS; // From top
    let textBoxWidth = pageWidth - (2 * INCH_TO_POINTS);
    let textBoxHeight = pageHeight - (2 * INCH_TO_POINTS);
    let backgroundColor: string | undefined;
    let textColor: string | undefined;
    let borderRadius = 0; // in points

    // Use textBox from page-type layout if available
    if (textBox) {
      textBoxX = Number(textBox.x) * INCH_TO_POINTS;
      textBoxY = Number(textBox.y) * INCH_TO_POINTS;
      textBoxWidth = Number(textBox.width) * INCH_TO_POINTS;
      textBoxHeight = Number(textBox.height) * INCH_TO_POINTS;
      backgroundColor = textBox.backgroundColor;
      textColor = textBox.textColor;
      borderRadius = (textBox.borderRadius ?? 0) * INCH_TO_POINTS;
    } else if (layout.textBoxes && layout.textBoxes.length > 0) {
      // Fallback to legacy textBoxes array
      const legacyTextBox = layout.textBoxes[0];
      textBoxX = Number(legacyTextBox.x) * INCH_TO_POINTS;
      textBoxY = Number(legacyTextBox.y) * INCH_TO_POINTS;
      textBoxWidth = Number(legacyTextBox.width) * INCH_TO_POINTS;
      textBoxHeight = Number(legacyTextBox.height) * INCH_TO_POINTS;
    }

    // Convert from top-left origin to bottom-left origin for PDF
    const textBoxBottomInPdf = pageHeight - textBoxY - textBoxHeight;

    // 2. Draw text box background color with rounded corners (if specified)
    if (backgroundColor) {
      const bgColor = hexToRgb(backgroundColor);
      drawRoundedRectangle(
        pdfPage,
        textBoxX,
        textBoxBottomInPdf,
        textBoxWidth,
        textBoxHeight,
        borderRadius,
        bgColor
      );
      logger?.debug('Drew text box background', { pageNumber: page.pageNumber, backgroundColor, borderRadius, x: textBoxX, y: textBoxBottomInPdf });
    }

    // Determine text color: explicit textColor, or contrasting color based on background, or default black
    let finalTextColor = { r: 0, g: 0, b: 0 }; // Default black
    if (textColor) {
      finalTextColor = hexToRgb(textColor);
    } else if (backgroundColor) {
      finalTextColor = getContrastingTextColor(backgroundColor);
    }

    // 3. Wrap and render text
    const lines = wrapText(page.displayText, bodyFont, fontSize, textBoxWidth - 20); // Slight padding

    // Text starts at TOP of text box (convert from top-left to bottom-left origin)
    // First line baseline is at: pageHeight - textBoxY - fontSize (approximately)
    const textBoxTopInPdf = pageHeight - textBoxY;
    const firstLineY = textBoxTopInPdf - fontSize - 10; // Position first line baseline with padding

    logger?.debug('Rendering text', { pageNumber: page.pageNumber, lines: lines.length, textBoxX, textBoxY, textBoxWidth, textBoxHeight });

    // Draw each line centered horizontally, starting from top
    lines.forEach((line, index) => {
      const lineWidth = bodyFont.widthOfTextAtSize(line, fontSize);
      const centerX = textBoxX + (textBoxWidth / 2) - (lineWidth / 2);
      const y = firstLineY - (index * lineHeight);

      // Only draw if within text box bounds
      if (y >= textBoxBottomInPdf + 10) { // Add bottom padding
        pdfPage.drawText(line, {
          x: centerX,
          y: y,
          font: bodyFont,
          size: fontSize,
          color: rgb(finalTextColor.r, finalTextColor.g, finalTextColor.b),
        });
      }
    });
  }
}

/**
 * Renders cover PDF - only front cover and back cover (2 pages)
 * Endpapers are part of the binding process, not the cover PDF
 */
async function renderCoverPdf(
  pages: PrintStoryBookPage[],
  layout: PrintLayout,
  logger?: ReturnType<typeof createLogger>
) {
  const pdfDoc = await PDFDocument.create();
  const fontType = getStandardFont(layout.font);
  const bodyFont = await pdfDoc.embedFont(fontType);
  // Ensure fontSize is a number (Firestore may store it as string)
  const fontSize = Number(layout.fontSize) || 32;

  // Cover PDF should only have front cover and back cover
  const frontCover = pages.find((p) => p.type === 'cover_front');
  const backCover = pages.find((p) => p.type === 'cover_back');

  if (!frontCover || !backCover) {
    throw new Error('Cover must have front cover and back cover pages');
  }

  // Add front cover - use 'cover' pageType for front cover layout
  const frontPage = pdfDoc.addPage([
    layout.leafWidth * INCH_TO_POINTS,
    layout.leafHeight * INCH_TO_POINTS,
  ]);
  await renderPageContent(frontPage, frontCover, layout, bodyFont, fontSize, 'cover', logger);

  // Add back cover - use 'backCover' pageType for back cover layout
  const backPage = pdfDoc.addPage([
    layout.leafWidth * INCH_TO_POINTS,
    layout.leafHeight * INCH_TO_POINTS,
  ]);
  await renderPageContent(backPage, backCover, layout, bodyFont, fontSize, 'backCover', logger);

  return await pdfDoc.save();
}

/**
 * Padding configuration for interior PDF
 */
type PaddingConfig = {
  minPageCount: number;      // Minimum pages required (e.g., 24 for hardcover)
  pageCountIncrement: number; // Must be divisible by this (e.g., 4)
};

/**
 * Result from interior PDF rendering including padding info
 */
type InteriorPdfResult = {
  pdfBytes: Uint8Array;
  contentPageCount: number;  // Pages with actual content
  paddingPageCount: number;  // Blank pages added for padding
  totalPageCount: number;    // Total pages in PDF
};

/**
 * Renders interior PDF - includes endpapers and all interior pages
 * Pages alternate: text page, image page (for spread layout)
 * Adds blank padding pages to meet minimum page count and divisibility requirements
 */
async function renderInteriorPdf(
  pages: PrintStoryBookPage[],
  layout: PrintLayout,
  paddingConfig: PaddingConfig,
  logger?: ReturnType<typeof createLogger>
): Promise<InteriorPdfResult> {
  const pdfDoc = await PDFDocument.create();
  const fontType = getStandardFont(layout.font);
  const bodyFont = await pdfDoc.embedFont(fontType);
  // Ensure fontSize is a number (Firestore may store it as string)
  const fontSize = Number(layout.fontSize) || 32;

  // Interior includes endpapers and interior pages
  // Order: front endpaper, interior pages..., back endpaper
  const frontEndpaper = pages.find((p) => p.type === 'endpaper_front');
  const backEndpaper = pages.find((p) => p.type === 'endpaper_back');
  const interiorPages = pages.filter((p) => p.type === 'interior');

  if (interiorPages.length === 0) {
    throw new Error('No interior pages found');
  }

  // Add front endpaper (blank page) - use 'inside' layout
  if (frontEndpaper) {
    const endpaperPage = pdfDoc.addPage([
      layout.leafWidth * INCH_TO_POINTS,
      layout.leafHeight * INCH_TO_POINTS,
    ]);
    await renderPageContent(endpaperPage, frontEndpaper, layout, bodyFont, fontSize, 'inside', logger);
  }

  // Add interior pages - all use 'inside' layout
  for (const page of interiorPages) {
    const pdfPage = pdfDoc.addPage([
      layout.leafWidth * INCH_TO_POINTS,
      layout.leafHeight * INCH_TO_POINTS,
    ]);
    await renderPageContent(pdfPage, page, layout, bodyFont, fontSize, 'inside', logger);
  }

  // Add back endpaper (blank page) - use 'inside' layout
  if (backEndpaper) {
    const endpaperPage = pdfDoc.addPage([
      layout.leafWidth * INCH_TO_POINTS,
      layout.leafHeight * INCH_TO_POINTS,
    ]);
    await renderPageContent(endpaperPage, backEndpaper, layout, bodyFont, fontSize, 'inside', logger);
  }

  // Calculate content pages before padding
  const contentPageCount = pdfDoc.getPageCount();

  // Calculate required total pages:
  // 1. Round up to pageCountIncrement (typically 4)
  // 2. Ensure minimum page count is met
  const { minPageCount, pageCountIncrement } = paddingConfig;
  const roundedUp = Math.ceil(contentPageCount / pageCountIncrement) * pageCountIncrement;
  const requiredPages = Math.max(minPageCount, roundedUp);

  // Add blank padding pages if needed
  const paddingPageCount = requiredPages - contentPageCount;
  if (paddingPageCount > 0) {
    logger?.info('Adding padding pages to meet requirements', {
      contentPageCount,
      requiredPages,
      paddingPageCount,
      minPageCount,
      pageCountIncrement,
    });

    for (let i = 0; i < paddingPageCount; i++) {
      pdfDoc.addPage([
        layout.leafWidth * INCH_TO_POINTS,
        layout.leafHeight * INCH_TO_POINTS,
      ]);
    }
  }

  const totalPageCount = pdfDoc.getPageCount();
  logger?.info('Interior PDF complete', { contentPageCount, paddingPageCount, totalPageCount });

  return {
    pdfBytes: await pdfDoc.save(),
    contentPageCount,
    paddingPageCount,
    totalPageCount,
  };
}

/**
 * Retry helper with exponential backoff for upload operations
 */
async function withRetry<T>(
  operation: () => Promise<T>,
  maxRetries: number = 3,
  baseDelayMs: number = 1000
): Promise<T> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await operation();
    } catch (error: any) {
      lastError = error;
      const isRetryable =
        error.code === 'EPIPE' ||
        error.code === 'ECONNRESET' ||
        error.message?.includes('EPIPE') ||
        error.message?.includes('ECONNRESET') ||
        error.message?.includes('socket hang up');

      if (!isRetryable || attempt === maxRetries - 1) {
        throw error;
      }

      const delay = baseDelayMs * Math.pow(2, attempt);
      console.warn(`[generate-pdfs] Upload failed (attempt ${attempt + 1}/${maxRetries}), retrying in ${delay}ms:`, error.message);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }

  throw lastError;
}

/**
 * Uploads cover PDF to Firebase Storage
 */
async function uploadCoverPdf(
  buffer: Uint8Array,
  printStoryBookId: string
): Promise<{ url: string; storagePath: string }> {
  const bucket = await getStoryBucket();
  const objectPath = `print_storybooks/${printStoryBookId}/cover.pdf`;
  const downloadToken = randomUUID();

  await withRetry(async () => {
    await bucket.file(objectPath).save(Buffer.from(buffer), {
      resumable: true, // Use resumable uploads for reliability
      contentType: 'application/pdf',
      metadata: {
        cacheControl: 'private,max-age=0',
        metadata: {
          printStoryBookId,
          type: 'cover',
          firebaseStorageDownloadTokens: downloadToken,
        },
      },
    });
  });

  const url = `https://firebasestorage.googleapis.com/v0/b/${
    bucket.name
  }/o/${encodeURIComponent(objectPath)}?alt=media&token=${downloadToken}`;

  return { url, storagePath: objectPath };
}

/**
 * Uploads interior PDF to Firebase Storage
 */
async function uploadInteriorPdf(
  buffer: Uint8Array,
  printStoryBookId: string
): Promise<{ url: string; storagePath: string }> {
  const bucket = await getStoryBucket();
  const objectPath = `print_storybooks/${printStoryBookId}/interior.pdf`;
  const downloadToken = randomUUID();

  await withRetry(async () => {
    await bucket.file(objectPath).save(Buffer.from(buffer), {
      resumable: true, // Use resumable uploads for reliability
      contentType: 'application/pdf',
      metadata: {
        cacheControl: 'private,max-age=0',
        metadata: {
          printStoryBookId,
          type: 'interior',
          firebaseStorageDownloadTokens: downloadToken,
        },
      },
    });
  });

  const url = `https://firebasestorage.googleapis.com/v0/b/${
    bucket.name
  }/o/${encodeURIComponent(objectPath)}?alt=media&token=${downloadToken}`;

  return { url, storagePath: objectPath };
}

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ printStoryBookId: string }> }
) {
  const requestId = generateRequestId();
  const logger = createLogger({ route: '/api/printStoryBooks/generate-pdfs', method: 'POST', requestId });

  try {
    const { printStoryBookId } = await params;
    logger.info('PDF generation request received', { printStoryBookId });

    await initFirebaseAdminApp();
    const db = getFirestore();

    // Fetch the PrintStoryBook document
    const printStoryBookRef = db.collection('printStoryBooks').doc(printStoryBookId);
    const printStoryBookDoc = await printStoryBookRef.get();

    if (!printStoryBookDoc.exists) {
      logger.warn('Print storybook not found', { printStoryBookId });
      return NextResponse.json(
        { error: 'Print storybook not found' },
        { status: 404 }
      );
    }

    const printStoryBook = printStoryBookDoc.data() as PrintStoryBook;
    const pageCount = printStoryBook.pages?.length ?? 0;
    const imageCount = printStoryBook.pages?.filter(p => p.imageUrl).length ?? 0;
    logger.info('PrintStoryBook loaded', { printStoryBookId, pageCount, imageCount });

    // Guard against oversized inputs
    if (pageCount > 100) {
      logger.error('Too many pages in storybook', new Error(`Page count ${pageCount} exceeds limit of 100`), { printStoryBookId });
      return NextResponse.json(
        { error: 'Storybook has too many pages (max 100)' },
        { status: 400 }
      );
    }

    // Fetch the print layout
    const layoutRef = db.collection('printLayouts').doc(printStoryBook.printLayoutId);
    const layoutDoc = await layoutRef.get();

    if (!layoutDoc.exists) {
      logger.warn('Print layout not found', { printLayoutId: printStoryBook.printLayoutId });
      return NextResponse.json(
        { error: 'Print layout not found' },
        { status: 404 }
      );
    }

    const layout = { id: layoutDoc.id, ...layoutDoc.data() } as PrintLayout;
    logger.info('Print layout loaded', { printLayoutId: layout.id });

    // Use default padding configuration for hardcover books
    // These are Mixam's requirements for hardcover/case-bound books:
    // - Minimum 24 interior pages (for spine width)
    // - Page count must be divisible by 4
    // NOTE: If we support multiple print products in the future, this should be
    // fetched from a print product document associated with the printStoryBook
    const paddingConfig: PaddingConfig = {
      minPageCount: 24,
      pageCountIncrement: 4,
    };
    logger.info('Using padding config', paddingConfig);

    // Update status to generating
    await printStoryBookRef.update({
      pdfStatus: 'generating_pdfs',
      updatedAt: FieldValue.serverTimestamp(),
    });

    const startTime = Date.now();

    try {
      // Generate cover and interior PDFs
      // Note: These run in parallel but each uses the ConcurrencyLimiter for image fetching
      logger.info('Starting PDF generation', { printStoryBookId, paddingConfig });
      const [coverBytes, interiorResult] = await Promise.all([
        renderCoverPdf(printStoryBook.pages, layout, logger),
        renderInteriorPdf(printStoryBook.pages, layout, paddingConfig, logger),
      ]);

      const generationDurationMs = Date.now() - startTime;
      logger.info('PDF generation completed', {
        printStoryBookId,
        generationDurationMs,
        coverSize: coverBytes.length,
        interiorSize: interiorResult.pdfBytes.length,
        contentPages: interiorResult.contentPageCount,
        paddingPages: interiorResult.paddingPageCount,
        totalInteriorPages: interiorResult.totalPageCount,
      });

      // Upload both PDFs
      logger.info('Starting PDF upload', { printStoryBookId });
      const [coverUpload, interiorUpload] = await Promise.all([
        uploadCoverPdf(coverBytes, printStoryBookId),
        uploadInteriorPdf(interiorResult.pdfBytes, printStoryBookId),
      ]);

      const totalDurationMs = Date.now() - startTime;
      logger.info('PDF upload completed', { printStoryBookId, totalDurationMs });

      // Calculate metadata - cover is now 2 pages (front + back)
      const coverPageCount = 2;

      const printableMetadata = {
        dpi: 300,
        trimSize: `${layout.leafWidth}in x ${layout.leafHeight}in`,
        pageCount: printStoryBook.pages.length,
        coverPageCount,
        // interiorPageCount is the total pages in the interior PDF (content + padding)
        // This is what we tell Mixam - must match the actual PDF
        interiorPageCount: interiorResult.totalPageCount,
        spreadCount: Math.ceil(printStoryBook.pages.length / layout.leavesPerSpread),
        printLayoutId: layout.id,
        hasSeparatePDFs: true,
        // Track padding separately for display and debugging
        paddingPageCount: interiorResult.paddingPageCount,
        contentPageCount: interiorResult.contentPageCount,
      };

      // Update PrintStoryBook with PDF URLs
      await printStoryBookRef.update({
        coverPdfUrl: coverUpload.url,
        interiorPdfUrl: interiorUpload.url,
        printableMetadata,
        pdfStatus: 'ready',
        generatedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });

      return NextResponse.json({
        success: true,
        coverPdfUrl: coverUpload.url,
        interiorPdfUrl: interiorUpload.url,
        metadata: printableMetadata,
      });
    } catch (generationError: any) {
      const durationMs = Date.now() - startTime;
      logger.error('PDF generation failed', generationError, { printStoryBookId, durationMs });

      // Update status to error
      await printStoryBookRef.update({
        pdfStatus: 'error',
        pdfErrorMessage: generationError?.message || 'Failed to generate PDFs',
        updatedAt: FieldValue.serverTimestamp(),
      });

      throw generationError;
    }
  } catch (error: any) {
    logger.error('Unhandled exception in route', error);
    return NextResponse.json(
      {
        error: 'Failed to generate PDFs',
        details: error?.message || String(error),
        requestId,
      },
      { status: 500 }
    );
  }
}
