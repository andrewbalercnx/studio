/**
 * Form: what kind of book a Manuscript is (domain-model.md "Configuration").
 *
 * The target collection is `forms/{formId}`. Until the config is re-seeded, Forms
 * are read from today's curated `storyOutputTypes` collection and mapped onto the
 * target shape here (docs/architecture/target/slices/5.1-book-server.md):
 *
 *   storyOutputTypes.category                     → Form.category
 *   storyOutputTypes.paginationPrompt             → Form.paginationPrompt
 *   storyOutputTypes.aiHints.style / allowRhyme   → Form.styleHint / Form.rhymes
 *   storyOutputTypes.layoutHints.pageCount        → Form.defaultLength (nearest allowed length)
 *   storyOutputTypes.layoutHints.textDensity      → Form.defaultDensity (very_low → picture-led,
 *                                                   low → balanced, medium → text-led)
 *   storyOutputTypes.ageRange                     → Form.readingLevel
 *   storyOutputTypes.status                       → Form.status (only `live` Forms can be chosen)
 *
 * Allowed lengths: picture books 12, 16 or 24 story pages (ADR-0011); every other
 * category one length (its `pageCount`, or the category default). A document may
 * already carry the target fields (`allowedLengths`, `defaultLength`, `densities`,
 * `defaultDensity`); when present they win, so the re-seeded `forms` can be read
 * with the same mapper.
 */
import type { Firestore } from 'firebase-admin/firestore';
import { z } from 'zod';

export const PICTURE_BOOK_LENGTHS = [12, 16, 24] as const;

/** Text density ids (ADR-0001): how much of each page is words. */
export const DENSITIES = ['picture-led', 'balanced', 'text-led'] as const;
export type Density = (typeof DENSITIES)[number];

export const FORM_CATEGORIES = ['picture_book', 'poem', 'coloring_pages', 'audio_script'] as const;
export type FormCategory = (typeof FORM_CATEGORIES)[number];

/** One length for categories without a menu, when the document gives none. */
const CATEGORY_DEFAULT_LENGTH: Record<FormCategory, number> = {
  picture_book: 16,
  poem: 8,
  coloring_pages: 12,
  audio_script: 6,
};

const LEGACY_DENSITY: Record<string, Density> = {
  very_low: 'picture-led',
  low: 'balanced',
  medium: 'text-led',
};

/** Prompt guidance per density, used by `manuscript.paginate`. */
export const DENSITY_GUIDANCE: Record<Density, string> = {
  'picture-led': 'Picture-led: the pictures carry the story. Keep each page to one or two short sentences (about 5-20 words).',
  balanced: 'Balanced: about 2-4 short sentences per page (about 15-40 words).',
  'text-led': 'Text-led: fuller pages, a short paragraph each (about 40-80 words).',
};

export type Form = {
  formId: string;
  name: string;
  status: 'live' | 'draft' | 'archived';
  category: FormCategory;
  allowedLengths: number[];
  defaultLength: number;
  densities: Density[];
  defaultDensity: Density;
  readingLevel: string;
  paginationPrompt: string | null;
  styleHint: string | null;
  rhymes: boolean;
};

const densitySchema = z.enum(DENSITIES);

/** The fields read from a `storyOutputTypes` (or `forms`) document; everything else is ignored. */
const formDocSchema = z
  .object({
    name: z.string().optional(),
    status: z.enum(['live', 'draft', 'archived']).optional(),
    category: z.enum(FORM_CATEGORIES).optional(),
    ageRange: z.string().optional(),
    paginationPrompt: z.string().nullable().optional(),
    layoutHints: z
      .object({
        pageCount: z.number().optional(),
        textDensity: z.string().optional(),
      })
      .partial()
      .nullable()
      .optional(),
    aiHints: z
      .object({
        style: z.string().optional(),
        allowRhyme: z.boolean().optional(),
      })
      .partial()
      .nullable()
      .optional(),
    // Target-shape fields (re-seeded `forms`).
    allowedLengths: z.array(z.number().int().positive()).min(1).optional(),
    defaultLength: z.number().int().positive().optional(),
    densities: z.array(densitySchema).min(1).optional(),
    defaultDensity: densitySchema.optional(),
    readingLevel: z.string().optional(),
  })
  .passthrough();

function nearest(values: readonly number[], target: number): number {
  return values.reduce((best, v) => (Math.abs(v - target) < Math.abs(best - target) ? v : best), values[0]);
}

/** Map a curated document onto a Form. Returns null when it cannot be one (no category). */
export function formFromDocument(formId: string, raw: unknown): Form | null {
  const parsed = formDocSchema.safeParse(raw ?? {});
  if (!parsed.success) {
    console.error(`[catalog] Form ${formId} is malformed`, parsed.error.issues);
    return null;
  }
  const doc = parsed.data;
  const category = doc.category ?? 'picture_book';
  const hintedLength = doc.layoutHints?.pageCount && doc.layoutHints.pageCount > 0 ? Math.round(doc.layoutHints.pageCount) : null;

  let allowedLengths: number[];
  if (doc.allowedLengths) {
    allowedLengths = [...new Set(doc.allowedLengths)].sort((a, b) => a - b);
  } else if (category === 'picture_book') {
    allowedLengths = [...PICTURE_BOOK_LENGTHS];
  } else {
    allowedLengths = [hintedLength ?? CATEGORY_DEFAULT_LENGTH[category]];
  }
  const defaultLength =
    doc.defaultLength && allowedLengths.includes(doc.defaultLength)
      ? doc.defaultLength
      : nearest(allowedLengths, hintedLength ?? CATEGORY_DEFAULT_LENGTH[category]);

  const densities = doc.densities ? [...new Set(doc.densities)] : [...DENSITIES];
  const legacyDensity = doc.layoutHints?.textDensity ? LEGACY_DENSITY[doc.layoutHints.textDensity] : undefined;
  const preferredDensity = doc.defaultDensity ?? legacyDensity ?? 'balanced';
  const defaultDensity = densities.includes(preferredDensity) ? preferredDensity : densities[0];

  return {
    formId,
    name: doc.name ?? formId,
    status: doc.status ?? 'live',
    category,
    allowedLengths,
    defaultLength,
    densities,
    defaultDensity,
    readingLevel: doc.readingLevel ?? (doc.ageRange?.trim() || 'all'),
    paginationPrompt: doc.paginationPrompt?.trim() || null,
    styleHint: doc.aiHints?.style?.trim() || null,
    rhymes: doc.aiHints?.allowRhyme === true,
  };
}

/** Today's collection holding Forms (renamed to `forms` when config is re-seeded). */
export const FORMS_COLLECTION = 'storyOutputTypes';

export async function loadForm(db: Firestore, formId: string): Promise<Form | null> {
  if (!formId) return null;
  const snapshot = await db.collection(FORMS_COLLECTION).doc(formId).get();
  return snapshot.exists ? formFromDocument(snapshot.id, snapshot.data()) : null;
}

export type ManuscriptShape = { length: number; density: Density };

/**
 * Resolve the length and density a Manuscript will have: the caller's choice when
 * the Form allows it, the Form's default otherwise. Returns the problem as a
 * string so the caller can choose the error.
 */
export function resolveManuscriptShape(
  form: Form,
  requested: { length?: number | null; density?: string | null }
): { ok: true; shape: ManuscriptShape } | { ok: false; field: 'length' | 'density'; message: string } {
  const length = requested.length ?? form.defaultLength;
  if (!form.allowedLengths.includes(length)) {
    return {
      ok: false,
      field: 'length',
      message: `${form.name} books have ${form.allowedLengths.join(', ')} story pages, not ${length}`,
    };
  }
  const density = (requested.density ?? form.defaultDensity) as Density;
  if (!form.densities.includes(density)) {
    return { ok: false, field: 'density', message: `${form.name} supports densities ${form.densities.join(', ')}` };
  }
  return { ok: true, shape: { length, density } };
}
