'use client';

import { use, useEffect, useMemo, useState } from 'react';
import { useUser } from '@/firebase/auth/use-user';
import { useFirestore } from '@/firebase';
import { collection, query, where, getDocs } from 'firebase/firestore';
import { useCollection } from '@/lib/firestore-hooks';
import type { Story, StoryBookOutput } from '@/lib/types';
import { useAppContext } from '@/hooks/use-app-context';
import { LoaderCircle, BookOpen, Sparkles, BookText } from 'lucide-react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { DashboardNavCard } from '@/components/child/dashboard-nav-card';

export default function ChildDashboardPage({ params }: { params: Promise<{ childId: string }> }) {
  const resolvedParams = use(params);
  const routeChildId = resolvedParams.childId;
  const { user, idTokenResult, loading: userLoading } = useUser();
  const firestore = useFirestore();
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

  // Query stories for this child to get count (only when authenticated and auth token is ready)
  // We wait for idTokenResult to ensure Firebase auth is fully synced with Firestore
  const storiesQuery = useMemo(() => {
    if (!firestore || !activeChildId || !user || userLoading || !idTokenResult) return null;
    return query(
      collection(firestore, 'stories'),
      where('childId', '==', activeChildId)
    );
  }, [firestore, activeChildId, user, userLoading, idTokenResult]);

  const { data: stories, loading: storiesLoading } = useCollection<Story>(storiesQuery);
  const storiesCount = stories?.length ?? 0;

  // Count completed books from both legacy model and new storybooks subcollection
  const [completedBooksCount, setCompletedBooksCount] = useState(0);
  const [booksCountLoading, setBooksCountLoading] = useState(true);

  useEffect(() => {
    const countCompletedBooks = async () => {
      if (!firestore || !stories || storiesLoading) {
        setBooksCountLoading(false);
        return;
      }

      setBooksCountLoading(true);
      let count = 0;

      for (const story of stories) {
        // Skip soft-deleted stories
        if (story.deletedAt) continue;

        // Count legacy books (imageGeneration on Story document)
        if (story.imageGeneration?.status === 'ready') {
          count++;
        }

        // Count new storybooks from subcollection
        try {
          const storybooksRef = collection(firestore, 'stories', story.id || story.storySessionId, 'storybooks');
          const storybooksSnap = await getDocs(storybooksRef);
          for (const sbDoc of storybooksSnap.docs) {
            const sb = sbDoc.data() as StoryBookOutput;
            // Skip soft-deleted storybooks
            if (sb.deletedAt) continue;
            if (sb.imageGeneration?.status === 'ready') {
              count++;
            }
          }
        } catch (err) {
          console.error('Error counting storybooks for story:', story.id, err);
        }
      }

      setCompletedBooksCount(count);
      setBooksCountLoading(false);
    };

    countCompletedBooks();
  }, [firestore, stories, storiesLoading]);

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
            href="/story/start"
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
