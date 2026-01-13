import { NextRequest, NextResponse } from 'next/server';
import { initFirebaseAdminApp } from '@/firebase/admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { requireParentOrAdminUser } from '@/lib/server-auth';
import { validateUKAddress } from '@/lib/mixam/address-validator';
import type { SavedAddress, PrintOrderAddress } from '@/lib/types';

/**
 * GET /api/user/addresses
 * Returns all saved addresses for the authenticated user
 */
export async function GET(request: NextRequest) {
  try {
    const user = await requireParentOrAdminUser(request);

    await initFirebaseAdminApp();
    const firestore = getFirestore();

    // Check if user has addresses subcollection
    const addressesSnap = await firestore
      .collection('users')
      .doc(user.uid)
      .collection('addresses')
      .orderBy('createdAt', 'desc')
      .get();

    // If no addresses in subcollection, check for legacy savedShippingAddress
    if (addressesSnap.empty) {
      const userDoc = await firestore.collection('users').doc(user.uid).get();
      const userData = userDoc.data();

      if (userData?.savedShippingAddress) {
        // Migrate legacy address to subcollection
        const legacyAddress = userData.savedShippingAddress as PrintOrderAddress;
        const newAddressRef = firestore
          .collection('users')
          .doc(user.uid)
          .collection('addresses')
          .doc();

        const migratedAddress: Omit<SavedAddress, 'id'> = {
          ...legacyAddress,
          label: 'Home',
          isDefault: true,
          createdAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        };

        await newAddressRef.set(migratedAddress);

        console.log(`[user/addresses] Migrated legacy address for user ${user.uid}`);

        return NextResponse.json({
          ok: true,
          addresses: [{
            id: newAddressRef.id,
            ...migratedAddress,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          }],
        });
      }

      return NextResponse.json({
        ok: true,
        addresses: [],
      });
    }

    const addresses: SavedAddress[] = addressesSnap.docs.map((doc) => {
      const data = doc.data();
      return {
        id: doc.id,
        name: data.name,
        line1: data.line1,
        line2: data.line2 || undefined,
        city: data.city,
        state: data.state || '',
        postalCode: data.postalCode,
        country: data.country || 'GB',
        label: data.label,
        isDefault: data.isDefault || false,
        createdAt: data.createdAt?.toDate?.()?.toISOString() || null,
        updatedAt: data.updatedAt?.toDate?.()?.toISOString() || null,
      };
    });

    // Sort so default is first
    addresses.sort((a, b) => {
      if (a.isDefault && !b.isDefault) return -1;
      if (!a.isDefault && b.isDefault) return 1;
      return 0;
    });

    return NextResponse.json({
      ok: true,
      addresses,
    });
  } catch (error: any) {
    console.error('[user/addresses] Error fetching addresses:', error);
    return NextResponse.json(
      { ok: false, error: error.message },
      { status: error.status || 500 }
    );
  }
}

/**
 * POST /api/user/addresses
 * Creates a new saved address for the authenticated user
 */
export async function POST(request: NextRequest) {
  try {
    const user = await requireParentOrAdminUser(request);
    const body = await request.json();

    // Validate required fields
    const { name, line1, city, postalCode, country, line2, state, label, isDefault } = body;

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

    await initFirebaseAdminApp();
    const firestore = getFirestore();

    // If this is being set as default, unset other defaults
    if (isDefault) {
      const existingAddresses = await firestore
        .collection('users')
        .doc(user.uid)
        .collection('addresses')
        .where('isDefault', '==', true)
        .get();

      const batch = firestore.batch();
      existingAddresses.docs.forEach((doc) => {
        batch.update(doc.ref, { isDefault: false, updatedAt: FieldValue.serverTimestamp() });
      });
      await batch.commit();
    }

    // Check if this is the first address - make it default automatically
    const addressCount = await firestore
      .collection('users')
      .doc(user.uid)
      .collection('addresses')
      .count()
      .get();

    const shouldBeDefault = isDefault || addressCount.data().count === 0;

    // Create the new address
    const newAddressRef = firestore
      .collection('users')
      .doc(user.uid)
      .collection('addresses')
      .doc();

    // Use normalized address if available
    const normalizedAddress = validation.normalized || addressToValidate;

    const newAddress: Omit<SavedAddress, 'id'> = {
      name: normalizedAddress.name,
      line1: normalizedAddress.line1,
      line2: normalizedAddress.line2 || undefined,
      city: normalizedAddress.city,
      state: normalizedAddress.state || '',
      postalCode: normalizedAddress.postalCode,
      country: normalizedAddress.country || 'GB',
      label: label || undefined,
      isDefault: shouldBeDefault,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    };

    await newAddressRef.set(newAddress);

    return NextResponse.json({
      ok: true,
      address: {
        id: newAddressRef.id,
        ...newAddress,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      warnings: validation.warnings,
    });
  } catch (error: any) {
    console.error('[user/addresses] Error creating address:', error);
    return NextResponse.json(
      { ok: false, error: error.message },
      { status: error.status || 500 }
    );
  }
}
