import { NextRequest, NextResponse } from 'next/server';
import { initFirebaseAdminApp } from '@/firebase/admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { requireParentOrAdminUser } from '@/lib/server-auth';
import type { MixamConfig } from '@/lib/types';
import { DEFAULT_MIXAM_CONFIG } from '@/lib/types';

/**
 * GET /api/admin/system-config/mixam
 * Gets the Mixam configuration
 */
export async function GET(request: NextRequest) {
  try {
    const user = await requireParentOrAdminUser(request);

    if (!user.claims.isAdmin) {
      return NextResponse.json(
        { ok: false, error: 'Admin access required' },
        { status: 403 }
      );
    }

    await initFirebaseAdminApp();
    const firestore = getFirestore();

    const configDoc = await firestore.collection('systemConfig').doc('mixam').get();

    if (!configDoc.exists) {
      // Return default config if none exists
      return NextResponse.json({
        ok: true,
        config: DEFAULT_MIXAM_CONFIG,
      });
    }

    return NextResponse.json({
      ok: true,
      config: configDoc.data() as MixamConfig,
    });
  } catch (error: any) {
    console.error('[system-config] Error fetching Mixam config:', error);
    return NextResponse.json(
      { ok: false, error: error.message },
      { status: 500 }
    );
  }
}

/**
 * PUT /api/admin/system-config/mixam
 * Updates the Mixam configuration
 */
export async function PUT(request: NextRequest) {
  try {
    const user = await requireParentOrAdminUser(request);

    if (!user.claims.isAdmin) {
      return NextResponse.json(
        { ok: false, error: 'Admin access required' },
        { status: 403 }
      );
    }

    const body = await request.json();
    const { paymentMethod } = body;

    // Validate payment method
    const validPaymentMethods = ['TEST_ORDER', 'ACCOUNT', 'CARD_ON_FILE'];
    if (!paymentMethod || !validPaymentMethods.includes(paymentMethod)) {
      return NextResponse.json(
        { ok: false, error: `Invalid payment method. Must be one of: ${validPaymentMethods.join(', ')}` },
        { status: 400 }
      );
    }

    await initFirebaseAdminApp();
    const firestore = getFirestore();

    const configRef = firestore.collection('systemConfig').doc('mixam');

    await configRef.set({
      paymentMethod,
      updatedAt: FieldValue.serverTimestamp(),
      updatedBy: user.uid,
    }, { merge: true });

    console.log(`[system-config] Mixam config updated by ${user.uid}: paymentMethod=${paymentMethod}`);

    return NextResponse.json({
      ok: true,
      config: {
        paymentMethod,
      },
    });
  } catch (error: any) {
    console.error('[system-config] Error updating Mixam config:', error);
    return NextResponse.json(
      { ok: false, error: error.message },
      { status: 500 }
    );
  }
}
