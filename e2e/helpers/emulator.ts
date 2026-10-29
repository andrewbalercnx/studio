/**
 * Emulator-side helpers for the E2E suite.
 *
 * These run inside the Playwright runner process (Node) and talk straight to
 * the local Firebase emulators with firebase-admin — which automatically
 * targets the emulators when FIRESTORE_EMULATOR_HOST / FIREBASE_AUTH_EMULATOR_HOST
 * are set. The `demo-` project id guarantees nothing here can reach production.
 *
 * Jobs:
 *  1. seedCatalog()        — the minimal catalog docs (generator, output type =
 *                            Form, image style = Style) the funnel UI needs.
 *  2. seedCompletedStory() — a completed story session + compiled story doc,
 *                            shaped exactly like the wizard flow + storyCompile
 *                            leave them. This is the deterministic stand-in for
 *                            the AI-driven story creation steps (see
 *                            docs/testing/e2e.md for why the seam sits here).
 *  3. seedReadyBook()      — a finished Book (server pipeline) for report-only
 *                            journeys that need one without running the funnel.
 *  4. cleanup helpers      — per-account doc deletion (children, stories, books,
 *                            manuscripts, jobs, ledger) + auth-user deletion.
 */
import { getApps, initializeApp, type App } from 'firebase-admin/app';
import { FieldValue, getFirestore, type Firestore } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';
import {
  AUTH_EMULATOR_URL,
  E2E_EMAIL_PREFIX,
  E2E_PROJECT_ID,
  FIRESTORE_EMULATOR_HOST_PORT,
  REGRESSION_FIELD,
} from './test-env';

let app: App | undefined;

function adminApp(): App {
  if (app) return app;
  // Point firebase-admin at the emulators BEFORE init. These env vars are the
  // documented emulator switches for the Admin SDK.
  process.env.FIRESTORE_EMULATOR_HOST = FIRESTORE_EMULATOR_HOST_PORT;
  process.env.FIREBASE_AUTH_EMULATOR_HOST = AUTH_EMULATOR_URL.replace(/^https?:\/\//, '');
  app = getApps().length
    ? getApps()[0]
    : initializeApp({ projectId: E2E_PROJECT_ID });
  return app;
}

export function emulatorFirestore(): Firestore {
  return getFirestore(adminApp());
}

/** Catalog doc ids — referenced by specs for click targets and assertions. */
export const SEED = {
  generatorId: 'wizard',
  generatorName: 'Story Wizard',
  // A second generator is seeded so /kids/create renders the selection screen:
  // with exactly one live generator the page AUTO-selects it, which for the
  // wizard immediately starts the live-AI flow.
  secondGeneratorId: 'chat',
  secondGeneratorName: 'Chat Adventure',
  outputTypeId: 'e2e-picture-book',
  outputTypeLabel: 'E2E Picture Book',
  imageStyleId: 'e2e-watercolour',
  imageStyleTitle: 'E2E Watercolour',
  storyTitle: 'The Deterministic Dragon',
} as const;

/**
 * Seed the catalog collections the funnel reads. Idempotent (set with fixed
 * ids), so concurrent projects/workers can all call it safely.
 */
export async function seedCatalog(): Promise<void> {
  const db = emulatorFirestore();
  const now = FieldValue.serverTimestamp();

  await Promise.all([
    // /kids/create reads storyGenerators where status==live && enabledForKids.
    db.collection('storyGenerators').doc(SEED.generatorId).set({
      id: SEED.generatorId,
      name: SEED.generatorName,
      description: 'Answer fun questions and the wizard writes your story.',
      status: 'live',
      enabledForKids: true,
      order: 1,
      styling: {
        icon: 'Wand2',
        gradient: 'bg-gradient-to-br from-amber-400 to-orange-500',
        loadingMessage: 'Summoning the Story Wizard...',
      },
      [REGRESSION_FIELD]: true,
      createdAt: now,
      updatedAt: now,
    }),
    db.collection('storyGenerators').doc(SEED.secondGeneratorId).set({
      id: SEED.secondGeneratorId,
      name: SEED.secondGeneratorName,
      description: 'Chat with a storyteller to build your adventure.',
      status: 'live',
      enabledForKids: true,
      order: 2,
      styling: {
        icon: 'MessageCircle',
        gradient: 'bg-gradient-to-br from-blue-400 to-purple-500',
        loadingMessage: 'Starting your adventure...',
      },
      [REGRESSION_FIELD]: true,
      createdAt: now,
      updatedAt: now,
    }),
    // /api/storyOutputTypes returns status==live docs; the Form adapter reads
    // this as a picture book (no category), so POST /api/books makes a
    // 12-page Manuscript (the allowed length nearest layoutHints.pageCount).
    db.collection('storyOutputTypes').doc(SEED.outputTypeId).set({
      id: SEED.outputTypeId,
      name: SEED.outputTypeLabel,
      childFacingLabel: SEED.outputTypeLabel,
      shortDescription: 'A deterministic test book for the E2E suite.',
      status: 'live',
      layoutHints: { pageCount: 3 },
      [REGRESSION_FIELD]: true,
      createdAt: now,
      updatedAt: now,
    }),
    // /api/imageStyles returns all docs. No sampleImageUrl: the style picker
    // then renders its local emoji fallback, keeping the run offline-safe.
    db.collection('imageStyles').doc(SEED.imageStyleId).set({
      id: SEED.imageStyleId,
      title: SEED.imageStyleTitle,
      stylePrompt: 'deterministic e2e watercolour style',
      preferred: true,
      [REGRESSION_FIELD]: true,
      createdAt: now,
      updatedAt: now,
    }),
  ]);
}

/**
 * Seed a COMPLETED story for {parentUid, childId}: the storySessions doc, the
 * per-child session mirror, and the compiled stories/{id} doc — the exact
 * post-conditions of the wizard flow + /api/storyCompile (see
 * story-compile-flow.ts wizard branch). This is the deterministic seam that
 * replaces the live-AI story creation steps in the funnel spec.
 */
export async function seedCompletedStory(opts: {
  parentUid: string;
  childId: string;
}): Promise<{ sessionId: string }> {
  const db = emulatorFirestore();
  const now = FieldValue.serverTimestamp();
  const sessionId = `e2e-story-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

  const sessionData = {
    id: sessionId,
    childId: opts.childId,
    parentUid: opts.parentUid,
    status: 'completed' as const,
    currentPhase: 'final' as const,
    storyMode: 'wizard' as const,
    storyTitle: SEED.storyTitle,
    storyVibe: 'adventurous',
    storyAllowanceConsumed: true,
    [REGRESSION_FIELD]: true,
    createdAt: now,
    updatedAt: now,
  };

  const storyText = [
    'Once upon a test, a small dragon learned to breathe perfectly repeatable fire.',
    'Every flame came out exactly the same, which made the other dragons very jealous.',
    'And so the deterministic dragon lived happily, green build after green build.',
  ].join('\n\n');

  const batch = db.batch();
  batch.set(db.collection('storySessions').doc(sessionId), sessionData);
  batch.set(
    db.collection('children').doc(opts.childId).collection('sessions').doc(sessionId),
    sessionData,
  );
  // Parent-created children default to autoReadAloud=true, which makes the
  // story read page fire a live TTS call on open. Disable it for determinism —
  // narration is covered by the TEST_MODE audio fixtures instead.
  batch.update(db.collection('children').doc(opts.childId), { autoReadAloud: false });
  batch.set(db.collection('stories').doc(sessionId), {
    id: sessionId,
    parentUid: opts.parentUid,
    childId: opts.childId,
    deletedAt: null,
    storyText,
    rawStoryText: storyText,
    synopsis: 'A small dragon masters perfectly repeatable fire.',
    actors: [opts.childId],
    storyMode: 'wizard',
    metadata: {
      title: SEED.storyTitle,
      paragraphs: 3,
      storyOutputTypeId: SEED.outputTypeId,
      storyOutputTypeName: SEED.outputTypeLabel,
    },
    titleGeneration: { status: 'ready' },
    synopsisGeneration: { status: 'ready' },
    actorAvatarGeneration: { status: 'ready' },
    [REGRESSION_FIELD]: true,
    createdAt: now,
    updatedAt: now,
  });
  await batch.commit();

  return { sessionId };
}

/**
 * Seed a finished Book (server pipeline) for a story: the Manuscript and its
 * pages, the Book and its pages, as the TEST_MODE jobs leave them. Used by
 * report-only journeys that need a ready Book without running the funnel; the
 * blocking funnel spec creates its Book through the real route and jobs.
 */
export async function seedReadyBook(opts: {
  storyId: string;
}): Promise<{ bookId: string; manuscriptId: string }> {
  const db = emulatorFirestore();
  const now = FieldValue.serverTimestamp();
  const story = (await db.collection('stories').doc(opts.storyId).get()).data();
  if (!story) throw new Error(`Story ${opts.storyId} not found — seed it first`);
  const ownerUid = story.parentUid as string;
  const childId = story.childId as string;
  const suffix = `${Date.now()}${Math.floor(Math.random() * 1e6)}`;
  const manuscriptId = `ms_e2e${suffix}`;
  const bookId = `bk_e2e${suffix}`;
  const transparentPng =
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
  const words = ['Once upon a test.', 'The dragon breathed repeatable fire.', 'The end.'];
  const scene = { location: 'A bright test garden', presentCast: [], action: '', locationKey: 'test', mood: '', tag: 'outdoor-day', castActions: [] };

  const batch = db.batch();
  const manuscriptRef = db.collection('manuscripts').doc(manuscriptId);
  batch.set(manuscriptRef, {
    ownerUid, storyId: opts.storyId, childId, form: SEED.outputTypeId, readingLevel: 'all',
    length: words.length, density: 'balanced', status: 'ready', narration: null, cover: scene,
    title: SEED.storyTitle, [REGRESSION_FIELD]: true, createdAt: now, updatedAt: now,
  });
  words.forEach((text, i) => {
    batch.set(manuscriptRef.collection('pages').doc(String(i + 1)), {
      ownerUid, pageNumber: i + 1, text, narrationText: null, scene, narrationUrl: null, createdAt: now, updatedAt: now,
    });
  });
  const bookRef = db.collection('books').doc(bookId);
  batch.set(bookRef, {
    ownerUid, manuscriptId, storyId: opts.storyId, childId, styleId: SEED.imageStyleId, layoutId: null,
    printProductId: null, status: 'ready', art: { total: words.length + 1, done: words.length + 1, failed: 0 },
    [REGRESSION_FIELD]: true, createdAt: now, updatedAt: now,
  });
  for (let n = 1; n <= words.length + 1; n++) {
    batch.set(bookRef.collection('pages').doc(String(n)), {
      ownerUid, pageNumber: n, kind: n === 1 ? 'cover' : 'story', manuscriptPage: n === 1 ? null : n - 1,
      artUrl: transparentPng, artJob: null, createdAt: now, updatedAt: now,
    });
  }
  await batch.commit();
  return { bookId, manuscriptId };
}

/** Find a child doc by owner + display name (used after UI-driven creation). */
export async function findChildId(parentUid: string, displayName: string): Promise<string> {
  const db = emulatorFirestore();
  const snap = await db
    .collection('children')
    .where('ownerParentUid', '==', parentUid)
    .get();
  const match = snap.docs.find((d) => d.data().displayName === displayName);
  if (!match) {
    throw new Error(
      `No child named "${displayName}" found for parent ${parentUid}. ` +
        `Children present: ${snap.docs.map((d) => d.data().displayName).join(', ') || '(none)'}`,
    );
  }
  return match.id;
}

/** Look up an emulator auth user's uid by email (after UI-driven signup). */
export async function findUidByEmail(email: string): Promise<string> {
  const user = await getAuth(adminApp()).getUserByEmail(email);
  return user.uid;
}

/**
 * Delete everything a funnel run created. The emulator is ephemeral in CI, but
 * local reruns reuse a long-lived emulator — without cleanup, leftover children
 * and stories from earlier runs would make selectors ambiguous.
 *
 * Mirrors scripts/cleanup-regression-data.mjs (regressionTest flag) and extends
 * it with the gaps that script is documented to miss: auth users, `users` docs
 * and `stories` docs (deleted here via the per-run seed/spec data).
 */
export async function cleanupFunnelAccount(opts: { uid: string }): Promise<void> {
  const db = emulatorFirestore();
  const auth = getAuth(adminApp());
  const { uid } = opts;

  async function deleteDocWithSubcollections(ref: FirebaseFirestore.DocumentReference) {
    const subcollections = await ref.listCollections();
    for (const sub of subcollections) {
      const subDocs = await sub.get();
      for (const d of subDocs.docs) {
        await deleteDocWithSubcollections(d.ref);
      }
    }
    await ref.delete();
  }

  async function deleteWhere(collection: string, field: string) {
    const snap = await db.collection(collection).where(field, '==', uid).get();
    for (const d of snap.docs) {
      await deleteDocWithSubcollections(d.ref);
    }
  }

  await deleteWhere('children', 'ownerParentUid');
  await deleteWhere('books', 'ownerUid');
  await deleteWhere('manuscripts', 'ownerUid');
  await deleteWhere('jobs', 'ownerUid');
  await deleteWhere('storySessions', 'parentUid');
  await deleteWhere('stories', 'parentUid');
  // Ledger docs are keyed by parentUid (see ledger.server.ts ledgerDocPath).
  await deleteDocWithSubcollections(db.collection('entitlementLedgers').doc(uid)).catch(() => {});
  await deleteDocWithSubcollections(db.collection('users').doc(uid)).catch(() => {});
  await auth.deleteUser(uid).catch(() => {});
}

/** Guard: refuse to run cleanup against anything but an e2e account. */
export function assertIsE2EEmail(email: string): void {
  if (!email.startsWith(E2E_EMAIL_PREFIX)) {
    throw new Error(`Refusing to operate on non-e2e account: ${email}`);
  }
}
