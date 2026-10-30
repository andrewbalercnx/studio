'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, LoaderCircle, Sparkles } from 'lucide-react';
import { useUser } from '@/firebase/auth/use-user';
import { useKidsPWA } from '../layout';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar';
import { useBooks } from '@/hooks/use-books';
import { BookCard } from '@/components/books';

/**
 * Kids PWA "My Books": the locked child's Books, newest first. Each card shows
 * the server's status (`ready` / `partial` open the reader; a Book being made
 * shows its progress). Books from before the new pipeline are not listed here
 * (trial data, reset with the rebuild).
 */
export default function KidsBooksPage() {
  const router = useRouter();
  const { user, loading: userLoading } = useUser();
  const { childId, childProfile, isLocked, isLoading: kidsLoading } = useKidsPWA();
  const { books, loading, error } = useBooks({ childId });

  useEffect(() => {
    if (!kidsLoading && !userLoading) {
      if (!user) {
        router.replace('/kids');
        return;
      }
      if (!isLocked || !childId) {
        router.replace('/kids/setup');
      }
    }
  }, [kidsLoading, userLoading, user, isLocked, childId, router]);

  if (userLoading || kidsLoading || !isLocked || !childProfile) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-b from-amber-50 to-orange-50">
        <LoaderCircle className="h-12 w-12 animate-spin text-amber-500" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-gradient-to-b from-amber-50 to-orange-50 p-4 gap-4">
        <span className="text-6xl" role="img" aria-label="sleepy books">📚</span>
        <h1 className="text-xl font-bold text-amber-900 text-center">Your bookshelf is taking a little nap!</h1>
        <p className="text-amber-700 text-center max-w-xs">We couldn&apos;t fetch your books right now. Let&apos;s try again!</p>
        <div className="flex gap-3">
          <Button className="bg-amber-500 hover:bg-amber-600" onClick={() => window.location.reload()}>
            Try Again
          </Button>
          <Button asChild variant="outline">
            <Link href="/kids">Go Home</Link>
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col bg-gradient-to-b from-amber-50 to-orange-50">
      <header className="px-4 py-4 flex items-center gap-3 border-b border-amber-200 bg-white/50">
        <Link href="/kids">
          <Button variant="ghost" size="icon" className="text-amber-700" aria-label="Home">
            <ArrowLeft className="h-5 w-5" />
          </Button>
        </Link>
        <Avatar className="h-10 w-10 border-2 border-amber-300">
          {childProfile.avatarUrl ? <AvatarImage src={childProfile.avatarUrl} alt={childProfile.displayName} /> : null}
          <AvatarFallback className="bg-gradient-to-br from-amber-200 to-orange-300 text-amber-800 text-sm font-bold">
            {childProfile.displayName?.charAt(0).toUpperCase() || '?'}
          </AvatarFallback>
        </Avatar>
        <div className="flex-1">
          <h1 className="text-xl font-bold text-amber-900">My Books</h1>
          <p className="text-sm text-amber-700">{loading ? 'Loading...' : `${books.length} books`}</p>
        </div>
      </header>

      <main className="flex-1 px-3 py-3">
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <LoaderCircle className="h-8 w-8 animate-spin text-amber-500" />
          </div>
        ) : books.length > 0 ? (
          <div className="grid grid-cols-2 gap-3">
            {books.map((book) => (
              <BookCard key={book.id} book={book} href={`/kids/book/${book.id}`} />
            ))}
          </div>
        ) : (
          <div className="text-center py-12 space-y-4">
            <div className="text-6xl">📚</div>
            <h3 className="text-lg font-semibold text-gray-700">No books yet</h3>
            <p className="text-gray-500">Create a story first, then turn it into a picture book!</p>
            <Link href="/kids/create">
              <Button className="bg-amber-500 hover:bg-amber-600">
                <Sparkles className="h-4 w-4 mr-2" />
                Create a Story
              </Button>
            </Link>
          </div>
        )}
      </main>

      {books.length > 0 && (
        <div className="fixed bottom-6 right-6">
          <Link href="/kids/create">
            <Button size="lg" className="rounded-full w-14 h-14 bg-amber-500 hover:bg-amber-600 shadow-lg" aria-label="Create a story">
              <Sparkles className="h-6 w-6" />
            </Button>
          </Link>
        </div>
      )}
    </div>
  );
}
