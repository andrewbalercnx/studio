import type { PrintOrder, PrintableAssetMetadata, MixamProductMapping } from '@/lib/types';

/**
 * Mixam Public API Order Structure
 * Based on Mixam's Public API documentation
 * https://mixam.co.uk/documentation/api/public#orders
 */

export type MixamPaymentMethod = 'TEST_ORDER' | 'ACCOUNT' | 'CARD_ON_FILE';

export type MixamAddress = {
  company?: string;
  firstName: string;
  lastName: string;
  postcode: string;
  line1: string;
  line2?: string;
  line3?: string;
  town: string;
  county?: string;
  country: string; // ISO country code e.g., "GB"
  phoneNumber?: string;
  emailAddress: string;
};

export type MixamAsset = {
  url: string;
  name: string;
};

export type MixamSubstrate = {
  typeId: number;    // Paper type (1 = Silk, 2 = Gloss, 3 = Uncoated)
  weightId: number;  // Paper weight index (from catalogue)
  colourId: number;  // Paper color (0 = White)
};

export type MixamBinding = {
  type: string;      // "PUR", "CASE", "STAPLED", etc.
  edge?: string;     // "LEFT_RIGHT" or "TOP_BOTTOM"
  sewn?: boolean;
  headAndTailBands?: string;
};

export type MixamComponent = {
  componentType: 'BOUND' | 'COVER' | 'END_PAPERS' | 'DUST_JACKET';
  format: number;            // Size format ID (0-7 for DIN A0-A7) - always required
  standardSize?: string;     // For non-DIN sizes: e.g., 'IN_8_X_10' for 8"×10" (used WITH format)
  orientation: 'PORTRAIT' | 'LANDSCAPE';
  colours: 'PROCESS' | 'NONE';
  substrate: MixamSubstrate;
  pages?: number;
  lamination: 'NONE' | 'GLOSS' | 'MATT' | 'SOFT_TOUCH';
  binding?: MixamBinding;
  backColours?: 'PROCESS' | 'NONE';
  backLamination?: 'NONE' | 'GLOSS' | 'MATT';
  spineColours?: 'PROCESS' | 'NONE';  // Spine printing: NONE for blank spine
};

export type MixamItemSpecification = {
  copies: number;
  product: string;
  components: MixamComponent[];
};

export type MixamOrderItem = {
  product: string;          // "BOOK", "BROCHURES", etc.
  subProductId: number;
  quoteType: 'QUOTE' | 'ORDER';
  itemSpecification: MixamItemSpecification;
  assets: MixamAsset[];
  metadata: {
    externalItemId: string;
  };
};

export type MixamDelivery = {
  address: MixamAddress;
  itemDeliveryDetails: Array<{
    itemId: string;
    copies: number;
  }>;
};

export type MxJdfDocument = {
  metadata: {
    externalOrderId: string;
    statusCallbackUrl?: string;
  };
  orderItems: MixamOrderItem[];
  billingAddress: MixamAddress;
  invoiceAddress: MixamAddress;
  deliveries: MixamDelivery[];
  plainPackaging?: boolean;
  paymentMethod: 'TEST_ORDER' | 'ACCOUNT' | 'CARD_ON_FILE';
};

// Mixam format IDs for DIN sizes only
// DIN sizes: 0=A0, 1=A1, 2=A2, 3=A3, 4=A4, 5=A5, 6=A6, 7=A7
const DIN_FORMAT_IDS: Record<string, number> = {
  'A0': 0,
  'A1': 1,
  'A2': 2,
  'A3': 3,
  'A4': 4,
  'A5': 5,
  'A6': 6,
  'A7': 7,
};

// Standard (non-DIN) sizes from Mixam catalogue for Hardcover Photo Quality Books (Product 7, SubProduct 1)
// IMPORTANT: Only these sizes are supported for hardcover books!
// Queried from /api/public/products/metadata/7/1 -> standardSizes array
const STANDARD_SIZES: Record<string, { standardSize: string; format: number }> = {
  // 8x10 is NOT supported - map to closest: Letter (8.5x11)
  '8x10': { standardSize: 'IN_8_5_X_11', format: 4 },   // Fallback to Letter
  '8.5x11': { standardSize: 'IN_8_5_X_11', format: 4 }, // Letter: 216mm × 279mm
  '6x9': { standardSize: 'US_ROYAL', format: 4 },       // US Royal: 152mm × 229mm (closest to 6x9)
  '5.5x8.5': { standardSize: 'DEMY', format: 4 },       // Demy: 138mm × 216mm (closest to 5.5x8.5)
  'novel': { standardSize: 'NOVEL', format: 5 },        // Novel: 127mm × 203mm
  'royal': { standardSize: 'ROYAL', format: 4 },        // Royal: 156mm × 234mm
  'square': { standardSize: 'SQUARE_210_MM', format: 4 }, // Square: 210mm × 210mm
};

// Mixam substrate type IDs (from MxJdf4 documentation)
// SILK(1), GLOSS(2), UNCOATED(3)
const SUBSTRATE_TYPES: Record<string, number> = {
  'silk': 1,
  'gloss': 2,
  'uncoated': 3,
  'matt': 1,
};

// Paper weight IDs from Mixam catalogue for BOOK product (ID 7), Hardcover sub-product (ID 1)
// NOTE: Weight IDs may vary between DIN sizes and standard (non-DIN) sizes!
// For DIN sizes with SILK substrate (typeId 1):
//   weightId 0 = 90gsm, 2 = 115gsm, 3 = 130gsm, 4 = 150gsm, 5 = 170gsm, 14 = 200gsm
// For standard sizes, the weight IDs might be different - using lower/common IDs as fallback
const WEIGHT_IDS_DIN: Record<number, number> = {
  90: 0,
  115: 2,
  130: 3,
  150: 4,
  170: 5,
  200: 14,
  250: 14,
  300: 14,
};

// For standard sizes, try simpler weight IDs that might be universally supported
const WEIGHT_IDS_STANDARD: Record<number, number> = {
  90: 0,
  115: 2,
  130: 3,
  150: 4,
  170: 4,  // Map to 150gsm ID as fallback
  200: 4,  // Map to 150gsm ID as fallback
  250: 4,
  300: 4,
};

const DEFAULT_INTERIOR_WEIGHT_ID_DIN = 5;      // 170gsm for DIN
const DEFAULT_COVER_WEIGHT_ID_DIN = 14;        // 200gsm for DIN
const DEFAULT_INTERIOR_WEIGHT_ID_STANDARD = 4; // 150gsm for standard sizes
const DEFAULT_COVER_WEIGHT_ID_STANDARD = 4;    // 150gsm for standard sizes

// For HARDCOVER (case-bound) books, the cover substrate is typically fixed
// Based on Mixam MxJdf4 documentation example for Hardcover Photo Quality Book:
// https://github.com/mixam-platform/MxJdf4
// - Cover uses typeId: 1 (SILK), weightId: 5 with MATT lamination
const HARDCOVER_COVER_SUBSTRATE = {
  typeId: 1,    // SILK - per Mixam documentation example
  weightId: 5,  // Per Mixam documentation example for hardcover covers
  colourId: 0,  // White
};

// For HARDCOVER end papers (required component)
// Based on Mixam MxJdf4 documentation: typeId: 0, weightId: 0, colourId: 1
const HARDCOVER_END_PAPER_SUBSTRATE = {
  typeId: 0,    // Standard end paper substrate
  weightId: 0,  // Standard weight
  colourId: 1,  // Colored end papers (1 = colored, per docs)
};

/**
 * Result of size parsing - either a DIN format ID or a standard size string
 */
type SizeResult = {
  type: 'din';
  format: number;
} | {
  type: 'standard';
  standardSize: string;
};

/**
 * Parses trim size string to get either a DIN format ID or standard size string
 * DIN sizes (A0-A7) use numeric format IDs
 * Non-DIN sizes (8x10, 6x9, etc.) use standardSize strings from Mixam catalogue
 */
function getSizeSpec(trimSize: string): SizeResult {
  const trimLower = trimSize?.toLowerCase() || '';

  // Check for DIN sizes first (A0-A7)
  for (const [key, formatId] of Object.entries(DIN_FORMAT_IDS)) {
    if (trimLower.includes(key.toLowerCase())) {
      return { type: 'din', format: formatId };
    }
  }

  // Check for standard (non-DIN) sizes
  if (trimLower.includes('8') && trimLower.includes('10')) {
    return { type: 'standard', standardSize: STANDARD_SIZES['8x10'].standardSize };
  }
  if (trimLower.includes('8.5') && trimLower.includes('11')) {
    return { type: 'standard', standardSize: STANDARD_SIZES['8.5x11'].standardSize };
  }
  if (trimLower.includes('6') && trimLower.includes('9')) {
    return { type: 'standard', standardSize: STANDARD_SIZES['6x9'].standardSize };
  }
  if (trimLower.includes('5.5') && trimLower.includes('8.5')) {
    return { type: 'standard', standardSize: STANDARD_SIZES['5.5x8.5'].standardSize };
  }

  // Default to A4 (DIN format)
  return { type: 'din', format: DIN_FORMAT_IDS['A4'] };
}

/**
 * Builds a Mixam Public API order document from a print order
 * If the product has a validated mixamMapping, uses those exact IDs.
 * Otherwise falls back to the legacy hardcoded mapping logic.
 *
 * @param params.billingAddress - Optional separate billing address.
 *   If provided, used for billingAddress and invoiceAddress in the Mixam order.
 *   If not provided, the shipping address is used for billing (legacy behavior).
 */
export function buildMxJdfDocument(params: {
  order: PrintOrder;
  metadata: PrintableAssetMetadata;
  coverFileRef: string;
  interiorFileRef: string;
  billingAddress?: {
    name: string;
    line1: string;
    line2?: string;
    city: string;
    state?: string;
    postalCode: string;
    country: string;
    email: string;
    phone?: string;
  };
  paymentMethod?: MixamPaymentMethod;
}): MxJdfDocument {
  const { order, metadata, coverFileRef, interiorFileRef, billingAddress, paymentMethod = 'ACCOUNT' } = params;
  const product = order.productSnapshot;
  const spec = product.mixamSpec;
  const mapping = product.mixamMapping;

  // Check if we have a validated direct mapping
  if (mapping?.validated) {
    console.log('[MxJdf] Using validated mixamMapping for precise Mixam IDs');
    return buildMxJdfFromMapping(params, mapping);
  }

  // Fall back to legacy logic with warning
  console.warn('[MxJdf] No validated mixamMapping found - using legacy hardcoded mappings');
  console.warn('[MxJdf] Consider adding a Mixam catalogue mapping in the Print Products admin');

  // Parse name into first/last
  const nameParts = order.shippingAddress.name.split(' ');
  const firstName = nameParts[0] || 'Customer';
  const lastName = nameParts.slice(1).join(' ') || 'Name';

  // Build shipping address object
  const shippingAddr: MixamAddress = {
    firstName,
    lastName,
    postcode: order.shippingAddress.postalCode,
    line1: order.shippingAddress.line1,
    line2: order.shippingAddress.line2 || undefined,
    town: order.shippingAddress.city,
    county: order.shippingAddress.state || order.shippingAddress.city,
    country: order.shippingAddress.country || 'GB',
    phoneNumber: (order as any).contactPhone || '+44 000 000 0000',
    emailAddress: order.contactEmail,
  };

  // Build billing address - use separate billing address if provided, otherwise use shipping address
  let billToAddr: MixamAddress;
  if (billingAddress) {
    const billNameParts = billingAddress.name.split(' ');
    const billFirstName = billNameParts[0] || 'Billing';
    const billLastName = billNameParts.slice(1).join(' ') || 'Contact';
    billToAddr = {
      firstName: billFirstName,
      lastName: billLastName,
      postcode: billingAddress.postalCode,
      line1: billingAddress.line1,
      line2: billingAddress.line2 || undefined,
      town: billingAddress.city,
      county: billingAddress.state || billingAddress.city,
      country: billingAddress.country || 'GB',
      phoneNumber: billingAddress.phone || '+44 000 000 0000',
      emailAddress: billingAddress.email,
    };
    console.log('[MxJdf] Using separate billing address');
  } else {
    billToAddr = shippingAddr;
    console.log('[MxJdf] Using shipping address for billing (no separate billing address provided)');
  }

  // Get size specification (DIN format ID or standard size string)
  const sizeSpec = getSizeSpec(metadata.trimSize);
  const isStandardSize = sizeSpec.type === 'standard';
  console.log(`[MxJdf] Trim size: "${metadata.trimSize}" -> ${sizeSpec.type === 'din' ? `DIN format: ${sizeSpec.format}` : `Standard size: ${sizeSpec.standardSize}`}`);

  // Get substrate types and weights - use different weight IDs for standard vs DIN sizes
  const weightIds = isStandardSize ? WEIGHT_IDS_STANDARD : WEIGHT_IDS_DIN;
  const defaultInteriorWeightId = isStandardSize ? DEFAULT_INTERIOR_WEIGHT_ID_STANDARD : DEFAULT_INTERIOR_WEIGHT_ID_DIN;
  const defaultCoverWeightId = isStandardSize ? DEFAULT_COVER_WEIGHT_ID_STANDARD : DEFAULT_COVER_WEIGHT_ID_DIN;

  const interiorSubstrateType = SUBSTRATE_TYPES[spec.interior.material.type] || 1;
  const interiorWeightId = weightIds[spec.interior.material.weight] || defaultInteriorWeightId;

  const coverSubstrateType = SUBSTRATE_TYPES[spec.cover.material.type] || 1;
  const coverWeightId = weightIds[spec.cover.material.weight] || defaultCoverWeightId;

  console.log(`[MxJdf] Size type: ${isStandardSize ? 'STANDARD' : 'DIN'}`);
  console.log(`[MxJdf] Interior: typeId=${interiorSubstrateType}, weightId=${interiorWeightId} (from ${spec.interior.material.type}/${spec.interior.material.weight}gsm)`);
  console.log(`[MxJdf] Cover: typeId=${coverSubstrateType}, weightId=${coverWeightId} (from ${spec.cover.material.type}/${spec.cover.material.weight}gsm)`);

  // Determine binding type
  let bindingType = 'PUR';
  if (spec.binding.type === 'case' || spec.binding.type === 'case_with_sewing') {
    bindingType = 'CASE';
  }
  console.log(`[MxJdf] Binding type: ${bindingType} (${bindingType === 'CASE' ? 'using hardcover fixed substrate' : 'using configured substrate'})`);
  // Note: 'stapled' is not in the PrintProduct binding type, but keep for future use

  // Normalize orientation (SQUARE -> PORTRAIT for Mixam)
  const orientation: 'PORTRAIT' | 'LANDSCAPE' =
    spec.format.orientation === 'LANDSCAPE' ? 'LANDSCAPE' : 'PORTRAIT';

  // Determine lamination
  let coverLamination: 'NONE' | 'GLOSS' | 'MATT' | 'SOFT_TOUCH' = 'NONE';
  if (spec.cover.material.refinings) {
    const lamRefining = spec.cover.material.refinings.find(r => r.type === 'LAMINATION');
    if (lamRefining) {
      if (lamRefining.effect === 'GLOSS') coverLamination = 'GLOSS';
      else if (lamRefining.effect === 'MATT') coverLamination = 'MATT';
      else if (lamRefining.effect === 'SOFT_TOUCH') coverLamination = 'SOFT_TOUCH';
    }
  }

  // External item ID for tracking
  const externalItemId = `ITEM-${order.id}`;

  // Mixam requires pages to be a multiple of 4
  // Round up to next multiple of 4
  const rawPageCount = metadata.interiorPageCount;
  const pageCount = Math.ceil(rawPageCount / 4) * 4;
  if (pageCount !== rawPageCount) {
    console.log(`[MxJdf] Adjusting page count from ${rawPageCount} to ${pageCount} (must be multiple of 4)`);
  }

  // Build the webhook URL
  let webhookUrl = process.env.MIXAM_WEBHOOK_URL;
  if (!webhookUrl && process.env.NEXT_PUBLIC_APP_URL) {
    webhookUrl = `${process.env.NEXT_PUBLIC_APP_URL}/api/webhooks/mixam`;
  }
  if (!webhookUrl) {
    webhookUrl = 'https://example.com/webhook';
  }

  const document: MxJdfDocument = {
    metadata: {
      externalOrderId: order.id!,
      statusCallbackUrl: webhookUrl,
    },
    orderItems: [
      {
        product: 'BOOK',
        subProductId: bindingType === 'CASE' ? 1 : 0,
        quoteType: 'QUOTE',
        itemSpecification: {
          copies: order.quantity,
          product: 'BOOK',
          components: [
            // Interior/bound component
            {
              componentType: 'BOUND',
              // For standard sizes: BOTH format AND standardSize are required
              // format = closest DIN size, standardSize = the actual non-DIN size
              format: sizeSpec.type === 'din' ? sizeSpec.format : DIN_FORMAT_IDS['A4'],
              ...(sizeSpec.type === 'standard' && { standardSize: sizeSpec.standardSize }),
              orientation: orientation,
              colours: 'PROCESS',
              substrate: {
                typeId: interiorSubstrateType,
                weightId: interiorWeightId,
                colourId: 0,
              },
              pages: pageCount,
              lamination: 'NONE',
              binding: {
                type: bindingType,
                edge: spec.binding.edge || 'LEFT_RIGHT',
                sewn: spec.binding.sewn || false,
                // Only include head/tail bands if the product allows selection AND a color was chosen
                headAndTailBands: spec.binding.allowHeadTailBandSelection && order.customOptions?.headTailBandColor
                  ? order.customOptions.headTailBandColor.toUpperCase().replace(/ /g, '_')
                  : 'NONE',
              },
            },
            // Cover component
            // For hardcover (case-bound) books, use fixed substrate since cover wraps board
            // Hardcover covers have backColours: NONE (inner side not printed)
            {
              componentType: 'COVER',
              // For standard sizes: BOTH format AND standardSize are required
              // format = closest DIN size, standardSize = the actual non-DIN size
              format: sizeSpec.type === 'din' ? sizeSpec.format : DIN_FORMAT_IDS['A4'],
              ...(sizeSpec.type === 'standard' && { standardSize: sizeSpec.standardSize }),
              orientation: orientation,
              colours: 'PROCESS',
              substrate: bindingType === 'CASE' ? HARDCOVER_COVER_SUBSTRATE : {
                typeId: coverSubstrateType,
                weightId: coverWeightId,
                colourId: 0,
              },
              lamination: coverLamination,
              // Hardcover covers: backColours must be NONE (inner side is glued to board)
              backColours: bindingType === 'CASE' ? 'NONE' : 'PROCESS',
              backLamination: 'NONE',
              // Spine is intentionally blank (no printing on spine)
              spineColours: 'NONE',
            },
            // End paper component - REQUIRED for hardcover (case-bound) books
            ...(bindingType === 'CASE' ? [{
              componentType: 'END_PAPERS' as const,
              format: sizeSpec.type === 'din' ? sizeSpec.format : DIN_FORMAT_IDS['A4'],
              ...(sizeSpec.type === 'standard' && { standardSize: sizeSpec.standardSize }),
              orientation: orientation,
              colours: 'NONE' as const,
              substrate: HARDCOVER_END_PAPER_SUBSTRATE,
              lamination: 'NONE' as const,
            }] : []),
          ],
        },
        assets: [
          {
            url: coverFileRef,
            name: `storybook-${order.id}-cover.pdf`,
          },
          {
            url: interiorFileRef,
            name: `storybook-${order.id}-interior.pdf`,
          },
          // Note: Padding pages are now embedded in the interior PDF
          // to ensure correct page ordering. No separate padding PDF needed.
        ],
        metadata: {
          externalItemId,
        },
      },
    ],
    billingAddress: billToAddr,
    invoiceAddress: billToAddr,
    deliveries: [
      {
        address: shippingAddr,
        itemDeliveryDetails: [
          {
            itemId: externalItemId,
            copies: order.quantity,
          },
        ],
      },
    ],
    plainPackaging: false,
    paymentMethod,
  };

  // Note: Padding pages are now embedded in the interior PDF
  if (metadata.paddingPageCount && metadata.paddingPageCount > 0) {
    console.log(`[MxJdf] Legacy path: Interior PDF includes ${metadata.paddingPageCount} blank padding pages`);
  }

  return document;
}

/**
 * Validates a Mixam order document structure
 */
export function validateMxJdfDocument(doc: MxJdfDocument): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (!doc.metadata?.externalOrderId) errors.push('metadata.externalOrderId is required');
  if (!doc.orderItems || doc.orderItems.length === 0) errors.push('At least one orderItem is required');
  if (!doc.billingAddress) errors.push('billingAddress is required');
  if (!doc.invoiceAddress) errors.push('invoiceAddress is required');
  if (!doc.deliveries || doc.deliveries.length === 0) errors.push('At least one delivery is required');
  if (!doc.paymentMethod) errors.push('paymentMethod is required');

  doc.orderItems.forEach((item, index) => {
    if (!item.product) errors.push(`orderItem[${index}]: product is required`);
    if (!item.itemSpecification) errors.push(`orderItem[${index}]: itemSpecification is required`);
    if (!item.assets || item.assets.length === 0) errors.push(`orderItem[${index}]: assets is required`);
    if (!item.metadata) errors.push(`orderItem[${index}]: metadata is required`);
  });

  const validateAddress = (addr: MixamAddress | undefined, name: string) => {
    if (!addr) {
      errors.push(`${name} is required`);
      return;
    }
    if (!addr.firstName) errors.push(`${name}.firstName is required`);
    if (!addr.lastName) errors.push(`${name}.lastName is required`);
    if (!addr.line1) errors.push(`${name}.line1 is required`);
    if (!addr.town) errors.push(`${name}.town is required`);
    if (!addr.postcode) errors.push(`${name}.postcode is required`);
    if (!addr.country) errors.push(`${name}.country is required`);
    if (!addr.emailAddress) errors.push(`${name}.emailAddress is required`);
  };

  validateAddress(doc.billingAddress, 'billingAddress');
  validateAddress(doc.invoiceAddress, 'invoiceAddress');
  doc.deliveries.forEach((d, i) => validateAddress(d.address, `deliveries[${i}].address`));

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Exports MxJdf document as JSON string (for debugging/logs)
 */
export function serializeMxJdfDocument(doc: MxJdfDocument): string {
  return JSON.stringify(doc, null, 2);
}

/**
 * Builds MxJdf document using a validated MixamProductMapping
 * This uses the exact IDs from the Mixam catalogue instead of hardcoded mappings
 */
function buildMxJdfFromMapping(
  params: {
    order: PrintOrder;
    metadata: PrintableAssetMetadata;
    coverFileRef: string;
    interiorFileRef: string;
    billingAddress?: {
      name: string;
      line1: string;
      line2?: string;
      city: string;
      state?: string;
      postalCode: string;
      country: string;
      email: string;
      phone?: string;
    };
    paymentMethod?: MixamPaymentMethod;
  },
  mapping: MixamProductMapping
): MxJdfDocument {
  const { order, metadata, coverFileRef, interiorFileRef, billingAddress, paymentMethod = 'ACCOUNT' } = params;

  // Parse name into first/last
  const nameParts = order.shippingAddress.name.split(' ');
  const firstName = nameParts[0] || 'Customer';
  const lastName = nameParts.slice(1).join(' ') || 'Name';

  // Build shipping address object
  const shippingAddr: MixamAddress = {
    firstName,
    lastName,
    postcode: order.shippingAddress.postalCode,
    line1: order.shippingAddress.line1,
    line2: order.shippingAddress.line2 || undefined,
    town: order.shippingAddress.city,
    county: order.shippingAddress.state || order.shippingAddress.city,
    country: order.shippingAddress.country || 'GB',
    phoneNumber: (order as any).contactPhone || '+44 000 000 0000',
    emailAddress: order.contactEmail,
  };

  // Build billing address - use separate billing address if provided, otherwise use shipping address
  let billToAddr: MixamAddress;
  if (billingAddress) {
    const billNameParts = billingAddress.name.split(' ');
    const billFirstName = billNameParts[0] || 'Billing';
    const billLastName = billNameParts.slice(1).join(' ') || 'Contact';
    billToAddr = {
      firstName: billFirstName,
      lastName: billLastName,
      postcode: billingAddress.postalCode,
      line1: billingAddress.line1,
      line2: billingAddress.line2 || undefined,
      town: billingAddress.city,
      county: billingAddress.state || billingAddress.city,
      country: billingAddress.country || 'GB',
      phoneNumber: billingAddress.phone || '+44 000 000 0000',
      emailAddress: billingAddress.email,
    };
    console.log('[MxJdf] Using separate billing address (mapping path)');
  } else {
    billToAddr = shippingAddr;
    console.log('[MxJdf] Using shipping address for billing (mapping path)');
  }

  // External item ID for tracking
  const externalItemId = `ITEM-${order.id}`;

  // Mixam requires pages to be a multiple of 4
  const rawPageCount = metadata.interiorPageCount;
  const pageCount = Math.ceil(rawPageCount / 4) * 4;
  if (pageCount !== rawPageCount) {
    console.log(`[MxJdf] Adjusting page count from ${rawPageCount} to ${pageCount} (must be multiple of 4)`);
  }

  // Build the webhook URL
  let webhookUrl = process.env.MIXAM_WEBHOOK_URL;
  if (!webhookUrl && process.env.NEXT_PUBLIC_APP_URL) {
    webhookUrl = `${process.env.NEXT_PUBLIC_APP_URL}/api/webhooks/mixam`;
  }
  if (!webhookUrl) {
    webhookUrl = 'https://example.com/webhook';
  }

  // Log the mapping being used
  console.log(`[MxJdf] Using mapping: productId=${mapping.productId}, subProductId=${mapping.subProductId}`);
  console.log(`[MxJdf] Bound component: format=${mapping.boundComponent.format}, standardSize=${mapping.boundComponent.standardSize || 'none'}`);
  console.log(`[MxJdf] Bound substrate: typeId=${mapping.boundComponent.substrate.typeId}, weightId=${mapping.boundComponent.substrate.weightId}`);
  console.log(`[MxJdf] Cover component: format=${mapping.coverComponent.format}, standardSize=${mapping.coverComponent.standardSize || 'none'}`);
  console.log(`[MxJdf] Cover substrate: typeId=${mapping.coverComponent.substrate.typeId}, weightId=${mapping.coverComponent.substrate.weightId}`);
  console.log(`[MxJdf] Binding: type=${mapping.binding.type}, edge=${mapping.binding.edge}`);

  // Build components array using exact IDs from the mapping
  const components: MixamComponent[] = [
    // Interior/bound component
    {
      componentType: 'BOUND',
      format: mapping.boundComponent.format,
      ...(mapping.boundComponent.standardSize && { standardSize: mapping.boundComponent.standardSize }),
      orientation: mapping.boundComponent.orientation,
      colours: 'PROCESS',
      substrate: {
        typeId: mapping.boundComponent.substrate.typeId,
        weightId: mapping.boundComponent.substrate.weightId,
        colourId: mapping.boundComponent.substrate.colourId,
      },
      pages: pageCount,
      lamination: 'NONE',
      binding: {
        type: mapping.binding.type,
        edge: mapping.binding.edge,
        sewn: mapping.binding.sewn || false,
        // Only include head/tail bands if the product allows selection AND a color was chosen
        headAndTailBands: order.productSnapshot.mixamSpec.binding.allowHeadTailBandSelection && order.customOptions?.headTailBandColor
          ? order.customOptions.headTailBandColor.toUpperCase().replace(/ /g, '_')
          : 'NONE',
      },
    },
    // Cover component
    {
      componentType: 'COVER',
      format: mapping.coverComponent.format,
      ...(mapping.coverComponent.standardSize && { standardSize: mapping.coverComponent.standardSize }),
      orientation: mapping.coverComponent.orientation,
      colours: 'PROCESS',
      substrate: {
        typeId: mapping.coverComponent.substrate.typeId,
        weightId: mapping.coverComponent.substrate.weightId,
        colourId: mapping.coverComponent.substrate.colourId,
      },
      lamination: mapping.coverComponent.lamination,
      backColours: mapping.coverComponent.backColours,
      backLamination: 'NONE',
      // Spine is intentionally blank (no printing on spine)
      spineColours: 'NONE',
    },
  ];

  // Add end papers component if specified (required for hardcover)
  if (mapping.endPapersComponent) {
    components.push({
      componentType: 'END_PAPERS',
      format: mapping.boundComponent.format,
      ...(mapping.boundComponent.standardSize && { standardSize: mapping.boundComponent.standardSize }),
      orientation: mapping.boundComponent.orientation,
      colours: 'NONE' as const,
      substrate: {
        typeId: mapping.endPapersComponent.substrate.typeId,
        weightId: mapping.endPapersComponent.substrate.weightId,
        colourId: mapping.endPapersComponent.substrate.colourId,
      },
      lamination: 'NONE',
    });
  }

  // Build assets array
  // Note: Padding pages are now embedded in the interior PDF to ensure correct page ordering
  const assets = [
    {
      url: coverFileRef,
      name: `storybook-${order.id}-cover.pdf`,
    },
    {
      url: interiorFileRef,
      name: `storybook-${order.id}-interior.pdf`,
    },
  ];

  if (metadata.paddingPageCount && metadata.paddingPageCount > 0) {
    console.log(`[MxJdf] Interior PDF includes ${metadata.paddingPageCount} blank padding pages`);
  }

  const document: MxJdfDocument = {
    metadata: {
      externalOrderId: order.id!,
      statusCallbackUrl: webhookUrl,
    },
    orderItems: [
      {
        product: 'BOOK',
        subProductId: mapping.subProductId,
        quoteType: 'QUOTE',
        itemSpecification: {
          copies: order.quantity,
          product: 'BOOK',
          components,
        },
        assets,
        metadata: {
          externalItemId,
        },
      },
    ],
    billingAddress: billToAddr,
    invoiceAddress: billToAddr,
    deliveries: [
      {
        address: shippingAddr,
        itemDeliveryDetails: [
          {
            itemId: externalItemId,
            copies: order.quantity,
          },
        ],
      },
    ],
    plainPackaging: false,
    paymentMethod,
  };

  return document;
}
