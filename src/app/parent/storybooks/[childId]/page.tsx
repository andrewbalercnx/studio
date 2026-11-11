'use client';

import { useCallback, useMemo } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft, BookOpen, LoaderCircle, Sparkles, User } from 'lucide-react';
import { useUser } from '@/firebase/auth/use-user';
import { usePerson } from '@/lib/people/use-people';
import { useAppContext } from '@/hooks/use-app-context';
import { useParentGuard } from '@/hooks/use-parent-guard';
import { useBooks } from '@/hooks/use-books';
import { BookCard } from '@/components/books';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';

/**
 * Parent console: one child's Books (server pipeline; status from the
 * server). Each Book's page is where the parent picks its print template
 * and orders a printed copy.
 */
export default function ChildStorybooksPage() {
  const params = useParams();
  const childId = params.childId as string;
  const { user, loading: userLoading } = useUser();
  const { isParentGuardValidated } = useParentGuard();
  const router = useRouter();
  const { setActiveChildId } = useAppContext();

  const { person: child } = usePerson('child', childId || null);
  const { books, loading: booksLoading } = useBooks({ childId });

  // Empty-state CTA: jump straight into this child's experience to start a story.
  const handleStartStory = useCallback(() => {
    setActiveChildId(childId);
    router.push(`/child/${childId}`);
  }, [setActiveChildId, router, childId]);

  if (!isParentGuardValidated) return null;

  const childName = child?.displayName ?? '';
  const loading = userLoading || booksLoading;

  return (
    <div className="container mx-auto p-4 sm:p-6 md:p-8 space-y-6">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="sm" asChild>
          <Link href="/parent/storybooks">
            <ArrowLeft className="mr-1 h-4 w-4" />
            All Children
          </Link>
        </Button>
      </div>

      <div className="flex items-center gap-4">
        <Avatar className="h-12 w-12">
          <AvatarImage src={child?.likeness.avatar || undefined} alt={childName} />
          <AvatarFallback>{childName.charAt(0).toUpperCase() || <User className="h-6 w-6" />}</AvatarFallback>
        </Avatar>
        <div>
          <h1 className="text-3xl font-bold">{childName || 'Storybooks'}</h1>
          <p className="text-muted-foreground">{loading ? 'Loading...' : `${books.length} ${books.length === 1 ? 'book' : 'books'}`}</p>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16">
          <LoaderCircle className="h-8 w-8 animate-spin text-primary" />
        </div>
      ) : books.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12 gap-4">
            <BookOpen className="h-12 w-12 text-muted-foreground" />
            <div className="text-center max-w-md">
              <p className="font-medium">No completed storybooks yet</p>
              <p className="text-muted-foreground">
                Make up a story with {childName || 'this child'}, pick an art style, and the finished book will appear here.
              </p>
            </div>
            <Button onClick={handleStartStory}>
              <Sparkles className="mr-2 h-4 w-4" />
              Start a story{childName ? ` with ${childName}` : ''}
            </Button>
          </CardContent>
        </Card>
      ) : (
        <section className="space-y-3">
          <div>
            <h2 className="text-xl font-semibold">Books</h2>
            <p className="text-sm text-muted-foreground">Open a book to choose its print template and order a printed copy.</p>
          </div>
          <div className="grid gap-4 grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
            {books.map((book) => (
              <BookCard key={book.id} book={book} href={`/parent/books/${book.id}`} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
