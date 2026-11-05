import { z } from 'zod';
import { jobSummarySchema } from './common';

/**
 * Likeness, embedded in Child and Character (domain-model.md, ADR-0006, slice 5.7).
 *
 * `appearance` is generated from `photos` only (CLAUDE.md rule); `portrait` is
 * the canonical portrait drawn from `photos` only; `avatar` and
 * `avatarAnimation` are UI only and are never fed to image generation as a
 * likeness. `avatarSource` says what the avatar was made from: `description`
 * avatars are shown as "imagined".
 */
export const AVATAR_SOURCES = ['portrait', 'description', 'photo'] as const;
export const avatarSourceSchema = z.enum(AVATAR_SOURCES);
export type AvatarSource = z.infer<typeof avatarSourceSchema>;

export const likenessSchema = z.object({
  photos: z.array(z.string().min(1)).default([]),
  appearance: z.string().nullable().default(null),
  portrait: z.string().nullable().default(null),
  avatar: z.string().nullable().default(null),
  avatarSource: avatarSourceSchema.nullable().default(null),
  avatarAnimation: z.string().nullable().default(null),
  /** Latest job for each part, shown as separate progress. */
  likenessJob: z
    .object({
      describe: jobSummarySchema.nullable().default(null),
      portrait: jobSummarySchema.nullable().default(null),
      avatar: jobSummarySchema.nullable().default(null),
      animate: jobSummarySchema.nullable().default(null),
    })
    .default({ describe: null, portrait: null, avatar: null, animate: null }),
});
export type Likeness = z.infer<typeof likenessSchema>;
