/**
 * The print render core (slice 5.5a), moved from the deleted-in-5.6
 * `src/app/api/storyBook/printable/route.ts`. It renders a neutral
 * `PrintDocument` (built from a Book by `adapter.ts`) into two PDFs: the
 * interior and the cover. Pure apart from reading custom font files; images
 * arrive as bytes.
 *
 * What changed from the route:
 * - Bleed. Every page is trim + bleed on each edge; boxes are placed relative
 *   to the trim, and a box that touches a trim edge (a full-bleed picture, a
 *   background) is extended into the bleed so nothing prints a white sliver.
 * - Pages come from the template's page model (`leavesPerSpread`); padding
 *   follows the product's page multiple (see `catalog/layouts.ts`), and the
 *   padding pages after "The End" are a scrapbook of the Book's own pictures
 *   (`collage.ts`), not blank paper.
 * - The spine width comes from the page count and paper (`spineWidthMm`).
 * - Typeset title and end pages; the back cover carries the synopsis in the
 *   template's back-cover text box. The front cover's art already carries the
 *   title (art-prompts.ts), so the front cover draws no text box.
 */
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFImage, type PDFPage } from 'pdf-lib';
import type { PageLayoutBox, PageLayoutConfig, PrintLayout, TextLayoutBox } from '@/lib/types';
import { getLayoutForPageType } from '@/lib/print-layout-utils';
import { drawCollagePage } from './collage';

export const POINTS_PER_INCH = 72;
export const MM_PER_INCH = 25.4;

export type PrintImage = { bytes: Uint8Array; type: 'png' | 'jpeg' };

export type PrintPageKind = 'cover_front' | 'cover_back' | 'title_page' | 'story' | 'end' | 'blank';

export type PrintPage = {
  kind: PrintPageKind;
  /** Words to set (story text, synopsis, title lines). Null = no text box. */
  text: string | null;
  image: PrintImage | null;
  /** The Book page this came from, for logs and tests. */
  bookPage: number | null;
};

export type PrintDocument = {
  layout: PrintLayout;
  /** Bleed added to every trim edge, in inches. */
  bleedIn: number;
  /** Spine page between front and back cover, or null for no spine. */
  spineWidthMm: number | null;
  /** Interior pages in reading order (title, story, end); padding is added to reach `interiorPages`. */
  interior: PrintPage[];
  front: PrintPage;
  back: PrintPage;
  /** Final interior page count after padding (from `physicalPageCount`). */
  interiorPages: number;
};

export type RenderedPdfs = { interior: Uint8Array; cover: Uint8Array; interiorPageCount: number; coverPageCount: number };

// ---------------------------------------------------------------------------
// Text helpers (ported)
// ---------------------------------------------------------------------------

/** Make text safe for WinAnsi (the standard PDF fonts). */
export function sanitizeTextForPdf(text: string): string {
  if (!text) return '';
  return text
    .replace(/\x00/g, '')
    .replace(/[‘’‚‛′‵]/g, "'")
    .replace(/[“”„‟″‶]/g, '"')
    .replace(/[‐-―−]/g, '-')
    .replace(/…/g, '...')
    .replace(/[  -   ]/g, ' ')
    .replace(/[•‣⁃]/g, '*')
    .replace(/[·․‧]/g, '.')
    .replace(/™/g, '(TM)')
    .replace(/[​-‍﻿]/g, '')
    .split('')
    .map((char) => {
      const code = char.charCodeAt(0);
      if (code === 10 || code === 13) return '\n';
      if (code === 9) return ' ';
      if ((code >= 32 && code <= 126) || (code >= 160 && code <= 255)) return char;
      return '';
    })
    .join('');
}

/** Wrap text to a width, keeping explicit newlines (an empty string is a paragraph gap). */
export function wrapText(text: string, font: PDFFont, fontSize: number, maxWidth: number): string[] {
  if (!text.trim()) return [];
  const lines: string[] = [];
  for (const paragraph of text.split('\n')) {
    const words = paragraph.trim().split(/\s+/).filter(Boolean);
    if (words.length === 0) {
      lines.push('');
      continue;
    }
    let line = '';
    for (const word of words) {
      const candidate = line ? `${line} ${word}` : word;
      if (line && font.widthOfTextAtSize(candidate, fontSize) > maxWidth) {
        lines.push(line);
        line = word;
      } else {
        line = candidate;
      }
    }
    if (line) lines.push(line);
  }
  return lines;
}

const MIN_FONT_SIZE = 10;
const TEXT_PADDING = 20;
const LINE_HEIGHT = 1.4;

function textHeight(lines: string[], fontSize: number): number {
  const filled = lines.filter((l) => l.length > 0).length;
  return (filled + (lines.length - filled) * 0.5) * fontSize * LINE_HEIGHT;
}

/** Largest size (≤ max, ≥ 10 pt) at which the text fits the box. */
export function fittingFontSize(text: string, font: PDFFont, maxFontSize: number, widthPt: number, heightPt: number): number {
  for (let size = maxFontSize; size >= MIN_FONT_SIZE; size -= 1) {
    if (textHeight(wrapText(text, font, size, widthPt - TEXT_PADDING), size) <= heightPt - TEXT_PADDING) return size;
  }
  return MIN_FONT_SIZE;
}

// ---------------------------------------------------------------------------
// Fonts (ported)
// ---------------------------------------------------------------------------

const CUSTOM_FONTS: Record<string, string> = {
  'comic-neue': 'ComicNeue-Regular.ttf',
  'comic-neue-bold': 'ComicNeue-Bold.ttf',
  nunito: 'Nunito-Regular.ttf',
  'patrick-hand': 'PatrickHand-Regular.ttf',
  quicksand: 'Quicksand-Regular.ttf',
  lexend: 'Lexend-Regular.ttf',
};

const STANDARD_FONTS: Record<string, StandardFonts> = {
  helvetica: StandardFonts.Helvetica,
  'helvetica-bold': StandardFonts.HelveticaBold,
  'helvetica-oblique': StandardFonts.HelveticaOblique,
  'helvetica-italic': StandardFonts.HelveticaOblique,
  courier: StandardFonts.Courier,
  'courier-bold': StandardFonts.CourierBold,
  timesroman: StandardFonts.TimesRoman,
  times: StandardFonts.TimesRoman,
  'times-roman': StandardFonts.TimesRoman,
  'timesroman-bold': StandardFonts.TimesRomanBold,
  'times-bold': StandardFonts.TimesRomanBold,
  'timesroman-italic': StandardFonts.TimesRomanItalic,
  'times-italic': StandardFonts.TimesRomanItalic,
};

async function embedFont(doc: PDFDocument, name: string | undefined): Promise<PDFFont> {
  const key = (name ?? '').toLowerCase();
  const file = CUSTOM_FONTS[key];
  if (file) {
    const [{ readFile }, { join }, fontkit] = await Promise.all([
      import('node:fs/promises'),
      import('node:path'),
      import('@pdf-lib/fontkit').then((m) => m.default),
    ]);
    doc.registerFontkit(fontkit);
    return doc.embedFont(await readFile(join(process.cwd(), 'public', 'fonts', file)));
  }
  return doc.embedFont(STANDARD_FONTS[key] ?? StandardFonts.Helvetica);
}

// ---------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------

type Rect = { x: number; y: number; width: number; height: number };

/** A layout box (inches from the trim's top-left) as a PDF rect (points from the page's bottom-left), extended into the bleed where it touches a trim edge. */
export function boxToRect(box: PageLayoutBox, trim: { widthIn: number; heightIn: number }, bleedIn: number, extendIntoBleed = true): Rect {
  const EDGE = 0.01;
  let left = bleedIn + Number(box.x);
  let right = left + Number(box.width);
  let top = bleedIn + Number(box.y);
  let bottom = top + Number(box.height);
  if (extendIntoBleed) {
    if (Number(box.x) <= EDGE) left = 0;
    if (Number(box.x) + Number(box.width) >= trim.widthIn - EDGE) right = trim.widthIn + 2 * bleedIn;
    if (Number(box.y) <= EDGE) top = 0;
    if (Number(box.y) + Number(box.height) >= trim.heightIn - EDGE) bottom = trim.heightIn + 2 * bleedIn;
  }
  const pageHeightIn = trim.heightIn + 2 * bleedIn;
  return {
    x: left * POINTS_PER_INCH,
    y: (pageHeightIn - bottom) * POINTS_PER_INCH,
    width: (right - left) * POINTS_PER_INCH,
    height: (bottom - top) * POINTS_PER_INCH,
  };
}

/**
 * Where to draw an image in a box: fill when the stretch is under 10 % (as the
 * route did), else contain, centred. Art is drawn once per Book before a
 * template is chosen, so a mismatched template letterboxes rather than crops.
 */
export function fitImage(imageAspect: number, box: Rect): Rect {
  const boxAspect = box.width / box.height;
  if (Math.abs(1 - imageAspect / boxAspect) <= 0.1) return box;
  if (imageAspect > boxAspect) {
    const height = box.width / imageAspect;
    return { x: box.x, y: box.y + (box.height - height) / 2, width: box.width, height };
  }
  const width = box.height * imageAspect;
  return { x: box.x + (box.width - width) / 2, y: box.y, width, height: box.height };
}

/**
 * Spine width for a bound book: the book block (leaves × paper caliper) plus,
 * for case binding, the boards. Calipers are typical values per gsm for the
 * paper types the products use; Mixam's own spine calculator is the authority,
 * so the render records the width it used.
 */
const CALIPER_MM_PER_GSM: Record<string, number> = { silk: 0.0009, gloss: 0.00085, uncoated: 0.00125 };
const CASE_BOARD_ALLOWANCE_MM = 4;

export function spineWidthMm(interiorPages: number, paper: { type?: string; weight?: number } | null, caseBound: boolean): number {
  const caliper = CALIPER_MM_PER_GSM[paper?.type ?? 'silk'] ?? CALIPER_MM_PER_GSM.silk;
  const block = (interiorPages / 2) * (paper?.weight ?? 150) * caliper;
  return Math.round((block + (caseBound ? CASE_BOARD_ALLOWANCE_MM : 0)) * 10) / 10;
}

// ---------------------------------------------------------------------------
// Drawing
// ---------------------------------------------------------------------------

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const value = parseInt(hex.replace('#', ''), 16);
  return { r: ((value >> 16) & 255) / 255, g: ((value >> 8) & 255) / 255, b: (value & 255) / 255 };
}

function drawRoundedRectangle(page: PDFPage, rect: Rect, radius: number, fill: { r: number; g: number; b: number }) {
  const color = rgb(fill.r, fill.g, fill.b);
  const r = Math.min(radius, rect.width / 2, rect.height / 2);
  if (r <= 0) {
    page.drawRectangle({ ...rect, color });
    return;
  }
  const { x, y, width, height } = rect;
  page.drawRectangle({ x: x + r, y, width: width - 2 * r, height, color });
  page.drawRectangle({ x, y: y + r, width, height: height - 2 * r, color });
  for (const [cx, cy] of [
    [x + r, y + r],
    [x + width - r, y + r],
    [x + r, y + height - r],
    [x + width - r, y + height - r],
  ]) {
    page.drawEllipse({ x: cx, y: cy, xScale: r, yScale: r, color });
  }
}

type Ctx = {
  doc: PDFDocument;
  font: PDFFont;
  layout: PrintLayout;
  trim: { widthIn: number; heightIn: number };
  bleedIn: number;
  /** One size for all story text, so pages read alike. */
  storyFontSize: number;
  images: Map<PrintImage, PDFImage>;
};

function addPage(ctx: Ctx): PDFPage {
  return ctx.doc.addPage([(ctx.trim.widthIn + 2 * ctx.bleedIn) * POINTS_PER_INCH, (ctx.trim.heightIn + 2 * ctx.bleedIn) * POINTS_PER_INCH]);
}

async function embedImage(ctx: Ctx, image: PrintImage): Promise<PDFImage> {
  const cached = ctx.images.get(image);
  if (cached) return cached;
  const embedded = image.type === 'png' ? await ctx.doc.embedPng(image.bytes) : await ctx.doc.embedJpg(image.bytes);
  ctx.images.set(image, embedded);
  return embedded;
}

function drawTextBox(ctx: Ctx, page: PDFPage, box: TextLayoutBox, text: string, fontSize: number) {
  const rect = boxToRect(box, ctx.trim, ctx.bleedIn, false);
  if (box.backgroundColor) {
    drawRoundedRectangle(page, rect, (box.borderRadius ?? 0) * POINTS_PER_INCH, hexToRgb(box.backgroundColor));
  }
  let color = { r: 0, g: 0, b: 0 };
  if (box.textColor) color = hexToRgb(box.textColor);
  else if (box.backgroundColor) {
    const bg = hexToRgb(box.backgroundColor);
    color = 0.299 * bg.r + 0.587 * bg.g + 0.114 * bg.b > 0.5 ? { r: 0, g: 0, b: 0 } : { r: 1, g: 1, b: 1 };
  }
  const lines = wrapText(sanitizeTextForPdf(text), ctx.font, fontSize, rect.width - TEXT_PADDING);
  const firstLineY = rect.y + rect.height - fontSize - TEXT_PADDING / 2;
  lines.forEach((line, index) => {
    if (!line) return;
    const width = ctx.font.widthOfTextAtSize(line, fontSize);
    page.drawText(line, {
      x: rect.x + rect.width / 2 - width / 2,
      y: firstLineY - index * fontSize * LINE_HEIGHT,
      font: ctx.font,
      size: fontSize,
      color: rgb(color.r, color.g, color.b),
    });
  });
}

/** Lines centred on the page (title and end pages). */
function drawCentredLines(ctx: Ctx, page: PDFPage, box: PageLayoutBox | undefined, lines: Array<{ text: string; size: number }>) {
  const rect = box
    ? boxToRect(box, ctx.trim, ctx.bleedIn, false)
    : boxToRect({ x: 0.5, y: 0.5, width: ctx.trim.widthIn - 1, height: ctx.trim.heightIn - 1 }, ctx.trim, ctx.bleedIn, false);
  const wrapped = lines.flatMap(({ text, size }) =>
    wrapText(sanitizeTextForPdf(text), ctx.font, size, rect.width - TEXT_PADDING).map((line) => ({ line, size }))
  );
  const total = wrapped.reduce((sum, { size }) => sum + size * 1.6, 0);
  let y = rect.y + rect.height / 2 + total / 2;
  for (const { line, size } of wrapped) {
    y -= size * 1.6;
    if (!line) continue;
    const width = ctx.font.widthOfTextAtSize(line, size);
    page.drawText(line, { x: rect.x + rect.width / 2 - width / 2, y, font: ctx.font, size, color: rgb(0, 0, 0) });
  }
}

async function drawLeaf(ctx: Ctx, page: PDFPage, config: PageLayoutConfig, content: PrintPage, fontSize: number, leaf?: 1 | 2) {
  const onLeaf = (box: PageLayoutBox | undefined) => leaf === undefined || box?.leaf === undefined || box.leaf === leaf;
  if (content.image && config.imageBoxEnabled !== false && onLeaf(config.imageBox)) {
    const image = await embedImage(ctx, content.image);
    const box = config.imageBox ?? { x: 0, y: 0, width: ctx.trim.widthIn, height: ctx.trim.heightIn };
    page.drawImage(image, fitImage(image.width / image.height, boxToRect(box, ctx.trim, ctx.bleedIn)));
  }
  if (content.text && config.textBoxEnabled !== false && onLeaf(config.textBox)) {
    const box = config.textBox ?? { x: 1, y: 1, width: ctx.trim.widthIn - 2, height: ctx.trim.heightIn - 2 };
    drawTextBox(ctx, page, box, content.text, fontSize);
  }
}

async function drawInteriorPage(ctx: Ctx, content: PrintPage, leavesPerSpread: 1 | 2): Promise<number> {
  if (content.kind === 'blank') {
    addPage(ctx);
    return 1;
  }
  if (content.kind === 'title_page' || content.kind === 'end') {
    const page = addPage(ctx);
    const box = content.kind === 'title_page' ? getLayoutForPageType(ctx.layout, 'titlePage').textBox : undefined;
    const base = Number(ctx.layout.fontSize) || 24;
    const [first, ...rest] = (content.text ?? '').split('\n');
    drawCentredLines(ctx, page, box, [{ text: first, size: Math.round(base * 1.5) }, ...rest.map((text) => ({ text, size: base }))]);
    return 1;
  }
  const config = getLayoutForPageType(ctx.layout, 'inside');
  if (leavesPerSpread === 2) {
    await drawLeaf(ctx, addPage(ctx), config, content, ctx.storyFontSize, 1);
    await drawLeaf(ctx, addPage(ctx), config, content, ctx.storyFontSize, 2);
    return 2;
  }
  await drawLeaf(ctx, addPage(ctx), config, content, ctx.storyFontSize);
  return 1;
}

function storyFontSize(document: PrintDocument, font: PDFFont): number {
  const max = Number(document.layout.fontSize) || 24;
  const box = getLayoutForPageType(document.layout, 'inside').textBox;
  const width = (box ? Number(box.width) : Number(document.layout.leafWidth) - 2) * POINTS_PER_INCH;
  const height = (box ? Number(box.height) : Number(document.layout.leafHeight) - 2) * POINTS_PER_INCH;
  return document.interior
    .filter((p) => p.kind === 'story' && p.text)
    .reduce((size, p) => Math.min(size, fittingFontSize(sanitizeTextForPdf(p.text!), font, max, width, height)), max);
}

async function newContext(document: PrintDocument): Promise<Ctx> {
  const doc = await PDFDocument.create();
  const font = await embedFont(doc, document.layout.font);
  return {
    doc,
    font,
    layout: document.layout,
    trim: { widthIn: Number(document.layout.leafWidth), heightIn: Number(document.layout.leafHeight) },
    bleedIn: document.bleedIn,
    storyFontSize: storyFontSize(document, font),
    images: new Map(),
  };
}

export async function renderInteriorPdf(document: PrintDocument): Promise<{ bytes: Uint8Array; pageCount: number }> {
  const ctx = await newContext(document);
  const leaves = Number(document.layout.leavesPerSpread) === 2 ? 2 : 1;
  let count = 0;
  for (const page of document.interior) count += await drawInteriorPage(ctx, page, leaves);
  if (count > document.interiorPages) {
    throw new Error(`Interior has ${count} pages, more than the ${document.interiorPages} planned`);
  }
  // Fill the padding with picture pages: the story's pictures, then the back cover's.
  const sources = [...document.interior.filter((p) => p.kind === 'story' && p.image).map((p) => p.image!), ...(document.back.image ? [document.back.image] : [])];
  const pictures = await Promise.all([...new Set(sources)].map((image) => embedImage(ctx, image)));
  for (let index = 0; count < document.interiorPages; index += 1) {
    drawCollagePage({ page: addPage(ctx), pictures, index, font: ctx.font, trim: ctx.trim, bleedIn: ctx.bleedIn });
    count += 1;
  }
  ctx.doc.setTitle('Interior');
  return { bytes: await ctx.doc.save(), pageCount: count };
}

/** Front cover, spine (when the product has one), back cover: separate pages, each with bleed. */
export async function renderCoverPdf(document: PrintDocument): Promise<{ bytes: Uint8Array; pageCount: number }> {
  const ctx = await newContext(document);
  const coverConfig = getLayoutForPageType(document.layout, 'cover');
  // The cover art carries the title, so no text box on the front.
  await drawLeaf(ctx, addPage(ctx), coverConfig, { ...document.front, text: null }, ctx.storyFontSize);
  let pages = 1;
  if (document.spineWidthMm !== null) {
    // The spine bleeds top and bottom only: its sides join the boards.
    ctx.doc.addPage([(document.spineWidthMm / MM_PER_INCH) * POINTS_PER_INCH, (ctx.trim.heightIn + 2 * ctx.bleedIn) * POINTS_PER_INCH]);
    pages += 1;
  }
  const backConfig = getLayoutForPageType(document.layout, 'backCover');
  const backFont = Number(document.layout.fontSize) || 24;
  const backBox = backConfig.textBox;
  const backSize =
    backBox && document.back.text
      ? fittingFontSize(sanitizeTextForPdf(document.back.text), ctx.font, Math.min(backFont, 18), Number(backBox.width) * POINTS_PER_INCH, Number(backBox.height) * POINTS_PER_INCH)
      : backFont;
  await drawLeaf(ctx, addPage(ctx), backConfig, document.back, backSize);
  pages += 1;
  ctx.doc.setTitle('Cover');
  return { bytes: await ctx.doc.save(), pageCount: pages };
}

export async function renderPrintPdfs(document: PrintDocument): Promise<RenderedPdfs> {
  const [interior, cover] = await Promise.all([renderInteriorPdf(document), renderCoverPdf(document)]);
  return { interior: interior.bytes, cover: cover.bytes, interiorPageCount: interior.pageCount, coverPageCount: cover.pageCount };
}
