/**
 * The input of this slice: today's `stories/{storyId}` document, read as the
 * Story until the creation slice writes target-shaped Stories (ADR-0001, slice
 * 5.1 decision). Read through its own permissive schema, NOT the `stories`
 * repository: legacy documents do not match the target `storySchema`.
 *
 *   ownerUid ← parentUid          text ← storyText (`$$id$$` cast tokens)
 *   childId  ← childId            title ← metadata.title
 *   actorIds ← actors[]           synopsis ← synopsis
 */
import type { Firestore, Transaction } from 'firebase-admin/firestore';
import { z } from 'zod';
import { NotFoundError } from '../errors';

export type StorySource = {
  storyId: string;
  ownerUid: string | null;
  childId: string | null;
  text: string;
  title: string | null;
  synopsis: string | null;
  actorIds: string[];
};

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

export function storyFromDocument(storyId: string, raw: unknown): StorySource {
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
  };
}

export const STORIES_COLLECTION = 'stories';

export async function loadStorySource(db: Firestore, storyId: string, tx?: Transaction): Promise<StorySource> {
  const ref = db.collection(STORIES_COLLECTION).doc(storyId);
  const snapshot = tx ? await tx.get(ref) : await ref.get();
  if (!snapshot.exists) throw new NotFoundError('Story not found', { details: { id: storyId } });
  return storyFromDocument(storyId, snapshot.data());
}
