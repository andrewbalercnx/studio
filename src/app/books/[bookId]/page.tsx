'use client';

import { use } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Activity, ArrowLeft } from 'lucide-react';
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
        <div className="mb-2 flex items-center justify-between">
          <Button variant="ghost" onClick={() => router.back()} className="text-amber-800">
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back
          </Button>
          {roleMode === 'admin' && (
            <Button asChild variant="ghost" size="sm" className="text-amber-800">
              <Link href={`/admin/trace?bookId=${bookId}`}>
                <Activity className="mr-1 h-4 w-4" />
                Trace
              </Link>
            </Button>
          )}
        </div>
        <BookView bookId={bookId} parent={isParent ? { requireGuard } : undefined} />
      </div>
    </div>
  );
}
