import { z } from 'zod';
import { jobSummarySchema, ownerFields, stampFields } from './common';
import { castMemberSchema } from './story';

/** Book lifecycle (pipeline.md). `partial` is an outcome, not an error (ADR-0003). */
export const BOOK_STATUSES = ['draft', 'illustrating', 'ready', 'partial', 'failed', 'locked'] as const;
export const bookStatusSchema = z.enum(BOOK_STATUSES);
export type BookStatus = z.infer<typeof bookStatusSchema>;

/** `books/{bookId}`: how a Manuscript looks (style + layout). */
export const bookSchema = z.object({
  ...ownerFields,
  manuscriptId: z.string().min(1),
  storyId: z.string().min(1),
  /** Denormalised from the Story so the persona guard can check it without a second read. */
  childId: z.string().min(1),
  styleId: z.string().min(1),
  layoutId: z.string().min(1),
  printProductId: z.string().min(1).nullable().default(null),
  status: bookStatusSchema,
  /** Progress rollup over the Book's pages, derived from their art jobs. */
  art: z
    .object({
      total: z.number().int().nonnegative(),
      done: z.number().int().nonnegative(),
      failed: z.number().int().nonnegative(),
    })
    .default({ total: 0, done: 0, failed: 0 }),
  ...stampFields,
});
export type Book = z.infer<typeof bookSchema>;

export const BOOK_PAGE_KINDS = ['cover', 'title', 'story', 'dedication', 'end', 'blank', 'back'] as const;
export const bookPageKindSchema = z.enum(BOOK_PAGE_KINDS);
export type BookPageKind = z.infer<typeof bookPageKindSchema>;

/** `books/{id}/pages/{n}`: one physical page. */
export const bookPageSchema = z.object({
  ...ownerFields,
  /** 1-based physical page number; also the document id. */
  pageNumber: z.number().int().positive(),
  kind: bookPageKindSchema,
  /** The Manuscript page shown here (story pages only). */
  manuscriptPage: z.number().int().positive().nullable().default(null),
  artUrl: z.string().nullable().default(null),
  artJob: jobSummarySchema.nullable().default(null),
  ...stampFields,
});
export type BookPage = z.infer<typeof bookPageSchema>;

/** `books/{id}/castSheets/{castId}`: one cast member's reference sheet in this Book's style. */
export const castSheetSchema = z.object({
  ...ownerFields,
  castId: z.string().min(1),
  ref: castMemberSchema.shape.ref,
  /** `portrait` when drawn from the canonical portrait; `appearance` when there were no photos. */
  source: z.enum(['portrait', 'appearance']),
  imageUrl: z.string().nullable().default(null),
  job: jobSummarySchema.nullable().default(null),
  ...stampFields,
});
export type CastSheet = z.infer<typeof castSheetSchema>;

export const RENDER_MEDIA = ['screen', 'print'] as const;
export const renderMediumSchema = z.enum(RENDER_MEDIA);

/** `books/{id}/renders/{renderId}`: immutable (ADR-0010); orders pin one. */
export const renderSchema = z.object({
  ...ownerFields,
  medium: renderMediumSchema,
  layoutId: z.string().min(1),
  files: z
    .array(
      z.object({
        /** e.g. `interior`, `cover`, `screen` */
        role: z.string().min(1),
        storagePath: z.string().min(1),
        url: z.string().nullable().default(null),
      })
    )
    .min(1),
  ...stampFields,
});
export type Render = z.infer<typeof renderSchema>;
