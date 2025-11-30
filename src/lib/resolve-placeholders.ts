
'use server';

import { initializeFirebase } from '@/firebase';
import { collection, doc, getDoc, getDocs, query, where } from 'firebase/firestore';
import type { Character, ChildProfile } from '@/lib/types';

type EntityMap = Map<string, { displayName: string; document: Character | ChildProfile }>;

async function fetchEntities(ids: string[]): Promise<EntityMap> {
  const { firestore } = initializeFirebase();
  const entityMap: EntityMap = new Map();
  if (ids.length === 0) return entityMap;

  const uniqueIds = [...new Set(ids)];

  try {
    const characterDocs = await getDocs(query(collection(firestore, 'characters'), where('__name__', 'in', uniqueIds)));
    characterDocs.forEach(doc => {
      const char = doc.data() as Character;
      entityMap.set(doc.id, { displayName: char.displayName, document: char });
    });
  } catch (e) {
    console.warn('[resolveEntities] Error fetching characters:', e);
  }

  const remainingIds = uniqueIds.filter(id => !entityMap.has(id));
  if (remainingIds.length > 0) {
    try {
      const childrenDocs = await getDocs(query(collection(firestore, 'children'), where('__name__', 'in', remainingIds)));
      childrenDocs.forEach(doc => {
        const child = doc.data() as ChildProfile;
        entityMap.set(doc.id, { displayName: child.displayName, document: child });
      });
    } catch (e) {
      console.warn('[resolveEntities] Error fetching children:', e);
    }
  }

  return entityMap;
}

function replacePlaceholders(text: string, entityMap: EntityMap): string {
    if (!text) return '';
    return text.replace(/\$\$([^$]+)\$\$/g, (match, id) => {
        return entityMap.get(id)?.displayName || match;
    });
}

export async function resolveEntities(text: string): Promise<EntityMap> {
  const ids = [...text.matchAll(/\$\$([^$]+)\$\$/g)].map(match => match[1]);
  return fetchEntities(ids);
}

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

  originalTexts.forEach(originalText => {
    resolved[originalText] = replacePlaceholders(originalText, entityMap);
  });

  return resolved;
}

    