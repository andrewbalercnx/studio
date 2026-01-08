'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useUser } from '@/firebase/auth/use-user';
import { useKidsPWA } from '../layout';
import { useRequiredApiClient } from '@/contexts/api-client-context';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { LoaderCircle, ArrowLeft, BookOpen, Sparkles, Pencil, Volume2, FileText } from 'lucide-react';
import Link from 'next/link';
import { cn } from '@/lib/utils';
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar';

// Actor type returned by the API
type Actor = {
  id: string;
  displayName: string;
  avatarUrl?: string;
  type: 'child' | 'character';
};

// Story type with resolved fields from API
type StoryWithResolved = {
  id: string;
  storySessionId?: string;
  childId: string;
  metadata?: { title?: string };
  synopsis?: string;
  storyText?: string;
  actorAvatarUrl?: string;
  pageGeneration?: { status?: string };
  imageGeneration?: { status?: string };
  createdAt?: { seconds?: number; _seconds?: number };
  // Resolved fields from API
  titleResolved?: string;
  synopsisResolved?: string;
  actors?: Actor[];
};

export default function KidsStoriesPage() {
  const router = useRouter();
  const { user, loading: userLoading } = useUser();
  const { childId, childProfile, isLocked } = useKidsPWA();

  // API client for data fetching
  const apiClient = useRequiredApiClient();

  // State
  const [stories, setStories] = useState<StoryWithResolved[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Load stories via API
  useEffect(() => {
    if (!apiClient || !childId) return;

    setLoading(true);
    setError(null);

    apiClient
      .getMyStories(childId)
      .then((data) => {
        setStories(data as StoryWithResolved[]);
      })
      .catch((err) => {
        console.error('[KidsStories] Error loading stories:', err);
        setError(err.message || 'Failed to load stories');
      })
      .finally(() => {
        setLoading(false);
      });
  }, [apiClient, childId]);

  // Redirect if not set up
  useEffect(() => {
    if (!userLoading && (!user || !isLocked || !childId)) {
      router.replace('/kids');
    }
  }, [userLoading, user, isLocked, childId, router]);

  // Loading state
  if (userLoading || loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-b from-amber-50 to-orange-50">
        <LoaderCircle className="h-12 w-12 animate-spin text-amber-500" />
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-gradient-to-b from-amber-50 to-orange-50 p-4">
        <p className="text-amber-800 mb-4">{error}</p>
        <Button onClick={() => window.location.reload()}>Try Again</Button>
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
          {stories.length === 0 ? (
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
            stories.map((story) => (
              <StoryCard key={story.id || story.storySessionId} story={story} />
            ))
          )}
        </div>
      </main>

      {/* Floating create button */}
      {stories.length > 0 && (
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

// Story card component - shows story info only (books accessed via My Books)
function StoryCard({ story }: { story: StoryWithResolved }) {
  const storyId = story.id || story.storySessionId;
  const title = story.titleResolved || story.metadata?.title || 'Untitled Story';
  const hasStoryText = !!story.storyText;

  // Use resolved synopsis from API
  const resolvedSynopsis = story.synopsisResolved;

  // Actors are already resolved from API
  const actors = story.actors || [];

  // Simple status: story ready or in progress
  const status = hasStoryText
    ? { icon: <FileText className="h-4 w-4" />, text: 'Story ready', color: 'text-purple-600' }
    : { icon: <Pencil className="h-4 w-4" />, text: 'In progress', color: 'text-gray-500' };

  return (
    <Card
      className={cn(
        'border-2 transition-all',
        hasStoryText ? 'border-purple-200' : 'border-gray-200'
      )}
    >
      <CardContent className="p-4 space-y-3">
        {/* Header with title, status, and actor avatars */}
        <div className="flex gap-4">
          {/* Thumbnail - use actor avatar if available, otherwise icon */}
          <div
            className={cn(
              'w-14 h-14 rounded-xl flex items-center justify-center flex-shrink-0 overflow-hidden',
              hasStoryText && !story.actorAvatarUrl && 'bg-gradient-to-br from-purple-100 to-pink-100',
              !hasStoryText && !story.actorAvatarUrl && 'bg-gray-100'
            )}
          >
            {story.actorAvatarUrl ? (
              <img src={story.actorAvatarUrl} alt="Story characters" className="w-full h-full object-cover" />
            ) : (
              <>
                {hasStoryText && <FileText className="h-7 w-7 text-purple-500" />}
                {!hasStoryText && <Pencil className="h-7 w-7 text-gray-400" />}
              </>
            )}
          </div>

          {/* Content */}
          <div className="flex-1 min-w-0">
            <div className="flex items-start justify-between gap-2">
              <h3 className="font-semibold text-gray-900 truncate flex-1">{title}</h3>
              {/* Actor avatars (small, stacked) */}
              {actors.length > 0 && (
                <div className="flex -space-x-2 flex-shrink-0">
                  {actors.slice(0, 3).map((actor) => (
                    <Avatar key={actor.id} className="h-6 w-6 border-2 border-white">
                      {actor.avatarUrl ? (
                        <AvatarImage src={actor.avatarUrl} alt={actor.displayName} />
                      ) : null}
                      <AvatarFallback className="bg-amber-200 text-amber-800 text-xs">
                        {actor.displayName?.charAt(0) || '?'}
                      </AvatarFallback>
                    </Avatar>
                  ))}
                  {actors.length > 3 && (
                    <div className="h-6 w-6 rounded-full bg-gray-200 border-2 border-white flex items-center justify-center text-xs text-gray-600">
                      +{actors.length - 3}
                    </div>
                  )}
                </div>
              )}
            </div>
            <p className={cn('text-sm mt-1 flex items-center gap-1', status.color)}>
              {status.icon}
              {status.text}
            </p>
            {/* Synopsis preview */}
            {resolvedSynopsis && (
              <p className="text-xs text-gray-500 mt-1 line-clamp-2">
                {resolvedSynopsis}
              </p>
            )}
            {story.createdAt && !resolvedSynopsis && (
              <p className="text-xs text-gray-400 mt-1">
                {formatDate(story.createdAt)}
              </p>
            )}
          </div>
        </div>

        {/* Action button - Read Story only (books accessed via My Books) */}
        {hasStoryText && (
          <Button
            asChild
            size="sm"
            className="bg-purple-500 hover:bg-purple-600"
          >
            <Link href={`/kids/story/${storyId}/read`}>
              <Volume2 className="h-4 w-4 mr-1" />
              Read Story
            </Link>
          </Button>
        )}
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
