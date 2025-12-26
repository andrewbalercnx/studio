'use server';

import { getServerFirestore } from '@/lib/server-firestore';
import { FieldValue } from 'firebase-admin/firestore';
import type { PrintProduct } from '@/lib/types';

/**
 * Seeds the initial hardcover print product configuration
 * Based on Mixam's hardcover book specifications with gloss laminate
 */
export async function seedHardcoverProduct(): Promise<{ success: boolean; productId: string; error?: string }> {
  try {
    const firestore = await getServerFirestore();

    const productId = 'hardcover-8x10-gloss';

    // Check if product already exists
    const existing = await firestore.collection('printProducts').doc(productId).get();
    if (existing.exists) {
      return {
        success: false,
        productId,
        error: 'Product already exists'
      };
    }

    const hardcoverProduct: Omit<PrintProduct, 'id'> = {
      name: 'Hardcover Picture Book (8×10")',
      description: 'Premium hardcover picture book with gloss laminated cover, silk paper interior. Perfect for personalized storybooks.',
      active: true,

      mixamSpec: {
        product: 'books',
        subProduct: 'hardcover_poth', // Hardcover POTH (Print On The Hardcover)

        cover: {
          type: 'COVER',
          pages: 4, // Cover is always 4 pages for hardcover
          material: {
            type: 'silk',
            weight: 200, // 200 GSM for cover
            units: 'GSM',
            color: 'WHITE',
            refinings: [{
              type: 'LAMINATION',
              side: 'FRONT', // Gloss laminate on front only
              effect: 'GLOSS'
            }]
          },
          chromaticity: {
            front: 'CMYK', // Full color front
            back: 'CMYK'   // Full color back (for back cover image)
          }
        },

        interior: {
          type: 'CONTENT',
          material: {
            type: 'silk',
            weight: 170, // 170 GSM silk paper for interior
            units: 'GSM',
            color: 'WHITE'
          },
          chromaticity: {
            front: 'CMYK', // Full color both sides
            back: 'CMYK'
          }
        },

        binding: {
          type: 'case', // Case binding for hardcover
          sewn: false, // Not sewn (standard PUR binding)
          edge: 'LEFT_RIGHT', // Standard left-to-right binding
          // Allow users to customize these
          allowHeadTailBandSelection: true,
          allowRibbonSelection: true,
          allowEndPaperSelection: true
        },

        format: {
          minPageCount: 24, // Minimum pages for hardcover
          maxPageCount: 48, // Maximum pages (can be adjusted)
          pageCountIncrement: 4, // Must be divisible by 4
          allowedTrimSizes: [
            {
              width: 203.2, // 8 inches in mm
              height: 254,  // 10 inches in mm
              label: '8×10 inches (Portrait)'
            }
          ],
          orientation: 'PORTRAIT',
          bleedRequired: 3.175 // 0.125 inches (3.175mm) bleed required
        },

        files: {
          separateCoverAndInterior: true, // Require separate PDFs
          colorSpace: 'CMYK', // CMYK for print
          minDPI: 300, // Minimum 300 DPI
          maxFileSize: 2147483648 // 2GB max per file
        }
      },

      // Pricing tiers - PLACEHOLDER VALUES
      // TODO: Update with actual Mixam pricing once received
      pricingTiers: [
        {
          minQuantity: 1,
          maxQuantity: 10,
          basePrice: 15.00, // GBP per book (ESTIMATE)
          setupFee: 0
        },
        {
          minQuantity: 11,
          maxQuantity: 50,
          basePrice: 12.50, // GBP per book (ESTIMATE)
          setupFee: 0
        },
        {
          minQuantity: 51,
          maxQuantity: null, // No upper limit
          basePrice: 10.00, // GBP per book (ESTIMATE)
          setupFee: 0
        }
      ],

      // Shipping cost - UK only initially
      shippingCost: {
        baseRate: 5.00, // GBP (ESTIMATE)
        perItemRate: 0.50 // Additional per book (ESTIMATE)
      },

      displayOrder: 1,

      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
      createdBy: 'system'
    };

    await firestore.collection('printProducts').doc(productId).set({
      ...hardcoverProduct,
      id: productId
    });

    return {
      success: true,
      productId
    };

  } catch (error: any) {
    return {
      success: false,
      productId: '',
      error: error.message
    };
  }
}

/**
 * Gets all active print products
 */
export async function getActivePrintProducts(): Promise<PrintProduct[]> {
  const firestore = await getServerFirestore();
  const snapshot = await firestore
    .collection('printProducts')
    .where('active', '==', true)
    .orderBy('displayOrder', 'asc')
    .get();

  return snapshot.docs.map(doc => doc.data() as PrintProduct);
}

/**
 * Gets a specific print product by ID
 */
export async function getPrintProduct(productId: string): Promise<PrintProduct | null> {
  const firestore = await getServerFirestore();
  const doc = await firestore.collection('printProducts').doc(productId).get();

  if (!doc.exists) {
    return null;
  }

  return doc.data() as PrintProduct;
}
