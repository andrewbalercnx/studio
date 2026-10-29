import { z } from 'zod';
import { ownerFields, stampFields } from './common';

/** Manuscript lifecycle (pipeline.md). Narration runs alongside and does not change it. */
export const MANUSCRIPT_STATUSES = ['draft', 'paginating', 'ready', 'failed'] as const;
export const manuscriptStatusSchema = z.enum(MANUSCRIPT_STATUSES);
export type ManuscriptStatus = z.infer<typeof manuscriptStatusSchema>;

/** `manuscripts/{manuscriptId}`: the words of a Story in a Form, split into story pages. */
export const manuscriptSchema = z.object({
  ...ownerFields,
  storyId: z.string().min(1),
  /** Denormalised from the Story so the persona guard can check it without a second read. */
  childId: z.string().min(1),
  /** Form id (`picture_book`, `poem`, ...); the Form declares allowed lengths and densities. */
  form: z.string().min(1),
  readingLevel: z.string().min(1),
  /** Number of story pages (12, 16 or 24 for picture books, ADR-0011). Fixed once created. */
  length: z.number().int().positive(),
  /** Text density id declared by the Form and matched by Layouts. Fixed once created. */
  density: z.string().min(1),
  status: manuscriptStatusSchema,
  narration: z
    .object({
      voiceId: z.string().min(1),
    })
    .nullable()
    .default(null),
  ...stampFields,
});
export type Manuscript = z.infer<typeof manuscriptSchema>;

/** What a page shows; image prompts are built from `presentCast`, never by scraping text. */
export const sceneSchema = z.object({
  location: z.string(),
  /** castIds of the Story's cast members on this page. */
  presentCast: z.array(z.string().min(1)),
  action: z.string(),
});
export type Scene = z.infer<typeof sceneSchema>;

/** `manuscripts/{id}/pages/{n}`: one story page. */
export const manuscriptPageSchema = z.object({
  ...ownerFields,
  /** 1-based page number; also the document id. */
  pageNumber: z.number().int().positive(),
  /** The words a child reads, with display names already resolved. */
  text: z.string(),
  scene: sceneSchema,
  narrationUrl: z.string().nullable().default(null),
  ...stampFields,
});
export type ManuscriptPage = z.infer<typeof manuscriptPageSchema>;
