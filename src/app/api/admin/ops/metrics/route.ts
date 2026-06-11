import { NextRequest, NextResponse } from 'next/server';
import { initFirebaseAdminApp } from '@/firebase/admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { requireAdminUser } from '@/lib/server-auth';
import { AuthError } from '@/lib/auth-error';
import { getActiveUsers, getFunnel } from '@/lib/posthog-query.server';

export const dynamic = 'force-dynamic';

const GENERATION_WINDOW_HOURS = 24;
const ORDERS_WINDOW_DAYS = 30;

/**
 * GET /api/admin/ops/metrics
 *
 * Aggregated metrics for the ops/KPI dashboard (/admin/ops). Admin only.
 *
 * Data sources, by design:
 *  - User behaviour (DAU/WAU/MAU, funnel): PostHog's query API via the cached server module
 *    src/lib/posthog-query.server.ts — NOT Firestore scans. While PostHog is dark behind the
 *    compliance gate these sections return `available: false` and the dashboard shows an
 *    honest "analytics not yet enabled" state per widget.
 *  - Operational metrics (generation error rate from aiFlowLogs, print-order pipeline from
 *    printOrders): bounded, indexed Firestore queries (recent window + limit) — never
 *    unbounded scans.
 *  - Health: last stored health-check run from systemConfig/opsHealth.
 */
export async function GET(request: NextRequest) {
  try {
    await requireAdminUser(request);

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

    // --- PostHog-backed user behaviour metrics (cached server module) ---
    const [activeUsers, funnel] = await Promise.all([getActiveUsers(), getFunnel(30)]);

    // --- Generation error rate (operational: aiFlowLogs, bounded recent window) ---
    const generationWindowStart = new Date(nowMs - GENERATION_WINDOW_HOURS * 60 * 60 * 1000);
    const logsSnap = await firestore
      .collection('aiFlowLogs')
      .where('createdAt', '>=', generationWindowStart)
      .limit(1000)
      .get();

    let generationTotal = 0;
    let generationErrors = 0;
    const errorsByFlow = new Map<string, { count: number; lastMessage: string }>();
    for (const doc of logsSnap.docs) {
      const log = doc.data();
      generationTotal += 1;
      if (log.status === 'error' || log.status === 'failure') {
        generationErrors += 1;
        const flowName = log.flowName ?? 'unknown';
        const entry = errorsByFlow.get(flowName) ?? { count: 0, lastMessage: '' };
        entry.count += 1;
        entry.lastMessage = (log.errorMessage || log.failureReason || entry.lastMessage || '').slice(0, 200);
        errorsByFlow.set(flowName, entry);
      }
    }
    const topErrorFlows = [...errorsByFlow.entries()]
      .sort((a, b) => b[1].count - a[1].count)
      .slice(0, 5)
      .map(([flowName, e]) => ({ flowName, count: e.count, lastMessage: e.lastMessage }));

    // --- Print-order pipeline + conversion (operational: printOrders, bounded window) ---
    const ordersWindowStart = new Date(nowMs - ORDERS_WINDOW_DAYS * 24 * 60 * 60 * 1000);
    const ordersSnap = await firestore
      .collection('printOrders')
      .where('createdAt', '>=', ordersWindowStart)
      .limit(500)
      .get();

    const byStatus: Record<string, number> = {};
    let placed = 0;
    let paid = 0;
    let submittedOrBeyond = 0;
    let shippedOrDelivered = 0;
    let needingAttention = 0;
    let unreviewedOver24h = 0;
    const submittedStates = ['submitted', 'confirmed', 'in_production', 'shipped', 'delivered'];
    const attentionStates = ['awaiting_approval', 'ready_to_submit', 'approved', 'submitted', 'on_hold', 'validation_failed', 'failed'];
    const dayAgoMs = nowMs - 24 * 60 * 60 * 1000;

    for (const doc of ordersSnap.docs) {
      const order = doc.data();
      if (order.regressionTest === true) continue;
      const status = (order.fulfillmentStatus ?? 'unknown') as string;
      byStatus[status] = (byStatus[status] ?? 0) + 1;
      placed += 1;
      if (order.paymentStatus === 'paid') paid += 1;
      if (submittedStates.includes(status)) submittedOrBeyond += 1;
      if (status === 'shipped' || status === 'delivered') shippedOrDelivered += 1;
      if (attentionStates.includes(status)) needingAttention += 1;
      if (
        (status === 'awaiting_approval' || status === 'ready_to_submit') &&
        (toMs(order.createdAt) ?? nowMs) < dayAgoMs
      ) {
        unreviewedOver24h += 1;
      }
    }

    // --- Last health-check run (written by /api/admin/ops/health-check) ---
    const healthSnap = await firestore.doc('systemConfig/opsHealth').get();
    const healthData = healthSnap.exists ? (healthSnap.data() as any) : null;

    return NextResponse.json({
      ok: true,
      generatedAt: new Date(nowMs).toISOString(),
      analytics: {
        source: 'posthog',
        activeUsers,
        funnel,
      },
      generation: {
        source: 'firestore:aiFlowLogs',
        windowHours: GENERATION_WINDOW_HOURS,
        total: generationTotal,
        errors: generationErrors,
        errorRate: generationTotal > 0 ? generationErrors / generationTotal : 0,
        sampleLimitReached: logsSnap.size >= 1000,
        topErrorFlows,
      },
      printOrders: {
        source: 'firestore:printOrders',
        windowDays: ORDERS_WINDOW_DAYS,
        placed,
        paid,
        submittedOrBeyond,
        shippedOrDelivered,
        needingAttention,
        unreviewedOver24h,
        byStatus,
        conversion: {
          placedToSubmitted: placed > 0 ? submittedOrBeyond / placed : null,
          placedToShipped: placed > 0 ? shippedOrDelivered / placed : null,
        },
      },
      health: healthData
        ? {
            lastRunAtMs: toMs(healthData.lastRunAt),
            results: healthData.lastResults ?? [],
            thresholds: healthData.thresholds ?? null,
          }
        : null,
    });
  } catch (error: any) {
    if (error instanceof AuthError) {
      return NextResponse.json({ ok: false, errorMessage: error.message }, { status: error.status });
    }
    console.error('[ops/metrics] Error building metrics:', error);
    return NextResponse.json(
      { ok: false, errorMessage: error?.message ?? 'Failed to build metrics' },
      { status: 500 }
    );
  }
}
