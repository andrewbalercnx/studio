/**
 * Book → PrintDocument (slice 5.5a). Maps the Book's pages, read through the
 * same join as GET /api/books/{id}, onto a template:
 *
 *   cover  → front cover (art; the title is in the art)
 *   back   → back cover (art, plus the synopsis in the back-cover text box)
 *   title  → typeset title page: the title and "by {child}"
 *   story  → the picture and words in the template's inside boxes
 *            (two leaves per story page on a spread template)
 *   end    → typeset "The End"
 *   blank  → a blank page
 *
 * then pads with blank pages to the count the template's page model gives.
 */
import type { PrintLayout, PrintProduct } from '@/lib/types';
import { physicalPageCount, type PageRules } from '../catalog/layouts';
import type { BookPageKind } from '../data/schemas/book';
import { MM_PER_INCH, spineWidthMm, type PrintDocument, type PrintImage, type PrintPage } from './render';

export type BookPrintPage = {
  pageNumber: number;
  kind: BookPageKind;
  artUrl: string | null;
  text: string | null;
};

export type BookPrintSource = {
  title: string | null;
  childName: string | null;
  synopsis: string | null;
  pages: BookPrintPage[];
};

export type FetchPrintImage = (url: string) => Promise<PrintImage | null>;

/** Standard print bleed (1/8 inch) when a product does not say. */
export const DEFAULT_BLEED_MM = 3.175;
export const END_PAGE_TEXT = 'The End';

export class PrintAdapterError extends Error {
  constructor(
    readonly code: 'NO_FRONT_COVER' | 'NO_BACK_COVER' | 'MISSING_ART' | 'TOO_MANY_PAGES',
    message: string
  ) {
    super(message);
    this.name = 'PrintAdapterError';
  }
}

export function bleedInchesFor(product: PrintProduct | null): number {
  const mm = Number(product?.mixamSpec?.format?.bleedRequired);
  return (Number.isFinite(mm) && mm >= 0 ? mm : DEFAULT_BLEED_MM) / MM_PER_INCH;
}

export function isCaseBound(product: PrintProduct | null): boolean {
  const type = product?.mixamSpec?.binding?.type;
  return type === 'case' || type === 'case_with_sewing';
}

export function titlePageText(title: string | null, childName: string | null): string {
  const lines = [title?.trim() || 'My Story'];
  if (childName?.trim()) lines.push('', `by ${childName.trim()}`);
  return lines.join('\n');
}

/**
 * Build the PrintDocument. Story pages without art fail the render (a print
 * must not silently drop pictures); the covers must have art too.
 */
export async function buildPrintDocument(input: {
  source: BookPrintSource;
  layout: PrintLayout;
  product: PrintProduct | null;
  rules: PageRules;
  fetchImage: FetchPrintImage;
}): Promise<PrintDocument> {
  const { source, layout, product, rules } = input;
  const pages = [...source.pages].sort((a, b) => a.pageNumber - b.pageNumber);
  const art = async (page: BookPrintPage): Promise<PrintImage> => {
    const image = page.artUrl ? await input.fetchImage(page.artUrl) : null;
    if (!image) throw new PrintAdapterError('MISSING_ART', `Page ${page.pageNumber} (${page.kind}) has no usable picture`);
    return image;
  };

  const frontPage = pages.find((p) => p.kind === 'cover');
  if (!frontPage) throw new PrintAdapterError('NO_FRONT_COVER', 'This book has no front cover');
  const backPage = pages.find((p) => p.kind === 'back');
  if (!backPage) throw new PrintAdapterError('NO_BACK_COVER', 'This book has no back cover; recreate it to print');

  const interior: PrintPage[] = [];
  let storyPages = 0;
  for (const page of pages) {
    switch (page.kind) {
      case 'title':
        interior.push({ kind: 'title_page', text: titlePageText(source.title, source.childName), image: null, bookPage: page.pageNumber });
        break;
      case 'story':
        storyPages += 1;
        interior.push({ kind: 'story', text: page.text, image: await art(page), bookPage: page.pageNumber });
        break;
      case 'end':
        interior.push({ kind: 'end', text: END_PAGE_TEXT, image: null, bookPage: page.pageNumber });
        break;
      case 'blank':
      case 'dedication':
        interior.push({ kind: 'blank', text: null, image: null, bookPage: page.pageNumber });
        break;
      default:
        break;
    }
  }

  const leaves = Number(layout.leavesPerSpread) === 2 ? 2 : 1;
  const interiorPages = physicalPageCount(storyPages, rules, leaves);
  const used = interior.reduce((sum, p) => sum + (p.kind === 'story' ? leaves : 1), 0);
  if (used > interiorPages || (rules.maxPages > 0 && interiorPages > rules.maxPages)) {
    throw new PrintAdapterError('TOO_MANY_PAGES', `This book needs ${Math.max(used, interiorPages)} pages; ${layout.name} holds ${rules.maxPages}`);
  }

  const paper = product?.mixamSpec?.interior?.material ?? null;
  return {
    layout,
    bleedIn: bleedInchesFor(product),
    spineWidthMm: product?.spine ? spineWidthMm(interiorPages, paper, isCaseBound(product)) : null,
    interior,
    front: { kind: 'cover_front', text: null, image: await art(frontPage), bookPage: frontPage.pageNumber },
    back: { kind: 'cover_back', text: source.synopsis?.trim() || null, image: await art(backPage), bookPage: backPage.pageNumber },
    interiorPages,
  };
}
