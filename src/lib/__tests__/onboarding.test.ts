import { describe, expect, it } from 'vitest';
import {
  ONBOARDING_STEPS,
  buildStepViews,
  deriveOnboardingStepStates,
  diffNewlyCompletedSteps,
  isOnboardingComplete,
  isOnboardingTipId,
  type OnboardingSnapshot,
} from '../onboarding';

const emptySnapshot: OnboardingSnapshot = {
  children: [],
  stories: [],
  books: [],
};

describe('deriveOnboardingStepStates', () => {
  it('marks nothing complete for a brand-new account', () => {
    expect(deriveOnboardingStepStates(emptySnapshot)).toEqual({
      createChild: false,
      addPhoto: false,
      createStory: false,
      generateArt: false,
      previewBook: false,
    });
  });

  it('completes createChild when a non-deleted child exists', () => {
    const states = deriveOnboardingStepStates({
      ...emptySnapshot,
      children: [{}],
    });
    expect(states.createChild).toBe(true);
    expect(states.addPhoto).toBe(false);
  });

  it('ignores soft-deleted children', () => {
    const states = deriveOnboardingStepStates({
      ...emptySnapshot,
      children: [{ deletedAt: { seconds: 1 }, photos: ['https://x/p.jpg'] }],
    });
    expect(states.createChild).toBe(false);
    expect(states.addPhoto).toBe(false);
  });

  it('completes addPhoto when a child has an uploaded photo', () => {
    const states = deriveOnboardingStepStates({
      ...emptySnapshot,
      children: [{ photos: ['https://x/p.jpg'] }],
    });
    expect(states.addPhoto).toBe(true);
  });

  it('completes addPhoto when a child has an avatar but no photos array', () => {
    const states = deriveOnboardingStepStates({
      ...emptySnapshot,
      children: [{ avatarUrl: 'https://x/a.png' }],
    });
    expect(states.addPhoto).toBe(true);
  });

  it('does not complete createStory for a story still being made', () => {
    const states = deriveOnboardingStepStates({
      ...emptySnapshot,
      stories: [{ status: 'creating' }, { status: 'finishing' }],
    });
    expect(states.createStory).toBe(false);
  });

  it('completes createStory when a story is complete', () => {
    const states = deriveOnboardingStepStates({
      ...emptySnapshot,
      stories: [{ status: 'creating' }, { status: 'complete' }],
    });
    expect(states.createStory).toBe(true);
  });

  it('completes generateArt as soon as a Book exists', () => {
    const states = deriveOnboardingStepStates({
      ...emptySnapshot,
      books: [{ status: 'illustrating' }],
    });
    expect(states.generateArt).toBe(true);
    expect(states.previewBook).toBe(false);
  });

  it('completes previewBook when a Book is ready, partial or locked', () => {
    for (const status of ['ready', 'partial', 'locked']) {
      expect(deriveOnboardingStepStates({ ...emptySnapshot, books: [{ status }] }).previewBook).toBe(true);
    }
    expect(deriveOnboardingStepStates({ ...emptySnapshot, books: [{ status: 'failed' }] }).previewBook).toBe(false);
  });

  it('marks the whole funnel complete for a fully activated account', () => {
    const states = deriveOnboardingStepStates({
      children: [{ photos: ['https://x/p.jpg'], avatarUrl: 'https://x/a.png' }],
      stories: [{ status: 'complete' }],
      books: [{ status: 'ready' }],
    });
    expect(isOnboardingComplete(states)).toBe(true);
  });
});

describe('isOnboardingComplete', () => {
  it('is false when any step is incomplete', () => {
    const states = deriveOnboardingStepStates({
      ...emptySnapshot,
      children: [{ photos: ['https://x/p.jpg'] }],
    });
    expect(isOnboardingComplete(states)).toBe(false);
  });
});

describe('diffNewlyCompletedSteps', () => {
  it('returns every complete step when there is no previous snapshot', () => {
    const next = deriveOnboardingStepStates({
      ...emptySnapshot,
      children: [{ photos: ['https://x/p.jpg'] }],
    });
    expect(diffNewlyCompletedSteps(undefined, next)).toEqual(['createChild', 'addPhoto']);
  });

  it('returns only the transitions since the previous snapshot', () => {
    const prev = { createChild: true, addPhoto: false };
    const next = deriveOnboardingStepStates({
      ...emptySnapshot,
      children: [{ photos: ['https://x/p.jpg'] }],
      stories: [{ status: 'complete' }],
    });
    expect(diffNewlyCompletedSteps(prev, next)).toEqual(['addPhoto', 'createStory']);
  });

  it('returns nothing when state is unchanged', () => {
    const states = deriveOnboardingStepStates(emptySnapshot);
    expect(diffNewlyCompletedSteps(states, states)).toEqual([]);
  });
});

describe('buildStepViews', () => {
  it('returns all steps in canonical order with completion flags', () => {
    const views = buildStepViews({ createChild: true });
    expect(views.map((v) => v.id)).toEqual(ONBOARDING_STEPS.map((s) => s.id));
    expect(views[0].complete).toBe(true);
    expect(views[1].complete).toBe(false);
    expect(views.every((v) => v.title && v.href)).toBe(true);
  });
});

describe('isOnboardingTipId', () => {
  it('accepts known tip ids', () => {
    expect(isOnboardingTipId('storyCreation')).toBe(true);
    expect(isOnboardingTipId('artGeneration')).toBe(true);
  });

  it('rejects unknown values', () => {
    expect(isOnboardingTipId('somethingElse')).toBe(false);
    expect(isOnboardingTipId(42)).toBe(false);
    expect(isOnboardingTipId(undefined)).toBe(false);
  });
});
