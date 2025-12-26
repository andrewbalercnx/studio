import { NextRequest, NextResponse } from 'next/server';
import { initFirebaseAdminApp } from '@/firebase/admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { requireParentOrAdminUser } from '@/lib/server-auth';
import type { PrintOrder } from '@/lib/types';
import { mixamClient } from '@/lib/mixam/client';
import { buildMxJdfDocument } from '@/lib/mixam/mxjdf-builder';

/**
 * POST /api/admin/print-orders/[orderId]/submit
 * Submits an approved print order to Mixam
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

    // Verify order is approved
    if (order.fulfillmentStatus !== 'approved') {
      return NextResponse.json(
        { ok: false, error: `Order must be approved before submission. Current status: ${order.fulfillmentStatus}` },
        { status: 400 }
      );
    }

    // Verify validation passed
    if (order.validationResult && !order.validationResult.valid) {
      return NextResponse.json(
        { ok: false, error: 'Order has validation errors and cannot be submitted' },
        { status: 400 }
      );
    }

    // Verify PDFs are present
    const coverPdfUrl = order.printableFiles?.coverPdfUrl;
    const interiorPdfUrl = order.printableFiles?.interiorPdfUrl;
    if (!coverPdfUrl || !interiorPdfUrl) {
      return NextResponse.json(
        { ok: false, error: 'Cover and interior PDFs are required' },
        { status: 400 }
      );
    }

    // Verify page count meets minimum requirements for binding type
    const interiorPageCount = order.printableMetadata?.interiorPageCount ?? 0;
    const binding = order.productSnapshot?.mixamMapping?.binding?.type ||
                    order.productSnapshot?.mixamSpec?.binding?.type || 'PUR';

    // Hardcover/case-bound books require minimum 24 interior pages
    // This is a Mixam constraint - fewer pages makes the spine too thin
    const minInteriorPages = binding === 'case' || binding === 'CASE' ? 24 : 8;

    if (interiorPageCount < minInteriorPages) {
      return NextResponse.json(
        {
          ok: false,
          error: `Interior page count (${interiorPageCount}) is below the minimum required for ${binding} binding (${minInteriorPages} pages). Please add more pages to the storybook or use a different binding type.`
        },
        { status: 400 }
      );
    }

    // Verify page count is a multiple of 4 (Mixam requirement)
    if (interiorPageCount % 4 !== 0) {
      return NextResponse.json(
        {
          ok: false,
          error: `Interior page count (${interiorPageCount}) must be a multiple of 4 for ${binding} binding.`
        },
        { status: 400 }
      );
    }

    const paddingPageCount = order.printableMetadata?.paddingPageCount ?? 0;
    console.log(`[print-orders] Submitting order ${order.id} to Mixam...`);
    console.log(`[print-orders] Interior pages: ${interiorPageCount} (including ${paddingPageCount} padding), Binding: ${binding}, Min required: ${minInteriorPages}`);

    // Update status to submitting
    await orderDoc.ref.update({
      fulfillmentStatus: 'validating',
      updatedAt: FieldValue.serverTimestamp(),
    });

    try {
      // Build MxJdf document with direct URLs to Firebase Storage PDFs
      // Mixam will fetch the files from these public URLs
      // Note: Padding pages are now embedded in the interior PDF, no separate file needed
      console.log('[print-orders] Building MxJdf document with PDF URLs...');
      console.log(`[print-orders] Cover PDF URL: ${coverPdfUrl}`);
      console.log(`[print-orders] Interior PDF URL: ${interiorPdfUrl}`);
      if (paddingPageCount > 0) {
        console.log(`[print-orders] Interior PDF includes ${paddingPageCount} padding pages`);
      }

      const mxjdf = buildMxJdfDocument({
        order,
        metadata: order.printableMetadata!,
        coverFileRef: coverPdfUrl,    // Direct URL - Mixam will fetch
        interiorFileRef: interiorPdfUrl, // Direct URL - Mixam will fetch (includes padding)
      });

      // Step 4: Submit order to Mixam
      console.log('[print-orders] Submitting order to Mixam API...');
      console.log('[print-orders] MxJdf document:', JSON.stringify(mxjdf, null, 2));

      const mixamOrder = await mixamClient.submitOrder(mxjdf);

      console.log(`[print-orders] Mixam response:`, JSON.stringify(mixamOrder, null, 2));

      // Step 5: Update order with Mixam details
      // Note: FieldValue.serverTimestamp() cannot be used inside arrayUnion, so use Date
      const now = new Date();
      await orderDoc.ref.update({
        fulfillmentStatus: 'submitted',
        mixamJobNumber: mixamOrder.jobNumber,
        mixamOrderId: mixamOrder.orderId,
        mixamStatus: mixamOrder.status,
        mixamResponse: mixamOrder, // Store full response for debugging
        submittedToMixamAt: FieldValue.serverTimestamp(),
        submittedToMixamBy: user.uid,
        updatedAt: FieldValue.serverTimestamp(),
        statusHistory: FieldValue.arrayUnion({
          status: 'submitted',
          timestamp: now,
          note: `Submitted to Mixam. Job Number: ${mixamOrder.jobNumber}`,
          source: 'admin',
        }),
        processLog: FieldValue.arrayUnion({
          event: 'mixam_submitted',
          timestamp: now,
          message: `Order submitted to Mixam API`,
          data: {
            mixamOrderId: mixamOrder.orderId,
            mixamJobNumber: mixamOrder.jobNumber,
            mixamStatus: mixamOrder.status,
            coverPdfUrl,
            interiorPdfUrl,
          },
          source: 'system',
          userId: user.uid,
        }),
      });

      // Log submission event in story session
      if (order.storyId) {
        try {
          const storyDoc = await firestore.collection('stories').doc(order.storyId).get();
          const storyData = storyDoc.data();

          if (storyData?.storySessionId) {
            await firestore
              .collection('storySessions')
              .doc(storyData.storySessionId)
              .collection('events')
              .add({
                event: 'print_order.submitted',
                status: 'completed',
                source: 'admin',
                attributes: {
                  orderId: order.id,
                  mixamJobNumber: mixamOrder.jobNumber,
                  quantity: order.quantity,
                },
                createdAt: FieldValue.serverTimestamp(),
              });
          }
        } catch (error) {
          console.warn('[print-orders] Failed to log session event', error);
        }
      }

      console.log(`[print-orders] Order ${order.id} submitted successfully to Mixam`);

      return NextResponse.json({
        ok: true,
        mixamJobNumber: mixamOrder.jobNumber,
        mixamOrderId: mixamOrder.orderId,
      });

    } catch (error: any) {
      // Submission failed - update status back to approved
      console.error('[print-orders] Mixam submission failed:', error);

      // Note: FieldValue.serverTimestamp() cannot be used inside arrayUnion, so use Date
      const errorTime = new Date();
      await orderDoc.ref.update({
        fulfillmentStatus: 'approved', // Back to approved so admin can retry
        fulfillmentNotes: `Submission failed: ${error.message}`,
        updatedAt: FieldValue.serverTimestamp(),
        statusHistory: FieldValue.arrayUnion({
          status: 'validation_failed',
          timestamp: errorTime,
          note: `Submission to Mixam failed: ${error.message}`,
          source: 'system',
        }),
      });

      return NextResponse.json(
        { ok: false, error: `Mixam submission failed: ${error.message}` },
        { status: 500 }
      );
    }

  } catch (error: any) {
    console.error('[print-orders] Error submitting order:', error);
    return NextResponse.json(
      { ok: false, error: error.message },
      { status: 500 }
    );
  }
}
