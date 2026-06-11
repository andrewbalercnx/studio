import { NextResponse } from 'next/server';
import { initFirebaseAdminApp } from '@/firebase/admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { deleteStorageObject } from '@/firebase/admin/storage';
import { isInternalSecretValid } from '@/lib/internal-secret';
import { storyPageFlow } from '@/ai/flows/story-page-flow';
import { storyImageFlow } from '@/ai/flows/story-image-flow';

export const maxDuration = 300;
export const dynamic = 'force-dynamic';

// Short story with four clearly distinct scenes (indoor-day, outdoor-day,
// indoor-night, outdoor-night) so pagination reliably assigns all four sceneTag values.
const SYSTEM_TEST_STORY_TEXT = [
  'Luna the cat was reading in the sunny kitchen when she noticed her toy mouse had gone missing.',
  'She dashed outside into the bright garden and searched through every flowerpot and patch of grass.',
  'That evening, Luna padded back inside and curled up under the lamp to think about where the mouse could be.',
  'Later, under a sky full of stars, she crept into the moonlit garden one last time — and found the toy mouse sitting right beside the gate.',
].join(' ');

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

export async function POST(request: Request) {
  const secret = request.headers.get('X-Internal-Secret');
  // Constant-time comparison — a plain !== leaks prefix-match length via timing.
  if (!isInternalSecretValid(secret, process.env.INTERNAL_API_SECRET)) {
    return NextResponse.json({ ok: false, errorMessage: 'Unauthorized' }, { status: 401 });
  }

  await initFirebaseAdminApp();
  const firestore = getFirestore();
  const timestamp = new Date().toISOString();
  const overallStart = Date.now();
  const results: TestResult[] = [];

  // IDs for cleanup
  const runId = `system-test-${Date.now()}`;
  const childId = `${runId}-child`;
  const storyId = runId;
  const storybookId = `${runId}-book`;

  // Firestore refs (declared before try so they're accessible in finally)
  const childRef = firestore.collection('children').doc(childId);
  const storyRef = firestore.collection('stories').doc(storyId);
  const storybookRef = storyRef.collection('storybooks').doc(storybookId);

  // Storage paths to clean up (populated during the image generation test)
  const storagePathsToDelete: string[] = [];

  try {
    // ── Setup: create minimal Firestore artifacts ──────────────────────────
    await childRef.set({
      regressionTest: true,
      regressionTag: 'system-test',
      displayName: 'Test Child',
      ownerParentUid: 'system-test',
      likes: [],
      dislikes: [],
      createdAt: FieldValue.serverTimestamp(),
    });

    await storyRef.set({
      regressionTest: true,
      regressionTag: 'system-test',
      childId,
      actors: [],
      synopsis: 'A cat loses her toy mouse and searches for it day and night.',
      storyText: SYSTEM_TEST_STORY_TEXT,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });

    await storybookRef.set({
      regressionTest: true,
      storyOutputTypeId: 'picture_book_standard_v1',
      status: 'draft',
      createdAt: FieldValue.serverTimestamp(),
    });

    // ── Test 1: pagination + sceneTag ─────────────────────────────────────
    let firstTextPageId: string | null = null;
    const VALID_TAGS = ['indoor-day', 'outdoor-day', 'indoor-night', 'outdoor-night'] as const;

    results.push(await runTest('pagination_scene_tags', async () => {
      const flowResult = await storyPageFlow({
        storyId,
        storyOutputTypeId: 'picture_book_standard_v1',
      });

      if (!flowResult.ok) {
        throw new Error((flowResult as any).errorMessage ?? 'storyPageFlow returned ok:false');
      }
      if (!flowResult.pages?.length) {
        throw new Error('storyPageFlow returned no pages');
      }

      // Write pages to Firestore (mirrors what /api/storybookV2/pages does)
      const pagesCol = storybookRef.collection('pages');
      const sorted = [...flowResult.pages].sort((a: any, b: any) => a.pageNumber - b.pageNumber);
      const batch = firestore.batch();
      for (const page of sorted) {
        const pageId = `page-${String(page.pageNumber).padStart(3, '0')}`;
        const pageData = Object.fromEntries(
          Object.entries(page as Record<string, any>).filter(([, v]) => v !== undefined)
        );
        batch.set(pagesCol.doc(pageId), {
          ...pageData,
          id: pageId,
          createdAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        });
      }
      await batch.commit();

      const textPages = sorted.filter((p: any) => p.kind === 'text');
      const invalidPages = textPages.filter(
        (p: any) => !VALID_TAGS.includes(p.imageScene?.sceneTag)
      );

      if (invalidPages.length > 0) {
        const badTags = invalidPages.map((p: any) => p.imageScene?.sceneTag ?? 'missing').join(', ');
        throw new Error(`${invalidPages.length}/${textPages.length} text page(s) have invalid/missing sceneTag: ${badTags}`);
      }

      // Capture first text page for the image test
      if (textPages.length > 0) {
        firstTextPageId = `page-${String((textPages[0] as any).pageNumber).padStart(3, '0')}`;
      }

      const tags = [...new Set(textPages.map((p: any) => p.imageScene?.sceneTag))].join(', ');
      return `${sorted.length} pages; ${textPages.length} text page(s) all valid — tags: ${tags}`;
    }));

    // ── Test 2: locationRegistry persisted to story doc ───────────────────
    results.push(await runTest('location_registry', async () => {
      const snap = await storyRef.get();
      const registry = snap.data()?.locationRegistry as Record<string, string> | undefined;
      if (!registry || Object.keys(registry).length === 0) {
        throw new Error('locationRegistry not persisted to story doc after pagination');
      }
      return `${Object.keys(registry).length} location(s): ${Object.keys(registry).join(', ')}`;
    }));

    // ── Test 3: single page image generation ──────────────────────────────
    results.push(await runTest('single_page_image', async () => {
      if (!firstTextPageId) {
        throw new Error('No text page available — pagination test may have failed');
      }

      const imageResult = await storyImageFlow({
        storyId,
        pageId: firstTextPageId,
        storybookId,
        forceRegenerate: true,
      });

      if (!imageResult.ok) {
        throw new Error(imageResult.errorMessage ?? 'storyImageFlow returned ok:false');
      }

      // Capture storage path for cleanup
      const pageSnap = await storybookRef.collection('pages').doc(firstTextPageId).get();
      const storagePath = pageSnap.data()?.imageMetadata?.storagePath as string | undefined;
      if (storagePath) storagePathsToDelete.push(storagePath);

      return `Page ${firstTextPageId} image ready — ${imageResult.imageUrl?.slice(0, 60)}…`;
    }));

  } finally {
    // ── Cleanup: Firestore ─────────────────────────────────────────────────
    const cleanup = async (label: string, fn: () => Promise<void>) => {
      try { await fn(); } catch (e: any) {
        console.error(`[system-test] Cleanup failed for ${label}:`, e?.message);
      }
    };

    await cleanup('pages', async () => {
      const snap = await firestore
        .collection('stories').doc(storyId)
        .collection('storybooks').doc(storybookId)
        .collection('pages').get();
      const batch = firestore.batch();
      snap.docs.forEach(d => batch.delete(d.ref));
      await batch.commit();
    });

    await cleanup('storybook', async () => {
      await storyRef.collection('storybooks').doc(storybookId).delete();
    });
    await cleanup('story', async () => { await storyRef.delete(); });
    await cleanup('child', async () => { await childRef.delete(); });

    // ── Cleanup: Storage (generated images) ───────────────────────────────
    for (const path of storagePathsToDelete) {
      await cleanup(`storage:${path}`, async () => { await deleteStorageObject(path); });
    }
  }

  const allPassed = results.every(r => r.pass);
  const totalDurationMs = Date.now() - overallStart;

  return NextResponse.json(
    { ok: allPassed, results, totalDurationMs, timestamp },
    { status: allPassed ? 200 : 500 }
  );
}
