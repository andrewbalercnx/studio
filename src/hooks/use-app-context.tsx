
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
  activeWizard: { id: string; step: number } | null;
  startWizard: (wizardId: string) => void;
  advanceWizard: () => void;
  goBackWizard: () => void;
  closeWizard: () => void;
}

const AppContext = createContext<AppContextType | undefined>(undefined);

export function AppContextProvider({ children }: { children: React.ReactNode }) {
  const { user, idTokenResult, loading: userLoading } = useUser();
  const [activeChildId, setActiveChildIdState] = useState<string | null>(null);
  const [activeWizardState, setActiveWizardState] = useState<{ id: string; step: number } | null>(null);
  const firestore = useFirestore();

  // Persist wizard state to sessionStorage so it survives page navigations
  const setActiveWizard = useCallback((value: { id: string; step: number } | null | ((prev: { id: string; step: number } | null) => { id: string; step: number } | null)) => {
    setActiveWizardState(prev => {
      const newValue = typeof value === 'function' ? value(prev) : value;
      if (typeof window !== 'undefined') {
        if (newValue) {
          sessionStorage.setItem('activeWizard', JSON.stringify(newValue));
        } else {
          sessionStorage.removeItem('activeWizard');
        }
      }
      return newValue;
    });
  }, []);

  // Hydrate wizard state from sessionStorage on mount
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const stored = sessionStorage.getItem('activeWizard');
      if (stored) {
        try {
          const parsed = JSON.parse(stored);
          if (parsed && typeof parsed.id === 'string' && typeof parsed.step === 'number') {
            setActiveWizardState(parsed);
          }
        } catch (e) {
          sessionStorage.removeItem('activeWizard');
        }
      }
    }
  }, []);

  // Only query for child profile when auth is fully ready (idTokenResult exists)
  // This prevents Firestore permission errors on page refresh
  const childDocRef = useMemo(() => {
    if (!firestore || !activeChildId || !user || userLoading || !idTokenResult) return null;
    return doc(firestore, 'children', activeChildId);
  }, [firestore, activeChildId, user, userLoading, idTokenResult]);

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
  
  const startWizard = (wizardId: string) => setActiveWizard({ id: wizardId, step: 0 });
  const advanceWizard = () => setActiveWizard(prev => prev ? { ...prev, step: prev.step + 1 } : null);
  const goBackWizard = () => setActiveWizard(prev => prev && prev.step > 0 ? { ...prev, step: prev.step - 1 } : prev);
  const closeWizard = () => setActiveWizard(null);

  const value = {
    roleMode,
    activeChildId,
    activeChildProfile,
    activeChildProfileLoading,
    setActiveChildId,
    switchToParentMode,
    activeWizard: activeWizardState,
    startWizard,
    advanceWizard,
    goBackWizard,
    closeWizard,
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
