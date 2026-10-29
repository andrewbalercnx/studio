import { z } from 'zod';
import { ownerFields, stampFields } from './common';

/** Creation modes that survive the rebuild (creation.md). */
export const CREATION_MODE_IDS = ['wizard', 'freeplay', 'guided', 'friends', 'adventure'] as const;
export const creationModeIdSchema = z.enum(CREATION_MODE_IDS);
export type CreationModeId = z.infer<typeof creationModeIdSchema>;

/** Story lifecycle (pipeline.md). */
export const STORY_STATUSES = ['creating', 'finishing', 'complete', 'abandoned', 'failed'] as const;
export const storyStatusSchema = z.enum(STORY_STATUSES);
export type StoryStatus = z.infer<typeof storyStatusSchema>;

/** One entry in a Story's single cast list (domain-model.md "Cast"). */
export const castMemberSchema = z.object({
  /** Stable within the Story; text refers to it as `[[cast:<castId>]]`. */
  castId: z.string().min(1),
  ref: z.object({
    kind: z.enum(['child', 'character']),
    id: z.string().min(1),
  }),
  role: z.enum(['hero', 'supporting']),
  addedBy: z.enum(['setup', 'child', 'ai']),
});
export type CastMember = z.infer<typeof castMemberSchema>;

/** `stories/{storyId}`: replaces today's session and story (ADR-0004). */
export const storySchema = z.object({
  ...ownerFields,
  childId: z.string().min(1),
  mode: creationModeIdSchema,
  /** Only for the `adventure` mode, which follows a StoryType's arc. */
  storyTypeId: z.string().min(1).nullable().default(null),
  cast: z.array(castMemberSchema).default([]),
  status: storyStatusSchema,
  /** Final text with `[[cast:id]]` tokens; set when the mode reports `done`. */
  text: z.string().nullable().default(null),
  title: z.string().nullable().default(null),
  synopsis: z.string().nullable().default(null),
  ...stampFields,
});
export type Story = z.infer<typeof storySchema>;
