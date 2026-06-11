/**
 * PostHog concordance hook (stub — analytics is dark behind the compliance gate).
 *
 * The probe names its funnel steps with the EXACT canonical event names from
 * src/lib/analytics/events.ts (the single source of truth the PostHog sink
 * uses). That identity is the concordance contract: when analytics is flipped
 * on, a probe run's synthetic funnel and the real-user PostHog funnel are
 * keyed by the same strings and can be compared step-for-step with no mapping
 * table.
 *
 * What "concordance" will mean once live: the probe stalls (hesitations, dead
 * ends, budget exhaustion) should line up with real-user drop-off between the
 * same two funnel steps. Agreement validates the probe; disagreement means
 * either the probe path is unrepresentative or real users hit friction the
 * probe doesn't model — both worth knowing.
 *
 * To light this up (after the Sprint-1 compliance gate clears):
 *  1. Implement `fetchRealFunnel()` against the PostHog funnels API
 *     (host: EU instance, project + personal API key via env:
 *     POSTHOG_API_HOST / POSTHOG_PROJECT_ID / POSTHOG_PERSONAL_API_KEY).
 *  2. Call `compareFunnels(probeFunnel, realFunnel)` from
 *     scripts/probe-report.mjs and append the result to the report.
 */
import { ANALYTICS_EVENTS } from '../../src/lib/analytics/events';
import type { FunnelStepResult } from './types';

/** The canonical activation funnel, in order, as the probe walks it. */
export const PROBE_FUNNEL_STEPS = [
  ANALYTICS_EVENTS.signupCompleted, // 'signup.completed'
  ANALYTICS_EVENTS.childCreated, // 'child.created'
  ANALYTICS_EVENTS.storyStarted, // 'story.started'
  ANALYTICS_EVENTS.storyCompleted, // 'story.completed' (deterministic seam)
  ANALYTICS_EVENTS.storybookGenerationStarted, // 'storybook.generation_started'
  ANALYTICS_EVENTS.storybookArtReady, // 'storybook.art_ready'
] as const;

export type ConcordanceResult =
  | { status: 'analytics-dark'; note: string }
  | {
      status: 'compared';
      steps: Array<{
        step: string;
        probeReached: boolean;
        realConversionRate: number | null;
        agrees: boolean;
      }>;
    };

/** Real-user funnel conversion per step, keyed by canonical event name. */
export type RealFunnel = Record<string, { conversionRate: number }>;

/** STUB until the compliance gate clears — see module docblock for wiring. */
export function fetchRealFunnel(): Promise<RealFunnel | null> {
  return Promise.resolve(null);
}

export function compareFunnels(
  probeFunnel: FunnelStepResult[],
  realFunnel: RealFunnel | null,
): ConcordanceResult {
  if (!realFunnel) {
    return {
      status: 'analytics-dark',
      note:
        'PostHog is not yet enabled (Sprint-1 compliance gate). Probe funnel steps already use ' +
        'the canonical ANALYTICS_EVENTS names, so this comparison activates without renaming ' +
        'anything once analytics is live.',
    };
  }
  return {
    status: 'compared',
    steps: probeFunnel.map((s) => {
      const real = realFunnel[s.step];
      return {
        step: s.step,
        probeReached: s.reached,
        realConversionRate: real ? real.conversionRate : null,
        // Heuristic v1: the probe failing a step "agrees" with real users
        // converting poorly (<50%) through it, and vice versa.
        agrees: real ? s.reached === real.conversionRate >= 0.5 : false,
      };
    }),
  };
}
