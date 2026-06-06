/**
 * Raw error -> user-safe message mapping.
 *
 * GUARANTEE: no raw API/model string ever reaches an end user. Every error that
 * surfaces in the UI goes through `toUserSafeMessage`, which matches the raw
 * error against an exhaustive, unit-tested table and returns a friendly,
 * child-appropriate sentence. The raw string stays in logs (ai-flow-logger /
 * server-logger) for operators only.
 *
 * The categories deliberately mirror `classifyError` in `ai-retry.ts` plus a few
 * UI-specific buckets (content-filter, no-output) so the messaging can be
 * tailored without leaking specifics.
 */

export type UserSafeErrorCategory =
  | 'rate_limit'
  | 'timeout'
  | 'service_unavailable'
  | 'content_filtered'
  | 'no_output'
  | 'invalid_request'
  | 'unknown';

type Rule = {
  category: UserSafeErrorCategory;
  /** Lowercased substrings that select this category. */
  patterns: string[];
};

/**
 * Ordered rule table. The FIRST matching rule wins, so more specific/serious
 * buckets (content filtering, rate limit) precede generic ones.
 */
const RULES: Rule[] = [
  {
    category: 'content_filtered',
    patterns: [
      'safety',
      'blocked',
      'content policy',
      'content filter',
      'did not match the expected pattern',
      'prohibited',
    ],
  },
  {
    category: 'rate_limit',
    patterns: ['resource_exhausted', '429', 'quota', 'rate limit', 'rate_limit', 'too many requests'],
  },
  {
    category: 'timeout',
    patterns: ['timed out', 'timeout', 'deadline_exceeded', 'etimedout', '504', 'gateway timeout'],
  },
  {
    category: 'service_unavailable',
    patterns: [
      'unavailable',
      'econnreset',
      'econnrefused',
      'eai_again',
      'socket hang up',
      '500',
      '502',
      '503',
      'internal error',
      'service unavailable',
      'bad gateway',
    ],
  },
  {
    category: 'no_output',
    patterns: ['no image returned', 'no media', 'empty response', 'returned no pages', 'no output'],
  },
  {
    category: 'invalid_request',
    patterns: [
      'invalid_argument',
      'failed_precondition',
      'permission_denied',
      'unauthenticated',
      'not_found',
      '400',
      '401',
      '403',
      '404',
      '422',
    ],
  },
];

/** Friendly, kid-safe copy per category. Single source of truth. */
export const USER_SAFE_MESSAGES: Record<UserSafeErrorCategory, string> = {
  rate_limit: "The Story Wizard is taking a quick nap! We'll try again soon.",
  timeout: 'This is taking a little longer than usual. Please try again in a moment.',
  service_unavailable: 'The Story Wizard is having a little trouble right now. Please try again soon.',
  content_filtered:
    "We couldn't make that picture this time. Try again, or pick a different idea.",
  no_output: "The Story Wizard couldn't finish that part. Please try again.",
  invalid_request: 'Something about that request didn\'t work. Please try again.',
  unknown: 'Oops! Something went wrong. Please try again.',
};

function extractMessage(error: unknown): string {
  if (error == null) return '';
  if (typeof error === 'string') return error;
  if (error instanceof Error) return error.message ?? '';
  const anyErr = error as { message?: unknown };
  if (typeof anyErr.message === 'string') return anyErr.message;
  try {
    return String(error);
  } catch {
    return '';
  }
}

/** Categorise a raw error string/object into a user-safe bucket. */
export function categorizeError(error: unknown): UserSafeErrorCategory {
  const message = extractMessage(error).toLowerCase();
  if (!message) return 'unknown';
  for (const rule of RULES) {
    if (rule.patterns.some((p) => message.includes(p))) {
      return rule.category;
    }
  }
  return 'unknown';
}

/**
 * Map any raw error to a user-safe message. NEVER returns the raw string.
 * This is the only function the routes/UI should use to render generation
 * failures.
 */
export function toUserSafeMessage(error: unknown): string {
  return USER_SAFE_MESSAGES[categorizeError(error)];
}
