
'use client';

import { useState, useEffect } from 'react';
import { onSnapshot, Query, DocumentData, QuerySnapshot, DocumentSnapshot, DocumentReference } from 'firebase/firestore';
import { useFirestore } from '@/firebase';
import { errorEmitter } from '@/firebase/error-emitter';
import { FirestorePermissionError } from '@/firebase/errors';


interface UseCollectionReturn<T> {
  data: T[] | null;
  loading: boolean;
  error: Error | null;
}

export function useCollection<T>(query: Query | null): UseCollectionReturn<T> {
  const [data, setData] = useState<T[] | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    if (!query) {
      setData(null);
      setLoading(false);
      return;
    }
    
    setLoading(true);
    const path = (query as any)?._query?.path?.canonicalString?.() ?? 'unknown';
    console.debug('[useCollection] subscribe', path);

    const unsubscribe = onSnapshot(
      query,
      (querySnapshot: QuerySnapshot<DocumentData>) => {
        const documents = querySnapshot.docs.map(doc => ({
          id: doc.id,
          ...doc.data(),
        })) as T[];
        setData(documents);
        setLoading(false);
        setError(null);
      },
      (err: Error) => {
        console.error('[useCollection] snapshot error', {
          code: (err as any)?.code,
          message: err?.message,
          path,
          query: (query as any)?._query ?? null,
        });
        const permissionError = new FirestorePermissionError({
          path: (query as any)._query.path.segments.join('/'),
          operation: 'list',
        });
        errorEmitter.emit('permission-error', permissionError);

        setError(err);
        setLoading(false);
      }
    );

    return () => {
      console.debug('[useCollection] unsubscribe', path);
      unsubscribe();
    };
  }, [query]);

  return { data, loading, error };
}

interface UseDocumentReturn<T> {
  data: T | null;
  loading: boolean;
  error: Error | null;
}

export function useDocument<T>(docRef: DocumentReference | null): UseDocumentReturn<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    if (!docRef) {
      setData(null);
      setLoading(false);
      return;
    }
    
    setLoading(true);
    const path = docRef?.path ?? 'unknown';
    console.debug('[useDocument] subscribe', path);

    const unsubscribe = onSnapshot(
      docRef,
      (docSnapshot: DocumentSnapshot<DocumentData>) => {
        if (docSnapshot.exists()) {
          const docData = {
            id: docSnapshot.id,
            ...docSnapshot.data(),
          } as T;
          setData(docData);
        } else {
          setData(null);
        }
        setLoading(false);
        setError(null);
      },
      (err: Error) => {
        const permissionError = new FirestorePermissionError({
          path: docRef.path,
          operation: 'get',
        });
        errorEmitter.emit('permission-error', permissionError);
        setError(err);
        setLoading(false);
      }
    );

    return () => {
      console.debug('[useDocument] unsubscribe', path);
      unsubscribe();
    };
  }, [docRef]);

  return { data, loading, error };
}
