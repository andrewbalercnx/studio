
'use client';

import { useMemo, useEffect } from 'react';
import { useUser } from '@/firebase/auth/use-user';
import { useFirestore } from '@/firebase';
import { collection, query, where } from 'firebase/firestore';
import { useCollection } from '@/lib/firestore-hooks';
import type { ChildProfile } from '@/lib/types';
import { LoaderCircle, Plus, User } from 'lucide-react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { useRouter } from 'next/navigation';
import { useAppContext } from '@/hooks/use-app-context';

function ChildIcon({ profile }: { profile: ChildProfile }) {
  const router = useRouter();
  const { setActiveChildId } = useAppContext();

  const handleSelectChild = () => {
    setActiveChildId(profile.id);
    router.push(`/child/${profile.id}`);
  };

  return (
    <div className="flex flex-col items-center gap-2 text-center w-32">
      <button onClick={handleSelectChild} className="rounded-full hover:ring-4 hover:ring-primary/50 transition-all">
        <Avatar className="h-24 w-24 border-4 border-white shadow-md">
          <AvatarImage src={profile.avatarUrl} alt={profile.displayName} className="object-cover" />
          <AvatarFallback className="text-3xl bg-secondary text-secondary-foreground">
             {profile.displayName ? profile.displayName.charAt(0) : <User />}
          </AvatarFallback>
        </Avatar>
      </button>
      <p className="font-bold text-lg truncate w-full">{profile.displayName}</p>
    </div>
  );
}

export default function HomePage() {
  const { user, loading: userLoading, idTokenResult } = useUser();
  const firestore = useFirestore();
  const router = useRouter();
  const { roleMode, activeChildProfileLoading } = useAppContext();

  useEffect(() => {
    if (userLoading) return;

    if (!user) {
        router.push('/login');
        return;
    }

    const claims = idTokenResult?.claims;
    if (claims?.isAdmin) {
        router.push('/admin');
    }
    // Writers and parents stay on this page (child selection)

  }, [user, userLoading, idTokenResult, router]);


  const childrenQuery = useMemo(() => {
    if (!user || !firestore) return null;
    return query(collection(firestore, 'children'), where('ownerParentUid', '==', user.uid));
  }, [user, firestore]);

  const { data: children, loading: childrenLoading, error: childrenError } = useCollection<ChildProfile>(childrenQuery);

  // Filter out deleted children
  const visibleChildren = useMemo(() => {
    return (children || []).filter(child => !child.deletedAt);
  }, [children]);

  const renderContent = () => {
    if (childrenLoading) {
      return (
        <div className="flex items-center justify-center py-8">
          <LoaderCircle className="h-8 w-8 animate-spin" />
        </div>
      );
    }

    if (childrenError) {
      return (
        <div className="text-center py-8 text-destructive">
          <p>Could not load children profiles.</p>
        </div>
      );
    }

    if (visibleChildren.length === 0) {
      // Explicit first-run prompt: accounts no longer get a placeholder child
      // seeded at signup, so guide the parent to create the first real profile.
      return (
        <div className="text-center py-10 border-2 border-dashed rounded-lg" data-wiz-target="add-first-child">
          <h2 className="text-xl font-semibold mb-2">Add your first child</h2>
          <p className="text-muted-foreground mb-4 max-w-sm mx-auto">
            Create a profile for your child to start making personalised stories starring them.
          </p>
          <Button asChild>
            <Link href="/parent/children">
              <Plus className="mr-2 h-4 w-4" />
              Add your first child
            </Link>
          </Button>
        </div>
      );
    }

    return (
      <div className="flex flex-wrap items-center justify-center gap-8">
        {visibleChildren.map(child => (
          <ChildIcon key={child.id} profile={child} />
        ))}
      </div>
    );
  };


  if (userLoading || activeChildProfileLoading) {
    return (
      <div className="h-screen w-screen flex items-center justify-center">
        <LoaderCircle className="h-12 w-12 animate-spin text-primary" />
      </div>
    );
  }

  // Show the child selection page for all authenticated users (parent mode)
  // This is now the default landing page after login
  return (
    <div className="container mx-auto p-4 sm:p-6 md:p-8">
      <Card className="max-w-2xl mx-auto mt-10" data-wiz-target="who-is-playing">
        <CardHeader>
          <CardTitle>Who is playing?</CardTitle>
          <CardDescription>Select a child to start creating a story.</CardDescription>
        </CardHeader>
        <CardContent>
          {renderContent()}
        </CardContent>
      </Card>
    </div>
  );
}
