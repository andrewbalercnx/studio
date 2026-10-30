'use client';

import { use } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAppContext } from '@/hooks/use-app-context';
import { useParentGuard } from '@/hooks/use-parent-guard';
import { BookView } from '@/components/books';

/**
 * Web: one Book from the server pipeline. Progress while it is being made,
 * then the reader. In parent mode (not child mode) the parent can draw a
 * failed picture again and lock or unlock the Book, each behind the PIN guard.
 * Printing is not available for these Books yet (print slice).
 */
export default function BookPage({ params }: { params: Promise<{ bookId: string }> }) {
  const { bookId } = use(params);
  const router = useRouter();
  const { roleMode } = useAppContext();
  const { isParentGuardValidated, showPinModal } = useParentGuard();
  const isParent = roleMode === 'parent' || roleMode === 'admin';

  const requireGuard = () => {
    if (isParentGuardValidated) return true;
    showPinModal();
    return false;
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-amber-50 to-orange-50">
      <div className="container mx-auto max-w-3xl px-2 py-4">
        <Button variant="ghost" onClick={() => router.back()} className="mb-2 text-amber-800">
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back
        </Button>
        <BookView bookId={bookId} parent={isParent ? { requireGuard } : undefined} />
      </div>
    </div>
  );
}
