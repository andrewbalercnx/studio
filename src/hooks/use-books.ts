'use client';

/**
 * Live, read-only views of the Book pipeline documents (slice 5.2).
 *
 * The rules let an owner read their own `books`, `manuscripts` and their
 * subcollections; a list query must therefore filter on `ownerUid == uid` so
 * the rules can prove every result is the caller's. Writes go through the API
 * (`src/lib/books/api.ts`).
 */
import { useMemo, useState, useCallback, useRef } from 'react';
import { collection, doc, query, where, type QueryConstraint } from 'firebase/firestore';
import { useFirestore } from '@/firebase';
import { useUser } from '@/firebase/auth/use-user';
import { useCollection, useDocument } from '@/lib/firestore-hooks';
import { ChoiceKeys, createBook, type CreateBookResponse } from '@/lib/books/api';
import type { BookDoc, BookPageDoc, ManuscriptDoc, ManuscriptPageDoc } from '@/lib/books/types';

function byPageNumber<T extends { pageNumber: number }>(items: T[] | null): T[] {
  return items ? [...items].sort((a, b) => a.pageNumber - b.pageNumber) : [];
}

/** `books/{bookId}`. */
export function useBook(bookId: string | null | undefined) {
  const firestore = useFirestore();
  const { user, loading: userLoading } = useUser();
  const uid = user?.uid;
  // Wait for auth: a read before the token is ready is denied and ends the listener.
  const ref = useMemo(() => (firestore && bookId && uid ? doc(firestore, 'books', bookId) : null), [firestore, bookId, uid]);
  const result = useDocument<BookDoc>(ref);
  return { ...result, loading: userLoading || (!!uid && !!bookId && result.loading) };
}

/** `books/{bookId}/pages`, in page order. */
export function useBookPages(bookId: string | null | undefined) {
  const firestore = useFirestore();
  const { user } = useUser();
  const uid = user?.uid;
  const q = useMemo(
    () => (firestore && bookId && uid ? query(collection(firestore, 'books', bookId, 'pages'), where('ownerUid', '==', uid)) : null),
    [firestore, bookId, uid]
  );
  const result = useCollection<BookPageDoc>(q);
  const pages = useMemo(() => byPageNumber(result.data), [result.data]);
  return { pages, loading: result.loading || !uid, error: result.error };
}

/** One page of a Book (e.g. the cover, page 1). */
export function useBookPage(bookId: string | null | undefined, pageNumber: number) {
  const firestore = useFirestore();
  const { user } = useUser();
  const uid = user?.uid;
  const ref = useMemo(
    () => (firestore && bookId && uid ? doc(firestore, 'books', bookId, 'pages', String(pageNumber)) : null),
    [firestore, bookId, pageNumber, uid]
  );
  return useDocument<BookPageDoc>(ref);
}

/** `manuscripts/{manuscriptId}`. */
export function useManuscript(manuscriptId: string | null | undefined) {
  const firestore = useFirestore();
  const { user } = useUser();
  const uid = user?.uid;
  const ref = useMemo(
    () => (firestore && manuscriptId && uid ? doc(firestore, 'manuscripts', manuscriptId) : null),
    [firestore, manuscriptId, uid]
  );
  return useDocument<ManuscriptDoc>(ref);
}

/** `manuscripts/{manuscriptId}/pages`, in page order. */
export function useManuscriptPages(manuscriptId: string | null | undefined) {
  const firestore = useFirestore();
  const { user } = useUser();
  const uid = user?.uid;
  const q = useMemo(
    () =>
      firestore && manuscriptId && uid
        ? query(collection(firestore, 'manuscripts', manuscriptId, 'pages'), where('ownerUid', '==', uid))
        : null,
    [firestore, manuscriptId, uid]
  );
  const result = useCollection<ManuscriptPageDoc>(q);
  const pages = useMemo(() => byPageNumber(result.data), [result.data]);
  return { pages, loading: result.loading || !uid, error: result.error };
}

/**
 * The signed-in family's Books, optionally for one child or one story, newest
 * first. Status comes from the server (`book.status`); nothing is derived here.
 */
export function useBooks(filter: { childId?: string | null; storyId?: string | null } = {}) {
  const firestore = useFirestore();
  const { user, loading: userLoading } = useUser();
  const uid = user?.uid;
  const { childId, storyId } = filter;
  const q = useMemo(() => {
    if (!firestore || !uid) return null;
    const constraints: QueryConstraint[] = [where('ownerUid', '==', uid)];
    if (childId) constraints.push(where('childId', '==', childId));
    if (storyId) constraints.push(where('storyId', '==', storyId));
    return query(collection(firestore, 'books'), ...constraints);
  }, [firestore, uid, childId, storyId]);
  const result = useCollection<BookDoc>(q);
  const books = useMemo(
    () =>
      result.data
        ? [...result.data].sort((a, b) => (b.createdAt?.toMillis?.() ?? 0) - (a.createdAt?.toMillis?.() ?? 0))
        : [],
    [result.data]
  );
  return { books, loading: userLoading || (!!uid && result.loading), error: result.error };
}

/**
 * Create a Book through `POST /api/books`. The idempotency key is made once
 * per choice: tapping the same Form + Style again (a double tap, or a retry
 * after a network error) repeats the key, so the server returns the same Book
 * and charges once; a different choice gets a new key.
 */
export function useCreateBook() {
  const [pending, setPending] = useState(false);
  // A ref, not state: two taps in the same frame must see the same key.
  const keys = useRef(new ChoiceKeys());

  const create = useCallback(
    async (input: { storyId: string; formId: string; styleId: string }): Promise<CreateBookResponse> => {
      const key = keys.current.keyFor(`${input.storyId}|${input.formId}|${input.styleId}`);
      setPending(true);
      try {
        return await createBook({ ...input, idempotencyKey: key });
      } finally {
        setPending(false);
      }
    },
    []
  );

  return { createBook: create, pending };
}
