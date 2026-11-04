/**
 * Print services behind the routes (slice 5.5a):
 *   GET  /api/books/{id}/print-options          templates this Book can print in
 *   POST /api/books/{id}/renders                start a print render (locks the Book)
 *   GET  /api/books/{id}/renders                the Book's renders, newest first
 *   GET  /api/books/{id}/renders/{renderId}     one render, or its job's progress
 */
import { createHash } from 'node:crypto';
import type { Firestore } from 'firebase-admin/firestore';
import { layoutFromDocuments, layoutSupports, LAYOUTS_COLLECTION, physicalPageCount } from '../catalog/layouts';
import { books, jobs, manuscripts, renders } from '../data/repositories';
import type { Render } from '../data/schemas/book';
import { BadRequestError, ConflictError, NotFoundError } from '../errors';
import { loadOwned, type VerifiedUser } from '../http';
import { jobIdFor, type JobRunner } from '../jobs';
import { loadPrintTemplate, renderSpec } from './jobs';

export type PrintServiceDeps = {
  db: Firestore;
  runner: Pick<JobRunner, 'enqueueInTransaction'>;
};

export type PrintOption = {
  layoutId: string;
  name: string;
  printProductId: string | null;
  trim: { widthIn: number; heightIn: number };
  leavesPerSpread: 1 | 2;
  /** Interior pages this Book prints as in this template, padding included. */
  interiorPages: number;
  /** Retail price from the product catalogue (a Product linked to this print product), or null. */
  price: { productId: string; priceId: string; currency: string; amountMinor: number } | null;
  isCurrent: boolean;
};

function sha(text: string, length = 24): string {
  return createHash('sha256').update(text).digest('hex').slice(0, length);
}

async function retailPrices(db: Firestore): Promise<Map<string, PrintOption['price']>> {
  const [products, prices] = await Promise.all([
    db.collection('products').where('active', '==', true).get(),
    db.collection('prices').where('active', '==', true).get(),
  ]);
  const priceByProduct = new Map<string, { id: string; currency: string; amountMinor: number }>();
  for (const doc of prices.docs) {
    const data = doc.data();
    if (data.interval || typeof data.productId !== 'string' || typeof data.amountMinor !== 'number') continue;
    // GBP first (shipping to the UK is included in the price).
    const current = priceByProduct.get(data.productId);
    if (!current || (data.currency === 'GBP' && current.currency !== 'GBP')) {
      priceByProduct.set(data.productId, { id: doc.id, currency: String(data.currency), amountMinor: data.amountMinor });
    }
  }
  const byPrintProduct = new Map<string, PrintOption['price']>();
  for (const doc of products.docs) {
    const printProductId = doc.data().printProductId;
    const price = priceByProduct.get(doc.id);
    if (typeof printProductId === 'string' && printProductId && price && !byPrintProduct.has(printProductId)) {
      byPrintProduct.set(printProductId, { productId: doc.id, priceId: price.id, currency: price.currency, amountMinor: price.amountMinor });
    }
  }
  return byPrintProduct;
}

/** Print templates compatible with this Book's length and density, cheapest first, then by name. */
export async function printOptions(db: Firestore, user: VerifiedUser, bookId: string): Promise<PrintOption[]> {
  const book = await loadOwned(user, books.using(db), bookId);
  const manuscript = await manuscripts.using(db).require(book.manuscriptId);
  const [layoutDocs, prices] = await Promise.all([db.collection(LAYOUTS_COLLECTION).get(), retailPrices(db)]);
  const productIds = [...new Set(layoutDocs.docs.map((d) => d.data().printProductId).filter((id): id is string => typeof id === 'string' && !!id))];
  const productDocs = await Promise.all(productIds.map((id) => db.collection('printProducts').doc(id).get()));
  const products = new Map(productDocs.filter((d) => d.exists).map((d) => [d.id, d.data() ?? {}]));

  const options: PrintOption[] = [];
  for (const doc of layoutDocs.docs) {
    const data = doc.data();
    const layout = layoutFromDocuments(doc.id, data, printProductOf(data, products));
    if (layout.medium !== 'print') continue;
    if (!layoutSupports(layout, manuscript.length, manuscript.density).ok) continue;
    options.push({
      layoutId: doc.id,
      name: layout.name,
      printProductId: layout.printProductId,
      trim: { widthIn: Number(data.leafWidth), heightIn: Number(data.leafHeight) },
      leavesPerSpread: layout.leavesPerSpread,
      interiorPages: physicalPageCount(manuscript.length, layout.pageRules, layout.leavesPerSpread),
      price: layout.printProductId ? (prices.get(layout.printProductId) ?? null) : null,
      isCurrent: book.layoutId === doc.id,
    });
  }
  return options.sort(
    (a, b) => (a.price?.amountMinor ?? Infinity) - (b.price?.amountMinor ?? Infinity) || a.name.localeCompare(b.name)
  );
}

function printProductOf(data: Record<string, unknown>, products: Map<string, Record<string, unknown>>) {
  return typeof data.printProductId === 'string' ? (products.get(data.printProductId) ?? null) : null;
}

export function renderIdFor(bookId: string, layoutId: string, idempotencyKey: string): string {
  return `rn_${sha(`${bookId}|${layoutId}|${idempotencyKey}`)}`;
}

export type StartRenderInput = { layoutId: string; idempotencyKey: string };
export type StartRenderResult = { renderId: string; jobId: string; status: 'rendering' | 'ready' };

/**
 * Start a print render. The Book must be finished with every picture drawn; a
 * `ready` Book is locked here (content frozen: ADR-0010), a `locked` one is
 * used as it is. The same idempotency key returns the same render.
 */
export async function startRender(deps: PrintServiceDeps, user: VerifiedUser, bookId: string, body: StartRenderInput): Promise<StartRenderResult> {
  const { db } = deps;
  const bookRepo = books.using(db);
  const owned = await loadOwned(user, bookRepo, bookId);
  const template = await loadPrintTemplate(db, body.layoutId);
  if (!template) throw new NotFoundError(`No print template ${body.layoutId}`, { code: 'LAYOUT_NOT_FOUND' });
  if (template.layout.medium !== 'print') throw new BadRequestError('That template is not for print', { code: 'LAYOUT_NOT_PRINT' });
  const manuscript = await manuscripts.using(db).require(owned.manuscriptId);
  const supported = layoutSupports(template.layout, manuscript.length, manuscript.density);
  if (!supported.ok) throw new ConflictError(supported.reason, { code: 'LAYOUT_UNSUPPORTED' });

  const renderId = renderIdFor(bookId, body.layoutId, body.idempotencyKey);
  if (await renders.using(db).of(bookId).get(renderId)) {
    return { renderId, jobId: jobIdFor(renderSpec(owned, { renderId, layoutId: body.layoutId }).idempotencyKey!), status: 'ready' };
  }

  const outcome = await db.runTransaction(async (tx) => {
    const book = await bookRepo.requireIn(tx, bookId);
    if (book.art.failed > 0) {
      throw new ConflictError('Some pictures in this book are missing; retry them before printing', {
        code: 'BOOK_HAS_MISSING_ART',
        details: { failed: book.art.failed },
      });
    }
    if (book.status !== 'locked' && book.status !== 'ready') {
      throw new ConflictError('A book can be printed once its pictures are finished', { code: 'BOOK_NOT_FINISHED', details: { status: book.status } });
    }
    const pending = await deps.runner.enqueueInTransaction(tx, [renderSpec(book, { renderId, layoutId: body.layoutId })]);
    if (book.status !== 'locked') await bookRepo.updateIn(tx, bookId, { status: 'locked' });
    return pending;
  });
  await outcome.dispatch();
  return { renderId, jobId: outcome.jobs[0].jobId, status: 'rendering' };
}

export type RenderView = {
  renderId: string;
  status: 'rendering' | 'ready' | 'failed';
  layoutId: string | null;
  medium: Render['medium'] | null;
  interiorPages: number | null;
  spineWidthMm: number | null;
  files: Array<{ role: string; url: string | null; pageCount: number | null }>;
  error: string | null;
  createdAt: string | null;
};

function iso(value: unknown): string | null {
  if (value && typeof (value as { toDate?: () => Date }).toDate === 'function') return (value as { toDate: () => Date }).toDate().toISOString();
  return value instanceof Date ? value.toISOString() : null;
}

function viewOf(renderId: string, render: Render): RenderView {
  return {
    renderId,
    status: 'ready',
    layoutId: render.layoutId,
    medium: render.medium,
    interiorPages: render.interiorPages,
    spineWidthMm: render.spineWidthMm,
    files: render.files.map((f) => ({ role: f.role, url: f.url, pageCount: f.pageCount })),
    error: null,
    createdAt: iso(render.createdAt),
  };
}

/** One render; while its document does not exist yet, its job's progress. */
export async function getRender(db: Firestore, user: VerifiedUser, bookId: string, renderId: string): Promise<RenderView> {
  const book = await loadOwned(user, books.using(db), bookId);
  const render = await renders.using(db).of(bookId).get(renderId);
  if (render) return viewOf(renderId, render);
  const job = await jobs.using(db).get(jobIdFor(`book.render:${book.id}:${renderId}`));
  if (!job) throw new NotFoundError('Render not found', { code: 'RENDER_NOT_FOUND' });
  const failed = job.status === 'failed' || job.status === 'cancelled';
  return {
    renderId,
    status: failed ? 'failed' : 'rendering',
    layoutId: typeof job.input?.layoutId === 'string' ? job.input.layoutId : null,
    medium: 'print',
    interiorPages: null,
    spineWidthMm: null,
    files: [],
    error: failed ? (job.error?.message ?? 'The render failed') : null,
    createdAt: iso(job.createdAt),
  };
}

/** The Book's finished renders, newest first. */
export async function listRenders(db: Firestore, user: VerifiedUser, bookId: string): Promise<RenderView[]> {
  await loadOwned(user, books.using(db), bookId);
  const all = await renders.using(db).of(bookId).where({});
  return all.map((r) => viewOf(r.id, r)).sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''));
}
