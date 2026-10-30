/**
 * Book pipeline services behind the routes (foundations.md layering: route →
 * service → repositories / jobs). Every state change and the jobs it needs are
 * written in one transaction; jobs are dispatched after the commit.
 */
import { createHash, randomUUID } from 'node:crypto';
import type { Firestore, Transaction } from 'firebase-admin/firestore';
import { layoutSupports, loadForm, loadLayout, loadStyle, resolveManuscriptShape, type Form, type ManuscriptShape } from '../catalog';
import { bookPages, books, manuscripts } from '../data/repositories';
import type { WithId } from '../data/repository';
import type { Book } from '../data/schemas/book';
import type { Manuscript } from '../data/schemas/manuscript';
import { BadRequestError, ConflictError, NotFoundError, PaymentRequiredError } from '../errors';
import { assertOwner, isPrivileged, loadOwned, type VerifiedUser } from '../http';
import type { JobRunner, JobSpec } from '../jobs';
import { chargeBookAllowance, readLedgerIn } from './allowance';
import { ART_PAGE_KINDS, illustrateSpec, paginateSpec, prepareCastSpec, rollupArt, statusFromArt } from './jobs';
import { loadStorySource, type StorySource } from './story-source';
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
  if (!story.ownerUid || !story.childId || !story.text.trim()) {
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
  if (snapshot.exists && data?.ownerParentUid === story.ownerUid && typeof data.preferredVoiceId === 'string' && data.preferredVoiceId) {
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
        art: { total: shape.length + 1, done: 0, failed: 0 },
      },
      { id: bookId }
    );
    const pageRepo = bookPages.using(db).of(bookId);
    await pageRepo.createIn(tx, { ownerUid: story.ownerUid, pageNumber: 1, kind: 'cover' }, { id: '1' });
    for (let n = 1; n <= shape.length; n++) {
      await pageRepo.createIn(
        tx,
        { ownerUid: story.ownerUid, pageNumber: n + 1, kind: 'story', manuscriptPage: n },
        { id: String(n + 1) }
      );
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
