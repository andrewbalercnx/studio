import { NextRequest, NextResponse } from 'next/server';
import { initFirebaseAdminApp } from '@/firebase/admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { requireAdminUser } from '@/lib/server-auth';
import { validateUKAddress } from '@/lib/mixam/address-validator';
import type { SystemAddressConfig, SavedAddress, PrintOrderAddress, DEFAULT_SYSTEM_ADDRESS_CONFIG } from '@/lib/types';

/**
 * GET /api/admin/system-config/addresses
 * Returns the system address configuration including Mixam bill-to address
 */
export async function GET(request: NextRequest) {
  try {
    await requireAdminUser(request);

    await initFirebaseAdminApp();
    const firestore = getFirestore();

    const doc = await firestore.collection('systemConfig').doc('addresses').get();

    if (!doc.exists) {
      // Return default config if not yet created
      return NextResponse.json({
        ok: true,
        config: {
          addresses: [],
          mixamBillToAddressId: null,
        } as SystemAddressConfig,
      });
    }

    const data = doc.data();

    // Convert timestamps in addresses
    const addresses = (data?.addresses || []).map((addr: any) => ({
      ...addr,
      createdAt: addr.createdAt?.toDate?.()?.toISOString() || null,
      updatedAt: addr.updatedAt?.toDate?.()?.toISOString() || null,
    }));

    return NextResponse.json({
      ok: true,
      config: {
        addresses,
        mixamBillToAddressId: data?.mixamBillToAddressId || null,
        updatedAt: data?.updatedAt?.toDate?.()?.toISOString() || null,
        updatedBy: data?.updatedBy || null,
      } as SystemAddressConfig,
    });
  } catch (error: any) {
    console.error('[admin/system-config/addresses] Error fetching config:', error);
    return NextResponse.json(
      { ok: false, error: error.message },
      { status: error.status || 500 }
    );
  }
}

/**
 * PUT /api/admin/system-config/addresses
 * Updates the system address configuration
 *
 * Body: {
 *   addresses: SavedAddress[]
 *   mixamBillToAddressId: string | null
 * }
 */
export async function PUT(request: NextRequest) {
  try {
    const user = await requireAdminUser(request);
    const body = await request.json();

    const { addresses, mixamBillToAddressId } = body;

    if (!Array.isArray(addresses)) {
      return NextResponse.json(
        { ok: false, error: 'addresses must be an array' },
        { status: 400 }
      );
    }

    // Validate all addresses
    const validationErrors: string[] = [];
    const processedAddresses: SavedAddress[] = [];

    for (let i = 0; i < addresses.length; i++) {
      const addr = addresses[i];

      // Ensure required fields
      if (!addr.name || !addr.line1 || !addr.city || !addr.postalCode) {
        validationErrors.push(`Address ${i + 1}: Missing required fields (name, line1, city, postalCode)`);
        continue;
      }

      // Validate UK address format
      const addressToValidate: PrintOrderAddress = {
        name: addr.name,
        line1: addr.line1,
        line2: addr.line2 || undefined,
        city: addr.city,
        state: addr.state || '',
        postalCode: addr.postalCode,
        country: addr.country || 'GB',
      };

      const validation = validateUKAddress(addressToValidate);
      if (!validation.valid) {
        validationErrors.push(`Address ${i + 1} (${addr.label || addr.name}): ${validation.errors.join('. ')}`);
        continue;
      }

      // Use normalized address if available
      const normalizedAddress = validation.normalized || addressToValidate;

      // Generate ID if not present
      const id = addr.id || `sys_addr_${Date.now()}_${i}`;

      processedAddresses.push({
        id,
        name: normalizedAddress.name,
        line1: normalizedAddress.line1,
        line2: normalizedAddress.line2 || '',
        city: normalizedAddress.city,
        state: normalizedAddress.state || '',
        postalCode: normalizedAddress.postalCode,
        country: normalizedAddress.country || 'GB',
        label: addr.label || '',
        isDefault: addr.isDefault || false,
        createdAt: addr.createdAt || FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
    }

    if (validationErrors.length > 0) {
      return NextResponse.json(
        { ok: false, error: validationErrors.join('\n'), validationErrors },
        { status: 400 }
      );
    }

    // Validate mixamBillToAddressId if provided
    if (mixamBillToAddressId) {
      const billToExists = processedAddresses.some((a) => a.id === mixamBillToAddressId);
      if (!billToExists) {
        return NextResponse.json(
          { ok: false, error: 'Selected Mixam bill-to address does not exist in the address list' },
          { status: 400 }
        );
      }
    }

    await initFirebaseAdminApp();
    const firestore = getFirestore();

    // Update the system config document
    await firestore.collection('systemConfig').doc('addresses').set(
      {
        addresses: processedAddresses,
        mixamBillToAddressId: mixamBillToAddressId || null,
        updatedAt: FieldValue.serverTimestamp(),
        updatedBy: user.email || user.uid,
      },
      { merge: true }
    );

    return NextResponse.json({
      ok: true,
      message: 'System addresses updated successfully',
      config: {
        addresses: processedAddresses.map((a) => ({
          ...a,
          createdAt: typeof a.createdAt === 'object' ? new Date().toISOString() : a.createdAt,
          updatedAt: new Date().toISOString(),
        })),
        mixamBillToAddressId: mixamBillToAddressId || null,
        updatedAt: new Date().toISOString(),
        updatedBy: user.email || user.uid,
      } as SystemAddressConfig,
    });
  } catch (error: any) {
    console.error('[admin/system-config/addresses] Error updating config:', error);
    return NextResponse.json(
      { ok: false, error: error.message },
      { status: error.status || 500 }
    );
  }
}
