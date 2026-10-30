import { NextResponse } from 'next/server';
import { FieldValue } from 'firebase-admin/firestore';
import type { DecodedIdToken } from 'firebase-admin/auth';
import { initFirebaseAdminApp } from '@/firebase/admin/app';
import { getStoryBucket } from '@/firebase/admin/storage';
import { isInternalSecretValid } from '@/lib/internal-secret';
import { BOOK_JOB_KINDS, createBook } from '@/server/books';
import { getDb } from '@/server/data/db';
import { InProcessDispatcher, JobRunner, jobRegistry, type DispatchRequest } from '@/server/jobs';

export const maxDuration = 300;
export const dynamic = 'force-dynamic';

// Short story with four clearly distinct scenes (indoor-day, outdoor-day,
// indoor-night, outdoor-night) so pagination reliably assigns all four scene tags.
const SYSTEM_TEST_STORY_TEXT = [
  'Luna the cat was reading in the sunny kitchen when she noticed her toy mouse had gone missing.',
  'She dashed outside into the bright garden and searched through every flowerpot and patch of grass.',
  'That evening, Luna padded back inside and curled up under the lamp to think about where the mouse could be.',
  'Later, under a sky full of stars, she crept into the moonlit garden one last time — and found the toy mouse sitting right beside the gate.',
].join(' ');

const VALID_TAGS = ['indoor-day', 'outdoor-day', 'indoor-night', 'outdoor-night'];

type TestResult = {
  name: string;
  pass: boolean;
  message: string;
  durationMs: number;
};

async function runTest(name: string, fn: () => Promise<string>): Promise<TestResult> {
  const start = Date.now();
  try {
    const message = await fn();
    return { name, pass: true, message, durationMs: Date.now() - start };
  } catch (e: any) {
    return { name, pass: false, message: e?.message ?? String(e), durationMs: Date.now() - start };
  }
}

/**
 * Runs only the jobs this test needs, in process: pagination, the cast sheet
 * and the cover picture. Narration and the other pages stay queued (and are
 * deleted at cleanup), so one run costs one text call and two image calls.
 */
class SelectiveDispatcher extends InProcessDispatcher {
  constructor(private readonly shouldRun: (request: DispatchRequest) => Promise<boolean>) {
    super();
  }
  async dispatch(request: DispatchRequest): Promise<void> {
    if (await this.shouldRun(request)) await super.dispatch(request);
  }
}

/**
 * POST /api/internal/system-test — the daily live pipeline check
 * (`.github/workflows/system-tests.yml`): paginates a short story into a
 * Manuscript through the Book pipeline (`manuscript.paginate`), then draws its
 * cover (`book.castSheet`, `book.pageArt`) with the real models, and cleans up.
 */
export async function POST(request: Request) {
  const secret = request.headers.get('X-Internal-Secret');
  // Constant-time comparison — a plain !== leaks prefix-match length via timing.
  if (!isInternalSecretValid(secret, process.env.INTERNAL_API_SECRET)) {
    return NextResponse.json({ ok: false, errorMessage: 'Unauthorized' }, { status: 401 });
  }

  await initFirebaseAdminApp();
  const db = await getDb();
  const timestamp = new Date().toISOString();
  const overallStart = Date.now();
  const results: TestResult[] = [];

  const runId = `system-test-${Date.now()}`;
  const ownerUid = `${runId}-owner`;
  const childId = `${runId}-child`;
  const storyId = runId;
  const childRef = db.collection('children').doc(childId);
  const storyRef = db.collection('stories').doc(storyId);

  const allowed = new Set<string>([
    BOOK_JOB_KINDS.paginate,
    BOOK_JOB_KINDS.prepareCast,
    BOOK_JOB_KINDS.castSheet,
    BOOK_JOB_KINDS.illustrate,
  ]);
  const dispatcher = new SelectiveDispatcher(async (req) => {
    if (allowed.has(req.kind)) return true;
    if (req.kind !== BOOK_JOB_KINDS.pageArt) return false;
    const job = await db.collection('jobs').doc(req.jobId).get();
    return job.data()?.input?.pageNumber === 1;
  });
  const runner = new JobRunner({ registry: jobRegistry, dispatcher, db });

  let manuscriptId: string | null = null;
  let bookId: string | null = null;

  try {
    await childRef.set({
      regressionTest: true,
      regressionTag: 'system-test',
      displayName: 'Test Child',
      ownerParentUid: ownerUid,
      likes: [],
      dislikes: [],
      createdAt: FieldValue.serverTimestamp(),
    });
    // A complete Story as the creation routes and story.finish leave it.
    await storyRef.set({
      regressionTest: true,
      regressionTag: 'system-test',
      schemaVersion: 2,
      ownerUid,
      childId,
      modeId: 'wizard',
      storyTypeId: null,
      cast: [{ castId: childId, ref: { kind: 'child', id: childId }, role: 'hero', addedBy: 'setup' }],
      status: 'complete',
      text: SYSTEM_TEST_STORY_TEXT,
      title: 'Luna and the Lost Mouse',
      synopsis: 'A cat loses her toy mouse and searches for it day and night.',
      titleHint: null,
      modeState: {},
      turnCount: 0,
      pendingTurn: null,
      idempotencyKey: null,
      finishJobId: null,
      finishRuns: 1,
      allowance: null,
      error: null,
      completedAt: FieldValue.serverTimestamp(),
      abandonedAt: null,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });

    const user = { uid: ownerUid, email: null, claims: { uid: ownerUid } as unknown as DecodedIdToken };
    const created = await createBook({ db, runner }, user, {
      storyId,
      formId: 'picture_book_standard_v1',
      styleId: (await db.collection('imageStyles').limit(1).get()).docs[0]?.id ?? 'missing-style',
      idempotencyKey: runId,
    });
    manuscriptId = created.manuscriptId;
    bookId = created.bookId;
    await dispatcher.drain();

    // ── Test 1: pagination + scene tags ───────────────────────────────────
    results.push(
      await runTest('pagination_scene_tags', async () => {
        const manuscript = (await db.collection('manuscripts').doc(manuscriptId!).get()).data();
        if (manuscript?.status !== 'ready') throw new Error(`Manuscript status is ${manuscript?.status ?? 'missing'}`);
        const pages = (await db.collection('manuscripts').doc(manuscriptId!).collection('pages').get()).docs.map((d) => d.data());
        if (pages.length !== manuscript.length) throw new Error(`${pages.length} pages written, ${manuscript.length} expected`);
        const invalid = pages.filter((p) => !VALID_TAGS.includes(p.scene?.tag));
        if (invalid.length > 0) {
          throw new Error(`${invalid.length}/${pages.length} page(s) have an invalid scene tag: ${invalid.map((p) => p.scene?.tag || 'missing').join(', ')}`);
        }
        const tags = [...new Set(pages.map((p) => p.scene.tag))].join(', ');
        return `${pages.length} pages, all tagged — ${tags}`;
      })
    );

    // ── Test 2: consistent locations ─────────────────────────────────────
    results.push(
      await runTest('location_keys', async () => {
        const pages = (await db.collection('manuscripts').doc(manuscriptId!).collection('pages').get()).docs.map((d) => d.data());
        const keys = new Set(pages.map((p) => p.scene?.locationKey).filter(Boolean));
        if (keys.size === 0) throw new Error('No page has a scene locationKey');
        return `${keys.size} location(s): ${[...keys].join(', ')}`;
      })
    );

    // ── Test 3: the cover picture ─────────────────────────────────────────
    results.push(
      await runTest('cover_image', async () => {
        const cover = (await db.collection('books').doc(bookId!).collection('pages').doc('1').get()).data();
        if (!cover?.artUrl) throw new Error(`Cover has no picture (art job ${cover?.artJob?.status ?? 'missing'})`);
        return `Cover ready — ${String(cover.artUrl).slice(0, 60)}…`;
      })
    );
  } catch (e: any) {
    results.push({ name: 'setup', pass: false, message: e?.message ?? String(e), durationMs: Date.now() - overallStart });
  } finally {
    const cleanup = async (label: string, fn: () => Promise<unknown>) => {
      try {
        await fn();
      } catch (e: any) {
        console.error(`[system-test] Cleanup failed for ${label}:`, e?.message);
      }
    };
    if (bookId) await cleanup('book', () => db.recursiveDelete(db.collection('books').doc(bookId!)));
    if (manuscriptId) await cleanup('manuscript', () => db.recursiveDelete(db.collection('manuscripts').doc(manuscriptId!)));
    await cleanup('jobs', async () => {
      const jobs = await db.collection('jobs').where('ownerUid', '==', ownerUid).get();
      await Promise.all(jobs.docs.map((d) => d.ref.delete()));
    });
    await cleanup('ledger', () => db.recursiveDelete(db.collection('entitlementLedgers').doc(ownerUid)));
    await cleanup('story', () => storyRef.delete());
    await cleanup('child', () => childRef.delete());
    if (bookId) await cleanup('storage', async () => (await getStoryBucket()).deleteFiles({ prefix: `books/${bookId}/` }));
  }

  const allPassed = results.every((r) => r.pass);
  return NextResponse.json(
    { ok: allPassed, results, totalDurationMs: Date.now() - overallStart, timestamp },
    { status: allPassed ? 200 : 500 }
  );
}
