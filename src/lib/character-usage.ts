import { getServerFirestore } from '@/lib/server-firestore';
import { FieldValue } from 'firebase-admin/firestore';

/**
 * Update usage statistics for characters used in a story.
 * Increments usageCount and sets lastUsedAt for each character.
 *
 * @param actorIds - Array of actor IDs (can include children and characters)
 * @param childId - The main child ID (excluded from character updates)
 */
export async function updateCharacterUsage(
  actorIds: string[],
  childId: string | null | undefined
): Promise<void> {
  if (!actorIds || actorIds.length === 0) return;

  const firestore = await getServerFirestore();
  const batch = firestore.batch();

  // Filter out the main child and any invalid IDs
  const characterIds = actorIds.filter(
    id => id && typeof id === 'string' && id !== childId && !id.includes('/')
  );

  if (characterIds.length === 0) return;

  // Update each character's usage stats
  for (const charId of characterIds) {
    const charRef = firestore.collection('characters').doc(charId);
    batch.update(charRef, {
      usageCount: FieldValue.increment(1),
      lastUsedAt: FieldValue.serverTimestamp(),
    });
  }

  try {
    await batch.commit();
  } catch (error) {
    // Log but don't throw - character usage updates are not critical
    console.warn('Failed to update character usage stats:', error);
  }
}
