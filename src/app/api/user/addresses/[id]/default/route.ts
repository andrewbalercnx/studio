import { NextRequest, NextResponse } from 'next/server';
import { initFirebaseAdminApp } from '@/firebase/admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { requireParentOrAdminUser } from '@/lib/server-auth';

type RouteContext = {
  params: Promise<{ id: string }>;
};

/**
 * POST /api/user/addresses/[id]/default
 * Sets an address as the default shipping address
 */
export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const user = await requireParentOrAdminUser(request);
    const { id: addressId } = await context.params;

    if (!addressId) {
      return NextResponse.json(
        { ok: false, error: 'Address ID is required' },
        { status: 400 }
      );
    }

    await initFirebaseAdminApp();
    const firestore = getFirestore();

    // Check if address exists and belongs to user
    const addressRef = firestore
      .collection('users')
      .doc(user.uid)
      .collection('addresses')
      .doc(addressId);

    const addressDoc = await addressRef.get();
    if (!addressDoc.exists) {
      return NextResponse.json(
        { ok: false, error: 'Address not found' },
        { status: 404 }
      );
    }

    // Get all addresses for this user
    const allAddresses = await firestore
      .collection('users')
      .doc(user.uid)
      .collection('addresses')
      .get();

    // Batch update: unset all defaults, then set the new default
    const batch = firestore.batch();

    allAddresses.docs.forEach((doc) => {
      if (doc.id === addressId) {
        batch.update(doc.ref, {
          isDefault: true,
          updatedAt: FieldValue.serverTimestamp(),
        });
      } else if (doc.data().isDefault) {
        batch.update(doc.ref, {
          isDefault: false,
          updatedAt: FieldValue.serverTimestamp(),
        });
      }
    });

    await batch.commit();

    return NextResponse.json({
      ok: true,
      message: 'Default address updated successfully',
    });
  } catch (error: any) {
    console.error('[user/addresses/[id]/default] Error setting default:', error);
    return NextResponse.json(
      { ok: false, error: error.message },
      { status: error.status || 500 }
    );
  }
}
