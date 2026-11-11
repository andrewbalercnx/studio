/**
 * `book.render` (queue `render`): one immutable print render of a locked Book
 * in a template (ADR-0010, slice 5.5a). Writes
 *   books/{bookId}/renders/{renderId}/interior.pdf
 *   books/{bookId}/renders/{renderId}/cover.pdf
 * and then the render document, last, so a render document always points at
 * finished files. A retry rewrites the files (no document points at them yet);
 * once the document exists the job is a no-op.
 */
import { createHash } from 'node:crypto';
import type { Firestore } from 'firebase-admin/firestore';
import type { PrintLayout, PrintProduct } from '@/lib/types';
import { layoutFromDocuments, LAYOUTS_COLLECTION } from '../catalog/layouts';
import { bookPages, books, manuscriptPages, manuscripts, renders, stories } from '../data/repositories';
import type { BlobStore } from '../books/media';
import { JobFailure, type JobContext, type JobDefinition, type JobRegistry, type JobSpec } from '../jobs/registry';
import { buildPrintDocument, PrintAdapterError, type BookPrintSource, type FetchPrintImage } from './adapter';
import { renderPrintPdfs } from './render';

export const RENDER_JOB_KIND = 'book.render';

export type RenderJobDeps = {
  blobs: BlobStore;
  fetchImage: FetchPrintImage;
};

export type RenderJobInput = { renderId: string; layoutId: string };

export function renderSpec(book: { id: string; ownerUid: string }, input: RenderJobInput): JobSpec {
  return {
    kind: RENDER_JOB_KIND,
    ownerUid: book.ownerUid,
    target: { collection: 'books', id: book.id, subpath: `renders/${input.renderId}` },
    input,
    idempotencyKey: `${RENDER_JOB_KIND}:${book.id}:${input.renderId}`,
  };
}

export function renderStoragePath(bookId: string, renderId: string, role: 'interior' | 'cover'): string {
  return `books/${bookId}/renders/${renderId}/${role}.pdf`;
}

/** The template and its print product, as stored today (`printLayouts`, `printProducts`). */
export async function loadPrintTemplate(
  db: Firestore,
  layoutId: string
): Promise<{ raw: PrintLayout; product: PrintProduct | null; layout: ReturnType<typeof layoutFromDocuments> } | null> {
  const snapshot = await db.collection(LAYOUTS_COLLECTION).doc(layoutId).get();
  if (!snapshot.exists) return null;
  const data = snapshot.data() ?? {};
  let productData: Record<string, unknown> | null = null;
  if (typeof data.printProductId === 'string' && data.printProductId) {
    const productSnapshot = await db.collection('printProducts').doc(data.printProductId).get();
    productData = productSnapshot.exists ? (productSnapshot.data() ?? null) : null;
  }
  return {
    raw: { id: snapshot.id, ...data } as PrintLayout,
    product: productData ? ({ id: data.printProductId, ...productData } as PrintProduct) : null,
    layout: layoutFromDocuments(snapshot.id, data, productData),
  };
}

/** The Book's pages with their words, plus title, child name and synopsis. */
export async function loadBookPrintSource(db: Firestore, bookId: string, layoutId?: string): Promise<BookPrintSource> {
  const book = await books.using(db).require(bookId);
  const [manuscript, pages, words, story, child] = await Promise.all([
    manuscripts.using(db).get(book.manuscriptId),
    bookPages.using(db).of(bookId).where({}),
    manuscriptPages.using(db).of(book.manuscriptId).where({}),
    stories.using(db).get(book.storyId),
    db.collection('children').doc(book.childId).get(),
  ]);
  const text = new Map(words.map((p) => [p.pageNumber, p.text]));
  const childName = child.exists ? child.data()?.displayName : null;
  return {
    title: manuscript?.title ?? story?.title ?? null,
    childName: typeof childName === 'string' ? childName : null,
    synopsis: story?.synopsis ?? null,
    pages: pages.map((p) => ({
      pageNumber: p.pageNumber,
      kind: p.kind,
      // The template's print copy of the picture when there is one (book.printArt), else the picture.
      artUrl: (layoutId && p.printArt?.layoutId === layoutId && p.printArt.url) || p.artUrl,
      text: p.manuscriptPage !== null ? (text.get(p.manuscriptPage) ?? null) : null,
    })),
  };
}

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function renderHandler(getDeps: () => Promise<RenderJobDeps>): JobDefinition['run'] {
  return async (ctx: JobContext) => {
    const { db, job } = ctx;
    const { renderId, layoutId } = job.input as RenderJobInput;
    const bookId = job.target.id;
    const renderRepo = renders.using(db).of(bookId);
    if (await renderRepo.get(renderId)) return;

    const book = await books.using(db).require(bookId);
    if (book.status !== 'locked') {
      throw new JobFailure('BOOK_NOT_LOCKED', 'A print render needs a locked Book', { retryable: false });
    }
    const template = await loadPrintTemplate(db, layoutId);
    if (!template) throw new JobFailure('LAYOUT_NOT_FOUND', `No print template ${layoutId}`, { retryable: false });

    const deps = await getDeps();
    let document;
    try {
      document = await buildPrintDocument({
        source: await loadBookPrintSource(db, bookId, layoutId),
        layout: template.raw,
        product: template.product,
        rules: template.layout.pageRules,
        fetchImage: deps.fetchImage,
      });
    } catch (error) {
      if (error instanceof PrintAdapterError) {
        // Missing art may be a network blip; the rest will not change on retry.
        throw new JobFailure(error.code, error.message, { retryable: error.code === 'MISSING_ART', cause: error });
      }
      throw error;
    }

    const pdfs = await renderPrintPdfs(document);
    const metadata = { bookId, renderId, layoutId };
    const files = [];
    for (const [role, bytes, pageCount] of [
      ['interior', pdfs.interior, pdfs.interiorPageCount],
      ['cover', pdfs.cover, pdfs.coverPageCount],
    ] as const) {
      const stored = await deps.blobs.save(renderStoragePath(bookId, renderId, role), Buffer.from(bytes), 'application/pdf', { ...metadata, role });
      files.push({ role, storagePath: stored.storagePath, url: stored.url, sha256: sha256(bytes), bytes: bytes.byteLength, pageCount });
    }

    try {
      await renderRepo.create(
        {
          ownerUid: book.ownerUid,
          medium: 'print',
          layoutId,
          files,
          printProductId: template.product?.id ?? null,
          interiorPages: pdfs.interiorPageCount,
          trim: { widthIn: Number(template.raw.leafWidth), heightIn: Number(template.raw.leafHeight) },
          bleedIn: document.bleedIn,
          spineWidthMm: document.spineWidthMm,
        },
        { id: renderId }
      );
    } catch (error) {
      // A concurrent attempt finished first: renders are immutable, keep theirs.
      if (!(await renderRepo.get(renderId))) throw error;
    }
    // Orders waiting on this render can now be paid (slice 5.5b). Reads on order
    // pages promote them too, so a failure here only delays the change.
    try {
      const { promoteOrdersForRender } = await import('../orders/service');
      await promoteOrdersForRender({ db, now: () => new Date() }, renderId);
    } catch (error) {
      console.warn('[print] Could not move orders on after render', renderId, (error as Error)?.message ?? error);
    }
  };
}

export function registerPrintJobs(registry: JobRegistry, getDeps: () => Promise<RenderJobDeps>): JobRegistry {
  return registry.register({ kind: RENDER_JOB_KIND, queue: 'render', maxAttempts: 3, run: renderHandler(getDeps) });
}
