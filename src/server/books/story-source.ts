/**
 * The Book pipeline's input: a `stories/{storyId}` document, in either shape
 * while both exist.
 *
 * - **Target Story** (slice 5.3, `schemaVersion: 2`, written by the creation
 *   routes): read through the `stories` repository schema.
 *
 *     ownerUid ← ownerUid      text ← text (`[[cast:id]]` tokens)
 *     childId  ← childId       title, synopsis ← title, synopsis
 *     actorIds ← cast[].castId status ← status (only `complete` makes Books)
 *
 * - **Legacy story** (today's flows; no `schemaVersion`): read through its own
 *   permissive schema (slice 5.1 decision).
 *
 *     ownerUid ← parentUid     text ← storyText (`$$id$$` cast tokens)
 *     childId  ← childId       title ← metadata.title
 *     actorIds ← actors[]      synopsis ← synopsis
 *
 * LEGACY: the legacy branch is deleted in slice 5.4, when the clients create
 * Stories through the new routes and trial data is reset.
 */
import type { Firestore, Transaction } from 'firebase-admin/firestore';
import { z } from 'zod';
import { STORY_SCHEMA_VERSION, storySchema, type StoryStatus } from '../data/schemas/story';
import { DataIntegrityError, NotFoundError } from '../errors';

export type StorySource = {
  storyId: string;
  ownerUid: string | null;
  childId: string | null;
  text: string;
  title: string | null;
  synopsis: string | null;
  actorIds: string[];
  /** Target Stories only; null for legacy documents (their text existing means finished). */
  status: StoryStatus | null;
  shape: 'story' | 'legacy';
};

/** True for a document written by the creation routes (slice 5.3). */
export function isTargetStory(raw: unknown): boolean {
  return !!raw && typeof raw === 'object' && (raw as { schemaVersion?: unknown }).schemaVersion === STORY_SCHEMA_VERSION;
}

// LEGACY (delete in slice 5.4) ------------------------------------------------
const legacyStorySchema = z
  .object({
    parentUid: z.string().optional().nullable(),
    childId: z.string().optional().nullable(),
    storyText: z.string().optional().nullable(),
    synopsis: z.string().optional().nullable(),
    actors: z.array(z.unknown()).optional().nullable(),
    metadata: z.object({ title: z.string().optional().nullable() }).passthrough().optional().nullable(),
  })
  .passthrough();

function legacyStoryFromDocument(storyId: string, raw: unknown): StorySource {
  const parsed = legacyStorySchema.safeParse(raw ?? {});
  const doc: z.infer<typeof legacyStorySchema> = parsed.success ? parsed.data : {};
  return {
    storyId,
    ownerUid: doc.parentUid || null,
    childId: doc.childId || null,
    text: doc.storyText ?? '',
    title: doc.metadata?.title?.trim() || null,
    synopsis: doc.synopsis?.trim() || null,
    actorIds: (doc.actors ?? []).filter((id): id is string => typeof id === 'string' && id.trim().length > 0),
    status: null,
    shape: 'legacy',
  };
}
// -----------------------------------------------------------------------------

function targetStoryFromDocument(storyId: string, raw: unknown): StorySource {
  const parsed = storySchema.safeParse(raw);
  if (!parsed.success) {
    console.error(`[story-source] stories/${storyId} failed schema validation`, parsed.error.issues);
    throw new DataIntegrityError(`stories/${storyId}`, parsed.error.issues);
  }
  const story = parsed.data;
  return {
    storyId,
    ownerUid: story.ownerUid,
    childId: story.childId,
    text: story.text ?? '',
    title: story.title,
    synopsis: story.synopsis,
    actorIds: story.cast.filter((m) => m.castId !== story.childId).map((m) => m.castId),
    status: story.status,
    shape: 'story',
  };
}

/** Either shape, from the document's data. */
export function storyFromDocument(storyId: string, raw: unknown): StorySource {
  return isTargetStory(raw) ? targetStoryFromDocument(storyId, raw) : legacyStoryFromDocument(storyId, raw);
}

export const STORIES_COLLECTION = 'stories';

export async function loadStorySource(db: Firestore, storyId: string, tx?: Transaction): Promise<StorySource> {
  const ref = db.collection(STORIES_COLLECTION).doc(storyId);
  const snapshot = tx ? await tx.get(ref) : await ref.get();
  if (!snapshot.exists) throw new NotFoundError('Story not found', { details: { id: storyId } });
  return storyFromDocument(snapshot.id, snapshot.data());
}

/** Whether Books may be made from this story: a target Story must be `complete`; a legacy one needs text. */
export function isFinished(story: StorySource): boolean {
  if (story.shape === 'story') return story.status === 'complete' && story.text.trim().length > 0;
  return story.text.trim().length > 0;
}
