'use client';

import { useEffect, useState, createContext, useContext, useCallback } from 'react';
import { useUser } from '@/firebase/auth/use-user';
import type { ChildView } from '@/lib/api';
import { usePerson } from '@/lib/people/use-people';
import { LoaderCircle } from 'lucide-react';
import { PWAInstallPrompt, ServiceWorkerRegistration } from '@/components/pwa';
import { syncPersonaCookie } from '@/lib/persona-client';

// PWA-specific context for kids mode
interface KidsPWAContextType {
  childId: string | null;
  childProfile: ChildView | null;
  isLoading: boolean;
  isLocked: boolean;
  lockToChild: (childId: string) => void;
  unlock: () => void;
}

const KidsPWAContext = createContext<KidsPWAContextType | undefined>(undefined);

const KIDS_CHILD_ID_KEY = 'kids_pwa_child_id';

export function useKidsPWA() {
  const context = useContext(KidsPWAContext);
  if (!context) {
    throw new Error('useKidsPWA must be used within KidsLayout');
  }
  return context;
}

export default function KidsLayout({ children }: { children: React.ReactNode }) {
  const { user, loading: userLoading } = useUser();
  const [childId, setChildId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isLocked, setIsLocked] = useState(false);

  // Load persisted child ID on mount
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const storedChildId = localStorage.getItem(KIDS_CHILD_ID_KEY);
      if (storedChildId) {
        setChildId(storedChildId);
        setIsLocked(true);
      }
      setIsLoading(false);
    }
  }, []);

  // The locked child through the API (slice 6.2). The server checks the owner; a child
  // that is gone or belongs to someone else clears the lock.
  const { person: childProfile, errorCode } = usePerson('child', user ? childId : null);
  useEffect(() => {
    if (!errorCode || !childId) return;
    if (errorCode === 'CHILD_NOT_FOUND' || errorCode === 'FORBIDDEN' || errorCode === 'NOT_OWNER') {
      setChildId(null);
      setIsLocked(false);
      localStorage.removeItem(KIDS_CHILD_ID_KEY);
      syncPersonaCookie(null, null);
    }
  }, [errorCode, childId]);

  const lockToChild = useCallback((newChildId: string) => {
    setChildId(newChildId);
    setIsLocked(true);
    if (typeof window !== 'undefined') {
      localStorage.setItem(KIDS_CHILD_ID_KEY, newChildId);
    }
    // Mirror the lock to the signed httpOnly persona cookie (fire-and-forget;
    // chokepoints fail open without it, so this never blocks the kid).
    syncPersonaCookie(user, newChildId);
  }, [user]);

  const unlock = useCallback(() => {
    setChildId(null);
    setIsLocked(false);
    if (typeof window !== 'undefined') {
      localStorage.removeItem(KIDS_CHILD_ID_KEY);
    }
    // Back to parent/unscoped: clear the persona cookie.
    syncPersonaCookie(null, null);
  }, []);

  // Show loading while checking auth and child state
  if (userLoading || isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-b from-amber-50 to-orange-50">
        <LoaderCircle className="h-12 w-12 animate-spin text-amber-500" />
      </div>
    );
  }

  return (
    <KidsPWAContext.Provider
      value={{
        childId,
        childProfile,
        isLoading,
        isLocked,
        lockToChild,
        unlock,
      }}
    >
      <ServiceWorkerRegistration />
      <div className="min-h-screen bg-gradient-to-b from-amber-50 to-orange-50">
        {children}
        <PWAInstallPrompt />
      </div>
    </KidsPWAContext.Provider>
  );
}
