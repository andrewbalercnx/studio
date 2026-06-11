import { NextRequest, NextResponse } from 'next/server';
import { initFirebaseAdminApp } from '@/firebase/admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { requireAdminUser } from '@/lib/server-auth';
import { AuthError } from '@/lib/auth-error';
import { isInternalSecretValid } from '@/lib/internal-secret';
import { notifyMaintenanceError } from '@/lib/email/notify-admins';
import {
  resolveThresholds,
  evaluateArtPending,
  evaluateUnreviewedOrders,
  evaluateErrorRate,
  shouldAlert,
  type ArtPendingCandidate,
  type HealthCheckResult,
} from '@/lib/ops/health-checks';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * POST /api/admin/ops/health-check
 *
 * Runs the operational health checks:
 *  - art_pending: storybook art generation running/rate-limited for > N hours
 *  - orders_unreviewed: print orders awaiting approval for > N hours
 *  - error_rate_spike: AI generation error rate over a recent window above threshold
 *
 * Thresholds live in `systemConfig/opsHealth.thresholds` (defaults in
 * src/lib/ops/health-checks.ts). On breach, fires notifyMaintenanceError — deduped via
 * `lastAlertedAt.<checkId>` on the same doc so a persistent condition alerts once per cooldown
 * window, not on every run.
 *
 * Auth: admin bearer token (run from the ops dashboard) OR X-Internal-Secret header (run from
 * the daily system test / a cron).
 *
 * Query params: ?dryRun=1 evaluates the checks but sends no alerts and persists nothing
 * (used by the regression suite).
 *
 * All Firestore reads are bounded (recent-window + limit); no collection-group scans.
 */
export async function POST(request: NextRequest) {
  // --- Auth: internal secret (cron) or admin user ---
  const secret = request.headers.get('X-Internal-Secret');
  let triggeredBy = 'internal';
  if (!isInternalSecretValid(secret, process.env.INTERNAL_API_SECRET)) {
    try {
      const user = await requireAdminUser(request);
      triggeredBy = user.uid;
    } catch (error: any) {
      if (error instanceof AuthError) {
        return NextResponse.json({ ok: false, errorMessage: error.message }, { status: error.status });
      }
      return NextResponse.json({ ok: false, errorMessage: 'Unauthorized' }, { status: 401 });
    }
  }

  const dryRun = new URL(request.url).searchParams.get('dryRun') === '1';

  try {
    await initFirebaseAdminApp();
    const firestore = getFirestore();
    const nowMs = Date.now();

    const toMs = (timestamp: any): number | null => {
      if (!timestamp) return null;
      if (typeof timestamp.toMillis === 'function') return timestamp.toMillis();
      if (typeof timestamp.toDate === 'function') return timestamp.toDate().getTime();
      if (timestamp._seconds !== undefined) return timestamp._seconds * 1000;
      if (timestamp.seconds !== undefined) return timestamp.seconds * 1000;
      const date = new Date(timestamp);
      return isNaN(date.getTime()) ? null : date.getTime();
    };

    // --- Load config (thresholds + per-check lastAlertedAt) ---
    const configRef = firestore.doc('systemConfig/opsHealth');
    const configSnap = await configRef.get();
    const configData = configSnap.exists ? (configSnap.data() as any) : {};
    const thresholds = resolveThresholds(configData?.thresholds);
    const lastAlertedAt: Record<string, any> = configData?.lastAlertedAt ?? {};

    // --- Gather data with bounded queries ---

    // 1. Art pending: storybooks of the 50 most recently updated stories. We deliberately avoid
    //    collection-group queries (no collection-group indexes are deployed for this project);
    //    a stuck generation always sits on a recently-updated story at current volumes.
    const storiesSnap = await firestore
      .collection('stories')
      .orderBy('updatedAt', 'desc')
      .limit(50)
      .get();

    const artCandidates: ArtPendingCandidate[] = [];
    const storybookSnaps = await Promise.all(
      storiesSnap.docs
        .filter((doc) => doc.data().regressionTest !== true)
        .map((doc) => doc.ref.collection('storybooks').limit(10).get())
    );
    for (const snap of storybookSnaps) {
      for (const sbDoc of snap.docs) {
        const sb = sbDoc.data();
        if (sb.regressionTest === true) continue;
        const gen = sb.imageGeneration ?? {};
        artCandidates.push({
          id: sbDoc.ref.path,
          status: gen.status ?? 'idle',
          lastRunAtMs: toMs(gen.lastRunAt) ?? toMs(sb.updatedAt),
        });
      }
    }

    // 2. Orders un-reviewed: bounded query on the awaiting-approval states.
    const ordersSnap = await firestore
      .collection('printOrders')
      .where('fulfillmentStatus', 'in', ['awaiting_approval', 'ready_to_submit'])
      .limit(200)
      .get();
    const orderCandidates = ordersSnap.docs
      .filter((doc) => doc.data().regressionTest !== true)
      .map((doc) => ({ id: doc.id, createdAtMs: toMs(doc.data().createdAt) }));

    // 3. Error-rate spike: recent aiFlowLogs window.
    const windowStart = new Date(nowMs - thresholds.errorRateWindowMinutes * 60 * 1000);
    const logsSnap = await firestore
      .collection('aiFlowLogs')
      .where('createdAt', '>=', windowStart)
      .limit(1000)
      .get();
    const logSamples = logsSnap.docs.map((doc) => ({ status: doc.data().status ?? 'success' }));

    // --- Evaluate ---
    const results: HealthCheckResult[] = [
      evaluateArtPending(artCandidates, nowMs, thresholds),
      evaluateUnreviewedOrders(orderCandidates, nowMs, thresholds),
      evaluateErrorRate(logSamples, thresholds),
    ];

    // --- Alert on breaches (deduped per check via lastAlertedAt + cooldown) ---
    const alertsSent: string[] = [];
    const lastAlertedUpdates: Record<string, number> = {};
    for (const result of results) {
      if (dryRun) break;
      if (!result.breached) continue;
      const lastMs = toMs(lastAlertedAt[result.id]);
      if (!shouldAlert(lastMs, nowMs, thresholds.alertCooldownHours)) continue;

      try {
        await notifyMaintenanceError(firestore, {
          flowName: 'opsHealthCheck',
          errorType: result.id,
          errorMessage: result.summary,
          pagePath: '/admin/ops',
          diagnostics: result.details,
          timestamp: new Date(nowMs),
        });
        alertsSent.push(result.id);
        lastAlertedUpdates[result.id] = nowMs;
      } catch (emailError: any) {
        console.error(`[ops/health-check] Failed to send alert for ${result.id}:`, emailError?.message);
      }
    }

    // --- Persist run state for the ops dashboard (skipped on dry runs) ---
    if (!dryRun) await configRef.set(
      {
        thresholds, // write resolved thresholds so the doc is self-documenting/editable
        lastRunAt: FieldValue.serverTimestamp(),
        lastRunBy: triggeredBy,
        lastResults: results,
        ...(Object.keys(lastAlertedUpdates).length > 0
          ? {
              lastAlertedAt: {
                ...Object.fromEntries(
                  Object.entries(lastAlertedAt).map(([k, v]) => [k, toMs(v)])
                ),
                ...lastAlertedUpdates,
              },
            }
          : {}),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    const anyBreached = results.some((r) => r.breached);
    return NextResponse.json({
      ok: true,
      healthy: !anyBreached,
      dryRun,
      results,
      alertsSent,
      thresholds,
      checkedAt: new Date(nowMs).toISOString(),
    });
  } catch (error: any) {
    console.error('[ops/health-check] Error running health checks:', error);
    return NextResponse.json(
      { ok: false, errorMessage: error?.message ?? 'Health check failed' },
      { status: 500 }
    );
  }
}
