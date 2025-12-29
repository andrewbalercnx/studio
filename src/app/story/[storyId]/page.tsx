'use client';

import { use, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useFirestore } from '@/firebase';
import { doc, collection, query, orderBy, addDoc, serverTimestamp, getDoc } from 'firebase/firestore';
import { useDocument, useCollection } from '@/lib/firestore-hooks';
import type { Story, StoryBookOutput, ChildProfile, PrintLayout, ImageStyle, StoryOutputType } from '@/lib/types';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { LoaderCircle, Plus, Book, Image as ImageIcon, Printer, Eye } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { Badge } from '@/components/ui/badge';
import Link from 'next/link';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { calculateImageDimensions } from '@/lib/print-layout-utils';

export default function StoryDetailPage({ params }: { params: Promise<{ storyId: string }> }) {
  const resolvedParams = use(params);
  const storyId = resolvedParams.storyId;
  const router = useRouter();
  const firestore = useFirestore();
  const { toast } = useToast();

  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [selectedOutputTypeId, setSelectedOutputTypeId] = useState<string>('');
  const [selectedImageStyleId, setSelectedImageStyleId] = useState<string>('');

  // Load story
  const storyRef = useMemo(() => (firestore ? doc(firestore, 'stories', storyId) : null), [firestore, storyId]);
  const { data: story, loading: storyLoading, error: storyError } = useDocument<Story>(storyRef);

  // Load child profile for display name
  const childRef = useMemo(() => (firestore && story?.childId ? doc(firestore, 'children', story.childId) : null), [firestore, story?.childId]);
  const { data: childProfile } = useDocument<ChildProfile>(childRef);

  // Load storybooks for this story
  const storybooksQuery = useMemo(() => {
    if (!firestore) return null;
    return query(
      collection(firestore, 'stories', storyId, 'storybooks'),
      orderBy('createdAt', 'desc')
    );
  }, [firestore, storyId]);
  const { data: storybooks, loading: storybooksLoading } = useCollection<StoryBookOutput>(storybooksQuery);

  // Load available output types
  const outputTypesQuery = useMemo(() => {
    if (!firestore) return null;
    return query(collection(firestore, 'storyOutputTypes'), orderBy('childFacingLabel', 'asc'));
  }, [firestore]);
  const { data: outputTypes } = useCollection<StoryOutputType>(outputTypesQuery);

  // Load available image styles
  const imageStylesQuery = useMemo(() => {
    if (!firestore) return null;
    return query(collection(firestore, 'imageStyles'), orderBy('title', 'asc'));
  }, [firestore]);
  const { data: imageStyles } = useCollection<ImageStyle>(imageStylesQuery);

  // Get print layout from the selected output type (not the child)
  const selectedOutputType = outputTypes?.find(t => t.id === selectedOutputTypeId);
  const printLayoutId = selectedOutputType?.defaultPrintLayoutId || undefined;

  const handleCreateStorybook = async () => {
    if (!firestore || !story || !selectedOutputTypeId || !selectedImageStyleId) {
      toast({ title: 'Error', description: 'Please select output type and image style', variant: 'destructive' });
      return;
    }

    const outputType = outputTypes?.find(t => t.id === selectedOutputTypeId);
    const selectedImageStyle = imageStyles?.find(s => s.id === selectedImageStyleId);

    if (!outputType || !selectedImageStyle) {
      toast({ title: 'Error', description: 'Invalid selection', variant: 'destructive' });
      return;
    }

    setIsCreating(true);
    try {
      // Use print layout from storyOutputType if specified, otherwise unconstrained
      const outputTypePrintLayoutId = outputType.defaultPrintLayoutId || undefined;

      // Default dimensions: 8x8 inches at 300 DPI = 2400x2400 pixels (unconstrained square)
      const DEFAULT_IMAGE_WIDTH_PX = 2400;
      const DEFAULT_IMAGE_HEIGHT_PX = 2400;

      let imageWidthPx: number = DEFAULT_IMAGE_WIDTH_PX;
      let imageHeightPx: number = DEFAULT_IMAGE_HEIGHT_PX;

      // Only calculate dimensions from layout if a print layout is specified on the output type
      if (outputTypePrintLayoutId) {
        const layoutDoc = await getDoc(doc(firestore, 'printLayouts', outputTypePrintLayoutId));
        const layout = layoutDoc.exists() ? (layoutDoc.data() as PrintLayout) : null;
        if (layout) {
          const dimensions = calculateImageDimensions(layout);
          imageWidthPx = dimensions.widthPx;
          imageHeightPx = dimensions.heightPx;
        }
      }

      // Create new StoryBookOutput document
      const storybooksRef = collection(firestore, 'stories', storyId, 'storybooks');
      const newStorybook: Omit<StoryBookOutput, 'id'> = {
        storyId,
        childId: story.childId,
        parentUid: story.parentUid,
        storyOutputTypeId: selectedOutputTypeId,
        imageStyleId: selectedImageStyleId,
        imageStylePrompt: selectedImageStyle.stylePrompt,
        printLayoutId: outputTypePrintLayoutId || null,
        imageWidthPx,
        imageHeightPx,
        pageGeneration: { status: 'idle' },
        imageGeneration: { status: 'idle' },
        title: story.metadata?.title,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      };

      const docRef = await addDoc(storybooksRef, newStorybook);

      toast({
        title: 'Storybook Created!',
        description: `Creating ${outputType.childFacingLabel} with ${selectedImageStyle.title} style...`,
      });

      setIsCreateDialogOpen(false);
      setSelectedOutputTypeId('');
      setSelectedImageStyleId('');

      // Navigate to the generating page for this storybook
      router.push(`/story/${storyId}/storybook/${docRef.id}/generating`);
    } catch (error: any) {
      toast({
        title: 'Error',
        description: error.message || 'Failed to create storybook',
        variant: 'destructive',
      });
    } finally {
      setIsCreating(false);
    }
  };

  const getStatusBadge = (storybook: StoryBookOutput) => {
    if (storybook.imageGeneration?.status === 'ready') {
      return <Badge variant="default" className="bg-green-500">Complete</Badge>;
    }
    if (storybook.imageGeneration?.status === 'running') {
      return <Badge variant="secondary">Generating Images...</Badge>;
    }
    if (storybook.pageGeneration?.status === 'running') {
      return <Badge variant="secondary">Generating Pages...</Badge>;
    }
    if (storybook.pageGeneration?.status === 'ready') {
      return <Badge variant="outline">Pages Ready</Badge>;
    }
    if (storybook.pageGeneration?.status === 'error' || storybook.imageGeneration?.status === 'error') {
      return <Badge variant="destructive">Error</Badge>;
    }
    return <Badge variant="outline">Draft</Badge>;
  };

  if (storyLoading) {
    return (
      <div className="flex h-screen w-screen flex-col items-center justify-center gap-4">
        <LoaderCircle className="h-12 w-12 animate-spin text-primary" />
        <p className="text-muted-foreground">Loading story...</p>
      </div>
    );
  }

  if (storyError || !story) {
    return (
      <div className="container mx-auto flex min-h-screen items-center justify-center p-4">
        <Card className="w-full max-w-md text-center">
          <CardHeader>
            <CardTitle>Story Not Found</CardTitle>
            <CardDescription>{storyError?.message || "We couldn't find that story."}</CardDescription>
          </CardHeader>
          <CardFooter className="justify-center">
            <Button asChild>
              <Link href="/">Go Home</Link>
            </Button>
          </CardFooter>
        </Card>
      </div>
    );
  }

  return (
    <div className="container mx-auto p-4 sm:p-6 md:p-8 max-w-5xl space-y-8">
      {/* Story Header */}
      <Card>
        <CardHeader>
          <div className="flex items-start justify-between">
            <div>
              <CardTitle className="text-3xl">{story.metadata?.title || 'Untitled Story'}</CardTitle>
              <CardDescription>
                Created for {childProfile?.displayName || 'your child'}
              </CardDescription>
            </div>
            <Dialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
              <DialogTrigger asChild>
                <Button>
                  <Plus className="mr-2 h-4 w-4" />
                  Create Storybook
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Create a New Storybook</DialogTitle>
                  <DialogDescription>
                    Choose how you want to turn this story into a storybook.
                  </DialogDescription>
                </DialogHeader>
                <div className="space-y-4 py-4">
                  <div className="space-y-2">
                    <Label>Output Type</Label>
                    <Select value={selectedOutputTypeId} onValueChange={setSelectedOutputTypeId}>
                      <SelectTrigger>
                        <SelectValue placeholder="Select output type..." />
                      </SelectTrigger>
                      <SelectContent>
                        {outputTypes?.map((type) => (
                          <SelectItem key={type.id} value={type.id}>
                            {type.childFacingLabel}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2">
                    <Label>Image Style</Label>
                    <Select value={selectedImageStyleId} onValueChange={setSelectedImageStyleId}>
                      <SelectTrigger>
                        <SelectValue placeholder="Select art style..." />
                      </SelectTrigger>
                      <SelectContent>
                        {imageStyles?.map((style) => (
                          <SelectItem key={style.id} value={style.id}>
                            {style.title}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  {printLayoutId && (
                    <p className="text-sm text-muted-foreground">
                      Image dimensions determined by output type's print layout
                    </p>
                  )}
                  {!printLayoutId && selectedOutputTypeId && (
                    <p className="text-sm text-muted-foreground">
                      Images will be generated at default size (8" × 8" square)
                    </p>
                  )}

                  <Button
                    onClick={handleCreateStorybook}
                    disabled={isCreating || !selectedOutputTypeId || !selectedImageStyleId}
                    className="w-full"
                  >
                    {isCreating ? (
                      <>
                        <LoaderCircle className="mr-2 h-4 w-4 animate-spin" />
                        Creating...
                      </>
                    ) : (
                      'Create Storybook'
                    )}
                  </Button>
                </div>
              </DialogContent>
            </Dialog>
          </div>
        </CardHeader>
        <CardContent>
          <div className="prose prose-sm max-w-none">
            <p className="text-muted-foreground whitespace-pre-wrap line-clamp-6">
              {story.storyText}
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Storybooks List */}
      <div className="space-y-4">
        <h2 className="text-2xl font-bold">Storybooks</h2>

        {storybooksLoading ? (
          <div className="flex items-center gap-2 py-8 justify-center">
            <LoaderCircle className="h-5 w-5 animate-spin" />
            <span>Loading storybooks...</span>
          </div>
        ) : storybooks && storybooks.length > 0 ? (
          <div className="grid gap-4 md:grid-cols-2">
            {storybooks.map((storybook) => {
              const outputType = outputTypes?.find(t => t.id === storybook.storyOutputTypeId);
              const imageStyle = imageStyles?.find(s => s.id === storybook.imageStyleId);

              return (
                <Card key={storybook.id}>
                  <CardHeader>
                    <div className="flex items-start justify-between">
                      <div>
                        <CardTitle className="flex items-center gap-2">
                          <Book className="h-5 w-5" />
                          {outputType?.childFacingLabel || 'Storybook'}
                        </CardTitle>
                        <CardDescription className="flex items-center gap-2 mt-1">
                          <ImageIcon className="h-4 w-4" />
                          {imageStyle?.title || 'Unknown style'}
                        </CardDescription>
                      </div>
                      {getStatusBadge(storybook)}
                    </div>
                  </CardHeader>
                  <CardContent>
                    <div className="text-sm text-muted-foreground space-y-1">
                      <p>Pages: {storybook.pageGeneration?.pagesCount || 0}</p>
                      {storybook.imageGeneration?.pagesTotal && (
                        <p>
                          Images: {storybook.imageGeneration.pagesReady || 0} / {storybook.imageGeneration.pagesTotal}
                        </p>
                      )}
                    </div>
                  </CardContent>
                  <CardFooter className="gap-2">
                    {storybook.imageGeneration?.status === 'ready' ? (
                      <>
                        <Button asChild variant="default" size="sm">
                          <Link href={`/storybook/${storybook.id}?storyId=${storyId}`}>
                            <Eye className="mr-2 h-4 w-4" />
                            View
                          </Link>
                        </Button>
                        <Button asChild variant="outline" size="sm">
                          <Link href={`/storybook/${storybook.id}/order?storyId=${storyId}`}>
                            <Printer className="mr-2 h-4 w-4" />
                            Order Print
                          </Link>
                        </Button>
                      </>
                    ) : (
                      <Button asChild variant="outline" size="sm">
                        <Link href={`/story/${storyId}/storybook/${storybook.id}/generating`}>
                          View Progress
                        </Link>
                      </Button>
                    )}
                  </CardFooter>
                </Card>
              );
            })}
          </div>
        ) : (
          <Card className="border-dashed">
            <CardContent className="flex flex-col items-center gap-4 py-10 text-center">
              <Book className="h-12 w-12 text-muted-foreground" />
              <div>
                <p className="font-medium">No storybooks yet</p>
                <p className="text-sm text-muted-foreground">
                  Create your first storybook from this story!
                </p>
              </div>
              <Button onClick={() => setIsCreateDialogOpen(true)}>
                <Plus className="mr-2 h-4 w-4" />
                Create Storybook
              </Button>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
