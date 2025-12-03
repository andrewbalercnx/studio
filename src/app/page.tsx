
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
    } else if (roleMode === 'parent') {
        router.push('/parent');
    }
  }, [user, userLoading, idTokenResult, router, roleMode]);


  if (userLoading) {
    return (
      <div className="h-screen w-screen flex items-center justify-center">
        <LoaderCircle className="h-12 w-12 animate-spin text-primary" />
      </div>
    );
  }

  // Render a loading state or nothing while redirecting
  return (
    <div className="h-screen w-screen flex items-center justify-center">
      <LoaderCircle className="h-12 w-12 animate-spin text-primary" />
      <p className="ml-4 text-muted-foreground">Redirecting...</p>
    </div>
  );
}
