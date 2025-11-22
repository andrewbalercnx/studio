
'use client';

import { useState, useEffect } from 'react';
import { onSnapshot, Query, DocumentData, QuerySnapshot, DocumentSnapshot, DocumentReference } from 'firebase/firestore';
import { useFirestore } from '@/firebase';

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
      setLoading(false);
      return;
    }
    
    setLoading(true);

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
        console.error("Error in useCollection:", err);
        setError(err);
        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, [JSON.stringify(query)]); // Simple serialization for dependency check

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
      setLoading(false);
      return;
    }
    
    setLoading(true);

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
        console.error("Error in useDocument:", err);
        setError(err);
        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, [docRef?.path]);

  return { data, loading, error };
}


    