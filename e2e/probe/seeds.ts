/**
 * Probe-specific emulator seeds (beyond e2e/helpers/emulator.ts seedCatalog).
 *
 * Both seeds are scoped to the single check that needs them and MUST be
 * removed in the check's finally block: a live default-startup tour or an
 * extra generator card left in the emulator would leak into every later
 * signup in the same emulator session and break run-to-run determinism.
 */
import { FieldValue } from 'firebase-admin/firestore';
import { emulatorFirestore } from '../helpers/emulator';
import { REGRESSION_FIELD } from '../helpers/test-env';

export const STARTUP_TOUR_ID = 'probe-startup-tour';

/** Seed a minimal live default-startup help wizard so the welcome tour
 * auto-launches for new users (the W1C-1 "End Tour" scenario). */
export async function seedStartupTour(): Promise<void> {
  const db = emulatorFirestore();
  const now = FieldValue.serverTimestamp();
  await db.collection('helpWizards').doc(STARTUP_TOUR_ID).set({
    id: STARTUP_TOUR_ID,
    title: 'Probe Welcome Tour',
    status: 'live',
    role: 'parent',
    order: 1,
    isDefaultStartup: true,
    pages: [
      {
        title: 'Welcome to StoryPic!',
        description: 'This quick tour shows you around.',
        route: '/',
      },
      {
        title: 'Your children live here',
        description: 'Manage profiles from the parent area.',
        route: '/',
      },
    ],
    [REGRESSION_FIELD]: true,
    createdAt: now,
    updatedAt: now,
  });
}

export async function removeStartupTour(): Promise<void> {
  await emulatorFirestore().collection('helpWizards').doc(STARTUP_TOUR_ID).delete();
}

export const JARGON_GENERATOR_ID = 'gemini3';

/**
 * Seed a generator whose STORED name/description are full of model jargon —
 * exactly what the live `storyGenerators` collection contains ("Gemini Free",
 * gemini4-style names; POC finding 5). The kids-generator presentation layer
 * (W1-C fix) must keep all of it away from the child-facing chooser.
 */
export async function seedJargonGenerator(): Promise<void> {
  const db = emulatorFirestore();
  const now = FieldValue.serverTimestamp();
  await db.collection('storyGenerators').doc(JARGON_GENERATOR_ID).set({
    id: JARGON_GENERATOR_ID,
    name: 'Gemini Free',
    description: 'Uses the gemini-2.5-flash LLM with the free-tier model config.',
    status: 'live',
    enabledForKids: true,
    order: 9,
    styling: {
      icon: 'Sparkles',
      gradient: 'bg-gradient-to-br from-green-400 to-emerald-500',
      loadingMessage: 'Calling Gemini...',
    },
    [REGRESSION_FIELD]: true,
    createdAt: now,
    updatedAt: now,
  });
}

export async function removeJargonGenerator(): Promise<void> {
  await emulatorFirestore().collection('storyGenerators').doc(JARGON_GENERATOR_ID).delete();
}
