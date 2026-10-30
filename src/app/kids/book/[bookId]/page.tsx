'use client';

import { use, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, LoaderCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useUser } from '@/firebase/auth/use-user';
import { useKidsPWA } from '../../layout';
import { BookView } from '@/components/books';

/**
 * Kids PWA: one Book. Shows the server's progress while it is being made and
 * the reader once it is ready (or partial). No parent controls on the child's
 * device; a parent retries or locks from the web app.
 */
export default function KidsBookPage({ params }: { params: Promise<{ bookId: string }> }) {
  const { bookId } = use(params);
  const router = useRouter();
  const { user, loading: userLoading } = useUser();
  const { childId, isLocked, isLoading: kidsLoading } = useKidsPWA();

  useEffect(() => {
    if (!kidsLoading && !userLoading && (!user || !isLocked || !childId)) {
      router.replace('/kids');
    }
  }, [kidsLoading, userLoading, user, isLocked, childId, router]);

  if (userLoading || kidsLoading || !user) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <LoaderCircle className="h-12 w-12 animate-spin text-amber-500" />
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col bg-gradient-to-b from-amber-50 to-orange-50">
      <header className="px-4 py-4 flex items-center gap-2">
        <Link href="/kids/books">
          <Button variant="ghost" size="icon" className="text-amber-700" aria-label="Back to My Books">
            <ArrowLeft className="h-5 w-5" />
          </Button>
        </Link>
      </header>
      <main className="flex-1">
        <BookView bookId={bookId} />
      </main>
    </div>
  );
}
