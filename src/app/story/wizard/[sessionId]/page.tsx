
'use client';

import { useEffect, useState, useMemo, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useUser } from '@/firebase/auth/use-user';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { LoaderCircle } from 'lucide-react';
import Link from 'next/link';
import { useFirestore } from '@/firebase';
import { doc, collection, addDoc, serverTimestamp, updateDoc, query, where } from 'firebase/firestore';
import type { StorySession, StoryWizardChoice, ChildProfile, StoryOutputType } from '@/lib/types';
import { useDocument, useCollection } from '@/lib/firestore-hooks';
import { useToast } from '@/hooks/use-toast';
import { storyWizardFlow } from '@/ai/flows/story-wizard-flow';
import type { StoryWizardInput, StoryWizardOutput } from '@/lib/types';
import { ChildAvatarAnimation } from '@/components/child/child-avatar-animation';

export default function StoryWizardPage() {
  const params = useParams<{ sessionId: string }>();
  const sessionId = params.sessionId;
  const router = useRouter();
  const { user, loading: userLoading } = useUser();
  const firestore = useFirestore();
  const { toast } = useToast();

  const sessionRef = useMemo(() => (firestore ? doc(firestore, 'storySessions', sessionId) : null), [firestore, sessionId]);
  const { data: session, loading: sessionLoading } = useDocument<StorySession>(sessionRef);

  // Fetch child profile for dancing avatar
  const childRef = useMemo(() => (session?.childId && firestore) ? doc(firestore, 'children', session.childId) : null, [firestore, session?.childId]);
  const { data: childProfile } = useDocument<ChildProfile>(childRef);

  // Fetch story output types for auto-compile
  const storyOutputTypesQuery = useMemo(() => firestore ? query(collection(firestore, 'storyOutputTypes'), where('status', '==', 'live')) : null, [firestore]);
  const { data: storyOutputTypes } = useCollection<StoryOutputType>(storyOutputTypesQuery);

  const [wizardState, setWizardState] = useState<StoryWizardOutput | null>(null);
  const [isProcessing, setIsProcessing] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const runWizard = useCallback(async (input: StoryWizardInput) => {
    setIsProcessing(true);
    setError(null);
    try {
      const result = await storyWizardFlow(input);
      if (!result.ok) {
        throw new Error(result.error);
      }
      setWizardState(result);
      if (result.state === 'finished' && result.storyText) {
        if (sessionRef && session) {
          await updateDoc(sessionRef, {
            status: 'completed',
            storyTitle: result.title || session?.storyTitle || 'A Magical Story',
            storyVibe: result.vibe || session?.storyVibe,
            finalStoryText: result.storyText,
            updatedAt: serverTimestamp(),
          });
        }

        // Auto-compile the story
        const storyOutputTypeId = storyOutputTypes?.[0]?.id;
        if (storyOutputTypeId) {
          toast({
            title: 'Story Complete!',
            description: 'Saving your story...',
          });
          try {
            const response = await fetch('/api/storyCompile', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ sessionId, storyOutputTypeId }),
            });
            const compileResult = await response.json();
            if (compileResult.ok) {
              toast({
                title: 'Story saved!',
                description: 'Your story is ready to view.',
              });
            }
          } catch (compileError) {
            console.error('[wizard] Compile error:', compileError);
          }
        }

        // Redirect to child's stories list
        router.push(`/child/${session?.childId}/stories`);
      }
    } catch (e: any) {
      setError(e.message || 'An unexpected error occurred in the story wizard.');
      toast({ title: 'Wizard Error', description: e.message, variant: 'destructive' });
    } finally {
      setIsProcessing(false);
    }
  }, [sessionId, sessionRef, session, storyOutputTypes, toast, router]);

  // Initial call to the wizard flow
  useEffect(() => {
    if (session && !wizardState && isProcessing) {
      runWizard({
        childId: session.childId,
        sessionId: session.id,
        answers: [],
      });
    }
  }, [session, wizardState, isProcessing, runWizard]);

  const handleSelectChoice = (choice: StoryWizardChoice) => {
    if (!session || !wizardState || isProcessing) return;

    if (wizardState.state !== 'asking') return;

    const currentAnswers = wizardState.answers || [];
    const newAnswers = [...currentAnswers, { question: wizardState.question!, answer: choice.text }];

    runWizard({
      childId: session.childId,
      sessionId: session.id,
      answers: newAnswers,
    });
  };

  if (userLoading || sessionLoading || (isProcessing && !wizardState)) {
    return (
      <div className="flex h-screen w-screen flex-col items-center justify-center gap-4">
        {childProfile?.avatarAnimationUrl || childProfile?.avatarUrl ? (
          <ChildAvatarAnimation
            avatarAnimationUrl={childProfile.avatarAnimationUrl}
            avatarUrl={childProfile.avatarUrl}
            size="lg"
          />
        ) : (
          <LoaderCircle className="h-12 w-12 animate-spin text-primary" />
        )}
        <p className="text-muted-foreground animate-pulse">The Magic Wizard is preparing your adventure...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="container mx-auto flex min-h-screen items-center justify-center p-4">
        <Card className="w-full max-w-md text-center">
          <CardHeader>
            <CardTitle>Oh no!</CardTitle>
            <CardDescription>{error}</CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild>
              <Link href="/stories">Back to My Stories</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex h-screen w-screen flex-col items-center justify-center gap-8 p-4">
      {isProcessing ? (
        <div className="flex flex-col items-center gap-4">
          {childProfile?.avatarAnimationUrl || childProfile?.avatarUrl ? (
            <ChildAvatarAnimation
              avatarAnimationUrl={childProfile.avatarAnimationUrl}
              avatarUrl={childProfile.avatarUrl}
              size="lg"
            />
          ) : (
            <LoaderCircle className="h-12 w-12 animate-spin text-primary" />
          )}
          <p className="text-muted-foreground animate-pulse">The wizard is creating the next part...</p>
        </div>
      ) : wizardState?.state === 'asking' && wizardState.question ? (
        <Card className="w-full max-w-2xl text-center">
          <CardHeader>
            <CardTitle className="text-3xl font-headline">{wizardState.question}</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {wizardState.choices?.map((choice, index) => (
              <Button
                key={index}
                variant="outline"
                className="h-auto p-6 text-lg"
                onClick={() => handleSelectChoice(choice)}
              >
                {choice.text}
              </Button>
            ))}
          </CardContent>
        </Card>
      ) : (
        <div className="flex flex-col items-center gap-4">
          {childProfile?.avatarAnimationUrl || childProfile?.avatarUrl ? (
            <ChildAvatarAnimation
              avatarAnimationUrl={childProfile.avatarAnimationUrl}
              avatarUrl={childProfile.avatarUrl}
              size="lg"
            />
          ) : (
            <LoaderCircle className="h-12 w-12 animate-spin text-primary" />
          )}
          <p className="text-muted-foreground animate-pulse">Saving your story...</p>
        </div>
      )}
    </div>
  );
}
