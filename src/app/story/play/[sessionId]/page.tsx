
'use client';

import { useState, useMemo, useEffect, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useUser } from '@/firebase/auth/use-user';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { LoaderCircle, Send, CheckCircle, RefreshCw, Sparkles, Star, Bot, Settings } from 'lucide-react';
import Link from 'next/link';
import { useFirestore } from '@/firebase';
import { doc, collection, addDoc, serverTimestamp, query, orderBy, updateDoc, writeBatch, getDocs, limit, arrayUnion, DocumentReference, getDoc, deleteField, increment, where } from 'firebase/firestore';
import type { StorySession, ChatMessage as Message, Choice, Character, StoryType, StoryBook, ChildProfile } from '@/lib/types';
import { Input } from '@/components/ui/input';
import { useCollection, useDocument } from '@/lib/firestore-hooks';
import { useToast } from '@/hooks/use-toast';
import { Badge } from '@/components/ui/badge';
import { logSessionEvent } from '@/lib/session-events';
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar';
import { ThinkingIndicator } from '@/components/child-thinking-indicator';

// Helper functions from the original session page
function getChildAgeYears(child?: ChildProfile | null): number | null {
    if (!child?.dateOfBirth) return null;
    let dob: Date | null = null;
    if (typeof child.dateOfBirth?.toDate === 'function') {
        dob = child.dateOfBirth.toDate();
    } else {
        const parsed = new Date(child.dateOfBirth);
        dob = isNaN(parsed.getTime()) ? null : parsed;
    }
    if (!dob) return null;
    const diff = Date.now() - dob.getTime();
    if (diff <= 0) return null;
    return Math.floor(diff / (1000 * 60 * 60 * 24 * 365.25));
}

function matchesAgeRange(ageRange: string, age: number | null): boolean {
    if (age === null) return true;
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

function buildPreferenceKeywords(child?: ChildProfile | null): string[] {
    if (!child?.preferences) return [];
    const values = [
        ...(child.preferences.favoriteColors ?? []),
        ...(child.preferences.favoriteFoods ?? []),
        ...(child.preferences.favoriteGames ?? []),
        ...(child.preferences.favoriteSubjects ?? []),
        ...(child.favouriteGenres ?? []),
        ...(child.favouriteCharacterTypes ?? []),
    ];
    return values.map((value) => value.toLowerCase());
}


export default function StoryPlayPage() {
    const params = useParams<{ sessionId: string }>();
    const sessionId = params.sessionId;
    const router = useRouter();
    const { user, loading: userLoading } = useUser();
    const firestore = useFirestore();
    const [input, setInput] = useState('');
    const [isSending, setIsSending] = useState(false);
    const { toast } = useToast();
    
    const [isProcessing, setIsProcessing] = useState(false);
    const [isSelectingStoryType, setIsSelectingStoryType] = useState(false);
    
    const sessionRef = useMemo(() => firestore ? doc(firestore, 'storySessions', sessionId) : null, [firestore, sessionId]);
    const { data: session, loading: sessionLoading, error: sessionError } = useDocument<StorySession>(sessionRef);
    const messagesQuery = useMemo(() => firestore ? query(collection(firestore, 'storySessions', sessionId, 'messages'), orderBy('createdAt', 'desc'), limit(5)) : null, [firestore, sessionId]);
    const { data: recentMessages, loading: messagesLoading, error: messagesError } = useCollection<Message>(messagesQuery);
    const childRef = useMemo(() => (session?.childId && firestore) ? doc(firestore, 'children', session.childId) : null, [firestore, session?.childId]);
    const { data: childProfile } = useDocument<ChildProfile>(childRef);
    const storyTypesQuery = useMemo(() => firestore ? query(collection(firestore, 'storyTypes'), where('status', '==', 'live')) : null, [firestore]);
    const { data: storyTypes } = useCollection<StoryType>(storyTypesQuery);
    const childAge = useMemo(() => getChildAgeYears(childProfile), [childProfile]);
    const preferenceKeywords = useMemo(() => buildPreferenceKeywords(childProfile), [childProfile]);
    const curatedStoryTypes = useMemo(() => {
        if (!storyTypes) return [];
        return storyTypes
            .map((type) => {
                const tagMatches = preferenceKeywords.reduce((score, keyword) => {
                    const matchesTag = type.tags?.some((tag) => tag.toLowerCase().includes(keyword));
                    return matchesTag ? score + 1 : score;
                }, 0);
                return { type, score: tagMatches, matchesAge: matchesAgeRange(type.ageRange || '', childAge) };
            })
            .filter(({ matchesAge }) => matchesAge)
            .sort((a, b) => b.score - a.score)
            .slice(0, 4)
            .map(({ type }) => type);
    }, [storyTypes, preferenceKeywords, childAge]);
    
    const activeStoryType = useMemo(() => {
        if (!storyTypes || !session?.storyTypeId) return null;
        return storyTypes.find((type) => type.id === session.storyTypeId) ?? null;
    }, [storyTypes, session?.storyTypeId]);

    const latestMessage = useMemo(() => {
        if (!recentMessages || recentMessages.length === 0) return null;
        return recentMessages[0];
    }, [recentMessages]);
    
    const logClientStage = useCallback(async (event: string, attributes: Record<string, unknown> = {}) => {
        if (!firestore) return;
        await logSessionEvent({ firestore, sessionId, event, status: 'info', source: 'client', attributes });
    }, [firestore, sessionId]);

    const runBeatAndAppendMessages = async () => {
        if (!firestore || !sessionRef) return;
        
        setIsProcessing(true);
        try {
            const currentSession = (await getDoc(sessionRef)).data() as StorySession;
            const updates: Record<string, any> = {};
            if (currentSession.currentPhase === 'warmup') updates.currentPhase = 'story';
            if (typeof currentSession.arcStepIndex !== 'number') updates.arcStepIndex = 0;
            if (Object.keys(updates).length > 0) {
                updates.updatedAt = serverTimestamp();
                await updateDoc(sessionRef, updates);
            }

            const response = await fetch('/api/storyBeat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ sessionId }),
            });
            const flowResult = await response.json();
            
            if (!response.ok || !flowResult.ok) throw new Error(flowResult.errorMessage || "An unknown API error occurred.");

            const { storyContinuation, options } = flowResult;
            const messagesRef = collection(firestore, 'storySessions', sessionId, 'messages');
            const batch = writeBatch(firestore);
            batch.set(doc(messagesRef), { sender: 'assistant', text: storyContinuation, kind: 'beat_continuation', createdAt: serverTimestamp() });
            batch.set(doc(messagesRef), { sender: 'assistant', text: "What happens next?", kind: 'beat_options', options: options, createdAt: serverTimestamp() });
            await batch.commit();

        } catch (e: any) {
            toast({ title: "Error running beat", description: e.message, variant: "destructive" });
        } finally {
             setIsProcessing(false);
        }
    };
    
    const runCharacterTraitsQuestion = async (sessionId: string, characterId: string, characterLabel: string) => {
        if (!firestore || !sessionRef) return false;
        try {
            const response = await fetch('/api/characterTraits', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ sessionId, characterId }),
            });
            const result = await response.json();
            if (!response.ok || !result.ok) throw new Error(result.errorMessage || "Failed to get character traits question.");

            const { question, suggestedTraits } = result;
            const messagesRef = collection(firestore, 'storySessions', sessionId, 'messages');
            await addDoc(messagesRef, { sender: 'assistant', text: question, kind: 'character_traits_question', createdAt: serverTimestamp() });
            const characterRef = doc(firestore, 'characters', characterId);
            await updateDoc(characterRef, { traits: suggestedTraits, traitsLastUpdatedAt: serverTimestamp() });
            await updateDoc(sessionRef, { pendingCharacterTraits: { characterId, characterLabel, questionText: question, askedAt: serverTimestamp() } });
            return true;
        } catch (e: any) {
            console.error("Error in runCharacterTraitsQuestion:", e);
            return false;
        }
    };

    const generateEndingChoices = useCallback(async () => {
        if (!firestore || !sessionRef) return;
        setIsProcessing(true);
        try {
            const response = await fetch('/api/storyEnding', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ sessionId }),
            });
            const result = await response.json();
            if (!response.ok || !result.ok) throw new Error(result.errorMessage || 'An unknown error occurred in ending flow.');

            const endings: Choice[] = result.endings.map((ending: { id: string; text: string }) => ({ id: ending.id, text: ending.text }));
            const messagesRef = collection(firestore, 'storySessions', sessionId, 'messages');
            const batch = writeBatch(firestore);
            batch.set(doc(messagesRef), { sender: 'assistant', text: "Which ending do you like best?", kind: 'ending_options', options: endings, createdAt: serverTimestamp() });
            batch.update(sessionRef, { currentPhase: 'ending', updatedAt: serverTimestamp(), 'progress.storyArcCompletedAt': serverTimestamp() });
            await batch.commit();
            await logClientStage('ending.presented', { endings: endings.length });
        } catch (e: any) {
            toast({ title: 'Error running ending flow', description: e.message, variant: 'destructive' });
        } finally {
            setIsProcessing(false);
        }
    }, [firestore, sessionRef, sessionId, toast, logClientStage]);

    const handleSendMessage = async () => {
        if (!input.trim() || !firestore || !user || !sessionRef) return;

        setIsProcessing(true);
        const childMessageText = input.trim();
        setInput('');

        const messagesRef = collection(firestore, 'storySessions', sessionId, 'messages');
        const pendingCharacterTraits = session?.pendingCharacterTraits;

        try {
            if (pendingCharacterTraits) {
                await addDoc(messagesRef, { sender: 'child', text: childMessageText, kind: 'character_traits_answer', createdAt: serverTimestamp() });
                const characterRef = doc(firestore, 'characters', pendingCharacterTraits.characterId);
                await updateDoc(characterRef, { traits: arrayUnion(childMessageText), traitsLastUpdatedAt: serverTimestamp() });
                await updateDoc(sessionRef, { pendingCharacterTraits: deleteField() });
                await runBeatAndAppendMessages();
            } else {
                await addDoc(messagesRef, { sender: 'child', text: childMessageText, createdAt: serverTimestamp() });
                const response = await fetch('/api/warmupReply', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sessionId }) });
                const result = await response.json();
                if (response.ok && result.ok) {
                    await addDoc(messagesRef, { sender: 'assistant', text: result.assistantText, createdAt: serverTimestamp() });
                } else {
                    await addDoc(messagesRef, { sender: 'assistant', text: 'The Story Guide is having trouble thinking of a reply. Please try again.', createdAt: serverTimestamp() });
                    toast({ title: 'API Error', description: result.errorMessage, variant: 'destructive' });
                }
            }
        } catch (e: any) {
            await addDoc(messagesRef, { sender: 'assistant', text: 'Oops, something went wrong. Let’s try again.', createdAt: serverTimestamp() });
            toast({ title: 'Error', description: e.message, variant: 'destructive' });
        } finally {
            setIsProcessing(false);
        }
    };

    const handleChooseOption = async (chosenOption: Choice) => {
        if (!user || !sessionId || !firestore || !sessionRef || !session || isProcessing || !session.storyTypeId) return;
        
        setIsProcessing(true);
        const charactersRef = collection(firestore, 'characters');
        const messagesRef = collection(firestore, 'storySessions', sessionId, 'messages');
        await addDoc(messagesRef, { sender: 'child', text: chosenOption.text, kind: 'child_choice', selectedOptionId: chosenOption.id, createdAt: serverTimestamp() });

        let traitsQuestionAsked = false;
        if (chosenOption.introducesCharacter) {
            const newCharacterData = {
                ownerChildId: session.childId,
                sessionId: sessionId,
                name: chosenOption.newCharacterLabel || 'New Friend',
                role: chosenOption.newCharacterKind || 'friend',
                createdAt: serverTimestamp(),
                updatedAt: serverTimestamp(),
            };
            const newCharacterRef = await addDoc(charactersRef, newCharacterData);
            await updateDoc(sessionRef, { supportingCharacterIds: arrayUnion(newCharacterRef.id) });
            traitsQuestionAsked = await runCharacterTraitsQuestion(sessionId, newCharacterRef.id, newCharacterData.name);
        }

        if (!traitsQuestionAsked) {
            const arcSteps = activeStoryType?.arcTemplate?.steps ?? [];
            const totalSteps = arcSteps.length;
            const currentIndex = session.arcStepIndex ?? 0;
            const nextIndex = totalSteps > 0 ? Math.min(currentIndex + 1, totalSteps - 1) : 0;
            const reachedEnd = totalSteps > 0 && (currentIndex + 1 >= totalSteps);
            
            await updateDoc(sessionRef, { arcStepIndex: nextIndex, updatedAt: serverTimestamp() });
            
            if (reachedEnd) {
                await logClientStage('arc.completed', { totalSteps: totalSteps || null });
                await generateEndingChoices();
            } else {
                await runBeatAndAppendMessages();
            }
        } else {
            setIsProcessing(false);
        }
    };

    const handleChooseEnding = async (chosenOption: Choice) => {
        if (!sessionRef || !firestore || session?.selectedEndingId || isProcessing) return;
        setIsProcessing(true);
        const messagesRef = collection(firestore, 'storySessions', sessionId, 'messages');
        await addDoc(messagesRef, { sender: 'child', text: chosenOption.text, kind: 'child_ending_choice', selectedOptionId: chosenOption.id, createdAt: serverTimestamp() });
        await updateDoc(sessionRef, { selectedEndingId: chosenOption.id, selectedEndingText: chosenOption.text, updatedAt: serverTimestamp(), 'progress.endingChosenAt': serverTimestamp() });
        await logClientStage('ending.chosen', { endingId: chosenOption.id });
        toast({ title: 'Ending selected', description: 'Great choice! Compiling your story...' });
        setIsProcessing(false);
        router.push(`/story/session/${sessionId}`);
    };

    const handleStoryTypeSelect = async (storyType: StoryType) => {
        if (!firestore || !sessionRef || isProcessing) return;
        setIsProcessing(true);
        try {
            const timestamp = serverTimestamp();
            const displayName = session?.storyTitle || childProfile?.displayName ? `${childProfile?.displayName || 'Your'} ${storyType.name}` : storyType.name;
            await updateDoc(sessionRef, {
                storyTypeId: storyType.id,
                storyTypeName: storyType.name,
                storyPhaseId: storyType.defaultPhaseId,
                endingPhaseId: storyType.endingPhaseId,
                arcStepIndex: 0,
                currentPhase: 'story',
                storyTitle: session?.storyTitle || displayName,
                updatedAt: timestamp,
                'progress.warmupCompletedAt': timestamp,
                'progress.storyTypeChosenAt': timestamp,
            });
            await logClientStage('story_type.chosen', { storyTypeId: storyType.id });
            await runBeatAndAppendMessages();
        } catch (e: any) {
            toast({ title: 'Could not start story', description: e.message || 'Please try another type.', variant: 'destructive' });
            setIsProcessing(false);
        }
    };

    if (userLoading || sessionLoading) {
        return <div className="h-screen w-screen flex items-center justify-center bg-background"><LoaderCircle className="h-12 w-12 animate-spin text-primary" /></div>;
    }

    if (!user || !session) {
        return <div className="p-8 text-center"><p>Could not load story. Please try again.</p><Button asChild variant="link"><Link href="/stories">Back to stories</Link></Button></div>;
    }

    const latestAssistantMessage = recentMessages?.find(m => m.sender === 'assistant');
    const showStoryTypePicker = !session.storyTypeId && curatedStoryTypes.length > 0;
    const isWaitingForTraitsAnswer = !!session?.pendingCharacterTraits;
    const showTextInput = latestAssistantMessage?.kind !== 'beat_options' && latestAssistantMessage?.kind !== 'ending_options' && session.currentPhase === 'warmup';

    return (
        <div className="min-h-screen bg-background text-foreground flex flex-col items-center p-4">
            <div className="absolute top-4 right-4">
                <Button variant="ghost" size="sm" asChild>
                    <Link href={`/story/session/${sessionId}`} title="Diagnostic View">
                        <Settings className="h-4 w-4" />
                    </Link>
                </Button>
            </div>

            <div className="flex-grow flex flex-col items-center justify-center w-full max-w-2xl text-center">
                {isProcessing && <ThinkingIndicator />}

                {!isProcessing && (
                    <>
                        {showStoryTypePicker ? (
                            <Card className="w-full">
                                <CardHeader>
                                    <CardTitle>Pick Your Kind of Story</CardTitle>
                                    <CardDescription>The Story Guide suggests these based on your favorite things.</CardDescription>
                                </CardHeader>
                                <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                    {curatedStoryTypes.map(type => (
                                        <Button key={type.id} variant="outline" className="h-auto p-4 flex flex-col items-start text-left" onClick={() => handleStoryTypeSelect(type)}>
                                            <span className="font-bold">{type.name}</span>
                                            <span className="text-xs text-muted-foreground">{type.shortDescription}</span>
                                        </Button>
                                    ))}
                                </CardContent>
                            </Card>
                        ) : latestAssistantMessage ? (
                            <div className="space-y-6 w-full">
                                <div className="flex flex-col items-center gap-2">
                                    <Avatar className="h-16 w-16">
                                        <AvatarImage src="/logo.svg" alt="Story Guide" />
                                        <AvatarFallback><Bot /></AvatarFallback>
                                    </Avatar>
                                    <p className="text-xl font-medium leading-relaxed">{latestAssistantMessage.text}</p>
                                </div>
                                
                                {latestAssistantMessage.kind === 'beat_options' && (
                                    <div className="grid grid-cols-1 gap-3 w-full">
                                        {latestAssistantMessage.options?.map(opt => (
                                            <Button key={opt.id} variant="secondary" size="lg" className="h-auto py-3 text-base" onClick={() => handleChooseOption(opt)} disabled={isProcessing}>
                                                {opt.text}
                                            </Button>
                                        ))}
                                    </div>
                                )}
                                
                                {latestAssistantMessage.kind === 'ending_options' && (
                                     <div className="grid grid-cols-1 gap-3 w-full">
                                        {latestAssistantMessage.options?.map(opt => (
                                            <Button key={opt.id} variant="secondary" size="lg" className="h-auto py-3 text-base" onClick={() => handleChooseEnding(opt)} disabled={isProcessing}>
                                                <Star className="w-4 h-4 mr-2 text-amber-400" />{opt.text}
                                            </Button>
                                        ))}
                                    </div>
                                )}

                                {showTextInput && (
                                    <div className="flex w-full items-center space-x-2">
                                        <Input
                                            placeholder={isWaitingForTraitsAnswer ? `What is ${session.pendingCharacterTraits?.characterLabel} like?` : "Type your reply..."}
                                            value={input}
                                            onChange={(e) => setInput(e.target.value)}
                                            onKeyDown={(e) => e.key === 'Enter' && !isProcessing && handleSendMessage()}
                                            disabled={isProcessing}
                                            className="text-center text-lg h-12"
                                        />
                                        <Button size="lg" onClick={handleSendMessage} disabled={isProcessing || !input.trim()}>
                                            <Send className="h-5 w-5" />
                                        </Button>
                                    </div>
                                )}
                            </div>
                        ) : (
                            <LoaderCircle className="h-8 w-8 animate-spin text-primary" />
                        )}
                    </>
                )}
            </div>
        </div>
    );
}

