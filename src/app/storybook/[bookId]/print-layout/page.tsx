'use client';

import { useMemo, useState, useEffect } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { useFirestore } from '@/firebase';
import { doc, collection, query, where, addDoc, getDoc, getDocs, serverTimestamp, orderBy, limit } from 'firebase/firestore';
import { useDocument, useCollection } from '@/lib/firestore-hooks';
import type { Story, PrintLayout, StoryBookOutput } from '@/lib/types';
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { LoaderCircle, ChevronLeft, ArrowRight, BookOpen } from 'lucide-react';
import { useUser } from '@/firebase/auth/use-user';
import { useParentGuard } from '@/hooks/use-parent-guard';
import { useToast } from '@/hooks/use-toast';
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert';

export default function PrintLayoutSelectionPage() {
  const params = useParams<{ bookId: string }>();
  const bookId = params.bookId;
  const searchParams = useSearchParams();
  const storybookIdParam = searchParams.get('storybookId');
  const router = useRouter();
  const firestore = useFirestore();
  const { user } = useUser();
  const { toast } = useToast();
  const { isParentGuardValidated, showPinModal } = useParentGuard();

  const [selectedLayoutId, setSelectedLayoutId] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [storybookId, setStorybookId] = useState<string | null>(storybookIdParam);
  const [storybookLoading, setStorybookLoading] = useState(!storybookIdParam);

  // Fetch the story
  const storyRef = useMemo(
    () => (firestore && bookId ? doc(firestore, 'stories', bookId) : null),
    [firestore, bookId]
  );
  const { data: story, loading: storyLoading } = useDocument<Story>(storyRef);

  // If no storybookId param, try to find the most recent storybook for this story
  useEffect(() => {
    const findStorybook = async () => {
      if (!firestore || !bookId || storybookIdParam) {
        setStorybookLoading(false);
        return;
      }

      try {
        // Query for the most recent storybook with ready images
        const storybooksRef = collection(firestore, 'stories', bookId, 'storybooks');
        const storybooksQuery = query(
          storybooksRef,
          where('imageGeneration.status', '==', 'ready'),
          orderBy('createdAt', 'desc'),
          limit(1)
        );
        const storybooksSnap = await getDocs(storybooksQuery);

        if (!storybooksSnap.empty) {
          const foundStorybookId = storybooksSnap.docs[0].id;
          console.log('[print-layout] Found storybook:', foundStorybookId);
          setStorybookId(foundStorybookId);
        } else {
          console.log('[print-layout] No new-model storybook found, will use legacy path');
        }
      } catch (error) {
        console.error('[print-layout] Error finding storybook:', error);
      } finally {
        setStorybookLoading(false);
      }
    };

    findStorybook();
  }, [firestore, bookId, storybookIdParam]);

  // Fetch available print layouts
  const layoutsQuery = useMemo(
    () => firestore ? query(collection(firestore, 'printLayouts')) : null,
    [firestore]
  );
  const { data: layouts, loading: layoutsLoading } = useCollection<PrintLayout>(layoutsQuery);

  // Debug: Log layouts when they load
  useEffect(() => {
    if (layouts) {
      console.log('[print-layout] Layouts loaded:', layouts);
    }
  }, [layouts]);

  const handleCreatePrintStoryBook = async () => {
    if (!user || !firestore || !story) {
      return;
    }

    console.log('[print-layout] Selected layout ID:', selectedLayoutId);
    console.log('[print-layout] Available layouts:', layouts?.map(l => ({ id: l.id, name: l.name })));

    if (!selectedLayoutId) {
      toast({
        title: 'No layout selected',
        description: 'Please select a print layout to continue.',
        variant: 'destructive',
      });
      return;
    }

    // Verify parent guard
    if (!isParentGuardValidated) {
      showPinModal();
      return;
    }

    setIsCreating(true);

    try {
      // Create the PrintStoryBook document
      const printStoryBooksRef = collection(firestore, 'printStoryBooks');

      console.log('[print-layout] Creating PrintStoryBook with selectedLayoutId:', selectedLayoutId);
      console.log('[print-layout] Type of selectedLayoutId:', typeof selectedLayoutId);
      console.log('[print-layout] Using storybookId:', storybookId || '(legacy mode)');

      const newPrintStoryBook: Record<string, any> = {
        ownerUserId: user.uid,
        storyId: bookId,
        storySessionId: story.storySessionId,
        title: story.metadata?.title || 'Untitled Story',
        childName: story.childId || '',
        printLayoutId: selectedLayoutId,
        pages: [], // Will be populated by auto-layout engine
        pdfStatus: 'draft',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      };

      // Include storybookId if we're using the new model
      if (storybookId) {
        newPrintStoryBook.storybookId = storybookId;
      }

      console.log('[print-layout] Full document to create:', newPrintStoryBook);

      const docRef = await addDoc(printStoryBooksRef, newPrintStoryBook);
      console.log('[print-layout] Document created with ID:', docRef.id);

      // Read back the document to verify it was written correctly
      const createdDoc = await getDoc(docRef);
      console.log('[print-layout] Document data after creation:', createdDoc.data());

      // Call auto-layout API to populate pages
      // Note: Pass printLayoutId in the request body because serverTimestamp() causes
      // the document fields to not be immediately readable on the client after creation
      const requestBody = { printLayoutId: selectedLayoutId };
      const requestBodyString = JSON.stringify(requestBody);
      console.log('[print-layout] Request body object:', requestBody);
      console.log('[print-layout] Request body string:', requestBodyString);
      console.log('[print-layout] Calling API:', `/api/printStoryBooks/${docRef.id}/auto-layout`);

      const autoLayoutResponse = await fetch(
        `/api/printStoryBooks/${docRef.id}/auto-layout`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: requestBodyString,
        }
      );

      if (!autoLayoutResponse.ok) {
        console.error('[print-layout] Response status:', autoLayoutResponse.status);
        console.error('[print-layout] Response statusText:', autoLayoutResponse.statusText);

        const responseText = await autoLayoutResponse.text();
        console.error('[print-layout] Response body (raw):', responseText);

        let errorData: any = {};
        try {
          errorData = JSON.parse(responseText);
          console.error('[print-layout] Parsed error data:', errorData);
        } catch (e) {
          console.error('[print-layout] Failed to parse error response as JSON');
        }

        const errorMessage = errorData.error || errorData.details || responseText || 'Failed to generate auto-layout';
        console.error('[print-layout] Error message:', errorMessage);
        throw new Error(errorMessage);
      }

      toast({
        title: 'Print storybook created',
        description: 'Redirecting to page editor...',
      });

      // Navigate to the page editor
      router.push(`/storybook/${bookId}/print-layout/${docRef.id}/pages`);
    } catch (error) {
      console.error('Error creating print storybook:', error);
      toast({
        title: 'Error',
        description: 'Failed to create print storybook. Please try again.',
        variant: 'destructive',
      });
    } finally {
      setIsCreating(false);
    }
  };

  if (!user) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Card className="w-full max-w-md">
          <CardContent className="pt-6">
            <p className="text-center text-muted-foreground">Please sign in to continue.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (storyLoading || layoutsLoading || storybookLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <LoaderCircle className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!story) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Card className="w-full max-w-md">
          <CardContent className="pt-6">
            <Alert variant="destructive">
              <AlertTitle>Story not found</AlertTitle>
              <AlertDescription>
                The story you're looking for doesn't exist or you don't have permission to view it.
              </AlertDescription>
            </Alert>
            <div className="mt-4">
              <Link href="/parent/children">
                <Button variant="outline" className="w-full">
                  <ChevronLeft className="mr-2 h-4 w-4" />
                  Back to Children
                </Button>
              </Link>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="container mx-auto py-8 px-4 max-w-6xl">
      {/* Header */}
      <div className="mb-8">
        <Link href={`/story/${bookId}`}>
          <Button variant="ghost" size="sm" className="mb-4">
            <ChevronLeft className="mr-2 h-4 w-4" />
            Back to Story
          </Button>
        </Link>
        <div className="flex items-center gap-3 mb-2">
          <BookOpen className="h-8 w-8 text-primary" />
          <h1 className="text-3xl font-bold">Select Print Layout</h1>
        </div>
        <p className="text-muted-foreground">
          Choose how you want your story to be laid out on the printed pages.
        </p>
      </div>

      {/* Story Info */}
      <Card className="mb-8">
        <CardHeader>
          <CardTitle>{story.metadata?.title || 'Untitled Story'}</CardTitle>
          <CardDescription>
            This layout will determine how text and images are positioned on each page.
          </CardDescription>
        </CardHeader>
      </Card>

      {/* Layout Selection Grid */}
      {!layouts || layouts.length === 0 ? (
        <Alert>
          <AlertTitle>No print layouts available</AlertTitle>
          <AlertDescription>
            Please contact an administrator to set up print layouts.
          </AlertDescription>
        </Alert>
      ) : (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mb-8">
            {layouts.map((layout) => (
              <Card
                key={layout.id}
                className={`cursor-pointer transition-all hover:shadow-lg ${
                  selectedLayoutId === layout.id
                    ? 'ring-2 ring-primary shadow-lg'
                    : 'hover:ring-1 hover:ring-primary/50'
                }`}
                onClick={() => {
                  console.log('[print-layout] Selecting layout:', layout.id, layout.name);
                  setSelectedLayoutId(layout.id);
                }}
              >
                <CardHeader>
                  <CardTitle className="text-lg">{layout.name}</CardTitle>
                  <CardDescription>
                    {layout.leavesPerSpread === 1 ? 'Single Page' : 'Two-Page Spread'}
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="bg-muted rounded-lg p-4 mb-4 aspect-[3/2] flex items-center justify-center">
                    {/* Layout Preview Visualization */}
                    <div className="text-sm text-muted-foreground text-center">
                      {layout.leafWidth}" × {layout.leafHeight}"
                      <br />
                      {(layout.textBoxes?.length ?? 0)} text {(layout.textBoxes?.length ?? 0) === 1 ? 'box' : 'boxes'}
                      <br />
                      {(layout.imageBoxes?.length ?? 0)} image {(layout.imageBoxes?.length ?? 0) === 1 ? 'box' : 'boxes'}
                    </div>
                  </div>
                  <div className="text-sm space-y-1">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Page Size:</span>
                      <span className="font-medium">
                        {layout.leafWidth}" × {layout.leafHeight}"
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Layout Type:</span>
                      <span className="font-medium">
                        {layout.leavesPerSpread === 1 ? 'Single' : 'Spread'}
                      </span>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>

          {/* Action Buttons */}
          <div className="flex justify-end gap-4">
            <Link href={`/story/${bookId}`}>
              <Button variant="outline">Cancel</Button>
            </Link>
            <Button
              onClick={handleCreatePrintStoryBook}
              disabled={!selectedLayoutId || isCreating}
            >
              {isCreating ? (
                <>
                  <LoaderCircle className="mr-2 h-4 w-4 animate-spin" />
                  Creating...
                </>
              ) : (
                <>
                  Continue to Pages
                  <ArrowRight className="ml-2 h-4 w-4" />
                </>
              )}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
