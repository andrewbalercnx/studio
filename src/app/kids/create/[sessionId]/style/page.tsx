'use client';

import { use, useState, useMemo, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useUser } from '@/firebase/auth/use-user';
import { useFirestore } from '@/firebase';
import { doc } from 'firebase/firestore';
import { useDocument } from '@/lib/firestore-hooks';
import { useKidsPWA } from '../../../layout';
import { useRequiredApiClient } from '@/contexts/api-client-context';
import type { ImageStyle, StorySession, Story, StoryOutputType, ChildProfile } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { LoaderCircle, ArrowLeft, Check, Palette, Book } from 'lucide-react';
import Link from 'next/link';
import Image from 'next/image';
import { cn } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';

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

type SelectionStep = 'book-type' | 'art-style';

export default function KidsStyleSelectionPage({ params }: { params: Promise<{ sessionId: string }> }) {
  const resolvedParams = use(params);
  const sessionId = resolvedParams.sessionId;
  const router = useRouter();
  const { user, loading: userLoading } = useUser();
  const firestore = useFirestore();
  const { childId, childProfile, isLocked } = useKidsPWA();
  const { toast } = useToast();
  const apiClient = useRequiredApiClient();

  const [step, setStep] = useState<SelectionStep>('book-type');
  const [selectedOutputTypeId, setSelectedOutputTypeId] = useState<string | null>(null);
  const [selectedStyleId, setSelectedStyleId] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // State for API-fetched data
  const [outputTypes, setOutputTypes] = useState<StoryOutputType[]>([]);
  const [imageStylesRaw, setImageStylesRaw] = useState<ImageStyle[]>([]);
  const [apiLoading, setApiLoading] = useState(true);

  // Load session
  const sessionRef = useMemo(
    () => (firestore ? doc(firestore, 'storySessions', sessionId) : null),
    [firestore, sessionId]
  );
  const { data: session, loading: sessionLoading } = useDocument<StorySession>(sessionRef);

  // Load story
  const storyRef = useMemo(
    () => (firestore ? doc(firestore, 'stories', sessionId) : null),
    [firestore, sessionId]
  );
  const { data: story, loading: storyLoading } = useDocument<Story>(storyRef);

  // Calculate child's age
  const childAge = useMemo(() => getChildAgeYears(childProfile), [childProfile]);

  // Load output types and image styles via API
  useEffect(() => {
    if (!apiClient) return;

    setApiLoading(true);
    Promise.all([apiClient.getOutputTypes(), apiClient.getImageStyles()])
      .then(([ot, is]) => {
        // Filter output types to only show 'live' status
        // Cast to local types (API types don't include timestamp fields)
        setOutputTypes(ot.filter((t) => t.status === 'live') as unknown as StoryOutputType[]);
        setImageStylesRaw(is as unknown as ImageStyle[]);
      })
      .catch((err) => {
        console.error('[KidsStyle] Error loading output types/styles:', err);
        toast({
          title: 'Error',
          description: 'Failed to load book options',
          variant: 'destructive',
        });
      })
      .finally(() => setApiLoading(false));
  }, [apiClient, toast]);

  // Sort image styles: preferred first, then alphabetically by title
  const imageStyles = useMemo(() => {
    if (!imageStylesRaw) return [];
    return [...imageStylesRaw].sort((a, b) => {
      // Preferred styles come first
      const aPreferred = a.preferred ? 1 : 0;
      const bPreferred = b.preferred ? 1 : 0;
      if (aPreferred !== bPreferred) return bPreferred - aPreferred;
      // Then sort alphabetically by title
      return (a.title || '').localeCompare(b.title || '');
    });
  }, [imageStylesRaw]);

  // Filter styles based on age
  const ageAppropriateStyles = useMemo(() => {
    if (!imageStyles) return [];
    return imageStyles.filter((style) => isStyleAppropriateForAge(style, childAge));
  }, [imageStyles, childAge]);

  // Redirect if not set up
  useEffect(() => {
    if (!userLoading && (!user || !isLocked || !childId)) {
      router.replace('/kids');
    }
  }, [userLoading, user, isLocked, childId, router]);

  // Handle output type selection
  const handleSelectOutputType = (outputType: StoryOutputType) => {
    setSelectedOutputTypeId(outputType.id);
    setStep('art-style');
  };

  // Handle style selection and start generation
  const handleSelectStyle = async (imageStyle: ImageStyle) => {
    if (!apiClient || !story || !selectedOutputTypeId || isSubmitting) return;

    setSelectedStyleId(imageStyle.id);
    setIsSubmitting(true);

    try {
      // Get the selected output type for display name
      const outputType = outputTypes?.find((t) => t.id === selectedOutputTypeId);

      // Create storybook via API - server handles print layout lookup and dimension calculation
      const storybookId = await apiClient.createStorybook(
        sessionId,
        selectedOutputTypeId,
        imageStyle.id,
        imageStyle.stylePrompt
      );

      toast({
        title: 'Creating Your Book!',
        description: `Making a ${outputType?.childFacingLabel || 'book'} with ${imageStyle.title} pictures...`,
      });

      // Redirect to generating page with storybookId
      router.push(`/kids/create/${sessionId}/generating?storybookId=${storybookId}`);
    } catch (err: any) {
      console.error('[KidsStyle] Error creating storybook:', err);
      toast({
        title: 'Error',
        description: err.message || 'Failed to create your book',
        variant: 'destructive',
      });
      setIsSubmitting(false);
      setSelectedStyleId(null);
    }
  };

  // Loading state
  if (userLoading || sessionLoading || storyLoading || apiLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <LoaderCircle className="h-12 w-12 animate-spin text-amber-500" />
      </div>
    );
  }

  // Error state
  if (!session || !story) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <Card className="w-full max-w-sm text-center">
          <CardContent className="pt-6">
            <p className="text-muted-foreground">Story not found</p>
            <Button asChild className="mt-4">
              <Link href="/kids">Go Home</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Book type selection step
  if (step === 'book-type') {
    return (
      <div className="min-h-screen flex flex-col">
        {/* Header */}
        <header className="px-4 py-4 flex items-center gap-2">
          <Link href="/kids">
            <Button variant="ghost" size="icon" className="text-amber-700">
              <ArrowLeft className="h-5 w-5" />
            </Button>
          </Link>
          <div className="flex-1 text-center">
            <p className="text-sm text-amber-700">Step 1 of 2</p>
          </div>
          <div className="w-10" />
        </header>

        {/* Main content */}
        <main className="flex-1 px-4 pb-8">
          <div className="max-w-md mx-auto space-y-6">
            <div className="text-center space-y-2">
              <div className="text-5xl mb-2">
                <Book className="h-12 w-12 mx-auto text-amber-600" />
              </div>
              <h1 className="text-2xl font-bold text-amber-900">
                Choose Your Book Type
              </h1>
              <p className="text-amber-700">
                How would you like your story to look?
              </p>
            </div>

            <div className="space-y-3">
              {outputTypes?.map((outputType) => (
                <button
                  key={outputType.id}
                  onClick={() => handleSelectOutputType(outputType)}
                  className="w-full text-left"
                >
                  <Card
                    className={cn(
                      'border-2 transition-all hover:shadow-lg active:scale-98',
                      'border-amber-200 hover:border-amber-400 bg-white'
                    )}
                  >
                    <CardContent className="p-5">
                      <h3 className="text-lg font-bold text-gray-900">
                        {outputType.childFacingLabel}
                      </h3>
                      <p className="text-sm text-gray-600 mt-1">
                        {outputType.shortDescription}
                      </p>
                      {outputType.layoutHints?.pageCount && (
                        <p className="text-xs text-amber-600 mt-2">
                          About {outputType.layoutHints.pageCount} pages
                        </p>
                      )}
                    </CardContent>
                  </Card>
                </button>
              ))}
            </div>

            {(!outputTypes || outputTypes.length === 0) && (
              <Card className="border-dashed">
                <CardContent className="py-8 text-center">
                  <p className="text-muted-foreground">
                    No book types available right now.
                  </p>
                </CardContent>
              </Card>
            )}
          </div>
        </main>
      </div>
    );
  }

  // Art style selection step
  return (
    <div className="min-h-screen flex flex-col">
      {/* Header */}
      <header className="px-4 py-4 flex items-center gap-2">
        <Button
          variant="ghost"
          size="icon"
          className="text-amber-700"
          onClick={() => setStep('book-type')}
        >
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div className="flex-1 text-center">
          <p className="text-sm text-amber-700">Step 2 of 2</p>
        </div>
        <div className="w-10" />
      </header>

      {/* Main content */}
      <main className="flex-1 px-4 pb-8">
        <div className="max-w-lg mx-auto space-y-6">
          <div className="text-center space-y-2">
            <div className="text-5xl mb-2">
              <Palette className="h-12 w-12 mx-auto text-amber-600" />
            </div>
            <h1 className="text-2xl font-bold text-amber-900">
              Pick Your Art Style
            </h1>
            <p className="text-amber-700">
              Tap the picture you like best!
            </p>
          </div>

          <div className="grid grid-cols-2 gap-4">
            {ageAppropriateStyles?.map((imageStyle) => (
              <button
                key={imageStyle.id}
                onClick={() => handleSelectStyle(imageStyle)}
                disabled={isSubmitting}
                className={cn(
                  'relative flex flex-col items-center gap-2 transition-all',
                  'hover:scale-105 active:scale-95',
                  isSubmitting && selectedStyleId !== imageStyle.id && 'opacity-50'
                )}
              >
                {/* Circular Image */}
                <div
                  className={cn(
                    'relative w-28 h-28 rounded-full overflow-hidden border-4 transition-all shadow-lg',
                    selectedStyleId === imageStyle.id
                      ? 'border-amber-500 ring-4 ring-amber-300'
                      : 'border-amber-200 hover:border-amber-400'
                  )}
                >
                  {imageStyle.sampleImageUrl ? (
                    <Image
                      src={imageStyle.sampleImageUrl}
                      alt={imageStyle.title}
                      fill
                      className="object-cover"
                    />
                  ) : (
                    <div className="w-full h-full bg-gradient-to-br from-amber-100 to-orange-100 flex items-center justify-center">
                      <span className="text-3xl">🎨</span>
                    </div>
                  )}

                  {/* Selection indicator */}
                  {selectedStyleId === imageStyle.id && (
                    <div className="absolute inset-0 bg-amber-500/30 flex items-center justify-center">
                      {isSubmitting ? (
                        <LoaderCircle className="h-10 w-10 animate-spin text-white drop-shadow-lg" />
                      ) : (
                        <div className="w-12 h-12 rounded-full bg-amber-500 flex items-center justify-center">
                          <Check className="h-8 w-8 text-white" />
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* Style name */}
                <p className="text-sm font-semibold text-gray-800 text-center">
                  {imageStyle.title}
                </p>
              </button>
            ))}
          </div>

          {(!ageAppropriateStyles || ageAppropriateStyles.length === 0) && (
            <Card className="border-dashed">
              <CardContent className="py-8 text-center">
                <p className="text-muted-foreground">
                  No art styles available right now.
                </p>
              </CardContent>
            </Card>
          )}
        </div>
      </main>
    </div>
  );
}
