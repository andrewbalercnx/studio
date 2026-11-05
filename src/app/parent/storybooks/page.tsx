'use client';

import { useUser } from '@/firebase/auth/use-user';
import { useParentGuard } from '@/hooks/use-parent-guard';
import { LoaderCircle, BookOpen, User, Plus } from 'lucide-react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { plural, useLibrarySummary } from '@/hooks/use-library-summary';
import { useChildren } from '@/lib/people/use-people';

export default function ParentStorybooksPage() {
  const { loading: userLoading } = useUser();
  const { isParentGuardValidated } = useParentGuard();
  const { summary, forChild } = useLibrarySummary();

  // The family's children through the API (slice 6.2); the server leaves out deleted ones.
  const { items: children, loading } = useChildren();

  if (!isParentGuardValidated) return null;

  const isLoadingPage = userLoading || loading;

  return (
    <div className="container mx-auto p-4 sm:p-6 md:p-8 space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Storybooks</h1>
        <p className="text-muted-foreground">Choose a child to view their books</p>
      </div>

      {isLoadingPage ? (
        <div className="flex items-center justify-center py-16">
          <LoaderCircle className="h-8 w-8 animate-spin text-primary" />
        </div>
      ) : children.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12 gap-4">
            <BookOpen className="h-12 w-12 text-muted-foreground" />
            <div className="text-center max-w-md">
              <p className="font-medium">No children added yet</p>
              <p className="text-muted-foreground">
                Storybooks live here once your child has made a story and illustrated it. First,
                create a profile for your child.
              </p>
            </div>
            <Button asChild>
              <Link href="/parent/children">
                <Plus className="mr-2 h-4 w-4" />
                Add a child
              </Link>
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
          {children.map((child) => (
            <Link key={child.id} href={`/parent/storybooks/${child.id}`}>
              <Card className="hover:shadow-md transition-shadow cursor-pointer h-full">
                <CardContent className="flex flex-col items-center gap-4 pt-8 pb-8">
                  <Avatar className="h-24 w-24">
                    <AvatarImage src={child.likeness.avatar || undefined} alt={child.displayName} />
                    <AvatarFallback className="text-3xl">
                      {child.displayName?.charAt(0).toUpperCase() || <User className="h-10 w-10" />}
                    </AvatarFallback>
                  </Avatar>
                  <div className="text-center">
                    <p className="font-semibold text-lg">{child.displayName}</p>
                    <p className="text-sm text-muted-foreground mt-0.5">
                      {summary ? `${plural(forChild(child.id).books, 'book', 'books')} · ${plural(forChild(child.id).stories, 'story', 'stories')} →` : 'View books →'}
                    </p>
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
