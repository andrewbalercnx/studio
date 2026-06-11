/**
 * Shared types for the mechanical UX probe (Sprint W2-A).
 *
 * The probe drives the real UI (Playwright + Firebase emulator + TEST_MODE AI
 * seam) with scripted "personas" under explicit budgets, records every step,
 * hesitation and dead end, scores runs against an expert baseline, and emits
 * findings as codable fix-records (the shape maps 1:1 onto a dev-todo).
 *
 * See docs/testing/probe.md for the methodology and
 * docs/usability/UX-PROBE-FINDINGS-2026-06-05.md for the POC this productionises.
 */

/** Canonical funnel step name — MUST be a value from ANALYTICS_EVENTS
 * (src/lib/analytics/events.ts) so probe funnels and real PostHog funnels are
 * directly comparable once analytics goes live (see concordance.ts). */
export type FunnelStepName = string;

export type ActionKind = 'goto' | 'click' | 'fill' | 'press' | 'expect';

export type ActionOutcome =
  /** Primary affordance worked first time. */
  | 'ok'
  /** Primary affordance failed; a fallback affordance was used (hesitation). */
  | 'fallback'
  /** Every candidate affordance failed (dead end). */
  | 'failed';

export type ProbeStep = {
  /** 1-based index across the goal run (perception 'expect' steps share the counter but don't consume action budget). */
  n: number;
  /** What the persona was trying to achieve, in user terms. */
  intent: string;
  kind: ActionKind;
  /** Human-readable description of the affordance acted on (role/name/text). */
  target: string;
  outcome: ActionOutcome;
  durationMs: number;
  /** Set when outcome=fallback: which candidate (1-based) finally worked. */
  candidateUsed?: number;
  note?: string;
};

export type Hesitation = {
  atStep: number;
  intent: string;
  reason: 'fallback-used' | 'slow-action';
  detail: string;
};

export type DeadEnd = {
  atStep: number;
  intent: string;
  /** Every affordance the persona tried before giving up. */
  attempted: string[];
};

export type FunnelStepResult = {
  step: FunnelStepName;
  reached: boolean;
  /** Action count consumed when the step was reached. */
  atAction?: number;
  elapsedMs?: number;
  /** True when the step was satisfied by the deterministic seam (e.g. the
   * seeded completed story replacing the live-AI wizard), not by UI actions. */
  simulated?: boolean;
};

export type FindingSeverity = 'high' | 'medium' | 'low';

/** A codable fix-record. Field set mirrors what /api/internal/dev-todos wants
 * (title/description/priority/category) so findings can be filed as dev todos
 * verbatim — the probe itself never calls that API. */
export type Finding = {
  /** Stable id: `<source>-<slug>` — used for baseline (known vs new) diffing. */
  id: string;
  severity: FindingSeverity;
  /** Page/feature where the friction sits, e.g. '/parent/children'. */
  surface: string;
  /** navigation | discoverability | labelling | feedback | content | regression | harness */
  category: string;
  summary: string;
  reproSteps: string[];
  suggestedFix: string;
  source: {
    kind: 'persona-run' | 'w1c-check';
    persona?: string;
    goal?: string;
    check?: string;
  };
};

export type GoalScore = {
  /** Budget-consuming actions taken (goto/click/fill/press). */
  actionsTaken: number;
  wallMs: number;
  success: boolean;
  failureReason?: string;
  /** Filled in by the report aggregator from the expert-baseline fragment. */
  optimalActions?: number;
  optimalWallMs?: number;
  actionRatio?: number;
};

/** One spec writes one fragment to probe-results/fragments/; the report
 * aggregator (scripts/probe-report.mjs) merges them into the run artifact. */
export type RunFragment = {
  schemaVersion: 1;
  runId: string;
  kind: 'expert-baseline' | 'persona-run' | 'w1c-check';
  /** Playwright project (viewport class) the fragment ran under. */
  project: string;
  persona?: string;
  goal?: string;
  /** W1C check id + PASS/FAIL verdict (w1c-check fragments only). */
  check?: string;
  checkTitle?: string;
  verdict?: 'PASS' | 'FAIL';
  startedAt: string;
  finishedAt: string;
  steps: ProbeStep[];
  funnel: FunnelStepResult[];
  hesitations: Hesitation[];
  deadEnds: DeadEnd[];
  findings: Finding[];
  score?: GoalScore;
};

export type PersonaBudgets = {
  /** Hard cap on budget-consuming actions per goal. */
  maxActions: number;
  /** Hard cap on wall-clock per goal. */
  maxWallMs: number;
};

export type Persona = {
  id: string;
  name: string;
  description: string;
  budgets: PersonaBudgets;
  /** Per-action locator timeout — how long this persona waits for an
   * affordance to respond before treating it as missing. */
  actionTimeoutMs: number;
  /** Actions slower than this are recorded as hesitation points. */
  hesitationThresholdMs: number;
  /** Whether the persona tries fallback affordances when the primary one is
   * missing (an impatient user abandons instead). */
  triesFallbacks: boolean;
};
