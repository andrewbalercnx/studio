import { NextRequest, NextResponse } from 'next/server';
import { initFirebaseAdminApp } from '@/firebase/admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { requireParentOrAdminUser } from '@/lib/server-auth';
import type { PrintOrder } from '@/lib/types';

/**
 * GET /api/admin/print-orders/[orderId]
 * Gets a single print order by ID
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ orderId: string }> }
) {
  try {
    const { orderId } = await params;
    const user = await requireParentOrAdminUser(request);

    if (!user.claims.isAdmin) {
      return NextResponse.json(
        { ok: false, errorMessage: 'Admin access required' },
        { status: 403 }
      );
    }

    await initFirebaseAdminApp();
    const firestore = getFirestore();

    const orderDoc = await firestore.collection('printOrders').doc(orderId).get();

    if (!orderDoc.exists) {
      return NextResponse.json(
        { ok: false, error: 'Order not found' },
        { status: 404 }
      );
    }

    // Helper to convert Firestore Timestamp to serializable format
    const convertTimestamp = (timestamp: any): { _seconds: number; _nanoseconds: number } | null => {
      if (!timestamp) return null;
      // Firebase Admin SDK Timestamp has toDate() method and _seconds/_nanoseconds properties
      if (timestamp._seconds !== undefined) {
        return {
          _seconds: timestamp._seconds,
          _nanoseconds: timestamp._nanoseconds ?? 0,
        };
      }
      // Alternative format with seconds/nanoseconds
      if (timestamp.seconds !== undefined) {
        return {
          _seconds: timestamp.seconds,
          _nanoseconds: timestamp.nanoseconds ?? 0,
        };
      }
      // Firebase Admin SDK Timestamp with toMillis() method
      if (timestamp.toMillis && typeof timestamp.toMillis === 'function') {
        return {
          _seconds: Math.floor(timestamp.toMillis() / 1000),
          _nanoseconds: (timestamp.toMillis() % 1000) * 1000000,
        };
      }
      // ISO string format
      if (typeof timestamp === 'string') {
        const date = new Date(timestamp);
        if (!isNaN(date.getTime())) {
          return {
            _seconds: Math.floor(date.getTime() / 1000),
            _nanoseconds: 0,
          };
        }
      }
      return null;
    };

    // Convert status history timestamps if present
    const convertStatusHistory = (history: any[]): any[] => {
      if (!history || !Array.isArray(history)) return [];
      return history.map((entry) => ({
        ...entry,
        timestamp: convertTimestamp(entry.timestamp),
      }));
    };

    const data = orderDoc.data()!;
    const order: PrintOrder = {
      id: orderDoc.id,
      ...data,
      // Ensure timestamps are properly serializable
      createdAt: convertTimestamp(data.createdAt),
      updatedAt: convertTimestamp(data.updatedAt),
      statusHistory: convertStatusHistory(data.statusHistory),
    } as PrintOrder;

    return NextResponse.json({ ok: true, order });
  } catch (error: any) {
    console.error('[print-orders] Error fetching order:', error);
    return NextResponse.json(
      { ok: false, error: error.message },
      { status: 500 }
    );
  }
}
