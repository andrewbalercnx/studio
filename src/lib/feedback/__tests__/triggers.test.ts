import { describe, expect, it } from 'vitest';
import {
  shouldShowFeedbackPrompt,
  qualifiesForTestimonial,
  validateFeedbackSubmission,
  validateTestimonialSubmission,
  isFeedbackTrigger,
  type FeedbackPromptContext,
} from '@/lib/feedback/triggers';

function ctx(overrides: Partial<FeedbackPromptContext> = {}): FeedbackPromptContext {
  return {
    trigger: 'book_first_view',
    subjectId: 'book-1',
    surface: 'parent',
    isSignedIn: true,
    serverEligible: true,
    closedThisSession: false,
    momentReached: true,
    ...overrides,
  };
}

describe('shouldShowFeedbackPrompt', () => {
  it('shows when all conditions are met on a parent surface', () => {
    expect(shouldShowFeedbackPrompt(ctx())).toBe(true);
  });

  it('NEVER shows on kids surfaces', () => {
    expect(shouldShowFeedbackPrompt(ctx({ surface: 'kids' }))).toBe(false);
  });

  it('never shows to signed-out users', () => {
    expect(shouldShowFeedbackPrompt(ctx({ isSignedIn: false }))).toBe(false);
  });

  it('suppresses before the trigger moment is reached (book not finished / order not confirmed)', () => {
    expect(shouldShowFeedbackPrompt(ctx({ momentReached: false }))).toBe(false);
  });

  it('suppresses when the server says this trigger+subject was already answered or dismissed', () => {
    expect(shouldShowFeedbackPrompt(ctx({ serverEligible: false }))).toBe(false);
  });

  it('suppresses while eligibility is unknown/loading (conservative default)', () => {
    expect(shouldShowFeedbackPrompt(ctx({ serverEligible: null }))).toBe(false);
  });

  it('suppresses after dismissal within the same session', () => {
    expect(shouldShowFeedbackPrompt(ctx({ closedThisSession: true }))).toBe(false);
  });

  it('requires a subject id', () => {
    expect(shouldShowFeedbackPrompt(ctx({ subjectId: null }))).toBe(false);
    expect(shouldShowFeedbackPrompt(ctx({ subjectId: '' }))).toBe(false);
  });
});

describe('qualifiesForTestimonial', () => {
  it('unlocks the share-your-story step at 4+ stars only', () => {
    expect(qualifiesForTestimonial(5)).toBe(true);
    expect(qualifiesForTestimonial(4)).toBe(true);
    expect(qualifiesForTestimonial(3)).toBe(false);
    expect(qualifiesForTestimonial(1)).toBe(false);
    expect(qualifiesForTestimonial(null)).toBe(false);
    expect(qualifiesForTestimonial(undefined)).toBe(false);
  });
});

describe('validateFeedbackSubmission', () => {
  const valid = {
    trigger: 'order_placed',
    subjectId: 'order-1',
    action: 'submitted',
    rating: 5,
    nps: 9,
    comment: 'Loved it',
  };

  it('accepts a fully populated submission', () => {
    expect(validateFeedbackSubmission(valid)).toBeNull();
  });

  it('accepts a rating-only submission (nps and comment optional)', () => {
    expect(
      validateFeedbackSubmission({ trigger: 'book_first_view', subjectId: 'b1', action: 'submitted', rating: 3 })
    ).toBeNull();
  });

  it('accepts a dismissal without any rating payload', () => {
    expect(
      validateFeedbackSubmission({ trigger: 'book_first_view', subjectId: 'b1', action: 'dismissed' })
    ).toBeNull();
  });

  it('rejects unknown triggers and actions', () => {
    expect(validateFeedbackSubmission({ ...valid, trigger: 'random' })).toMatch(/trigger/);
    expect(validateFeedbackSubmission({ ...valid, action: 'maybe' })).toMatch(/action/);
  });

  it('rejects missing subject', () => {
    expect(validateFeedbackSubmission({ ...valid, subjectId: '' })).toMatch(/subjectId/);
    expect(validateFeedbackSubmission({ ...valid, subjectId: undefined })).toMatch(/subjectId/);
  });

  it('rejects out-of-range or non-integer ratings on submissions', () => {
    expect(validateFeedbackSubmission({ ...valid, rating: 0 })).toMatch(/rating/);
    expect(validateFeedbackSubmission({ ...valid, rating: 6 })).toMatch(/rating/);
    expect(validateFeedbackSubmission({ ...valid, rating: 4.5 })).toMatch(/rating/);
    expect(validateFeedbackSubmission({ ...valid, rating: undefined })).toMatch(/rating/);
  });

  it('rejects out-of-range nps', () => {
    expect(validateFeedbackSubmission({ ...valid, nps: -1 })).toMatch(/nps/);
    expect(validateFeedbackSubmission({ ...valid, nps: 11 })).toMatch(/nps/);
  });

  it('rejects over-long comments', () => {
    expect(validateFeedbackSubmission({ ...valid, comment: 'x'.repeat(2001) })).toMatch(/comment/);
  });
});

describe('validateTestimonialSubmission', () => {
  it('accepts an explicit-consent testimonial', () => {
    expect(
      validateTestimonialSubmission({ feedbackId: 'f1', consent: true, quote: 'My kid adores her book!' })
    ).toBeNull();
  });

  it('rejects anything without explicit consent === true', () => {
    expect(validateTestimonialSubmission({ feedbackId: 'f1', consent: false, quote: 'q' })).toMatch(/consent/);
    expect(validateTestimonialSubmission({ feedbackId: 'f1', consent: 'yes', quote: 'q' })).toMatch(/consent/);
  });

  it('rejects empty or over-long quotes', () => {
    expect(validateTestimonialSubmission({ feedbackId: 'f1', consent: true, quote: '  ' })).toMatch(/quote/);
    expect(
      validateTestimonialSubmission({ feedbackId: 'f1', consent: true, quote: 'x'.repeat(1001) })
    ).toMatch(/quote/);
  });
});

describe('isFeedbackTrigger', () => {
  it('recognises only the two known triggers', () => {
    expect(isFeedbackTrigger('book_first_view')).toBe(true);
    expect(isFeedbackTrigger('order_placed')).toBe(true);
    expect(isFeedbackTrigger('kids_anything')).toBe(false);
    expect(isFeedbackTrigger(undefined)).toBe(false);
  });
});
