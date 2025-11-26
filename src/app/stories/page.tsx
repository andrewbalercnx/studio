
'use client';

import { useMemo } from 'react';
import { useUser } from '@/firebase/auth/use-user';
import { useFirestore } from '@/firebase';
import { collection, query, where, orderBy } from 'firebase/firestore';
import { useCollection } from '@/lib/firestore-hooks';
import type { StorySession } from '@/lib/types';
import { LoaderCircle, BookOpen } from 'lucide-react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { formatDistanceToNow } from 'date-fns';

function StoryCard({ story }: { story: StorySession }) {
  return (
    <Card className="flex flex-col">
      <CardHeader>
        <CardTitle>{story.storyTitle || 'Untitled Story'}</CardTitle>
        <CardDescription>
          Created {formatDistanceToNow(story.createdAt.toDate(), { addSuffix: true })}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex-grow">
        <div className="flex flex-wrap gap-2">
            <Badge variant="outline">{story.storyVibe}</Badge>
            <Badge variant="secondary">{story.currentPhase}</Badge>
        </div>
      </CardContent>
      <CardFooter>
        <Button asChild className="w-full">
          <Link href={`/story/session/${story.id}`}>
            {story.status === 'completed' ? 'View Story' : 'Continue Story'}
          </Link>
        </Button>
      </CardFooter>
    </Card>
  );
}

export default function MyStoriesPage() {
  const { user, loading: userLoading } = useUser();
  const firestore = useFirestore();

  // For now, we'll use the parent's UID as the childId for their own stories.
  // This will be updated when we have a proper child selection flow.
  const activeChildId = user?.uid;

  const storiesQuery = useMemo(() => {
    if (!user || !firestore || !activeChildId) return null;
    return query(
      collection(firestore, 'storySessions'),
      where('childId', '==', activeChildId),
      orderBy('createdAt', 'desc')
    );
  }, [user, firestore, activeChildId]);

  const { data: stories, loading: storiesLoading, error: storiesError } = useCollection<StorySession>(storiesQuery);

  if (userLoading || storiesLoading) {
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
                <Button asChild><Link href="/login">Sign In</Link></Button>
            </CardContent>
        </Card>
      </div>
    );
  }
  
  if (storiesError) {
      return <div className="text-center p-8 text-destructive">Error loading stories: {storiesError.message}</div>
  }

  return (
    <div className="container mx-auto px-4 py-8 sm:py-12">
        <div className="flex justify-between items-center mb-8">
            <h1 className="text-4xl font-bold font-headline">My Stories</h1>
             <Button asChild>
                <Link href="/story/start">Create New Story</Link>
            </Button>
        </div>

      {stories && stories.length > 0 ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
            {stories.map(story => <StoryCard key={story.id} story={story} />)}
        </div>
      ) : (
         <div className="text-center py-16 border-2 border-dashed rounded-lg">
            <BookOpen className="mx-auto h-12 w-12 text-muted-foreground" />
            <h3 className="mt-4 text-lg font-medium">No stories yet!</h3>
            <p className="mt-1 text-sm text-muted-foreground">Ready to create your first magical adventure?</p>
            <div className="mt-6">
                <Button asChild>
                    <Link href="/story/start">Start a New Story</Link>
                </Button>
            </div>
         </div>
      )}
    </div>
  );
}
