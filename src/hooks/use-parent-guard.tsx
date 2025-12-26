
'use client';

import { createContext, useContext, useState, ReactNode, useMemo, useCallback, useEffect, useRef } from 'react';
import { PinForm } from '@/components/parent/pin-form';
import { useUser } from '@/firebase/auth/use-user';
import { useAppContext } from './use-app-context';

const GUARD_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes
const STORAGE_KEY_PREFIX = 'storypic.parentGuard.lastValidatedAt';

type ParentGuardContextType = {
  isParentGuardValidated: boolean;
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
  const [isPinModalOpen, setIsPinModalOpen] = useState(false);
  const lockTimeoutRef = useRef<number | null>(null);

  const storageKey = useMemo(() => {
    if (!user) return null;
    return `${STORAGE_KEY_PREFIX}:${user.uid}`;
  }, [user]);

  // Hydrate persisted validation timestamp for the current user session.
  useEffect(() => {
    if (!storageKey) {
      setLastValidatedAt(null);
      return;
    }
    const storedValue = sessionStorage.getItem(storageKey);
    if (!storedValue) return;

    const parsed = Number(storedValue);
    if (Number.isNaN(parsed)) {
      sessionStorage.removeItem(storageKey);
      return;
    }
    const isExpired = Date.now() - parsed >= GUARD_TIMEOUT_MS;
    if (isExpired) {
      sessionStorage.removeItem(storageKey);
      setLastValidatedAt(null);
      return;
    }
    setLastValidatedAt(parsed);
  }, [storageKey]);

  // Persist validation timestamp per user so navigating between routes keeps the guard open.
  useEffect(() => {
    if (!storageKey) return;
    if (lastValidatedAt) {
      sessionStorage.setItem(storageKey, lastValidatedAt.toString());
    } else {
      sessionStorage.removeItem(storageKey);
    }
  }, [storageKey, lastValidatedAt]);

  // Auto-lock after the timeout elapses.
  useEffect(() => {
    if (lockTimeoutRef.current) {
      window.clearTimeout(lockTimeoutRef.current);
      lockTimeoutRef.current = null;
    }
    if (!lastValidatedAt) return;

    const msUntilLock = Math.max(lastValidatedAt + GUARD_TIMEOUT_MS - Date.now(), 0);
    lockTimeoutRef.current = window.setTimeout(() => {
      console.log('[ParentGuard] Guard timeout elapsed, clearing validation. RoleMode:', roleMode);
      setLastValidatedAt(null);
      // Only show PIN modal if still in parent mode
      if (roleMode === 'parent') {
        console.log('[ParentGuard] Showing PIN modal after timeout (parent mode)');
        setIsPinModalOpen(true);
      } else {
        console.log('[ParentGuard] Not showing PIN modal after timeout (roleMode:', roleMode, ')');
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
      console.log('[ParentGuard] Bypassing guard for admin role');
      return true;
    }
    const validated = !!lastValidatedAt;
    console.log('[ParentGuard] Validation status:', { roleMode, lastValidatedAt, validated });
    return validated;
  }, [lastValidatedAt, roleMode]);

  const showPinModal = useCallback(() => setIsPinModalOpen(true), []);
  const hidePinModal = useCallback(() => setIsPinModalOpen(false), []);

  const validateGuard = useCallback(() => {
    setLastValidatedAt(Date.now());
    hidePinModal();
  }, [hidePinModal]);

  const value = {
    isParentGuardValidated,
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

    
