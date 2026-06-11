/**
 * Feedback prompt trigger & suppression logic (Sprint W3-C).
 *
 * Pure functions shared by the client (RatingPrompt show/hide decision) and
 * the server (POST /api/feedback validation), so the rules — parents only,
 * never shown twice for the same trigger+subject, non-blocking — are tested
 * once and enforced everywhere.
 */

export const FEEDBACK_TRIGGERS = ['book_first_view', 'order_placed'] as const;
export type FeedbackTrigger = (typeof FEEDBACK_TRIGGERS)[number];

export const FEEDBACK_ACTIONS = ['submitted', 'dismissed'] as const;
export type FeedbackAction = (typeof FEEDBACK_ACTIONS)[number];

export function isFeedbackTrigger(value: unknown): value is FeedbackTrigger {
  return typeof value === 'string' && (FEEDBACK_TRIGGERS as readonly string[]).includes(value);
}

export function isFeedbackAction(value: unknown): value is FeedbackAction {
  return typeof value === 'string' && (FEEDBACK_ACTIONS as readonly string[]).includes(value);
}

/** Everything the client knows when deciding whether to show a rating prompt. */
export type FeedbackPromptContext = {
  trigger: FeedbackTrigger;
  /** The book/order the prompt is about. No subject, no prompt. */
  subjectId: string | null | undefined;
  /**
   * Which surface the prompt would render on. Prompts are PARENT-facing only:
   * kids surfaces (/kids/*) must never show them.
   */
  surface: 'parent' | 'kids';
  /** Signed-in parent present? (Anonymous/visitor sessions are never prompted.) */
  isSignedIn: boolean;
  /**
   * Server-side eligibility (no feedback doc exists yet for this
   * uid+trigger+subject). `null` while loading/unknown — suppressed until known.
   */
  serverEligible: boolean | null;
  /** The user dismissed or completed the prompt in this page session. */
  closedThisSession: boolean;
  /** The trigger moment has actually been reached (book finished / order confirmed). */
  momentReached: boolean;
};

/**
 * The single show/suppress decision. Conservative by design: anything unknown
 * (still loading, missing subject) means "don't show" — a missed prompt is
 * cheap, an annoying or kid-facing prompt is not.
 */
export function shouldShowFeedbackPrompt(ctx: FeedbackPromptContext): boolean {
  if (!ctx.subjectId) return false;
  if (ctx.surface !== 'parent') return false;
  if (!ctx.isSignedIn) return false;
  if (!ctx.momentReached) return false;
  if (ctx.serverEligible !== true) return false; // unknown/loading => suppress
  if (ctx.closedThisSession) return false;
  return true;
}

/** Ratings of 4–5 stars unlock the optional "share your story" testimonial step. */
export function qualifiesForTestimonial(rating: number | null | undefined): boolean {
  return typeof rating === 'number' && rating >= 4;
}

export const FEEDBACK_COMMENT_MAX_LENGTH = 2000;
export const TESTIMONIAL_QUOTE_MAX_LENGTH = 1000;

export type FeedbackSubmissionInput = {
  trigger: unknown;
  subjectId: unknown;
  action: unknown;
  rating?: unknown;
  nps?: unknown;
  comment?: unknown;
};

/**
 * Validate a feedback submission (used by POST /api/feedback). Returns a
 * human-readable error string, or null when valid.
 *
 * Rules: dismissals carry no payload requirements; submissions require a
 * 1–5 integer rating; NPS (0–10 integer) and comment are optional.
 */
export function validateFeedbackSubmission(input: FeedbackSubmissionInput): string | null {
  if (!isFeedbackTrigger(input.trigger)) {
    return `trigger must be one of: ${FEEDBACK_TRIGGERS.join(', ')}`;
  }
  if (typeof input.subjectId !== 'string' || input.subjectId.trim().length === 0) {
    return 'subjectId is required';
  }
  if (input.subjectId.length > 256) {
    return 'subjectId is too long';
  }
  if (!isFeedbackAction(input.action)) {
    return `action must be one of: ${FEEDBACK_ACTIONS.join(', ')}`;
  }
  if (input.action === 'dismissed') {
    return null;
  }
  if (!Number.isInteger(input.rating) || (input.rating as number) < 1 || (input.rating as number) > 5) {
    return 'rating must be an integer between 1 and 5';
  }
  if (input.nps !== undefined && input.nps !== null) {
    if (!Number.isInteger(input.nps) || (input.nps as number) < 0 || (input.nps as number) > 10) {
      return 'nps must be an integer between 0 and 10';
    }
  }
  if (input.comment !== undefined && input.comment !== null) {
    if (typeof input.comment !== 'string') {
      return 'comment must be a string';
    }
    if (input.comment.length > FEEDBACK_COMMENT_MAX_LENGTH) {
      return `comment must be at most ${FEEDBACK_COMMENT_MAX_LENGTH} characters`;
    }
  }
  return null;
}

export type TestimonialSubmissionInput = {
  feedbackId: unknown;
  consent: unknown;
  quote: unknown;
};

/**
 * Validate a testimonial attachment (POST /api/feedback/testimonial).
 * Consent must be explicitly true — a testimonial without consent is useless
 * to marketing and must never be stored as consented.
 */
export function validateTestimonialSubmission(input: TestimonialSubmissionInput): string | null {
  if (typeof input.feedbackId !== 'string' || input.feedbackId.trim().length === 0) {
    return 'feedbackId is required';
  }
  if (input.consent !== true) {
    return 'consent must be explicitly true to share a testimonial';
  }
  if (typeof input.quote !== 'string' || input.quote.trim().length === 0) {
    return 'quote is required';
  }
  if (input.quote.length > TESTIMONIAL_QUOTE_MAX_LENGTH) {
    return `quote must be at most ${TESTIMONIAL_QUOTE_MAX_LENGTH} characters`;
  }
  return null;
}
