'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { BookOpen, LoaderCircle } from 'lucide-react';
import { useUser } from '@/firebase/auth/use-user';
import { useAppContext } from '@/hooks/use-app-context';
import { useStoryList } from '@/hooks/use-stories';
import { StoryList } from '@/components/creation';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

/**
 * The active child's Stories for a parent (`GET /api/stories`; status and
 * titles from the server). Finished ones open the parent story view
 * (`/story/{id}`) with its Books. In child mode this redirects to the child's
 * dashboard.
 */
export default function MyStoriesPage() {
  const { user, loading: userLoading } = useUser();
  const { activeChildId, roleMode } = useAppContext();
  const router = useRouter();
  const { stories, loading, error, reload } = useStoryList(user ? activeChildId : null);

  useEffect(() => {
    if (roleMode === 'child' && activeChildId) {
      router.replace(`/child/${activeChildId}`);
    }
  }, [roleMode, activeChildId, router]);

  if (userLoading || (roleMode === 'child' && activeChildId)) {
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
            <CardTitle>Please Sign In</CardTitle>
            <CardDescription>You need to be signed in to see your stories.</CardDescription>
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

  if (!activeChildId) {
    return (
      <div className="text-center py-16 border-2 border-dashed rounded-lg container mx-auto">
        <BookOpen className="mx-auto h-12 w-12 text-muted-foreground" />
        <h3 className="mt-4 text-lg font-medium">No child selected!</h3>
        <p className="mt-1 text-sm text-muted-foreground">Please go to the homepage to select a child profile first.</p>
        <div className="mt-6">
          <Button asChild>
            <Link href="/">Select a Child</Link>
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 py-8 sm:py-12 max-w-2xl">
      <div className="flex justify-between items-center mb-8">
        <h1 className="text-4xl font-bold font-headline">My Stories</h1>
        <Button asChild>
          <Link href={`/child/${activeChildId}/create`}>Create New Story</Link>
        </Button>
      </div>
      {loading ? (
        <div className="flex justify-center py-16">
          <LoaderCircle className="h-8 w-8 animate-spin text-primary" />
        </div>
      ) : error ? (
        <div className="text-center space-y-4 py-12">
          <p className="text-muted-foreground">We couldn&apos;t load the stories right now.</p>
          <Button onClick={reload}>Try Again</Button>
        </div>
      ) : (
        <StoryList
          stories={stories}
          playHref={(id) => `/child/${activeChildId}/create/${id}`}
          readHref={(id) => `/story/${id}`}
          createHref={`/child/${activeChildId}/create`}
        />
      )}
    </div>
  );
}
