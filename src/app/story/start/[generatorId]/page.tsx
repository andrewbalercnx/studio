'use client';

import { useEffect, useState, useMemo } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useUser } from '@/firebase/auth/use-user';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { LoaderCircle } from 'lucide-react';
import Link from 'next/link';
import { useFirestore } from '@/firebase';
import { doc, getDoc, collection, updateDoc, writeBatch, serverTimestamp } from 'firebase/firestore';
import { useDocument } from '@/lib/firestore-hooks';
import type { ChildProfile, StoryGenerator } from '@/lib/types';
import { useAppContext } from '@/hooks/use-app-context';

/**
 * Dynamic story start page that works with any generator.
 *
 * This unified route replaces the individual /story/start/wizard,
 * /story/start/friends, etc. routes. It fetches the generator config
 * and creates a session with the appropriate settings.
 *
 * Route: /story/start/[generatorId]
 * Example: /story/start/wizard, /story/start/friends
 */
export default function DynamicStartStoryPage() {
  const params = useParams<{ generatorId: string }>();
  const generatorId = params.generatorId;
  const { user, loading: userLoading } = useUser();
  const firestore = useFirestore();
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { activeChildId } = useAppContext();
  const router = useRouter();

  // Fetch generator configuration for dynamic messaging
  const generatorRef = useMemo(
    () => (firestore ? doc(firestore, 'storyGenerators', generatorId) : null),
    [firestore, generatorId]
  );
  const { data: generator, loading: generatorLoading } = useDocument<StoryGenerator>(generatorRef);

  useEffect(() => {
    if (userLoading || generatorLoading) return;
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
    if (!generator) {
      setError(`Story generator "${generatorId}" not found.`);
      setIsLoading(false);
      return;
    }
    if (generator.status !== 'live') {
      setError(`Story generator "${generator.name}" is not currently available.`);
      setIsLoading(false);
      return;
    }

    const startStoryProcess = async () => {
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

        // Step 2: Create Story Session with generator-specific settings
        let storySessionId: string;
        try {
          const storySessionRef = doc(collection(firestore, 'storySessions'));
          storySessionId = storySessionRef.id;

          // Base session data - common to all generators
          const newSessionData: Record<string, any> = {
            childId: childId,
            parentUid: user.uid,
            status: 'in_progress' as const,
            currentPhase: generatorId,
            currentStepIndex: 0,
            storyTitle: '',
            storyVibe: '',
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
            id: storySessionId,
          };

          // Generator-specific additions
          // The 'friends' generator needs storyMode set
          if (generatorId === 'friends') {
            newSessionData.storyMode = 'friends';
          }

          const batch = writeBatch(firestore);
          batch.set(storySessionRef, newSessionData);

          const childSessionRef = doc(firestore, 'children', childId, 'sessions', storySessionId);
          batch.set(childSessionRef, newSessionData);

          await batch.commit();
        } catch (e: any) {
          throw new Error(`Failed to create story session: ${e.message}`);
        }

        // Redirect to the dynamic story page
        router.push(`/story/${generatorId}/${storySessionId}`);
      } catch (e: any) {
        console.error(`Error starting ${generatorId} story:`, e);
        setError(e.message || 'An unknown error occurred.');
        setIsLoading(false);
      }
    };

    startStoryProcess();
  }, [user, firestore, activeChildId, userLoading, generatorLoading, generator, generatorId, router]);

  // Dynamic messaging from generator config
  const title = generator?.name ? `Starting ${generator.name}` : 'Starting Your Story';
  const description = generator?.styling?.loadingMessage || 'Hold on, we\'re preparing your adventure!';
  const loadingText = generator?.styling?.loadingMessage || 'Preparing your story...';

  return (
    <div className="container mx-auto flex min-h-screen items-center justify-center p-4">
      <Card className="w-full max-w-md text-center">
        <CardHeader>
          <CardTitle>{title}</CardTitle>
          <CardDescription>{description}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col items-center justify-center gap-4 py-8">
          {isLoading ? (
            <>
              <LoaderCircle className="h-12 w-12 animate-spin text-primary" />
              <p className="text-muted-foreground">{loadingText}</p>
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
