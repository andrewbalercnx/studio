
'use client';

import { createContext, useContext, useState, ReactNode, useMemo, useCallback, useEffect, useRef } from 'react';
import { PinForm } from '@/components/parent/pin-form';
import { useUser } from '@/firebase/auth/use-user';
import { useAppContext } from './use-app-context';
import { GUARD_TIMEOUT_MS, interpretStoredGuardTimestamp } from './parent-guard-logic';

const STORAGE_KEY_PREFIX = 'storypic.parentGuard.lastValidatedAt';

type ParentGuardContextType = {
  isParentGuardValidated: boolean;
  /**
   * True once the persisted lastValidatedAt has been read for the current
   * user. Consumers MUST NOT open the PIN modal before this turns true — a
   * hard reload inside the unexpired grace window would otherwise re-prompt
   * (probe finding `pin-guard--grace-lost-on-full-reload`).
   */
  isGuardHydrated: boolean;
  showPinModal: () => void;
  hidePinModal: () => void;
  validateGuard: () => void;
};

const ParentGuardContext = createContext<ParentGuardContextType | undefined>(undefined);

export function useParentGuard() {
  const context = useContext(ParentGuardContext);
  if (!context) {
    throw new Error('useParentGuard must be used within a ParentGuardProvider');
  }
  return context;
}

export function ParentGuardProvider({ children }: { children: ReactNode }) {
  const { user } = useUser();
  const { roleMode } = useAppContext();
  const [lastValidatedAt, setLastValidatedAt] = useState<number | null>(null);
  const [isGuardHydrated, setIsGuardHydrated] = useState(false);
  const [isPinModalOpen, setIsPinModalOpen] = useState(false);
  const lockTimeoutRef = useRef<number | null>(null);

  const storageKey = useMemo(() => {
    if (!user) return null;
    return `${STORAGE_KEY_PREFIX}:${user.uid}`;
  }, [user]);

  // Hydrate persisted validation timestamp for the current user session.
  // Marks the guard hydrated afterwards; modal-open decisions are deferred
  // until then so a hard reload inside the grace window never re-prompts.
  useEffect(() => {
    if (!storageKey) {
      setLastValidatedAt(null);
      setIsGuardHydrated(false);
      return;
    }
    const { lastValidatedAt: restored, shouldClear } = interpretStoredGuardTimestamp(
      sessionStorage.getItem(storageKey),
      Date.now(),
      GUARD_TIMEOUT_MS,
    );
    if (shouldClear) {
      sessionStorage.removeItem(storageKey);
    }
    if (restored !== null) {
      setLastValidatedAt(restored);
      // Hydration proved the guard valid: close any modal a consumer opened
      // before hydration completed (effects of children run first).
      setIsPinModalOpen(false);
    } else {
      setLastValidatedAt(null);
    }
    setIsGuardHydrated(true);
  }, [storageKey]);

  // Persist validation timestamp per user so navigating between routes keeps the guard open.
  // Gated on hydration so the initial null state can never wipe the persisted
  // timestamp before it has been read back.
  useEffect(() => {
    if (!storageKey || !isGuardHydrated) return;
    if (lastValidatedAt) {
      sessionStorage.setItem(storageKey, lastValidatedAt.toString());
    } else {
      sessionStorage.removeItem(storageKey);
    }
  }, [storageKey, lastValidatedAt, isGuardHydrated]);

  // Auto-lock after the timeout elapses.
  useEffect(() => {
    if (lockTimeoutRef.current) {
      window.clearTimeout(lockTimeoutRef.current);
      lockTimeoutRef.current = null;
    }
    if (!lastValidatedAt) return;

    const msUntilLock = Math.max(lastValidatedAt + GUARD_TIMEOUT_MS - Date.now(), 0);
    lockTimeoutRef.current = window.setTimeout(() => {
      setLastValidatedAt(null);
      // Only show PIN modal if still in parent mode
      if (roleMode === 'parent') {
        setIsPinModalOpen(true);
      }
    }, msUntilLock);

    return () => {
      if (lockTimeoutRef.current) {
        window.clearTimeout(lockTimeoutRef.current);
        lockTimeoutRef.current = null;
      }
    };
  }, [lastValidatedAt, roleMode]);

  // Reset guard state when the user signs out.
  useEffect(() => {
    if (!user) {
      setLastValidatedAt(null);
      setIsPinModalOpen(false);
    }
  }, [user]);

  const isParentGuardValidated = useMemo(() => {
    // Admins should always bypass the parent PIN guard.
    if (roleMode === 'admin') {
      return true;
    }
    return !!lastValidatedAt;
  }, [lastValidatedAt, roleMode]);

  const showPinModal = useCallback(() => setIsPinModalOpen(true), []);
  const hidePinModal = useCallback(() => setIsPinModalOpen(false), []);

  const validateGuard = useCallback(() => {
    setLastValidatedAt(Date.now());
    hidePinModal();
  }, [hidePinModal]);

  const value = {
    isParentGuardValidated,
    isGuardHydrated,
    showPinModal,
    hidePinModal,
    validateGuard,
  };

  // Log when the PIN modal should be shown
  const shouldShowPinModal = isPinModalOpen && user && roleMode !== 'admin';
  if (isPinModalOpen && !shouldShowPinModal) {
    console.log('[ParentGuard] PIN modal requested but conditions not met:', { isPinModalOpen, hasUser: !!user, roleMode });
  }

  return (
    <ParentGuardContext.Provider value={value}>
      {children}
      {shouldShowPinModal && (
        <PinForm onPinVerified={validateGuard} onOpenChange={setIsPinModalOpen} />
      )}
    </ParentGuardContext.Provider>
  );
}

    
