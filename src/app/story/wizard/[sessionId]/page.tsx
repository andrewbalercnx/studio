'use client';

import { useState, useMemo, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useUser } from '@/firebase/auth/use-user';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { LoaderCircle } from 'lucide-react';
import Link from 'next/link';
import { useFirestore } from '@/firebase';
import { doc, collection, addDoc, serverTimestamp, updateDoc } from 'firebase/firestore';
import type { StorySession, StoryWizardChoice } from '@/lib/types';
import { useDocument } from '@/lib/firestore-hooks';
import { useToast } from '@/hooks/use-toast';
import { storyWizardFlow, StoryWizardInput, StoryWizardOutput } from '@/ai/flows/story-wizard-flow';
import { ThinkingIndicator } from '@/components/child-thinking-indicator';

export default function StoryWizardPage() {
  const params = useParams<{ sessionId: string }>();
  const sessionId = params.sessionId;
  const router = useRouter();
  const { user, loading: userLoading } = useUser();
  const firestore = useFirestore();
  const { toast } = useToast();

  const sessionRef = useMemo(() => (firestore ? doc(firestore, 'storySessions', sessionId) : null), [firestore, sessionId]);
  const { data: session, loading: sessionLoading } = useDocument<StorySession>(sessionRef);

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
        if (sessionRef) {
          await updateDoc(sessionRef, {
            status: 'completed',
            storyTitle: result.title || session?.storyTitle || 'A Magical Story',
            storyVibe: result.vibe || session?.storyVibe,
            finalStoryText: result.storyText,
            updatedAt: serverTimestamp(),
          });
        }
        toast({
          title: 'Story Complete!',
          description: 'Your magical story has been created.',
        });
        router.push(`/story/session/${sessionId}`);
      }
    } catch (e: any) {
      setError(e.message || 'An unexpected error occurred in the story wizard.');
      toast({ title: 'Wizard Error', description: e.message, variant: 'destructive' });
    } finally {
      setIsProcessing(false);
    }
  }, [sessionId, sessionRef, session, toast, router]);

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
        <ThinkingIndicator />
        <p className="text-muted-foreground">The Magic Wizard is preparing your adventure...</p>
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
          <ThinkingIndicator />
          <p className="text-muted-foreground">The wizard is creating the next part...</p>
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
          <LoaderCircle className="h-12 w-12 animate-spin text-primary" />
          <p className="text-muted-foreground">Finalizing your story...</p>
        </div>
      )}
    </div>
  );
}
