'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useUser } from '@/firebase/auth/use-user';
import { useKidsPWA } from '../layout';
import { useStoryList } from '@/hooks/use-stories';
import { StoryList } from '@/components/creation';
import { Button } from '@/components/ui/button';
import { LoaderCircle, ArrowLeft, Sparkles } from 'lucide-react';
import Link from 'next/link';
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar';

export default function KidsStoriesPage() {
  const router = useRouter();
  const { user, loading: userLoading } = useUser();
  const { childId, childProfile, isLocked } = useKidsPWA();

  // The child's Stories from the server (status and titles from the server).
  const { stories, loading, error } = useStoryList(childId);

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

  // Error state — kid-safe and friendly, never technical
  if (error) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-gradient-to-b from-amber-50 to-orange-50 p-4 gap-4">
        <span className="text-6xl" role="img" aria-label="sleepy book">📖</span>
        <h1 className="text-xl font-bold text-amber-900 text-center">
          Your stories are hiding!
        </h1>
        <p className="text-amber-700 text-center max-w-xs">We couldn&apos;t fetch your stories right now. Let&apos;s try again!</p>
        <div className="flex gap-3">
          <Button className="bg-amber-500 hover:bg-amber-600" onClick={() => window.location.reload()}>
            Try Again
          </Button>
          <Button asChild variant="outline">
            <Link href="/kids">Go Home</Link>
          </Button>
        </div>
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
          <StoryList
            stories={stories}
            playHref={(id) => `/kids/create/${id}`}
            readHref={(id) => `/kids/story/${id}/read`}
            createHref="/kids/create"
          />
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
