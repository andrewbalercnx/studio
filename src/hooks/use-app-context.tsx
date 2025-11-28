
'use client';

import React, { createContext, useContext, useState, useMemo, useEffect, useCallback } from 'react';
import { useUser } from '@/firebase/auth/use-user';
import type { AppRoleMode, ChildProfile } from '@/lib/types';
import { useDocument } from '@/lib/firestore-hooks';
import { doc } from 'firebase/firestore';
import { useFirestore } from '@/firebase';

interface AppContextType {
  roleMode: AppRoleMode;
  activeChildId: string | null;
  activeChildProfile: ChildProfile | null;
  activeChildProfileLoading: boolean;
  setActiveChildId: (childId: string | null) => void;
  switchToParentMode: () => void;
}

const AppContext = createContext<AppContextType | undefined>(undefined);

export function AppContextProvider({ children }: { children: React.ReactNode }) {
  const { user, idTokenResult, loading: userLoading } = useUser();
  const [activeChildId, setActiveChildIdState] = useState<string | null>(null);
  const firestore = useFirestore();

  const childDocRef = useMemo(() => {
    if (!firestore || !activeChildId) return null;
    return doc(firestore, 'children', activeChildId);
  }, [firestore, activeChildId]);

  const {
    data: activeChildProfileRaw,
    loading: activeChildProfileLoading,
  } = useDocument<ChildProfile>(childDocRef);

  const activeChildProfile = useMemo(() => {
    if (!user || !activeChildProfileRaw) return null;
    if (activeChildProfileRaw.ownerParentUid !== user.uid) {
      return null;
    }
    return activeChildProfileRaw;
  }, [activeChildProfileRaw, user]);

  useEffect(() => {
    const storedChildId = typeof window !== 'undefined' ? localStorage.getItem('activeChildId') : null;
    if (storedChildId) {
      setActiveChildIdState(storedChildId);
      console.debug('[AppContext] hydrated activeChildId from storage', storedChildId);
    }
  }, []);

  useEffect(() => {
    if (userLoading) return;
    if (!user) {
      console.debug('[AppContext] clearing activeChildId because user signed out');
      setActiveChildIdState(null);
      if (typeof window !== 'undefined') {
        localStorage.removeItem('activeChildId');
      }
    }
  }, [user, userLoading]);

  const setActiveChildId = useCallback((childId: string | null) => {
    if (childId === activeChildId) {
      console.debug('[AppContext] setActiveChildId called with same value, skipping', childId);
      return;
    }
    console.debug('[AppContext] setActiveChildId called with', childId);
    setActiveChildIdState(childId);
    if (typeof window === 'undefined') return;
    if (childId) {
      localStorage.setItem('activeChildId', childId);
    } else {
      localStorage.removeItem('activeChildId');
    }
  }, [activeChildId]);

  useEffect(() => {
    console.debug('[AppContext] activeChildId now', activeChildId);
  }, [activeChildId]);

  const switchToParentMode = useCallback(() => {
    setActiveChildId(null);
  }, [setActiveChildId]);

  const roleMode = useMemo((): AppRoleMode => {
    if (userLoading) return 'unknown';
    if (!user) return 'parent'; // Default for unauthenticated users

    const claims = idTokenResult?.claims;
    if (claims?.isAdmin) return 'admin';
    if (claims?.isWriter) return 'writer';

    if (activeChildId && activeChildProfile) return 'child';

    return 'parent';
  }, [user, idTokenResult, userLoading, activeChildId, activeChildProfile]);

  const value = {
    roleMode,
    activeChildId,
    activeChildProfile,
    activeChildProfileLoading,
    setActiveChildId,
    switchToParentMode,
  };

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useAppContext() {
  const context = useContext(AppContext);
  if (context === undefined) {
    throw new Error('useAppContext must be used within an AppContextProvider');
  }
  return context;
}
