'use client';

import { useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { useUser } from '@/firebase/auth/use-user';
import { useFirestore } from '@/firebase';
import { collection, query, where } from 'firebase/firestore';
import { useCollection } from '@/lib/firestore-hooks';
import { useKidsPWA } from '../layout';
import type { Story } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { LoaderCircle, ArrowLeft, BookOpen, Sparkles, Clock, CheckCircle2, AlertCircle, Pencil, Play, PlusCircle, Moon } from 'lucide-react';
import Link from 'next/link';
import { cn } from '@/lib/utils';
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar';

export default function KidsStoriesPage() {
  const router = useRouter();
  const { user, loading: userLoading } = useUser();
  const firestore = useFirestore();
  const { childId, childProfile, isLocked } = useKidsPWA();

  // Load stories for this child
  // Note: We don't use orderBy to avoid requiring a composite index - sort client-side instead
  const storiesQuery = useMemo(() => {
    if (!firestore || !childId || !user) return null;
    return query(
      collection(firestore, 'stories'),
      where('childId', '==', childId)
    );
  }, [firestore, childId, user]);

  const { data: storiesRaw, loading: storiesLoading } = useCollection<Story>(storiesQuery);

  // Sort stories client-side
  const sortedStories = useMemo(() => {
    if (!storiesRaw) return [];

    // Filter out soft-deleted stories (defense in depth - rules should block these anyway)
    const nonDeleted = storiesRaw.filter((s) => !s.deletedAt);

    // Sort by createdAt descending (newest first)
    return [...nonDeleted].sort((a, b) => {
      const aTime = a.createdAt?.toDate?.()?.getTime() ?? 0;
      const bTime = b.createdAt?.toDate?.()?.getTime() ?? 0;
      return bTime - aTime;
    });
  }, [storiesRaw]);

  // Redirect if not set up
  useEffect(() => {
    if (!userLoading && (!user || !isLocked || !childId)) {
      router.replace('/kids');
    }
  }, [userLoading, user, isLocked, childId, router]);

  // Loading state
  if (userLoading || storiesLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-b from-amber-50 to-orange-50">
        <LoaderCircle className="h-12 w-12 animate-spin text-amber-500" />
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col bg-gradient-to-b from-amber-50 to-orange-50">
      {/* Header with child avatar */}
      <header className="px-4 py-4 flex items-center gap-3 border-b border-amber-200 bg-white/50">
        <Link href="/kids">
          <Button variant="ghost" size="icon" className="text-amber-700">
            <ArrowLeft className="h-5 w-5" />
          </Button>
        </Link>
        <Avatar className="h-10 w-10 border-2 border-amber-300">
          {childProfile?.avatarUrl ? (
            <AvatarImage src={childProfile.avatarUrl} alt={childProfile.displayName} />
          ) : null}
          <AvatarFallback className="bg-gradient-to-br from-amber-200 to-orange-300 text-amber-800 text-sm font-bold">
            {childProfile?.displayName?.charAt(0).toUpperCase() || '?'}
          </AvatarFallback>
        </Avatar>
        <div className="flex-1">
          <h1 className="text-xl font-bold text-amber-900">My Stories</h1>
          <p className="text-sm text-amber-700">
            {childProfile?.displayName}'s creations
          </p>
        </div>
      </header>

      {/* Stories list */}
      <main className="flex-1 px-4 py-4">
        <div className="max-w-md mx-auto space-y-3">
          {sortedStories.length === 0 ? (
            <div className="text-center py-12 space-y-4">
              <div className="w-20 h-20 mx-auto rounded-full bg-amber-100 flex items-center justify-center">
                <BookOpen className="h-10 w-10 text-amber-400" />
              </div>
              <h3 className="text-lg font-semibold text-gray-700">
                No stories yet
              </h3>
              <p className="text-gray-500">
                Create your first magical story!
              </p>
              <Link href="/kids/create">
                <Button className="bg-amber-500 hover:bg-amber-600">
                  <Sparkles className="h-4 w-4 mr-2" />
                  Create a Story
                </Button>
              </Link>
            </div>
          ) : (
            sortedStories.map((story) => (
              <StoryCard key={story.id || story.storySessionId} story={story} />
            ))
          )}
        </div>
      </main>

      {/* Floating create button */}
      {sortedStories.length > 0 && (
        <div className="fixed bottom-6 right-6">
          <Link href="/kids/create">
            <Button
              size="lg"
              className="rounded-full w-14 h-14 bg-amber-500 hover:bg-amber-600 shadow-lg"
            >
              <Sparkles className="h-6 w-6" />
            </Button>
          </Link>
        </div>
      )}
    </div>
  );
}

// Story card component with expanded functionality
function StoryCard({ story }: { story: Story }) {
  const storyId = story.id || story.storySessionId;
  const title = story.metadata?.title || 'Untitled Story';
  const pageStatus = story.pageGeneration?.status ?? 'idle';
  const imageStatus = story.imageGeneration?.status ?? 'idle';
  const hasBook = imageStatus === 'ready' || pageStatus === 'ready';
  const isGenerating = pageStatus === 'running' || imageStatus === 'running';
  const isRateLimited = pageStatus === 'rate_limited' || imageStatus === 'rate_limited';
  const hasError = pageStatus === 'error' || imageStatus === 'error';
  const canCreateBook = !hasBook && !isGenerating && !isRateLimited && !hasError;

  // Determine the status display
  const getStatusInfo = () => {
    if (imageStatus === 'ready') {
      return { icon: <CheckCircle2 className="h-4 w-4" />, text: 'Book ready!', color: 'text-green-600' };
    }
    if (isGenerating) {
      return { icon: <LoaderCircle className="h-4 w-4 animate-spin" />, text: 'Creating book...', color: 'text-amber-600' };
    }
    if (isRateLimited) {
      return { icon: <Moon className="h-4 w-4" />, text: 'Wizard napping', color: 'text-amber-700' };
    }
    if (hasError) {
      return { icon: <AlertCircle className="h-4 w-4" />, text: 'Something went wrong', color: 'text-red-500' };
    }
    if (pageStatus === 'ready') {
      return { icon: <Pencil className="h-4 w-4" />, text: 'Pages ready', color: 'text-blue-600' };
    }
    return { icon: <Clock className="h-4 w-4" />, text: 'Story text', color: 'text-gray-500' };
  };

  const status = getStatusInfo();

  return (
    <Card
      className={cn(
        'border-2 transition-all',
        hasBook && 'border-green-200',
        isGenerating && 'border-amber-200',
        isRateLimited && 'border-amber-300',
        hasError && 'border-red-200',
        !hasBook && !isGenerating && !isRateLimited && !hasError && 'border-gray-200'
      )}
    >
      <CardContent className="p-4 space-y-3">
        {/* Header with title and status */}
        <div className="flex gap-4">
          {/* Thumbnail */}
          <div
            className={cn(
              'w-14 h-14 rounded-xl flex items-center justify-center flex-shrink-0',
              hasBook && 'bg-gradient-to-br from-green-100 to-emerald-100',
              isGenerating && 'bg-gradient-to-br from-amber-100 to-orange-100',
              isRateLimited && 'bg-amber-100',
              hasError && 'bg-red-100',
              !hasBook && !isGenerating && !isRateLimited && !hasError && 'bg-gray-100'
            )}
          >
            {hasBook && <BookOpen className="h-7 w-7 text-green-600" />}
            {isGenerating && <LoaderCircle className="h-7 w-7 text-amber-600 animate-spin" />}
            {isRateLimited && <Moon className="h-7 w-7 text-amber-600" />}
            {hasError && <AlertCircle className="h-7 w-7 text-red-500" />}
            {!hasBook && !isGenerating && !isRateLimited && !hasError && <Pencil className="h-7 w-7 text-gray-400" />}
          </div>

          {/* Content */}
          <div className="flex-1 min-w-0">
            <h3 className="font-semibold text-gray-900 truncate">{title}</h3>
            <p className={cn('text-sm mt-1 flex items-center gap-1', status.color)}>
              {status.icon}
              {status.text}
            </p>
            {story.createdAt && (
              <p className="text-xs text-gray-400 mt-1">
                {formatDate(story.createdAt)}
              </p>
            )}
          </div>
        </div>

        {/* Action buttons */}
        <div className="flex gap-2">
          {/* View/Read Book button - show if book exists */}
          {hasBook && (
            <Button
              asChild
              size="sm"
              className="flex-1 bg-green-500 hover:bg-green-600"
            >
              <Link href={`/kids/read/${storyId}`}>
                <Play className="h-4 w-4 mr-1" />
                Read Book
              </Link>
            </Button>
          )}

          {/* View Generating status */}
          {isGenerating && (
            <Button
              asChild
              size="sm"
              variant="outline"
              className="flex-1 border-amber-300 text-amber-700"
            >
              <Link href={`/kids/create/${storyId}/generating`}>
                <LoaderCircle className="h-4 w-4 mr-1 animate-spin" />
                View Progress
              </Link>
            </Button>
          )}

          {/* Rate limited - go to generating to see status */}
          {isRateLimited && (
            <Button
              asChild
              size="sm"
              variant="outline"
              className="flex-1 border-amber-300 text-amber-700"
            >
              <Link href={`/kids/create/${storyId}/generating`}>
                <Moon className="h-4 w-4 mr-1" />
                Check Status
              </Link>
            </Button>
          )}

          {/* Create Book button - only show if no book yet and not generating */}
          {canCreateBook && (
            <Button
              asChild
              size="sm"
              className="flex-1 bg-amber-500 hover:bg-amber-600"
            >
              <Link href={`/kids/create/${storyId}/style`}>
                <PlusCircle className="h-4 w-4 mr-1" />
                Create Book
              </Link>
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

// Format date helper
function formatDate(timestamp: any): string {
  if (!timestamp) return '';
  const date = typeof timestamp.toDate === 'function' ? timestamp.toDate() : new Date(timestamp);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return `${diffDays} days ago`;
  return date.toLocaleDateString();
}
