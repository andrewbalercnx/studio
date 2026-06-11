/**
 * Operational health-check logic (pure).
 *
 * The evaluators in this file take plain data (already fetched via bounded Firestore queries in
 * /api/admin/ops/health-check) and decide whether a check has breached its threshold. Keeping
 * them pure makes thresholds and dedup behaviour unit-testable without Firestore.
 *
 * Thresholds live in `systemConfig/opsHealth` (admin-editable, follows the systemConfig
 * pattern); `lastAlertedAt` per check is recorded on the same doc so a persistent breach
 * doesn't spam maintenance email — see {@link shouldAlert}.
 */

export type OpsHealthThresholds = {
  /** Art generation stuck if running/rate_limited for more than this many hours. */
  artPendingHours: number;
  /** Orders awaiting approval older than this many hours are "un-reviewed". */
  ordersUnreviewedHours: number;
  /** Window (minutes) over which the generation error rate is computed. */
  errorRateWindowMinutes: number;
  /** Error rate (0..1) above which the error-rate check breaches. */
  errorRateThreshold: number;
  /** Minimum number of flow runs in the window before the error rate is meaningful. */
  errorRateMinSamples: number;
  /** Hours to wait before re-alerting on a still-breached check. */
  alertCooldownHours: number;
};

export const DEFAULT_OPS_HEALTH_THRESHOLDS: OpsHealthThresholds = {
  artPendingHours: 4,
  ordersUnreviewedHours: 24,
  errorRateWindowMinutes: 60,
  errorRateThreshold: 0.3,
  errorRateMinSamples: 5,
  alertCooldownHours: 6,
};

export type HealthCheckId = 'art_pending' | 'orders_unreviewed' | 'error_rate_spike';

export const HEALTH_CHECK_IDS: readonly HealthCheckId[] = [
  'art_pending',
  'orders_unreviewed',
  'error_rate_spike',
];

export type HealthCheckResult = {
  id: HealthCheckId;
  breached: boolean;
  /** One-line human summary (used in the alert email and the ops dashboard). */
  summary: string;
  /** Structured details for the dashboard (counts, offending IDs — bounded). */
  details?: Record<string, unknown>;
};

/** Merge a partial systemConfig/opsHealth thresholds object over the defaults. */
export function resolveThresholds(partial?: Partial<OpsHealthThresholds> | null): OpsHealthThresholds {
  const merged = { ...DEFAULT_OPS_HEALTH_THRESHOLDS, ...(partial ?? {}) };
  // Guard against nonsensical config values (zero/negative would alert constantly or never).
  const positive = (n: unknown, fallback: number) =>
    typeof n === 'number' && Number.isFinite(n) && n > 0 ? n : fallback;
  return {
    artPendingHours: positive(merged.artPendingHours, DEFAULT_OPS_HEALTH_THRESHOLDS.artPendingHours),
    ordersUnreviewedHours: positive(
      merged.ordersUnreviewedHours,
      DEFAULT_OPS_HEALTH_THRESHOLDS.ordersUnreviewedHours
    ),
    errorRateWindowMinutes: positive(
      merged.errorRateWindowMinutes,
      DEFAULT_OPS_HEALTH_THRESHOLDS.errorRateWindowMinutes
    ),
    errorRateThreshold:
      typeof merged.errorRateThreshold === 'number' &&
      merged.errorRateThreshold > 0 &&
      merged.errorRateThreshold <= 1
        ? merged.errorRateThreshold
        : DEFAULT_OPS_HEALTH_THRESHOLDS.errorRateThreshold,
    errorRateMinSamples: positive(
      merged.errorRateMinSamples,
      DEFAULT_OPS_HEALTH_THRESHOLDS.errorRateMinSamples
    ),
    alertCooldownHours: positive(merged.alertCooldownHours, DEFAULT_OPS_HEALTH_THRESHOLDS.alertCooldownHours),
  };
}

// ---------------------------------------------------------------------------
// Check 1: art generation pending too long
// ---------------------------------------------------------------------------

export type ArtPendingCandidate = {
  /** storybook path or id, for the alert details. */
  id: string;
  /** imageGeneration.status of the storybook. */
  status: string;
  /** imageGeneration.lastRunAt (ms epoch) — null when never run. */
  lastRunAtMs: number | null;
};

const STUCK_ART_STATUSES = ['running', 'pending', 'rate_limited'];

export function evaluateArtPending(
  candidates: ArtPendingCandidate[],
  nowMs: number,
  thresholds: OpsHealthThresholds
): HealthCheckResult {
  const cutoff = nowMs - thresholds.artPendingHours * 60 * 60 * 1000;
  const stuck = candidates.filter(
    (c) =>
      STUCK_ART_STATUSES.includes((c.status || '').toLowerCase()) &&
      c.lastRunAtMs !== null &&
      c.lastRunAtMs < cutoff
  );

  if (stuck.length === 0) {
    return {
      id: 'art_pending',
      breached: false,
      summary: `No storybooks with art pending > ${thresholds.artPendingHours}h`,
    };
  }

  return {
    id: 'art_pending',
    breached: true,
    summary: `${stuck.length} storybook(s) with art generation pending > ${thresholds.artPendingHours}h`,
    details: {
      count: stuck.length,
      storybookIds: stuck.slice(0, 10).map((s) => s.id),
      thresholdHours: thresholds.artPendingHours,
    },
  };
}

// ---------------------------------------------------------------------------
// Check 2: print orders un-reviewed too long
// ---------------------------------------------------------------------------

export type UnreviewedOrderCandidate = {
  id: string;
  /** createdAt (ms epoch) — null when unknown (treated as NOT overdue: no evidence of age). */
  createdAtMs: number | null;
};

export function evaluateUnreviewedOrders(
  ordersAwaitingApproval: UnreviewedOrderCandidate[],
  nowMs: number,
  thresholds: OpsHealthThresholds
): HealthCheckResult {
  const cutoff = nowMs - thresholds.ordersUnreviewedHours * 60 * 60 * 1000;
  const overdue = ordersAwaitingApproval.filter((o) => o.createdAtMs !== null && o.createdAtMs < cutoff);

  if (overdue.length === 0) {
    return {
      id: 'orders_unreviewed',
      breached: false,
      summary: `No print orders un-reviewed > ${thresholds.ordersUnreviewedHours}h`,
    };
  }

  return {
    id: 'orders_unreviewed',
    breached: true,
    summary: `${overdue.length} print order(s) awaiting approval for > ${thresholds.ordersUnreviewedHours}h`,
    details: {
      count: overdue.length,
      orderIds: overdue.slice(0, 10).map((o) => o.id),
      thresholdHours: thresholds.ordersUnreviewedHours,
    },
  };
}

// ---------------------------------------------------------------------------
// Check 3: generation error-rate spike
// ---------------------------------------------------------------------------

export type FlowLogSample = {
  /** aiFlowLogs.status — 'success' | 'error' | 'failure'. */
  status: string;
};

export function evaluateErrorRate(
  recentLogs: FlowLogSample[],
  thresholds: OpsHealthThresholds
): HealthCheckResult {
  const total = recentLogs.length;
  const errors = recentLogs.filter((l) => l.status === 'error' || l.status === 'failure').length;
  const rate = total > 0 ? errors / total : 0;
  const ratePct = Math.round(rate * 100);

  // Below the sample floor the rate is noise (1 error out of 2 runs is not a spike).
  if (total < thresholds.errorRateMinSamples) {
    return {
      id: 'error_rate_spike',
      breached: false,
      summary: `Only ${total} generation run(s) in the last ${thresholds.errorRateWindowMinutes}m (min ${thresholds.errorRateMinSamples} for spike detection)`,
      details: { total, errors, rate },
    };
  }

  if (rate <= thresholds.errorRateThreshold) {
    return {
      id: 'error_rate_spike',
      breached: false,
      summary: `Generation error rate ${ratePct}% over last ${thresholds.errorRateWindowMinutes}m (${errors}/${total})`,
      details: { total, errors, rate },
    };
  }

  return {
    id: 'error_rate_spike',
    breached: true,
    summary: `Generation error rate ${ratePct}% over last ${thresholds.errorRateWindowMinutes}m (${errors}/${total}, threshold ${Math.round(
      thresholds.errorRateThreshold * 100
    )}%)`,
    details: { total, errors, rate, threshold: thresholds.errorRateThreshold },
  };
}

// ---------------------------------------------------------------------------
// Alert dedup
// ---------------------------------------------------------------------------

/**
 * Decide whether a breached check should fire a maintenance alert now.
 * Returns true when the check has never alerted, or when the cooldown has elapsed since the
 * last alert. A persistent condition therefore alerts once per cooldown window, not per run.
 */
export function shouldAlert(
  lastAlertedAtMs: number | null | undefined,
  nowMs: number,
  cooldownHours: number
): boolean {
  if (lastAlertedAtMs === null || lastAlertedAtMs === undefined) return true;
  return nowMs - lastAlertedAtMs >= cooldownHours * 60 * 60 * 1000;
}
