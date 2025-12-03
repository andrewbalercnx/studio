
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
  const { roleMode } = useAppContext();

  useEffect(() => {
    if (userLoading) return;
    
    if (!user) {
        router.push('/login');
        return;
    }
    
    const claims = idTokenResult?.claims;
    if (claims?.isAdmin) {
        router.push('/admin');
    } else if (claims?.isWriter) {
        router.push('/writer');
    }
    // No redirect for parent role, they will stay on this page.

  }, [user, userLoading, idTokenResult, router, roleMode]);


  const childrenQuery = useMemo(() => {
    if (!user || !firestore) return null;
    return query(collection(firestore, 'children'), where('ownerParentUid', '==', user.uid));
  }, [user, firestore]);

  const { data: children, loading: childrenLoading, error: childrenError } = useCollection<ChildProfile>(childrenQuery);

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

    if (!children || children.length === 0) {
      return (
        <div className="text-center py-8">
          <p className="text-muted-foreground mb-4">No children profiles found.</p>
          <Button asChild>
            <Link href="/parent/children">Create a Profile</Link>
          </Button>
        </div>
      );
    }

    return (
      <div className="flex flex-wrap items-center justify-center gap-8">
        {children.map(child => (
          <ChildIcon key={child.id} profile={child} />
        ))}
      </div>
    );
  };


  if (userLoading) {
    return (
      <div className="h-screen w-screen flex items-center justify-center">
        <LoaderCircle className="h-12 w-12 animate-spin text-primary" />
      </div>
    );
  }

  // Only show content if user is a parent
  if (roleMode === 'parent') {
    return (
      <div className="container mx-auto p-4 sm:p-6 md:p-8">
        <Card className="max-w-2xl mx-auto mt-10">
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

  // Render a loading state for other roles while redirecting
  return (
    <div className="h-screen w-screen flex items-center justify-center">
      <LoaderCircle className="h-12 w-12 animate-spin text-primary" />
      <p className="ml-4 text-muted-foreground">Redirecting...</p>
    </div>
  );
}
