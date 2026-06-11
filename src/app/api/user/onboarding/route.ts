import { NextRequest, NextResponse } from 'next/server';
import { initFirebaseAdminApp } from '@/firebase/admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { verifyAuthToken } from '@/lib/auth-utils';
import type { OnboardingState } from '@/lib/types';
import {
  buildStepViews,
  deriveOnboardingStepStates,
  diffNewlyCompletedSteps,
  isOnboardingComplete,
  isOnboardingTipId,
  type OnboardingSnapshot,
  type OnboardingStepId,
  type OnboardingStepView,
} from '@/lib/onboarding';

/**
 * First-run onboarding state for the authenticated parent.
 *
 * Server-first by design: step completion is derived HERE from real account
 * state (children, story sessions, storybook outputs) so every client renders
 * the same truth and the logic can change without client updates.
 */

export type OnboardingResponse = {
  ok: true;
  steps: OnboardingStepView[];
  complete: boolean;
  dismissed: boolean;
  /** Steps that flipped to complete since the previous derivation (for analytics). */
  newlyCompletedStepIds: OnboardingStepId[];
  /** True exactly once: the call that first observed a viewable book. */
  firstBookJustReady: boolean;
  signupAtMs: number | null;
  firstBookAtMs: number | null;
  timeToFirstBookMs: number | null;
  tipsSeen: { [tipId: string]: boolean };
};

// Caps keep the derivation cheap. Onboarding users have a handful of docs;
// long-time users short-circuit on the cached completedAtMs/dismissed state.
const MAX_SESSIONS = 50;
const MAX_STORIES = 25;
const MAX_STORYBOOKS_PER_STORY = 5;

function responseFromState(
  state: OnboardingState,
  overrides?: Partial<Pick<OnboardingResponse, 'newlyCompletedStepIds' | 'firstBookJustReady' | 'complete'>>
): OnboardingResponse {
  return {
    ok: true,
    steps: buildStepViews(state.steps ?? {}),
    complete: overrides?.complete ?? !!state.completedAtMs,
    dismissed: !!state.dismissed,
    newlyCompletedStepIds: overrides?.newlyCompletedStepIds ?? [],
    firstBookJustReady: overrides?.firstBookJustReady ?? false,
    signupAtMs: state.signupAtMs ?? null,
    firstBookAtMs: state.firstBookAtMs ?? null,
    timeToFirstBookMs: state.timeToFirstBookMs ?? null,
    tipsSeen: state.tipsSeen ?? {},
  };
}

/**
 * GET /api/user/onboarding
 * Derives checklist progress from account state, persists the snapshot (plus
 * the signup→first-book timing pair) on users/{uid}.onboardingState, and
 * returns the full step list for rendering.
 */
export async function GET(request: NextRequest) {
  try {
    const authResult = await verifyAuthToken(request);
    if (!authResult.valid || !authResult.uid) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const uid = authResult.uid;

    await initFirebaseAdminApp();
    const firestore = getFirestore();

    const userRef = firestore.collection('users').doc(uid);
    const userDoc = await userRef.get();
    const userData = userDoc.data() ?? {};
    const state: OnboardingState = userData.onboardingState ?? {};

    // Cheap path: nothing left to derive once finished or dismissed.
    if (state.dismissed || state.completedAtMs) {
      return NextResponse.json(responseFromState(state));
    }

    // Gather real account state in parallel.
    const [childrenSnap, sessionsSnap, storiesSnap] = await Promise.all([
      firestore.collection('children').where('ownerParentUid', '==', uid).get(),
      firestore.collection('storySessions').where('parentUid', '==', uid).limit(MAX_SESSIONS).get(),
      firestore.collection('stories').where('parentUid', '==', uid).limit(MAX_STORIES).get(),
    ]);

    const activeStoryDocs = storiesSnap.docs.filter((d) => !d.data().deletedAt);

    const storybooks: OnboardingSnapshot['storybooks'] = [];
    // Legacy model: generation status lives on the story document itself.
    for (const storyDoc of activeStoryDocs) {
      const story = storyDoc.data();
      const imageStatus = story.imageGeneration?.status;
      const pageStatus = story.pageGeneration?.status;
      if (imageStatus || pageStatus) {
        storybooks.push({
          imageGenerationStatus: imageStatus ?? null,
          pageGenerationStatus: pageStatus ?? null,
        });
      }
    }
    // New model: storybooks subcollection under each story.
    await Promise.all(
      activeStoryDocs.map(async (storyDoc) => {
        const sbSnap = await storyDoc.ref
          .collection('storybooks')
          .limit(MAX_STORYBOOKS_PER_STORY)
          .get();
        for (const sbDoc of sbSnap.docs) {
          const sb = sbDoc.data();
          if (sb.deletedAt) continue;
          storybooks.push({
            imageGenerationStatus: sb.imageGeneration?.status ?? null,
            pageGenerationStatus: sb.pageGeneration?.status ?? null,
          });
        }
      })
    );

    const snapshot: OnboardingSnapshot = {
      children: childrenSnap.docs.map((d) => {
        const c = d.data();
        return { deletedAt: c.deletedAt, photos: c.photos ?? null, avatarUrl: c.avatarUrl ?? null };
      }),
      storySessions: sessionsSnap.docs.map((d) => ({ status: d.data().status ?? null })),
      hasCompiledStory: activeStoryDocs.length > 0,
      storybooks,
    };

    const stepStates = deriveOnboardingStepStates(snapshot);
    const newlyCompletedStepIds = diffNewlyCompletedSteps(state.steps, stepStates);
    const complete = isOnboardingComplete(stepStates);

    const now = Date.now();
    const signupAtMs =
      state.signupAtMs ??
      (typeof userData.createdAt?.toMillis === 'function' ? userData.createdAt.toMillis() : now);

    let firstBookJustReady = false;
    let firstBookAtMs = state.firstBookAtMs ?? null;
    let timeToFirstBookMs = state.timeToFirstBookMs ?? null;
    if (stepStates.previewBook && !firstBookAtMs) {
      // The "wow" moment: first viewable book. Persist the timestamp pair so
      // time-to-first-book is measurable even before PostHog goes live.
      firstBookJustReady = true;
      firstBookAtMs = now;
      timeToFirstBookMs = Math.max(0, now - signupAtMs);
    }

    const nextState: OnboardingState = {
      ...state,
      steps: stepStates,
      signupAtMs,
      ...(firstBookAtMs ? { firstBookAtMs } : {}),
      ...(timeToFirstBookMs !== null ? { timeToFirstBookMs } : {}),
      ...(complete && !state.completedAtMs ? { completedAtMs: now } : {}),
      updatedAtMs: now,
    };

    // Only write when something actually changed (avoids a write per render).
    const changed =
      newlyCompletedStepIds.length > 0 ||
      firstBookJustReady ||
      !state.signupAtMs ||
      !state.steps ||
      (complete && !state.completedAtMs);
    if (changed) {
      await userRef.set({ onboardingState: nextState }, { merge: true });
    }

    return NextResponse.json(
      responseFromState(nextState, { newlyCompletedStepIds, firstBookJustReady, complete })
    );
  } catch (error: any) {
    console.error('[GET /api/user/onboarding] Error:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to load onboarding state' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/user/onboarding
 * Records a user choice on the onboarding state.
 * Body: { action: 'dismiss' } | { action: 'restore' } | { action: 'tipSeen', tipId }
 */
export async function POST(request: NextRequest) {
  try {
    const authResult = await verifyAuthToken(request);
    if (!authResult.valid || !authResult.uid) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const uid = authResult.uid;

    let body: any;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    const action = body?.action;
    const now = Date.now();

    let updates: Record<string, unknown>;
    if (action === 'dismiss') {
      updates = {
        'onboardingState.dismissed': true,
        'onboardingState.dismissedAtMs': now,
        'onboardingState.updatedAtMs': now,
      };
    } else if (action === 'restore') {
      updates = {
        'onboardingState.dismissed': false,
        'onboardingState.updatedAtMs': now,
      };
    } else if (action === 'tipSeen') {
      if (!isOnboardingTipId(body?.tipId)) {
        return NextResponse.json(
          { error: `Unknown tipId. Expected one of: storyCreation, artGeneration` },
          { status: 400 }
        );
      }
      updates = {
        [`onboardingState.tipsSeen.${body.tipId}`]: true,
        'onboardingState.updatedAtMs': now,
      };
    } else {
      return NextResponse.json(
        { error: 'Unknown action. Expected dismiss | restore | tipSeen' },
        { status: 400 }
      );
    }

    await initFirebaseAdminApp();
    const firestore = getFirestore();
    const userRef = firestore.collection('users').doc(uid);
    const userDoc = await userRef.get();
    if (!userDoc.exists) {
      // Profile doc is created at signup; tolerate the (rare) race by seeding it.
      await userRef.set({ onboardingState: { updatedAtMs: now } }, { merge: true });
    }
    await userRef.update(updates);

    return NextResponse.json({ ok: true });
  } catch (error: any) {
    console.error('[POST /api/user/onboarding] Error:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to update onboarding state' },
      { status: 500 }
    );
  }
}
