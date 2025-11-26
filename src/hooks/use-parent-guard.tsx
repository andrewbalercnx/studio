
'use client';

import { createContext, useContext, useState, ReactNode, useMemo, useCallback } from 'react';
import { PinForm } from '@/components/parent/pin-form';
import { useUser } from '@/firebase/auth/use-user';
import { useAppContext } from './use-app-context';

const GUARD_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

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

  const isParentGuardValidated = useMemo(() => {
    // Admins should always bypass the parent PIN guard.
    if (roleMode === 'admin') {
      return true;
    }
    if (!lastValidatedAt) return false;
    return Date.now() - lastValidatedAt < GUARD_TIMEOUT_MS;
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

  return (
    <ParentGuardContext.Provider value={value}>
      {children}
      {isPinModalOpen && user && roleMode !== 'admin' && (
        <PinForm onPinVerified={validateGuard} onOpenChange={setIsPinModalOpen} />
      )}
    </ParentGuardContext.Provider>
  );
}

    