
'use client';

import { useState, useMemo, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useUser } from '@/firebase/auth/use-user';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { LoaderCircle, Send, CheckCircle, RefreshCw, Sparkles, Star } from 'lucide-react';
import Link from 'next/link';
import { useFirestore } from '@/firebase';
import { doc, collection, addDoc, serverTimestamp, query, orderBy, updateDoc, writeBatch, getDocs, limit, arrayUnion, DocumentReference, getDoc, deleteField, increment } from 'firebase/firestore';
import type { StorySession, ChatMessage as Message, Choice, Character, StoryType } from '@/lib/types';
import { Input } from '@/components/ui/input';
import { useCollection, useDocument } from '@/lib/firestore-hooks';
import { useToast } from '@/hooks/use-toast';
import { useAdminStatus } from '@/hooks/use-admin-status';
import { Badge } from '@/components/ui/badge';


type WarmupGenkitDiagnostics = {
    lastCallOk: boolean | null;
    lastErrorMessage: string | null;
    lastUsedPromptConfigId: string | null;
    lastAssistantTextPreview: string | null;
    debug: any | null; // Add debug field
}

type BeatGenkitDiagnostics = {
    lastBeatOk: boolean | null;
    lastBeatErrorMessage: string | null;
    lastBeatPromptConfigId: string | null;
    lastBeatArcStep: string | null;
    lastBeatStoryContinuationPreview: string | null;
};

type BeatInteractionDiagnostics = {
    lastRequestType: 'choose' | 'more_options' | 'traits_answer' | null;
    lastChosenOptionId: string | null;
    lastChosenOptionTextPreview: string | null;
    lastArcStepIndexAfterChoice: number | null;
    moreOptionsCount: number;
    lastMoreOptionsAt: string | null;
    lastNewCharacterId?: string;
    lastNewCharacterLabel?: string;
};

type CharacterTraitsDiagnostics = {
    lastCharacterId?: string;
    lastCharacterLabel?: string;
    lastTraitsQuestionPreview?: string | null;
    lastTraitsUpdateCount?: number | null;
    lastTraitsAnswerPreview?: string | null;
    errorMessage?: string;
    sessionHasPendingCharacterTraits?: boolean;
    pendingCharacterTraits?: any;
};

type EndingGenkitDiagnostics = {
    lastEndingOk: boolean | null;
    lastEndingErrorMessage: string | null;
    lastEndingStoryTypeId: string | null;
    lastEndingArcStep: string | null;
    lastEndingPreview: string | null;
};


export default function StorySessionPage() {
    const params = useParams<{ sessionId: string }>();
    const sessionId = params.sessionId;
    const router = useRouter();
    const { user, loading: userLoading } = useUser();
    const firestore = useFirestore();
    const [input, setInput] = useState('');
    const [isSending, setIsSending] = useState(false);
    const { toast } = useToast();
    const { isAdmin, loading: adminLoading } = useAdminStatus();
    
    const [isBeatRunning, setIsBeatRunning] = useState(false);
    const [isGeneratingMoreOptions, setIsGeneratingMoreOptions] = useState(false);
    const [isEndingRunning, setIsEndingRunning] = useState(false);


    const [beatDiagnostics, setBeatDiagnostics] = useState<BeatGenkitDiagnostics>({
        lastBeatOk: null,
        lastBeatErrorMessage: null,
        lastBeatPromptConfigId: null,
        lastBeatArcStep: null,
        lastBeatStoryContinuationPreview: null,
    });
    
    const [beatInteractionDiagnostics, setBeatInteractionDiagnostics] = useState<BeatInteractionDiagnostics>({
        lastRequestType: null,
        lastChosenOptionId: null,
        lastChosenOptionTextPreview: null,
        lastArcStepIndexAfterChoice: null,
        moreOptionsCount: 0,
        lastMoreOptionsAt: null,
    });


    const [warmupDiagnostics, setWarmupDiagnostics] = useState<WarmupGenkitDiagnostics>({
        lastCallOk: null,
        lastErrorMessage: null,
        lastUsedPromptConfigId: null,
        lastAssistantTextPreview: null,
        debug: null,
    });

    const [characterTraitsDiagnostics, setCharacterTraitsDiagnostics] = useState<CharacterTraitsDiagnostics>({});
    const [endingDiagnostics, setEndingDiagnostics] = useState<EndingGenkitDiagnostics>({
        lastEndingOk: null,
        lastEndingErrorMessage: null,
        lastEndingStoryTypeId: null,
        lastEndingArcStep: null,
        lastEndingPreview: null,
    });
    
    // Firestore Hooks
    const sessionRef = useMemo(() => firestore ? doc(firestore, 'storySessions', sessionId) : null, [firestore, sessionId]);
    const { data: session, loading: sessionLoading, error: sessionError } = useDocument<StorySession>(sessionRef);
    const messagesQuery = useMemo(() => firestore ? query(collection(firestore, `storySessions/${sessionId}/messages`), orderBy('createdAt')) : null, [firestore, sessionId]);
    const { data: messages, loading: messagesLoading, error: messagesError } = useCollection<Message>(messagesQuery);
    
    // Derived state from session
    const currentStoryTypeId = session?.storyTypeId ?? null;
    const currentStoryPhaseId = session?.storyPhaseId ?? null;
    const currentArcStepIndex = typeof session?.arcStepIndex === 'number' ? session.arcStepIndex : null;
    const pendingCharacterTraits = session?.pendingCharacterTraits ?? null;

    useEffect(() => {
        setCharacterTraitsDiagnostics(prev => ({
            ...prev,
            sessionHasPendingCharacterTraits: !!pendingCharacterTraits,
            pendingCharacterTraits: pendingCharacterTraits ? {
                characterId: pendingCharacterTraits.characterId,
                characterLabel: pendingCharacterTraits.characterLabel,
                questionPreview: pendingCharacterTraits.questionText.slice(0, 80),
            } : null,
        }))
    }, [pendingCharacterTraits]);

    const latestOptionsMessage = useMemo(() => {
        if (!messages) return null;
        // Find the most recent message that has interactive options
        for (let i = messages.length - 1; i >= 0; i--) {
            const msg = messages[i];
            if (msg.kind === 'beat_options' && msg.options && msg.options.length > 0) {
                return msg;
            }
        }
        return null;
    }, [messages]);


    const handleSendMessage = async () => {
        if (!input.trim() || !firestore || !user || !sessionRef) return;

        setIsSending(true);
        const childMessageText = input.trim();
        setInput('');

        const messagesRef = collection(firestore, `storySessions/${sessionId}/messages`);

        try {
            if (pendingCharacterTraits) {
                 // This is an answer to a traits question
                await addDoc(messagesRef, {
                    sender: 'child',
                    text: childMessageText,
                    kind: 'character_traits_answer',
                    createdAt: serverTimestamp(),
                });

                const characterRef = doc(firestore, 'characters', pendingCharacterTraits.characterId);
                await updateDoc(characterRef, {
                    traits: arrayUnion(childMessageText),
                    traitsLastUpdatedAt: serverTimestamp()
                });

                await updateDoc(sessionRef, {
                    pendingCharacterTraits: deleteField()
                });
                
                setCharacterTraitsDiagnostics(prev => ({
                    ...prev,
                    lastTraitsAnswerPreview: childMessageText.slice(0, 80),
                }));
                setBeatInteractionDiagnostics(prev => ({
                    ...prev,
                    lastRequestType: 'traits_answer',
                }))

                // Now run the next story beat
                await runBeatAndAppendMessages();

            } else {
                // This is a normal warmup/chat message
                await addDoc(messagesRef, {
                    sender: 'child',
                    text: childMessageText,
                    createdAt: serverTimestamp(),
                });

                const response = await fetch('/api/warmupReply', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ sessionId }),
                });

                const result = await response.json();
                if (response.ok && result.ok) {
                    await addDoc(messagesRef, {
                        sender: 'assistant',
                        text: result.assistantText,
                        createdAt: serverTimestamp(),
                    });
                    setWarmupDiagnostics({
                        lastCallOk: true,
                        lastErrorMessage: null,
                        lastUsedPromptConfigId: result.usedPromptConfigId,
                        lastAssistantTextPreview: result.assistantTextPreview || null,
                        debug: null,
                    });
                } else {
                    const friendlyErrorMessage = 'The Story Guide is having trouble thinking of a reply. Please try again.';
                    await addDoc(messagesRef, { sender: 'assistant', text: friendlyErrorMessage, createdAt: serverTimestamp() });
                    toast({ title: 'API Error', description: result.errorMessage, variant: 'destructive' });
                    setWarmupDiagnostics({
                        lastCallOk: false,
                        lastErrorMessage: result.errorMessage || 'An unknown error occurred.',
                        lastUsedPromptConfigId: result.usedPromptConfigId || null,
                        lastAssistantTextPreview: null,
                        debug: result.debug || null,
                    });
                }
            }

        } catch (e: any) {
            console.error("Error in send message flow:", e);
            const friendlyErrorMessage = 'The Story Guide is having trouble thinking of a reply. Please try again.';
            await addDoc(messagesRef, { sender: 'assistant', text: friendlyErrorMessage, createdAt: serverTimestamp() });
            toast({ title: 'Error', description: e.message, variant: 'destructive' });
             setWarmupDiagnostics({
                lastCallOk: false,
                lastErrorMessage: e.message,
                lastUsedPromptConfigId: null,
                lastAssistantTextPreview: null,
                debug: { clientError: true },
            });
        } finally {
            setIsSending(false);
        }
    };

    const runBeatAndAppendMessages = async () => {
        if (!firestore) return;
        
        setIsBeatRunning(true);
        setBeatDiagnostics({ ...beatDiagnostics, lastBeatErrorMessage: null });

        try {
            const response = await fetch('/api/storyBeat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ sessionId }),
            });
            const flowResult = await response.json();
            
            if (!response.ok || !flowResult.ok) {
                throw new Error(flowResult.errorMessage || "An unknown API error occurred.");
            }

            // On success, write to Firestore
            const { storyContinuation, options, promptConfigId, arcStep } = flowResult;
            const messagesRef = collection(firestore, `storySessions/${sessionId}/messages`);

            await addDoc(messagesRef, {
                sender: 'assistant',
                text: storyContinuation,
                kind: 'beat_continuation',
                createdAt: serverTimestamp(),
            });
            
            await addDoc(messagesRef, {
                sender: 'assistant',
                text: "What happens next?",
                kind: 'beat_options',
                options: options,
                createdAt: serverTimestamp(),
            });

            setBeatDiagnostics({
                lastBeatOk: true,
                lastBeatErrorMessage: null,
                lastBeatPromptConfigId: promptConfigId,
                lastBeatArcStep: arcStep,
                lastBeatStoryContinuationPreview: storyContinuation.slice(0, 80),
            });
            toast({ title: "Story Beat Succeeded!" });

        } catch (e: any) {
             setBeatDiagnostics(prev => ({
                ...prev,
                lastBeatOk: false,
                lastBeatErrorMessage: e.message || "Failed to run story beat.",
            }));
            toast({ title: "Error running beat", description: e.message, variant: "destructive" });
        } finally {
             setIsBeatRunning(false);
        }
    };

    const runCharacterTraitsQuestion = async (sessionId: string, characterId: string, characterLabel: string) => {
        if (!firestore || !sessionRef) return;

        try {
            const response = await fetch('/api/characterTraits', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ sessionId, characterId }),
            });

            const result = await response.json();

            if (!response.ok || !result.ok) {
                throw new Error(result.errorMessage || "Failed to get character traits question.");
            }

            const { question, suggestedTraits } = result;

            const messagesRef = collection(firestore, `storySessions/${sessionId}/messages`);
            await addDoc(messagesRef, {
                sender: 'assistant',
                text: question,
                kind: 'character_traits_question',
                createdAt: serverTimestamp(),
            });

            const characterRef = doc(firestore, 'characters', characterId);
            await updateDoc(characterRef, {
                traits: suggestedTraits,
                traitsLastUpdatedAt: serverTimestamp(),
            });

            await updateDoc(sessionRef, {
                pendingCharacterTraits: {
                    characterId: characterId,
                    characterLabel: characterLabel,
                    questionText: question,
                    askedAt: serverTimestamp(),
                }
            });

            setCharacterTraitsDiagnostics({
                lastCharacterId: characterId,
                lastCharacterLabel: characterLabel,
                lastTraitsQuestionPreview: question.slice(0, 80),
                lastTraitsUpdateCount: suggestedTraits.length,
            });

            return true; // Indicate success

        } catch (e: any) {
            console.error("Error in runCharacterTraitsQuestion:", e);
            setCharacterTraitsDiagnostics(prev => ({ ...prev, errorMessage: e.message }));
            // On failure, do not set pendingCharacterTraits and allow beat to continue
            return false;
        }
    };
    
    const handleRunStoryBeat = async () => {
        if (!user || !sessionId || !firestore) return;
        if (!session?.storyTypeId || !session?.storyPhaseId) {
            toast({ title: "Cannot run beat", description: "Session must have a story type and phase ID.", variant: "destructive" });
            return;
        }
        await runBeatAndAppendMessages();
    };

    const handleRunEndingFlow = async () => {
        if (!user || !sessionId || !firestore) return;

        setIsEndingRunning(true);
        setEndingDiagnostics({ ...endingDiagnostics, lastEndingErrorMessage: null });

        try {
            const response = await fetch('/api/storyEnding', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ sessionId }),
            });
            const result = await response.json();
            if (!response.ok || !result.ok) {
                throw new Error(result.errorMessage || "An unknown error occurred in ending flow.");
            }

            setEndingDiagnostics({
                lastEndingOk: true,
                lastEndingErrorMessage: null,
                lastEndingStoryTypeId: result.storyTypeId,
                lastEndingArcStep: result.arcStep,
                lastEndingPreview: result.endings[0]?.text.slice(0, 80) || null,
            });
            toast({ title: "Ending Flow Succeeded!", description: `Generated ${result.endings.length} endings.` });

            // For now, just log to console. In future, would append to chat.
            console.log("Generated Endings:", result.endings);

        } catch (e: any) {
            setEndingDiagnostics(prev => ({ ...prev, lastEndingOk: false, lastEndingErrorMessage: e.message }));
            toast({ title: "Error running ending flow", description: e.message, variant: "destructive" });
        } finally {
            setIsEndingRunning(false);
        }
    };
    
    const handleChooseOption = async (optionsMessage: Message, chosenOption: Choice) => {
        if (!user || !sessionId || !firestore || !sessionRef || !session || isBeatRunning) return;
    
        const charactersRef = collection(firestore, 'characters');
        const messagesRef = collection(firestore, `storySessions/${sessionId}/messages`);
        
        let newCharacterId: string | undefined = undefined;
        let traitsQuestionAsked = false;

        // Write child's choice message first
        await addDoc(messagesRef, {
            sender: 'child',
            text: chosenOption.text,
            kind: 'child_choice',
            selectedOptionId: chosenOption.id,
            createdAt: serverTimestamp(),
        });

        // 1. If the option introduces a character, create it first
        if (chosenOption.introducesCharacter) {
            const newCharacterData = {
                ownerChildId: session.childId,
                sessionId: sessionId,
                name: chosenOption.newCharacterLabel || 'New Friend',
                role: chosenOption.newCharacterKind || 'friend',
                createdAt: serverTimestamp(),
                updatedAt: serverTimestamp(),
                introducedFromOptionId: chosenOption.id,
                introducedFromMessageId: optionsMessage.id,
            };
            const newCharacterRef = await addDoc(charactersRef, newCharacterData);
            newCharacterId = newCharacterRef.id;

            // Link character to the session
             await updateDoc(sessionRef, {
                supportingCharacterIds: arrayUnion(newCharacterId)
            });

            // Ask a traits question
            traitsQuestionAsked = await runCharacterTraitsQuestion(sessionId, newCharacterId, newCharacterData.name);
        }

        // 2. Update beat interaction diagnostics
         setBeatInteractionDiagnostics(prev => ({
            ...prev,
            lastRequestType: 'choose',
            lastChosenOptionId: chosenOption.id,
            lastChosenOptionTextPreview: chosenOption.text.slice(0, 80),
            lastNewCharacterId: newCharacterId,
            lastNewCharacterLabel: newCharacterId ? (chosenOption.newCharacterLabel || chosenOption.text) : undefined,
        }));
        
        // 3. Increment arc step and run next beat OR wait for traits answer
        if (traitsQuestionAsked) {
            // The flow now waits for user input, handled by handleSendMessage
        } else {
            // No new character or traits API failed, so proceed to next beat immediately.
            const storyTypeRef = doc(firestore, 'storyTypes', session.storyTypeId!);
            const storyTypeDoc = await getDoc(storyTypeRef);
            const storyType = storyTypeDoc.data() as StoryType;
            const arcSteps = storyType.arcTemplate?.steps ?? [];
            const currentIndex = session.arcStepIndex ?? 0;
            
            let nextIndex = currentIndex + 1;
            if (arcSteps.length > 0) {
                const maxIndex = arcSteps.length - 1;
                if (nextIndex > maxIndex) {
                    nextIndex = maxIndex;
                }
            }
            
            await updateDoc(sessionRef, {
                arcStepIndex: nextIndex,
                updatedAt: serverTimestamp(),
            });

            setBeatInteractionDiagnostics(prev => ({
                ...prev,
                lastArcStepIndexAfterChoice: nextIndex,
            }));

            await runBeatAndAppendMessages();
        }
    };
    
    const handleMoreOptions = async () => {
        if (!firestore || !sessionId) return;
        setIsGeneratingMoreOptions(true);
        setBeatDiagnostics(prev => ({...prev, lastBeatErrorMessage: null}));

        try {
            const response = await fetch('/api/storyBeat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ sessionId }),
            });
            const flowResult = await response.json();

            if (!response.ok || !flowResult.ok) {
                throw new Error(flowResult.errorMessage || "An unknown error occurred while getting more options.");
            }

            const messagesRef = collection(firestore, `storySessions/${sessionId}/messages`);
            const q = query(messagesRef, orderBy('createdAt', 'desc'), limit(1));
            const snapshot = await getDocs(q);
            
            const latestMessage = snapshot.docs[0];
            if (latestMessage && latestMessage.data().kind === 'beat_options') {
                await updateDoc(latestMessage.ref, { options: flowResult.options });
            } else {
                 throw new Error("Could not find the latest options message to update.");
            }
            
            setBeatInteractionDiagnostics(prev => ({
                ...prev,
                lastRequestType: 'more_options',
                moreOptionsCount: prev.moreOptionsCount + 1,
                lastMoreOptionsAt: new Date().toISOString(),
            }));
             setBeatDiagnostics(prev => ({
                ...prev,
                lastBeatOk: true,
                lastBeatErrorMessage: null,
            }));
            toast({ title: 'New choices are ready!' });

        } catch (e: any) {
            setBeatDiagnostics(prev => ({
                ...prev,
                lastBeatOk: false,
                lastBeatErrorMessage: e.message || "Failed to get more choices.",
            }));
            toast({ title: "Error getting more choices", description: e.message, variant: "destructive" });
        } finally {
            setIsGeneratingMoreOptions(false);
        }
    };


    const diagnostics = {
        page: 'story-session',
        sessionId,
        auth: {
            isAuthenticated: !!user,
            email: user?.email || null,
            isAdmin,
        },
        firestore: {
            messagesCount: messages?.length || 0,
            firstMessageSender: messages && messages.length > 0 ? messages[0].sender : null,
            lastMessageSender: messages && messages.length > 0 ? messages[messages.length - 1].sender : null,
            sessionHasStoryType: !!currentStoryTypeId,
            currentStoryTypeId: currentStoryTypeId,
            currentStoryPhaseId: currentStoryPhaseId,
            currentArcStepIndex: currentArcStepIndex,
        },
        genkitWarmup: warmupDiagnostics,
        genkitBeat: beatDiagnostics,
        genkitEnding: endingDiagnostics,
        beatInteraction: beatInteractionDiagnostics,
        characterTraits: characterTraitsDiagnostics,
        error: sessionError?.message || messagesError?.message || null,
    };

    const renderChatContent = () => {
        if (userLoading || sessionLoading) {
            return <div className="flex items-center justify-center p-8"><LoaderCircle className="h-8 w-8 animate-spin text-primary" /></div>;
        }

        if (!user) {
            return (
                <div className="text-center p-8">
                    <p className="text-muted-foreground mb-4">Please sign in to view this story.</p>
                    <Button asChild><Link href="/login">Sign In</Link></Button>
                </div>
            );
        }
        
        if (sessionError) {
             return <p className="text-destructive text-center p-8">Error loading session: {sessionError.message}</p>;
        }

        if (!session) {
             return <p className="text-destructive text-center p-8">Could not find story session with ID: {sessionId}</p>;
        }
        
        const isWaitingForTraitsAnswer = !!pendingCharacterTraits;
        
        return (
             <Card className="w-full max-w-2xl flex flex-col">
                <CardHeader>
                    <CardTitle>Story Chat</CardTitle>
                    <CardDescription>Session ID: <span className="font-mono">{sessionId}</span></CardDescription>
                </CardHeader>
                <CardContent className="flex-grow overflow-y-auto pr-6 space-y-4">
                   {messagesLoading && <div className="flex items-center gap-2"><LoaderCircle className="animate-spin mr-2" />Loading messages...</div>}
                   {messagesError && <p className="text-destructive">Error loading messages: {messagesError.message}</p>}
                   {messages && messages.map((msg: Message) => (
                       <div key={msg.id} className={`flex flex-col ${msg.sender === 'child' ? 'items-end' : 'items-start'}`}>
                            {msg.kind === 'beat_options' && msg.options ? (
                                <div className="p-2 rounded-lg bg-muted w-full">
                                    <p className="text-sm text-muted-foreground mb-2">{msg.text}</p>
                                    <div className="flex flex-col gap-2">
                                        {msg.options.map(opt => (
                                            <Button
                                                key={opt.id}
                                                variant="outline"
                                                onClick={() => handleChooseOption(msg, opt)}
                                                disabled={isBeatRunning || isGeneratingMoreOptions || latestOptionsMessage?.id !== msg.id || isWaitingForTraitsAnswer}
                                                className="justify-start h-auto"
                                            >
                                                <div className="flex items-center gap-2">
                                                    <span>{opt.text}</span>
                                                    {opt.introducesCharacter && (
                                                        <Badge variant="secondary" className="gap-1">
                                                            <Sparkles className="h-3 w-3" />
                                                            New Character
                                                        </Badge>
                                                    )}
                                                </div>
                                            </Button>
                                        ))}
                                         <Button
                                            variant="ghost"
                                            className="text-muted-foreground"
                                            onClick={handleMoreOptions}
                                            disabled={isBeatRunning || isGeneratingMoreOptions || latestOptionsMessage?.id !== msg.id || isWaitingForTraitsAnswer}
                                        >
                                           <RefreshCw className="mr-2 h-4 w-4"/> More choices
                                        </Button>
                                    </div>
                                </div>
                            ) : (
                               <>
                                <span className="text-xs font-bold text-muted-foreground">
                                    {msg.sender === 'assistant' ? 'Story Guide' : 'You'}
                                </span>
                                <p className={`whitespace-pre-wrap p-2 rounded-md ${msg.sender === 'child' ? 'bg-primary text-primary-foreground' : 'bg-muted'}`}>
                                    {msg.text}
                                </p>
                               </>
                            )}
                       </div>
                   ))}
                   {isSending && (
                        <div className="flex justify-start">
                            <div className="bg-muted p-3 rounded-lg flex items-center gap-2">
                                <LoaderCircle className="h-5 w-5 animate-spin" />
                                <span className="text-sm text-muted-foreground">Thinking...</span>
                            </div>
                        </div>
                    )}
                     {(isBeatRunning || isGeneratingMoreOptions || isEndingRunning) && (
                        <div className="flex justify-start">
                            <div className="bg-muted p-3 rounded-lg flex items-center gap-2">
                                <LoaderCircle className="h-5 w-5 animate-spin" />
                                <span className="text-sm text-muted-foreground">Creating what's next...</span>
                            </div>
                        </div>
                    )}
                </CardContent>
                <CardFooter className="border-t pt-6">
                  <div className="flex w-full items-center space-x-2">
                    <Input
                      id="message"
                      placeholder={isWaitingForTraitsAnswer ? `What is ${pendingCharacterTraits?.characterLabel} like?` : "Type your message..."}
                      className="flex-1"
                      autoComplete="off"
                      value={input}
                      onChange={(e) => setInput(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && !isSending && handleSendMessage()}
                      disabled={isSending || isBeatRunning || isGeneratingMoreOptions || isEndingRunning}
                    />
                    <Button onClick={handleSendMessage} disabled={isSending || isBeatRunning || isGeneratingMoreOptions || isEndingRunning}>
                      <Send className="h-4 w-4" />
                      <span className="sr-only">Send</span>
                    </Button>
                  </div>
                </CardFooter>
            </Card>
        )
    };
    
    const renderAdminControls = () => {
        if (adminLoading || !isAdmin) {
            return null;
        }

        const canRunBeat = !!session?.storyTypeId && !!session?.storyPhaseId;
        const isWaitingForTraitsAnswer = !!pendingCharacterTraits;

        return (
            <Card className="w-full max-w-2xl">
                <CardHeader>
                    <CardTitle>Admin Controls</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                     <div className="text-center">
                        {currentStoryTypeId ? (
                            <div className="p-4 rounded-lg bg-muted/50">
                                <CheckCircle className="mx-auto h-8 w-8 text-green-500 mb-2" />
                                <p className="font-semibold">Story type chosen.</p>
                                <p className="text-sm text-muted-foreground font-mono">{currentStoryTypeId}</p>
                            </div>
                        ) : (
                            <div>
                                <p className="mb-2">Ready to choose your kind of story?</p>
                                <Button onClick={() => router.push(`/story/type/${sessionId}`)}>
                                    Choose story type
                                </Button>
                            </div>
                        )}
                    </div>
                    <div className="text-center grid grid-cols-2 gap-4">
                        <Button onClick={handleRunStoryBeat} disabled={!canRunBeat || isBeatRunning || isGeneratingMoreOptions || isWaitingForTraitsAnswer || isEndingRunning}>
                            {isBeatRunning ? <><LoaderCircle className="animate-spin mr-2"/>Running Beat...</> : 'Run Next Story Beat'}
                        </Button>
                        <Button onClick={handleRunEndingFlow} disabled={!canRunBeat || isEndingRunning || isBeatRunning}>
                           {isEndingRunning ? <><LoaderCircle className="animate-spin mr-2"/>Running Endings...</> : <><Star className="mr-2"/>Run Ending Flow</>}
                        </Button>
                         {!canRunBeat && <p className="text-xs text-muted-foreground mt-2 col-span-2">Requires Story Type and Phase to be set.</p>}
                         {isWaitingForTraitsAnswer && <p className="text-xs text-amber-600 mt-2 col-span-2">Story is paused, waiting for traits answer.</p>}
                    </div>
                </CardContent>
            </Card>
        );
    };

    return (
        <div className="container mx-auto p-4 sm:p-6 md:p-8 flex flex-col items-center gap-8">
            <div className="w-full max-w-2xl">
              {renderChatContent()}
            </div>
            
            <div className="w-full max-w-2xl">
                {renderAdminControls()}
            </div>
            
            <Card className="w-full max-w-4xl">
                <CardHeader>
                    <CardTitle>Diagnostics</CardTitle>
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
