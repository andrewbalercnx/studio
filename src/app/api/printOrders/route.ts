
'use server';

import { NextResponse } from 'next/server';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { initFirebaseAdminApp } from '@/firebase/admin/app';
import { requireParentOrAdminUser } from '@/lib/server-auth';
import { AuthError } from '@/lib/auth-error';

type CreateOrderRequest = {
  bookId: string;
  quantity: number;
  shippingAddress: {
    name: string;
    line1: string;
    line2?: string | null;
    city: string;
    state: string;
    postalCode: string;
    country: string;
  };
  contactEmail: string;
  regressionTag?: string;
};

function respondError(status: number, message: string) {
  return NextResponse.json({ ok: false, errorMessage: message }, { status });
}

function validateAddress(address: CreateOrderRequest['shippingAddress']) {
  const required = ['name', 'line1', 'city', 'state', 'postalCode', 'country'] as const;
  for (const field of required) {
    if (!address?.[field] || typeof address[field] !== 'string') {
      return false;
    }
  }
  return true;
}

export async function POST(request: Request) {
  try {
    await initFirebaseAdminApp();
    const body = (await request.json()) as CreateOrderRequest;
    const { bookId, quantity, shippingAddress, contactEmail, regressionTag } = body;
    if (!bookId) {
      return respondError(400, 'Missing bookId');
    }
    if (!quantity || quantity < 1) {
      return respondError(400, 'Quantity must be at least 1');
    }
    if (!shippingAddress || !validateAddress(shippingAddress)) {
      return respondError(400, 'Shipping address incomplete.');
    }
    if (!contactEmail || !/.+@.+\..+/.test(contactEmail)) {
      return respondError(400, 'Valid contact email required.');
    }
    const normalizedEmail = contactEmail.trim().toLowerCase();

    const user = await requireParentOrAdminUser(request);
    const firestore = getFirestore();
    const bookRef = firestore.collection('storyBooks').doc(bookId);
    const bookSnap = await bookRef.get();
    if (!bookSnap.exists) {
      return respondError(404, 'Storybook not found');
    }
    const bookData = bookSnap.data() as Record<string, any>;
    const parentUid = bookData?.parentUid;
    const isPrivileged = user.claims.isAdmin || user.claims.isWriter;
    if (!isPrivileged && parentUid && parentUid !== user.uid) {
      return respondError(403, 'You do not own this storybook.');
    }
    const finalization = bookData?.storybookFinalization ?? null;
    if (!finalization || !bookData?.isLocked) {
      return respondError(409, 'Finalize the book before placing an order.');
    }
    if (!finalization.printablePdfUrl) {
      return respondError(409, 'Generate a printable PDF before ordering.');
    }

    const orderRef = firestore.collection('printOrders').doc();
    const resolvedRegressionTag = regressionTag ?? finalization.regressionTag ?? null;
    const regressionTestFlag = !!resolvedRegressionTag;
    await orderRef.set({
      parentUid: parentUid ?? user.uid,
      bookId,
      version: finalization.version ?? 1,
      storySessionId: bookData?.storySessionId ?? null,
      quantity,
      shippingAddress: {
        ...shippingAddress,
        line2: shippingAddress.line2 ?? null,
      },
      contactEmail: normalizedEmail,
      paymentStatus: 'unpaid',
      fulfillmentStatus: 'pending',
      printablePdfUrl: finalization.printablePdfUrl,
      printableMetadata: finalization.printableMetadata ?? null,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
      regressionTag: resolvedRegressionTag,
      regressionTest: regressionTestFlag || undefined,
    });

    await bookRef.update({
      'storybookFinalization.status': 'ordered',
      'storybookFinalization.lastOrderId': orderRef.id,
    });

    if (bookData.storySessionId) {
      await firestore
        .collection('storySessions')
        .doc(bookData.storySessionId)
        .collection('events')
        .add({
          event: 'print_order.created',
          status: 'completed',
          source: 'server',
          attributes: {
            bookId,
            orderId: orderRef.id,
            quantity,
          },
          createdAt: FieldValue.serverTimestamp(),
        });
    }

    return NextResponse.json({
      ok: true,
      orderId: orderRef.id,
    });
  } catch (error: any) {
    if (error instanceof AuthError) {
      return respondError(error.status, error.message);
    }
    console.error('[printOrders] create error', error);
    return respondError(500, error?.message ?? 'Unexpected print order error');
  }
}
