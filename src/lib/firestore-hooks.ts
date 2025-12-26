
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
    console.debug('[useCollection] Starting listener for path:', path);

    const unsubscribe = onSnapshot(
      query,
      (querySnapshot: QuerySnapshot<DocumentData>) => {
        const documents = querySnapshot.docs.map(doc => {
          const data = doc.data();
          // Ensure document ID takes precedence over any 'id' field in data
          return {
            ...data,
            id: doc.id,
          } as T;
        });
        console.debug('[useCollection] Success for path:', path, 'count:', documents.length);
        setData(documents);
        setLoading(false);
        setError(null);
      },
      (err: Error) => {
        console.error('[useCollection] Permission error for path:', path, err.message);
        const permissionError = new FirestorePermissionError({
          path: path,
          operation: 'list',
        });
        errorEmitter.emit('permission-error', permissionError);

        setError(err);
        setLoading(false);
      }
    );

    return () => {
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
    console.debug('[useDocument] Starting listener for path:', path);

    const unsubscribe = onSnapshot(
      docRef,
      (docSnapshot: DocumentSnapshot<DocumentData>) => {
        if (docSnapshot.exists()) {
          const data = docSnapshot.data();
          // Ensure document ID takes precedence over any 'id' field in data
          const docData = {
            ...data,
            id: docSnapshot.id,
          } as T;
          console.debug('[useDocument] Success for path:', path, 'exists:', true);
          setData(docData);
        } else {
          console.debug('[useDocument] Success for path:', path, 'exists:', false);
          setData(null);
        }
        setLoading(false);
        setError(null);
      },
      (err: Error) => {
        console.error('[useDocument] Permission error for path:', path, err.message);
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
      unsubscribe();
    };
  }, [docRef]);

  return { data, loading, error };
}
