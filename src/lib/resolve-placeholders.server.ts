'use server';

import { getServerFirestore } from '@/lib/server-firestore';
import type { Character, ChildProfile } from '@/lib/types';

type EntityMap = Map<string, { displayName: string; document: Character | ChildProfile }>;

function buildCharacterDescription(character: Character): string {
  const traits = character.traits?.length ? `, is ${character.traits.join(', ')}` : '';
  return `[${character.displayName}, a ${character.role}${traits}]`;
}

async function fetchEntities(ids: string[]): Promise<EntityMap> {
  const firestore = await getServerFirestore();
  const entityMap: EntityMap = new Map();
  if (ids.length === 0) return entityMap;

  const uniqueIds = [...new Set(ids)];
  const chunkSize = 10;

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
