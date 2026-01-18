import { NextResponse } from 'next/server';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { getStoryBucket } from '@/firebase/admin/storage';
import { randomUUID } from 'crypto';
import { requireParentOrAdminUser } from '@/lib/server-auth';
import { AuthError } from '@/lib/auth-error';
import { initFirebaseAdminApp } from '@/firebase/admin/app';
import { PDFDocument, StandardFonts, rgb, PDFFont, PDFPage } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import { readFile } from 'fs/promises';
import { join } from 'path';
import type { PrintLayout, StoryOutputPage, PrintableAssetMetadata, PrintLayoutPageType, PrintProduct } from '@/lib/types';
import { getLayoutForPageType, mapPageKindToLayoutType } from '@/lib/print-layout-utils';
import SampleLayoutData from '@/data/print-layouts.json';
import { resolvePageConstraints, calculateInteriorPageAdjustment } from '@/lib/print-constraints';

/**
 * Request body for generating printable PDFs.
 * Only supports the new storybooks model: stories/{storyId}/storybooks/{storybookId}
 */
type PrintableRequest = {
  storyId: string;
  storybookId: string;
  printLayoutId: string;
  forceRegenerate?: boolean;
  regressionTag?: string;
};

const INCH_TO_POINTS = 72;

function respondError(status: number, message: string) {
  return NextResponse.json({ ok: false, errorMessage: message }, { status });
}

async function fetchImageBytes(url: string): Promise<{ buffer: ArrayBuffer; mimeType: string } | null> {
  try {
    // Add timeout to prevent hanging on slow image fetches
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000); // 30 second timeout

    const response = await fetch(url, { signal: controller.signal });
    clearTimeout(timeoutId);

    if (!response.ok) {
      console.warn('[printable] Failed to fetch image', url, response.status);
      return null;
    }
    const buffer = await response.arrayBuffer();
    const mimeType = response.headers.get('content-type') || 'image/jpeg';
    return { buffer, mimeType };
  } catch (error: any) {
    if (error.name === 'AbortError') {
      console.warn('[printable] Image fetch timed out after 30s:', url.substring(0, 100));
    } else {
      console.warn('[printable] Image fetch error', url.substring(0, 100), error?.message);
    }
    return null;
  }
}

/**
 * Convert hex color string to RGB values (0-1 range for pdf-lib)
 */
function hexToRgb(hex: string): { r: number; g: number; b: number } {
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
  const luminance = 0.299 * r + 0.587 * g + 0.114 * b;
  return luminance > 0.5 ? { r: 0, g: 0, b: 0 } : { r: 1, g: 1, b: 1 };
}

/**
 * Draw a rounded rectangle using overlapping shapes
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
  const maxRadius = Math.min(width, height) / 2;
  const r = Math.min(radius, maxRadius);
  const color = rgb(fillColor.r, fillColor.g, fillColor.b);

  if (r <= 0) {
    pdfPage.drawRectangle({ x, y, width, height, color });
    return;
  }

  // Main body rectangles
  pdfPage.drawRectangle({ x: x + r, y, width: width - 2 * r, height, color });
  pdfPage.drawRectangle({ x, y: y + r, width, height: height - 2 * r, color });

  // Corner circles
  pdfPage.drawEllipse({ x: x + r, y: y + r, xScale: r, yScale: r, color });
  pdfPage.drawEllipse({ x: x + width - r, y: y + r, xScale: r, yScale: r, color });
  pdfPage.drawEllipse({ x: x + r, y: y + height - r, xScale: r, yScale: r, color });
  pdfPage.drawEllipse({ x: x + width - r, y: y + height - r, xScale: r, yScale: r, color });
}

/**
 * Sanitize text for WinAnsi encoding (used by PDF StandardFonts)
 * Replaces problematic characters with safe alternatives
 */
function sanitizeTextForPdf(text: string): string {
  if (!text) return '';

  // First, explicitly remove all null characters (character code 0)
  // This is the main cause of "Winansi can not encode '' (0)" errors
  let result = text.replace(/\x00/g, '');

  result = result
    // Replace curly quotes with straight quotes
    .replace(/[\u2018\u2019\u201A\u201B]/g, "'")  // Single curly quotes and variants
    .replace(/[\u201C\u201D\u201E\u201F]/g, '"')  // Double curly quotes and variants
    // Replace various dashes with standard hyphen
    .replace(/[\u2010\u2011\u2012\u2013\u2014\u2015\u2212]/g, '-')  // All dash variants
    // Replace ellipsis
    .replace(/\u2026/g, '...')
    // Replace non-breaking space and other space variants
    .replace(/[\u00A0\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200A\u202F\u205F]/g, ' ')
    // Replace other common problematic characters
    .replace(/[\u2022\u2023\u2043\u204C\u204D]/g, '*')  // Various bullets
    .replace(/[\u00B7\u2024\u2027]/g, '.')  // Middle dots
    .replace(/[\u2032\u2033\u2034\u2035\u2036\u2037]/g, "'")  // Prime marks
    // Replace trademark and copyright symbols
    .replace(/\u2122/g, '(TM)')
    .replace(/\u00A9/g, '(c)')
    .replace(/\u00AE/g, '(R)')
    // Replace zero-width characters
    .replace(/[\u200B\u200C\u200D\uFEFF]/g, '');

  // Now filter character-by-character to ensure WinAnsi compatibility
  result = result
    .split('')
    .map(char => {
      const code = char.charCodeAt(0);
      // Explicitly reject null character (code 0)
      if (code === 0) return '';
      // Allow basic printable ASCII (32-126)
      if (code >= 32 && code <= 126) {
        return char;
      }
      // Allow Latin-1 supplement printable range (160-255)
      if (code >= 160 && code <= 255) {
        return char;
      }
      // Preserve newlines
      if (code === 10 || code === 13) return '\n';
      // Replace tabs with space
      if (code === 9) return ' ';
      // Skip all other control characters (1-31)
      if (code < 32) return '';
      // For any other Unicode characters, skip them
      return '';
    })
    .join('');

  return result;
}

/**
 * Wraps text to fit within a given width, preserving explicit newlines
 */
function wrapText(text: string, font: PDFFont, fontSize: number, maxWidth: number): string[] {
  if (!text || text.trim().length === 0) {
    return [];
  }

  const allLines: string[] = [];

  // First split by newlines to preserve explicit line breaks
  const paragraphs = text.split('\n');

  for (const paragraph of paragraphs) {
    const trimmedParagraph = paragraph.trim();

    // Keep empty lines as empty strings to preserve spacing
    if (trimmedParagraph.length === 0) {
      allLines.push('');
      continue;
    }

    const words = trimmedParagraph.split(' ').filter(w => w.length > 0);
    if (words.length === 0) {
      allLines.push('');
      continue;
    }

    let currentLine = '';

    for (const word of words) {
      // Skip empty words
      if (!word || word.length === 0) continue;

      const testLine = currentLine ? `${currentLine} ${word}` : word;
      try {
        const testWidth = font.widthOfTextAtSize(testLine, fontSize);

        if (testWidth > maxWidth && currentLine) {
          allLines.push(currentLine);
          currentLine = word;
        } else {
          currentLine = testLine;
        }
      } catch (err) {
        console.warn('[printable] wrapText error measuring:', testLine, err);
        // Skip problematic text
        continue;
      }
    }

    if (currentLine && currentLine.length > 0) {
      allLines.push(currentLine);
    }
  }

  return allLines;
}

/**
 * Calculate the optimal font size to fit text within a text box.
 * Reduces font size iteratively until all text fits, with a minimum size limit.
 * Returns just the font size (for pre-calculation pass).
 */
function calculateFittingFontSizeOnly(
  text: string,
  font: PDFFont,
  maxFontSize: number,
  textBoxWidth: number,
  textBoxHeight: number,
  padding: number = 20
): number {
  const MIN_FONT_SIZE = 10;
  const availableWidth = textBoxWidth - padding;
  const availableHeight = textBoxHeight - padding;

  let currentFontSize = maxFontSize;

  while (currentFontSize >= MIN_FONT_SIZE) {
    const lineHeight = currentFontSize * 1.4;
    const lines = wrapText(text, font, currentFontSize, availableWidth);

    // Filter out empty lines for height calculation but keep them for rendering
    const nonEmptyLineCount = lines.filter(l => l.length > 0).length;
    const emptyLineCount = lines.length - nonEmptyLineCount;
    // Empty lines take half the height
    const totalTextHeight = (nonEmptyLineCount * lineHeight) + (emptyLineCount * lineHeight * 0.5);

    if (totalTextHeight <= availableHeight) {
      return currentFontSize;
    }

    // Reduce font size and try again
    currentFontSize -= 1;
  }

  return MIN_FONT_SIZE;
}

/**
 * Calculate the minimum font size needed to fit all pages' text within their text boxes.
 * This ensures consistent font size across all pages.
 */
function calculateMinimumFontSizeForPages(
  pages: StoryOutputPage[],
  layout: PrintLayout,
  font: PDFFont,
  maxFontSize: number
): number {
  let minFontSize = maxFontSize;
  const pageWidth = layout.leafWidth * INCH_TO_POINTS;
  const pageHeight = layout.leafHeight * INCH_TO_POINTS;

  for (const page of pages) {
    // Skip pages without text or special page types
    if (!page.displayText || page.kind === 'blank') continue;

    // Get page-type-specific layout
    const pageType = mapPageKindToLayoutType(page.kind);

    // Title pages use different rendering - skip for now (they have full page)
    if (pageType === 'titlePage') continue;

    const pageLayout = getLayoutForPageType(layout, pageType);
    const textBox = pageLayout.textBox;

    // Calculate text box dimensions
    let textBoxWidth = pageWidth - (2 * INCH_TO_POINTS);
    let textBoxHeight = pageHeight - (2 * INCH_TO_POINTS);

    if (textBox) {
      textBoxWidth = Number(textBox.width) * INCH_TO_POINTS;
      textBoxHeight = Number(textBox.height) * INCH_TO_POINTS;
    }

    const sanitizedText = sanitizeTextForPdf(page.displayText);
    const requiredFontSize = calculateFittingFontSizeOnly(
      sanitizedText,
      font,
      maxFontSize,
      textBoxWidth,
      textBoxHeight
    );

    if (requiredFontSize < minFontSize) {
      console.log(`[printable] Page ${page.pageNumber} requires font size ${requiredFontSize}pt (was ${minFontSize}pt)`);
      minFontSize = requiredFontSize;
    }
  }

  console.log(`[printable] Minimum font size for all pages: ${minFontSize}pt`);
  return minFontSize;
}

/**
 * Renders a title page with full-page centered text (no image)
 */
async function renderTitlePage(
  pdfPage: PDFPage,
  page: StoryOutputPage,
  layout: PrintLayout,
  bodyFont: PDFFont,
  fontSize: number
) {
  const { width: pageWidth, height: pageHeight } = pdfPage.getSize();
  const lineHeight = fontSize * 1.6;

  if (!page.displayText) {
    console.log(`[printable] Title page ${page.pageNumber} has no text`);
    return;
  }

  console.log(`[printable] Rendering title page ${page.pageNumber}`);
  console.log(`[printable] Title page raw text: ${JSON.stringify(page.displayText.substring(0, 200))}`);

  // Sanitize and split text by newlines to preserve the multi-line format
  const sanitizedText = sanitizeTextForPdf(page.displayText);
  console.log(`[printable] Title page sanitized text: ${JSON.stringify(sanitizedText.substring(0, 200))}`);

  const textLines = sanitizedText.split('\n').map(line => line.trim()).filter(Boolean);
  const totalTextHeight = textLines.length * lineHeight;
  const startY = (pageHeight / 2) + (totalTextHeight / 2) - fontSize;

  console.log(`[printable] Title page: ${textLines.length} lines, startY=${startY}`);

  for (let index = 0; index < textLines.length; index++) {
    const line = textLines[index];

    // Skip empty lines
    if (!line || line.length === 0) continue;

    try {
      const lineWidth = bodyFont.widthOfTextAtSize(line, fontSize);
      const centerX = (pageWidth / 2) - (lineWidth / 2);
      const y = startY - (index * lineHeight);

      pdfPage.drawText(line, {
        x: centerX,
        y,
        font: bodyFont,
        size: fontSize,
        color: rgb(0, 0, 0),
      });
    } catch (err: any) {
      console.error(`[printable] Title page error rendering line ${index}: ${err?.message}`);
      console.error(`[printable] Problematic line (${line.length} chars): ${JSON.stringify(line)}`);
      // Log character codes for debugging
      const charCodes = line.split('').map(c => c.charCodeAt(0));
      console.error(`[printable] Character codes: ${JSON.stringify(charCodes)}`);
      // Skip this line but continue with others
    }
  }
}

/**
 * Renders a single page with image and/or text using page-type-specific layouts
 *
 * For two-leaf spreads:
 * - When targetLeaf is specified (1 or 2), only render content designated for that leaf
 * - When targetLeaf is undefined, render all content (single-page mode)
 */
async function renderPageContent(
  pdfPage: PDFPage,
  page: StoryOutputPage,
  layout: PrintLayout,
  bodyFont: PDFFont,
  fontSize: number,
  targetLeaf?: 1 | 2
) {
  // Map page kind to layout type
  const pageType = mapPageKindToLayoutType(page.kind);

  // Special handling for title pages
  if (pageType === 'titlePage') {
    await renderTitlePage(pdfPage, page, layout, bodyFont, fontSize);
    return;
  }

  // Special handling for blank pages - just leave empty
  if (page.kind === 'blank') {
    console.log(`[printable] Rendering blank page ${page.pageNumber}`);
    return;
  }

  const { width: pageWidth, height: pageHeight } = pdfPage.getSize();
  const pdfDoc = pdfPage.doc;
  const lineHeight = fontSize * 1.4;

  // Get page-type-specific layout configuration
  const pageLayout = getLayoutForPageType(layout, pageType);

  // Determine which content to render based on leaf assignments
  const imageLeaf = pageLayout.imageBox?.leaf;
  const textLeaf = pageLayout.textBox?.leaf;

  // Should we render image on this page?
  // Check both: enabled flag AND leaf targeting (for two-page spreads)
  const imageEnabled = pageLayout.imageBoxEnabled !== false;
  const shouldRenderImage = imageEnabled && (targetLeaf === undefined || imageLeaf === undefined || imageLeaf === targetLeaf);

  // Should we render text on this page?
  // Check both: enabled flag AND leaf targeting (for two-page spreads)
  const textEnabled = pageLayout.textBoxEnabled !== false;
  const shouldRenderText = textEnabled && (targetLeaf === undefined || textLeaf === undefined || textLeaf === targetLeaf);

  console.log(`[printable] Rendering page ${page.pageNumber}, kind: ${page.kind}, pageType: ${pageType}, imageEnabled: ${imageEnabled}, textEnabled: ${textEnabled}, targetLeaf: ${targetLeaf}, shouldRenderImage: ${shouldRenderImage}, shouldRenderText: ${shouldRenderText}`);

  // 1. Render image first (background layer)
  if (page.imageUrl && shouldRenderImage) {
    console.log(`[printable] Fetching image: ${page.imageUrl.substring(0, 100)}...`);
    const imageData = await fetchImageBytes(page.imageUrl);
    if (imageData) {
      console.log(`[printable] Image fetched, mimeType: ${imageData.mimeType}, size: ${imageData.buffer.byteLength}`);
      try {
        let image;
        if (imageData.mimeType.includes('png')) {
          image = await pdfDoc.embedPng(imageData.buffer);
        } else {
          image = await pdfDoc.embedJpg(imageData.buffer);
        }

        if (image) {
          const imageBox = pageLayout.imageBox;

          if (!imageBox) {
            // Fill entire page with image (scaled to cover)
            const imgAspect = image.width / image.height;
            const pageAspect = pageWidth / pageHeight;

            let drawWidth = pageWidth;
            let drawHeight = pageHeight;
            let drawX = 0;
            let drawY = 0;

            if (imgAspect > pageAspect) {
              drawHeight = pageHeight;
              drawWidth = pageHeight * imgAspect;
              drawX = (pageWidth - drawWidth) / 2;
            } else {
              drawWidth = pageWidth;
              drawHeight = pageWidth / imgAspect;
              drawY = (pageHeight - drawHeight) / 2;
            }

            pdfPage.drawImage(image, { x: drawX, y: drawY, width: drawWidth, height: drawHeight });
            console.log(`[printable] Drew full-page image at (${drawX}, ${drawY}) size ${drawWidth}x${drawHeight}`);
          } else {
            // Use imageBox from page-type layout
            const boxX = Number(imageBox.x) * INCH_TO_POINTS;
            const boxY = Number(imageBox.y) * INCH_TO_POINTS;
            const boxWidth = Number(imageBox.width) * INCH_TO_POINTS;
            const boxHeight = Number(imageBox.height) * INCH_TO_POINTS;

            // Calculate aspect ratios
            const imgAspect = image.width / image.height;
            const boxAspect = boxWidth / boxHeight;

            // Calculate how much distortion filling the box would require
            // Distortion is the ratio difference between image and box aspects
            const aspectRatio = imgAspect / boxAspect;
            const distortionPercent = Math.abs(1 - aspectRatio) * 100;

            // Threshold: if distortion is less than 10%, fill the box (stretch slightly)
            // Otherwise, shrink to fit while maintaining aspect ratio
            const DISTORTION_THRESHOLD = 10;

            let drawWidth: number;
            let drawHeight: number;
            let offsetX = 0;
            let offsetY = 0;
            let fillMode: string;

            if (distortionPercent <= DISTORTION_THRESHOLD) {
              // Minor distortion - fill the entire box (stretch to fit)
              drawWidth = boxWidth;
              drawHeight = boxHeight;
              fillMode = `fill (${distortionPercent.toFixed(1)}% distortion)`;
            } else {
              // Significant distortion - shrink to fit while maintaining aspect ratio
              if (imgAspect > boxAspect) {
                // Image is wider than box - constrain by width
                drawWidth = boxWidth;
                drawHeight = boxWidth / imgAspect;
              } else {
                // Image is taller than box - constrain by height
                drawHeight = boxHeight;
                drawWidth = boxHeight * imgAspect;
              }

              // Center the image within the box
              offsetX = (boxWidth - drawWidth) / 2;
              offsetY = (boxHeight - drawHeight) / 2;
              fillMode = `shrink-to-fit (${distortionPercent.toFixed(1)}% distortion avoided)`;
            }

            // Convert from top-left origin to bottom-left origin
            const pdfY = pageHeight - boxY - boxHeight;

            pdfPage.drawImage(image, {
              x: boxX + offsetX,
              y: pdfY + offsetY,
              width: drawWidth,
              height: drawHeight
            });
            console.log(`[printable] Drew image in box: ${fillMode}, size ${drawWidth.toFixed(0)}x${drawHeight.toFixed(0)} (box: ${boxWidth.toFixed(0)}x${boxHeight.toFixed(0)})`);
          }
        }
      } catch (error) {
        console.warn('[printable] Failed to embed image:', error);
      }
    } else {
      console.warn(`[printable] Failed to fetch image for page ${page.pageNumber}`);
    }
  }

  // 2 & 3. Render text box background and text (if present)
  if (page.displayText && shouldRenderText) {
    const textBox = pageLayout.textBox;

    // Default text box: 1 inch margins
    let textBoxX = 1 * INCH_TO_POINTS;
    let textBoxY = 1 * INCH_TO_POINTS;
    let textBoxWidth = pageWidth - (2 * INCH_TO_POINTS);
    let textBoxHeight = pageHeight - (2 * INCH_TO_POINTS);
    let backgroundColor: string | undefined;
    let textColor: string | undefined;
    let borderRadius = 0;

    if (textBox) {
      textBoxX = Number(textBox.x) * INCH_TO_POINTS;
      textBoxY = Number(textBox.y) * INCH_TO_POINTS;
      textBoxWidth = Number(textBox.width) * INCH_TO_POINTS;
      textBoxHeight = Number(textBox.height) * INCH_TO_POINTS;
      backgroundColor = textBox.backgroundColor;
      textColor = textBox.textColor;
      borderRadius = (textBox.borderRadius ?? 0) * INCH_TO_POINTS;
    }

    // Convert from top-left origin to bottom-left origin for PDF
    const textBoxBottomInPdf = pageHeight - textBoxY - textBoxHeight;

    // Draw text box background with rounded corners (if specified)
    if (backgroundColor) {
      const bgColor = hexToRgb(backgroundColor);
      drawRoundedRectangle(pdfPage, textBoxX, textBoxBottomInPdf, textBoxWidth, textBoxHeight, borderRadius, bgColor);
      console.log(`[printable] Drew text box background: ${backgroundColor} with radius ${borderRadius}pt at (${textBoxX}, ${textBoxBottomInPdf})`);
    }

    // Determine text color
    let finalTextColor = { r: 0, g: 0, b: 0 };
    if (textColor) {
      finalTextColor = hexToRgb(textColor);
    } else if (backgroundColor) {
      finalTextColor = getContrastingTextColor(backgroundColor);
    }

    // Sanitize text and wrap at the unified font size
    console.log(`[printable] Page ${page.pageNumber} raw text: ${JSON.stringify(page.displayText.substring(0, 100))}`);
    const sanitizedText = sanitizeTextForPdf(page.displayText);
    console.log(`[printable] Page ${page.pageNumber} sanitized text: ${JSON.stringify(sanitizedText.substring(0, 100))}`);

    // Use the provided fontSize (which should be the unified size calculated across all pages)
    const textFontSize = fontSize;
    const textLineHeight = textFontSize * 1.4;
    const lines = wrapText(sanitizedText, bodyFont, textFontSize, textBoxWidth - 20);

    const textBoxTopInPdf = pageHeight - textBoxY;
    const firstLineY = textBoxTopInPdf - textFontSize - 10;

    console.log(`[printable] Text box: x=${textBoxX}, y=${textBoxY}, w=${textBoxWidth}, h=${textBoxHeight}`);
    console.log(`[printable] Text: ${lines.length} lines at ${textFontSize}pt, firstLineY=${firstLineY}`);

    let lineIndex = 0;
    for (const line of lines) {
      // Empty lines still take up space (half height) for visual separation
      if (!line || line.length === 0) {
        lineIndex++;
        continue;
      }

      try {
        const lineWidth = bodyFont.widthOfTextAtSize(line, textFontSize);
        const centerX = textBoxX + (textBoxWidth / 2) - (lineWidth / 2);
        const y = firstLineY - (lineIndex * textLineHeight);

        pdfPage.drawText(line, {
          x: centerX,
          y,
          font: bodyFont,
          size: textFontSize,
          color: rgb(finalTextColor.r, finalTextColor.g, finalTextColor.b),
        });
      } catch (err: any) {
        console.error(`[printable] Page ${page.pageNumber} error rendering line ${lineIndex}: ${err?.message}`);
        console.error(`[printable] Problematic line (${line.length} chars): ${JSON.stringify(line)}`);
        // Log character codes for debugging
        const charCodes = line.split('').map((c: string) => c.charCodeAt(0));
        console.error(`[printable] Character codes: ${JSON.stringify(charCodes)}`);
        // Skip this line but continue with others
      }
      lineIndex++;
    }
  }
}

/**
 * Custom font file mappings (Google Fonts stored in public/fonts/)
 */
const CUSTOM_FONTS: Record<string, string> = {
  'comic-neue': 'ComicNeue-Regular.ttf',
  'comic-neue-bold': 'ComicNeue-Bold.ttf',
  'nunito': 'Nunito-Regular.ttf',
  'patrick-hand': 'PatrickHand-Regular.ttf',
  'quicksand': 'Quicksand-Regular.ttf',
  'lexend': 'Lexend-Regular.ttf',
};

/**
 * Check if font is a custom font (requires embedding TTF file)
 */
function isCustomFont(fontName?: string): boolean {
  if (!fontName) return false;
  return fontName.toLowerCase() in CUSTOM_FONTS;
}

/**
 * Load a custom font from the public/fonts directory
 */
async function loadCustomFont(pdfDoc: PDFDocument, fontName: string): Promise<PDFFont> {
  const fontKey = fontName.toLowerCase();
  const fontFile = CUSTOM_FONTS[fontKey];

  if (!fontFile) {
    throw new Error(`Custom font "${fontName}" not found`);
  }

  // Register fontkit for custom font embedding
  pdfDoc.registerFontkit(fontkit);

  // Load font file from public/fonts directory
  const fontPath = join(process.cwd(), 'public', 'fonts', fontFile);
  const fontBytes = await readFile(fontPath);

  const font = await pdfDoc.embedFont(fontBytes);
  console.log(`[printable] Loaded custom font: ${fontName} from ${fontFile}`);

  return font;
}

/**
 * Map font names to StandardFonts (PDF Base 14 fonts)
 * These are the only fonts guaranteed to be available in all PDF readers.
 */
function getStandardFont(fontName?: string): typeof StandardFonts[keyof typeof StandardFonts] {
  switch (fontName?.toLowerCase()) {
    // Helvetica family (sans-serif)
    case 'helvetica':
      return StandardFonts.Helvetica;
    case 'helvetica-bold':
      return StandardFonts.HelveticaBold;
    case 'helvetica-oblique':
    case 'helvetica-italic':
      return StandardFonts.HelveticaOblique;
    case 'helvetica-boldoblique':
    case 'helvetica-bolditalic':
      return StandardFonts.HelveticaBoldOblique;

    // Courier family (monospace)
    case 'courier':
      return StandardFonts.Courier;
    case 'courier-bold':
      return StandardFonts.CourierBold;
    case 'courier-oblique':
    case 'courier-italic':
      return StandardFonts.CourierOblique;
    case 'courier-boldoblique':
    case 'courier-bolditalic':
      return StandardFonts.CourierBoldOblique;

    // Times Roman family (serif)
    case 'timesroman':
    case 'times':
    case 'times-roman':
      return StandardFonts.TimesRoman;
    case 'timesroman-bold':
    case 'times-bold':
      return StandardFonts.TimesRomanBold;
    case 'timesroman-italic':
    case 'times-italic':
      return StandardFonts.TimesRomanItalic;
    case 'timesroman-bolditalic':
    case 'times-bolditalic':
      return StandardFonts.TimesRomanBoldItalic;

    // Special fonts (limited character sets - not recommended for body text)
    case 'symbol':
      return StandardFonts.Symbol;
    case 'zapfdingbats':
    case 'dingbats':
      return StandardFonts.ZapfDingbats;

    default:
      return StandardFonts.Helvetica;
  }
}

/**
 * Embed font into PDF document - handles both standard and custom fonts
 */
async function embedFont(pdfDoc: PDFDocument, fontName?: string): Promise<PDFFont> {
  if (isCustomFont(fontName)) {
    return await loadCustomFont(pdfDoc, fontName!);
  }

  const standardFont = getStandardFont(fontName);
  return await pdfDoc.embedFont(standardFont);
}

/**
 * Renders all pages into a single combined PDF
 * Uses the pre-calculated unified font size for consistency across all pages.
 */
async function renderCombinedPdf(pages: StoryOutputPage[], layout: PrintLayout, unifiedFontSize?: number) {
  const pdfDoc = await PDFDocument.create();
  const bodyFont = await embedFont(pdfDoc, layout.font);
  const maxFontSize = Number(layout.fontSize) || 24;

  // Use provided unified font size, or calculate if not provided
  const fontSize = unifiedFontSize ?? calculateMinimumFontSizeForPages(pages, layout, bodyFont, maxFontSize);
  console.log(`[printable] Combined PDF using font size: ${fontSize}pt`);

  // Render all pages at the unified font size
  // For two-leaf spreads, only content pages (not covers, title_page, or blank) create two PDF pages
  const isTwoLeafSpread = layout.leavesPerSpread === 2;

  for (const page of pages) {
    // Determine if this page should be rendered as a 2-page spread
    // Covers, title pages, and blank pages are always single pages
    const isCover = page.kind === 'cover_front' || page.kind === 'cover_back';
    const isSinglePage = isCover || page.kind === 'title_page' || page.kind === 'blank';
    const isSpreadPage = isTwoLeafSpread && !isSinglePage;

    if (isSpreadPage) {
      // Create two pages for the spread - leaf 1 (left) and leaf 2 (right)
      const leaf1Page = pdfDoc.addPage([
        layout.leafWidth * INCH_TO_POINTS,
        layout.leafHeight * INCH_TO_POINTS
      ]);
      await renderPageContent(leaf1Page, page, layout, bodyFont, fontSize, 1);

      const leaf2Page = pdfDoc.addPage([
        layout.leafWidth * INCH_TO_POINTS,
        layout.leafHeight * INCH_TO_POINTS
      ]);
      await renderPageContent(leaf2Page, page, layout, bodyFont, fontSize, 2);
    } else {
      // Single-page mode: covers, title_page, blank, or all pages when leavesPerSpread=1
      const pdfPage = pdfDoc.addPage([
        layout.leafWidth * INCH_TO_POINTS,
        layout.leafHeight * INCH_TO_POINTS
      ]);
      await renderPageContent(pdfPage, page, layout, bodyFont, fontSize);
    }
  }

  return await pdfDoc.save();
}

/**
 * Renders COVER pages - front cover, optionally spine, and back cover
 * For hardcover books with spine=true, the cover PDF has:
 * 1. Front cover
 * 2. Spine (middle - narrow strip, typically 9mm wide)
 * 3. Back cover
 *
 * For products without spine (spine=false):
 * 1. Front cover
 * 2. Back cover
 *
 * The spine is intentionally blank (white) at this point.
 * Uses unified font size calculated across all pages for consistency.
 *
 * @param includeSpine - Whether to include a spine page (true for hardcover, false for paperback)
 */
async function renderCoverPdf(pages: StoryOutputPage[], layout: PrintLayout, unifiedFontSize: number, includeSpine: boolean = true) {
  const pdfDoc = await PDFDocument.create();
  const bodyFont = await embedFont(pdfDoc, layout.font);

  // Find front and back covers by kind
  const frontCover = pages.find(p => p.kind === 'cover_front');
  const backCover = pages.find(p => p.kind === 'cover_back');

  if (!frontCover) {
    throw new Error('Cover must have a front cover page (kind: cover_front)');
  }
  if (!backCover) {
    throw new Error('Cover must have a back cover page (kind: cover_back)');
  }

  // Page 1: Front cover
  const frontPage = pdfDoc.addPage([
    layout.leafWidth * INCH_TO_POINTS,
    layout.leafHeight * INCH_TO_POINTS
  ]);
  await renderPageContent(frontPage, frontCover, layout, bodyFont, unifiedFontSize);

  // Page 2: Spine (only if includeSpine is true)
  if (includeSpine) {
    // Spine dimensions: 9mm wide, full book height
    const SPINE_WIDTH_MM = 9;
    const MM_TO_POINTS = 72 / 25.4; // 1 inch = 25.4mm, 72 points per inch
    const spineWidthPoints = SPINE_WIDTH_MM * MM_TO_POINTS;
    const bookHeightPoints = layout.leafHeight * INCH_TO_POINTS;

    // The spine page is intentionally blank - just a white rectangle
    pdfDoc.addPage([spineWidthPoints, bookHeightPoints]);
    // No content rendered - spine is blank/white
  }

  // Page 3 (or 2 if no spine): Back cover
  const backPage = pdfDoc.addPage([
    layout.leafWidth * INCH_TO_POINTS,
    layout.leafHeight * INCH_TO_POINTS
  ]);
  await renderPageContent(backPage, backCover, layout, bodyFont, unifiedFontSize);

  if (includeSpine) {
    console.log(`[printable] Cover PDF: front cover + spine (9mm) + back cover at ${unifiedFontSize}pt`);
  } else {
    console.log(`[printable] Cover PDF: front cover + back cover (no spine) at ${unifiedFontSize}pt`);
  }

  return await pdfDoc.save();
}

/**
 * Renders INTERIOR pages only - all pages that are not cover_front or cover_back
 * This includes: title_page, text, image, blank
 *
 * @param unifiedFontSize - The consistent font size to use across all pages
 * @param paddingPageCount - Number of blank pages to append at the end to meet Mixam requirements
 */
async function renderInteriorPdf(pages: StoryOutputPage[], layout: PrintLayout, unifiedFontSize: number, paddingPageCount: number = 0) {
  const pdfDoc = await PDFDocument.create();
  const bodyFont = await embedFont(pdfDoc, layout.font);

  // Filter out cover pages - interior is everything except covers
  const interiorPages = pages.filter(p => p.kind !== 'cover_front' && p.kind !== 'cover_back');

  if (interiorPages.length === 0) {
    throw new Error('No interior pages found');
  }

  // Render content pages at the unified font size
  // For two-leaf spreads, INSIDE pages create two PDF pages (one per leaf)
  // Title pages and blank pages are always single pages (not spread across two leaves)
  const isTwoLeafSpread = layout.leavesPerSpread === 2;

  for (const page of interiorPages) {
    // Title pages and blank pages should only generate one PDF page, not two
    // Only 'inside' pages (text/image content) should spread across two leaves
    const isSpreadPage = isTwoLeafSpread && page.kind !== 'title_page' && page.kind !== 'blank';

    if (isSpreadPage) {
      // Create two pages for the spread - leaf 1 (left) and leaf 2 (right)
      const leaf1Page = pdfDoc.addPage([
        layout.leafWidth * INCH_TO_POINTS,
        layout.leafHeight * INCH_TO_POINTS
      ]);
      await renderPageContent(leaf1Page, page, layout, bodyFont, unifiedFontSize, 1);

      const leaf2Page = pdfDoc.addPage([
        layout.leafWidth * INCH_TO_POINTS,
        layout.leafHeight * INCH_TO_POINTS
      ]);
      await renderPageContent(leaf2Page, page, layout, bodyFont, unifiedFontSize, 2);
    } else {
      // Single-page mode - render all content on one page
      // This includes: title_page, blank, and all pages when leavesPerSpread=1
      const pdfPage = pdfDoc.addPage([
        layout.leafWidth * INCH_TO_POINTS,
        layout.leafHeight * INCH_TO_POINTS
      ]);
      await renderPageContent(pdfPage, page, layout, bodyFont, unifiedFontSize);
    }
  }

  // Append blank padding pages at the end to meet Mixam requirements
  if (paddingPageCount > 0) {
    console.log(`[printable] Appending ${paddingPageCount} blank padding pages to interior PDF`);
    for (let i = 0; i < paddingPageCount; i++) {
      pdfDoc.addPage([
        layout.leafWidth * INCH_TO_POINTS,
        layout.leafHeight * INCH_TO_POINTS
      ]);
    }
  }

  // Calculate actual page count:
  // - Title pages and blank pages = 1 PDF page each
  // - Inside pages (text/image) = 2 PDF pages each when isTwoLeafSpread, else 1
  const singlePageItems = interiorPages.filter(p => p.kind === 'title_page' || p.kind === 'blank').length;
  const spreadPageItems = interiorPages.length - singlePageItems;
  const contentPageCount = singlePageItems + (spreadPageItems * (isTwoLeafSpread ? 2 : 1));
  const totalPages = contentPageCount + paddingPageCount;
  if (totalPages % 4 !== 0) {
    console.warn(`[printable] Total interior page count ${totalPages} is not divisible by 4`);
  }

  console.log(`[printable] Interior PDF: ${singlePageItems} single-page items + ${spreadPageItems} spread items (${contentPageCount} pages${isTwoLeafSpread ? ' @ 2 per spread for inside pages' : ''}) + ${paddingPageCount} padding at ${unifiedFontSize}pt`);

  return await pdfDoc.save();
}

// Note: renderPaddingPdf was removed - padding pages are now appended
// directly to the interior PDF in renderInteriorPdf() to ensure correct ordering.

async function uploadPdf(
  buffer: Uint8Array,
  storyId: string,
  storybookId: string,
  version: number,
  pdfType: 'combined' | 'cover' | 'interior' | 'padding',
  regressionTag?: string
) {
  const bucket = await getStoryBucket();
  const versionLabel = `v${String(version).padStart(3, '0')}`;
  const fileName = pdfType === 'combined' ? 'storybook' : pdfType;
  const objectPath = `storybook_printables/${storyId}/${storybookId}/${fileName}-${versionLabel}.pdf`;
  const downloadToken = randomUUID();

  const metadata: Record<string, string> = {
    storyId,
    storybookId,
    version: String(version),
    type: pdfType,
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
      cacheControl: 'private,max-age=0',
      metadata,
    },
  });

  const url = `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(objectPath)}?alt=media&token=${downloadToken}`;
  return { url, objectPath };
}

export async function POST(request: Request) {
  console.log('[printable] POST request received');
  try {
    await initFirebaseAdminApp();
    const body = (await request.json()) as PrintableRequest;
    const { storyId, storybookId, printLayoutId, regressionTag } = body;
    console.log('[printable] Request params:', { storyId, storybookId, printLayoutId, forceRegenerate: body.forceRegenerate });

    // Validate required fields
    if (!storyId) {
      return respondError(400, 'Missing required field: storyId');
    }
    if (!storybookId) {
      return respondError(400, 'Missing required field: storybookId');
    }
    if (!printLayoutId) {
      return respondError(400, 'Missing required field: printLayoutId');
    }

    // Validate this is a new-model storybook (storyId !== storybookId)
    // Legacy model storybooks have storyId === storybookId and use a different data path
    if (storyId === storybookId) {
      return respondError(400, 'Print API only supports new-model storybooks. Legacy storybooks (where storyId equals storybookId) are not supported.');
    }

    const user = await requireParentOrAdminUser(request);
    const firestore = getFirestore();

    // Load story document
    const storySnap = await firestore.collection('stories').doc(storyId).get();
    if (!storySnap.exists) {
      return respondError(404, 'Story not found');
    }

    // Load print layout - try Firestore first, fall back to sample data
    const printLayoutSnap = await firestore.collection('printLayouts').doc(printLayoutId).get();
    let printLayout: PrintLayout;
    if (printLayoutSnap.exists) {
      printLayout = { id: printLayoutSnap.id, ...printLayoutSnap.data() } as PrintLayout;
    } else {
      const sampleLayout = SampleLayoutData.printLayouts.find(l => l.id === printLayoutId);
      if (!sampleLayout) {
        return respondError(404, `Print Layout '${printLayoutId}' not found in Firestore or sample data`);
      }
      printLayout = sampleLayout as PrintLayout;
      console.log(`[printable] Using fallback layout data for ${printLayoutId}`);
    }

    // Load linked print product if specified for page constraints
    let printProduct: PrintProduct | null = null;
    if (printLayout.printProductId) {
      const productSnap = await firestore.collection('printProducts').doc(printLayout.printProductId).get();
      if (productSnap.exists) {
        printProduct = { id: productSnap.id, ...productSnap.data() } as PrintProduct;
        console.log(`[printable] Loaded linked print product: ${printProduct.name}`);
      }
    }

    // Resolve page constraints from layout -> product chain
    const resolvedConstraints = resolvePageConstraints(printLayout, printProduct);
    console.log(`[printable] Resolved constraints:`, resolvedConstraints);

    const storyData = storySnap.data() as Record<string, any>;

    // Check ownership
    const parentUid = storyData?.parentUid;
    const isPrivileged = user.claims.isAdmin || user.claims.isWriter;
    if (!isPrivileged && parentUid && parentUid !== user.uid) {
      return respondError(403, 'You do not own this story.');
    }

    // Load storybook document (new model only)
    const storybookRef = storySnap.ref.collection('storybooks').doc(storybookId);
    const storybookSnap = await storybookRef.get();
    if (!storybookSnap.exists) {
      return respondError(404, `Storybook not found at stories/${storyId}/storybooks/${storybookId}`);
    }

    const storybookData = storybookSnap.data() as Record<string, any>;

    // Check if storybook is locked/finalized
    if (storybookData?.isLocked === false) {
      return respondError(409, 'The storybook must be finalized before generating a printable PDF.');
    }

    // Load pages
    const pagesSnap = await storybookRef.collection('pages').orderBy('pageNumber', 'asc').get();
    if (pagesSnap.empty) {
      return respondError(409, 'No pages found for this storybook.');
    }

    const pages = pagesSnap.docs.map(doc => doc.data() as StoryOutputPage);
    console.log(`[printable] Loaded ${pages.length} pages`);
    console.log(`[printable] Page kinds:`, pages.map(p => p.kind));

    // Update status to generating
    await storybookRef.update({
      'finalization.printableStatus': 'generating',
      'finalization.printableErrorMessage': null,
    });
    console.log('[printable] Status updated to generating');

    // Get product-specific settings (blankPages, spine)
    const blankPages = printProduct?.blankPages ?? 0;
    const includeSpine = printProduct?.spine ?? true; // Default to true for backwards compatibility

    // Prepare metadata - count pages by kind
    // Cover PDF page count depends on whether spine is included
    const coverPageCount = includeSpine ? 3 : 2; // front + spine? + back

    // Calculate content page count, accounting for leavesPerSpread
    // For two-leaf spreads, INSIDE pages generate 2 PDF pages, but title_page and blank are always 1
    const contentItems = pages.filter(p => p.kind !== 'cover_front' && p.kind !== 'cover_back');
    const isTwoLeafSpread = printLayout.leavesPerSpread === 2;
    // Count single-page items (title_page, blank) vs spread items (text, image, etc.)
    const singlePageItems = contentItems.filter(p => p.kind === 'title_page' || p.kind === 'blank');
    const spreadItems = contentItems.filter(p => p.kind !== 'title_page' && p.kind !== 'blank');
    const contentPageCount = singlePageItems.length + (spreadItems.length * (isTwoLeafSpread ? 2 : 1));

    // Calculate interior page adjustments using the new rules:
    // 1. Inside pages must be at least minPageCount
    // 2. Total (2 cover + blankPages + inside) must be multiple of 4
    // 3. If inside exceeds max, truncate
    const interiorAdjustment = calculateInteriorPageAdjustment(contentPageCount, blankPages, resolvedConstraints);
    const pdfGenerationWarnings: string[] = interiorAdjustment.warnings;

    // Log page breakdown calculation
    console.log(`[printable] Page count breakdown:`);
    console.log(`  - Layout: ${printLayout.name}, leavesPerSpread: ${printLayout.leavesPerSpread}`);
    console.log(`  - Content items: ${contentItems.length} (${singlePageItems.length} single-page + ${spreadItems.length} spread items)`);
    console.log(`  - Content PDF pages: ${contentPageCount} (single-page items=1 each, spread items=${isTwoLeafSpread ? 2 : 1} each)`);
    console.log(`  - Product settings: blankPages=${blankPages}, spine=${includeSpine}`);
    console.log(`  - Constraints: min=${resolvedConstraints.minPages}, max=${resolvedConstraints.maxPages || 'none'}, multiple of 4`);

    if (pdfGenerationWarnings.length > 0) {
      console.log(`[printable] Page count adjustment warnings:`, pdfGenerationWarnings);
    }

    // Handle truncation if content exceeds maximum
    let pagesToRender = pages;
    if (interiorAdjustment.wasTruncated && resolvedConstraints.maxPages > 0) {
      // Keep covers + only up to finalInteriorPages of content
      // Truncation is complex with mixed single/spread pages - truncate from the end
      const coverPages = pages.filter(p => p.kind === 'cover_front' || p.kind === 'cover_back');
      let targetPdfPages = interiorAdjustment.finalInteriorPages;
      const truncatedContent: typeof contentItems = [];
      for (const item of contentItems) {
        const itemPages = (item.kind === 'title_page' || item.kind === 'blank') ? 1 : (isTwoLeafSpread ? 2 : 1);
        if (targetPdfPages >= itemPages) {
          truncatedContent.push(item);
          targetPdfPages -= itemPages;
        } else {
          break; // Can't fit any more items
        }
      }
      pagesToRender = [...coverPages.filter(p => p.kind === 'cover_front'), ...truncatedContent, ...coverPages.filter(p => p.kind === 'cover_back')];
      console.log(`[printable] Truncated from ${contentItems.length} to ${truncatedContent.length} content items (${interiorAdjustment.finalInteriorPages} PDF pages)`);
    }

    // Calculate padding pages needed - recalculate actual PDF pages from the items we're rendering
    const actualContentItems = pagesToRender.filter(p => p.kind !== 'cover_front' && p.kind !== 'cover_back');
    const actualSinglePageItems = actualContentItems.filter(p => p.kind === 'title_page' || p.kind === 'blank').length;
    const actualSpreadItems = actualContentItems.length - actualSinglePageItems;
    const actualContentPdfPages = actualSinglePageItems + (actualSpreadItems * (isTwoLeafSpread ? 2 : 1));
    const paddingPageCount = interiorAdjustment.paddingNeeded;
    const totalInteriorWithPadding = interiorAdjustment.finalInteriorPages;

    console.log(`[printable] Final interior PDF composition:`);
    console.log(`  - Content items: ${actualContentItems.length} (${actualSinglePageItems} single + ${actualSpreadItems} spread) -> ${actualContentPdfPages} PDF pages`);
    console.log(`  - Padding pages: ${paddingPageCount}`);
    console.log(`  - Total interior pages: ${totalInteriorWithPadding}`);

    // Sanity check: interior PDF must be a multiple of 4 for CASE binding
    // Note: blankPages are endpapers Mixam adds during binding - not in our PDF
    console.log(`  - Product blankPages (endpapers, Mixam adds): ${blankPages}`);
    if (totalInteriorWithPadding % 4 !== 0) {
      console.error(`[printable] BUG: interior PDF pages (${totalInteriorWithPadding}) is not a multiple of 4!`);
    } else {
      console.log(`  - Interior PDF multiple of 4: YES (${totalInteriorWithPadding} pages)`);
    }

    const printableMetadata: PrintableAssetMetadata = {
      dpi: 300,
      trimSize: `${printLayout.leafWidth}in x ${printLayout.leafHeight}in`,
      pageCount: totalInteriorWithPadding, // Interior PDF page count (what we submit)
      coverPageCount,
      interiorPageCount: totalInteriorWithPadding, // Interior PDF pages (content + padding)
      spreadCount: Math.ceil(totalInteriorWithPadding / 2), // Each spread is 2 pages when open
      printLayoutId: printLayout.id,
      hasSeparatePDFs: true,
      paddingPageCount, // Blank pages added for alignment
      contentPageCount: actualContentPdfPages, // Actual content PDF pages (before padding)
    };

    const finalization = storybookData?.finalization;
    const version = finalization?.version ?? 1;

    try {
      console.log('[printable] Starting PDF generation...');

      // First, calculate unified font size across all pages
      // We need to embed the font first to measure text
      const tempDoc = await PDFDocument.create();
      const tempFont = await embedFont(tempDoc, printLayout.font);
      const maxFontSize = Number(printLayout.fontSize) || 24;
      const unifiedFontSize = calculateMinimumFontSizeForPages(pagesToRender, printLayout, tempFont, maxFontSize);
      console.log(`[printable] Using unified font size: ${unifiedFontSize}pt (max was ${maxFontSize}pt)`);

      // Generate PDFs in parallel using the unified font size
      // Note: padding pages are now appended directly to the interior PDF
      // instead of being a separate file. This ensures correct page ordering.
      const [combinedBytes, coverBytes, interiorBytes] = await Promise.all([
        renderCombinedPdf(pagesToRender, printLayout, unifiedFontSize),
        renderCoverPdf(pagesToRender, printLayout, unifiedFontSize, includeSpine),
        renderInteriorPdf(pagesToRender, printLayout, unifiedFontSize, paddingPageCount), // Include padding in interior PDF
      ]);

      console.log(`[printable] PDFs generated - combined: ${combinedBytes.length}B, cover: ${coverBytes.length}B, interior: ${interiorBytes.length}B (includes ${paddingPageCount} padding pages)`);

      // Upload PDFs in parallel
      console.log('[printable] Starting PDF upload...');
      const [combinedUpload, coverUpload, interiorUpload] = await Promise.all([
        uploadPdf(combinedBytes, storyId, storybookId, version, 'combined', regressionTag),
        uploadPdf(coverBytes, storyId, storybookId, version, 'cover', regressionTag),
        uploadPdf(interiorBytes, storyId, storybookId, version, 'interior', regressionTag),
      ]);

      console.log('[printable] PDFs uploaded successfully');

      const updateData: Record<string, any> = {
        'finalization.printablePdfUrl': combinedUpload.url,
        'finalization.printableStoragePath': combinedUpload.objectPath,
        'finalization.printableCoverPdfUrl': coverUpload.url,
        'finalization.printableInteriorPdfUrl': interiorUpload.url,
        'finalization.printableCoverStoragePath': coverUpload.objectPath,
        'finalization.printableInteriorStoragePath': interiorUpload.objectPath,
        'finalization.printableGeneratedAt': FieldValue.serverTimestamp(),
        'finalization.printableMetadata': printableMetadata,
        'finalization.printableStatus': 'ready',
        'finalization.status': 'printable_ready',
        // Store any warnings from page count validation (truncation, padding, etc.)
        'finalization.pdfGenerationWarnings': pdfGenerationWarnings.length > 0 ? pdfGenerationWarnings : null,
        // Clear any legacy padding PDF fields (padding is now included in interior PDF)
        'finalization.printablePaddingPdfUrl': null,
        'finalization.printablePaddingStoragePath': null,
      };

      if (regressionTag) {
        updateData['regressionTag'] = regressionTag;
        updateData['regressionTest'] = true;
      }

      await storybookRef.update(updateData);

      // Log session event if available
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
              attributes: { storyId, storybookId, version },
              createdAt: FieldValue.serverTimestamp(),
            });
        } catch (error) {
          console.warn('[printable] Failed to log session event', error);
        }
      }

      return NextResponse.json({
        ok: true,
        storyId,
        storybookId,
        printablePdfUrl: combinedUpload.url,
        coverPdfUrl: coverUpload.url,
        interiorPdfUrl: interiorUpload.url,
        metadata: printableMetadata,
      });
    } catch (generationError: any) {
      await storybookRef.update({
        'finalization.printableStatus': 'error',
        'finalization.printableErrorMessage': generationError?.message ?? 'Failed to generate printable PDF.',
      });
      throw generationError;
    }
  } catch (error: any) {
    if (error instanceof AuthError) {
      return respondError(error.status, error.message);
    }
    console.error('[storybook/printable] error', error);
    return respondError(500, error?.message ?? 'Unexpected printable error');
  }
}
