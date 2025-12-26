'use client';

import { use, useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { useFirestore } from '@/firebase';
import { collection, query, orderBy, doc, setDoc, serverTimestamp } from 'firebase/firestore';
import { useCollection, useDocument } from '@/lib/firestore-hooks';
import type { ImageStyle, StorySession, Story, ChildProfile } from '@/lib/types';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { LoaderCircle, Check, ChevronDown, ChevronUp } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import Image from 'next/image';
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
  if (childAge === null) return true; // If no age, show all

  const minAge = style.ageFrom ?? 0; // 0, null, undefined all mean no minimum
  const maxAge = style.ageTo; // null or undefined means no maximum

  if (childAge < minAge) return false;
  if (maxAge !== null && maxAge !== undefined && maxAge !== 0 && childAge > maxAge) return false;

  return true;
}

export default function SelectImageStylePage({ params }: { params: Promise<{ sessionId: string }> }) {
  const resolvedParams = use(params);
  const sessionId = resolvedParams.sessionId;
  const router = useRouter();
  const firestore = useFirestore();
  const { toast } = useToast();
  const [selectedStyleId, setSelectedStyleId] = useState<string | null>(null);
  const [isSelecting, setIsSelecting] = useState(false);
  const [showAllStyles, setShowAllStyles] = useState(false);

  // Load session
  const sessionRef = useMemo(() => (firestore ? doc(firestore, 'storySessions', sessionId) : null), [firestore, sessionId]);
  const { data: session, loading: sessionLoading } = useDocument<StorySession>(sessionRef);

  // Load story
  const storyRef = useMemo(() => (firestore ? doc(firestore, 'stories', sessionId) : null), [firestore, sessionId]);
  const { data: story, loading: storyLoading } = useDocument<Story>(storyRef);

  // Load child profile to get age
  const childRef = useMemo(() => (firestore && session?.childId ? doc(firestore, 'children', session.childId) : null), [firestore, session?.childId]);
  const { data: childProfile, loading: childLoading } = useDocument<ChildProfile>(childRef);

  // Calculate child's age
  const childAge = useMemo(() => getChildAgeYears(childProfile), [childProfile]);

  // Load available image styles
  const imageStylesQuery = useMemo(() => {
    if (!firestore) return null;
    return query(collection(firestore, 'imageStyles'), orderBy('title', 'asc'));
  }, [firestore]);

  const { data: imageStyles, loading: imageStylesLoading } = useCollection<ImageStyle>(imageStylesQuery);

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

  // Styles to display based on whether "show more" is toggled
  const stylesToShow = showAllStyles ? imageStyles : ageAppropriateStyles;
  const hasMoreStyles = otherStyles.length > 0;

  const handleSelectImageStyle = async (imageStyle: ImageStyle) => {
    if (!storyRef || !story || isSelecting) return;

    setSelectedStyleId(imageStyle.id);
    setIsSelecting(true);
    try {
      // Store the selected image style in the story document
      await setDoc(
        storyRef,
        {
          selectedImageStyleId: imageStyle.id,
          selectedImageStylePrompt: imageStyle.stylePrompt,
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );

      toast({
        title: 'Art Style Selected!',
        description: `Creating pictures in ${imageStyle.title} style...`,
      });

      // Redirect to the generating page to show progress
      router.push(`/story/session/${sessionId}/generating`);
    } catch (error: any) {
      toast({
        title: 'Error',
        description: error.message || 'Failed to select art style',
        variant: 'destructive',
      });
      setIsSelecting(false);
      setSelectedStyleId(null);
    }
  };

  if (sessionLoading || storyLoading || imageStylesLoading || childLoading) {
    return (
      <div className="flex h-screen w-screen flex-col items-center justify-center gap-4">
        <LoaderCircle className="h-12 w-12 animate-spin text-primary" />
        <p className="text-muted-foreground">Loading art styles...</p>
      </div>
    );
  }

  if (!session || !story) {
    return (
      <div className="container mx-auto flex min-h-screen items-center justify-center p-4">
        <Card className="w-full max-w-md text-center">
          <CardContent className="pt-6">
            <p className="text-muted-foreground">Story not found</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-primary/10 to-background py-10">
      <div className="container mx-auto px-4 max-w-5xl space-y-12">
        <div className="text-center space-y-3">
          <h1 className="text-5xl font-headline text-primary">Pick Your Art Style!</h1>
          <p className="text-xl text-muted-foreground">Tap the picture you like best</p>
        </div>

        <div className="flex flex-wrap justify-center gap-8">
          {stylesToShow?.map((imageStyle) => {
            const isOtherStyle = !isStyleAppropriateForAge(imageStyle, childAge);
            return (
              <button
                key={imageStyle.id}
                onClick={() => handleSelectImageStyle(imageStyle)}
                disabled={isSelecting}
                className={cn(
                  "group relative flex flex-col items-center gap-3 transition-all",
                  "hover:scale-105 active:scale-95",
                  isSelecting && selectedStyleId !== imageStyle.id && "opacity-50",
                  isOtherStyle && "opacity-60"
                )}
              >
                {/* Circular Image */}
                <div
                  className={cn(
                    "relative w-40 h-40 rounded-full overflow-hidden border-4 transition-all",
                    "shadow-lg group-hover:shadow-2xl",
                    selectedStyleId === imageStyle.id
                      ? "border-primary ring-4 ring-primary/30"
                      : isOtherStyle
                        ? "border-muted group-hover:border-muted-foreground/50"
                        : "border-primary/30 group-hover:border-primary/60"
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
                    <div className="w-full h-full bg-gradient-to-br from-primary/20 to-primary/5 flex items-center justify-center">
                      <span className="text-4xl">🎨</span>
                    </div>
                  )}

                  {/* Selection Indicator */}
                  {selectedStyleId === imageStyle.id && (
                    <div className="absolute inset-0 bg-primary/20 flex items-center justify-center">
                      {isSelecting ? (
                        <LoaderCircle className="h-12 w-12 animate-spin text-white drop-shadow-lg" />
                      ) : (
                        <div className="w-16 h-16 rounded-full bg-primary flex items-center justify-center">
                          <Check className="h-10 w-10 text-white" />
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* Style Name */}
                <div className="text-center">
                  <p className={cn(
                    "text-lg font-semibold",
                    isOtherStyle ? "text-muted-foreground" : "text-foreground"
                  )}>
                    {imageStyle.title}
                  </p>
                </div>
              </button>
            );
          })}
        </div>

        {/* Show More / Show Less button */}
        {hasMoreStyles && (
          <div className="flex justify-center pt-4">
            <Button
              variant="ghost"
              size="lg"
              onClick={() => setShowAllStyles(!showAllStyles)}
              className="gap-2"
            >
              {showAllStyles ? (
                <>
                  <ChevronUp className="h-5 w-5" />
                  Show fewer styles
                </>
              ) : (
                <>
                  <ChevronDown className="h-5 w-5" />
                  Show {otherStyles.length} more style{otherStyles.length !== 1 ? 's' : ''}
                </>
              )}
            </Button>
          </div>
        )}

        {(!stylesToShow || stylesToShow.length === 0) && (
          <Card className="border-dashed">
            <CardContent className="flex flex-col items-center gap-4 py-10 text-center">
              <p className="text-muted-foreground">No art styles are available right now. Please check back later!</p>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
