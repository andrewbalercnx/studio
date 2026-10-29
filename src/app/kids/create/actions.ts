'use server';

import { auth } from 'firebase-admin';
import { initFirebaseAdminApp } from '@/firebase/admin/app';
import { getServerFirestore } from '@/lib/server-firestore';
import { enforcePersonaScope } from '@/lib/persona.server';
import { storyWizardFlow } from '@/ai/flows/story-wizard-flow';
import type { StoryWizardAnswer, StoryWizardOutput } from '@/lib/types';

const NOT_ALLOWED: StoryWizardOutput = {
  state: 'error',
  error: "We couldn't open that story. Please go back and try again.",
  ok: false,
};

/**
 * One step of the story wizard for the kids create page.
 *
 * Server actions are callable from any browser, so this checks the caller
 * itself before running the flow: a valid ID token, a session owned by that
 * user (admin/writer exempt) for the child named, and the child-persona scope.
 * The page must call this, never `storyWizardFlow` directly.
 */
export async function runKidsWizardStep(input: {
  idToken: string;
  childId: string;
  sessionId: string;
  answers: StoryWizardAnswer[];
}): Promise<StoryWizardOutput> {
  await initFirebaseAdminApp();

  let uid: string;
  let claims: Record<string, unknown>;
  try {
    const decoded = await auth().verifyIdToken(input.idToken);
    uid = decoded.uid;
    claims = decoded;
  } catch {
    return NOT_ALLOWED;
  }

  if (typeof input.sessionId !== 'string' || input.sessionId.length === 0) return NOT_ALLOWED;
  const firestore = await getServerFirestore();
  const sessionSnap = await firestore.collection('storySessions').doc(input.sessionId).get();
  if (!sessionSnap.exists) return NOT_ALLOWED;
  const session = sessionSnap.data() as { parentUid?: string; childId?: string };

  const privileged = claims.isAdmin === true || claims.isWriter === true;
  if (!privileged && session.parentUid !== uid) return NOT_ALLOWED;
  if (session.childId !== input.childId) return NOT_ALLOWED;

  const persona = await enforcePersonaScope({ expectedUid: uid, effectiveChildId: session.childId, claims });
  if (!persona.ok) return NOT_ALLOWED;

  return storyWizardFlow({
    childId: session.childId,
    sessionId: input.sessionId,
    answers: Array.isArray(input.answers) ? input.answers : [],
  });
}
