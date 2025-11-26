
'use client';

import { useParentGuard } from '@/hooks/use-parent-guard';
import { useEffect, type ReactNode } from 'react';

export function ParentGuard({ children }: { children: ReactNode }) {
  const { isParentGuardValidated, showPinModal } = useParentGuard();

  useEffect(() => {
    if (!isParentGuardValidated) {
      showPinModal();
    }
  }, [isParentGuardValidated, showPinModal]);

  if (!isParentGuardValidated) {
    // You can render a loading state or a placeholder here
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

    