/**
 * Mechanical personas for the UX probe.
 *
 * These are scripted (deterministic), not LLM-driven: each persona is a set of
 * budgets and patience parameters applied to the same goal scripts. The POC
 * (docs/usability/UX-PROBE-FINDINGS-2026-06-05.md) used an LLM agent to FIND
 * the friction; the productionised probe replays that friction mechanically so
 * regressions are caught deterministically, run after run.
 *
 * Budget rationale (POC run summary): the impatient parent burned ~22 actions
 * without reaching a finished book. The optimal path is ~20 actions, so the
 * impatient budget is set just above optimal — any reintroduced friction
 * (missing affordance forcing a detour) busts the budget and fails the goal.
 */
import type { Persona } from './types';

export const EXPERT: Persona = {
  id: 'expert',
  name: 'Expert baseline',
  description:
    'Scripted optimal path with generous waits. Defines the denominator for persona scoring: steps and time a user who already knows the product needs.',
  budgets: { maxActions: 60, maxWallMs: 240_000 },
  actionTimeoutMs: 30_000,
  hesitationThresholdMs: 10_000,
  triesFallbacks: false,
};

export const IMPATIENT_PARENT: Persona = {
  id: 'impatient-parent',
  name: 'Impatient parent',
  description:
    'Takes the most prominent affordance, waits only a few seconds for anything, and abandons at the first dead end. Models the conversion-critical first session.',
  budgets: { maxActions: 26, maxWallMs: 120_000 },
  actionTimeoutMs: 7_000,
  hesitationThresholdMs: 3_000,
  triesFallbacks: false,
};

export const FIRST_TIME_PARENT: Persona = {
  id: 'first-time-parent',
  name: 'First-time parent',
  description:
    'Willing to explore: tries fallback affordances when the expected control is missing, tolerates slower responses. Detours show up as hesitations and a worse score, not an immediate fail.',
  budgets: { maxActions: 40, maxWallMs: 200_000 },
  actionTimeoutMs: 15_000,
  hesitationThresholdMs: 5_000,
  triesFallbacks: true,
};

export const RETURNING_CHILD: Persona = {
  id: 'returning-child',
  name: 'Returning child',
  description:
    'A child re-opening the kids PWA on a shared device to read an existing book. Short patience, tiny budget — the payoff must be a handful of taps away.',
  budgets: { maxActions: 10, maxWallMs: 90_000 },
  actionTimeoutMs: 8_000,
  hesitationThresholdMs: 3_000,
  triesFallbacks: false,
};

export const PARENT_PERSONAS: Persona[] = [IMPATIENT_PARENT, FIRST_TIME_PARENT];
