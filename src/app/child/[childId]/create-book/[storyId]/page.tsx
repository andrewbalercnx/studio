'use client';

import { use, useState, useMemo, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useFirestore } from '@/firebase';
import { useUser } from '@/firebase/auth/use-user';
import {
  collection,
  query,
  where,
  orderBy,
  doc,
  addDoc,
  getDoc,
  serverTimestamp,
} from 'firebase/firestore';
import { useCollection, useDocument } from '@/lib/firestore-hooks';
import type { Story, StoryOutputType, ImageStyle, ChildProfile, PrintLayout, StoryBookOutput } from '@/lib/types';
import { DEFAULT_PRINT_LAYOUT_ID } from '@/lib/types';
import { useAppContext } from '@/hooks/use-app-context';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { LoaderCircle, ArrowLeft, Wand2, Check, ChevronDown, ChevronUp } from 'lucide-react';
import Link from 'next/link';
import Image from 'next/image';
import { useToast } from '@/hooks/use-toast';
import { calculateImageDimensions } from '@/lib/print-layout-utils';
import { cn } from '@/lib/utils';

// Helper to calculate age from date of birth
function getChildAgeYears(child?: ChildProfile | null): number | null {
  if (!child?.dateOfBirth) return null;
  const dob = child.dateOfBirth;
  let date: Date | null = null;
  if (typeof dob?.toDate === 'function') {
    date = dob.toDate();
  } else {
    const parsed = new Date(dob);
    date = isNaN(parsed.getTime()) ? null : parsed;
  }
  if (!date) return null;
  const diff = Date.now() - date.getTime();
  if (diff <= 0) return null;
  return Math.floor(diff / (1000 * 60 * 60 * 24 * 365.25));
}

// Check if an image style is appropriate for the child's age
function isStyleAppropriateForAge(style: ImageStyle, childAge: number | null): boolean {
  if (childAge === null) return true;
  const minAge = style.ageFrom ?? 0;
  const maxAge = style.ageTo;
  if (childAge < minAge) return false;
  if (maxAge !== null && maxAge !== undefined && maxAge !== 0 && childAge > maxAge) return false;
  return true;
}

export default function CreateBookPage({
  params,
}: {
  params: Promise<{ childId: string; storyId: string }>;
}) {
  const resolvedParams = use(params);
  const { childId, storyId } = resolvedParams;
  const router = useRouter();
  const firestore = useFirestore();
  const { user, idTokenResult, loading: userLoading } = useUser();
  const { toast } = useToast();
  const { activeChildProfile, activeChildProfileLoading } = useAppContext();

  const [storyOutputTypeId, setStoryOutputTypeId] = useState('');
  const [imageStyleId, setImageStyleId] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [showAllStyles, setShowAllStyles] = useState(false);

  // Load story (only when authenticated and auth token is ready)
  // We wait for idTokenResult to ensure Firebase auth is fully synced with Firestore
  const storyRef = useMemo(
    () => (firestore && user && !userLoading && idTokenResult ? doc(firestore, 'stories', storyId) : null),
    [firestore, storyId, user, userLoading, idTokenResult]
  );
  const { data: story, loading: storyLoading } = useDocument<Story>(storyRef);

  // Pre-populate storyOutputTypeId from story metadata if available
  // This was already selected during story finalization
  const storyMetadataOutputTypeId = story?.metadata?.storyOutputTypeId as string | undefined;
  useEffect(() => {
    if (storyMetadataOutputTypeId && !storyOutputTypeId) {
      setStoryOutputTypeId(storyMetadataOutputTypeId);
    }
  }, [storyMetadataOutputTypeId, storyOutputTypeId]);

  // Load child profile for age filtering (only when authenticated and auth token is ready)
  const childRef = useMemo(
    () => (firestore && user && !userLoading && idTokenResult ? doc(firestore, 'children', childId) : null),
    [firestore, childId, user, userLoading, idTokenResult]
  );
  const { data: childProfile, loading: childLoading } = useDocument<ChildProfile>(childRef);

  // Calculate child's age for filtering
  const childAge = useMemo(() => getChildAgeYears(childProfile || activeChildProfile), [childProfile, activeChildProfile]);

  // Load story output types (live only, when authenticated and auth token is ready)
  // Note: We don't use orderBy here to avoid requiring a composite index
  const outputTypesQuery = useMemo(() => {
    if (!firestore || !user || userLoading || !idTokenResult) return null;
    return query(
      collection(firestore, 'storyOutputTypes'),
      where('status', '==', 'live')
    );
  }, [firestore, user, userLoading, idTokenResult]);
  const { data: outputTypesRaw, loading: outputTypesLoading } = useCollection<StoryOutputType>(outputTypesQuery);

  // Sort output types by childFacingLabel alphabetically
  const outputTypes = useMemo(() => {
    if (!outputTypesRaw) return null;
    return [...outputTypesRaw].sort((a, b) =>
      (a.childFacingLabel || '').localeCompare(b.childFacingLabel || '')
    );
  }, [outputTypesRaw]);

  // Load image styles (when authenticated and auth token is ready)
  // Note: We don't use orderBy here to avoid requiring a composite index
  const imageStylesQuery = useMemo(() => {
    if (!firestore || !user || userLoading || !idTokenResult) return null;
    return query(collection(firestore, 'imageStyles'));
  }, [firestore, user, userLoading, idTokenResult]);
  const { data: imageStylesRaw, loading: imageStylesLoading } = useCollection<ImageStyle>(imageStylesQuery);

  // Sort image styles by title alphabetically
  const imageStyles = useMemo(() => {
    if (!imageStylesRaw) return null;
    return [...imageStylesRaw].sort((a, b) =>
      (a.title || '').localeCompare(b.title || '')
    );
  }, [imageStylesRaw]);

  // Filter styles based on age appropriateness
  const { ageAppropriateStyles, otherStyles } = useMemo(() => {
    if (!imageStyles) return { ageAppropriateStyles: [], otherStyles: [] };
    const appropriate: ImageStyle[] = [];
    const others: ImageStyle[] = [];
    for (const style of imageStyles) {
      if (isStyleAppropriateForAge(style, childAge)) {
        appropriate.push(style);
      } else {
        others.push(style);
      }
    }
    return { ageAppropriateStyles: appropriate, otherStyles: others };
  }, [imageStyles, childAge]);

  const stylesToShow = showAllStyles ? imageStyles : ageAppropriateStyles;
  const hasMoreStyles = otherStyles.length > 0;

  // Handle book creation
  const handleCreateBook = async () => {
    if (!firestore || !story || !storyOutputTypeId || !imageStyleId) {
      toast({
        title: 'Missing Selection',
        description: 'Please select both a book type and art style.',
        variant: 'destructive',
      });
      return;
    }

    const selectedStyle = imageStyles?.find((s) => s.id === imageStyleId);
    if (!selectedStyle) {
      toast({
        title: 'Error',
        description: 'Selected style not found.',
        variant: 'destructive',
      });
      return;
    }

    setIsCreating(true);

    try {
      // Get print layout for dimension calculation
      const printLayoutId = childProfile?.defaultPrintLayoutId || DEFAULT_PRINT_LAYOUT_ID;
      console.log('[create-book] Print layout selection:', {
        childProfileLoaded: !!childProfile,
        childDefaultPrintLayoutId: childProfile?.defaultPrintLayoutId,
        selectedPrintLayoutId: printLayoutId,
        usingDefault: !childProfile?.defaultPrintLayoutId,
      });
      const layoutDoc = await getDoc(doc(firestore, 'printLayouts', printLayoutId));
      const layout = layoutDoc.exists() ? (layoutDoc.data() as PrintLayout) : null;

      // Default dimensions: 8x8 inches at 300 DPI = 2400x2400 pixels (standard children's book size)
      const DEFAULT_IMAGE_WIDTH_PX = 2400;
      const DEFAULT_IMAGE_HEIGHT_PX = 2400;

      let imageWidthPx: number = DEFAULT_IMAGE_WIDTH_PX;
      let imageHeightPx: number = DEFAULT_IMAGE_HEIGHT_PX;

      if (layout) {
        const dimensions = calculateImageDimensions(layout);
        imageWidthPx = dimensions.widthPx;
        imageHeightPx = dimensions.heightPx;
      }

      // Create StoryBookOutput document
      const storybooksRef = collection(firestore, 'stories', storyId, 'storybooks');
      const newStorybook: Omit<StoryBookOutput, 'id'> = {
        storyId,
        childId,
        parentUid: story.parentUid,
        storyOutputTypeId,
        imageStyleId,
        imageStylePrompt: selectedStyle.stylePrompt,
        printLayoutId,
        imageWidthPx,
        imageHeightPx,
        pageGeneration: { status: 'idle' },
        imageGeneration: { status: 'idle' },
        title: story.metadata?.title,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      };

      const docRef = await addDoc(storybooksRef, newStorybook);

      const outputType = outputTypes?.find((t) => t.id === storyOutputTypeId);
      toast({
        title: 'Creating Your Book!',
        description: `Making a ${outputType?.childFacingLabel || 'book'} with ${selectedStyle.title} pictures...`,
      });

      // Navigate to the unified progress page
      router.push(`/child/${childId}/book/${docRef.id}/generating?storyId=${storyId}`);
    } catch (error: any) {
      toast({
        title: 'Error',
        description: error.message || 'Failed to create book',
        variant: 'destructive',
      });
      setIsCreating(false);
    }
  };

  const isLoading = userLoading || storyLoading || childLoading || outputTypesLoading || imageStylesLoading || activeChildProfileLoading;

  if (isLoading) {
    return (
      <div className="flex h-screen w-screen flex-col items-center justify-center gap-4">
        <LoaderCircle className="h-12 w-12 animate-spin text-primary" />
        <p className="text-muted-foreground">Loading...</p>
      </div>
    );
  }

  if (!story) {
    return (
      <div className="container mx-auto px-4 py-16 text-center space-y-4">
        <h2 className="text-2xl font-semibold">Story not found</h2>
        <p className="text-muted-foreground">We couldn't find that story.</p>
        <Button asChild>
          <Link href={`/child/${childId}/stories`}>Back to My Stories</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-primary/10 to-background py-10">
      <div className="container mx-auto px-4 max-w-4xl space-y-8">
        {/* Header */}
        <div className="flex items-center gap-4">
          <Button asChild variant="ghost" size="icon">
            <Link href={`/child/${childId}/stories`}>
              <ArrowLeft className="h-5 w-5" />
            </Link>
          </Button>
          <div>
            <h1 className="text-3xl font-headline">Create Your Book!</h1>
            <p className="text-muted-foreground">
              {story.metadata?.title || 'Your story'}
            </p>
          </div>
        </div>

        {/* Step 1: Choose Book Type */}
        <Card>
          <CardHeader>
            <CardTitle className="text-xl flex items-center gap-2">
              Step 1: Choose Your Book Type
              {storyMetadataOutputTypeId && storyOutputTypeId === storyMetadataOutputTypeId && (
                <Check className="h-5 w-5 text-green-600" />
              )}
            </CardTitle>
            <CardDescription>
              {storyMetadataOutputTypeId
                ? "Your book type from the story (you can change it if you like)"
                : "What kind of book do you want to make?"}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Select value={storyOutputTypeId} onValueChange={setStoryOutputTypeId}>
              <SelectTrigger className="w-full text-lg h-12">
                <SelectValue placeholder="Select a book type..." />
              </SelectTrigger>
              <SelectContent>
                {outputTypes?.map((type) => (
                  <SelectItem key={type.id} value={type.id} className="text-base py-3">
                    <div>
                      <span className="font-medium">{type.childFacingLabel}</span>
                      {type.shortDescription && (
                        <span className="text-muted-foreground ml-2">
                          - {type.shortDescription}
                        </span>
                      )}
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </CardContent>
        </Card>

        {/* Step 2: Choose Art Style */}
        <Card>
          <CardHeader>
            <CardTitle className="text-xl">Step 2: Pick Your Art Style!</CardTitle>
            <CardDescription>Tap the picture style you like best</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Style Grid */}
            <div className="flex flex-wrap justify-center gap-6">
              {stylesToShow?.map((style) => {
                const isSelected = imageStyleId === style.id;
                const isOtherStyle = !isStyleAppropriateForAge(style, childAge);

                return (
                  <button
                    key={style.id}
                    onClick={() => setImageStyleId(style.id)}
                    disabled={isCreating}
                    className={cn(
                      'group relative flex flex-col items-center gap-2 transition-all',
                      'hover:scale-105 active:scale-95',
                      isOtherStyle && 'opacity-60'
                    )}
                  >
                    {/* Circular Image */}
                    <div
                      className={cn(
                        'relative w-28 h-28 rounded-full overflow-hidden border-4 transition-all',
                        'shadow-lg group-hover:shadow-xl',
                        isSelected
                          ? 'border-primary ring-4 ring-primary/30'
                          : isOtherStyle
                            ? 'border-muted group-hover:border-muted-foreground/50'
                            : 'border-primary/30 group-hover:border-primary/60'
                      )}
                    >
                      {style.sampleImageUrl ? (
                        <Image
                          src={style.sampleImageUrl}
                          alt={style.title}
                          fill
                          className="object-cover"
                        />
                      ) : (
                        <div className="w-full h-full bg-gradient-to-br from-primary/20 to-primary/5 flex items-center justify-center">
                          <span className="text-3xl">🎨</span>
                        </div>
                      )}

                      {/* Selection Indicator */}
                      {isSelected && (
                        <div className="absolute inset-0 bg-primary/30 flex items-center justify-center">
                          <div className="w-10 h-10 rounded-full bg-primary flex items-center justify-center">
                            <Check className="h-6 w-6 text-white" />
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Style Name */}
                    <p
                      className={cn(
                        'text-sm font-medium',
                        isOtherStyle ? 'text-muted-foreground' : 'text-foreground'
                      )}
                    >
                      {style.title}
                    </p>
                  </button>
                );
              })}
            </div>

            {/* Show More / Show Less */}
            {hasMoreStyles && (
              <div className="flex justify-center pt-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setShowAllStyles(!showAllStyles)}
                  className="gap-2"
                >
                  {showAllStyles ? (
                    <>
                      <ChevronUp className="h-4 w-4" />
                      Show fewer styles
                    </>
                  ) : (
                    <>
                      <ChevronDown className="h-4 w-4" />
                      Show {otherStyles.length} more
                    </>
                  )}
                </Button>
              </div>
            )}

            {(!stylesToShow || stylesToShow.length === 0) && (
              <p className="text-center text-muted-foreground">
                No art styles available right now.
              </p>
            )}
          </CardContent>
        </Card>

        {/* Create Button */}
        <Button
          size="lg"
          className="w-full h-14 text-lg"
          disabled={!storyOutputTypeId || !imageStyleId || isCreating}
          onClick={handleCreateBook}
        >
          {isCreating ? (
            <>
              <LoaderCircle className="mr-2 h-5 w-5 animate-spin" />
              Creating your book...
            </>
          ) : (
            <>
              <Wand2 className="mr-2 h-5 w-5" />
              Create My Book!
            </>
          )}
        </Button>
      </div>
    </div>
  );
}
