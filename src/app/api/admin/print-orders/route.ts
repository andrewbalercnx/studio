import { NextRequest, NextResponse } from 'next/server';
import { initFirebaseAdminApp } from '@/firebase/admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { requireParentOrAdminUser } from '@/lib/server-auth';
import type { PrintOrder } from '@/lib/types';

/**
 * GET /api/admin/print-orders
 * Lists print orders with optional filtering
 */
export async function GET(request: NextRequest) {
  try {
    const user = await requireParentOrAdminUser(request);

    if (!user.claims.isAdmin) {
      return NextResponse.json(
        { ok: false, errorMessage: 'Admin access required' },
        { status: 403 }
      );
    }

    await initFirebaseAdminApp();
    const firestore = getFirestore();

    // Get filter from query params
    const { searchParams } = new URL(request.url);
    const filter = searchParams.get('filter') || 'all';

    // Note: When using 'in' with orderBy, Firestore requires a composite index.
    // For simplicity, we fetch all and filter in code, or use simpler queries.
    let query: FirebaseFirestore.Query = firestore.collection('printOrders');

    // Apply status filters - use awaiting_approval (the correct status value)
    if (filter === 'pending') {
      query = query.where('fulfillmentStatus', 'in', ['awaiting_approval', 'ready_to_submit']);
    } else if (filter === 'approved') {
      query = query.where('fulfillmentStatus', '==', 'approved');
    } else if (filter === 'submitted') {
      query = query.where('fulfillmentStatus', 'in', [
        'submitted',
        'confirmed',
        'in_production',
        'shipped',
        'delivered',
      ]);
    }

    const snapshot = await query.limit(100).get();

    // Helper to convert Firestore Timestamp to serializable format
    const convertTimestamp = (timestamp: any): { _seconds: number; _nanoseconds: number } | null => {
      if (!timestamp) return null;
      // Firebase Admin SDK Timestamp with toDate() method - check this first
      // The Admin SDK Timestamp has seconds/nanoseconds as getters, not enumerable properties
      if (timestamp.toDate && typeof timestamp.toDate === 'function') {
        const date = timestamp.toDate() as Date;
        return {
          _seconds: Math.floor(date.getTime() / 1000),
          _nanoseconds: (date.getTime() % 1000) * 1000000,
        };
      }
      // Firebase Admin SDK Timestamp has _seconds/_nanoseconds properties
      if (timestamp._seconds !== undefined) {
        return {
          _seconds: timestamp._seconds,
          _nanoseconds: timestamp._nanoseconds ?? 0,
        };
      }
      // Alternative format with seconds/nanoseconds (e.g., from JSON serialization)
      if (timestamp.seconds !== undefined) {
        return {
          _seconds: timestamp.seconds,
          _nanoseconds: timestamp.nanoseconds ?? 0,
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

    const orders: PrintOrder[] = [];
    snapshot.forEach((doc) => {
      const data = doc.data();
      orders.push({
        id: doc.id,
        ...data,
        // Ensure timestamps are properly serializable
        createdAt: convertTimestamp(data.createdAt),
        updatedAt: convertTimestamp(data.updatedAt),
        statusHistory: convertStatusHistory(data.statusHistory),
      } as PrintOrder);
    });

    // Sort by createdAt descending in JS (to avoid composite index requirements)
    orders.sort((a, b) => {
      const aTime = (a.createdAt as any)?._seconds || 0;
      const bTime = (b.createdAt as any)?._seconds || 0;
      return bTime - aTime;
    });

    return NextResponse.json({ ok: true, orders });
  } catch (error: any) {
    console.error('[print-orders] Error listing orders:', error);
    return NextResponse.json(
      { ok: false, error: error.message },
      { status: 500 }
    );
  }
}
