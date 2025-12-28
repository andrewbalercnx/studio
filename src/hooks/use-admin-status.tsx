'use client';

import { useState, useEffect } from 'react';
import { useUser } from '@/firebase/auth/use-user';
import { useFirestore } from '@/firebase';
import { doc, onSnapshot } from 'firebase/firestore';

interface AdminStatus {
  isAuthenticated: boolean;
  email: string | null;
  isAdmin: boolean;
  isWriter: boolean;
  loading: boolean;
  error: string | null;
}

export function useAdminStatus(): AdminStatus {
  const { user, idTokenResult, loading: authLoading } = useUser();
  const firestore = useFirestore();
  const [firestoreAdmin, setFirestoreAdmin] = useState<boolean>(false);
  const [firestoreWriter, setFirestoreWriter] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(true);

  // Get claims from ID token (the authoritative source for role-based access)
  const claimsAdmin = idTokenResult?.claims?.isAdmin === true;
  const claimsWriter = idTokenResult?.claims?.isWriter === true;

  useEffect(() => {
    if (authLoading) {
      setLoading(true);
      return;
    }

    if (!user || !firestore) {
      setFirestoreAdmin(false);
      setFirestoreWriter(false);
      setLoading(false);
      return;
    }

    setLoading(true);
    const userDocRef = doc(firestore, 'users', user.uid);

    const unsubscribe = onSnapshot(userDocRef,
      (doc) => {
        if (doc.exists()) {
          const data = doc.data();
          setFirestoreAdmin(data.isAdmin === true);
          setFirestoreWriter(data.isWriter === true);
        } else {
          // Document might not exist yet if sign-up is in progress
          setFirestoreAdmin(false);
          setFirestoreWriter(false);
        }
        setError(null);
        setLoading(false);
      },
      (e) => {
        console.error("Error fetching user profile:", e);
        setError("Could not verify admin status.");
        setFirestoreAdmin(false);
        setFirestoreWriter(false);
        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, [user, authLoading, firestore]);

  // Combine claims and Firestore - either source grants the role
  const isAdmin = claimsAdmin || firestoreAdmin;
  const isWriter = claimsWriter || firestoreWriter;

  return {
    isAuthenticated: !!user,
    email: user?.email || null,
    isAdmin,
    isWriter,
    loading: authLoading || loading,
    error,
  };
}
