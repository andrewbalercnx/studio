'use client';
import { Label } from '@/components/ui/label';
import type { PrintProduct } from '@/lib/types';
import { z } from 'zod';

export const positiveNumber = z.preprocess(
  (val) => Number(val),
  z.number({ invalid_type_error: 'Must be a number' }).positive({ message: 'Must be > 0' })
);

export const nonNegativeNumber = z.preprocess(
  (val) => Number(val),
  z.number({ invalid_type_error: 'Must be a number' }).min(0, { message: 'Must be >= 0' })
);

export const numberOrNull = z.preprocess(
  (val) => (val === '' || val === undefined || val === null ? null : Number(val)),
  z.number().nullable()
);

// Trim size schema
export const trimSizeSchema = z.object({
  width: positiveNumber,
  height: positiveNumber,
  label: z.string().min(1, 'Label is required'),
});

// Pricing tier schema
export const pricingTierSchema = z.object({
  minQuantity: z.coerce.number().min(1, 'Min must be >= 1'),
  maxQuantity: numberOrNull,
  basePrice: nonNegativeNumber,
  setupFee: z.preprocess(
    (val) => (val === '' || val === undefined ? 0 : Number(val)),
    z.number().min(0)
  ),
});

// Form schema for PrintProduct
export const printProductFormSchema = z.object({
  id: z.string().optional(),
  name: z.string().min(1, 'Name is required'),
  description: z.string().min(1, 'Description is required'),
  active: z.boolean(),
  displayOrder: z.coerce.number().min(0),

  // Page composition settings
  blankPages: z.coerce.number().min(0),
  spine: z.boolean(),

  // Mixam specifications
  mixamSpec: z.object({
    product: z.literal('books'),
    subProduct: z.enum(['hardcover_poth', 'hardcover_pura', 'paperback']),

    cover: z.object({
      type: z.literal('COVER'),
      pages: z.literal(4),
      material: z.object({
        type: z.enum(['silk', 'gloss', 'uncoated', 'linen', 'buckram']),
        weight: positiveNumber,
        units: z.literal('GSM'),
        color: z.enum(['WHITE', 'BLACK', 'GREY', 'CREAM']),
      }),
      chromaticity: z.object({
        front: z.enum(['CMYK', 'BW']),
        back: z.enum(['CMYK', 'BW']),
      }),
    }),

    interior: z.object({
      type: z.literal('CONTENT'),
      material: z.object({
        type: z.enum(['silk', 'gloss', 'uncoated']),
        weight: positiveNumber,
        units: z.literal('GSM'),
        color: z.enum(['WHITE', 'CREAM', 'YELLOW']),
      }),
      chromaticity: z.object({
        front: z.enum(['CMYK', 'BW']),
        back: z.enum(['CMYK', 'BW']),
      }),
    }),

    binding: z.object({
      type: z.enum(['case', 'case_with_sewing', 'perfect_bound']),
      sewn: z.boolean().optional(),
      edge: z.enum(['LEFT_RIGHT', 'TOP_BOTTOM']),
      allowHeadTailBandSelection: z.boolean().optional(),
      allowRibbonSelection: z.boolean().optional(),
      allowEndPaperSelection: z.boolean().optional(),
    }),

    format: z.object({
      minPageCount: z.coerce.number().min(1),
      maxPageCount: z.coerce.number().min(1),
      pageCountIncrement: z.coerce.number().min(1),
      allowedTrimSizes: z.array(trimSizeSchema).min(1, 'At least one trim size required'),
      orientation: z.enum(['PORTRAIT', 'LANDSCAPE', 'SQUARE']),
      bleedRequired: nonNegativeNumber,
    }),

    files: z.object({
      separateCoverAndInterior: z.boolean(),
      colorSpace: z.enum(['CMYK', 'RGB']),
      minDPI: z.coerce.number().min(72),
      maxFileSize: z.coerce.number().min(1),
    }),
  }),

  pricingTiers: z.array(pricingTierSchema).min(1, 'At least one pricing tier required'),

  shippingCost: z.object({
    baseRate: nonNegativeNumber,
    perItemRate: z.preprocess(
      (val) => (val === '' || val === undefined ? 0 : Number(val)),
      z.number().min(0)
    ),
  }),

  imageUrl: z.string().optional(),

  // Mixam catalogue mapping (optional)
  mixamMapping: z.any().optional(),
});

export type PrintProductFormValues = z.infer<typeof printProductFormSchema>;

export const defaultFormValues: PrintProductFormValues = {
  name: '',
  description: '',
  active: true,
  displayOrder: 1,
  blankPages: 0,
  spine: true,
  mixamSpec: {
    product: 'books',
    subProduct: 'hardcover_poth',
    cover: {
      type: 'COVER',
      pages: 4,
      material: {
        type: 'silk',
        weight: 200,
        units: 'GSM',
        color: 'WHITE',
      },
      chromaticity: {
        front: 'CMYK',
        back: 'CMYK',
      },
    },
    interior: {
      type: 'CONTENT',
      material: {
        type: 'silk',
        weight: 170,
        units: 'GSM',
        color: 'WHITE',
      },
      chromaticity: {
        front: 'CMYK',
        back: 'CMYK',
      },
    },
    binding: {
      type: 'case',
      sewn: false,
      edge: 'LEFT_RIGHT',
      allowHeadTailBandSelection: true,
      allowRibbonSelection: true,
      allowEndPaperSelection: true,
    },
    format: {
      minPageCount: 24,
      maxPageCount: 48,
      pageCountIncrement: 4,
      allowedTrimSizes: [
        { width: 203.2, height: 254, label: '8×10 inches (Portrait)' },
      ],
      orientation: 'PORTRAIT',
      bleedRequired: 3.175,
    },
    files: {
      separateCoverAndInterior: true,
      colorSpace: 'CMYK',
      minDPI: 300,
      maxFileSize: 2147483648,
    },
  },
  pricingTiers: [
    { minQuantity: 1, maxQuantity: 10, basePrice: 15.0, setupFee: 0 },
  ],
  shippingCost: {
    baseRate: 5.0,
    perItemRate: 0.5,
  },
};
