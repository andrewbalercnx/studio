'use client';

import { useEffect, useState, createContext, useContext, useCallback } from 'react';
import { useUser } from '@/firebase/auth/use-user';
import { useFirestore } from '@/firebase';
import { doc, getDoc } from 'firebase/firestore';
import type { ChildProfile } from '@/lib/types';
import { LoaderCircle } from 'lucide-react';
import { PWAInstallPrompt, ServiceWorkerRegistration } from '@/components/pwa';
import { ApiClientProvider } from '@/contexts/api-client-context';

// PWA-specific context for kids mode
interface KidsPWAContextType {
  childId: string | null;
  childProfile: ChildProfile | null;
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
  const firestore = useFirestore();
  const [childId, setChildId] = useState<string | null>(null);
  const [childProfile, setChildProfile] = useState<ChildProfile | null>(null);
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

  // Fetch child profile when childId changes
  useEffect(() => {
    const fetchChildProfile = async () => {
      if (!firestore || !childId || !user) {
        setChildProfile(null);
        return;
      }

      try {
        const childDoc = await getDoc(doc(firestore, 'children', childId));
        if (childDoc.exists()) {
          const data = childDoc.data() as ChildProfile;
          // Verify ownership
          if (data.ownerParentUid === user.uid) {
            setChildProfile({ ...data, id: childDoc.id });
          } else {
            // Not owner - clear the lock
            setChildProfile(null);
            setChildId(null);
            setIsLocked(false);
            localStorage.removeItem(KIDS_CHILD_ID_KEY);
          }
        } else {
          // Child not found - clear the lock
          setChildProfile(null);
          setChildId(null);
          setIsLocked(false);
          localStorage.removeItem(KIDS_CHILD_ID_KEY);
        }
      } catch (err) {
        console.error('[KidsPWA] Error fetching child profile:', err);
        setChildProfile(null);
      }
    };

    fetchChildProfile();
  }, [firestore, childId, user]);

  const lockToChild = useCallback((newChildId: string) => {
    setChildId(newChildId);
    setIsLocked(true);
    if (typeof window !== 'undefined') {
      localStorage.setItem(KIDS_CHILD_ID_KEY, newChildId);
    }
  }, []);

  const unlock = useCallback(() => {
    setChildId(null);
    setChildProfile(null);
    setIsLocked(false);
    if (typeof window !== 'undefined') {
      localStorage.removeItem(KIDS_CHILD_ID_KEY);
    }
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
      <ApiClientProvider>
        <ServiceWorkerRegistration />
        <div className="min-h-screen bg-gradient-to-b from-amber-50 to-orange-50">
          {children}
          <PWAInstallPrompt />
        </div>
      </ApiClientProvider>
    </KidsPWAContext.Provider>
  );
}
