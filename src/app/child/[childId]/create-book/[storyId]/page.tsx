'use client';

import { use, useState, useMemo, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useFirestore } from '@/firebase';
import { useUser } from '@/firebase/auth/use-user';
import {
  collection,
  query,
  where,
  doc,
  addDoc,
  getDoc,
  serverTimestamp,
} from 'firebase/firestore';
import { useCollection, useDocument } from '@/lib/firestore-hooks';
import type { Story, StoryOutputType, ImageStyle, ChildProfile, PrintLayout, StoryBookOutput } from '@/lib/types';
import { useAppContext } from '@/hooks/use-app-context';
import { Button } from '@/components/ui/button';
import { LoaderCircle, ArrowLeft, Wand2, Check, ChevronDown, ChevronUp, Book } from 'lucide-react';
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

type Step = 'output-type' | 'image-style';

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

  const [currentStep, setCurrentStep] = useState<Step>('output-type');
  const [storyOutputTypeId, setStoryOutputTypeId] = useState('');
  const [imageStyleId, setImageStyleId] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [showAllStyles, setShowAllStyles] = useState(false);
  const [hoveredStyleId, setHoveredStyleId] = useState<string | null>(null);

  // Load story (only when authenticated and auth token is ready)
  const storyRef = useMemo(
    () => (firestore && user && !userLoading && idTokenResult ? doc(firestore, 'stories', storyId) : null),
    [firestore, storyId, user, userLoading, idTokenResult]
  );
  const { data: story, loading: storyLoading } = useDocument<Story>(storyRef);

  // Pre-populate storyOutputTypeId from story metadata if available
  // But always show the output type selection step so the user can choose
  const storyMetadataOutputTypeId = story?.metadata?.storyOutputTypeId as string | undefined;
  useEffect(() => {
    if (storyMetadataOutputTypeId && !storyOutputTypeId) {
      setStoryOutputTypeId(storyMetadataOutputTypeId);
      // Don't skip to step 2 - let the user confirm or change the output type selection
    }
  }, [storyMetadataOutputTypeId, storyOutputTypeId]);

  // Load child profile for age filtering
  const childRef = useMemo(
    () => (firestore && user && !userLoading && idTokenResult ? doc(firestore, 'children', childId) : null),
    [firestore, childId, user, userLoading, idTokenResult]
  );
  const { data: childProfile, loading: childLoading } = useDocument<ChildProfile>(childRef);

  // Calculate child's age for filtering
  const childAge = useMemo(() => getChildAgeYears(childProfile || activeChildProfile), [childProfile, activeChildProfile]);

  // Load story output types (live only)
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

  // Load image styles
  const imageStylesQuery = useMemo(() => {
    if (!firestore || !user || userLoading || !idTokenResult) return null;
    return query(collection(firestore, 'imageStyles'));
  }, [firestore, user, userLoading, idTokenResult]);
  const { data: imageStylesRaw, loading: imageStylesLoading } = useCollection<ImageStyle>(imageStylesQuery);

  // Sort image styles: preferred first, then alphabetically by title
  const imageStyles = useMemo(() => {
    if (!imageStylesRaw) return null;
    return [...imageStylesRaw].sort((a, b) => {
      // Preferred styles come first
      const aPreferred = a.preferred ? 1 : 0;
      const bPreferred = b.preferred ? 1 : 0;
      if (aPreferred !== bPreferred) return bPreferred - aPreferred;
      // Then sort alphabetically by title
      return (a.title || '').localeCompare(b.title || '');
    });
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

  // Get selected output type for display
  const selectedOutputType = outputTypes?.find((t) => t.id === storyOutputTypeId);

  // Handle output type selection - auto-advance to next step
  const handleSelectOutputType = (typeId: string) => {
    setStoryOutputTypeId(typeId);
    setCurrentStep('image-style');
  };

  // Handle image style selection - auto-create book
  const handleSelectImageStyle = async (styleId: string) => {
    setImageStyleId(styleId);
    // Create book immediately after selection
    await createBook(styleId);
  };

  // Handle book creation
  const createBook = async (selectedImageStyleId: string) => {
    if (!firestore || !story || !storyOutputTypeId || !selectedImageStyleId) {
      toast({
        title: 'Missing Selection',
        description: 'Please select both a book type and art style.',
        variant: 'destructive',
      });
      return;
    }

    const selectedStyle = imageStyles?.find((s) => s.id === selectedImageStyleId);
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
      // Get the selected output type to check for default print layout
      const outputType = outputTypes?.find((t) => t.id === storyOutputTypeId);

      // Use print layout from storyOutputType if specified, otherwise unconstrained
      const printLayoutId = outputType?.defaultPrintLayoutId || undefined;

      // Default dimensions: 8x8 inches at 300 DPI = 2400x2400 pixels (unconstrained square)
      const DEFAULT_IMAGE_WIDTH_PX = 2400;
      const DEFAULT_IMAGE_HEIGHT_PX = 2400;

      let imageWidthPx: number = DEFAULT_IMAGE_WIDTH_PX;
      let imageHeightPx: number = DEFAULT_IMAGE_HEIGHT_PX;

      // Only calculate dimensions from layout if a print layout is specified
      if (printLayoutId) {
        const layoutDoc = await getDoc(doc(firestore, 'printLayouts', printLayoutId));
        const layout = layoutDoc.exists() ? (layoutDoc.data() as PrintLayout) : null;
        if (layout) {
          const dimensions = calculateImageDimensions(layout);
          imageWidthPx = dimensions.widthPx;
          imageHeightPx = dimensions.heightPx;
        }
      }

      // Create StoryBookOutput document
      const storybooksRef = collection(firestore, 'stories', storyId, 'storybooks');
      const newStorybook: Omit<StoryBookOutput, 'id'> = {
        storyId,
        childId,
        parentUid: story.parentUid,
        storyOutputTypeId,
        imageStyleId: selectedImageStyleId,
        imageStylePrompt: selectedStyle.stylePrompt,
        printLayoutId: printLayoutId || null,
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
        <p className="text-muted-foreground">We couldn&apos;t find that story.</p>
        <Button asChild>
          <Link href={`/child/${childId}/stories`}>Back to My Stories</Link>
        </Button>
      </div>
    );
  }

  // Step 1: Choose Output Type (card-based)
  if (currentStep === 'output-type') {
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
              <h1 className="text-3xl font-headline">What kind of book?</h1>
              <p className="text-muted-foreground">
                {story.metadata?.title || 'Your story'}
              </p>
            </div>
          </div>

          {/* Output Type Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
            {outputTypes?.map((type) => (
              <button
                key={type.id}
                onClick={() => handleSelectOutputType(type.id)}
                className={cn(
                  'group relative flex flex-col items-center p-6 rounded-2xl border-4 transition-all',
                  'bg-card hover:bg-accent/50',
                  'hover:scale-[1.02] active:scale-[0.98]',
                  'shadow-lg hover:shadow-xl',
                  storyOutputTypeId === type.id
                    ? 'border-primary ring-4 ring-primary/30'
                    : 'border-primary/20 hover:border-primary/50'
                )}
              >
                {/* Image */}
                <div className="relative w-32 h-32 rounded-xl overflow-hidden mb-4">
                  {type.imageUrl ? (
                    <Image
                      src={type.imageUrl}
                      alt={type.childFacingLabel}
                      fill
                      className="object-cover"
                    />
                  ) : (
                    <div className="w-full h-full bg-gradient-to-br from-primary/30 to-primary/10 flex items-center justify-center">
                      <Book className="h-12 w-12 text-primary/50" />
                    </div>
                  )}
                </div>

                {/* Label */}
                <h3 className="text-xl font-headline text-center mb-2">
                  {type.childFacingLabel}
                </h3>

                {/* Description */}
                {type.shortDescription && (
                  <p className="text-sm text-muted-foreground text-center">
                    {type.shortDescription}
                  </p>
                )}

                {/* Selection indicator */}
                {storyOutputTypeId === type.id && (
                  <div className="absolute top-3 right-3 w-8 h-8 rounded-full bg-primary flex items-center justify-center">
                    <Check className="h-5 w-5 text-white" />
                  </div>
                )}
              </button>
            ))}
          </div>

          {(!outputTypes || outputTypes.length === 0) && (
            <p className="text-center text-muted-foreground py-8">
              No book types available right now.
            </p>
          )}
        </div>
      </div>
    );
  }

  // Step 2: Choose Image Style
  return (
    <div className="min-h-screen bg-gradient-to-b from-primary/10 to-background py-10">
      <div className="container mx-auto px-4 max-w-4xl space-y-8">
        {/* Header with back button */}
        <div className="flex items-center gap-4">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setCurrentStep('output-type')}
          >
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div>
            <h1 className="text-3xl font-headline">Pick Your Art Style!</h1>
            <p className="text-muted-foreground">
              Making: {selectedOutputType?.childFacingLabel || 'book'}
            </p>
          </div>
        </div>

        {/* Image Style Grid */}
        <div className="relative">
          <div className="flex flex-wrap justify-center gap-6">
            {stylesToShow?.map((style) => {
              const isSelected = imageStyleId === style.id;
              const isOtherStyle = !isStyleAppropriateForAge(style, childAge);
              const isHovered = hoveredStyleId === style.id;

              return (
                <div key={style.id} className="relative">
                  <button
                    onClick={() => handleSelectImageStyle(style.id)}
                    onMouseEnter={() => setHoveredStyleId(style.id)}
                    onMouseLeave={() => setHoveredStyleId(null)}
                    disabled={isCreating}
                    className={cn(
                      'group relative flex flex-col items-center gap-2 transition-all',
                      'hover:scale-105 active:scale-95',
                      isOtherStyle && 'opacity-60',
                      isCreating && 'pointer-events-none'
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

                  {/* Expanded image on hover */}
                  {isHovered && style.sampleImageUrl && !isCreating && (
                    <div
                      className="absolute z-50 pointer-events-none"
                      style={{
                        top: '-120px',
                        left: '50%',
                        transform: 'translateX(-50%)',
                      }}
                    >
                      <div className="relative w-64 h-64 rounded-xl overflow-hidden shadow-2xl border-4 border-white animate-in fade-in zoom-in-95 duration-200">
                        <Image
                          src={style.sampleImageUrl}
                          alt={style.title}
                          fill
                          className="object-cover"
                        />
                      </div>
                      <div className="absolute -bottom-2 left-1/2 transform -translate-x-1/2 w-4 h-4 bg-white rotate-45 border-r border-b border-gray-200" />
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Show More / Show Less */}
          {hasMoreStyles && (
            <div className="flex justify-center pt-6">
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
        </div>

        {/* Creating indicator */}
        {isCreating && (
          <div className="fixed inset-0 bg-background/80 backdrop-blur-sm flex items-center justify-center z-50">
            <div className="flex flex-col items-center gap-4 p-8 rounded-2xl bg-card shadow-xl border">
              <LoaderCircle className="h-12 w-12 animate-spin text-primary" />
              <div className="text-center">
                <p className="text-xl font-headline">Creating your book...</p>
                <p className="text-muted-foreground">This will just take a moment</p>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
