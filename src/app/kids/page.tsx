'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useUser } from '@/firebase/auth/use-user';
import { useKidsPWA } from './layout';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import Link from 'next/link';
import { Sparkles, BookOpen, Library, Settings, LoaderCircle } from 'lucide-react';
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar';

export default function KidsHomePage() {
  const router = useRouter();
  const { user, loading: userLoading } = useUser();
  const { childId, childProfile, isLocked, isLoading } = useKidsPWA();

  // Redirect to setup if not locked to a child
  useEffect(() => {
    if (!isLoading && !userLoading) {
      if (!user) {
        // Not logged in - show login prompt (handled in render)
        return;
      }
      if (!isLocked || !childId) {
        router.replace('/kids/setup');
      }
    }
  }, [isLoading, userLoading, user, isLocked, childId, router]);

  // Loading state
  if (isLoading || userLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <LoaderCircle className="h-12 w-12 animate-spin text-amber-500" />
      </div>
    );
  }

  // Not logged in
  if (!user) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <Card className="w-full max-w-sm text-center">
          <CardHeader>
            <CardTitle className="text-2xl">Welcome to StoryPic!</CardTitle>
            <CardDescription>
              A parent needs to sign in first to set up your story space.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild size="lg" className="w-full">
              <Link href="/login">Parent Sign In</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Not locked to a child yet - redirect handled by useEffect
  if (!isLocked || !childProfile) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <LoaderCircle className="h-12 w-12 animate-spin text-amber-500" />
      </div>
    );
  }

  // Main kids dashboard
  return (
    <div className="min-h-screen flex flex-col">
      {/* Header with Avatar */}
      <header className="px-4 py-6 flex flex-col items-center">
        <Avatar className="h-24 w-24 border-4 border-amber-300 shadow-lg">
          {childProfile.avatarUrl ? (
            <AvatarImage src={childProfile.avatarUrl} alt={childProfile.displayName} />
          ) : null}
          <AvatarFallback className="bg-gradient-to-br from-amber-200 to-orange-300 text-amber-800 text-3xl font-bold">
            {childProfile.displayName.charAt(0).toUpperCase()}
          </AvatarFallback>
        </Avatar>
        <p className="text-sm text-amber-700 uppercase tracking-wide mt-3">Welcome back</p>
        <h1 className="text-3xl font-bold text-amber-900 mt-1">
          {childProfile.displayName}
        </h1>
      </header>

      {/* Main content */}
      <main className="flex-1 px-4 pb-8">
        <div className="max-w-md mx-auto space-y-4">
          {/* Create New Story */}
          <Link href="/kids/create" className="block">
            <Card className="border-2 border-amber-200 hover:border-amber-400 hover:shadow-lg transition-all active:scale-98 bg-white">
              <CardContent className="flex items-center gap-4 p-6">
                <div className="flex-shrink-0 w-16 h-16 rounded-2xl bg-gradient-to-br from-amber-400 to-orange-500 flex items-center justify-center">
                  <Sparkles className="h-8 w-8 text-white" />
                </div>
                <div className="flex-1">
                  <h2 className="text-xl font-bold text-gray-900">Create New Story</h2>
                  <p className="text-gray-600 text-sm">Start a magical adventure!</p>
                </div>
              </CardContent>
            </Card>
          </Link>

          {/* My Stories */}
          <Link href="/kids/stories" className="block">
            <Card className="border-2 border-amber-200 hover:border-amber-400 hover:shadow-lg transition-all active:scale-98 bg-white">
              <CardContent className="flex items-center gap-4 p-6">
                <div className="flex-shrink-0 w-16 h-16 rounded-2xl bg-gradient-to-br from-blue-400 to-purple-500 flex items-center justify-center">
                  <Library className="h-8 w-8 text-white" />
                </div>
                <div className="flex-1">
                  <h2 className="text-xl font-bold text-gray-900">My Stories</h2>
                  <p className="text-gray-600 text-sm">See all your creations</p>
                </div>
              </CardContent>
            </Card>
          </Link>

          {/* My Books - completed illustrated storybooks */}
          <Link href="/kids/books" className="block">
            <Card className="border-2 border-amber-200 hover:border-amber-400 hover:shadow-lg transition-all active:scale-98 bg-white">
              <CardContent className="flex items-center gap-4 p-6">
                <div className="flex-shrink-0 w-16 h-16 rounded-2xl bg-gradient-to-br from-green-400 to-teal-500 flex items-center justify-center">
                  <BookOpen className="h-8 w-8 text-white" />
                </div>
                <div className="flex-1">
                  <h2 className="text-xl font-bold text-gray-900">My Books</h2>
                  <p className="text-gray-600 text-sm">Read your illustrated books</p>
                </div>
              </CardContent>
            </Card>
          </Link>
        </div>
      </main>

      {/* Footer with settings (for parent to change child) */}
      <footer className="px-4 py-4 border-t border-amber-200 bg-amber-50/50">
        <div className="max-w-md mx-auto">
          <Link href="/kids/setup">
            <Button variant="ghost" size="sm" className="w-full text-amber-700 hover:text-amber-900 hover:bg-amber-100">
              <Settings className="h-4 w-4 mr-2" />
              Parent Settings
            </Button>
          </Link>
        </div>
      </footer>
    </div>
  );
}
