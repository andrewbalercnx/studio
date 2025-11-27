'use client';

import { useEffect, useMemo } from 'react';
import { useUser } from '@/firebase/auth/use-user';
import { useFirestore } from '@/firebase';
import { collection, orderBy, query, where } from 'firebase/firestore';
import { useCollection } from '@/lib/firestore-hooks';
import type { StorySession } from '@/lib/types';
import { useAppContext } from '@/hooks/use-app-context';
import { LoaderCircle, BookOpen, Sparkles } from 'lucide-react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { useRouter } from 'next/navigation';
import { useParentGuard } from '@/hooks/use-parent-guard';
import { formatDistanceToNow } from 'date-fns';

function ChildStoryCard({ story }: { story: StorySession }) {
  const createdAt = story.createdAt?.toDate ? story.createdAt.toDate() : new Date();
  return (
    <Card className="flex flex-col border-2 border-primary/20 bg-primary/5">
      <CardHeader>
        <CardTitle className="text-xl">{story.storyTitle || 'Your Adventure'}</CardTitle>
        <CardDescription>Created {formatDistanceToNow(createdAt, { addSuffix: true })}</CardDescription>
      </CardHeader>
      <CardContent className="flex-grow">
        <div className="flex flex-wrap gap-2">
          {story.storyVibe && <Badge variant="outline">{story.storyVibe}</Badge>}
          <Badge variant="secondary">{story.currentPhase}</Badge>
        </div>
      </CardContent>
      <CardFooter>
        <Button asChild className="w-full">
          <Link href={`/story/session/${story.id}`}>
            {story.status === 'completed' ? 'Read Story' : 'Continue Story'}
          </Link>
        </Button>
      </CardFooter>
    </Card>
  );
}

export default function ChildExperiencePage({ params }: { params: { childId: string } }) {
  const { user, loading: userLoading } = useUser();
  const firestore = useFirestore();
  const {
    activeChildId,
    setActiveChildId,
    activeChildProfile,
    activeChildProfileLoading,
    switchToParentMode,
  } = useAppContext();
  const { showPinModal } = useParentGuard();
  const router = useRouter();

  useEffect(() => {
    if (params.childId && params.childId !== activeChildId) {
      setActiveChildId(params.childId);
    }
  }, [params.childId, activeChildId, setActiveChildId]);

  const storiesQuery = useMemo(() => {
    if (!user || !firestore || !activeChildId) return null;
    return query(
      collection(firestore, 'storySessions'),
      where('parentUid', '==', user.uid),
      where('childId', '==', activeChildId),
      orderBy('createdAt', 'desc')
    );
  }, [user, firestore, activeChildId]);

  const { data: stories, loading: storiesLoading } = useCollection<StorySession>(storiesQuery);

  const handleReturnToParent = () => {
    switchToParentMode();
    showPinModal();
    router.push('/parent');
  };

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
            <CardTitle>Let’s Sign In</CardTitle>
            <CardDescription>A parent needs to sign in again.</CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild><Link href="/login">Sign In</Link></Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!activeChildProfile) {
    return (
      <div className="container mx-auto px-4 py-16 text-center space-y-4">
        <BookOpen className="mx-auto h-12 w-12 text-muted-foreground" />
        <h2 className="text-2xl font-semibold">We couldn’t find that child.</h2>
        <p className="text-muted-foreground">
          Ask your grown-up to choose a profile from the parent section.
        </p>
        <Button variant="secondary" onClick={handleReturnToParent}>Back to Parent</Button>
      </div>
    );
  }

  return (
    <div className="min-h-[calc(100vh-56px)] bg-gradient-to-b from-primary/10 to-background">
      <div className="container mx-auto px-4 py-10 space-y-10">
        <div className="text-center space-y-2">
          <p className="text-sm uppercase tracking-wide text-muted-foreground">Playing as</p>
          <h1 className="text-4xl font-headline">{activeChildProfile.displayName}</h1>
          <p className="text-muted-foreground">Pick a story to keep going or start a brand new adventure.</p>
        </div>

        <div className="flex flex-col items-center gap-4">
          <Button asChild size="lg" className="gap-2 text-lg">
            <Link href="/story/start">
              <Sparkles className="h-5 w-5" />
              Start a New Story
            </Link>
          </Button>
          <Button variant="ghost" onClick={handleReturnToParent}>
            Back to Parent
          </Button>
        </div>

        <section className="space-y-4">
          <h2 className="text-2xl font-semibold">Your Stories</h2>
          {storiesLoading && !stories ? (
            <div className="flex items-center justify-center py-12">
              <LoaderCircle className="h-8 w-8 animate-spin text-primary" />
            </div>
          ) : stories && stories.length > 0 ? (
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {stories.map((story) => (
                <ChildStoryCard key={story.id} story={story} />
              ))}
            </div>
          ) : (
            <Card className="border-dashed">
              <CardContent className="flex flex-col items-center gap-4 py-10">
                <BookOpen className="h-12 w-12 text-muted-foreground" />
                <p className="text-muted-foreground">No stories yet. Tap “Start a New Story” to begin!</p>
              </CardContent>
            </Card>
          )}
        </section>
      </div>
    </div>
  );
}
