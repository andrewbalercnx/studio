
'use client';

import { useMemo } from 'react';
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
    router.push('/stories');
  };

  return (
    <div className="flex flex-col items-center gap-2 text-center w-32">
      <button onClick={handleSelectChild} className="rounded-full hover:ring-4 hover:ring-primary/50 transition-all">
        <Avatar className="h-24 w-24 border-4 border-white shadow-md">
          <AvatarImage src={profile.avatarUrl} alt={profile.displayName} />
          <AvatarFallback className="text-3xl bg-secondary text-secondary-foreground">
             {profile.displayName ? profile.displayName.charAt(0) : <User />}
          </AvatarFallback>
        </Avatar>
      </button>
      <p className="font-bold text-lg truncate w-full">{profile.displayName}</p>
    </div>
  );
}

export default function ParentHomePage() {
  const { user, loading: userLoading } = useUser();
  const firestore = useFirestore();
  const { setActiveChildId } = useAppContext();

  const childrenQuery = useMemo(() => {
    if (!user || !firestore) return null;
    return query(
      collection(firestore, 'children'),
      where('ownerParentUid', '==', user.uid)
    );
  }, [user, firestore]);

  const { data: children, loading: childrenLoading, error: childrenError } = useCollection<ChildProfile>(childrenQuery);

  if (userLoading || childrenLoading) {
    return (
      <div className="h-screen w-screen flex items-center justify-center">
        <LoaderCircle className="h-12 w-12 animate-spin text-primary" />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="container mx-auto px-4 py-12 sm:py-16 md:py-24 flex items-center justify-center h-screen">
        <Card className="text-center p-8">
          <CardHeader>
            <CardTitle className="text-3xl font-headline">Welcome to StoryPic Kids!</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-muted-foreground mb-6">Please sign in to start creating your story.</p>
            <Button asChild>
              <Link href="/login">Sign In</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }
  
  if (childrenError) {
      return <div className="text-center p-8 text-destructive">Error loading profiles: {childrenError.message}</div>
  }

  return (
    <div className="container mx-auto px-4 py-12 sm:py-16 md:py-24">
      <Card className="max-w-4xl mx-auto">
        <CardHeader className="text-center">
          <CardTitle className="text-4xl font-headline">Who's playing?</CardTitle>
          <CardDescription>Select a profile to start a new story or continue an old one.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-start justify-center gap-8 md:gap-12 pt-8">
          {children && children.length > 0 && (
            children.map(child => <ChildIcon key={child.id} profile={child} />)
          )}
           <div className="flex flex-col items-center gap-2 text-center w-32">
                <Link href="/parent/children" className="rounded-full hover:ring-4 hover:ring-primary/50 transition-all flex items-center justify-center h-24 w-24 border-4 border-dashed border-muted-foreground bg-muted/50 text-muted-foreground">
                    <Plus className="h-8 w-8"/>
                </Link>
                <p className="font-bold text-lg">Add Child</p>
            </div>
        </CardContent>
      </Card>
    </div>
  );
}
