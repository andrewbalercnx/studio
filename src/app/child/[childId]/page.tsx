'use client';

import { use, useEffect } from 'react';
import { useUser } from '@/firebase/auth/use-user';
import { useStoryList } from '@/hooks/use-stories';
import { useBooks } from '@/hooks/use-books';
import { isReadableStatus } from '@/lib/books/types';
import { useAppContext } from '@/hooks/use-app-context';
import { LoaderCircle, BookOpen, Sparkles, BookText } from 'lucide-react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { DashboardNavCard } from '@/components/child/dashboard-nav-card';

export default function ChildDashboardPage({ params }: { params: Promise<{ childId: string }> }) {
  const resolvedParams = use(params);
  const routeChildId = resolvedParams.childId;
  const { user, loading: userLoading } = useUser();
  const {
    activeChildId,
    setActiveChildId,
    activeChildProfile,
    activeChildProfileLoading,
  } = useAppContext();

  // Sync route childId with app context
  useEffect(() => {
    if (routeChildId && routeChildId !== activeChildId) {
      setActiveChildId(routeChildId);
    }
  }, [routeChildId, activeChildId, setActiveChildId]);

  // The child's Stories from the server (finished ones counted).
  const { stories, loading: storiesLoading } = useStoryList(user ? activeChildId : null);
  const storiesCount = stories.filter((story) => story.status === 'complete').length;

  // Books ready to read, by the server's status (new Book pipeline).
  const { books, loading: booksCountLoading } = useBooks({ childId: activeChildId });
  const completedBooksCount = books.filter((book) => isReadableStatus(book.status)).length;

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
            <CardTitle>Let's Sign In</CardTitle>
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
        <h2 className="text-2xl font-semibold">We couldn't find that child.</h2>
        <p className="text-muted-foreground">
          Ask your grown-up to choose a profile from the parent section.
        </p>
      </div>
    );
  }

  return (
    <div className="min-h-[calc(100vh-56px)] bg-gradient-to-b from-primary/10 to-background">
      <div className="container mx-auto px-4 py-10 space-y-10">
        {/* Welcome Section */}
        <div className="text-center space-y-2">
          <p className="text-sm uppercase tracking-wide text-muted-foreground">Welcome back</p>
          <h1 className="text-4xl font-headline">{activeChildProfile.displayName}</h1>
          <p className="text-muted-foreground">What would you like to do today?</p>
        </div>

        {/* Navigation Cards */}
        <div className="grid gap-6 md:grid-cols-3 max-w-4xl mx-auto">
          <DashboardNavCard
            title="New Story"
            description="Create a magical new adventure"
            icon={<Sparkles className="h-8 w-8" />}
            href={`/child/${activeChildId}/create`}
            data-wiz-target="child-new-story"
          />

          <DashboardNavCard
            title="My Stories"
            description="Read your finished stories"
            icon={<BookText className="h-8 w-8" />}
            href={`/child/${activeChildId}/stories`}
            badge={storiesCount}
            data-wiz-target="child-my-stories"
          />

          <DashboardNavCard
            title="My Books"
            description="View your illustrated books"
            icon={<BookOpen className="h-8 w-8" />}
            href={`/child/${activeChildId}/books`}
            badge={completedBooksCount}
            data-wiz-target="child-my-books"
          />
        </div>

        {/* Loading indicator for counts */}
        {(storiesLoading || booksCountLoading) && (
          <div className="text-center text-muted-foreground text-sm">
            Loading your library...
          </div>
        )}
      </div>
    </div>
  );
}
