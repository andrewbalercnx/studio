/**
 * The Book pipeline's input: a `stories/{storyId}` document written by the
 * creation routes (`schemaVersion: 2`), read through the `stories` repository
 * schema.
 *
 *     ownerUid ← ownerUid      text ← text (`[[cast:id]]` tokens)
 *     childId  ← childId       title, synopsis ← title, synopsis
 *     actorIds ← cast[].castId status ← status (only `complete` makes Books)
 *
 * Stories written by the retired flows (`parentUid`, no `schemaVersion`) are
 * removed by the trial-data reset (slice 5.4); such a document is "not found".
 */
import type { Firestore, Transaction } from 'firebase-admin/firestore';
import { STORY_SCHEMA_VERSION, storySchema, type StoryStatus } from '../data/schemas/story';
import { DataIntegrityError, NotFoundError } from '../errors';

export type StorySource = {
  storyId: string;
  ownerUid: string;
  childId: string;
  text: string;
  title: string | null;
  synopsis: string | null;
  actorIds: string[];
  status: StoryStatus;
};

/** True for a document written by the creation routes (slice 5.3). */
export function isTargetStory(raw: unknown): boolean {
  return !!raw && typeof raw === 'object' && (raw as { schemaVersion?: unknown }).schemaVersion === STORY_SCHEMA_VERSION;
}

/** The Story, from the document's data. A document that is not a Story is "not found". */
export function storyFromDocument(storyId: string, raw: unknown): StorySource {
  if (!isTargetStory(raw)) {
    throw new NotFoundError('Story not found', { code: 'STORY_NOT_FOUND', details: { id: storyId } });
  }
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
  };
}

export const STORIES_COLLECTION = 'stories';

export async function loadStorySource(db: Firestore, storyId: string, tx?: Transaction): Promise<StorySource> {
  const ref = db.collection(STORIES_COLLECTION).doc(storyId);
  const snapshot = tx ? await tx.get(ref) : await ref.get();
  if (!snapshot.exists) throw new NotFoundError('Story not found', { code: 'STORY_NOT_FOUND', details: { id: storyId } });
  return storyFromDocument(snapshot.id, snapshot.data());
}

/** Whether Books may be made from this Story: it must be `complete` with text. */
export function isFinished(story: StorySource): boolean {
  return story.status === 'complete' && story.text.trim().length > 0;
}
