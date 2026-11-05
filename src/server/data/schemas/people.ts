import { z } from 'zod';
import { likenessSchema } from './likeness';

/**
 * Child and Character as the server reads them (domain-model.md, slice 5.7).
 *
 * Stored documents are in transition: until the 5.7b migration has run, many
 * still carry the old field names (`ownerParentUid`, `imageDescription`,
 * `canonicalImageUrl`, `avatarUrl`, `avatarAnimationUrl`). They are read
 * through `src/server/characters/entities.ts`, which maps either shape onto
 * these schemas; the server never writes the old shape on its own (jobs mirror
 * their outputs into the old fields only while old clients still read them).
 */
const profileFields = {
  ownerUid: z.string().min(1),
  displayName: z.string().min(1),
  namePronunciation: z.string().nullable().default(null),
  pronouns: z.string().nullable().default(null),
  description: z.string().nullable().default(null),
  likes: z.array(z.string()).default([]),
  dislikes: z.array(z.string()).default([]),
  dateOfBirth: z.string().nullable().default(null),
  likeness: likenessSchema,
  deleted: z.boolean().default(false),
};

export const childSchema = z.object({
  ...profileFields,
  preferredVoiceId: z.string().nullable().default(null),
  autoReadAloud: z.boolean().default(true),
});
export type Child = z.infer<typeof childSchema>;

export const characterSchema = z.object({
  ...profileFields,
  type: z.string().nullable().default(null),
  relationship: z.string().nullable().default(null),
  /** A character for one child only; null = the whole family. */
  childId: z.string().nullable().default(null),
  origin: z.enum(['parent', 'story']).default('parent'),
  originStoryId: z.string().nullable().default(null),
  usageCount: z.number().int().nonnegative().default(0),
});
export type Character = z.infer<typeof characterSchema>;

export type PersonKind = 'child' | 'character';
export const COLLECTION_FOR: Record<PersonKind, 'children' | 'characters'> = { child: 'children', character: 'characters' };

/** Profile fields a parent may edit (zod allowlist for the PATCH routes). */
export const editableProfileSchema = z.object({
  displayName: z.string().trim().min(1).max(60),
  namePronunciation: z.string().trim().max(60).nullable(),
  pronouns: z.string().trim().max(30).nullable(),
  description: z.string().trim().max(600).nullable(),
  likes: z.array(z.string().trim().min(1).max(60)).max(20),
  dislikes: z.array(z.string().trim().min(1).max(60)).max(20),
  dateOfBirth: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
});

export const editableChildSchema = editableProfileSchema.extend({
  preferredVoiceId: z.string().trim().min(1).max(80).nullable(),
  autoReadAloud: z.boolean(),
});

export const editableCharacterSchema = editableProfileSchema.extend({
  type: z.string().trim().min(1).max(30).nullable(),
  relationship: z.string().trim().max(60).nullable(),
  childId: z.string().trim().min(1).nullable(),
});
