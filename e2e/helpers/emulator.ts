/**
 * Emulator-side helpers for the E2E suite.
 *
 * These run inside the Playwright runner process (Node) and talk straight to
 * the local Firebase emulators with firebase-admin — which automatically
 * targets the emulators when FIRESTORE_EMULATOR_HOST / FIREBASE_AUTH_EMULATOR_HOST
 * are set. The `demo-` project id guarantees nothing here can reach production.
 *
 * Three jobs:
 *  1. seedCatalog()        — the minimal catalog docs (generator, output type,
 *                            image style) the funnel UI needs to render choices.
 *  2. seedCompletedStory() — a completed story session + compiled story doc,
 *                            shaped exactly like the wizard flow + storyCompile
 *                            leave them. This is the deterministic stand-in for
 *                            the AI-driven story creation steps (see
 *                            docs/testing/e2e.md for why the seam sits here).
 *  3. cleanup helpers      — regressionTest-stamped doc deletion + auth-user
 *                            deletion, mirroring scripts/cleanup-regression-data.mjs.
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
    // /api/storyOutputTypes returns status==live docs. No defaultPrintLayoutId
    // so /api/storybookV2/create falls back to default 1024x1024 dimensions.
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
 * Seed a fully-generated storybook under stories/{storyId} — the exact
 * post-conditions of the TEST_MODE /api/storybookV2/pages + /images routes.
 * Used by report-only specs (a11y/visual) that need a ready book without
 * re-running the whole funnel. The blocking funnel spec does NOT use this; it
 * exercises the real routes.
 */
export async function seedReadyStorybook(opts: {
  storyId: string;
}): Promise<{ storybookId: string }> {
  const db = emulatorFirestore();
  const now = FieldValue.serverTimestamp();
  const storybookId = `e2e-book-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

  const storyRef = db.collection('stories').doc(opts.storyId);
  const storySnap = await storyRef.get();
  if (!storySnap.exists) throw new Error(`Story ${opts.storyId} not found — seed it first`);
  const story = storySnap.data()!;

  const storybookRef = storyRef.collection('storybooks').doc(storybookId);
  const transparentPng =
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

  const batch = db.batch();
  batch.set(storybookRef, {
    id: storybookId,
    storyId: opts.storyId,
    childId: story.childId,
    parentUid: story.parentUid,
    storyOutputTypeId: SEED.outputTypeId,
    imageStyleId: SEED.imageStyleId,
    imageStylePrompt: 'deterministic e2e watercolour style',
    printLayoutId: null,
    imageWidthPx: 1024,
    imageHeightPx: 1024,
    title: SEED.storyTitle,
    pageGeneration: { status: 'ready', pagesCount: 3 },
    imageGeneration: { status: 'ready', pagesReady: 3, pagesTotal: 3 },
    audioGeneration: { status: 'ready', pagesReady: 3, pagesTotal: 3 },
    exemplarGeneration: { status: 'ready' },
    [REGRESSION_FIELD]: true,
    createdAt: now,
    updatedAt: now,
  });

  const pages = [
    { pageNumber: 1, kind: 'title_page', bodyText: SEED.storyTitle, displayText: SEED.storyTitle },
    { pageNumber: 2, kind: 'text', bodyText: 'Once upon a test.', displayText: 'Once upon a test.' },
    { pageNumber: 3, kind: 'text', bodyText: 'The end.', displayText: 'The end.' },
  ];
  for (const page of pages) {
    const pageId = `page-${String(page.pageNumber).padStart(3, '0')}`;
    batch.set(storybookRef.collection('pages').doc(pageId), {
      ...page,
      id: pageId,
      imagePrompt: '',
      entityIds: [],
      imageStatus: 'ready',
      imageUrl: transparentPng,
      createdAt: now,
      updatedAt: now,
    });
  }
  await batch.commit();

  return { storybookId };
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
