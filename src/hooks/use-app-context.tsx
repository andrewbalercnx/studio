
'use client';

import React, { createContext, useContext, useState, useMemo, useEffect, useCallback } from 'react';
import { useUser } from '@/firebase/auth/use-user';
import type { AppRoleMode } from '@/lib/types';
import { useDocument } from '@/lib/firestore-hooks';
import { doc } from 'firebase/firestore';
import { useFirestore } from '@/firebase';

interface AppContextType {
  roleMode: AppRoleMode;
  activeChildId: string | null;
  setActiveChildId: (childId: string | null) => void;
  switchToParentMode: () => void;
}

const AppContext = createContext<AppContextType | undefined>(undefined);

export function AppContextProvider({ children }: { children: React.ReactNode }) {
  const { user, idTokenResult, loading: userLoading } = useUser();
  const [activeChildId, setActiveChildIdState] = useState<string | null>(null);

  useEffect(() => {
    const storedChildId = localStorage.getItem('activeChildId');
    if (storedChildId) {
      setActiveChildIdState(storedChildId);
    }
  }, []);

  const setActiveChildId = (childId: string | null) => {
    setActiveChildIdState(childId);
    if (childId) {
      localStorage.setItem('activeChildId', childId);
    } else {
      localStorage.removeItem('activeChildId');
    }
  };

  const switchToParentMode = useCallback(() => {
    setActiveChildId(null);
  }, []);

  const roleMode = useMemo((): AppRoleMode => {
    if (userLoading) return 'unknown';
    if (!user) return 'parent'; // Default for unauthenticated users

    const claims = idTokenResult?.claims;
    if (claims?.isAdmin) return 'admin';
    if (claims?.isWriter) return 'writer';

    if (activeChildId) return 'child';

    return 'parent';
  }, [user, idTokenResult, userLoading, activeChildId]);

  const value = {
    roleMode,
    activeChildId,
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
