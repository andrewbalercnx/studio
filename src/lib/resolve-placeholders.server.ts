'use server';

import { getServerFirestore } from '@/lib/server-firestore';
import type { Character, ChildProfile } from '@/lib/types';

export type EntityMap = Map<string, { displayName: string; document: Character | ChildProfile }>;

function buildCharacterDescription(character: Character): string {
  const likes = character.likes?.length ? `, likes ${character.likes.join(', ')}` : '';
  return `[${character.displayName}, a ${character.type}${likes}]`;
}

async function fetchEntities(ids: string[]): Promise<EntityMap> {
  const firestore = await getServerFirestore();
  const entityMap: EntityMap = new Map();
  if (ids.length === 0) return entityMap;

  const uniqueIds = [...new Set(ids)];
  const chunkSize = 10;

  // First, try to find by document ID in characters collection
  for (let i = 0; i < uniqueIds.length; i += chunkSize) {
    const chunk = uniqueIds.slice(i, i + chunkSize);
    const characterSnapshot = await firestore
      .collection('characters')
      .where('__name__', 'in', chunk)
      .get();
    characterSnapshot.forEach((docSnap) => {
      const character = docSnap.data() as Character;
      entityMap.set(docSnap.id, { displayName: character.displayName, document: character });
    });
  }

  // Then try children collection by document ID
  const remainingIds = uniqueIds.filter((id) => !entityMap.has(id));
  for (let i = 0; i < remainingIds.length; i += chunkSize) {
    const chunk = remainingIds.slice(i, i + chunkSize);
    const childSnapshot = await firestore
      .collection('children')
      .where('__name__', 'in', chunk)
      .get();
    childSnapshot.forEach((docSnap) => {
      const child = docSnap.data() as ChildProfile;
      entityMap.set(docSnap.id, { displayName: child.displayName, document: child });
    });
  }

  // Fallback: For IDs that still weren't found, try to find by displayName
  // This handles legacy data where the AI used displayName instead of document ID
  const stillRemainingIds = uniqueIds.filter((id) => !entityMap.has(id));
  if (stillRemainingIds.length > 0) {
    // Try characters by displayName
    for (let i = 0; i < stillRemainingIds.length; i += chunkSize) {
      const chunk = stillRemainingIds.slice(i, i + chunkSize);
      const charsByName = await firestore
        .collection('characters')
        .where('displayName', 'in', chunk)
        .get();
      charsByName.forEach((docSnap) => {
        const character = docSnap.data() as Character;
        // Map the displayName (which was used as the placeholder) to the entity
        entityMap.set(character.displayName, { displayName: character.displayName, document: character });
      });
    }

    // Try children by displayName
    const finalRemaining = stillRemainingIds.filter((id) => !entityMap.has(id));
    for (let i = 0; i < finalRemaining.length; i += chunkSize) {
      const chunk = finalRemaining.slice(i, i + chunkSize);
      const childrenByName = await firestore
        .collection('children')
        .where('displayName', 'in', chunk)
        .get();
      childrenByName.forEach((docSnap) => {
        const child = docSnap.data() as ChildProfile;
        entityMap.set(child.displayName, { displayName: child.displayName, document: child });
      });
    }
  }

  return entityMap;
}

export async function replacePlaceholdersWithDescriptions(text: string): Promise<string> {
  const inputText = text || '';
  const ids = [...inputText.matchAll(/\$\$([^$]+)\$\$/g)].map((match) => match[1]);
  const entityMap = await fetchEntities(ids);

  if (!inputText) return '';
  return inputText.replace(/\$\$([^$]+)\$\$/g, (match, id) => {
    const entity = entityMap.get(id);
    if (!entity) return match;

    if ('role' in entity.document) {
      return buildCharacterDescription(entity.document as Character);
    }

    return entity.displayName;
  });
}

export async function resolveEntitiesInText(text: string): Promise<EntityMap> {
  // Extract IDs from double $$ format (correct)
  const doubleIds = [...text.matchAll(/\$\$([^$]+)\$\$/g)].map((match) => match[1]);
  // Also extract IDs from single $ format (fallback for AI that didn't follow instructions)
  const singleIds = [...text.matchAll(/\$([a-zA-Z0-9]{15,})\$/g)].map((match) => match[1]);
  const allIds = [...doubleIds, ...singleIds];
  return fetchEntities(allIds);
}

export async function replacePlaceholdersInText(text: string, entityMap: EntityMap): Promise<string> {
  if (!text) return '';
  // First, replace double $$ format (the correct format)
  let result = text.replace(/\$\$([^$]+)\$\$/g, (match, id) => {
    return entityMap.get(id)?.displayName || match;
  });
  // Fallback: also replace single $ format in case AI didn't follow instructions
  // Only replace if the ID looks like a Firestore document ID (alphanumeric)
  result = result.replace(/\$([a-zA-Z0-9]{15,})\$/g, (match, id) => {
    return entityMap.get(id)?.displayName || match;
  });
  return result;
}

/**
 * Replace placeholders in text for TTS (Text-to-Speech).
 * Uses namePronunciation if available, otherwise falls back to displayName.
 * This ensures names like "Siobhan" are pronounced correctly as "shiv-AWN".
 */
export async function replacePlaceholdersForTTS(text: string, entityMap: EntityMap): Promise<string> {
  if (!text) return '';

  const resolveEntity = (id: string): string | null => {
    const entity = entityMap.get(id);
    if (!entity) return null;
    // Use pronunciation if available, otherwise fall back to displayName
    const doc = entity.document;
    const pronunciation = 'namePronunciation' in doc ? doc.namePronunciation : undefined;
    return pronunciation || entity.displayName;
  };

  // First, replace double $$ format (the correct format)
  let result = text.replace(/\$\$([^$]+)\$\$/g, (match, id) => {
    return resolveEntity(id) || match;
  });
  // Fallback: also replace single $ format in case AI didn't follow instructions
  result = result.replace(/\$([a-zA-Z0-9]{15,})\$/g, (match, id) => {
    return resolveEntity(id) || match;
  });
  return result;
}

export type EntityMetadata = {
  id: string;
  displayName: string;
  avatarUrl?: string;
  type: 'character' | 'child';
};

export async function extractEntityMetadataFromText(text: string, entityMap: EntityMap): Promise<EntityMetadata[]> {
  if (!text) return [];
  // Extract IDs from both double $$ and single $ formats
  const doubleIds = [...text.matchAll(/\$\$([^$]+)\$\$/g)].map((match) => match[1]);
  const singleIds = [...text.matchAll(/\$([a-zA-Z0-9]{15,})\$/g)].map((match) => match[1]);
  const uniqueIds = [...new Set([...doubleIds, ...singleIds])];
  return uniqueIds
    .map((id) => {
      const entity = entityMap.get(id);
      if (!entity) return null;
      const isCharacter = 'type' in entity.document && !('favouriteGenres' in entity.document);
      return {
        id,
        displayName: entity.displayName,
        avatarUrl: entity.document.avatarUrl,
        type: isCharacter ? 'character' : 'child',
      } as EntityMetadata;
    })
    .filter((e): e is EntityMetadata => e !== null);
}

export async function getEntitiesInText(text: string, entityMap: EntityMap): Promise<Character[]> {
  if (!text) return [];
  // Extract IDs from both double $$ and single $ formats
  const doubleIds = [...text.matchAll(/\$\$([^$]+)\$\$/g)].map((match) => match[1]);
  const singleIds = [...text.matchAll(/\$([a-zA-Z0-9]{15,})\$/g)].map((match) => match[1]);
  const ids = [...doubleIds, ...singleIds];
  const uniqueIds = [...new Set(ids)];
  return uniqueIds
    .map((id) => entityMap.get(id)?.document)
    .filter((doc): doc is Character => !!doc && 'displayName' in doc && 'role' in doc);
}

/**
 * Helper to get pronoun text for TTS narration
 */
function getPronounText(pronouns?: string): string {
  switch (pronouns) {
    case 'he/him':
      return 'He uses he/him pronouns.';
    case 'she/her':
      return 'She uses she/her pronouns.';
    case 'they/them':
      return 'They use they/them pronouns.';
    default:
      return 'They use they/them pronouns.';
  }
}

/**
 * Build a spoken description of an actor for TTS narration.
 * Format: "Name is a Type. Pronouns. They like X, Y, Z. They dislike A, B."
 * Also returns pronunciation hint if available.
 */
function buildActorDescriptionForAudio(entity: Character | ChildProfile): { description: string; pronunciationHint?: string } {
  const name = entity.displayName;
  const pronouns = entity.pronouns;
  const pronounText = getPronounText(pronouns);

  // Check for name pronunciation (only ChildProfile has this field)
  const namePronunciation = 'namePronunciation' in entity ? (entity as ChildProfile).namePronunciation : undefined;
  const pronunciationHint = namePronunciation ? `The name "${name}" should be pronounced as "${namePronunciation}".` : undefined;

  // Determine the type/role
  let typeText: string;
  if ('type' in entity) {
    // It's a Character
    const character = entity as Character;
    if (character.relationship) {
      typeText = `${name}'s ${character.relationship}`;
    } else {
      typeText = `a ${character.type.toLowerCase()}`;
    }
  } else {
    // It's a ChildProfile - the main character
    typeText = 'the main character of this story';
  }

  // Build likes/dislikes
  const likes = entity.likes?.length ? entity.likes : [];
  const dislikes = entity.dislikes?.length ? entity.dislikes : [];

  let preferencesText = '';
  if (likes.length > 0) {
    const likesStr = likes.length === 1
      ? likes[0]
      : likes.slice(0, -1).join(', ') + ' and ' + likes[likes.length - 1];
    preferencesText += ` They like ${likesStr}.`;
  }
  if (dislikes.length > 0) {
    const dislikesStr = dislikes.length === 1
      ? dislikes[0]
      : dislikes.slice(0, -1).join(', ') + ' and ' + dislikes[dislikes.length - 1];
    preferencesText += ` They dislike ${dislikesStr}.`;
  }

  // Include description if available
  const descriptionText = entity.description ? ` ${entity.description}` : '';

  const description = `${name} is ${typeText}. ${pronounText}${preferencesText}${descriptionText}`.trim();

  return { description, pronunciationHint };
}

/**
 * Build actor descriptions for TTS narration for a page.
 * Returns a formatted string describing all actors mentioned on the page,
 * including pronunciation hints for names that have them.
 */
export async function buildActorDescriptionsForAudio(
  entityIds: string[],
  entityMap: EntityMap
): Promise<string> {
  if (!entityIds || entityIds.length === 0) return '';

  const descriptions: string[] = [];
  const pronunciationHints: string[] = [];

  for (const id of entityIds) {
    const entity = entityMap.get(id);
    if (entity) {
      const { description, pronunciationHint } = buildActorDescriptionForAudio(entity.document);
      descriptions.push(description);
      if (pronunciationHint) {
        pronunciationHints.push(pronunciationHint);
      }
    }
  }

  if (descriptions.length === 0) return '';

  let result = '\n\n[Characters in this scene: ' + descriptions.join(' ') + ']';

  // Add pronunciation hints if any
  if (pronunciationHints.length > 0) {
    result += '\n\n[Pronunciation: ' + pronunciationHints.join(' ') + ']';
  }

  return result;
}
