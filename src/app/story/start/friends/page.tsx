'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useUser } from '@/firebase/auth/use-user';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { LoaderCircle } from 'lucide-react';
import Link from 'next/link';
import { useFirestore } from '@/firebase';
import { doc, getDoc, collection, updateDoc, writeBatch, serverTimestamp } from 'firebase/firestore';
import type { ChildProfile } from '@/lib/types';
import { useAppContext } from '@/hooks/use-app-context';

export default function StartFriendsStoryPage() {
  const { user, loading: userLoading } = useUser();
  const firestore = useFirestore();
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { activeChildId } = useAppContext();
  const router = useRouter();

  useEffect(() => {
    if (userLoading) return;
    if (!user || !firestore) {
      setError('You must be signed in to start a story.');
      setIsLoading(false);
      return;
    }
    if (!activeChildId) {
      setError('Please select a child profile before starting a story.');
      setIsLoading(false);
      return;
    }

    const startFriendsProcess = async () => {
      const childId = activeChildId;
      try {
        // Step 1: Verify Child Profile
        let childProfile: ChildProfile;
        try {
          const childRef = doc(firestore, 'children', childId);
          const childDoc = await getDoc(childRef);
          if (!childDoc.exists()) {
            throw new Error('Selected child profile was not found.');
          }
          childProfile = childDoc.data() as ChildProfile;

          if (childProfile.ownerParentUid && childProfile.ownerParentUid !== user.uid) {
            throw new Error('You do not have permission to use this child profile.');
          }
          if (!childProfile.ownerParentUid) {
            await updateDoc(childRef, { ownerParentUid: user.uid });
          }
        } catch (e: any) {
          throw new Error(`Failed to verify child profile: ${e.message}`);
        }

        // Step 2: Create Story Session with friends mode
        let storySessionId: string;
        try {
          const storySessionRef = doc(collection(firestore, 'storySessions'));
          storySessionId = storySessionRef.id;

          const newSessionData = {
            childId: childId,
            parentUid: user.uid,
            status: 'in_progress' as const,
            currentPhase: 'friends' as const,
            storyMode: 'friends' as const,
            currentStepIndex: 0,
            storyTitle: '',
            storyVibe: '',
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
            id: storySessionId,
          };

          const batch = writeBatch(firestore);
          batch.set(storySessionRef, newSessionData);

          const childSessionRef = doc(firestore, 'children', childId, 'sessions', storySessionId);
          batch.set(childSessionRef, newSessionData);

          await batch.commit();
        } catch (e: any) {
          throw new Error(`Failed to create story session: ${e.message}`);
        }

        router.push(`/story/friends/${storySessionId}`);
      } catch (e: any) {
        console.error('Error starting friends story:', e);
        setError(e.message || 'An unknown error occurred.');
        setIsLoading(false);
      }
    };

    startFriendsProcess();
  }, [user, firestore, activeChildId, userLoading, router]);

  return (
    <div className="container mx-auto flex min-h-screen items-center justify-center p-4">
      <Card className="w-full max-w-md text-center">
        <CardHeader>
          <CardTitle>Gathering Your Friends</CardTitle>
          <CardDescription>
            Hold on, we're finding your adventure companions!
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col items-center justify-center gap-4 py-8">
          {isLoading ? (
            <>
              <LoaderCircle className="h-12 w-12 animate-spin text-primary" />
              <p className="text-muted-foreground">Preparing your adventure team...</p>
            </>
          ) : error ? (
            <div className="space-y-4">
              <p className="text-destructive font-mono text-sm bg-destructive/10 p-3 rounded-md">{error}</p>
              <Button asChild variant="secondary">
                <Link href="/parent">Back to Parent Dashboard</Link>
              </Button>
            </div>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
