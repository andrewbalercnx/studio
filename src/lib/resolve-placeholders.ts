
import { initializeFirebase } from '@/firebase';
import { collection, doc, getDoc, getDocs, query, where } from 'firebase/firestore';
import type { Character, ChildProfile } from '@/lib/types';

type EntityMap = Map<string, { displayName: string; document: Character | ChildProfile }>;

function buildCharacterDescription(character: Character): string {
    const traits = character.traits?.length ? `, is ${character.traits.join(', ')}` : '';
    return `[${character.displayName}, a ${character.role}${traits}]`;
}

async function fetchEntities(ids: string[]): Promise<EntityMap> {
  const { firestore } = initializeFirebase();
  const entityMap: EntityMap = new Map();
  if (ids.length === 0) return entityMap;

  const uniqueIds = [...new Set(ids)];
  console.debug('[resolveEntities] Fetching entities for IDs:', uniqueIds);

  try {
    const characterDocs = await getDocs(query(collection(firestore, 'characters'), where('__name__', 'in', uniqueIds)));
    characterDocs.forEach(doc => {
      const char = doc.data() as Character;
      entityMap.set(doc.id, { displayName: char.displayName, document: char });
    });
    console.debug(`[resolveEntities] Found ${characterDocs.size} characters.`);
  } catch (e) {
    console.warn('[resolveEntities] Error fetching characters:', e);
  }

  const remainingIds = uniqueIds.filter(id => !entityMap.has(id));
  if (remainingIds.length > 0) {
    console.debug('[resolveEntities] Remaining IDs to check in children:', remainingIds);
    try {
      const childrenDocs = await getDocs(query(collection(firestore, 'children'), where('__name__', 'in', remainingIds)));
      childrenDocs.forEach(doc => {
        const child = doc.data() as ChildProfile;
        entityMap.set(doc.id, { displayName: child.displayName, document: child });
      });
      console.debug(`[resolveEntities] Found ${childrenDocs.size} children.`);
    } catch (e) {
      console.warn('[resolveEntities] Error fetching children:', e);
    }
  }

  console.debug(`[resolveEntities] Final map contains ${entityMap.size} of ${uniqueIds.length} unique IDs.`);
  return entityMap;
}

export async function replacePlaceholdersInText(text: string, entityMap: EntityMap): Promise<string> {
    if (!text) return '';
    return text.replace(/\$\$([^$]+)\$\$/g, (match, id) => {
        return entityMap.get(id)?.displayName || match;
    });
}

export async function replacePlaceholdersWithDescriptions(text: string): Promise<string> {
    const ids = [...text.matchAll(/\$\$([^$]+)\$\$/g)].map(match => match[1]);
    const entityMap = await fetchEntities(ids);
    
    if (!text) return '';
    return text.replace(/\$\$([^$]+)\$\$/g, (match, id) => {
        const entity = entityMap.get(id);
        if (!entity) return match;
        
        // Check if it's a Character or ChildProfile and format accordingly
        if ('role' in entity.document) { // It's a Character
            return buildCharacterDescription(entity.document as Character);
        }
        
        return entity.displayName; // Fallback for ChildProfile
    });
}


export async function resolveEntitiesInText(text: string): Promise<EntityMap> {
  const ids = [...text.matchAll(/\$\$([^$]+)\$\$/g)].map(match => match[1]);
  return fetchEntities(ids);
}

export const resolveEntities = resolveEntitiesInText;

// New function for client-side usage
export async function resolvePlaceholders(text: string | string[]): Promise<Record<string, string>> {
  const textToProcess = Array.isArray(text) ? text.join(' ') : text;
  const ids = [...textToProcess.matchAll(/\$\$([^$]+)\$\$/g)].map(match => match[1]);
  const uniqueIds = [...new Set(ids)];
  
  if (uniqueIds.length === 0) {
    return {};
  }
  
  const entityMap = await fetchEntities(uniqueIds);
  
  const originalTexts = Array.isArray(text) ? text : [text];
  const resolved: Record<string, string> = {};

  for (const originalText of originalTexts) {
    resolved[originalText] = await replacePlaceholdersInText(originalText, entityMap);
  }

  return resolved;
}

export async function getEntitiesInText(text: string, entityMap: EntityMap): Promise<Character[]> {
  if (!text) return [];
  const ids = [...text.matchAll(/\$\$([^$]+)\$\$/g)].map(match => match[1]);
  const uniqueIds = [...new Set(ids)];
  return uniqueIds
    .map(id => entityMap.get(id)?.document)
    .filter((doc): doc is Character => !!doc && 'displayName' in doc && 'role' in doc);
}
