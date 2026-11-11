'use client';
import { z } from 'zod';

export type FontConfig = {
  value: string;
  label: string;
  cssFamily: string;
  description: string;
  fontWeight?: number;
  fontStyle?: 'italic' | 'normal';
};

export const AVAILABLE_FONTS: FontConfig[] = [
  // Child-friendly Google Fonts (embedded TTF)
  { value: 'Comic-Neue', label: 'Comic Neue', cssFamily: "'Comic Neue', cursive", description: 'friendly' },
  { value: 'Comic-Neue-Bold', label: 'Comic Neue Bold', cssFamily: "'Comic Neue', cursive", fontWeight: 700, description: 'friendly bold' },
  { value: 'Nunito', label: 'Nunito', cssFamily: "'Nunito', sans-serif", description: 'rounded' },
  { value: 'Patrick-Hand', label: 'Patrick Hand', cssFamily: "'Patrick Hand', cursive", description: 'handwritten' },
  { value: 'Quicksand', label: 'Quicksand', cssFamily: "'Quicksand', sans-serif", description: 'playful' },
  { value: 'Lexend', label: 'Lexend', cssFamily: "'Lexend', sans-serif", description: 'high readability' },
  // Helvetica family (sans-serif)
  { value: 'Helvetica', label: 'Helvetica', cssFamily: 'Helvetica, Arial, sans-serif', description: 'sans-serif' },
  { value: 'Helvetica-Bold', label: 'Helvetica Bold', cssFamily: 'Helvetica, Arial, sans-serif', fontWeight: 700, description: 'sans-serif bold' },
  { value: 'Helvetica-Oblique', label: 'Helvetica Oblique', cssFamily: 'Helvetica, Arial, sans-serif', fontStyle: 'italic', description: 'sans-serif italic' },
  { value: 'Helvetica-BoldOblique', label: 'Helvetica Bold Oblique', cssFamily: 'Helvetica, Arial, sans-serif', fontWeight: 700, fontStyle: 'italic', description: 'sans-serif bold italic' },
  // Times Roman family (serif)
  { value: 'TimesRoman', label: 'Times Roman', cssFamily: "'Times New Roman', Times, serif", description: 'serif' },
  { value: 'TimesRoman-Bold', label: 'Times Roman Bold', cssFamily: "'Times New Roman', Times, serif", fontWeight: 700, description: 'serif bold' },
  { value: 'TimesRoman-Italic', label: 'Times Roman Italic', cssFamily: "'Times New Roman', Times, serif", fontStyle: 'italic', description: 'serif italic' },
  { value: 'TimesRoman-BoldItalic', label: 'Times Roman Bold Italic', cssFamily: "'Times New Roman', Times, serif", fontWeight: 700, fontStyle: 'italic', description: 'serif bold italic' },
  // Courier family (monospace)
  { value: 'Courier', label: 'Courier', cssFamily: "'Courier New', Courier, monospace", description: 'monospace' },
  { value: 'Courier-Bold', label: 'Courier Bold', cssFamily: "'Courier New', Courier, monospace", fontWeight: 700, description: 'monospace bold' },
  { value: 'Courier-Oblique', label: 'Courier Oblique', cssFamily: "'Courier New', Courier, monospace", fontStyle: 'italic', description: 'monospace italic' },
  { value: 'Courier-BoldOblique', label: 'Courier Bold Oblique', cssFamily: "'Courier New', Courier, monospace", fontWeight: 700, fontStyle: 'italic', description: 'monospace bold italic' },
];

export const SAMPLE_TEXT = 'The Quick Brown Fox 1234567890';

export const positiveNumber = z.preprocess(
  (val) => Number(val),
  z.number({ invalid_type_error: "Must be a number" }).positive({ message: "Must be > 0" })
);

export const numberOrEmpty = z.preprocess(
  (val) => (val === '' || val === undefined || val === null) ? undefined : Number(val),
  z.number().optional()
);

/** A stored colour may be null (cleared); the form treats it as unset. */
const optionalString = z.preprocess((val) => (val === null || val === '' ? undefined : val), z.string().optional());

export const boxSchema = z.object({
  leaf: z.preprocess((val) => (val === undefined || val === null || val === '' ? 1 : val), z.coerce.number().min(1, "Leaf must be 1 or 2.").max(2, "Leaf must be 1 or 2.")),
  x: z.coerce.number(),
  y: z.coerce.number(),
  width: positiveNumber,
  height: positiveNumber,
});

// Text box schema with styling options
export const textLayoutBoxSchema = z.object({
  leaf: z.coerce.number().min(1).max(2).optional(),
  x: numberOrEmpty,
  y: numberOrEmpty,
  width: numberOrEmpty,
  height: numberOrEmpty,
  backgroundColor: optionalString,
  textColor: optionalString,
  borderRadius: numberOrEmpty,
}).optional();

// Image box schema
export const imageLayoutBoxSchema = z.object({
  leaf: z.coerce.number().min(1).max(2).optional(),
  x: numberOrEmpty,
  y: numberOrEmpty,
  width: numberOrEmpty,
  height: numberOrEmpty,
}).optional();

// Page layout config schema for cover/inside/back/title layouts
export const pageLayoutConfigSchema = z.object({
  textBoxEnabled: z.boolean().optional(),
  imageBoxEnabled: z.boolean().optional(),
  textBox: textLayoutBoxSchema,
  imageBox: imageLayoutBoxSchema,
}).optional();

// Page constraints schema
export const pageConstraintsSchema = z.object({
  minPages: numberOrEmpty,
  maxPages: numberOrEmpty,
  pageMultiple: z.enum(['1', '2', '4']).optional(),
}).optional();

export const printLayoutFormSchema = z.object({
  id: z.string().optional(),
  name: z.string().min(1, 'Name is required'),
  leafWidth: positiveNumber,
  leafHeight: positiveNumber,
  leavesPerSpread: z.enum(['1', '2']),
  // Typography settings
  font: optionalString,
  fontSize: numberOrEmpty,
  // Page-type-specific layouts
  coverLayout: pageLayoutConfigSchema,
  backCoverLayout: pageLayoutConfigSchema,
  insideLayout: pageLayoutConfigSchema,
  titlePageLayout: pageLayoutConfigSchema,
  // Print product link and page constraints
  printProductId: optionalString,
  pageConstraints: pageConstraintsSchema,
  // Legacy arrays: only a fallback for page types without their own layout (getLayoutForPageType),
  // so a template that sets cover/inside/back layouts needs none.
  textBoxes: z.array(boxSchema).default([]),
  imageBoxes: z.array(boxSchema).default([]),
});

export type PrintLayoutFormValues = z.infer<typeof printLayoutFormSchema>;

export const defaultFormValues: PrintLayoutFormValues = {
  name: '',
  leafWidth: 8.5,
  leafHeight: 11,
  leavesPerSpread: '1',
  font: 'Helvetica',
  fontSize: 24,
  coverLayout: {
    textBoxEnabled: true,
    imageBoxEnabled: true,
    imageBox: { x: 0, y: 0, width: 8.5, height: 11 },
    textBox: { x: 0.5, y: 7.5, width: 7.5, height: 3, backgroundColor: '#F5F5DC', textColor: undefined, borderRadius: 0.1 },
  },
  backCoverLayout: {
    textBoxEnabled: true,
    imageBoxEnabled: true,
    imageBox: { x: 0.85, y: 1.1, width: 6.8, height: 6.5 },
    textBox: { x: 0.5, y: 8.5, width: 7.5, height: 2, backgroundColor: '#4A7C59', textColor: '#FFFFFF', borderRadius: 0.1 },
  },
  insideLayout: {
    textBoxEnabled: true,
    imageBoxEnabled: true,
    imageBox: { x: 0, y: 0, width: 8.5, height: 11 },
    textBox: { x: 1, y: 1, width: 6.5, height: 9, backgroundColor: undefined, textColor: undefined, borderRadius: 0 },
  },
  titlePageLayout: {
    textBoxEnabled: true,
    imageBoxEnabled: false,
    textBox: { x: 1, y: 3, width: 6.5, height: 5, backgroundColor: undefined, textColor: undefined, borderRadius: 0 },
  },
  textBoxes: [{ leaf: 1, x: 1, y: 7, width: 6.5, height: 3 }],
  imageBoxes: [{ leaf: 1, x: 1, y: 1, width: 6.5, height: 5.5 }],
};
