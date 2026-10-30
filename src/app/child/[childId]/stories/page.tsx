'use client';

import { use, useEffect } from 'react';
import Link from 'next/link';
import { ArrowLeft, BookOpen, LoaderCircle } from 'lucide-react';
import { useUser } from '@/firebase/auth/use-user';
import { useAppContext } from '@/hooks/use-app-context';
import { useStoryList } from '@/hooks/use-stories';
import { StoryList } from '@/components/creation';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

/**
 * Web child shell: the child's Stories as the server lists them (status and
 * titles from the server). Stories still being made can be continued; finished
 * ones are read at `/child/{childId}/story/{storyId}/read`.
 */
export default function MyStoriesPage({ params }: { params: Promise<{ childId: string }> }) {
  const { childId } = use(params);
  const { user, loading: userLoading } = useUser();
  const { activeChildId, setActiveChildId, activeChildProfile, activeChildProfileLoading } = useAppContext();
  const { stories, loading: storiesLoading, error, reload } = useStoryList(user ? childId : null);

  useEffect(() => {
    if (childId && childId !== activeChildId) setActiveChildId(childId);
  }, [childId, activeChildId, setActiveChildId]);

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
      <div className="container mx-auto px-4 py-10 space-y-8 max-w-2xl">
        <div className="flex items-center gap-4">
          <Button asChild variant="ghost" size="icon">
            <Link href={`/child/${childId}`} aria-label="Back">
              <ArrowLeft className="h-5 w-5" />
            </Link>
          </Button>
          <div>
            <h1 className="text-3xl font-headline">My Stories</h1>
            <p className="text-muted-foreground">{storiesLoading ? 'Loading...' : `${stories.length} stories`}</p>
          </div>
        </div>

        {storiesLoading ? (
          <div className="flex items-center justify-center py-16">
            <LoaderCircle className="h-8 w-8 animate-spin text-primary" />
          </div>
        ) : error ? (
          <div className="text-center space-y-4 py-12">
            <p className="text-muted-foreground">We couldn&apos;t fetch your stories right now.</p>
            <Button onClick={reload}>Try Again</Button>
          </div>
        ) : (
          <StoryList
            stories={stories}
            playHref={(id) => `/child/${childId}/create/${id}`}
            readHref={(id) => `/child/${childId}/story/${id}/read`}
            createHref={`/child/${childId}/create`}
          />
        )}
      </div>
    </div>
  );
}
