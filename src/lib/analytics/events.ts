/**
 * Canonical analytics event taxonomy — the single source of truth for product analytics.
 *
 * Names follow `noun.verb`, snake-cased. Adding an event here is the ONLY supported way to
 * introduce a new analytics event; `track()` rejects names not in this registry.
 *
 * See docs/sprints/SPRINT-01-MEASUREMENT-SPINE.md §4 for the funnel rationale.
 */
export const ANALYTICS_EVENTS = {
  // --- Funnel (parent / web) ---
  signupCompleted: 'signup.completed',
  loginCompleted: 'login.completed',
  childCreated: 'child.created',
  storyStarted: 'story.started',
  storyAbandoned: 'story.abandoned',
  storyCompleted: 'story.completed',
  storybookGenerationStarted: 'storybook.generation_started',
  storybookArtReady: 'storybook.art_ready',
  checkoutStarted: 'checkout.started',
  checkoutAbandoned: 'checkout.abandoned',
  printOrderPlaced: 'print_order.placed',
  printOrderPaid: 'print_order.paid',

  // --- Generation reliability (wired now; fire once Sprint 2/3 ships) ---
  generationFailed: 'generation.failed',
  generationRetryAttempted: 'generation.retry_attempted',
  generationRetrySucceeded: 'generation.retry_succeeded',
  generationFellBackPartial: 'generation.fell_back_partial',
  generationDuration: 'generation.duration',

  // --- First-run onboarding (Sprint W2-B) ---
  onboardingStepCompleted: 'onboarding.step_completed',
  onboardingChecklistDismissed: 'onboarding.checklist_dismissed',
  onboardingFirstBookReady: 'onboarding.first_book_ready',
  onboardingTipShown: 'onboarding.tip_shown',

  // --- Kids telemetry (privacy-safe, content-free) ---
  kidsStepViewed: 'kids.step_viewed',
  kidsAnswerSelected: 'kids.answer_selected',
  kidsBeatProgressed: 'kids.beat_progressed',
  kidsStuck: 'kids.stuck',
  kidsAbandoned: 'kids.abandoned',
} as const;

export type AnalyticsEventName = (typeof ANALYTICS_EVENTS)[keyof typeof ANALYTICS_EVENTS];

/** Runtime list of valid event names (used to reject unknown events at the boundary). */
export const ANALYTICS_EVENT_NAMES: readonly AnalyticsEventName[] = Object.values(ANALYTICS_EVENTS);

export function isKnownEvent(name: string): name is AnalyticsEventName {
  return (ANALYTICS_EVENT_NAMES as readonly string[]).includes(name);
}

/**
 * Event properties are deliberately restricted to scalars. Props must be IDs, counts, enums or
 * sanitised codes — never free text, names, photos, URLs, or any child PII. The no-PII guard below
 * enforces this at runtime.
 */
export type AnalyticsProps = Record<string, string | number | boolean | null | undefined>;

// ---------------------------------------------------------------------------
// No-PII guard
// ---------------------------------------------------------------------------

/**
 * Substrings that, if present in a prop KEY, indicate the value may carry PII or free content.
 * Chosen so that legitimate id-style keys pass (storyTypeId, storybookId, sessionId, orderId,
 * childCount, pageCount, choiceIndex, utm_source, …) while content/PII keys are caught.
 */
const FORBIDDEN_KEY_SUBSTRINGS = [
  'name', 'email', 'photo', 'avatar', 'image', 'address', 'postcode', 'postalcode',
  'phone', 'prompt', 'message', 'content', 'body', 'text', 'title', 'description',
  'caption', 'dob', 'birth',
];

const EMAIL_RE = /[^\s@]+@[^\s@]+\.[^\s@]+/;
/** A value longer than this is treated as free text (potential content/PII). */
const MAX_VALUE_LENGTH = 200;

/**
 * Returns a human-readable description of the first PII-shaped violation found, or null if clean.
 * Pure and side-effect free so it is trivially unit-testable.
 */
export function findPiiViolation(props: AnalyticsProps): string | null {
  for (const [key, value] of Object.entries(props ?? {})) {
    const lowerKey = key.toLowerCase();
    const badKey = FORBIDDEN_KEY_SUBSTRINGS.find((s) => lowerKey.includes(s));
    if (badKey) {
      return `prop "${key}" matches forbidden key pattern "${badKey}"`;
    }
    if (typeof value === 'string') {
      if (value.length > MAX_VALUE_LENGTH) {
        return `prop "${key}" value is too long (${value.length} > ${MAX_VALUE_LENGTH}) — looks like free text`;
      }
      if (EMAIL_RE.test(value)) {
        return `prop "${key}" value looks like an email address`;
      }
      const v = value.trim().toLowerCase();
      if (v.startsWith('data:') || v.startsWith('http://') || v.startsWith('https://')) {
        return `prop "${key}" value looks like a URL`;
      }
    }
  }
  return null;
}
