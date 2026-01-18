import { NextRequest, NextResponse } from 'next/server';
import { initFirebaseAdminApp } from '@/firebase/admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { requireParentOrAdminUser } from '@/lib/server-auth';
import type { PrintOrder, SystemAddressConfig, SavedAddress } from '@/lib/types';
import { mixamClient } from '@/lib/mixam/client';
import { buildMxJdfDocument } from '@/lib/mixam/mxjdf-builder';
import { logMixamInteractions, toMixamInteractions } from '@/lib/mixam/interaction-logger';

/**
 * POST /api/admin/print-orders/[orderId]/resubmit
 * Resubmits an on_hold order to Mixam (for transient errors like upload failures)
 *
 * This creates a new Mixam order using the existing PDFs. Use when:
 * - Order is on_hold due to transient errors (e.g., "Upload failed")
 * - PDFs are already generated and accessible
 * - The original submission succeeded but Mixam's internal processing failed
 */
export async function POST(
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

    const order = { id: orderDoc.id, ...orderDoc.data() } as PrintOrder;

    // Verify order is on_hold (the only status we allow resubmission from)
    if (order.fulfillmentStatus !== 'on_hold') {
      return NextResponse.json(
        { ok: false, error: `Resubmit is only available for orders on hold. Current status: ${order.fulfillmentStatus}` },
        { status: 400 }
      );
    }

    // Store the previous Mixam order ID for reference
    const previousMixamOrderId = order.mixamOrderId;
    const previousMixamJobNumber = order.mixamJobNumber;

    // Verify PDFs are present
    const coverPdfUrl = order.printableFiles?.coverPdfUrl;
    const interiorPdfUrl = order.printableFiles?.interiorPdfUrl;
    if (!coverPdfUrl || !interiorPdfUrl) {
      return NextResponse.json(
        { ok: false, error: 'Cover and interior PDFs are required' },
        { status: 400 }
      );
    }

    // Verify page count meets requirements
    const interiorPageCount = order.printableMetadata?.interiorPageCount ?? 0;
    const binding = order.productSnapshot?.mixamMapping?.binding?.type ||
                    order.productSnapshot?.mixamSpec?.binding?.type || 'PUR';

    const minInteriorPages = binding === 'case' || binding === 'CASE' ? 24 : 8;

    if (interiorPageCount < minInteriorPages) {
      return NextResponse.json(
        {
          ok: false,
          error: `Interior page count (${interiorPageCount}) is below the minimum required for ${binding} binding (${minInteriorPages} pages).`
        },
        { status: 400 }
      );
    }

    if (interiorPageCount % 4 !== 0) {
      return NextResponse.json(
        {
          ok: false,
          error: `Interior page count (${interiorPageCount}) must be a multiple of 4 for ${binding} binding.`
        },
        { status: 400 }
      );
    }

    console.log(`[print-orders] Resubmitting on_hold order ${order.id} to Mixam...`);
    console.log(`[print-orders] Previous Mixam Order ID: ${previousMixamOrderId}, Job Number: ${previousMixamJobNumber}`);

    // Update status to submitting
    await orderDoc.ref.update({
      fulfillmentStatus: 'validating',
      updatedAt: FieldValue.serverTimestamp(),
      statusHistory: FieldValue.arrayUnion({
        status: 'validating',
        timestamp: new Date(),
        note: `Resubmitting order (previous Mixam order: ${previousMixamJobNumber || previousMixamOrderId || 'unknown'})`,
        source: 'admin',
      }),
    });

    // Cancel the previous Mixam order to avoid orphaned orders
    let previousOrderCancelled = false;
    if (previousMixamOrderId) {
      try {
        console.log(`[print-orders] Cancelling previous Mixam order: ${previousMixamOrderId}`);
        const cancelResult = await mixamClient.cancelOrderWithLogging(previousMixamOrderId);
        const { interactions: cancelInteractions, ...cancelResponse } = cancelResult;

        // Log the cancellation interactions
        await logMixamInteractions(firestore, orderId, toMixamInteractions(cancelInteractions, previousMixamOrderId));

        console.log(`[print-orders] Previous Mixam order cancelled:`, cancelResponse);
        previousOrderCancelled = true;

        // Log the cancellation
        await orderDoc.ref.update({
          processLog: FieldValue.arrayUnion({
            event: 'mixam_order_cancelled',
            timestamp: new Date(),
            message: `Cancelled previous Mixam order before resubmission`,
            data: {
              cancelledOrderId: previousMixamOrderId,
              cancelledJobNumber: previousMixamJobNumber,
              cancelResponse,
            },
            source: 'system',
            userId: user.uid,
          }),
        });
      } catch (cancelError: any) {
        // Log cancellation failure but continue with resubmission
        // The old order might already be cancelled, in production, or otherwise unable to cancel
        console.warn(`[print-orders] Failed to cancel previous Mixam order (continuing with resubmission):`, cancelError.message);

        // Log the failed cancellation attempt
        if (cancelError.interactions) {
          await logMixamInteractions(firestore, orderId, toMixamInteractions(cancelError.interactions, previousMixamOrderId));
        }

        await orderDoc.ref.update({
          processLog: FieldValue.arrayUnion({
            event: 'mixam_cancel_failed',
            timestamp: new Date(),
            message: `Failed to cancel previous Mixam order (will proceed with new order): ${cancelError.message}`,
            data: {
              orderIdAttempted: previousMixamOrderId,
              jobNumberAttempted: previousMixamJobNumber,
              error: cancelError.message,
            },
            source: 'system',
            userId: user.uid,
          }),
        });
      }
    }

    try {
      // Fetch system billing address configuration
      let billingAddress: {
        name: string;
        line1: string;
        line2?: string;
        city: string;
        state?: string;
        postalCode: string;
        country: string;
        email: string;
        phone?: string;
      } | undefined;

      try {
        const systemAddressDoc = await firestore.collection('systemConfig').doc('addresses').get();
        if (systemAddressDoc.exists) {
          const config = systemAddressDoc.data() as SystemAddressConfig;
          if (config.mixamBillToAddressId && config.addresses?.length > 0) {
            const billToAddress = config.addresses.find(
              (a: SavedAddress) => a.id === config.mixamBillToAddressId
            );
            if (billToAddress) {
              billingAddress = {
                name: billToAddress.name,
                line1: billToAddress.line1,
                line2: billToAddress.line2,
                city: billToAddress.city,
                state: billToAddress.state,
                postalCode: billToAddress.postalCode,
                country: billToAddress.country || 'GB',
                email: order.contactEmail,
                phone: undefined,
              };
            }
          }
        }
      } catch (billToError) {
        console.warn('[print-orders] Failed to fetch system billing address:', billToError);
      }

      // Build MxJdf document with existing PDF URLs
      console.log('[print-orders] Building MxJdf document for resubmission...');
      const mxjdf = buildMxJdfDocument({
        order,
        metadata: order.printableMetadata!,
        coverFileRef: coverPdfUrl,
        interiorFileRef: interiorPdfUrl,
        billingAddress,
      });

      // Submit order to Mixam
      console.log('[print-orders] Resubmitting order to Mixam API...');
      const mixamResult = await mixamClient.submitOrderWithLogging(mxjdf);
      const { interactions, ...mixamOrder } = mixamResult;

      // Log the API interactions
      await logMixamInteractions(firestore, orderId, toMixamInteractions(interactions, mixamOrder.orderId));

      console.log(`[print-orders] Mixam resubmit response:`, JSON.stringify(mixamOrder, null, 2));

      // Update order with new Mixam details
      const now = new Date();
      await orderDoc.ref.update({
        fulfillmentStatus: 'submitted',
        mixamJobNumber: mixamOrder.jobNumber,
        mixamOrderId: mixamOrder.orderId,
        mixamStatus: mixamOrder.status,
        mixamResponse: mixamOrder,
        // Keep track of the resubmission
        previousMixamOrderId: previousMixamOrderId || null,
        previousMixamJobNumber: previousMixamJobNumber || null,
        resubmittedAt: FieldValue.serverTimestamp(),
        resubmittedBy: user.uid,
        updatedAt: FieldValue.serverTimestamp(),
        statusHistory: FieldValue.arrayUnion({
          status: 'submitted',
          timestamp: now,
          note: `Resubmitted to Mixam. New Job Number: ${mixamOrder.jobNumber} (previous: ${previousMixamJobNumber || 'none'})`,
          source: 'admin',
        }),
        processLog: FieldValue.arrayUnion({
          event: 'mixam_resubmitted',
          timestamp: now,
          message: `Order resubmitted to Mixam API after on_hold status`,
          data: {
            newMixamOrderId: mixamOrder.orderId,
            newMixamJobNumber: mixamOrder.jobNumber,
            previousMixamOrderId,
            previousMixamJobNumber,
            mixamStatus: mixamOrder.status,
          },
          source: 'system',
          userId: user.uid,
        }),
      });

      console.log(`[print-orders] Order ${order.id} resubmitted successfully to Mixam`);

      return NextResponse.json({
        ok: true,
        mixamJobNumber: mixamOrder.jobNumber,
        mixamOrderId: mixamOrder.orderId,
        previousMixamOrderId,
        previousMixamJobNumber,
        previousOrderCancelled,
      });

    } catch (error: any) {
      // Resubmission failed - set back to on_hold
      console.error('[print-orders] Mixam resubmission failed:', error);

      if (error.interactions) {
        await logMixamInteractions(firestore, orderId, toMixamInteractions(error.interactions));
      }

      const errorTime = new Date();
      await orderDoc.ref.update({
        fulfillmentStatus: 'on_hold', // Stay on_hold so admin can retry again
        fulfillmentNotes: `Resubmission failed: ${error.message}`,
        updatedAt: FieldValue.serverTimestamp(),
        statusHistory: FieldValue.arrayUnion({
          status: 'on_hold',
          timestamp: errorTime,
          note: `Resubmission to Mixam failed: ${error.message}`,
          source: 'system',
        }),
      });

      return NextResponse.json(
        { ok: false, error: `Mixam resubmission failed: ${error.message}` },
        { status: 500 }
      );
    }

  } catch (error: any) {
    console.error('[print-orders] Error resubmitting order:', error);
    return NextResponse.json(
      { ok: false, error: error.message },
      { status: 500 }
    );
  }
}
