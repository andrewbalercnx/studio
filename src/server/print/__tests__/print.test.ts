import { beforeEach, describe, expect, it, vi } from 'vitest';

const enforcePersonaScope = vi.fn();
vi.mock('@/lib/persona.server', () => ({
  enforcePersonaScope: (...args: unknown[]) => enforcePersonaScope(...args),
}));

import { PDFDict, PDFDocument, PDFName } from 'pdf-lib';
import SampleLayouts from '@/data/print-layouts.json';
import type { PrintLayout, PrintProduct } from '@/lib/types';
import { books, renders } from '../../data/repositories';
import { createBook } from '../../books/service';
import { createBench, PNG_1X1, seed, user, type Bench } from '../../books/__tests__/helpers';
import { buildPrintDocument, bleedInchesFor, PrintAdapterError, titlePageText, type BookPrintSource } from '../adapter';
import { boxToRect, fitImage, renderCoverPdf, renderInteriorPdf, spineWidthMm, type PrintImage } from '../render';
import { collagePictures } from '../collage';
import { getRender, listRenders, printOptions, startRender } from '../service';

const spreadLayout = (SampleLayouts as { printLayouts: PrintLayout[] }).printLayouts[0]; // 8×10, two leaves per story page
const singleLayout: PrintLayout = { ...spreadLayout, id: 'single', name: 'Single 8x10', leavesPerSpread: 1 };
const product = {
  id: 'hardcover',
  name: 'Hardcover',
  spine: true,
  blankPages: 0,
  mixamSpec: {
    binding: { type: 'case' },
    interior: { material: { type: 'silk', weight: 170 } },
    format: { minPageCount: 24, maxPageCount: 64, pageCountIncrement: 4, bleedRequired: 3.175 },
  },
} as unknown as PrintProduct;
const rules = { minPages: 24, maxPages: 64, pageMultiple: 4 as const };
const png: PrintImage = { bytes: new Uint8Array(PNG_1X1), type: 'png' };

function source(storyPages: number, overrides: Partial<BookPrintSource> = {}): BookPrintSource {
  return {
    title: 'The Big Day',
    childName: 'Emma',
    synopsis: 'Emma and Rex have the biggest day ever.',
    pages: [
      { pageNumber: 1, kind: 'cover', artUrl: 'https://art/1', text: null },
      { pageNumber: 2, kind: 'title', artUrl: null, text: null },
      ...Array.from({ length: storyPages }, (_, i) => ({ pageNumber: i + 3, kind: 'story' as const, artUrl: `https://art/${i + 3}`, text: `Page ${i + 1}: Emma and Rex play.` })),
      { pageNumber: storyPages + 3, kind: 'end', artUrl: null, text: null },
      { pageNumber: storyPages + 4, kind: 'back', artUrl: 'https://art/back', text: null },
    ],
    ...overrides,
  };
}

const fetchImage = async (url: string) => (url.includes('missing') ? null : png);

describe('print geometry', () => {
  it('places boxes inside the trim and extends edge-touching boxes into the bleed', () => {
    const trim = { widthIn: 8, heightIn: 10 };
    const bleed = 0.125;
    expect(boxToRect({ x: 0, y: 0, width: 8, height: 10 }, trim, bleed)).toEqual({ x: 0, y: 0, width: 8.25 * 72, height: 10.25 * 72 });
    const inner = boxToRect({ x: 1, y: 1, width: 6, height: 2 }, trim, bleed);
    expect(inner).toEqual({ x: 1.125 * 72, y: (10.25 - 3.125) * 72, width: 6 * 72, height: 2 * 72 });
  });

  it('fills a box when the stretch is small and letterboxes otherwise', () => {
    const box = { x: 0, y: 0, width: 800, height: 1000 };
    expect(fitImage(0.75, box)).toEqual(box); // 3:4 art on 4:5 page: 6 % stretch
    expect(fitImage(1, box)).toEqual({ x: 0, y: 100, width: 800, height: 800 });
  });

  it('works out spine width from pages, paper and binding', () => {
    expect(spineWidthMm(24, { type: 'silk', weight: 170 }, true)).toBe(5.8);
    expect(spineWidthMm(48, { type: 'silk', weight: 170 }, false)).toBe(3.7);
    expect(bleedInchesFor(product)).toBeCloseTo(0.125);
    expect(bleedInchesFor(null)).toBeCloseTo(0.125);
  });
});

describe('Book → print document', () => {
  it('maps matter pages, covers and story pages, and pads a single-leaf template', async () => {
    const doc = await buildPrintDocument({ source: source(12), layout: singleLayout, product, rules, fetchImage });
    expect(doc.interior.map((p) => p.kind)).toEqual(['title_page', ...Array(12).fill('story'), 'end']);
    expect(doc.interior[0].text).toBe(titlePageText('The Big Day', 'Emma'));
    expect(doc.interior[0].text).toContain('by Emma');
    expect(doc.interior.at(-1)!.text).toBe('The End');
    expect(doc.back.text).toBe('Emma and Rex have the biggest day ever.');
    expect(doc.front.text).toBeNull();
    expect(doc.interiorPages).toBe(24); // 2 + 12 → 14, padded to the 24-page minimum
    expect(doc.spineWidthMm).toBe(5.8);
  });

  it('counts two leaves per story page on a spread template', async () => {
    const doc = await buildPrintDocument({ source: source(16), layout: spreadLayout, product, rules, fetchImage });
    expect(doc.interiorPages).toBe(36); // 2 + 16 × 2 = 34 → 36
  });

  it('refuses a book with a missing picture or without a back cover', async () => {
    const missing = source(12);
    missing.pages[4].artUrl = 'https://art/missing';
    await expect(buildPrintDocument({ source: missing, layout: singleLayout, product, rules, fetchImage })).rejects.toMatchObject({ code: 'MISSING_ART' });
    const noBack = source(12);
    noBack.pages = noBack.pages.filter((p) => p.kind !== 'back');
    await expect(buildPrintDocument({ source: noBack, layout: singleLayout, product, rules, fetchImage })).rejects.toBeInstanceOf(PrintAdapterError);
  });

  it('refuses a book longer than the template holds', async () => {
    await expect(
      buildPrintDocument({ source: source(24), layout: spreadLayout, product, rules: { ...rules, maxPages: 48 }, fetchImage })
    ).rejects.toMatchObject({ code: 'TOO_MANY_PAGES' });
  });
});

describe('PDF render', () => {
  it('renders the interior at trim + bleed with the planned page count', async () => {
    const doc = await buildPrintDocument({ source: source(12), layout: spreadLayout, product, rules, fetchImage });
    const interior = await renderInteriorPdf(doc);
    expect(interior.pageCount).toBe(28); // 2 + 12 × 2 = 26 → 28
    const pdf = await PDFDocument.load(interior.bytes);
    expect(pdf.getPageCount()).toBe(28);
    for (const page of pdf.getPages()) {
      expect(page.getWidth()).toBeCloseTo(8.25 * 72);
      expect(page.getHeight()).toBeCloseTo(10.25 * 72);
    }
  });

  it('fills the padding after "The End" with pages of the Book\'s pictures, not blank paper', async () => {
    // Single leaf: title + 12 story pages + end = 14 → padded to 24, so 10 picture pages.
    const doc = await buildPrintDocument({ source: source(12), layout: singleLayout, product, rules, fetchImage });
    const pdf = await PDFDocument.load((await renderInteriorPdf(doc)).bytes);
    const images = (index: number) => {
      const xobjects = pdf.getPage(index).node.Resources()?.lookup(PDFName.of('XObject'));
      return xobjects instanceof PDFDict ? xobjects.keys().length : 0;
    };
    expect(images(13)).toBe(0); // "The End"
    for (let index = 14; index < 24; index += 1) expect(images(index)).toBeGreaterThan(0);
  });

  it('picks different pictures for consecutive picture pages, wrapping round', () => {
    const pictures = ['a', 'b', 'c', 'd', 'e'];
    expect(collagePictures(pictures, 0)).toEqual(['a', 'b', 'c']);
    expect(collagePictures(pictures, 1)).toEqual(['d', 'e', 'a']);
    expect(collagePictures(['a', 'b'], 3)).toEqual(['a', 'b']);
    expect(collagePictures([], 0)).toEqual([]);
  });

  it('gives the cover a spine unless the print product says no, as the admin form shows it', async () => {
    const { spine: _spine, ...unset } = product as unknown as Record<string, unknown>;
    const withoutField = await buildPrintDocument({ source: source(12), layout: spreadLayout, product: unset as unknown as PrintProduct, rules, fetchImage });
    expect(withoutField.spineWidthMm).toBeGreaterThan(0);
    const off = await buildPrintDocument({ source: source(12), layout: spreadLayout, product: { ...product, spine: false }, rules, fetchImage });
    expect(off.spineWidthMm).toBeNull();
    expect((await renderCoverPdf(withoutField)).pageCount).toBe(3);
  });

  it('renders the cover as front, spine and back', async () => {
    const doc = await buildPrintDocument({ source: source(12), layout: spreadLayout, product, rules, fetchImage });
    const cover = await PDFDocument.load((await renderCoverPdf(doc)).bytes);
    expect(cover.getPageCount()).toBe(3);
    const [front, spine, back] = cover.getPages();
    expect(front.getWidth()).toBeCloseTo(8.25 * 72);
    expect(spine.getWidth()).toBeCloseTo((doc.spineWidthMm! / 25.4) * 72);
    expect(spine.getHeight()).toBeCloseTo(10.25 * 72);
    expect(back.getWidth()).toBeCloseTo(8.25 * 72);

    const paperback = await buildPrintDocument({ source: source(12), layout: spreadLayout, product: { ...product, spine: false }, rules, fetchImage });
    expect((await PDFDocument.load((await renderCoverPdf(paperback)).bytes)).getPageCount()).toBe(2);
  });
});

describe('print renders through the service and job', () => {
  const p1 = user('p1');
  const p2 = user('p2');
  let bench: Bench;

  beforeEach(async () => {
    enforcePersonaScope.mockReset();
    enforcePersonaScope.mockResolvedValue({ ok: true, persona: null });
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    bench = createBench();
    await seed(bench.db);
    const { id: _id, ...layout } = spreadLayout;
    await bench.db.collection('printLayouts').doc('spread').set({ ...layout, printProductId: 'hardcover', pageConstraints: { maxPages: 48, pageMultiple: 4 } });
    const { id: _pid, ...productDoc } = product;
    await bench.db.collection('printProducts').doc('hardcover').set(productDoc);
    await bench.db.collection('printLayouts').doc('small').set({ name: 'Small', leafWidth: 6, leafHeight: 6, pageConstraints: { maxPages: 12, pageMultiple: 4 } });
    await bench.db.collection('products').doc('book-hardcover').set({ active: true, printProductId: 'hardcover', name: 'Hardcover book' });
    await bench.db.collection('prices').doc('gbp').set({ active: true, productId: 'book-hardcover', currency: 'GBP', amountMinor: 2499 });
  });

  async function readyBook(): Promise<string> {
    const { bookId } = await createBook(bench.services, p1, { storyId: 's1', formId: 'picture', styleId: 'water' });
    await bench.drain();
    return bookId;
  }

  it('lists compatible templates with page counts and prices', async () => {
    const bookId = await readyBook();
    const options = await printOptions(bench.db, p1, bookId);
    expect(options[0]).toMatchObject({ layoutId: 'spread', interiorPages: 28, leavesPerSpread: 2, price: { amountMinor: 2499, currency: 'GBP' } });
    // `small` holds 12 pages; a 12-page book needs 14 before padding.
    expect(options.map((o) => o.layoutId)).not.toContain('small');
    expect(options.map((o) => o.layoutId)).toContain('square');
  });

  it('locks the Book, renders both PDFs and writes one immutable render', async () => {
    const bookId = await readyBook();
    const started = await startRender(bench.services, p1, bookId, { layoutId: 'spread', idempotencyKey: 'render-key-1' });
    expect(started.status).toBe('rendering');
    expect((await books.using(bench.db).require(bookId)).status).toBe('locked');
    expect((await getRender(bench.db, p1, bookId, started.renderId)).status).toBe('rendering');

    await bench.drain();
    const render = await renders.using(bench.db).of(bookId).require(started.renderId);
    expect(render).toMatchObject({ medium: 'print', layoutId: 'spread', printProductId: 'hardcover', interiorPages: 28, spineWidthMm: 6.1, bleedIn: 0.125 });
    expect(render.files.map((f) => [f.role, f.storagePath, f.pageCount])).toEqual([
      ['interior', `books/${bookId}/renders/${started.renderId}/interior.pdf`, 28],
      ['cover', `books/${bookId}/renders/${started.renderId}/cover.pdf`, 3],
    ]);
    expect(render.files.every((f) => /^[0-9a-f]{64}$/.test(f.sha256 ?? ''))).toBe(true);
    expect(bench.saved.get(`books/${bookId}/renders/${started.renderId}/interior.pdf`)?.contentType).toBe('application/pdf');

    const view = await getRender(bench.db, p1, bookId, started.renderId);
    expect(view).toMatchObject({ status: 'ready', interiorPages: 28 });
    expect(await listRenders(bench.db, p1, bookId)).toHaveLength(1);

    // Same key → same render; renders are never updated.
    expect(await startRender(bench.services, p1, bookId, { layoutId: 'spread', idempotencyKey: 'render-key-1' })).toMatchObject({
      renderId: started.renderId,
      status: 'ready',
    });
    await expect(renders.using(bench.db).of(bookId).update(started.renderId, { layoutId: 'other' })).rejects.toThrow();
    // A new key is a new render, beside the old one.
    const second = await startRender(bench.services, p1, bookId, { layoutId: 'spread', idempotencyKey: 'render-key-2' });
    await bench.drain();
    expect(second.renderId).not.toBe(started.renderId);
    expect(await listRenders(bench.db, p1, bookId)).toHaveLength(2);
  });

  it("refuses another family's Book, a Book with missing pictures and an unsupported template", async () => {
    const bookId = await readyBook();
    await expect(startRender(bench.services, p2, bookId, { layoutId: 'spread', idempotencyKey: 'render-key-1' })).rejects.toThrow();
    await expect(printOptions(bench.db, p2, bookId)).rejects.toThrow();
    await expect(startRender(bench.services, p1, bookId, { layoutId: 'small', idempotencyKey: 'render-key-1' })).rejects.toMatchObject({ code: 'LAYOUT_UNSUPPORTED' });
    await bench.db.collection('books').doc(bookId).update({ status: 'partial', art: { total: 14, done: 13, failed: 1 } });
    await expect(startRender(bench.services, p1, bookId, { layoutId: 'spread', idempotencyKey: 'render-key-1' })).rejects.toMatchObject({ code: 'BOOK_HAS_MISSING_ART' });
    expect((await books.using(bench.db).require(bookId)).status).toBe('partial');
  });

  it('fails the render job without retrying when the Book was unlocked meanwhile', async () => {
    const bookId = await readyBook();
    const started = await startRender(bench.services, p1, bookId, { layoutId: 'spread', idempotencyKey: 'render-key-1' });
    await bench.db.collection('books').doc(bookId).update({ status: 'ready' });
    await bench.drain();
    expect(await renders.using(bench.db).of(bookId).get(started.renderId)).toBeNull();
    expect(await getRender(bench.db, p1, bookId, started.renderId)).toMatchObject({ status: 'failed', error: expect.stringContaining('locked') });
  });
});
