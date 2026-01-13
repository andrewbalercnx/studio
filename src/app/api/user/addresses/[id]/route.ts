import { NextRequest, NextResponse } from 'next/server';
import { initFirebaseAdminApp } from '@/firebase/admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { requireParentOrAdminUser } from '@/lib/server-auth';
import { validateUKAddress } from '@/lib/mixam/address-validator';
import type { PrintOrderAddress } from '@/lib/types';

type RouteContext = {
  params: Promise<{ id: string }>;
};

/**
 * PUT /api/user/addresses/[id]
 * Updates an existing saved address
 */
export async function PUT(request: NextRequest, context: RouteContext) {
  try {
    const user = await requireParentOrAdminUser(request);
    const { id: addressId } = await context.params;
    const body = await request.json();

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

    const { name, line1, city, postalCode, country, line2, state, label, isDefault } = body;

    // Validate required fields
    if (!name || !line1 || !city || !postalCode) {
      return NextResponse.json(
        { ok: false, error: 'Name, line1, city, and postalCode are required' },
        { status: 400 }
      );
    }

    // Validate UK address format
    const addressToValidate: PrintOrderAddress = {
      name,
      line1,
      line2: line2 || undefined,
      city,
      state: state || '',
      postalCode,
      country: country || 'GB',
    };

    const validation = validateUKAddress(addressToValidate);
    if (!validation.valid) {
      return NextResponse.json(
        { ok: false, error: validation.errors.join('. ') },
        { status: 400 }
      );
    }

    // If this is being set as default, unset other defaults
    if (isDefault) {
      const existingDefaults = await firestore
        .collection('users')
        .doc(user.uid)
        .collection('addresses')
        .where('isDefault', '==', true)
        .get();

      const batch = firestore.batch();
      existingDefaults.docs.forEach((doc) => {
        if (doc.id !== addressId) {
          batch.update(doc.ref, { isDefault: false, updatedAt: FieldValue.serverTimestamp() });
        }
      });
      await batch.commit();
    }

    // Use normalized address if available
    const normalizedAddress = validation.normalized || addressToValidate;

    const updates = {
      name: normalizedAddress.name,
      line1: normalizedAddress.line1,
      line2: normalizedAddress.line2 || null,
      city: normalizedAddress.city,
      state: normalizedAddress.state || '',
      postalCode: normalizedAddress.postalCode,
      country: normalizedAddress.country || 'GB',
      label: label || null,
      isDefault: isDefault ?? addressDoc.data()?.isDefault ?? false,
      updatedAt: FieldValue.serverTimestamp(),
    };

    await addressRef.update(updates);

    return NextResponse.json({
      ok: true,
      address: {
        id: addressId,
        ...updates,
        createdAt: addressDoc.data()?.createdAt?.toDate?.()?.toISOString() || null,
        updatedAt: new Date().toISOString(),
      },
      warnings: validation.warnings,
    });
  } catch (error: any) {
    console.error('[user/addresses/[id]] Error updating address:', error);
    return NextResponse.json(
      { ok: false, error: error.message },
      { status: error.status || 500 }
    );
  }
}

/**
 * DELETE /api/user/addresses/[id]
 * Deletes a saved address
 */
export async function DELETE(request: NextRequest, context: RouteContext) {
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

    const wasDefault = addressDoc.data()?.isDefault;

    // Delete the address
    await addressRef.delete();

    // If deleted address was default, make the most recent address the new default
    if (wasDefault) {
      const remainingAddresses = await firestore
        .collection('users')
        .doc(user.uid)
        .collection('addresses')
        .orderBy('createdAt', 'desc')
        .limit(1)
        .get();

      if (!remainingAddresses.empty) {
        await remainingAddresses.docs[0].ref.update({
          isDefault: true,
          updatedAt: FieldValue.serverTimestamp(),
        });
      }
    }

    return NextResponse.json({
      ok: true,
      message: 'Address deleted successfully',
    });
  } catch (error: any) {
    console.error('[user/addresses/[id]] Error deleting address:', error);
    return NextResponse.json(
      { ok: false, error: error.message },
      { status: error.status || 500 }
    );
  }
}
