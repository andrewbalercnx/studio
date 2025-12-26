'use client';

import { useEffect, useMemo } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useUser } from '@/firebase/auth/use-user';
import { useFirestore } from '@/firebase';
import { collection, query, where } from 'firebase/firestore';
import { useCollection } from '@/lib/firestore-hooks';
import { useKidsPWA } from '../layout';
import type { Story } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { LoaderCircle, ArrowLeft, BookOpen, Sparkles, Clock, CheckCircle2, AlertCircle } from 'lucide-react';
import Link from 'next/link';
import { cn } from '@/lib/utils';
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar';

export default function KidsStoriesPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const filter = searchParams.get('filter'); // 'ready' to show only completed books
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

  // Sort and filter stories client-side
  const filteredStories = useMemo(() => {
    if (!storiesRaw) return [];

    // Filter out soft-deleted stories (defense in depth - rules should block these anyway)
    const nonDeleted = storiesRaw.filter((s) => !s.deletedAt);

    // Sort by createdAt descending (newest first)
    const sorted = [...nonDeleted].sort((a, b) => {
      const aTime = a.createdAt?.toDate?.()?.getTime() ?? 0;
      const bTime = b.createdAt?.toDate?.()?.getTime() ?? 0;
      return bTime - aTime;
    });

    // Apply filter if specified
    if (filter === 'ready') {
      return sorted.filter((s) => s.imageGeneration?.status === 'ready');
    }
    return sorted;
  }, [storiesRaw, filter]);

  // Redirect if not set up
  useEffect(() => {
    if (!userLoading && (!user || !isLocked || !childId)) {
      router.replace('/kids');
    }
  }, [userLoading, user, isLocked, childId, router]);

  // Loading state
  if (userLoading || storiesLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <LoaderCircle className="h-12 w-12 animate-spin text-amber-500" />
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col">
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
          <h1 className="text-xl font-bold text-amber-900">
            {filter === 'ready' ? 'My Books' : 'My Stories'}
          </h1>
          <p className="text-sm text-amber-700">
            {childProfile?.displayName}'s creations
          </p>
        </div>
      </header>

      {/* Filter tabs */}
      <div className="px-4 py-3 flex gap-2 border-b border-amber-100">
        <Link href="/kids/stories">
          <Button
            variant={!filter ? 'default' : 'outline'}
            size="sm"
            className={cn(
              !filter && 'bg-amber-500 hover:bg-amber-600'
            )}
          >
            All Stories
          </Button>
        </Link>
        <Link href="/kids/stories?filter=ready">
          <Button
            variant={filter === 'ready' ? 'default' : 'outline'}
            size="sm"
            className={cn(
              filter === 'ready' && 'bg-amber-500 hover:bg-amber-600'
            )}
          >
            Ready to Read
          </Button>
        </Link>
      </div>

      {/* Stories list */}
      <main className="flex-1 px-4 py-4">
        <div className="max-w-md mx-auto space-y-3">
          {filteredStories.length === 0 ? (
            <div className="text-center py-12 space-y-4">
              <div className="w-20 h-20 mx-auto rounded-full bg-amber-100 flex items-center justify-center">
                <BookOpen className="h-10 w-10 text-amber-400" />
              </div>
              <h3 className="text-lg font-semibold text-gray-700">
                {filter === 'ready' ? 'No books ready yet' : 'No stories yet'}
              </h3>
              <p className="text-gray-500">
                {filter === 'ready'
                  ? 'Your books will appear here once they\'re finished!'
                  : 'Create your first magical story!'}
              </p>
              <Link href="/kids/create">
                <Button className="bg-amber-500 hover:bg-amber-600">
                  <Sparkles className="h-4 w-4 mr-2" />
                  Create a Story
                </Button>
              </Link>
            </div>
          ) : (
            filteredStories.map((story) => (
              <StoryCard key={story.id || story.storySessionId} story={story} />
            ))
          )}
        </div>
      </main>

      {/* Floating create button */}
      {filteredStories.length > 0 && (
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

// Story card component
function StoryCard({ story }: { story: Story }) {
  const router = useRouter();
  const storyId = story.id || story.storySessionId;
  const title = story.metadata?.title || 'Untitled Story';
  const pageStatus = story.pageGeneration?.status ?? 'idle';
  const imageStatus = story.imageGeneration?.status ?? 'idle';
  const isReady = imageStatus === 'ready';
  const isGenerating = pageStatus === 'running' || imageStatus === 'running';
  const hasError = pageStatus === 'error' || imageStatus === 'error';

  // Get a preview image if available (first page image)
  // This would need to be fetched from the pages subcollection in a real implementation
  // For now, we'll just show a placeholder

  const handleClick = () => {
    if (isReady) {
      router.push(`/kids/read/${storyId}`);
    } else if (isGenerating) {
      router.push(`/kids/create/${storyId}/generating`);
    }
  };

  return (
    <button onClick={handleClick} className="w-full text-left">
      <Card
        className={cn(
          'border-2 transition-all hover:shadow-lg active:scale-98',
          isReady && 'border-green-200 hover:border-green-400',
          isGenerating && 'border-amber-200 hover:border-amber-400',
          hasError && 'border-red-200',
          !isReady && !isGenerating && !hasError && 'border-gray-200 hover:border-gray-400'
        )}
      >
        <CardContent className="p-4 flex gap-4">
          {/* Thumbnail */}
          <div
            className={cn(
              'w-16 h-16 rounded-xl flex items-center justify-center flex-shrink-0',
              isReady && 'bg-gradient-to-br from-green-100 to-emerald-100',
              isGenerating && 'bg-gradient-to-br from-amber-100 to-orange-100',
              hasError && 'bg-red-100',
              !isReady && !isGenerating && !hasError && 'bg-gray-100'
            )}
          >
            {isReady && <BookOpen className="h-8 w-8 text-green-600" />}
            {isGenerating && <LoaderCircle className="h-8 w-8 text-amber-600 animate-spin" />}
            {hasError && <AlertCircle className="h-8 w-8 text-red-500" />}
            {!isReady && !isGenerating && !hasError && <Clock className="h-8 w-8 text-gray-400" />}
          </div>

          {/* Content */}
          <div className="flex-1 min-w-0">
            <h3 className="font-semibold text-gray-900 truncate">{title}</h3>
            <p
              className={cn(
                'text-sm mt-1',
                isReady && 'text-green-600',
                isGenerating && 'text-amber-600',
                hasError && 'text-red-500',
                !isReady && !isGenerating && !hasError && 'text-gray-500'
              )}
            >
              {isReady && (
                <span className="flex items-center gap-1">
                  <CheckCircle2 className="h-4 w-4" />
                  Ready to read!
                </span>
              )}
              {isGenerating && (
                <span className="flex items-center gap-1">
                  <LoaderCircle className="h-4 w-4 animate-spin" />
                  Creating your book...
                </span>
              )}
              {hasError && 'Something went wrong'}
              {!isReady && !isGenerating && !hasError && 'Waiting to start'}
            </p>
            {story.createdAt && (
              <p className="text-xs text-gray-400 mt-1">
                {formatDate(story.createdAt)}
              </p>
            )}
          </div>
        </CardContent>
      </Card>
    </button>
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
