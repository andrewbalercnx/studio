/**
 * Job kinds of the Book pipeline (pipeline.md):
 *
 *   manuscript.paginate  (ai-text)  one call → every page's text + scene; Manuscript ready | failed;
 *                                   then narration per page, and cast sheets for Books waiting on it
 *   manuscript.narrate   (tts)      one page's narration clip; never blocks art
 *   book.prepareCast     (render)   coordinator: one book.castSheet per cast member;
 *                                   fan-in → book.illustrate
 *   book.castSheet       (ai-image) one cast member's reference sheet in the Book's Style
 *   book.illustrate      (render)   coordinator: one book.pageArt per page that needs art;
 *                                   fan-in → Book art rollup and status ready | partial | failed
 *   book.pageArt         (ai-image) one page's picture from its scene + cast sheets + Style
 *
 * Coordinators exist because the runner's fan-in (`onChildrenComplete`) is the
 * only race-free way to act once when the last of several jobs finishes. A page
 * retry is a new `book.illustrate` run for that page, so the same rollup runs.
 *
 * Every handler is idempotent (a retry after a crash finds its own finished
 * work and stops) and honours TEST_MODE by writing fixtures without AI or TTS.
 */
import type { Firestore, Transaction } from 'firebase-admin/firestore';
import type { Part } from 'genkit';
import { TEST_MODE_AUDIO_DATA_URL, TEST_MODE_IMAGE_DATA_URL } from '@/lib/test-mode';
import { DEFAULT_TTS_VOICE, getModelCapabilities } from '@/lib/tts-config';
import { DEFAULT_PAGINATION_PROMPT } from '@/lib/types';
import { NoImageReturnedError } from '../ai/harness';
import { artAspectRatio, loadForm, loadLayout, loadStyle, styleExamplesFor, styleReferencesFor } from '../catalog';
import { imagePromptConfig, paginationPromptConfig } from '../config/definitions';
import { bookPages, books, castSheets, manuscriptPages, manuscripts } from '../data/repositories';
import type { WithId } from '../data/repository';
import type { Book, BookPage } from '../data/schemas/book';
import type { JobStatus } from '../data/schemas/common';
import type { Job } from '../data/schemas/job';
import type { Manuscript, Scene } from '../data/schemas/manuscript';
import { JobFailure, type JobContext, type JobDefinition, type JobRegistry, type JobSpec } from '../jobs/registry';
import { toJobError } from '../jobs/runner';
import { artLevelForAttempt, buildCastSheetPrompt, buildPagePrompt, type CastSheetSource, type PresentMember } from './art-prompts';
import { loadCast, stripAudioTags, type Cast, type CastEntry } from './cast';
import type { BookJobDeps } from './deps';
import { decodeMedia, extensionFor } from './media';
import {
  buildPaginationPrompt,
  coverScene,
  degenerateReason,
  fitPageCount,
  paginationOutputSchema,
  rawPagesFrom,
  testModePages,
  toManuscriptPages,
  type ManuscriptPageData,
  type PaginationOutput,
  type RawPage,
} from './pagination';
import { loadStorySource } from './story-source';

export const BOOK_JOB_KINDS = {
  paginate: 'manuscript.paginate',
  narrate: 'manuscript.narrate',
  prepareCast: 'book.prepareCast',
  castSheet: 'book.castSheet',
  illustrate: 'book.illustrate',
  pageArt: 'book.pageArt',
} as const;

/** Book pages that get a picture. */
export const ART_PAGE_KINDS: ReadonlySet<BookPage['kind']> = new Set(['cover', 'story']);

// ---------------------------------------------------------------------------
// Job specs (also used by the routes' services)
// ---------------------------------------------------------------------------

export function paginateSpec(manuscript: { id: string; ownerUid: string }, retryNonce?: string): JobSpec {
  return {
    kind: BOOK_JOB_KINDS.paginate,
    ownerUid: manuscript.ownerUid,
    target: { collection: 'manuscripts', id: manuscript.id },
    input: { manuscriptId: manuscript.id },
    // A retry after failure needs a new job; the first run uses the default key.
    ...(retryNonce ? { idempotencyKey: `${BOOK_JOB_KINDS.paginate}:manuscripts/${manuscript.id}:retry:${retryNonce}` } : {}),
  };
}

export function narrateSpec(manuscript: { id: string; ownerUid: string }, pageNumber: number): JobSpec {
  return {
    kind: BOOK_JOB_KINDS.narrate,
    ownerUid: manuscript.ownerUid,
    target: { collection: 'manuscripts', id: manuscript.id, subpath: `pages/${pageNumber}` },
    input: { manuscriptId: manuscript.id, pageNumber },
  };
}

export function prepareCastSpec(book: { id: string; ownerUid: string }): JobSpec {
  return {
    kind: BOOK_JOB_KINDS.prepareCast,
    ownerUid: book.ownerUid,
    target: { collection: 'books', id: book.id },
    input: { bookId: book.id },
  };
}

/** `pages` null = every page that still needs art. `run` makes each retry a new job. */
export function illustrateSpec(book: { id: string; ownerUid: string }, run: string, pages: number[] | null = null): JobSpec {
  return {
    kind: BOOK_JOB_KINDS.illustrate,
    ownerUid: book.ownerUid,
    target: { collection: 'books', id: book.id },
    input: { bookId: book.id, run, pages },
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function input<T>(job: WithId<Job>): T {
  return job.input as T;
}

function isFinalAttempt(job: WithId<Job>, error: unknown): boolean {
  const classified = toJobError(error);
  return !classified.retryable || job.attempt >= job.maxAttempts;
}

const IMAGE_REJECTED = /did not match the expected pattern|INVALID_ARGUMENT|SAFETY|blocked|recitation/i;

/**
 * An image the model would not draw is worth another attempt with a simpler
 * prompt (story-image-flow's progressive simplification), so make it retryable.
 */
function asImageFailure(error: unknown): unknown {
  if (error instanceof JobFailure) return error;
  const message = (error as Error)?.message ?? String(error);
  if (error instanceof NoImageReturnedError || IMAGE_REJECTED.test(message)) {
    return new JobFailure('IMAGE_REJECTED', message, { retryable: true, cause: error });
  }
  return error;
}

async function imageParts(deps: BookJobDeps, urls: string[]): Promise<Array<{ url: string; part: Part }>> {
  const fetched = await Promise.all(urls.map(async (url) => ({ url, dataUri: await deps.fetchImage(url) })));
  return fetched.filter((f) => !!f.dataUri).map((f) => ({ url: f.url, part: { media: { url: f.dataUri! } } }));
}

async function storeImage(
  deps: BookJobDeps,
  path: string,
  mediaUrl: string,
  metadata: Record<string, string>
): Promise<string> {
  const { contentType, data } = await decodeMedia(mediaUrl);
  const stored = await deps.blobs.save(`${path}.${extensionFor(contentType)}`, data, contentType, metadata);
  return stored.url;
}

function heroOf(cast: Cast): CastEntry | undefined {
  return cast.members.find((m) => m.role === 'hero');
}

// ---------------------------------------------------------------------------
// manuscript.paginate
// ---------------------------------------------------------------------------

function isSchemaMiss(error: unknown): boolean {
  return typeof (error as Error)?.message === 'string' && (error as Error).message.includes('Schema validation failed');
}

function parseManually(text: string): PaginationOutput | null {
  if (!text?.trim()) return null;
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text);
  try {
    const parsed = paginationOutputSchema.safeParse(JSON.parse((fenced ? fenced[1] : text).trim()));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

const PAGINATION_TEMPERATURES = [0.3, 0.7, 0.9];

async function paginateWithModel(
  deps: BookJobDeps,
  args: { job: WithId<Job>; manuscript: WithId<Manuscript>; cast: Cast; text: string; title: string | null; synopsis: string | null; db: Firestore }
): Promise<{ pages: ManuscriptPageData[]; cover: Scene }> {
  const form = await loadForm(args.db, args.manuscript.form);
  if (!form) throw new JobFailure('FORM_MISSING', `Form ${args.manuscript.form} not found`, { retryable: false });
  const configured = await deps.config.get(paginationPromptConfig);
  const basePrompt = configured.enabled && configured.paginationPrompt ? configured.paginationPrompt : DEFAULT_PAGINATION_PROMPT;
  const prompt = buildPaginationPrompt({
    basePrompt,
    form,
    length: args.manuscript.length,
    density: args.manuscript.density as never,
    cast: args.cast,
    text: args.text,
    title: args.title,
    synopsis: args.synopsis,
  });

  let chosen: { output: PaginationOutput; pages: RawPage[] } | null = null;
  let fallback: { output: PaginationOutput; pages: RawPage[] } | null = null;
  for (let attempt = 1; attempt <= PAGINATION_TEMPERATURES.length; attempt++) {
    const temperature = PAGINATION_TEMPERATURES[attempt - 1];
    let output: PaginationOutput | null;
    try {
      const response = await deps.ai.generateText({
        purpose: 'manuscript.text',
        flowName: 'manuscript.paginate',
        ownerUid: args.job.ownerUid,
        prompt,
        output: { schema: paginationOutputSchema },
        config: { temperature, maxOutputTokens: 8000 },
      });
      output = response.output ?? parseManually(response.text);
    } catch (error) {
      if (isSchemaMiss(error)) {
        console.warn(`[manuscript.paginate] schema miss on attempt ${attempt} (temp ${temperature})`);
        continue;
      }
      throw error;
    }
    if (!output) {
      console.warn(`[manuscript.paginate] unreadable output on attempt ${attempt}`);
      continue;
    }
    const pages = rawPagesFrom(output);
    const reason = degenerateReason(pages, args.manuscript.length);
    if (!reason) {
      chosen = { output, pages };
      break;
    }
    console.warn(`[manuscript.paginate] degenerate output on attempt ${attempt} (temp ${temperature}): ${reason}`);
    // Usable but imperfect (e.g. a page count to fit): keep the best seen so far.
    const hasScenes = pages.some((p) => p.scene?.locationDescription);
    if (pages.length > 0 && (!fallback || (hasScenes && !fallback.pages.some((p) => p.scene?.locationDescription)))) {
      fallback = { output, pages };
    }
  }
  const result = chosen ?? fallback;
  if (!result) {
    throw new JobFailure('PAGINATION_FAILED', 'The model returned no usable pages', { retryable: true });
  }
  const fitted = fitPageCount(result.pages, args.manuscript.length);
  if (!fitted) {
    throw new JobFailure('STORY_TOO_SHORT', `The story is too short for ${args.manuscript.length} pages`, { retryable: false });
  }
  const pages = toManuscriptPages(fitted, args.cast);
  return { pages, cover: coverScene(result.output, pages, args.cast) };
}

/** Narration for every page; cast sheets for Books created while the words were being written. */
async function afterPagination(ctx: JobContext, manuscript: WithId<Manuscript>): Promise<void> {
  const waiting = await books.using(ctx.db).where({ manuscriptId: manuscript.id, status: 'illustrating' });
  const specs: JobSpec[] = [
    ...Array.from({ length: manuscript.length }, (_, i) => narrateSpec(manuscript, i + 1)),
    ...waiting.map((book) => prepareCastSpec(book)),
  ];
  await ctx.enqueue(specs);
}

/** The Manuscript failed for good: so do the Books waiting for it. */
async function failManuscript(db: Firestore, manuscriptId: string): Promise<void> {
  const manuscriptRepo = manuscripts.using(db);
  const bookRepo = books.using(db);
  const bookCollection = await bookRepo.collection();
  await db.runTransaction(async (tx) => {
    const manuscript = await manuscriptRepo.getIn(tx, manuscriptId);
    if (!manuscript || manuscript.status !== 'paginating') return;
    const waiting = await tx.get(bookCollection.where('manuscriptId', '==', manuscriptId).where('status', '==', 'illustrating'));
    await manuscriptRepo.updateIn(tx, manuscriptId, { status: 'failed' });
    for (const doc of waiting.docs) await bookRepo.updateIn(tx, doc.id, { status: 'failed' });
  });
}

function paginateHandler(getDeps: () => Promise<BookJobDeps>): JobDefinition['run'] {
  return async (ctx) => {
    const { manuscriptId } = input<{ manuscriptId: string }>(ctx.job);
    const manuscriptRepo = manuscripts.using(ctx.db);
    const manuscript = await manuscriptRepo.require(manuscriptId);
    if (manuscript.status === 'ready') {
      // A retry after the pages were committed: only the follow-on jobs may be missing.
      await afterPagination(ctx, manuscript);
      return;
    }
    if (manuscript.status !== 'paginating') return;

    const deps = await getDeps();
    let result: { pages: ManuscriptPageData[]; cover: Scene };
    let title: string | null;
    try {
      const story = await loadStorySource(ctx.db, manuscript.storyId);
      title = story.title;
      const cast = await loadCast(ctx.db, story, deps.now());
      if (!story.text.trim()) throw new JobFailure('STORY_EMPTY', 'The story has no text', { retryable: false });
      if (deps.testMode()) {
        const pages = testModePages(story.text, manuscript.length, cast);
        result = { pages, cover: coverScene(null, pages, cast) };
      } else {
        result = await paginateWithModel(deps, {
          job: ctx.job,
          manuscript,
          cast,
          text: story.text,
          title: story.title,
          synopsis: story.synopsis,
          db: ctx.db,
        });
      }
    } catch (error) {
      if (isFinalAttempt(ctx.job, error)) await failManuscript(ctx.db, manuscriptId);
      throw error;
    }

    const pageRepo = manuscriptPages.using(ctx.db).of(manuscriptId);
    const committed = await ctx.db.runTransaction(async (tx) => {
      const current = await manuscriptRepo.requireIn(tx, manuscriptId);
      if (current.status !== 'paginating') return false;
      for (const page of result.pages) {
        await pageRepo.replaceIn(tx, String(page.pageNumber), {
          ownerUid: manuscript.ownerUid,
          pageNumber: page.pageNumber,
          text: page.text,
          narrationText: page.narrationText,
          scene: page.scene,
          narrationUrl: null,
        });
      }
      await manuscriptRepo.updateIn(tx, manuscriptId, { status: 'ready', cover: result.cover, title });
      return true;
    });
    if (committed) await afterPagination(ctx, { ...manuscript, status: 'ready' });
  };
}

// ---------------------------------------------------------------------------
// manuscript.narrate
// ---------------------------------------------------------------------------

function narrateHandler(getDeps: () => Promise<BookJobDeps>): JobDefinition['run'] {
  return async (ctx) => {
    const { manuscriptId, pageNumber } = input<{ manuscriptId: string; pageNumber: number }>(ctx.job);
    const manuscript = await manuscripts.using(ctx.db).require(manuscriptId);
    const pageRepo = manuscriptPages.using(ctx.db).of(manuscriptId);
    const page = await pageRepo.require(String(pageNumber));
    if (page.narrationUrl) return;
    const text = (page.narrationText ?? page.text).trim();
    if (!text) return;

    const deps = await getDeps();
    if (deps.testMode()) {
      await pageRepo.update(String(pageNumber), { narrationUrl: TEST_MODE_AUDIO_DATA_URL });
      return;
    }
    const voiceId = manuscript.narration?.voiceId ?? DEFAULT_TTS_VOICE;
    const { result: audio, model } = await deps.ai.call({
      purpose: 'narration',
      flowName: 'manuscript.narrate',
      ownerUid: ctx.job.ownerUid,
      logPrompt: text,
      run: (resolved) => {
        const modelId = resolved.model.replace(/^elevenlabs\//, '');
        // eleven_v3 renders [directions]; older models would read them aloud.
        const spoken = getModelCapabilities(modelId).supportsAudioTags ? `[British accent] ${text}` : stripAudioTags(text).trim();
        return deps.tts({ text: spoken, voiceId, modelId });
      },
    });
    const stored = await deps.blobs.save(
      `manuscripts/${manuscriptId}/narration/${pageNumber}/${ctx.job.jobId}-${ctx.job.attempt}.mp3`,
      audio,
      'audio/mpeg',
      { manuscriptId, pageNumber: String(pageNumber), voiceId, model: model.model }
    );
    await pageRepo.update(String(pageNumber), { narrationUrl: stored.url });
  };
}

// ---------------------------------------------------------------------------
// book.prepareCast (coordinator) and book.castSheet
// ---------------------------------------------------------------------------

function prepareCastHandler(): JobDefinition['run'] {
  return async (ctx) => {
    const { bookId } = input<{ bookId: string }>(ctx.job);
    const book = await books.using(ctx.db).require(bookId);
    if (book.status !== 'illustrating') return;
    const manuscript = await manuscripts.using(ctx.db).require(book.manuscriptId);
    if (manuscript.status !== 'ready') {
      throw new JobFailure('MANUSCRIPT_NOT_READY', 'The manuscript is not ready yet', { retryable: true });
    }
    const story = await loadStorySource(ctx.db, book.storyId);
    const cast = await loadCast(ctx.db, story);
    if (cast.members.length === 0) {
      await ctx.enqueue([illustrateSpec(book, 'initial')]);
      return;
    }
    await ctx.enqueueChildren(
      cast.members.map((member) => ({
        kind: BOOK_JOB_KINDS.castSheet,
        ownerUid: book.ownerUid,
        target: { collection: 'books', id: bookId, subpath: `castSheets/${member.castId}` },
        input: { bookId, castId: member.castId },
      }))
    );
  };
}

const prepareCastFanIn: NonNullable<JobDefinition['onChildrenComplete']> = async ({ tx, db, parent, children }) => {
  const { bookId } = parent.input as { bookId: string };
  const sheetRepo = castSheets.using(db).of(bookId);
  const updates: Array<{ castId: string; jobId: string; status: JobStatus }> = [];
  for (const child of children) {
    const castId = (child.input as { castId: string }).castId;
    const sheet = await sheetRepo.getIn(tx, castId);
    if (sheet && sheet.job?.status !== child.status) updates.push({ castId, jobId: child.jobId, status: child.status });
  }
  return {
    // Page art runs whatever happened to the sheets: a missing sheet falls back to the portrait or the words.
    enqueue: [illustrateSpec({ id: bookId, ownerUid: parent.ownerUid }, 'initial')],
    apply: async (writeTx: Transaction) => {
      for (const update of updates) {
        await sheetRepo.updateIn(writeTx, update.castId, { job: { jobId: update.jobId, status: update.status } });
      }
    },
  };
};

export function castSheetSource(member: CastEntry): CastSheetSource {
  if (member.likeness.portrait) return 'portrait';
  if (member.likeness.photos.length > 0) return 'photos';
  return 'appearance';
}

/** Identity references for a sheet: the portrait, or up to 3 original photos. Never the avatar. */
export function castSheetReferences(member: CastEntry): string[] {
  if (member.likeness.portrait) return [member.likeness.portrait];
  return member.likeness.photos.slice(0, 3);
}

function castSheetHandler(getDeps: () => Promise<BookJobDeps>): JobDefinition['run'] {
  return async (ctx) => {
    const { bookId, castId } = input<{ bookId: string; castId: string }>(ctx.job);
    const book = await books.using(ctx.db).require(bookId);
    const story = await loadStorySource(ctx.db, book.storyId);
    const deps = await getDeps();
    const cast = await loadCast(ctx.db, story, deps.now());
    const member = cast.byId.get(castId);
    if (!member) throw new JobFailure('CAST_MEMBER_MISSING', `Cast member ${castId} not found`, { retryable: false });

    const sheetRepo = castSheets.using(ctx.db).of(bookId);
    const existing = await sheetRepo.get(castId);
    if (existing?.imageUrl && existing.job?.jobId === ctx.job.jobId) return;
    const source = castSheetSource(member);
    const running = { jobId: ctx.job.jobId, status: 'running' as const };
    if (existing) {
      await sheetRepo.update(castId, { source, imageUrl: null, job: running });
    } else {
      await sheetRepo.create(
        { ownerUid: book.ownerUid, castId, ref: member.ref, source, imageUrl: null, job: running },
        { id: castId }
      );
    }

    let imageUrl: string;
    if (deps.testMode()) {
      imageUrl = TEST_MODE_IMAGE_DATA_URL;
    } else {
      const style = await loadStyle(ctx.db, book.styleId);
      if (!style) throw new JobFailure('STYLE_MISSING', `Style ${book.styleId} not found`, { retryable: false });
      const styleImages = await imageParts(deps, styleExamplesFor(style));
      const references = await imageParts(deps, castSheetReferences(member));
      const text = buildCastSheetPrompt({
        member,
        stylePrompt: style.prompt,
        styleExampleCount: styleImages.length,
        source,
        referenceCount: references.length,
        synopsis: story.synopsis,
        heroAge: heroOf(cast)?.age ?? null,
      });
      try {
        const { mediaUrl } = await deps.ai.generateImage({
          purpose: 'book.castSheet',
          flowName: 'book.castSheet',
          ownerUid: ctx.job.ownerUid,
          prompt: [...styleImages.map((s) => s.part), ...references.map((r) => r.part), { text }],
          config: { imageConfig: { aspectRatio: '1:1' } },
        });
        imageUrl = await storeImage(deps, `books/${bookId}/castSheets/${castId}/${ctx.job.jobId}-${ctx.job.attempt}`, mediaUrl, {
          bookId,
          castId,
          ownerUid: book.ownerUid,
        });
      } catch (error) {
        throw asImageFailure(error);
      }
    }
    await sheetRepo.update(castId, { imageUrl, source, job: { jobId: ctx.job.jobId, status: 'succeeded' } });
  };
}

// ---------------------------------------------------------------------------
// book.illustrate (coordinator) and book.pageArt
// ---------------------------------------------------------------------------

export function pageArtSpec(book: { id: string; ownerUid: string }, pageNumber: number, run: string): Omit<JobSpec, 'parentJobId'> {
  return {
    kind: BOOK_JOB_KINDS.pageArt,
    ownerUid: book.ownerUid,
    target: { collection: 'books', id: book.id, subpath: `pages/${pageNumber}` },
    input: { bookId: book.id, pageNumber, run },
  };
}

export type ArtRollup = { art: Book['art']; pending: number };

/** Count a Book's art from its pages (an `override` replaces a page's job status). */
export function rollupArt(pages: Array<WithId<BookPage>>, overrides: Map<number, JobStatus> = new Map()): ArtRollup {
  const artPages = pages.filter((p) => ART_PAGE_KINDS.has(p.kind));
  let done = 0;
  let failed = 0;
  let pending = 0;
  for (const page of artPages) {
    const status = overrides.get(page.pageNumber) ?? page.artJob?.status ?? null;
    if (page.artUrl) done += 1;
    else if (status === 'failed' || status === 'cancelled') failed += 1;
    else pending += 1;
  }
  return { art: { total: artPages.length, done, failed }, pending };
}

/** Book status from its art: still illustrating while any page is pending. */
export function statusFromArt(rollup: ArtRollup): Book['status'] {
  if (rollup.pending > 0) return 'illustrating';
  if (rollup.art.failed === 0) return 'ready';
  return rollup.art.done === 0 ? 'failed' : 'partial';
}

async function readBookPagesIn(tx: Transaction, db: Firestore, bookId: string): Promise<Array<WithId<BookPage>>> {
  const repo = bookPages.using(db).of(bookId);
  const snapshot = await tx.get(await repo.collection());
  return snapshot.docs.map((doc) => repo.parse(doc));
}

/** Recompute and write the Book's art rollup (used when a run had nothing to draw). */
async function writeRollup(db: Firestore, bookId: string): Promise<void> {
  const bookRepo = books.using(db);
  await db.runTransaction(async (tx) => {
    const book = await bookRepo.requireIn(tx, bookId);
    const rollup = rollupArt(await readBookPagesIn(tx, db, bookId));
    await bookRepo.updateIn(tx, bookId, {
      art: rollup.art,
      ...(book.status === 'illustrating' ? { status: statusFromArt(rollup) } : {}),
    });
  });
}

function illustrateHandler(): JobDefinition['run'] {
  return async (ctx) => {
    const { bookId, run, pages: requested } = input<{ bookId: string; run: string; pages: number[] | null }>(ctx.job);
    const book = await books.using(ctx.db).require(bookId);
    if (book.status !== 'illustrating') return;
    const pages = await bookPages.using(ctx.db).of(bookId).where({});
    const todo = pages
      .filter((p) => ART_PAGE_KINDS.has(p.kind) && !p.artUrl)
      .filter((p) => !requested || requested.includes(p.pageNumber))
      .sort((a, b) => a.pageNumber - b.pageNumber);
    if (todo.length === 0) {
      await writeRollup(ctx.db, bookId);
      return;
    }
    await ctx.enqueueChildren(todo.map((page) => pageArtSpec(book, page.pageNumber, run)));
  };
}

const illustrateFanIn: NonNullable<JobDefinition['onChildrenComplete']> = async ({ tx, db, parent, children }) => {
  const { bookId } = parent.input as { bookId: string };
  const bookRepo = books.using(db);
  const pageRepo = bookPages.using(db).of(bookId);
  const book = await bookRepo.requireIn(tx, bookId);
  const pages = await readBookPagesIn(tx, db, bookId);
  const overrides = new Map<number, JobStatus>();
  const pageJobs = new Map<number, { jobId: string; status: JobStatus }>();
  for (const child of children) {
    const pageNumber = (child.input as { pageNumber: number }).pageNumber;
    const page = pages.find((p) => p.pageNumber === pageNumber);
    // A newer run may already own this page; only record our outcome if it is still ours.
    if (!page || (page.artJob && page.artJob.jobId !== child.jobId)) continue;
    overrides.set(pageNumber, child.status);
    pageJobs.set(pageNumber, { jobId: child.jobId, status: child.status });
  }
  const rollup = rollupArt(pages, overrides);
  return {
    apply: async (writeTx: Transaction) => {
      for (const [pageNumber, artJob] of pageJobs) {
        await pageRepo.updateIn(writeTx, String(pageNumber), { artJob });
      }
      await bookRepo.updateIn(writeTx, bookId, {
        art: rollup.art,
        ...(book.status === 'illustrating' ? { status: statusFromArt(rollup) } : {}),
      });
    },
  };
};

/** The scene a Book page shows: the Manuscript's page scene, or its cover scene. */
async function sceneFor(db: Firestore, page: WithId<BookPage>, manuscript: WithId<Manuscript>): Promise<Scene> {
  if (page.kind === 'story' && page.manuscriptPage) {
    return (await manuscriptPages.using(db).of(manuscript.id).require(String(page.manuscriptPage))).scene;
  }
  if (manuscript.cover) return manuscript.cover;
  throw new JobFailure('NO_SCENE', `Page ${page.pageNumber} has no scene`, { retryable: false });
}

function pageArtHandler(getDeps: () => Promise<BookJobDeps>): JobDefinition['run'] {
  return async (ctx) => {
    const { bookId, pageNumber } = input<{ bookId: string; pageNumber: number }>(ctx.job);
    const book = await books.using(ctx.db).require(bookId);
    const pageRepo = bookPages.using(ctx.db).of(bookId);
    const page = await pageRepo.require(String(pageNumber));
    if (page.artUrl) return;
    await pageRepo.update(String(pageNumber), { artJob: { jobId: ctx.job.jobId, status: 'running' } });

    const deps = await getDeps();
    let artUrl: string;
    if (deps.testMode()) {
      artUrl = TEST_MODE_IMAGE_DATA_URL;
    } else {
      const manuscript = await manuscripts.using(ctx.db).require(book.manuscriptId);
      const scene = await sceneFor(ctx.db, page, manuscript);
      const [style, story, layout, globalPrompt] = await Promise.all([
        loadStyle(ctx.db, book.styleId),
        loadStorySource(ctx.db, book.storyId),
        book.layoutId ? loadLayout(ctx.db, book.layoutId) : Promise.resolve(null),
        deps.config.get(imagePromptConfig),
      ]);
      if (!style) throw new JobFailure('STYLE_MISSING', `Style ${book.styleId} not found`, { retryable: false });
      const cast = await loadCast(ctx.db, story, deps.now());
      const hero = heroOf(cast);
      const level = artLevelForAttempt(ctx.job.attempt);

      const styleImages = level === 'full' ? await imageParts(deps, styleReferencesFor(style, scene.tag)) : [];
      const sheetRepo = castSheets.using(ctx.db).of(bookId);
      const present: PresentMember[] = [];
      const referenceParts: Part[] = [];
      for (const castId of scene.presentCast) {
        const member = cast.byId.get(castId);
        if (!member) continue;
        const action = scene.castActions.find((c) => c.castId === castId)?.action ?? 'in the scene';
        let referenceImage: number | null = null;
        let referenceKind: PresentMember['referenceKind'] = null;
        if (level !== 'minimal') {
          const sheet = await sheetRepo.get(castId);
          const candidates: Array<[string | null | undefined, PresentMember['referenceKind']]> = [
            [sheet?.imageUrl, 'castSheet'],
            [member.likeness.portrait, 'portrait'],
            [member.likeness.photos[0], 'photo'],
          ];
          for (const [url, kind] of candidates) {
            if (!url) continue;
            const [fetched] = await imageParts(deps, [url]);
            if (!fetched) continue;
            referenceParts.push(fetched.part);
            referenceImage = styleImages.length + referenceParts.length;
            referenceKind = kind;
            break;
          }
        }
        present.push({ member, action, referenceImage, referenceKind });
      }

      const text = buildPagePrompt({
        kind: page.kind === 'cover' ? 'cover' : 'story',
        scene,
        present,
        stylePrompt: style.prompt,
        styleImageCount: styleImages.length,
        globalPrefix: globalPrompt.enabled && globalPrompt.imagePrompt.trim() ? globalPrompt.imagePrompt.trim() : null,
        title: manuscript.title ?? story.title,
        heroName: hero?.displayName ?? null,
        heroAge: hero?.age ?? null,
        level,
      });
      try {
        const { mediaUrl } = await deps.ai.generateImage({
          purpose: 'book.pageArt',
          flowName: 'book.pageArt',
          ownerUid: ctx.job.ownerUid,
          prompt: [...styleImages.map((s) => s.part), ...referenceParts, { text }],
          config: { imageConfig: { aspectRatio: artAspectRatio(layout) } },
        });
        artUrl = await storeImage(deps, `books/${bookId}/pages/${pageNumber}/${ctx.job.jobId}-${ctx.job.attempt}`, mediaUrl, {
          bookId,
          pageNumber: String(pageNumber),
          ownerUid: book.ownerUid,
        });
      } catch (error) {
        throw asImageFailure(error);
      }
    }
    await pageRepo.update(String(pageNumber), { artUrl, artJob: { jobId: ctx.job.jobId, status: 'succeeded' } });
  };
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

/**
 * Register the pipeline's kinds. `getDeps` is called when a job runs, so the
 * production registry can be built at import time without touching AI clients.
 */
export function registerBookJobs(registry: JobRegistry, getDeps: () => Promise<BookJobDeps>): JobRegistry {
  return registry
    .register({ kind: BOOK_JOB_KINDS.paginate, queue: 'ai-text', maxAttempts: 3, run: paginateHandler(getDeps) })
    .register({ kind: BOOK_JOB_KINDS.narrate, queue: 'tts', maxAttempts: 3, run: narrateHandler(getDeps) })
    .register({
      kind: BOOK_JOB_KINDS.prepareCast,
      queue: 'render',
      maxAttempts: 5,
      run: prepareCastHandler(),
      onChildrenComplete: prepareCastFanIn,
    })
    .register({ kind: BOOK_JOB_KINDS.castSheet, queue: 'ai-image', maxAttempts: 3, run: castSheetHandler(getDeps) })
    .register({
      kind: BOOK_JOB_KINDS.illustrate,
      queue: 'render',
      maxAttempts: 5,
      run: illustrateHandler(),
      onChildrenComplete: illustrateFanIn,
    })
    .register({ kind: BOOK_JOB_KINDS.pageArt, queue: 'ai-image', maxAttempts: 3, run: pageArtHandler(getDeps) });
}
