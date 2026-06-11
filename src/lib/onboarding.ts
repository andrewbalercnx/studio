/**
 * First-run onboarding: shared step definitions + pure derivation logic.
 *
 * The "create your first book" checklist (Sprint W2-B) shows new parents the
 * path from an empty account to a finished storybook. Steps are derived from
 * REAL account state — children/sessions/storybooks in Firestore — never from
 * client-side bookkeeping, so the checklist self-heals if a parent completes a
 * step on another device.
 *
 * Server-first: the Firestore queries and step derivation run in
 * `GET /api/user/onboarding`; clients only render what the API returns. The
 * derivation itself is a pure function over a plain snapshot so it is
 * trivially unit-testable (src/lib/__tests__/onboarding.test.ts).
 */

export type OnboardingStepId =
  | 'createChild'
  | 'addPhoto'
  | 'createStory'
  | 'generateArt'
  | 'previewBook';

export type OnboardingStepDefinition = {
  id: OnboardingStepId;
  /** Short imperative label shown in the checklist. */
  title: string;
  /** One-line explanation of why/how. */
  description: string;
  /** Where the step's CTA sends the parent (existing routes only). */
  href: string;
};

/**
 * Canonical ordered checklist. Order matters: the first incomplete step is the
 * highlighted "next action" in the UI.
 */
export const ONBOARDING_STEPS: readonly OnboardingStepDefinition[] = [
  {
    id: 'createChild',
    title: 'Create a profile for your child',
    description: 'The star of every story. Takes under a minute.',
    href: '/parent/children',
  },
  {
    id: 'addPhoto',
    title: 'Add a photo of your child',
    description: 'Photos let the AI draw your child into the illustrations.',
    href: '/parent/children',
  },
  {
    id: 'createStory',
    title: 'Make up a story together',
    description: 'Pick your child on the home screen, then choose a story adventure.',
    href: '/',
  },
  {
    id: 'generateArt',
    title: 'Turn the story into a picture book',
    description: 'After the story, pick a book type and an art style.',
    href: '/',
  },
  {
    id: 'previewBook',
    title: 'Preview the finished book',
    description: 'Open the book together — and print it if you love it.',
    href: '/parent/storybooks',
  },
] as const;

/** In-context tips auto-shown once each, on first use of a surface. */
export const ONBOARDING_TIP_IDS = ['storyCreation', 'artGeneration'] as const;
export type OnboardingTipId = (typeof ONBOARDING_TIP_IDS)[number];

export function isOnboardingTipId(value: unknown): value is OnboardingTipId {
  return typeof value === 'string' && (ONBOARDING_TIP_IDS as readonly string[]).includes(value);
}

/**
 * Plain-data snapshot of the account state relevant to onboarding. The API
 * route builds this from Firestore; tests build it literally.
 */
export type OnboardingSnapshot = {
  /** All `children` docs owned by the parent (including soft-deleted ones). */
  children: Array<{
    deletedAt?: unknown;
    photos?: string[] | null;
    avatarUrl?: string | null;
  }>;
  /** Story sessions owned by the parent (status field only). */
  storySessions: Array<{ status?: string | null }>;
  /** True if any non-deleted compiled `stories` doc exists for the parent. */
  hasCompiledStory: boolean;
  /**
   * Storybook outputs (new-model subcollection docs, plus legacy story-doc
   * generations mapped to the same shape). Existence = generation started.
   */
  storybooks: Array<{
    imageGenerationStatus?: string | null;
    pageGenerationStatus?: string | null;
  }>;
};

export type OnboardingStepStates = Record<OnboardingStepId, boolean>;

/** A storybook is viewable once its pages or images are ready (same rule as /api/parent/storybooks). */
function isBookViewable(sb: OnboardingSnapshot['storybooks'][number]): boolean {
  return sb.pageGenerationStatus === 'ready' || sb.imageGenerationStatus === 'ready';
}

/**
 * Derive which checklist steps are complete from real account state.
 * Pure — no I/O, no clock, no Firestore types.
 */
export function deriveOnboardingStepStates(snapshot: OnboardingSnapshot): OnboardingStepStates {
  const activeChildren = (snapshot.children ?? []).filter((c) => !c.deletedAt);

  const createChild = activeChildren.length > 0;
  const addPhoto = activeChildren.some(
    (c) => (c.photos?.length ?? 0) > 0 || !!c.avatarUrl
  );
  // A story counts once completed: either a session reached `completed` or a
  // compiled story document exists (the compile pipeline writes `stories/*`).
  const createStory =
    snapshot.hasCompiledStory ||
    (snapshot.storySessions ?? []).some((s) => s.status === 'completed');
  // Art generation has started as soon as any storybook output exists — the
  // storybook doc is created when the child picks a style.
  const generateArt = (snapshot.storybooks ?? []).length > 0;
  const previewBook = (snapshot.storybooks ?? []).some(isBookViewable);

  return { createChild, addPhoto, createStory, generateArt, previewBook };
}

export function isOnboardingComplete(states: OnboardingStepStates): boolean {
  return ONBOARDING_STEPS.every((step) => states[step.id]);
}

/**
 * Step ids that flipped from incomplete (or unknown) to complete since the
 * last persisted snapshot — used to emit one `onboarding.step_completed`
 * analytics event per transition.
 */
export function diffNewlyCompletedSteps(
  previous: Partial<OnboardingStepStates> | undefined | null,
  next: OnboardingStepStates
): OnboardingStepId[] {
  return ONBOARDING_STEPS.filter((step) => next[step.id] && !previous?.[step.id]).map(
    (step) => step.id
  );
}

/** Step list as returned by the API: definition + completion state. */
export type OnboardingStepView = OnboardingStepDefinition & { complete: boolean };

export function buildStepViews(states: Partial<OnboardingStepStates>): OnboardingStepView[] {
  return ONBOARDING_STEPS.map((step) => ({ ...step, complete: !!states[step.id] }));
}
