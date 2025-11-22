'use client';

import { useState, useEffect } from 'react';
import { useUser } from '@/firebase/auth/use-user';

interface AdminStatus {
  isAuthenticated: boolean;
  email: string | null;
  isAdmin: boolean;
  loading: boolean;
  error: string | null;
}

export function useAdminStatus(): AdminStatus {
  const { user, loading: authLoading } = useUser();
  const [isAdmin, setIsAdmin] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(true);

  useEffect(() => {
    if (authLoading) {
      setLoading(true);
      return;
    }

    if (!user) {
      setIsAdmin(false);
      setLoading(false);
      return;
    }

    setLoading(true);
    user.getIdTokenResult()
      .then((idTokenResult) => {
        const claims = idTokenResult.claims;
        setIsAdmin(claims.role === 'admin');
        setError(null);
      })
      .catch((e) => {
        console.error("Error getting ID token result:", e);
        setError("Could not verify admin status.");
        setIsAdmin(false);
      })
      .finally(() => {
        setLoading(false);
      });

  }, [user, authLoading]);

  return {
    isAuthenticated: !!user,
    email: user?.email || null,
    isAdmin,
    loading: authLoading || loading,
    error,
  };
}