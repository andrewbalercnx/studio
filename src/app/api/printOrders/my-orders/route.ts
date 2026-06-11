import { NextRequest, NextResponse } from 'next/server';
import { initFirebaseAdminApp } from '@/firebase/admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { requireParentOrAdminUser } from '@/lib/server-auth';
import { AuthError } from '@/lib/auth-error';
import {
  deriveOrderTimeline,
  deriveOrderStatusCategory,
  formatEstimatedTurnaround,
} from '@/lib/order-timeline';
import { getOrderTransparencyConfig } from '@/lib/order-transparency-config.server';
import type { PrintOrder } from '@/lib/types';

function toIso(value: any): string | null {
  if (!value) return null;
  if (typeof value.toDate === 'function') return value.toDate().toISOString();
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string') return value;
  return null;
}

/**
 * GET /api/printOrders/my-orders
 *
 * Lists print orders for the current user with server-derived presentation
 * fields (Sprint W3-C, server-first principle):
 * - `timeline`: parent-facing progress (placed → review → sent to printer →
 *   printing → shipped) derived from fulfillmentStatus — clients only render it
 * - `statusCategory`: filter bucket (pending/in_progress/completed/cancelled)
 * - `createdAtIso`/`updatedAtIso`/`rejectedAtIso`: serialised timestamps
 * - top-level `estimatedTurnaround`: honest estimate from systemConfig
 *
 * Orders are matched on both `parentUid` (set by POST /api/printOrders/mixam)
 * and the legacy `ownerUserId` field, then merged and sorted newest-first.
 */
export async function GET(request: NextRequest) {
  try {
    const user = await requireParentOrAdminUser(request);

    await initFirebaseAdminApp();
    const firestore = getFirestore();

    // Equality-only queries (no orderBy) avoid composite-index requirements;
    // sorting happens below.
    const [byParentUid, byOwnerUserId] = await Promise.all([
      firestore.collection('printOrders').where('parentUid', '==', user.uid).limit(100).get(),
      firestore.collection('printOrders').where('ownerUserId', '==', user.uid).limit(100).get(),
    ]);

    const byId = new Map<string, PrintOrder>();
    for (const doc of [...byParentUid.docs, ...byOwnerUserId.docs]) {
      if (!byId.has(doc.id)) {
        byId.set(doc.id, { id: doc.id, ...doc.data() } as PrintOrder);
      }
    }

    const config = await getOrderTransparencyConfig();
    const estimatedTurnaround = formatEstimatedTurnaround(
      config.turnaroundMinBusinessDays,
      config.turnaroundMaxBusinessDays
    );

    const orders = [...byId.values()]
      .map((order) => {
        const createdAtIso = toIso(order.createdAt);
        return {
          ...order,
          createdAtIso,
          updatedAtIso: toIso(order.updatedAt),
          rejectedAtIso: toIso(order.rejectedAt),
          statusCategory: deriveOrderStatusCategory(order.fulfillmentStatus),
          timeline: deriveOrderTimeline({
            fulfillmentStatus: order.fulfillmentStatus,
            createdAtIso,
            statusHistory: order.statusHistory ?? null,
          }),
        };
      })
      .sort((a, b) => (b.createdAtIso ?? '').localeCompare(a.createdAtIso ?? ''));

    return NextResponse.json({ ok: true, orders, estimatedTurnaround });
  } catch (error: any) {
    if (error instanceof AuthError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    }
    console.error('[my-orders] Error listing orders:', error);
    return NextResponse.json(
      { ok: false, error: error.message },
      { status: 500 }
    );
  }
}
