
'use client';
import {useEffect, useState, useMemo} from 'react';
import {onAuthStateChanged, getIdTokenResult} from 'firebase/auth';
import {useAuth} from '../provider';
import type {User, IdTokenResult} from 'firebase/auth';

/**
 * A hook that returns the currently authenticated user.
 *
 * This hook is useful for components that need to know who the
 * currently authenticated user is. It returns the user object
 * if a user is signed in, and null otherwise.
 *
 * The hook also returns a boolean that is true when the
 * authentication state is loading, and false otherwise.
 */
export function useUser() {
  const auth = useAuth();
  const [user, setUser] = useState<User | null>(null);
  const [idTokenResult, setIdTokenResult] = useState<IdTokenResult | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (auth) {
      const unsubscribe = onAuthStateChanged(auth, async (user) => {
        setUser(user);
        if (user) {
          const tokenResult = await getIdTokenResult(user);
          setIdTokenResult(tokenResult);
        } else {
          setIdTokenResult(null);
        }
        setLoading(false);
      });
      return () => unsubscribe();
    } else {
      setLoading(false);
    }
  }, [auth]);

  return {
    user,
    idTokenResult,
    loading,
  };
}
