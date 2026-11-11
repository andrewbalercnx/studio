'use client';

import { use } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { BookView } from '@/components/books';
import { useAppContext } from '@/hooks/use-app-context';
import { useParentGuard } from '@/hooks/use-parent-guard';

/**
 * Parent console: one Book with the parent controls (lock, redraw a failed
 * picture, choose the print template, order a printed copy). Inside the
 * console's PIN guard, so the controls show whatever child is selected on the
 * device; `/books/{id}` is the reader the child shell links to.
 */
export default function ParentBookPage({ params }: { params: Promise<{ bookId: string }> }) {
  const { bookId } = use(params);
  const router = useRouter();
  const { roleMode } = useAppContext();
  const { isParentGuardValidated, showPinModal } = useParentGuard();

  const requireGuard = () => {
    if (isParentGuardValidated) return true;
    showPinModal();
    return false;
  };

  if (!isParentGuardValidated) return null;

  return (
    <div className="space-y-2">
      <Button variant="ghost" onClick={() => router.back()}>
        <ArrowLeft className="mr-2 h-4 w-4" />
        Back
      </Button>
      <BookView bookId={bookId} parent={{ requireGuard }} admin={roleMode === 'admin'} />
    </div>
  );
}
