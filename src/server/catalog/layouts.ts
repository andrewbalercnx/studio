/**
 * Layout: where words and pictures sit on a physical page (domain-model.md).
 *
 * Target collection `layouts/{layoutId}` with `medium`, supported lengths and
 * densities. Read for now from today's `printLayouts`, with only what Book
 * creation needs to check compatibility (the print slice reads the rest):
 *
 *   printLayouts.name                         → Layout.name
 *   (all of them)                             → Layout.medium = 'print'
 *   printLayouts.leafWidth / leafHeight       → Layout.aspect (picture aspect ratio hint)
 *   printLayouts.pageConstraints, or the linked
 *   printProducts.mixamSpec (via resolvePageConstraints)
 *                                             → Layout.pageRules {minPages, maxPages, pageMultiple}
 *   printLayouts.supportedLengths / supportedDensities (target fields, when present)
 *                                             → Layout.supportedLengths / supportedDensities
 *
 * The template decides the page arithmetic (slice 5.5): interior pages =
 * matter (title page, end page) + story pages × `leavesPerSpread` (a spread
 * template prints each story page as two leaves: words on one, picture on the
 * other), padded to the product's page multiple and minimum (ADR-0011: 12 and
 * 16 story pages print as 24 interior pages, 24 as 28 on a single-leaf
 * template). The covers are a separate PDF. A Layout supports a length when
 * that fits under its maximum.
 */
import type { Firestore } from 'firebase-admin/firestore';
import { resolvePageConstraints } from '@/lib/print-constraints';
import { getLayoutForPageType } from '@/lib/print-layout-utils';
import { SCREEN_ASPECT_RATIO } from '@/lib/books/format';
import type { PrintLayout, PrintLayoutPageType, PrintProduct } from '@/lib/types';

/** Interior pages around the story: the title page and the end page (a dedication comes later). */
export const INTERIOR_MATTER_PAGES = 2;

export type PageRules = { minPages: number; maxPages: number; pageMultiple: 1 | 2 | 4 };

export type Layout = {
  layoutId: string;
  name: string;
  medium: 'screen' | 'print';
  /** Width / height of a whole leaf, or null when unknown (a fallback shape hint). */
  aspect: number | null;
  /**
   * Width / height of the *picture region* (the template's `imageBox`) for each
   * art page type, or null when the template defines none. This — not the leaf —
   * is the shape page art must be drawn at, so it fills the box the print
   * renderer places it in without cropping or letterboxing.
   */
  imageAspects: { cover: number | null; inside: number | null; back: number | null };
  pageRules: PageRules;
  /** Printed leaves per story page: 1, or 2 for a spread template (words and picture on facing pages). */
  leavesPerSpread: 1 | 2;
  /** The linked print product (trim, bleed, binding), or null. */
  printProductId: string | null;
  /** Explicit menus from a re-seeded `layouts` document; null = derived from `pageRules`. */
  supportedLengths: number[] | null;
  supportedDensities: string[] | null;
};

/** Today's collection holding Layouts. */
export const LAYOUTS_COLLECTION = 'printLayouts';

export function layoutFromDocuments(layoutId: string, layoutDoc: Record<string, unknown>, productDoc?: Record<string, unknown> | null): Layout {
  const layout = { id: layoutId, ...layoutDoc } as PrintLayout;
  const product = productDoc ? ({ ...productDoc } as PrintProduct) : null;
  const rules = resolvePageConstraints(layout, product);
  const width = Number(layout.leafWidth);
  const height = Number(layout.leafHeight);
  // The picture-region aspect per page type, resolved the same way the print
  // renderer resolves its boxes (page-specific layout, else legacy arrays).
  const boxAspect = (pageType: PrintLayoutPageType): number | null => {
    const box = getLayoutForPageType(layout, pageType).imageBox;
    return box && Number(box.width) > 0 && Number(box.height) > 0 ? Number(box.width) / Number(box.height) : null;
  };
  const asNumbers = (value: unknown): number[] | null =>
    Array.isArray(value) && value.every((v) => typeof v === 'number') ? (value as number[]) : null;
  const asStrings = (value: unknown): string[] | null =>
    Array.isArray(value) && value.every((v) => typeof v === 'string') ? (value as string[]) : null;
  return {
    layoutId,
    name: typeof layout.name === 'string' ? layout.name : layoutId,
    medium: layoutDoc.medium === 'screen' ? 'screen' : 'print',
    aspect: width > 0 && height > 0 ? width / height : null,
    imageAspects: { cover: boxAspect('cover'), inside: boxAspect('inside'), back: boxAspect('backCover') },
    pageRules: { minPages: rules.minPages, maxPages: rules.maxPages, pageMultiple: rules.pageMultiple },
    leavesPerSpread: Number(layout.leavesPerSpread) === 2 ? 2 : 1,
    printProductId: typeof layout.printProductId === 'string' && layout.printProductId ? layout.printProductId : null,
    supportedLengths: asNumbers(layoutDoc.supportedLengths),
    supportedDensities: asStrings(layoutDoc.supportedDensities),
  };
}

export async function loadLayout(db: Firestore, layoutId: string): Promise<Layout | null> {
  if (!layoutId) return null;
  const snapshot = await db.collection(LAYOUTS_COLLECTION).doc(layoutId).get();
  if (!snapshot.exists) return null;
  const data = snapshot.data() ?? {};
  let product: Record<string, unknown> | null = null;
  if (typeof data.printProductId === 'string' && data.printProductId) {
    const productSnapshot = await db.collection('printProducts').doc(data.printProductId).get();
    product = productSnapshot.exists ? (productSnapshot.data() ?? null) : null;
  }
  return layoutFromDocuments(snapshot.id, data, product);
}

/** Interior pages with content (before padding): matter + story pages × leaves per story page. */
export function contentPageCount(storyPages: number, leavesPerSpread: 1 | 2 = 1): number {
  return INTERIOR_MATTER_PAGES + storyPages * leavesPerSpread;
}

/** Interior pages a Book of `storyPages` prints as under these rules, padding included. */
export function physicalPageCount(storyPages: number, rules: PageRules, leavesPerSpread: 1 | 2 = 1): number {
  const multiple = rules.pageMultiple || 1;
  const padded = Math.ceil(contentPageCount(storyPages, leavesPerSpread) / multiple) * multiple;
  const minimum = rules.minPages > 0 ? Math.ceil(rules.minPages / multiple) * multiple : 0;
  return Math.max(padded, minimum);
}

/** Whether a Manuscript of this length and density can be laid out with this Layout. */
export function layoutSupports(layout: Layout, length: number, density: string): { ok: true } | { ok: false; reason: string } {
  if (layout.supportedLengths && !layout.supportedLengths.includes(length)) {
    return { ok: false, reason: `${layout.name} supports ${layout.supportedLengths.join(', ')} story pages` };
  }
  if (layout.supportedDensities && !layout.supportedDensities.includes(density)) {
    return { ok: false, reason: `${layout.name} does not support ${density} pages` };
  }
  const pages = physicalPageCount(length, layout.pageRules, layout.leavesPerSpread);
  if (layout.pageRules.maxPages > 0 && pages > layout.pageRules.maxPages) {
    return { ok: false, reason: `${layout.name} holds at most ${layout.pageRules.maxPages} pages; this book needs ${pages}` };
  }
  return { ok: true };
}

/** Gemini image aspect ratios; the nearest one to a page shape. */
const ASPECT_RATIOS: Array<[string, number]> = [
  ['1:1', 1],
  ['4:3', 4 / 3],
  ['3:4', 3 / 4],
  ['3:2', 3 / 2],
  ['2:3', 2 / 3],
  ['5:4', 5 / 4],
  ['4:5', 4 / 5],
  ['16:9', 16 / 9],
  ['9:16', 9 / 16],
];

/** The art pages (pipeline.md): the front cover, the story pages and the back cover. */
export type ArtPageKind = 'cover' | 'story' | 'back';
const IMAGE_ASPECT_FOR: Record<ArtPageKind, keyof Layout['imageAspects']> = { cover: 'cover', story: 'inside', back: 'back' };

/**
 * Aspect ratio for page art, snapped to the nearest ratio the image model draws.
 *
 * The target is the shape of the hole the picture goes into: the template's
 * picture region (`imageBox`) for this page type. Only when the template defines
 * no such box do we fall back to the whole leaf, and finally to the screen-Book
 * portrait default (a screen Book has no layout at all).
 */
export function artAspectRatio(layout: Layout | null, kind: ArtPageKind = 'story'): string {
  const aspect = layout?.imageAspects[IMAGE_ASPECT_FOR[kind]] ?? layout?.aspect ?? null;
  if (!aspect) return SCREEN_ASPECT_RATIO;
  return ASPECT_RATIOS.reduce((best, candidate) =>
    Math.abs(Math.log(candidate[1] / aspect)) < Math.abs(Math.log(best[1] / aspect)) ? candidate : best
  )[0];
}
