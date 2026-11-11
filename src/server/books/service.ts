/**
 * Book pipeline services behind the routes (foundations.md layering: route →
 * service → repositories / jobs). Every state change and the jobs it needs are
 * written in one transaction; jobs are dispatched after the commit.
 */
import { createHash, randomUUID } from 'node:crypto';
import type { Firestore, Transaction } from 'firebase-admin/firestore';
import { layoutSupports, loadForm, loadLayout, loadStyle, resolveManuscriptShape, type Form, type ManuscriptShape } from '../catalog';
import { bookPages, books, castSheets, manuscripts } from '../data/repositories';
import type { WithId } from '../data/repository';
import type { Book, BookPage } from '../data/schemas/book';
import type { Manuscript } from '../data/schemas/manuscript';
import { BadRequestError, ConflictError, NotFoundError, PaymentRequiredError } from '../errors';
import { assertOwner, isPrivileged, loadOwned, type VerifiedUser } from '../http';
import type { JobRunner, JobSpec } from '../jobs';
import { chargeBookAllowance, readLedgerIn } from './allowance';
import { ART_PAGE_KINDS, illustrateSpec, paginateSpec, preparePrintSpec, prepareCastSpec, rollupArt, statusFromArt } from './jobs';
import { isFinished, loadStorySource, type StorySource } from './story-source';
import { DEFAULT_TTS_VOICE } from '@/lib/tts-config';

export type BookServiceDeps = {
  db: Firestore;
  runner: Pick<JobRunner, 'enqueueInTransaction'>;
  now?: () => Date;
};

function sha(text: string, length = 24): string {
  return createHash('sha256').update(text).digest('hex').slice(0, length);
}

/** One Manuscript per (story, form, length, density): the id is derived from them. */
export function manuscriptIdFor(storyId: string, formId: string, shape: ManuscriptShape): string {
  return `ms_${sha(`${storyId}|${formId}|${shape.length}|${shape.density}`)}`;
}

/** A Book created with a client idempotency key gets a derived id, so a repeat returns it. */
export function bookIdFor(ownerUid: string, idempotencyKey: string): string {
  return `bk_${sha(`${ownerUid}|${idempotencyKey}`)}`;
}

// ---------------------------------------------------------------------------
// Shared checks
// ---------------------------------------------------------------------------

/** Load the Story and check the caller owns it (persona scope applies). */
async function loadOwnedStory(db: Firestore, user: VerifiedUser, storyId: string): Promise<StorySource & { ownerUid: string; childId: string }> {
  const story = await loadStorySource(db, storyId);
  await assertOwner(user, { ownerUid: story.ownerUid ?? undefined, childId: story.childId ?? undefined }, 'Story');
  if (!story.ownerUid || !story.childId || !isFinished(story)) {
    throw new ConflictError('This story is not finished yet', { code: 'STORY_NOT_READY' });
  }
  return story as StorySource & { ownerUid: string; childId: string };
}

async function loadChoosableForm(db: Firestore, user: VerifiedUser, formId: string): Promise<Form> {
  const form = await loadForm(db, formId);
  if (!form || (form.status !== 'live' && !isPrivileged(user))) {
    throw new NotFoundError('Form not found', { code: 'FORM_NOT_FOUND', details: { formId } });
  }
  return form;
}

function shapeFor(form: Form, requested: { length?: number | null; density?: string | null }): ManuscriptShape {
  const resolved = resolveManuscriptShape(form, requested);
  if (!resolved.ok) {
    throw new BadRequestError(resolved.message, { code: resolved.field === 'length' ? 'INVALID_LENGTH' : 'INVALID_DENSITY' });
  }
  return resolved.shape;
}

/** The narration voice: the child's preference (owner-scoped read), else the default. */
async function voiceFor(db: Firestore, story: { ownerUid: string; childId: string }): Promise<string> {
  const snapshot = await db.collection('children').doc(story.childId).get();
  const data = snapshot.data();
  if (snapshot.exists && data?.ownerUid === story.ownerUid && typeof data.preferredVoiceId === 'string' && data.preferredVoiceId) {
    return data.preferredVoiceId;
  }
  return DEFAULT_TTS_VOICE;
}

type ManuscriptPlan = {
  manuscriptId: string;
  /** Status after this transaction. */
  status: Manuscript['status'];
  created: boolean;
  specs: JobSpec[];
  write: (tx: Transaction) => Promise<void>;
};

/**
 * Inside a transaction (reads only): what to do so a Manuscript for this shape
 * exists and is (or will be) paginated. A failed one is paginated again.
 */
async function planManuscriptIn(
  tx: Transaction,
  db: Firestore,
  story: { storyId: string; ownerUid: string; childId: string },
  form: Form,
  shape: ManuscriptShape,
  voiceId: string
): Promise<ManuscriptPlan & { existing: WithId<Manuscript> | null }> {
  const repo = manuscripts.using(db);
  const manuscriptId = manuscriptIdFor(story.storyId, form.formId, shape);
  const existing = await repo.getIn(tx, manuscriptId);
  const target = { id: manuscriptId, ownerUid: story.ownerUid };
  if (existing && existing.status !== 'failed') {
    return { manuscriptId, existing, status: existing.status, created: false, specs: [], write: async () => undefined };
  }
  if (existing) {
    return {
      manuscriptId,
      existing,
      status: 'paginating',
      created: false,
      specs: [paginateSpec(target, randomUUID())],
      write: (writeTx) => repo.updateIn(writeTx, manuscriptId, { status: 'paginating' }),
    };
  }
  return {
    manuscriptId,
    existing: null,
    status: 'paginating',
    created: true,
    specs: [paginateSpec(target)],
    write: async (writeTx) => {
      await repo.createIn(
        writeTx,
        {
          ownerUid: story.ownerUid,
          storyId: story.storyId,
          childId: story.childId,
          form: form.formId,
          readingLevel: form.readingLevel,
          length: shape.length,
          density: shape.density,
          status: 'paginating',
          narration: { voiceId },
        },
        { id: manuscriptId }
      );
    },
  };
}

// ---------------------------------------------------------------------------
// POST /api/manuscripts
// ---------------------------------------------------------------------------

export type CreateManuscriptInput = { storyId: string; formId: string; length?: number | null; density?: string | null };
export type CreateManuscriptResult = { manuscriptId: string; status: Manuscript['status']; created: boolean };

export async function createManuscript(
  deps: BookServiceDeps,
  user: VerifiedUser,
  body: CreateManuscriptInput
): Promise<CreateManuscriptResult> {
  const story = await loadOwnedStory(deps.db, user, body.storyId);
  const form = await loadChoosableForm(deps.db, user, body.formId);
  const shape = shapeFor(form, body);
  const voiceId = await voiceFor(deps.db, story);

  const outcome = await deps.db.runTransaction(async (tx) => {
    const plan = await planManuscriptIn(tx, deps.db, story, form, shape, voiceId);
    const pending = await deps.runner.enqueueInTransaction(tx, plan.specs);
    await plan.write(tx);
    return { plan, pending };
  });
  await outcome.pending.dispatch();
  return { manuscriptId: outcome.plan.manuscriptId, status: outcome.plan.status, created: outcome.plan.created };
}

// ---------------------------------------------------------------------------
// POST /api/books
// ---------------------------------------------------------------------------

export type CreateBookInput = {
  manuscriptId?: string;
  storyId?: string;
  formId?: string;
  length?: number | null;
  density?: string | null;
  styleId: string;
  layoutId?: string | null;
  /** Client key (e.g. one per "make my book" tap): repeating it returns the same Book, charged once. */
  idempotencyKey?: string | null;
};
export type CreateBookResult = { bookId: string; manuscriptId: string; status: Book['status']; created: boolean };

/**
 * A Book's pages in physical order (pipeline.md, slice 5.5): front cover, title
 * page, the story pages, end page, back cover. Art is drawn for the covers and
 * the story pages; the title and end pages are typeset when printed.
 */
export function bookPagePlan(storyPages: number): Array<{ pageNumber: number; kind: BookPage['kind']; manuscriptPage?: number }> {
  const pages: Array<{ pageNumber: number; kind: BookPage['kind']; manuscriptPage?: number }> = [
    { pageNumber: 1, kind: 'cover' },
    { pageNumber: 2, kind: 'title' },
  ];
  for (let n = 1; n <= storyPages; n++) pages.push({ pageNumber: n + 2, kind: 'story', manuscriptPage: n });
  pages.push({ pageNumber: storyPages + 3, kind: 'end' });
  pages.push({ pageNumber: storyPages + 4, kind: 'back' });
  return pages;
}

export async function createBook(deps: BookServiceDeps, user: VerifiedUser, body: CreateBookInput): Promise<CreateBookResult> {
  const { db } = deps;
  const now = deps.now ?? (() => new Date());

  // --- Resolve what the Book is made from (reads outside the transaction: catalogue, ownership).
  let story: { storyId: string; ownerUid: string; childId: string };
  let form: Form | null = null;
  let shape: ManuscriptShape;
  let manuscriptId: string;
  let voiceId: string | null = null;
  if (body.manuscriptId) {
    const manuscript = await loadOwned(user, manuscripts.using(db), body.manuscriptId);
    story = { storyId: manuscript.storyId, ownerUid: manuscript.ownerUid, childId: manuscript.childId };
    shape = { length: manuscript.length, density: manuscript.density as ManuscriptShape['density'] };
    manuscriptId = manuscript.id;
  } else if (body.storyId && body.formId) {
    story = await loadOwnedStory(db, user, body.storyId);
    form = await loadChoosableForm(db, user, body.formId);
    shape = shapeFor(form, body);
    manuscriptId = manuscriptIdFor(story.storyId, form.formId, shape);
    voiceId = await voiceFor(db, story);
  } else {
    throw new BadRequestError('Give a manuscriptId, or a storyId and formId', { code: 'INVALID_BODY' });
  }

  const style = await loadStyle(db, body.styleId);
  if (!style) throw new NotFoundError('Style not found', { code: 'STYLE_NOT_FOUND', details: { styleId: body.styleId } });
  if (body.layoutId) {
    const layout = await loadLayout(db, body.layoutId);
    if (!layout) throw new NotFoundError('Layout not found', { code: 'LAYOUT_NOT_FOUND', details: { layoutId: body.layoutId } });
    const supported = layoutSupports(layout, shape.length, shape.density);
    if (!supported.ok) throw new BadRequestError(supported.reason, { code: 'LAYOUT_INCOMPATIBLE' });
  }

  const bookRepo = books.using(db);
  const bookId = body.idempotencyKey ? bookIdFor(story.ownerUid, body.idempotencyKey) : (await bookRepo.newRef()).id;
  const book = { id: bookId, ownerUid: story.ownerUid };

  const outcome = await db.runTransaction(async (tx) => {
    // Reads.
    const existingBook = await bookRepo.getIn(tx, bookId);
    if (existingBook) {
      if (existingBook.ownerUid !== story.ownerUid || existingBook.storyId !== story.storyId) {
        throw new ConflictError('This idempotency key was used for another book', { code: 'IDEMPOTENCY_KEY_REUSED' });
      }
      return { result: { bookId, manuscriptId: existingBook.manuscriptId, status: existingBook.status, created: false }, pending: null };
    }

    let plan: ManuscriptPlan;
    if (form) {
      plan = await planManuscriptIn(tx, db, story, form, shape, voiceId ?? DEFAULT_TTS_VOICE);
    } else {
      const manuscript = await manuscripts.using(db).requireIn(tx, manuscriptId);
      if (manuscript.status === 'failed') {
        throw new ConflictError('The words for this book could not be written; try again', { code: 'MANUSCRIPT_FAILED' });
      }
      plan = { manuscriptId, status: manuscript.status, created: false, specs: [], write: async () => undefined };
    }
    const ledger = await readLedgerIn(tx, db, story.ownerUid);
    const charge = chargeBookAllowance(tx, ledger, story.ownerUid, story.childId, now());
    if (!charge.allowed) {
      throw new PaymentRequiredError("You've used all your books. Ask a grown-up to add more to keep creating!", {
        code: 'ENTITLEMENT_LIMIT',
        details: { remaining: charge.remaining },
      });
    }
    // Cast sheets start now if the words are ready; otherwise pagination starts them when it finishes.
    const specs = [...plan.specs, ...(plan.status === 'ready' ? [prepareCastSpec(book)] : [])];
    const pending = await deps.runner.enqueueInTransaction(tx, specs);

    // Writes.
    charge.write();
    await plan.write(tx);
    await bookRepo.createIn(
      tx,
      {
        ownerUid: story.ownerUid,
        manuscriptId,
        storyId: story.storyId,
        childId: story.childId,
        styleId: style.styleId,
        layoutId: body.layoutId ?? null,
        status: 'illustrating',
        // Art: the front cover, every story page and the back cover (the title and end pages are typeset).
        art: { total: shape.length + 2, done: 0, failed: 0 },
        // Where the unit came from, so it can be given back if the words cannot be written.
        allowance: { source: charge.source, refunded: false },
      },
      { id: bookId }
    );
    // Physical order: front cover, title page, story pages, end page, back cover.
    const pageRepo = bookPages.using(db).of(bookId);
    for (const page of bookPagePlan(shape.length)) {
      await pageRepo.createIn(tx, { ownerUid: story.ownerUid, ...page }, { id: String(page.pageNumber) });
    }
    return { result: { bookId, manuscriptId, status: 'illustrating' as const, created: true }, pending };
  });
  await outcome.pending?.dispatch();
  return outcome.result;
}

// ---------------------------------------------------------------------------
// POST /api/books/{bookId}/pages/{n}/retry
// ---------------------------------------------------------------------------

export async function retryPage(
  deps: BookServiceDeps,
  user: VerifiedUser,
  bookId: string,
  pageNumber: number
): Promise<{ bookId: string; pageNumber: number; status: Book['status'] }> {
  const { db } = deps;
  const bookRepo = books.using(db);
  const owned = await loadOwned(user, bookRepo, bookId);
  const pageRepo = bookPages.using(db).of(bookId);

  const outcome = await db.runTransaction(async (tx) => {
    const book = await bookRepo.requireIn(tx, bookId);
    if (book.status === 'locked') throw new ConflictError('Unlock the book first', { code: 'BOOK_LOCKED' });
    const page = await pageRepo.getIn(tx, String(pageNumber));
    if (!page || !ART_PAGE_KINDS.has(page.kind)) throw new NotFoundError('Page not found', { code: 'PAGE_NOT_FOUND' });
    const failed = !page.artUrl && (page.artJob?.status === 'failed' || page.artJob?.status === 'cancelled');
    if (!failed) throw new ConflictError('Only a page whose picture failed can be retried', { code: 'PAGE_NOT_FAILED' });

    // A new run id gives the retry (and its page job) new idempotency keys.
    const pending = await deps.runner.enqueueInTransaction(tx, [illustrateSpec(owned, `retry-${randomUUID()}`, [pageNumber])]);
    await pageRepo.updateIn(tx, String(pageNumber), { artJob: null });
    await bookRepo.updateIn(tx, bookId, {
      status: 'illustrating',
      art: { ...book.art, failed: Math.max(0, book.art.failed - 1) },
    });
    return { pending };
  });
  await outcome.pending.dispatch();
  return { bookId, pageNumber, status: 'illustrating' };
}

// ---------------------------------------------------------------------------
// Re-illustrate a Book (system-level, no user)
// ---------------------------------------------------------------------------

export type ReillustrateResult = {
  bookId: string;
  status: Book['status'];
  pagesCleared: number;
  castSheetsCleared: number;
};

/**
 * Redraw a Book's pictures from scratch, keeping its words.
 *
 * Clears every art page's picture and the cast sheets, then runs the
 * illustration pipeline again (prepareCast → castSheet → illustrate → pageArt),
 * so the cast sheets and page art are regenerated from the current likeness and
 * at the current aspect ratio. Unlike `retryPage` this does not need a failed
 * page; unlike the user routes it reads ownership from the Book document, so it
 * is a system operation, not an impersonation path. A locked Book is refused
 * (unlock it first).
 */
export async function reillustrateBook(deps: BookServiceDeps, bookId: string): Promise<ReillustrateResult> {
  const outcome = await deps.db.runTransaction(async (tx) => {
    const book = await books.using(deps.db).getIn(tx, bookId);
    if (!book) throw new NotFoundError('Book not found', { code: 'BOOK_NOT_FOUND', details: { bookId } });
    if (book.status === 'locked') throw new ConflictError('Unlock the book first', { code: 'BOOK_LOCKED' });
    return redrawIn(tx, deps, book);
  });
  await outcome.pending.dispatch();
  return { bookId, status: 'illustrating', pagesCleared: outcome.pagesCleared, castSheetsCleared: outcome.castSheetsCleared };
}

/**
 * Inside a transaction, after the caller's own reads: wipe the Book's art and
 * cast sheets and enqueue the illustration pipeline under a fresh run nonce
 * (so every job is new). `changes` are written to the Book with the reset.
 */
async function redrawIn(tx: Transaction, deps: BookServiceDeps, book: WithId<Book>, changes: Partial<Book> = {}) {
  const pageRepo = bookPages.using(deps.db).of(book.id);
  const sheetRepo = castSheets.using(deps.db).of(book.id);
  // Reads.
  const pageSnapshot = await tx.get(await pageRepo.collection());
  const artPages = pageSnapshot.docs.map((doc) => pageRepo.parse(doc)).filter((p) => ART_PAGE_KINDS.has(p.kind));
  const sheetSnapshot = await tx.get(await sheetRepo.collection());
  const sheets = sheetSnapshot.docs.map((doc) => sheetRepo.parse(doc));

  const pending = await deps.runner.enqueueInTransaction(tx, [prepareCastSpec({ id: book.id, ownerUid: book.ownerUid }, `redraw-${randomUUID()}`)]);

  // Writes: wipe the art, its print copies and the cast sheets, reset the rollup, start illustrating again.
  // The template stays; its print copies are made again from the new pictures when the parent asks.
  for (const page of artPages) await pageRepo.updateIn(tx, String(page.pageNumber), { artUrl: null, artJob: null, printArt: null });
  for (const sheet of sheets) await sheetRepo.updateIn(tx, sheet.castId, { imageUrl: null, job: null });
  await books.using(deps.db).updateIn(tx, book.id, { ...changes, status: 'illustrating', art: { total: artPages.length, done: 0, failed: 0 }, print: null });
  return { pending, pagesCleared: artPages.length, castSheetsCleared: sheets.length };
}

// ---------------------------------------------------------------------------
// PUT /api/books/{bookId}/layout
// ---------------------------------------------------------------------------

export type SetBookLayoutResult = {
  bookId: string;
  layoutId: string | null;
  print: Book['print'];
  /** True when this call started making print copies (false: the same template, already ready or under way). */
  started: boolean;
};

/**
 * The parent ties a print template (Layout) to a finished Book, or takes it
 * back to screen only with `null` (ADR-0011: the parent picks the Layout).
 *
 * The Book's pictures do not change: each gets a print copy at the template's
 * picture shape (`book.preparePrint` → `book.printArt`: cropped, or extended
 * by the image model when the shapes are far apart). The Book stays readable
 * the whole time, and nothing is charged. The same template again does
 * nothing while its copies are ready or being made, and starts again after a
 * failure. Refused while locked (409 BOOK_LOCKED) and until every picture is
 * drawn (409 BOOK_NOT_FINISHED: `partial` Books redraw their missing pictures first).
 */
export async function setBookLayout(deps: BookServiceDeps, user: VerifiedUser, bookId: string, layoutId: string | null): Promise<SetBookLayoutResult> {
  const { db } = deps;
  const bookRepo = books.using(db);
  const owned = await loadOwned(user, bookRepo, bookId);
  if (layoutId) {
    const layout = await loadLayout(db, layoutId);
    if (!layout) throw new NotFoundError('Layout not found', { code: 'LAYOUT_NOT_FOUND', details: { layoutId } });
    if (layout.medium !== 'print') throw new BadRequestError('That template is not for print', { code: 'LAYOUT_NOT_PRINT' });
    const manuscript = await manuscripts.using(db).require(owned.manuscriptId);
    const supported = layoutSupports(layout, manuscript.length, manuscript.density);
    if (!supported.ok) throw new ConflictError(supported.reason, { code: 'LAYOUT_UNSUPPORTED' });
  }
  const pageRepo = bookPages.using(db).of(bookId);

  const outcome = await db.runTransaction(async (tx) => {
    const book = await bookRepo.requireIn(tx, bookId);
    if (book.status === 'locked') throw new ConflictError('Unlock the book to change its print template', { code: 'BOOK_LOCKED' });
    const underway = book.print?.layoutId === layoutId && (book.print.status === 'preparing' || book.print.status === 'ready');
    if (book.layoutId === layoutId && (layoutId === null || underway)) return { pending: null, print: book.print };
    if (layoutId && book.status !== 'ready') {
      throw new ConflictError('Every picture needs to be drawn first', { code: 'BOOK_NOT_FINISHED', details: { status: book.status } });
    }
    const pageSnapshot = await tx.get(await pageRepo.collection());
    const artPages = pageSnapshot.docs.map((doc) => pageRepo.parse(doc)).filter((p) => ART_PAGE_KINDS.has(p.kind));
    const run = randomUUID();
    const print: Book['print'] = layoutId ? { layoutId, run, status: 'preparing', total: artPages.length, done: 0, failed: 0 } : null;
    const pending = layoutId ? await deps.runner.enqueueInTransaction(tx, [preparePrintSpec(book, layoutId, run)]) : null;
    for (const page of artPages) {
      if (page.printArt) await pageRepo.updateIn(tx, String(page.pageNumber), { printArt: null });
    }
    await bookRepo.updateIn(tx, bookId, { layoutId, print });
    return { pending, print };
  });
  await outcome.pending?.dispatch();
  return { bookId, layoutId, print: outcome.print, started: outcome.pending !== null };
}

// ---------------------------------------------------------------------------
// POST /api/books/{bookId}/lock and /unlock
// ---------------------------------------------------------------------------

/**
 * Runs inside the unlock transaction. Share links (a later slice) register
 * here to be revoked when a Book is unlocked (pipeline.md "Book"). A hook does
 * its reads, then returns the writes to make once every hook has read.
 */
export type BookUnlockHook = (
  tx: Transaction,
  book: WithId<Book>,
  db: Firestore
) => Promise<((tx: Transaction) => void | Promise<void>) | void>;

export const bookUnlockHooks: BookUnlockHook[] = [];

export async function lockBook(deps: BookServiceDeps, user: VerifiedUser, bookId: string): Promise<{ bookId: string; status: 'locked' }> {
  const bookRepo = books.using(deps.db);
  await loadOwned(user, bookRepo, bookId);
  await deps.db.runTransaction(async (tx) => {
    const book = await bookRepo.requireIn(tx, bookId);
    if (book.status === 'locked') return;
    if (book.status !== 'ready' && book.status !== 'partial') {
      throw new ConflictError('A book can be locked once its pictures are finished', { code: 'BOOK_NOT_FINISHED', details: { status: book.status } });
    }
    await bookRepo.updateIn(tx, bookId, { status: 'locked' });
  });
  return { bookId, status: 'locked' };
}

export async function unlockBook(
  deps: BookServiceDeps,
  user: VerifiedUser,
  bookId: string,
  hooks: BookUnlockHook[] = bookUnlockHooks
): Promise<{ bookId: string; status: Book['status'] }> {
  const { db } = deps;
  const bookRepo = books.using(db);
  await loadOwned(user, bookRepo, bookId);
  return db.runTransaction(async (tx) => {
    const book = await bookRepo.requireIn(tx, bookId);
    if (book.status !== 'locked') return { bookId, status: book.status };
    // An order's print files are made from the locked Book: unlocking now would fail them for good.
    const rendering = await tx.get(db.collection('printOrders').where('bookId', '==', bookId).where('status', '==', 'rendering').limit(1));
    if (!rendering.empty) {
      throw new ConflictError('This book is being prepared for a print order. Try again in a few minutes.', {
        code: 'ORDER_RENDERING',
        details: { orderId: rendering.docs[0].id },
      });
    }
    const pageSnapshot = await tx.get(await bookPages.using(db).of(bookId).collection());
    const pages = pageSnapshot.docs.map((doc) => bookPages.using(db).of(bookId).parse(doc));
    const writes = [];
    for (const hook of hooks) writes.push(await hook(tx, book, db));
    const status = statusFromArt(rollupArt(pages));
    for (const write of writes) if (write) await write(tx);
    await bookRepo.updateIn(tx, bookId, { status });
    return { bookId, status };
  });
}
