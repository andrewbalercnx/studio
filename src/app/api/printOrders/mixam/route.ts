import { NextRequest, NextResponse } from 'next/server';
import { initFirebaseAdminApp } from '@/firebase/admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { requireParentOrAdminUser } from '@/lib/server-auth';
import type { PrintOrder, PrintProduct, PrintStoryBook } from '@/lib/types';
import { validateUKAddress } from '@/lib/mixam/address-validator';
import { notifyOrderSubmitted } from '@/lib/email/notify-admins';

/**
 * POST /api/printOrders/mixam
 * Creates a new Mixam print order from a parent
 */
export async function POST(request: NextRequest) {
  try {
    const user = await requireParentOrAdminUser(request);

    const body = await request.json();
    const { storyId, printStoryBookId, storybookId, productId, quantity, customOptions, shippingAddress } = body;

    console.log('[printOrders/mixam] Creating order:', { storyId, printStoryBookId, storybookId, productId, quantity });

    // Validate required fields
    if (!storyId || !productId || !quantity) {
      return NextResponse.json(
        { ok: false, error: 'Missing required fields: storyId, productId, and quantity are required' },
        { status: 400 }
      );
    }

    if (quantity < 1 || quantity > 100) {
      return NextResponse.json(
        { ok: false, error: 'Quantity must be between 1 and 100' },
        { status: 400 }
      );
    }

    await initFirebaseAdminApp();
    const firestore = getFirestore();

    // 1. Verify product exists and is active
    const productDoc = await firestore.collection('printProducts').doc(productId).get();
    if (!productDoc.exists) {
      return NextResponse.json(
        { ok: false, error: 'Product not found' },
        { status: 404 }
      );
    }

    const product = { id: productDoc.id, ...productDoc.data() } as PrintProduct;

    if (!product.active) {
      return NextResponse.json(
        { ok: false, error: 'Product is not available' },
        { status: 400 }
      );
    }

    // 2. Verify story exists
    const storyDoc = await firestore.collection('stories').doc(storyId).get();
    if (!storyDoc.exists) {
      return NextResponse.json(
        { ok: false, error: 'Story not found' },
        { status: 404 }
      );
    }

    const storyData = storyDoc.data();

    // Check story belongs to user (unless admin) - use parentUid field
    if (!user.claims.isAdmin && storyData?.parentUid !== user.uid) {
      return NextResponse.json(
        { ok: false, error: 'You do not have permission to order this story' },
        { status: 403 }
      );
    }

    // 3. Get PDF URLs - from PrintStoryBook collection, storybooks subcollection, or legacy path
    let coverPdfUrl: string | null = null;
    let interiorPdfUrl: string | null = null;
    let paddingPdfUrl: string | null = null;
    let printableMetadata: any = null;
    let printStoryBook: PrintStoryBook | null = null;

    if (printStoryBookId) {
      // Use the PrintStoryBook collection
      const printStoryBookDoc = await firestore.collection('printStoryBooks').doc(printStoryBookId).get();
      if (!printStoryBookDoc.exists) {
        return NextResponse.json(
          { ok: false, error: 'Print storybook not found' },
          { status: 404 }
        );
      }

      printStoryBook = { id: printStoryBookDoc.id, ...printStoryBookDoc.data() } as PrintStoryBook;

      // Verify ownership
      if (!user.claims.isAdmin && printStoryBook.ownerUserId !== user.uid) {
        return NextResponse.json(
          { ok: false, error: 'You do not have permission to order this print storybook' },
          { status: 403 }
        );
      }

      // Check PDFs are ready
      if (printStoryBook.pdfStatus !== 'ready') {
        return NextResponse.json(
          { ok: false, error: `Print storybook PDFs are not ready. Status: ${printStoryBook.pdfStatus}` },
          { status: 400 }
        );
      }

      coverPdfUrl = printStoryBook.coverPdfUrl || null;
      interiorPdfUrl = printStoryBook.interiorPdfUrl || null;
      printableMetadata = printStoryBook.printableMetadata;
    } else if (storybookId) {
      // Use the new storybooks subcollection: stories/{storyId}/storybooks/{storybookId}
      console.log('[printOrders/mixam] Fetching from storybooks subcollection:', `stories/${storyId}/storybooks/${storybookId}`);
      const storybookDoc = await firestore
        .collection('stories')
        .doc(storyId)
        .collection('storybooks')
        .doc(storybookId)
        .get();

      if (!storybookDoc.exists) {
        return NextResponse.json(
          { ok: false, error: `Storybook not found at stories/${storyId}/storybooks/${storybookId}` },
          { status: 404 }
        );
      }

      const storybookData = storybookDoc.data();
      console.log('[printOrders/mixam] Storybook data finalization:', storybookData?.finalization);

      // Check that finalization data exists with PDFs
      if (!storybookData?.finalization) {
        return NextResponse.json(
          { ok: false, error: 'Storybook has not been finalized. Please generate printable PDFs first.' },
          { status: 400 }
        );
      }

      coverPdfUrl = storybookData.finalization.printableCoverPdfUrl || null;
      interiorPdfUrl = storybookData.finalization.printableInteriorPdfUrl || null;
      paddingPdfUrl = storybookData.finalization.printablePaddingPdfUrl || null;
      printableMetadata = storybookData.finalization.printableMetadata || null;
    } else {
      // Try legacy path: stories/{storyId}/outputs/storybook
      console.log('[printOrders/mixam] Trying legacy path:', `stories/${storyId}/outputs/storybook`);
      const storybookDoc = await firestore
        .collection('stories')
        .doc(storyId)
        .collection('outputs')
        .doc('storybook')
        .get();

      if (storybookDoc.exists) {
        const storybookData = storybookDoc.data();
        coverPdfUrl = storybookData?.finalization?.printableCoverPdfUrl || null;
        interiorPdfUrl = storybookData?.finalization?.printableInteriorPdfUrl || null;
        paddingPdfUrl = storybookData?.finalization?.printablePaddingPdfUrl || null;
        printableMetadata = storybookData?.finalization?.printableMetadata || null;
      }
    }

    if (!coverPdfUrl || !interiorPdfUrl) {
      return NextResponse.json(
        { ok: false, error: 'Printable PDFs have not been generated. Please generate PDFs first.' },
        { status: 400 }
      );
    }

    // 4. Validate shipping address
    const addressValidation = validateUKAddress(shippingAddress);
    if (!addressValidation.valid) {
      return NextResponse.json(
        {
          ok: false,
          error: 'Invalid shipping address',
          errors: addressValidation.errors,
        },
        { status: 400 }
      );
    }

    // 5. Calculate pricing using pricingTiers
    const pricingTiers = product.pricingTiers || [];
    const pricingTier = pricingTiers.find(
      (tier) => quantity >= tier.minQuantity && (tier.maxQuantity === null || quantity <= tier.maxQuantity)
    );

    if (!pricingTier) {
      return NextResponse.json(
        { ok: false, error: `No pricing available for quantity ${quantity}` },
        { status: 400 }
      );
    }

    const basePrice = pricingTier.basePrice || 0;
    const subtotal = basePrice * quantity;
    const shippingCost = (product.shippingCost?.baseRate || 0) + ((product.shippingCost?.perItemRate || 0) * quantity);
    const setupFee = pricingTier.setupFee || 0;
    const total = subtotal + shippingCost + setupFee;

    // 6. Create print order
    const now = new Date().toISOString();
    const orderData: Partial<PrintOrder> = {
      parentUid: user.uid,
      storyId,
      outputId: printStoryBookId || storybookId || storyId, // Use printStoryBookId, storybookId, or storyId
      printProductId: productId,
      productSnapshot: product,
      quantity,
      customOptions: customOptions || {},
      shippingAddress: addressValidation.normalized!,
      contactEmail: user.email || '',
      printableFiles: {
        coverPdfUrl,
        interiorPdfUrl,
        paddingPdfUrl,
      },
      printableMetadata: printableMetadata || {},
      estimatedCost: {
        unitPrice: basePrice,
        subtotal,
        shipping: shippingCost,
        setupFee,
        total,
        currency: 'GBP',
      },
      fulfillmentStatus: 'awaiting_approval',
      paymentStatus: 'unpaid',
      version: 1,
      createdAt: FieldValue.serverTimestamp() as any,
      updatedAt: FieldValue.serverTimestamp() as any,
      statusHistory: [
        {
          status: 'awaiting_approval',
          timestamp: now,
          note: 'Order created by parent, pending admin approval',
          source: 'parent',
        },
      ],
      processLog: [
        {
          event: 'order_created',
          timestamp: now,
          message: `Order created for ${quantity} x ${product.name}`,
          data: {
            productId,
            quantity,
            storyId,
            printStoryBookId: printStoryBookId || null,
            storybookId: storybookId || null,
            estimatedTotal: total,
          },
          source: 'parent',
          userId: user.uid,
        },
        {
          event: 'address_validated',
          timestamp: now,
          message: 'Shipping address validated successfully',
          data: {
            country: addressValidation.normalized?.country,
            postalCode: addressValidation.normalized?.postalCode,
            warnings: addressValidation.warnings,
          },
          source: 'system',
        },
        {
          event: 'pdfs_linked',
          timestamp: now,
          message: 'Cover and interior PDFs linked to order',
          data: {
            hasCoverPdf: !!coverPdfUrl,
            hasInteriorPdf: !!interiorPdfUrl,
            fromPrintStoryBook: !!printStoryBookId,
          },
          source: 'system',
        },
      ],
    };

    // Deep clean undefined values (Firestore doesn't accept them)
    function removeUndefined(obj: any): any {
      if (obj === null || obj === undefined) return obj;
      if (Array.isArray(obj)) {
        return obj.map(removeUndefined);
      }
      if (typeof obj === 'object') {
        return Object.fromEntries(
          Object.entries(obj)
            .filter(([_, v]) => v !== undefined)
            .map(([k, v]) => [k, removeUndefined(v)])
        );
      }
      return obj;
    }

    const cleanOrderData = removeUndefined(orderData);

    const orderRef = await firestore.collection('printOrders').add(cleanOrderData);

    // Save shipping address to user profile for future orders
    await firestore.collection('users').doc(user.uid).set(
      { savedShippingAddress: addressValidation.normalized },
      { merge: true }
    );

    console.log(`[printOrders/mixam] Order created: ${orderRef.id} for user ${user.uid}`);

    // Send email notification to notified admins
    try {
      const newOrder = { ...cleanOrderData, id: orderRef.id } as PrintOrder;
      await notifyOrderSubmitted(firestore, newOrder);
    } catch (emailError: any) {
      console.warn('[printOrders/mixam] Failed to send order notification:', emailError.message);
      // Don't fail the request due to email errors
    }

    return NextResponse.json({
      ok: true,
      orderId: orderRef.id,
      estimatedCost: orderData.estimatedCost,
    });

  } catch (error: any) {
    console.error('[printOrders/mixam] Error creating order:', error);
    return NextResponse.json(
      { ok: false, error: error.message },
      { status: 500 }
    );
  }
}
