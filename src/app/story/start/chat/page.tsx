'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useUser } from '@/firebase/auth/use-user';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { LoaderCircle } from 'lucide-react';
import Link from 'next/link';
import { useFirestore } from '@/firebase';
import { doc, getDoc, setDoc, serverTimestamp, addDoc, collection, query, where, getDocs, limit, updateDoc } from 'firebase/firestore';
import type { PromptConfig, ChildProfile } from '@/lib/types';
import { useToast } from '@/hooks/use-toast';
import { useAppContext } from '@/hooks/use-app-context';

export default function StartChatStoryPage() {
  const { user, loading: userLoading } = useUser();
  const firestore = useFirestore();
  const { toast } = useToast();
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
    
    const startStoryProcess = async () => {
      const childId = activeChildId;
      try {
        const childRef = doc(firestore, 'children', childId);
        const childDoc = await getDoc(childRef);
        if (!childDoc.exists()) {
          throw new Error('Selected child profile was not found.');
        }

        const childProfile = childDoc.data() as ChildProfile;
        if (childProfile.ownerParentUid && childProfile.ownerParentUid !== user.uid) {
          throw new Error('You do not have permission to use this child profile.');
        }
        if (!childProfile.ownerParentUid) {
          await updateDoc(childRef, { ownerParentUid: user.uid });
        }

        const childEstimatedLevel = childProfile.estimatedLevel || 2;
        let chosenLevelBand: 'low' | 'medium' | 'high';
        if (childEstimatedLevel <= 2) chosenLevelBand = "low";
        else if (childEstimatedLevel === 3) chosenLevelBand = "medium";
        else chosenLevelBand = "high";

        const promptConfigsRef = collection(firestore, 'promptConfigs');
        const q = query(
          promptConfigsRef,
          where('phase', '==', 'warmup'),
          where('levelBand', '==', chosenLevelBand),
          where('status', '==', 'live'),
          limit(1)
        );
        const querySnapshot = await getDocs(q);
        let promptConfig: PromptConfig | null = null;
        if (!querySnapshot.empty) {
          promptConfig = querySnapshot.docs[0].data() as PromptConfig;
        } else {
          const fallbackRef = doc(firestore, 'promptConfigs', 'warmup_level_low_v1');
          const fallbackDoc = await getDoc(fallbackRef);
          if (fallbackDoc.exists()) {
            promptConfig = fallbackDoc.data() as PromptConfig;
          }
        }
        if (!promptConfig) {
          throw new Error("No warmup promptConfig found (including fallback).");
        }

        const storySessionRef = doc(collection(firestore, 'storySessions'));
        const storySessionId = storySessionRef.id;

        const newSessionData = {
          childId: childId,
          parentUid: user.uid,
          status: "in_progress",
          currentPhase: "warmup",
          currentStepIndex: 0,
          storyTitle: "",
          storyVibe: "",
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
          promptConfigId: promptConfig.id,
          promptConfigLevelBand: chosenLevelBand,
          id: storySessionId,
        };
        await setDoc(storySessionRef, newSessionData);

        const charactersRef = collection(firestore, 'characters');
        const newCharacterData = {
          ownerChildId: childId,
          ownerParentUid: user.uid,
          sessionId: storySessionId,
          displayName: childProfile.displayName || 'You',
          role: 'family' as const,
          relatedTo: childId,
          realPersonRef: { kind: 'self' as const, label: 'You' },
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp()
        };
        const newCharacterRef = await addDoc(charactersRef, newCharacterData);
        const mainCharacterId = newCharacterRef.id;

        await updateDoc(storySessionRef, { mainCharacterId: mainCharacterId });

        const initialAssistantMessage = "Hi! I am your Story Guide. What would you like me to call you?";
        const messagePayload = {
          sender: 'assistant' as const,
          text: initialAssistantMessage,
          createdAt: serverTimestamp()
        };
        await addDoc(collection(firestore, 'storySessions', storySessionId, 'messages'), messagePayload);

        router.push(`/story/play/${storySessionId}`);

      } catch (e: any) {
        console.error("Error starting story:", e);
        setError(e.message || 'An unknown error occurred.');
        setIsLoading(false);
      }
    };

    startStoryProcess();
  }, [user, firestore, activeChildId, userLoading, router]);

  return (
    <div className="container mx-auto flex min-h-screen items-center justify-center p-4">
      <Card className="w-full max-w-md text-center">
        <CardHeader>
          <CardTitle>Starting a New Chat Story</CardTitle>
          <CardDescription>
            Hold on tight, we're preparing a new adventure for you!
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col items-center justify-center gap-4 py-8">
          {isLoading ? (
            <>
              <LoaderCircle className="h-12 w-12 animate-spin text-primary" />
              <p className="text-muted-foreground">Creating your story session...</p>
            </>
          ) : error ? (
            <div className="space-y-4">
              <p className="text-destructive">{error}</p>
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