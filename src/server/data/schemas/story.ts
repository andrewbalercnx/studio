import { z } from 'zod';
import { ownerFields, stampFields, timestampSchema } from './common';

/** Creation modes that survive the rebuild (creation.md). */
export const CREATION_MODE_IDS = ['wizard', 'freeplay', 'guided', 'friends', 'adventure'] as const;
export const creationModeIdSchema = z.enum(CREATION_MODE_IDS);
export type CreationModeId = z.infer<typeof creationModeIdSchema>;

/** Story lifecycle (pipeline.md). */
export const STORY_STATUSES = ['creating', 'finishing', 'complete', 'abandoned', 'failed'] as const;
export const storyStatusSchema = z.enum(STORY_STATUSES);
export type StoryStatus = z.infer<typeof storyStatusSchema>;

/**
 * Marks a target-shaped Story (slice 5.3). Legacy `stories` documents written
 * by today's flows have no `schemaVersion` (and `parentUid` instead of
 * `ownerUid`); the Firestore rules and `books/story-source.ts` tell the two
 * apart by this field until the trial-data reset (slice 5.4).
 */
export const STORY_SCHEMA_VERSION = 2;

/** One entry in a Story's single cast list (domain-model.md "Cast"). */
export const castMemberSchema = z.object({
  /** Stable within the Story; text refers to it as `[[cast:<castId>]]`. Equal to `ref.id` (slice 5.3). */
  castId: z.string().min(1),
  ref: z.object({
    kind: z.enum(['child', 'character']),
    id: z.string().min(1),
  }),
  role: z.enum(['hero', 'supporting']),
  addedBy: z.enum(['setup', 'child', 'ai']),
});
export type CastMember = z.infer<typeof castMemberSchema>;

/** The turn being processed: a claim keyed by the request's idempotency key (slice 5.3). */
export const pendingTurnSchema = z.object({
  idempotencyKey: z.string().min(1),
  leaseUntil: timestampSchema,
});

/** `stories/{storyId}`: replaces today's session and story (ADR-0004). Server-written only. */
export const storySchema = z.object({
  ...ownerFields,
  schemaVersion: z.literal(STORY_SCHEMA_VERSION).default(STORY_SCHEMA_VERSION),
  childId: z.string().min(1),
  modeId: creationModeIdSchema,
  /** Only for the `adventure` mode, which follows a StoryType's arc. */
  storyTypeId: z.string().min(1).nullable().default(null),
  cast: z.array(castMemberSchema).default([]),
  status: storyStatusSchema,
  /** Final text with `[[cast:id]]` tokens; set when the mode reports `done`. */
  text: z.string().nullable().default(null),
  title: z.string().nullable().default(null),
  synopsis: z.string().nullable().default(null),
  /** A title the mode proposed with its final text (wizard, friends); `story.finish` uses it. */
  titleHint: z.string().nullable().default(null),
  /** The engine's state between turns. Mode-specific; never sent by or trusted from a client. */
  modeState: z.record(z.unknown()).default({}),
  /** Turns recorded so far (`turns/{index}`). */
  turnCount: z.number().int().nonnegative().default(0),
  pendingTurn: pendingTurnSchema.nullable().default(null),
  /** The client key `POST /api/stories` was called with (the id is derived from it). */
  idempotencyKey: z.string().min(1).nullable().default(null),
  /** Latest `story.finish` job. */
  finishJobId: z.string().min(1).nullable().default(null),
  /** How many times finishing was started (a retry after `failed` enqueues a new job). */
  finishRuns: z.number().int().nonnegative().default(0),
  /** The story allowance decision, made once in the transaction that sets `complete`. */
  allowance: z
    .object({
      charged: z.boolean(),
      remaining: z.number().nullable(),
      reason: z.string().nullable(),
    })
    .nullable()
    .default(null),
  error: z.object({ code: z.string(), message: z.string() }).nullable().default(null),
  completedAt: timestampSchema.nullable().default(null),
  abandonedAt: timestampSchema.nullable().default(null),
  ...stampFields,
});
export type Story = z.infer<typeof storySchema>;

// ---------------------------------------------------------------------------
// Turns: stories/{storyId}/turns/{index}
// ---------------------------------------------------------------------------

/** What a child sends (creation.md). */
export const childInputSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('choice'), optionId: z.string().min(1).max(64) }),
  z.object({ kind: z.literal('text'), text: z.string().trim().min(1).max(2000) }),
  z.object({ kind: z.literal('castPick'), castIds: z.array(z.string().min(1).max(128)).max(20) }),
]);
export type ChildInput = z.infer<typeof childInputSchema>;

export const turnOptionSchema = z.object({
  id: z.string().min(1),
  /** With `[[cast:id]]` tokens. */
  text: z.string(),
  /** Names resolved: what the child sees. */
  display: z.string(),
  /** castPick turns: proposed by the mode. */
  preselected: z.boolean().default(false),
});
export type TurnOption = z.infer<typeof turnOptionSchema>;

export const TURN_EXPECTS = ['choice', 'text', 'castPick'] as const;

export const turnSchema = z.object({
  ...ownerFields,
  childId: z.string().min(1),
  /** Position in the conversation, from 0; also the document id (zero-padded). */
  index: z.number().int().nonnegative(),
  role: z.enum(['ai', 'child']),
  /** `prompt`: the mode asks; `input`: the child answers; `done`: the mode finished the text. */
  kind: z.enum(['prompt', 'input', 'done']),
  /** The request that produced this turn (create or add-turn); a repeat returns the same turns. */
  idempotencyKey: z.string().min(1).nullable().default(null),
  prompt: z.string().nullable().default(null),
  promptDisplay: z.string().nullable().default(null),
  options: z.array(turnOptionSchema).nullable().default(null),
  /** What input the prompt expects (UI hint; the mode validates). */
  expects: z.enum(TURN_EXPECTS).nullable().default(null),
  progress: z.object({ step: z.number().int().nonnegative(), of: z.number().int().positive().nullable() }).nullable().default(null),
  /** castIds this turn added to the Story's cast. */
  addedCast: z.array(z.string().min(1)).default([]),
  input: childInputSchema.nullable().default(null),
  /** The child's input as words (the chosen option's text, the typed text, the picked names). */
  inputDisplay: z.string().nullable().default(null),
  ...stampFields,
});
export type StoryTurn = z.infer<typeof turnSchema>;

/** `turns/{index}` document id: zero-padded so ids sort in conversation order. */
export function turnDocId(index: number): string {
  return String(index).padStart(4, '0');
}
