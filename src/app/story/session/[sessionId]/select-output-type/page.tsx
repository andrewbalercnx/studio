'use client';

import { use, useEffect, useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { useFirestore } from '@/firebase';
import { collection, query, where, updateDoc, doc } from 'firebase/firestore';
import { useCollection, useDocument } from '@/lib/firestore-hooks';
import type { StoryOutputType, StorySession } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { LoaderCircle } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

export default function SelectOutputTypePage({ params }: { params: Promise<{ sessionId: string }> }) {
  const resolvedParams = use(params);
  const sessionId = resolvedParams.sessionId;
  const router = useRouter();
  const firestore = useFirestore();
  const { toast } = useToast();
  const [isSelecting, setIsSelecting] = useState(false);

  // Load session
  const sessionRef = useMemo(() => (firestore ? doc(firestore, 'storySessions', sessionId) : null), [firestore, sessionId]);
  const { data: session, loading: sessionLoading } = useDocument<StorySession>(sessionRef);

  // Load available story output types
  const outputTypesQuery = useMemo(() => {
    if (!firestore) return null;
    return query(collection(firestore, 'storyOutputTypes'), where('status', '==', 'live'));
  }, [firestore]);

  const { data: outputTypes, loading: outputTypesLoading } = useCollection<StoryOutputType>(outputTypesQuery);

  const handleSelectOutputType = async (outputType: StoryOutputType) => {
    if (!sessionRef || !session) return;

    setIsSelecting(true);
    try {
      // Update session with selected output type
      await updateDoc(sessionRef, {
        storyOutputTypeId: outputType.id,
      });

      toast({
        title: 'Story Type Selected!',
        description: `Compiling your story...`,
      });

      // Compile the story with the selected output type
      const compileResponse = await fetch('/api/storyCompile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, storyOutputTypeId: outputType.id }),
      });

      const compileResult = await compileResponse.json();
      if (!compileResponse.ok || !compileResult.ok) {
        throw new Error(compileResult.errorMessage || 'Failed to compile story');
      }

      toast({
        title: 'Story Created!',
        description: 'Your story has been saved.',
      });

      // Redirect to child's stories list (story text is compiled, storybook creation is separate)
      if (session.childId) {
        router.push(`/child/${session.childId}/stories`);
      } else {
        router.push(`/stories`);
      }
    } catch (error: any) {
      toast({
        title: 'Error',
        description: error.message || 'Failed to select story type',
        variant: 'destructive',
      });
      setIsSelecting(false);
    }
  };

  if (sessionLoading || outputTypesLoading) {
    return (
      <div className="flex h-screen w-screen flex-col items-center justify-center gap-4">
        <LoaderCircle className="h-12 w-12 animate-spin text-primary" />
        <p className="text-muted-foreground">Loading story options...</p>
      </div>
    );
  }

  if (!session) {
    return (
      <div className="container mx-auto flex min-h-screen items-center justify-center p-4">
        <Card className="w-full max-w-md text-center">
          <CardHeader>
            <CardTitle>Story Not Found</CardTitle>
            <CardDescription>We couldn't find that story.</CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-primary/10 to-background py-10">
      <div className="container mx-auto px-4 max-w-4xl space-y-8">
        <div className="text-center space-y-2">
          <h1 className="text-4xl font-headline">Choose Your Story Type</h1>
          <p className="text-muted-foreground">How would you like your story to look?</p>
        </div>

        <div className="grid gap-6 md:grid-cols-2">
          {outputTypes?.map((outputType) => (
            <Card
              key={outputType.id}
              className="border-2 border-primary/20 hover:border-primary/50 transition-all cursor-pointer"
              onClick={() => !isSelecting && handleSelectOutputType(outputType)}
            >
              <CardHeader>
                <CardTitle className="text-2xl">{outputType.childFacingLabel}</CardTitle>
                <CardDescription>{outputType.shortDescription}</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-2 text-sm text-muted-foreground">
                  <p><strong>Age Range:</strong> {outputType.ageRange}</p>
                  {outputType.layoutHints?.pageCount && (
                    <p><strong>Pages:</strong> About {outputType.layoutHints.pageCount}</p>
                  )}
                  {outputType.layoutHints?.needsImages && (
                    <p><strong>Includes:</strong> Pictures on every page!</p>
                  )}
                </div>
                <Button
                  className="w-full mt-4"
                  disabled={isSelecting}
                  onClick={(e) => {
                    e.stopPropagation();
                    handleSelectOutputType(outputType);
                  }}
                >
                  {isSelecting ? (
                    <>
                      <LoaderCircle className="mr-2 h-4 w-4 animate-spin" />
                      Selecting...
                    </>
                  ) : (
                    'Choose This Type'
                  )}
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>

        {(!outputTypes || outputTypes.length === 0) && (
          <Card className="border-dashed">
            <CardContent className="flex flex-col items-center gap-4 py-10 text-center">
              <p className="text-muted-foreground">No story types are available right now. Please check back later!</p>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
