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
  canShowWizardTargets: boolean;
  loading: boolean;
  error: string | null;
}

export function useAdminStatus(): AdminStatus {
  const { user, idTokenResult, loading: authLoading } = useUser();
  const firestore = useFirestore();
  const [canShowWizardTargets, setCanShowWizardTargets] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(true);

  // Roles come from the ID token's custom claims — the single source of truth,
  // the same one the server trusts (src/server/http/auth.ts, firestore.rules).
  // A `users/{uid}` doc field is NOT trusted for roles: the owner can write doc
  // fields, so trusting one there would let a user grant themselves admin.
  // Set a claim with `scripts/set-admin.mjs`.
  const isAdmin = idTokenResult?.claims?.isAdmin === true;
  const isWriter = idTokenResult?.claims?.isWriter === true;

  useEffect(() => {
    if (authLoading) {
      setLoading(true);
      return;
    }

    if (!user || !firestore) {
      setCanShowWizardTargets(false);
      setLoading(false);
      return;
    }

    setLoading(true);
    const userDocRef = doc(firestore, 'users', user.uid);

    // Only `canShowWizardTargets` (a per-user diagnostic-overlay toggle, not a
    // role) is read from the doc; roles come from the claim above.
    const unsubscribe = onSnapshot(userDocRef,
      (doc) => {
        setCanShowWizardTargets(doc.exists() && doc.data().canShowWizardTargets === true);
        setError(null);
        setLoading(false);
      },
      (e) => {
        console.error("Error fetching user profile:", e);
        setError("Could not verify admin status.");
        setCanShowWizardTargets(false);
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
    canShowWizardTargets: isAdmin || isWriter || canShowWizardTargets, // Admins/writers always have access
    loading: authLoading || loading,
    error,
  };
}
