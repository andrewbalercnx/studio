'use server';

import { NextResponse } from 'next/server';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { initFirebaseAdminApp } from '@/firebase/admin/app';
import { requireParentOrAdminUser } from '@/lib/server-auth';
import { AuthError } from '@/lib/auth-error';

function respondError(status: number, message: string) {
  return NextResponse.json({ ok: false, errorMessage: message }, { status });
}

export async function POST(request: Request, context: { params: Promise<{ orderId: string }> }) {
  try {
    await initFirebaseAdminApp();
    const { orderId } = await context.params;
    if (!orderId) {
      return respondError(400, 'Missing orderId');
    }
    const user = await requireParentOrAdminUser(request);
    const firestore = getFirestore();
    const orderRef = firestore.collection('printOrders').doc(orderId);
    const orderSnap = await orderRef.get();
    if (!orderSnap.exists) {
      return respondError(404, 'Order not found');
    }
    const orderData = orderSnap.data() as Record<string, any>;
    const parentUid = orderData?.parentUid;
    const isPrivileged = user.claims.isAdmin || user.claims.isWriter;
    if (!isPrivileged && parentUid && parentUid !== user.uid) {
      return respondError(403, 'You do not own this order.');
    }

    await orderRef.update({
      paymentStatus: 'paid',
      paymentMarkedAt: FieldValue.serverTimestamp(),
      paymentMarkedBy: user.uid,
      updatedAt: FieldValue.serverTimestamp(),
    });

    if (orderData.bookId) {
      await firestore
        .collection('storyBooks')
        .doc(orderData.bookId)
        .update({
          'storybookFinalization.status': 'ordered',
          'storybookFinalization.lastOrderId': orderId,
        })
        .catch(() => undefined);
    }

    if (orderData.bookId && orderData.storySessionId) {
      await firestore
        .collection('storySessions')
        .doc(orderData.storySessionId)
        .collection('events')
        .add({
          event: 'print_order.payment_marked',
          status: 'completed',
          source: 'server',
          attributes: {
            orderId,
            bookId: orderData.bookId,
          },
          createdAt: FieldValue.serverTimestamp(),
        })
        .catch(() => undefined);
    }

    return NextResponse.json({ ok: true, orderId });
  } catch (error: any) {
    if (error instanceof AuthError) {
      return respondError(error.status, error.message);
    }
    console.error('[printOrders/pay] error', error);
    return respondError(500, error?.message ?? 'Unexpected payment error');
  }
}
