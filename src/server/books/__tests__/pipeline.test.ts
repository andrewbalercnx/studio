import { beforeEach, describe, expect, it, vi } from 'vitest';

const enforcePersonaScope = vi.fn();
vi.mock('@/lib/persona.server', () => ({
  enforcePersonaScope: (...args: unknown[]) => enforcePersonaScope(...args),
}));

import { TEST_MODE_AUDIO_DATA_URL, TEST_MODE_IMAGE_DATA_URL } from '@/lib/test-mode';
import { NoImageReturnedError } from '../../ai/harness';
import { bookPages, books, castSheets, jobs, manuscriptPages, manuscripts } from '../../data/repositories';
import { createBook, createManuscript, lockBook, retryPage, unlockBook, type BookUnlockHook } from '../service';
import { createBench, seed, user, type Bench } from './helpers';

const p1 = user('p1');
const p2 = user('p2');

let bench: Bench;

beforeEach(async () => {
  enforcePersonaScope.mockReset();
  enforcePersonaScope.mockResolvedValue({ ok: true, persona: null });
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  bench = createBench();
  await seed(bench.db);
});

async function ledgerUsed(uid = 'p1'): Promise<number> {
  const snapshot = await bench.db.collection('entitlementLedgers').doc(uid).get();
  return (snapshot.data()?.family?.storybook_allowance?.used as number | undefined) ?? 0;
}

async function jobsOfKind(kind: string) {
  return (await jobs.using(bench.db).where({ kind })).sort((a, b) => a.jobId.localeCompare(b.jobId));
}

async function makeBook(extra: Record<string, unknown> = {}) {
  const result = await createBook(bench.services, p1, { storyId: 's1', formId: 'picture', styleId: 'water', ...extra });
  await bench.drain();
  return result;
}

describe('story → manuscript → book (happy path)', () => {
  it('paginates, narrates, draws cast sheets and every page, and ends ready', async () => {
    const result = await makeBook();
    expect(result).toMatchObject({ status: 'illustrating', created: true });

    const manuscript = await manuscripts.using(bench.db).require(result.manuscriptId);
    expect(manuscript).toMatchObject({ status: 'ready', length: 12, density: 'balanced', form: 'picture', ownerUid: 'p1', childId: 'c1', title: 'The Big Day' });
    expect(manuscript.narration).toEqual({ voiceId: 'voice-emma' });
    expect(manuscript.cover?.presentCast[0]).toBe('c1'); // the hero is guaranteed on the cover

    const pages = await manuscriptPages.using(bench.db).of(result.manuscriptId).where({});
    expect(pages).toHaveLength(12);
    for (const page of pages) {
      expect(page.text).toContain('Emma and Rex play');
      expect(page.text).not.toMatch(/\$|\[giggles\]/);
      expect(page.narrationText).toContain('EM-uh and Rex'); // pronunciation for the narrator
      expect(page.narrationText).toContain('[giggles]');
      expect(page.scene.presentCast).toEqual(['c1', 'ch1']);
      expect(page.scene.castActions[0].action).not.toContain('$$');
      expect(page.narrationUrl).toMatch(/^https:\/\/storage\.test\/manuscripts\//);
    }
    // Canonical location: later garden pages reuse the first description; tags are repaired.
    const sorted = pages.sort((a, b) => a.pageNumber - b.pageNumber);
    expect(sorted[2].scene.location).toBe('a sunny garden with tall sunflowers');
    expect(sorted[11].scene.location).toBe('a cosy yellow kitchen');
    expect(sorted[11].scene.tag).toBe('indoor-day');

    const book = await books.using(bench.db).require(result.bookId);
    expect(book).toMatchObject({ status: 'ready', art: { total: 13, done: 13, failed: 0 }, layoutId: null, childId: 'c1' });
    const bookPageList = await bookPages.using(bench.db).of(result.bookId).where({});
    expect(bookPageList).toHaveLength(13);
    expect(bookPageList.every((p) => p.artUrl?.startsWith(`https://storage.test/books/${result.bookId}/pages/`))).toBe(true);
    expect(bookPageList.every((p) => p.artJob?.status === 'succeeded')).toBe(true);

    // Cast: Emma (portrait) and Rex (no photos → appearance); another family's character is not in it.
    const sheets = await castSheets.using(bench.db).of(result.bookId).where({});
    expect(sheets.map((s) => [s.castId, s.source]).sort()).toEqual([
      ['c1', 'portrait'],
      ['ch1', 'appearance'],
    ]);
    expect(sheets.every((s) => s.imageUrl?.startsWith(`https://storage.test/books/${result.bookId}/castSheets/${s.castId}/`))).toBe(true);
    expect(bench.fetched).not.toContain('https://img.test/stranger.jpg');
    expect(pages[0].text).not.toContain('Stranger');

    // Narration got the child's voice; one job per page.
    expect(bench.tts).toHaveBeenCalledWith(expect.objectContaining({ voiceId: 'voice-emma', modelId: 'eleven_v3' }));
    expect(await jobsOfKind('manuscript.narrate')).toHaveLength(12);
    expect(await jobsOfKind('book.pageArt')).toHaveLength(13);
  });

  it('never uses a picsum avatar as a likeness', async () => {
    await makeBook();
    expect(bench.fetched.some((url) => url.includes('picsum'))).toBe(false);
    // Emma's sheet is drawn from her canonical portrait, after the style example.
    const sheetCall = bench.ai.generateImage.mock.calls.find(
      ([options]) => options.flowName === 'book.castSheet' && JSON.stringify(options.prompt).includes('Name: Emma')
    );
    const media = (sheetCall![0].prompt as Array<{ media?: { url: string } }>).filter((p) => p.media).map((p) => Buffer.from(p.media!.url.split(',')[1], 'base64').toString());
    expect(media).toEqual(['https://img.test/style-1.png', 'https://img.test/portrait-c1.png']);
  });

  it('attaches the scene reference for the page tag and the cast sheets of who is present', async () => {
    const result = await makeBook();
    const call = bench.ai.generateImage.mock.calls.find(
      ([options]) => options.flowName === 'book.pageArt' && JSON.stringify(options.prompt).includes('tall sunflowers')
    );
    const prompt = call![0].prompt as Array<{ media?: { url: string }; text?: string }>;
    const media = prompt.filter((p) => p.media).map((p) => Buffer.from(p.media!.url.split(',')[1], 'base64').toString());
    expect(media[0]).toBe('https://img.test/scene-outdoor.png');
    expect(media.slice(1).every((url) => url.startsWith(`https://storage.test/books/${result.bookId}/castSheets/`))).toBe(true);
    expect(prompt.at(-1)!.text).toContain('- Image 2: Emma');
    expect(prompt.at(-1)!.text).toContain('EXACTLY 2 characters');
  });

  it('starts cast sheets at once when the manuscript is already ready', async () => {
    const ms = await createManuscript(bench.services, p1, { storyId: 's1', formId: 'picture' });
    await bench.drain();
    expect(ms).toMatchObject({ created: true, status: 'paginating' });
    const result = await createBook(bench.services, p1, { manuscriptId: ms.manuscriptId, styleId: 'water' });
    expect(await jobsOfKind('book.prepareCast')).toHaveLength(1);
    await bench.drain();
    expect((await books.using(bench.db).require(result.bookId)).status).toBe('ready');
  });
});

describe('creation rules', () => {
  it('creates one manuscript per (story, form, length, density)', async () => {
    const first = await createManuscript(bench.services, p1, { storyId: 's1', formId: 'picture' });
    const again = await createManuscript(bench.services, p1, { storyId: 's1', formId: 'picture', length: 12, density: 'balanced' });
    const longer = await createManuscript(bench.services, p1, { storyId: 's1', formId: 'picture', length: 24 });
    expect(again).toEqual({ ...first, created: false });
    expect(longer.manuscriptId).not.toBe(first.manuscriptId);
    await bench.drain();
    expect(await jobsOfKind('manuscript.paginate')).toHaveLength(2);
  });

  it('validates length and density against the Form', async () => {
    await expect(createManuscript(bench.services, p1, { storyId: 's1', formId: 'picture', length: 13 })).rejects.toMatchObject({ status: 400, code: 'INVALID_LENGTH' });
    await expect(createManuscript(bench.services, p1, { storyId: 's1', formId: 'poem', length: 12 })).rejects.toMatchObject({ code: 'INVALID_LENGTH' });
    await expect(createManuscript(bench.services, p1, { storyId: 's1', formId: 'picture', density: 'dense' })).rejects.toMatchObject({ code: 'INVALID_DENSITY' });
    await expect(createManuscript(bench.services, p1, { storyId: 's1', formId: 'draft' })).rejects.toMatchObject({ status: 404, code: 'FORM_NOT_FOUND' });
    await expect(createBook(bench.services, p1, { storyId: 's1', formId: 'picture', styleId: 'nope' })).rejects.toMatchObject({ code: 'STYLE_NOT_FOUND' });
  });

  it('checks a print layout supports the length', async () => {
    await expect(createBook(bench.services, p1, { storyId: 's1', formId: 'picture', length: 24, styleId: 'water', layoutId: 'tiny' })).rejects.toMatchObject({
      code: 'LAYOUT_INCOMPATIBLE',
    });
    const ok = await createBook(bench.services, p1, { storyId: 's1', formId: 'picture', length: 24, styleId: 'water', layoutId: 'square' });
    expect((await books.using(bench.db).require(ok.bookId)).layoutId).toBe('square');
  });

  it('consumes the book allowance exactly once per book, and refuses when none is left', async () => {
    const first = await createBook(bench.services, p1, { storyId: 's1', formId: 'picture', styleId: 'water', idempotencyKey: 'tap-0001' });
    const repeat = await createBook(bench.services, p1, { storyId: 's1', formId: 'picture', styleId: 'water', idempotencyKey: 'tap-0001' });
    expect(repeat).toEqual({ ...first, created: false });
    expect(await ledgerUsed()).toBe(1);

    await createBook(bench.services, p1, { storyId: 's1', formId: 'picture', styleId: 'water' });
    expect(await ledgerUsed()).toBe(2);
    // Free tier: two books.
    await expect(createBook(bench.services, p1, { storyId: 's1', formId: 'picture', styleId: 'water' })).rejects.toMatchObject({
      status: 402,
      code: 'ENTITLEMENT_LIMIT',
    });
    expect(await ledgerUsed()).toBe(2);
    expect(await books.using(bench.db).listByOwner('p1')).toHaveLength(2);
    await bench.drain();
  });
});

describe('ownership and persona', () => {
  it('denies another family on every operation', async () => {
    const mine = await makeBook();
    await expect(createManuscript(bench.services, p2, { storyId: 's1', formId: 'picture' })).rejects.toMatchObject({ status: 403 });
    await expect(createBook(bench.services, p2, { storyId: 's1', formId: 'picture', styleId: 'water' })).rejects.toMatchObject({ status: 403 });
    await expect(createBook(bench.services, p2, { manuscriptId: mine.manuscriptId, styleId: 'water' })).rejects.toMatchObject({ status: 403 });
    await expect(retryPage(bench.services, p2, mine.bookId, 2)).rejects.toMatchObject({ status: 403 });
    await expect(lockBook(bench.services, p2, mine.bookId)).rejects.toMatchObject({ status: 403 });
    await expect(unlockBook(bench.services, p2, mine.bookId)).rejects.toMatchObject({ status: 403 });
    expect(await ledgerUsed('p2')).toBe(0);
  });

  it('applies the child-persona scope with the story or book child', async () => {
    const mine = await makeBook();
    enforcePersonaScope.mockResolvedValue({ ok: false, status: 403, code: 'PERSONA_SCOPE_MISMATCH', message: 'mismatch' });
    const persona = { status: 403, code: 'PERSONA_SCOPE_MISMATCH' };
    await expect(createManuscript(bench.services, p1, { storyId: 's1', formId: 'picture' })).rejects.toMatchObject(persona);
    await expect(createBook(bench.services, p1, { storyId: 's1', formId: 'picture', styleId: 'water' })).rejects.toMatchObject(persona);
    await expect(retryPage(bench.services, p1, mine.bookId, 2)).rejects.toMatchObject(persona);
    await expect(lockBook(bench.services, p1, mine.bookId)).rejects.toMatchObject(persona);
    expect(enforcePersonaScope).toHaveBeenCalledWith(expect.objectContaining({ expectedUid: 'p1', effectiveChildId: 'c1' }));
  });

  it('lets an admin act on any family, charging the owner', async () => {
    const result = await createBook(bench.services, user('a1', { isAdmin: true }), { storyId: 's1', formId: 'picture', styleId: 'water' });
    await bench.drain();
    expect((await books.using(bench.db).require(result.bookId)).ownerUid).toBe('p1');
    expect(await ledgerUsed('p1')).toBe(1);
  });
});

describe('partial outcome and page retry', () => {
  it('ends partial when a page keeps failing, simplifying the prompt each attempt; a retry completes it', async () => {
    const failing = vi.fn(async (options: { flowName: string; prompt: Array<{ text?: string }> }) => {
      if (options.flowName === 'book.pageArt' && options.prompt.at(-1)?.text?.includes('page 3)')) {
        throw new NoImageReturnedError('I cannot draw that');
      }
      return { mediaUrl: 'data:image/png;base64,iVBORw0KGgo=', text: '', model: {}, attempts: 1 };
    });
    bench.ai.generateImage.mockImplementation(failing);
    const result = await makeBook();

    let book = await books.using(bench.db).require(result.bookId);
    expect(book).toMatchObject({ status: 'partial', art: { total: 13, done: 12, failed: 1 } });
    const page = await bookPages.using(bench.db).of(result.bookId).require('4'); // story page 3
    expect(page).toMatchObject({ artUrl: null, artJob: { status: 'failed' } });

    // Attempts 1-3 for that page: style images, then none, then no images at all.
    const attempts = failing.mock.calls
      .map(([options]) => options)
      .filter((o) => o.flowName === 'book.pageArt' && o.prompt.at(-1)?.text?.includes('page 3)'));
    expect(attempts).toHaveLength(3);
    expect(attempts.map((o) => o.prompt.filter((p) => 'media' in p).length)).toEqual([3, 2, 0]);

    await expect(retryPage(bench.services, p1, result.bookId, 5)).rejects.toMatchObject({ status: 409, code: 'PAGE_NOT_FAILED' });

    bench.ai.generateImage.mockImplementation(async () => ({ mediaUrl: 'data:image/png;base64,iVBORw0KGgo=', text: '', model: {}, attempts: 1 }));
    const retry = await retryPage(bench.services, p1, result.bookId, 4);
    expect(retry.status).toBe('illustrating');
    await bench.drain();
    book = await books.using(bench.db).require(result.bookId);
    expect(book).toMatchObject({ status: 'ready', art: { total: 13, done: 13, failed: 0 } });

    // A second retry is a new job (new idempotency key); the first page job is untouched.
    const pageJobs = (await jobsOfKind('book.pageArt')).filter((j) => j.target.subpath === 'pages/4');
    expect(pageJobs.map((j) => j.status).sort()).toEqual(['failed', 'succeeded']);
    // Each attempt writes its own file: retries never overwrite a referenced file.
    const files = [...bench.saved.keys()].filter((path) => path.startsWith(`books/${result.bookId}/pages/4/`));
    expect(files).toHaveLength(1);
  });

  it('fails the book when every page fails', async () => {
    bench.ai.generateImage.mockImplementation(async (options: { flowName: string }) => {
      if (options.flowName === 'book.pageArt') throw new NoImageReturnedError('no');
      return { mediaUrl: 'data:image/png;base64,iVBORw0KGgo=', text: '', model: {}, attempts: 1 };
    });
    const result = await makeBook();
    expect(await books.using(bench.db).require(result.bookId)).toMatchObject({ status: 'failed', art: { done: 0, failed: 13 } });
  });

  it('still draws the pages when a cast sheet fails, using the portrait instead', async () => {
    bench.ai.generateImage.mockImplementation(async (options: { flowName: string }) => {
      if (options.flowName === 'book.castSheet') throw new Error('400 Bad Request: permanent');
      return { mediaUrl: 'data:image/png;base64,iVBORw0KGgo=', text: '', model: {}, attempts: 1 };
    });
    const result = await makeBook();
    expect((await books.using(bench.db).require(result.bookId)).status).toBe('ready');
    const sheets = await castSheets.using(bench.db).of(result.bookId).where({});
    expect(sheets.every((s) => s.job?.status === 'failed' && s.imageUrl === null)).toBe(true);
    expect(bench.fetched).toContain('https://img.test/portrait-c1.png');
  });
});

describe('manuscript failure', () => {
  it('fails the manuscript and the books waiting on it', async () => {
    bench.ai.generateText.mockRejectedValue(Object.assign(new Error('403 Forbidden: permission denied'), { status: 403 }));
    const result = await makeBook();
    expect((await manuscripts.using(bench.db).require(result.manuscriptId)).status).toBe('failed');
    expect((await books.using(bench.db).require(result.bookId)).status).toBe('failed');
    await expect(createBook(bench.services, p1, { manuscriptId: result.manuscriptId, styleId: 'water' })).rejects.toMatchObject({ code: 'MANUSCRIPT_FAILED' });

    // Asking again through the story paginates it again.
    bench.ai.generateText.mockReset();
    bench.ai.generateText.mockImplementation(createBench().ai.generateText);
    const again = await createManuscript(bench.services, p1, { storyId: 's1', formId: 'picture' });
    expect(again).toMatchObject({ manuscriptId: result.manuscriptId, status: 'paginating', created: false });
    await bench.drain();
    expect((await manuscripts.using(bench.db).require(result.manuscriptId)).status).toBe('ready');
  });

  it('retries a degenerate pagination at a higher temperature', async () => {
    const good = createBench().ai.generateText;
    bench.ai.generateText.mockImplementationOnce(async () => ({ text: '', output: { pages: [] }, model: {}, usage: null, attempts: 1 }));
    bench.ai.generateText.mockImplementation(good);
    const ms = await createManuscript(bench.services, p1, { storyId: 's1', formId: 'picture' });
    await bench.drain();
    expect((await manuscripts.using(bench.db).require(ms.manuscriptId)).status).toBe('ready');
    expect(bench.ai.generateText.mock.calls.map(([o]) => o.config.temperature)).toEqual([0.3, 0.7]);
  });
});

describe('lock and unlock', () => {
  it('locks a finished book and unlocks it through the unlock hooks', async () => {
    const result = await makeBook();
    expect(await lockBook(bench.services, p1, result.bookId)).toEqual({ bookId: result.bookId, status: 'locked' });
    expect(await lockBook(bench.services, p1, result.bookId)).toEqual({ bookId: result.bookId, status: 'locked' });
    await expect(retryPage(bench.services, p1, result.bookId, 2)).rejects.toMatchObject({ code: 'BOOK_LOCKED' });

    const revoked: string[] = [];
    const hook: BookUnlockHook = async (_tx, book) => () => {
      revoked.push(book.id);
    };
    expect(await unlockBook(bench.services, p1, result.bookId, [hook])).toEqual({ bookId: result.bookId, status: 'ready' });
    expect(revoked).toEqual([result.bookId]);
  });

  it('refuses to lock a book still being illustrated', async () => {
    const result = await createBook(bench.services, p1, { storyId: 's1', formId: 'picture', styleId: 'water' });
    await expect(lockBook(bench.services, p1, result.bookId)).rejects.toMatchObject({ status: 409, code: 'BOOK_NOT_FINISHED' });
    await bench.drain();
  });
});

describe('TEST_MODE', () => {
  it('runs the whole pipeline on fixtures without calling AI or TTS', async () => {
    bench.testMode.on = true;
    const result = await makeBook();
    expect(bench.ai.generateText).not.toHaveBeenCalled();
    expect(bench.ai.generateImage).not.toHaveBeenCalled();
    expect(bench.ai.call).not.toHaveBeenCalled();
    expect(bench.tts).not.toHaveBeenCalled();

    const book = await books.using(bench.db).require(result.bookId);
    expect(book).toMatchObject({ status: 'ready', art: { total: 13, done: 13, failed: 0 } });
    const pages = await bookPages.using(bench.db).of(result.bookId).where({});
    expect(pages.every((p) => p.artUrl === TEST_MODE_IMAGE_DATA_URL)).toBe(true);
    const words = await manuscriptPages.using(bench.db).of(result.manuscriptId).where({});
    expect(words).toHaveLength(12);
    expect(words.every((p) => p.narrationUrl === TEST_MODE_AUDIO_DATA_URL && !p.text.includes('$$'))).toBe(true);
    const sheets = await castSheets.using(bench.db).of(result.bookId).where({});
    expect(sheets.every((s) => s.imageUrl === TEST_MODE_IMAGE_DATA_URL)).toBe(true);
  });
});
