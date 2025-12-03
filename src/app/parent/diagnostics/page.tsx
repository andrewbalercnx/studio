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
import { useParentGuard } from '@/hooks/use-parent-guard';

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

export default function ParentOverviewPage() {
  const { user } = useUser();
  const firestore = useFirestore();
  const { isParentGuardValidated } = useParentGuard();

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
          <p>Could not load children. You may need to check security rules.</p>
          <Button asChild variant="link"><Link href="/parent/diagnostics">Run Diagnostics</Link></Button>
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
  
  if (!isParentGuardValidated) {
    return null; // The guard will show the PIN modal
  }


  return (
    <div className="space-y-6">
      <Card>
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