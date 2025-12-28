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
  const { user, loading: authLoading } = useUser();
  const firestore = useFirestore();
  const [isAdmin, setIsAdmin] = useState<boolean>(false);
  const [isWriter, setIsWriter] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(true);

  useEffect(() => {
    if (authLoading) {
      setLoading(true);
      return;
    }

    if (!user || !firestore) {
      setIsAdmin(false);
      setIsWriter(false);
      setLoading(false);
      return;
    }

    setLoading(true);
    const userDocRef = doc(firestore, 'users', user.uid);
    
    const unsubscribe = onSnapshot(userDocRef,
      (doc) => {
        if (doc.exists()) {
          const data = doc.data();
          setIsAdmin(data.isAdmin === true);
          setIsWriter(data.isWriter === true);
        } else {
          // Document might not exist yet if sign-up is in progress
          setIsAdmin(false);
          setIsWriter(false);
        }
        setError(null);
        setLoading(false);
      },
      (e) => {
        console.error("Error fetching user profile:", e);
        setError("Could not verify admin status.");
        setIsAdmin(false);
        setIsWriter(false);
        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, [user, authLoading, firestore]);

  return {
    isAuthenticated: !!user,
    email: user?.email || null,
    isAdmin,
    isWriter,
    loading: authLoading || loading,
    error,
  };
}
