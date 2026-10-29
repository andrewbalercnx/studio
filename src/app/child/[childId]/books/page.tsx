'use client';

import { use, useEffect } from 'react';
import Link from 'next/link';
import { ArrowLeft, BookOpen, LoaderCircle } from 'lucide-react';
import { useUser } from '@/firebase/auth/use-user';
import { useAppContext } from '@/hooks/use-app-context';
import { useBooks } from '@/hooks/use-books';
import { BookCard } from '@/components/books';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

/**
 * Web child shell "My Books": the child's Books from the server pipeline,
 * newest first, each with the server's status. Books from before the new
 * pipeline are not listed (trial data, reset with the rebuild); a parent still
 * sees them under Parent › Storybooks.
 */
export default function MyBooksPage({ params }: { params: Promise<{ childId: string }> }) {
  const { childId: routeChildId } = use(params);
  const { user, loading: userLoading } = useUser();
  const { activeChildId, setActiveChildId, activeChildProfile, activeChildProfileLoading } = useAppContext();
  const { books, loading: booksLoading } = useBooks({ childId: activeChildId });

  useEffect(() => {
    if (routeChildId && routeChildId !== activeChildId) {
      setActiveChildId(routeChildId);
    }
  }, [routeChildId, activeChildId, setActiveChildId]);

  if (userLoading || activeChildProfileLoading) {
    return (
      <div className="h-screen w-screen flex items-center justify-center">
        <LoaderCircle className="h-12 w-12 animate-spin text-primary" />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="container mx-auto px-4 py-12 text-center">
        <Card className="max-w-md mx-auto">
          <CardHeader>
            <CardTitle>Let&apos;s Sign In</CardTitle>
            <CardDescription>A parent needs to sign in again.</CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild>
              <Link href="/login">Sign In</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!activeChildProfile) {
    return (
      <div className="container mx-auto px-4 py-16 text-center space-y-4">
        <BookOpen className="mx-auto h-12 w-12 text-muted-foreground" />
        <h2 className="text-2xl font-semibold">We couldn&apos;t find that child.</h2>
        <p className="text-muted-foreground">Ask your grown-up to choose a profile from the parent section.</p>
      </div>
    );
  }

  return (
    <div className="min-h-[calc(100vh-56px)] bg-gradient-to-b from-primary/10 to-background">
      <div className="container mx-auto px-4 py-10 space-y-8">
        <div className="flex items-center gap-4">
          <Button asChild variant="ghost" size="icon">
            <Link href={`/child/${activeChildId}`} aria-label="Back">
              <ArrowLeft className="h-5 w-5" />
            </Link>
          </Button>
          <div>
            <h1 className="text-3xl font-headline">My Books</h1>
            <p className="text-muted-foreground">{booksLoading ? 'Loading...' : `${books.length} books`}</p>
          </div>
        </div>

        {booksLoading ? (
          <div className="flex items-center justify-center py-16">
            <LoaderCircle className="h-8 w-8 animate-spin text-primary" />
          </div>
        ) : books.length > 0 ? (
          <div className="grid gap-6 grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
            {books.map((book) => (
              <BookCard key={book.id} book={book} href={`/books/${book.id}`} />
            ))}
          </div>
        ) : (
          <Card className="border-dashed max-w-md mx-auto">
            <CardContent className="flex flex-col items-center gap-4 py-10">
              <BookOpen className="h-12 w-12 text-muted-foreground" />
              <div className="text-center">
                <p className="font-medium">No books yet!</p>
                <p className="text-muted-foreground">Create a book from one of your stories to see it here.</p>
              </div>
              <Button asChild>
                <Link href={`/child/${activeChildId}/stories`}>Go to My Stories</Link>
              </Button>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
