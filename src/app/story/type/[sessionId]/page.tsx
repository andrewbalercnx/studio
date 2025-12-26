
'use client';

import { useState, useEffect, useMemo } from 'react';
import { useParams } from 'next/navigation';
import { useUser } from '@/firebase/auth/use-user';
import { useFirestore } from '@/firebase';
import { doc, collection, query, where, updateDoc, serverTimestamp } from 'firebase/firestore';
import { useDocument, useCollection } from '@/lib/firestore-hooks';
import type { StorySession, StoryType, ChildProfile } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { LoaderCircle, CheckCircle, Copy } from 'lucide-react';
import Link from 'next/link';
import { useToast } from '@/hooks/use-toast';
import { Badge } from '@/components/ui/badge';

function getChildAgeYears(child?: ChildProfile | null): number | null {
    const dob = child?.dateOfBirth?.toDate?.() ?? (child?.dateOfBirth ? new Date(child.dateOfBirth) : null);
    if (!dob) return null;
    const diff = Date.now() - dob.getTime();
    if (diff <= 0) return null;
    return Math.floor(diff / (1000 * 60 * 60 * 24 * 365.25));
}

function matchesChildAge(storyType: StoryType, age: number | null): boolean {
    if (age === null) return true;

    // Use new ageFrom/ageTo fields if available
    if (storyType.ageFrom !== undefined || storyType.ageTo !== undefined) {
        const minAge = storyType.ageFrom ?? 0;
        const maxAge = storyType.ageTo ?? 100;
        return age >= minAge && age <= maxAge;
    }

    // Fallback to legacy ageRange string parsing
    const ageRange = storyType.ageRange || '';
    const rangeMatch = ageRange.match(/(\d+)\s*-\s*(\d+)/);
    if (rangeMatch) {
        const min = parseInt(rangeMatch[1], 10);
        const max = parseInt(rangeMatch[2], 10);
        return age >= min && age <= max;
    }
    const plusMatch = ageRange.match(/(\d+)\s*\+/);
    if (plusMatch) {
        const min = parseInt(plusMatch[1], 10);
        return age >= min;
    }
    return true;
}

function formatAgeRange(storyType: StoryType): string {
    const { ageFrom, ageTo, ageRange } = storyType;
    if (ageFrom !== undefined || ageTo !== undefined) {
        if (ageFrom != null && ageTo != null) {
            return `${ageFrom}-${ageTo}`;
        } else if (ageFrom != null) {
            return `${ageFrom}+`;
        } else if (ageTo != null) {
            return `up to ${ageTo}`;
        }
        return 'All ages';
    }
    return ageRange || 'All ages';
}

function shuffleArray<T>(array: T[]): T[] {
  const newArray = [...array];
  for (let i = newArray.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [newArray[i], newArray[j]] = [newArray[j], newArray[i]];
  }
  return newArray;
}

export default function StoryTypeSelectionPage() {
    const params = useParams<{ sessionId: string }>();
    const sessionId = params.sessionId;
    const { user, loading: userLoading } = useUser();
    const firestore = useFirestore();
    const { toast } = useToast();

    const [visibleOffset, setVisibleOffset] = useState(0);
    const [shuffledTypes, setShuffledTypes] = useState<StoryType[]>([]);
    const [selectionMade, setSelectionMade] = useState<string | null>(null);
    const pageSize = 4;

    const sessionRef = useMemo(() => firestore ? doc(firestore, 'storySessions', sessionId) : null, [firestore, sessionId]);
    const { data: session, loading: sessionLoading, error: sessionError } = useDocument<StorySession>(sessionRef);

    // Get child profile to filter story types by age
    const childRef = useMemo(() => firestore && session?.childId ? doc(firestore, 'children', session.childId) : null, [firestore, session?.childId]);
    const { data: childProfile } = useDocument<ChildProfile>(childRef);
    const childAge = useMemo(() => getChildAgeYears(childProfile), [childProfile]);

    const storyTypesQuery = useMemo(() => firestore ? query(collection(firestore, 'storyTypes'), where('status', '==', 'live')) : null, [firestore]);
    const { data: storyTypes, loading: typesLoading, error: typesError } = useCollection<StoryType>(storyTypesQuery);

    // Filter story types by child's age
    const ageFilteredTypes = useMemo(() => {
        if (!storyTypes) return [];
        return storyTypes.filter(type => matchesChildAge(type, childAge));
    }, [storyTypes, childAge]);

    useEffect(() => {
        if (ageFilteredTypes && ageFilteredTypes.length > 0 && shuffledTypes.length === 0) {
            setShuffledTypes(shuffleArray(ageFilteredTypes));
        }
    }, [ageFilteredTypes, shuffledTypes.length]);

    const handleMoreStories = () => {
        if (!ageFilteredTypes) return;
        const newOffset = visibleOffset + pageSize;
        if (newOffset >= ageFilteredTypes.length) {
            setVisibleOffset(0);
        } else {
            setVisibleOffset(newOffset);
        }
    };

    const handleSelectStoryType = async (storyType: StoryType) => {
        if (!sessionRef) return;
        try {
            await updateDoc(sessionRef, {
                storyTypeId: storyType.id,
                storyPhaseId: storyType.defaultPhaseId || 'story_beat_phase_v1',
                arcStepIndex: 0,
                storyTitle: session?.storyTitle || storyType.name, // Set title if not already set
                updatedAt: serverTimestamp(),
            });
            setSelectionMade(storyType.id);
            toast({
                title: 'Story Type Selected!',
                description: `Great choice! We’ll use the "${storyType.name}" story type.`,
            });
        } catch (e: any) {
            toast({
                title: 'Error updating session',
                description: e.message,
                variant: 'destructive',
            });
        }
    };
    
    const visibleStoryTypes = useMemo(() => {
        return shuffledTypes.slice(visibleOffset, visibleOffset + pageSize);
    }, [shuffledTypes, visibleOffset, pageSize]);

    const diagnostics = {
        page: "story-type-select",
        sessionId,
        auth: {
            isAuthenticated: !!user,
            email: user?.email || null,
        },
        firestore: {
            storyTypesTotal: storyTypes?.length || 0,
            liveStoryTypesCount: storyTypes?.length || 0,
            visibleStoryTypeIds: visibleStoryTypes.map(st => st.id),
            sessionHasStoryType: !!session?.storyTypeId,
            currentStoryTypeId: session?.storyTypeId || null,
            currentStoryPhaseId: session?.storyPhaseId || null,
            currentArcStepIndex: session?.arcStepIndex ?? null,
        },
        ui: {
            pageSize: 4,
            visibleOffset,
        },
        error: sessionError?.message || typesError?.message || null,
    };

    const handleCopyDiagnostics = () => {
        const textToCopy = `Page: story-type-select\n\nDiagnostics\n${JSON.stringify(diagnostics, null, 2)}`;
        navigator.clipboard.writeText(textToCopy);
        toast({ title: 'Copied to clipboard!' });
    };

    const renderContent = () => {
        if (userLoading || sessionLoading || typesLoading) {
            return <div className="flex items-center justify-center p-8"><LoaderCircle className="h-8 w-8 animate-spin text-primary" /></div>;
        }

        if (!user) {
            return (
                <div className="text-center p-8">
                    <p className="text-muted-foreground mb-4">Please sign in to choose a story type.</p>
                    <Button asChild><Link href="/login">Sign In</Link></Button>
                </div>
            );
        }
        
        if (sessionError || typesError) {
             return <p className="text-destructive text-center p-8">Error loading data. Please try again later.</p>;
        }

        if (!session) {
             return <p className="text-destructive text-center p-8">Could not find story session with ID: {sessionId}</p>;
        }

        if (selectionMade) {
            return (
                <div className="text-center p-8">
                    <CheckCircle className="h-12 w-12 text-green-500 mx-auto mb-4" />
                    <h2 className="text-2xl font-bold">Great choice!</h2>
                    <p className="text-muted-foreground">We’ll use this kind of story next.</p>
                     <Button asChild className="mt-6">
                        <Link href={`/story/session/${sessionId}`}>Back to Story Chat</Link>
                    </Button>
                </div>
            )
        }

        return (
            <>
                <CardHeader>
                    <CardTitle className="text-center text-3xl font-headline">Choose Your Kind of Story</CardTitle>
                </CardHeader>
                <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {visibleStoryTypes.map(st => (
                        <Card key={st.id} className="flex flex-col">
                             <CardHeader>
                                <CardTitle>{st.name}</CardTitle>
                                <CardDescription>Age: {formatAgeRange(st)}</CardDescription>
                             </CardHeader>
                            <CardContent className="flex-grow">
                                <p className="text-sm text-muted-foreground mb-4">{st.shortDescription}</p>
                                <div className="flex flex-wrap gap-2">
                                    {st.tags.map(tag => <Badge key={tag} variant="secondary">{tag}</Badge>)}
                                </div>
                            </CardContent>
                             <CardFooter>
                                <Button className="w-full" onClick={() => handleSelectStoryType(st)}>
                                    Choose this story
                                </Button>
                             </CardFooter>
                        </Card>
                    ))}
                </CardContent>
                <CardFooter className="justify-center">
                    <Button variant="outline" onClick={handleMoreStories}>More stories</Button>
                </CardFooter>
            </>
        )
    }

    return (
        <div className="container mx-auto p-4 sm:p-6 md:p-8 flex flex-col items-center gap-8">
            <Card className="w-full max-w-4xl">
               {renderContent()}
            </Card>
            <Card className="w-full max-w-4xl">
                <CardHeader className="flex flex-row items-center justify-between">
                    <CardTitle>Diagnostics</CardTitle>
                    <Button variant="ghost" size="icon" onClick={handleCopyDiagnostics}>
                        <Copy className="h-4 w-4" />
                    </Button>
                </CardHeader>
                <CardContent>
                    <pre className="bg-muted p-4 rounded-lg overflow-x-auto text-sm">
                        <code>{JSON.stringify(diagnostics, null, 2)}</code>
                    </pre>
                </CardContent>
            </Card>
        </div>
    );
}
