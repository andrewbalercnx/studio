'use client';

import { useState, useEffect } from 'react';
import { useFirestore } from '@/firebase';
import { doc, getDoc, Firestore } from 'firebase/firestore';
import type { Character, ChildProfile } from '@/lib/types';

type EntityMap = Map<string, { displayName: string; document: Character | ChildProfile }>;

async function fetchEntitiesWithFirestore(firestore: Firestore, ids: string[]): Promise<EntityMap> {
  const entityMap: EntityMap = new Map();
  if (ids.length === 0) return entityMap;

  const uniqueIds = [...new Set(ids)];
  console.debug('[useResolvePlaceholders] Fetching entities for IDs:', uniqueIds);

  // Fetch each ID individually using getDoc (works with security rules that check ownership)
  // Try characters first, then children
  await Promise.all(
    uniqueIds.map(async (id) => {
      // Try as character first
      try {
        const charDoc = await getDoc(doc(firestore, 'characters', id));
        if (charDoc.exists()) {
          const char = charDoc.data() as Character;
          entityMap.set(id, { displayName: char.displayName, document: char });
          console.debug('[useResolvePlaceholders] Found character:', id, char.displayName);
          return;
        }
      } catch (e) {
        console.warn('[useResolvePlaceholders] Error fetching characters by ID:', e);
      }

      // Try as child
      try {
        const childDoc = await getDoc(doc(firestore, 'children', id));
        if (childDoc.exists()) {
          const child = childDoc.data() as ChildProfile;
          entityMap.set(id, { displayName: child.displayName, document: child });
          console.debug('[useResolvePlaceholders] Found child:', id, child.displayName);
        }
      } catch (e) {
        console.warn('[useResolvePlaceholders] Error fetching children by ID:', e);
      }
    })
  );

  console.debug('[useResolvePlaceholders] Final entityMap size:', entityMap.size);
  return entityMap;
}

function replacePlaceholdersInText(text: string, entityMap: EntityMap): string {
  if (!text) return '';
  // First, replace double $$ format (the correct format)
  let result = text.replace(/\$\$([^$]+)\$\$/g, (match, id) => {
    return entityMap.get(id)?.displayName || match;
  });
  // Fallback: also replace single $ format in case AI didn't follow instructions
  result = result.replace(/\$([a-zA-Z0-9_-]{15,})\$/g, (match, id) => {
    return entityMap.get(id)?.displayName || match;
  });
  return result;
}

/**
 * Hook to resolve $$placeholder$$ patterns in text using the authenticated Firestore connection.
 * Returns the resolved text or the original text while loading/on error.
 */
export function useResolvePlaceholders(text: string | null | undefined): {
  resolvedText: string | null;
  isResolving: boolean;
} {
  const firestore = useFirestore();
  const [resolvedText, setResolvedText] = useState<string | null>(null);
  const [isResolving, setIsResolving] = useState(false);

  useEffect(() => {
    if (!text) {
      setResolvedText(null);
      setIsResolving(false);
      return;
    }

    // Check if there are any placeholders to resolve (double $$ or single $ format)
    const hasDoublePlaceholders = /\$\$([^$]+)\$\$/.test(text);
    const hasSinglePlaceholders = /\$([a-zA-Z0-9]{15,})\$/.test(text);
    if (!hasDoublePlaceholders && !hasSinglePlaceholders) {
      setResolvedText(text);
      setIsResolving(false);
      return;
    }

    setIsResolving(true);

    // Extract IDs from both formats
    const doubleIds = [...text.matchAll(/\$\$([^$]+)\$\$/g)].map((match) => match[1]);
    const singleIds = [...text.matchAll(/\$([a-zA-Z0-9_-]{15,})\$/g)].map((match) => match[1]);
    const ids = [...doubleIds, ...singleIds];

    fetchEntitiesWithFirestore(firestore, ids)
      .then((entityMap) => {
        const resolved = replacePlaceholdersInText(text, entityMap);
        setResolvedText(resolved);
      })
      .catch((err) => {
        console.error('[useResolvePlaceholders] Failed to resolve placeholders:', err);
        setResolvedText(text); // Fallback to original text
      })
      .finally(() => {
        setIsResolving(false);
      });
  }, [firestore, text]);

  return { resolvedText, isResolving };
}

/**
 * Hook to resolve multiple texts at once.
 */
export function useResolvePlaceholdersMultiple(texts: (string | null | undefined)[]): {
  resolvedTexts: (string | null)[];
  isResolving: boolean;
} {
  const firestore = useFirestore();
  const [resolvedTexts, setResolvedTexts] = useState<(string | null)[]>([]);
  const [isResolving, setIsResolving] = useState(false);

  useEffect(() => {
    const validTexts = texts.filter((t): t is string => !!t);

    if (validTexts.length === 0) {
      setResolvedTexts(texts.map(() => null));
      setIsResolving(false);
      return;
    }

    // Combine all texts to find all placeholders
    const combinedText = validTexts.join(' ');
    const hasDoublePlaceholders = /\$\$([^$]+)\$\$/.test(combinedText);
    const hasSinglePlaceholders = /\$([a-zA-Z0-9]{15,})\$/.test(combinedText);

    if (!hasDoublePlaceholders && !hasSinglePlaceholders) {
      setResolvedTexts(texts.map((t) => t || null));
      setIsResolving(false);
      return;
    }

    setIsResolving(true);

    // Extract IDs from both formats
    const doubleIds = [...combinedText.matchAll(/\$\$([^$]+)\$\$/g)].map((match) => match[1]);
    const singleIds = [...combinedText.matchAll(/\$([a-zA-Z0-9_-]{15,})\$/g)].map((match) => match[1]);
    const ids = [...doubleIds, ...singleIds];

    fetchEntitiesWithFirestore(firestore, ids)
      .then((entityMap) => {
        const resolved = texts.map((t) =>
          t ? replacePlaceholdersInText(t, entityMap) : null
        );
        setResolvedTexts(resolved);
      })
      .catch((err) => {
        console.error('[useResolvePlaceholdersMultiple] Failed to resolve placeholders:', err);
        setResolvedTexts(texts.map((t) => t || null)); // Fallback to original texts
      })
      .finally(() => {
        setIsResolving(false);
      });
  }, [firestore, texts.join('|')]); // Use join as dependency to detect changes

  return { resolvedTexts, isResolving };
}
