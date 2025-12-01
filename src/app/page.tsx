
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

  const childrenQuery = useMemo(() => {
    if (!user || !firestore) return null;
    return query(
      collection(firestore, 'children'),
      where('ownerParentUid', '==', user.uid)
    );
  }, [user, firestore]);

  const { data: children, loading: childrenLoading, error: childrenError } = useCollection<ChildProfile>(childrenQuery);
  
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
  }, [user, userLoading, idTokenResult, router]);


  if (userLoading || childrenLoading) {
    return (
      <div className="h-screen w-screen flex items-center justify-center">
        <LoaderCircle className="h-12 w-12 animate-spin text-primary" />
      </div>
    );
  }

  if (!user) {
     // This will be momentarily visible before the useEffect redirects to /login
    return (
       <div className="h-screen w-screen flex items-center justify-center">
        <LoaderCircle className="h-12 w-12 animate-spin text-primary" />
      </div>
    );
  }
  
  if (roleMode === 'admin' || roleMode === 'writer') {
      // This will be momentarily visible before the useEffect redirects
      return (
       <div className="h-screen w-screen flex items-center justify-center">
        <LoaderCircle className="h-12 w-12 animate-spin text-primary" />
        <p className="text-muted-foreground ml-4">Redirecting to your dashboard...</p>
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
        <div className="border-t px-6 py-4 flex flex-col items-center gap-2 text-center">
          <p className="text-sm text-muted-foreground">Need to manage kids or settings?</p>
          <Button asChild variant="secondary">
            <Link href="/parent">Go to Parent Tools</Link>
          </Button>
          <p className="text-xs text-muted-foreground">You’ll be asked for your Parent PIN.</p>
        </div>
      </Card>
    </div>
  );
}
