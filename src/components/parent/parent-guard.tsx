
'use client';

import { useParentGuard } from '@/hooks/use-parent-guard';
import { useUser } from '@/firebase/auth/use-user';
import { useAppContext } from '@/hooks/use-app-context';
import { useEffect, type ReactNode } from 'react';
import { LoaderCircle } from 'lucide-react';

export function ParentGuard({ children }: { children: ReactNode }) {
  const { isParentGuardValidated, isGuardHydrated, showPinModal } = useParentGuard();
  const { user, loading: userLoading } = useUser();
  const { roleMode } = useAppContext();

  useEffect(() => {
    // Only trigger the PIN modal once the user is loaded AND the persisted
    // grace timestamp has hydrated — a hard reload inside the unexpired
    // window must NOT re-prompt (docs/testing/pin-guard.md §4).
    if (!userLoading && user && isGuardHydrated && !isParentGuardValidated) {
      showPinModal();
    }
  }, [isParentGuardValidated, isGuardHydrated, showPinModal, userLoading, user]);

  // Show loading state while user is being loaded
  if (userLoading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="text-center p-8">
          <LoaderCircle className="h-8 w-8 animate-spin mx-auto mb-4 text-primary" />
          <p className="text-muted-foreground">Loading...</p>
        </div>
      </div>
    );
  }

  // If not authenticated, redirect will happen via other guards
  if (!user) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="text-center p-8">
          <p className="text-muted-foreground">Please sign in to continue.</p>
        </div>
      </div>
    );
  }

  // Show waiting state while PIN modal is being shown
  if (!isParentGuardValidated) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="text-center p-8">
          <p className="text-muted-foreground">Verifying parent access...</p>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}

    