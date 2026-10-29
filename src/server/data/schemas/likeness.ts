import { z } from 'zod';
import { jobSummarySchema } from './common';

/**
 * Likeness, embedded in Child and Character (domain-model.md, ADR-0006).
 *
 * `appearance` is generated from `photos` only (CLAUDE.md rule); `portrait` is
 * the canonical portrait drawn from `photos`; `avatar` is UI-only and is never
 * fed to image generation as a likeness.
 */
export const likenessSchema = z.object({
  photos: z.array(z.string().min(1)).default([]),
  appearance: z.string().nullable().default(null),
  portrait: z.string().nullable().default(null),
  avatar: z.string().nullable().default(null),
  /** Latest `likeness.describe` and `likeness.portrait` jobs, shown as separate progress. */
  likenessJob: z
    .object({
      describe: jobSummarySchema.nullable().default(null),
      portrait: jobSummarySchema.nullable().default(null),
    })
    .default({ describe: null, portrait: null }),
});
export type Likeness = z.infer<typeof likenessSchema>;
