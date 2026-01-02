
'use client';

import { useState, useMemo, useEffect, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useUser } from '@/firebase/auth/use-user';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { LoaderCircle, Send, CheckCircle, RefreshCw, Sparkles, Star, Image as ImageIcon } from 'lucide-react';
import { DiagnosticsPanel } from '@/components/diagnostics-panel';
import Link from 'next/link';
import { useFirestore } from '@/firebase';
import { doc, collection, addDoc, serverTimestamp, query, orderBy, updateDoc, writeBatch, getDocs, limit, arrayUnion, DocumentReference, getDoc, deleteField, increment, where } from 'firebase/firestore';
import type { StorySession, ChatMessage as Message, Choice, Character, StoryType, StoryBook, ChildProfile, StoryOutputType } from '@/lib/types';
import { Input } from '@/components/ui/input';
import { useCollection, useDocument } from '@/lib/firestore-hooks';
import { useToast } from '@/hooks/use-toast';
import { useAdminStatus } from '@/hooks/use-admin-status';
import { Badge } from '@/components/ui/badge';
import { logSessionEvent } from '@/lib/session-events';
import { cn } from '@/lib/utils';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { resolveEntitiesInText, replacePlaceholdersInText } from '@/lib/resolve-placeholders';


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

type CompileDiagnostics = {
    lastCompileOk: boolean | null;
    lastCompileErrorMessage: string | null;
    extractedActorIds: string[] | null;
    finalActorIds: string[] | null;
    storyId: string | null;
};

function buildImagePrompt(text: string, child?: ChildProfile | null, storyTitle?: string | null) {
  const summary = text.length > 160 ? `${text.slice(0, 157)}…` : text;

  // Base prompt
  let prompt = `Scene: ${summary}.`;

  // Add character guidance if the child's name is known
  if (child?.displayName) {
    prompt += ` The main character should resemble the child.`;
  }

  // Add style hints based on child's likes
  if (child?.likes?.length) {
    prompt += ` Incorporate themes of: ${child.likes.slice(0, 3).join(', ')}.`;
  }

  return prompt.trim();
}

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

function buildPreferenceKeywords(child?: ChildProfile | null): string[] {
    if (!child) return [];
    // Use likes array for preference-based keyword building
    const values = child.likes ?? [];
    return values.map((value) => value.toLowerCase());
}

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
    const [isImageJobRunning, setIsImageJobRunning] = useState(false);
    const [imageJobError, setImageJobError] = useState<string | null>(null);
    const [isSelectingStoryType, setIsSelectingStoryType] = useState(false);
    const [isCompiling, setIsCompiling] = useState(false);
    const [compileError, setCompileError] = useState<string | null>(null);
    const [isGeneratingPages, setIsGeneratingPages] = useState(false);
    const [pagesError, setPagesError] = useState<string | null>(null);
    const [hasTriggeredCompile, setHasTriggeredCompile] = useState(false);

    const [selectedOutputTypeId, setSelectedOutputTypeId] = useState<string>('');

    // State to store resolved placeholder text
    const [resolvedTexts, setResolvedTexts] = useState<Map<string, string>>(new Map());

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
    const [compileDiagnostics, setCompileDiagnostics] = useState<CompileDiagnostics>({
        lastCompileOk: null,
        lastCompileErrorMessage: null,
        extractedActorIds: null,
        finalActorIds: null,
        storyId: null,
    });

    // Firestore Hooks
    const sessionRef = useMemo(() => firestore ? doc(firestore, 'storySessions', sessionId) : null, [firestore, sessionId]);
    const { data: session, loading: sessionLoading, error: sessionError } = useDocument<StorySession>(sessionRef);
    // Only load storyBook if the session indicates one exists (story is compiled)
    // Note: gemini3 and gemini4 modes also create a Story document after compilation
    const storyBookRef = useMemo(() => {
        if (!firestore || !session || !user) return null;
        // Only attempt to load storyBook if session status indicates it's compiled
        // AND the user has permission (is parent owner or admin)
        const isOwner = session.parentUid === user.uid;
        if ((session.status === 'completed' || session.currentPhase === 'completed') && (isOwner || isAdmin)) {
            return doc(firestore, 'stories', sessionId);
        }
        return null;
    }, [firestore, sessionId, session?.status, session?.currentPhase, session?.parentUid, user?.uid, isAdmin]);
    const { data: storyBook, loading: storyBookLoading, error: storyBookError } = useDocument<StoryBook>(storyBookRef);
    const messagesQuery = useMemo(() => firestore ? query(collection(firestore, 'storySessions', sessionId, 'messages'), orderBy('createdAt')) : null, [firestore, sessionId]);
    const { data: messages, loading: messagesLoading, error: messagesError } = useCollection<Message>(messagesQuery);
    const childRef = useMemo(() => (session?.childId && firestore) ? doc(firestore, 'children', session.childId) : null, [firestore, session?.childId]);
    const { data: childProfile } = useDocument<ChildProfile>(childRef);
    const storyTypesQuery = useMemo(() => firestore ? query(collection(firestore, 'storyTypes'), where('status', '==', 'live')) : null, [firestore]);
    const { data: storyTypes } = useCollection<StoryType>(storyTypesQuery);
    const storyOutputTypesQuery = useMemo(() => firestore ? query(collection(firestore, 'storyOutputTypes'), where('status', '==', 'live')) : null, [firestore]);
    const { data: storyOutputTypes, loading: outputTypesLoading } = useCollection<StoryOutputType>(storyOutputTypesQuery);
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
                return {
                    type,
                    score: tagMatches,
                    matchesAge: matchesChildAge(type, childAge),
                };
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
    const logClientStage = useCallback(async (event: string, attributes: Record<string, unknown> = {}) => {
        if (!firestore) return;
        try {
            await logSessionEvent({
                firestore,
                sessionId,
                event,
                status: 'info',
                source: 'client',
                attributes,
            });
        } catch (err) {
            console.warn('[story-session] Failed to log event', event, err);
        }
    }, [firestore, sessionId]);

    // Effect to resolve placeholders in messages
    useEffect(() => {
        if (!messages || messages.length === 0) return;

        const resolveAllPlaceholders = async () => {
            // Collect all unique text strings that need resolution
            const textsToResolve = new Set<string>();

            messages.forEach(msg => {
                if (msg.text) textsToResolve.add(msg.text);
                if (msg.options) {
                    msg.options.forEach(opt => {
                        if (opt.text) textsToResolve.add(opt.text);
                    });
                }
            });

            // Get all entity IDs from all texts
            const allText = Array.from(textsToResolve).join(' ');
            const entityMap = await resolveEntitiesInText(allText);

            // Resolve each text
            const newResolvedTexts = new Map<string, string>();
            for (const text of textsToResolve) {
                const resolved = await replacePlaceholdersInText(text, entityMap);
                newResolvedTexts.set(text, resolved);
            }

            setResolvedTexts(newResolvedTexts);
        };

        resolveAllPlaceholders().catch(err => {
            console.error('[story-session] Failed to resolve placeholders:', err);
        });
    }, [messages]);

    // Helper function to get resolved text with fallback to original
    const getResolvedText = useCallback((text: string | undefined): string => {
        if (!text) return '';
        return resolvedTexts.get(text) || text;
    }, [resolvedTexts]);

    // Derived state from session
    const currentStoryTypeId = session?.storyTypeId ?? null;
    const currentStoryPhaseId = session?.storyPhaseId ?? null;
    const currentArcStepIndex = typeof session?.arcStepIndex === 'number' ? session.arcStepIndex : null;
    const pendingCharacterTraits = session?.pendingCharacterTraits ?? null;

    useEffect(() => {
        if (storyOutputTypes && storyOutputTypes.length > 0 && !selectedOutputTypeId) {
            setSelectedOutputTypeId(storyOutputTypes[0].id);
        }
    }, [storyOutputTypes, selectedOutputTypeId]);

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

    // WORKFLOW AUTOMATION: Auto-redirect to generating page when output type is selected
    useEffect(() => {
        const shouldShowGenerating =
            session?.storyOutputTypeId &&
            session?.status === 'completed' &&
            storyBook &&
            (storyBook.pageGeneration?.status === 'idle' ||
             storyBook.pageGeneration?.status === 'running' ||
             (storyBook.pageGeneration?.status === 'ready' && !storyBook.selectedImageStyleId) ||
             (storyBook.selectedImageStyleId && storyBook.imageGeneration?.status === 'running'));

        if (shouldShowGenerating) {
            console.log('[Session] Redirecting to generating page for progress tracking');
            router.push(`/story/session/${sessionId}/generating`);
        }
    }, [session?.storyOutputTypeId, session?.status, storyBook?.pageGeneration?.status, storyBook?.selectedImageStyleId, storyBook?.imageGeneration?.status, sessionId, router, storyBook]);

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
    const hasEndingOptions = useMemo(() => {
        if (!messages) return false;
        return messages.some((msg) => msg.kind === 'ending_options');
    }, [messages]);


    const handleSendMessage = async () => {
        if (!input.trim() || !firestore || !user || !sessionRef) return;

        setIsSending(true);
        const childMessageText = input.trim();
        setInput('');

        const messagesRef = collection(firestore, 'storySessions', sessionId, 'messages');

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

    const handleStoryTypeSelect = async (storyType: StoryType) => {
        if (!firestore || !sessionRef) return;
        setIsSelectingStoryType(true);
        try {
            const timestamp = serverTimestamp();
            const displayName = session?.storyTitle || childProfile?.displayName
                ? `${childProfile?.displayName || 'Your'} ${storyType.name}`
                : storyType.name;
            await updateDoc(sessionRef, {
                storyTypeId: storyType.id,
                storyPhaseId: storyType.defaultPhaseId || 'story_beat_phase_v1',
                endingPhaseId: storyType.endingPhaseId || 'ending_phase_v1',
                arcStepIndex: 0,
                currentPhase: 'story',
                storyTitle: session?.storyTitle || displayName,
                updatedAt: timestamp,
                'progress.warmupCompletedAt': timestamp,
                'progress.storyTypeChosenAt': timestamp,
            });
            await logClientStage('warmup.completed', { storyTypeId: storyType.id });
            await logClientStage('story_type.chosen', { storyTypeId: storyType.id });
            toast({
                title: 'Story type selected!',
                description: `The Story Guide will create a ${storyType.name} tale.`,
            });
            await runBeatAndAppendMessages();
        } catch (e: any) {
            toast({
                title: 'Could not start story',
                description: e.message || 'Please try another type.',
                variant: 'destructive',
            });
        } finally {
            setIsSelectingStoryType(false);
        }
    };

    const runBeatAndAppendMessages = async () => {
        if (!firestore || !sessionRef) return;
        
        setIsBeatRunning(true);
        setBeatDiagnostics({ ...beatDiagnostics, lastBeatErrorMessage: null });

        try {
            // If this is the first beat, transition phase
            const currentSession = (await getDoc(sessionRef)).data() as StorySession;
            const updates: Record<string, any> = {};
            if (currentSession.currentPhase === 'warmup') {
                updates.currentPhase = 'story';
            }
            if (typeof currentSession.arcStepIndex !== 'number') {
                updates.arcStepIndex = 0;
            }
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
            
            if (!response.ok || !flowResult.ok) {
                throw new Error(flowResult.errorMessage || "An unknown API error occurred.");
            }

            // On success, write to Firestore
            const { storyContinuation, options, promptConfigId, arcStep } = flowResult;
            const messagesRef = collection(firestore, 'storySessions', sessionId, 'messages');

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
        if (!firestore || !sessionRef) return false;

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

            const messagesRef = collection(firestore, 'storySessions', sessionId, 'messages');
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

    /**
     * Creates a story character using the unified API endpoint.
     * Returns the character ID and display name if successful.
     */
    const createStoryCharacter = async (chosenOption: Choice): Promise<{ characterId: string; displayName: string } | null> => {
        if (!session) return null;

        const label = chosenOption.newCharacterLabel || 'New Friend';
        const storyTypeContext = activeStoryType?.name || 'adventure';
        const recentStory = messages?.slice(0, 3).map(m => m.text).join(' ') || '';
        const storyContext = `A ${storyTypeContext} story about ${childProfile?.displayName || 'a child'}. Recent events: ${recentStory.slice(0, 200)}`;

        try {
            const response = await fetch('/api/characters/create', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    sessionId,
                    parentUid: session.parentUid,
                    childId: session.childId,
                    characterLabel: label,
                    characterName: chosenOption.newCharacterName,
                    characterType: chosenOption.newCharacterType || 'Friend',
                    storyContext,
                    childAge: childProfile?.dateOfBirth ? getChildAgeYears(childProfile) : null,
                    generateAvatar: true,
                }),
            });

            const result = await response.json();
            if (!response.ok || !result.ok) {
                console.error('[createStoryCharacter] Failed:', result.errorMessage);
                return null;
            }

            // Trigger async avatar generation (don't wait for it)
            if (user && result.characterId) {
                const idToken = await user.getIdToken();
                fetch('/api/generateCharacterAvatar', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${idToken}`,
                    },
                    body: JSON.stringify({ characterId: result.characterId }),
                }).catch(err => console.error('Avatar generation failed:', err));
            }

            return {
                characterId: result.characterId,
                displayName: result.character?.displayName || label,
            };
        } catch (e: any) {
            console.error('[createStoryCharacter] Error:', e);
            return null;
        }
    };

    const generateEndingChoices = useCallback(async () => {
        if (!firestore || !sessionRef || hasEndingOptions) return;
        setIsEndingRunning(true);
        setEndingDiagnostics(prev => ({ ...prev, lastEndingErrorMessage: null }));
        try {
            const response = await fetch('/api/storyEnding', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ sessionId }),
            });
            const result = await response.json();
            if (!response.ok || !result.ok) {
                throw new Error(result.errorMessage || 'An unknown error occurred in ending flow.');
            }
            const endings: Choice[] = result.endings.map((ending: { id: string; text: string }) => ({
                id: ending.id,
                text: ending.text,
            }));
            const messagesRef = collection(firestore, 'storySessions', sessionId, 'messages');
            await addDoc(messagesRef, {
                sender: 'assistant',
                text: 'Here are a few endings. Pick your favorite to finish the book!',
                kind: 'system_status',
                createdAt: serverTimestamp(),
            });
            await addDoc(messagesRef, {
                sender: 'assistant',
                text: 'Which ending do you like best?',
                kind: 'ending_options',
                options: endings,
                createdAt: serverTimestamp(),
            });
            await updateDoc(sessionRef, {
                currentPhase: 'ending',
                updatedAt: serverTimestamp(),
                'progress.storyArcCompletedAt': serverTimestamp(),
            });
            setEndingDiagnostics({
                lastEndingOk: true,
                lastEndingErrorMessage: null,
                lastEndingStoryTypeId: result.storyTypeId,
                lastEndingArcStep: result.arcStep,
                lastEndingPreview: endings[0]?.text.slice(0, 80) || null,
            });
            await logClientStage('ending.presented', { endings: endings.length });
        } catch (e: any) {
            setEndingDiagnostics(prev => ({ ...prev, lastEndingOk: false, lastEndingErrorMessage: e.message }));
            toast({ title: 'Error running ending flow', description: e.message, variant: 'destructive' });
        } finally {
            setIsEndingRunning(false);
        }
    }, [firestore, sessionRef, hasEndingOptions, sessionId, toast, logClientStage]);

    const handleRunStoryBeat = async () => {
        if (!user || !sessionId || !firestore) return;
        if (!session?.storyTypeId) {
            toast({ title: "Cannot run beat", description: "Session must have a story type and phase ID.", variant: "destructive" });
            return;
        }
        await runBeatAndAppendMessages();
    };

    const handleRunEndingFlow = async () => {
        await generateEndingChoices();
    };
    
    const handleChooseOption = async (optionsMessage: Message, chosenOption: Choice) => {
        if (!user || !sessionId || !firestore || !sessionRef || !session || isBeatRunning || !session.storyTypeId) return;

        const messagesRef = collection(firestore, 'storySessions', sessionId, 'messages');

        let newCharacterId: string | undefined = undefined;
        let newCharacterDisplayName: string | undefined = undefined;
        let traitsQuestionAsked = false;

        // Write child's choice message first
        await addDoc(messagesRef, {
            sender: 'child',
            text: chosenOption.text,
            kind: 'child_choice',
            selectedOptionId: chosenOption.id,
            createdAt: serverTimestamp(),
        });

        // 1. If the option introduces a character, create it first using the unified API
        if (chosenOption.introducesCharacter) {
            const characterResult = await createStoryCharacter(chosenOption);
            if (characterResult) {
                newCharacterId = characterResult.characterId;
                newCharacterDisplayName = characterResult.displayName;
                // Ask a traits question
                traitsQuestionAsked = await runCharacterTraitsQuestion(sessionId, newCharacterId, newCharacterDisplayName);
            }
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
            let arcSteps = activeStoryType?.arcTemplate?.steps;
            if (!arcSteps && session?.storyTypeId) {
                const storyTypeRef = doc(firestore, 'storyTypes', session.storyTypeId);
                const storyTypeDoc = await getDoc(storyTypeRef);
                const fallbackType = storyTypeDoc.data() as StoryType;
                arcSteps = fallbackType.arcTemplate?.steps;
            }
            const stepsArray = arcSteps ?? [];
            const totalSteps = stepsArray.length;
            const currentIndex = session.arcStepIndex ?? 0;
            let nextIndex = currentIndex + 1;
            const maxIndex = totalSteps > 0 ? totalSteps - 1 : 0;
            let reachedEnd = false;
            if (totalSteps > 0) {
                if (nextIndex > maxIndex) {
                    reachedEnd = true;
                    nextIndex = maxIndex;
                }
            } else {
                reachedEnd = true;
            }
            await updateDoc(sessionRef, {
                arcStepIndex: nextIndex,
                updatedAt: serverTimestamp(),
            });

            setBeatInteractionDiagnostics(prev => ({
                ...prev,
                lastArcStepIndexAfterChoice: nextIndex,
            }));
            if (reachedEnd) {
                await logClientStage('arc.completed', { totalSteps: totalSteps || null });
                await generateEndingChoices();
            } else {
                await runBeatAndAppendMessages();
            }
        }
    };

    const handleChooseEnding = async (_optionsMessage: Message, chosenOption: Choice) => {
        if (!sessionRef || !firestore || session?.selectedEndingId) return;
        const messagesRef = collection(firestore, 'storySessions', sessionId, 'messages');
        await addDoc(messagesRef, {
            sender: 'child',
            text: chosenOption.text,
            kind: 'child_ending_choice',
            selectedOptionId: chosenOption.id,
            createdAt: serverTimestamp(),
        });
        await updateDoc(sessionRef, {
            selectedEndingId: chosenOption.id,
            selectedEndingText: chosenOption.text,
            updatedAt: serverTimestamp(),
            'progress.endingChosenAt': serverTimestamp(),
        });
        await logClientStage('ending.chosen', { endingId: chosenOption.id });
        toast({
            title: 'Ending selected',
            description: 'Great choice! Compiling your story...',
        });
        await triggerCompile();
    };
    
    const triggerCompile = useCallback(async () => {
        if (!sessionRef || !firestore) return;
        if (isCompiling) return;
        if (session?.status === 'completed' && storyBook) return;
        if (!selectedOutputTypeId) {
            toast({ title: 'Please select an output type', variant: 'destructive' });
            return;
        }

        setIsCompiling(true);
        setCompileError(null);
        try {
            await logClientStage('compile.started', { storyOutputTypeId: selectedOutputTypeId });
            const response = await fetch('/api/storyCompile', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ sessionId, storyOutputTypeId: selectedOutputTypeId }),
            });
            const result = await response.json();

            // Update compile diagnostics regardless of success/failure
            setCompileDiagnostics({
                lastCompileOk: response.ok && result?.ok,
                lastCompileErrorMessage: result?.errorMessage || null,
                extractedActorIds: result?.extractedActorIds || null,
                finalActorIds: result?.actors || null,
                storyId: result?.storyId || null,
            });

            if (!response.ok || !result?.ok) {
                throw new Error(result?.errorMessage || 'Failed to compile story.');
            }
            setHasTriggeredCompile(true);
            toast({ title: 'Story created!', description: 'Taking you to your stories...' });

            // Redirect child back to their stories list
            if (session?.childId) {
                router.push(`/child/${session.childId}/stories`);
            }
        } catch (e: any) {
            setCompileError(e.message || 'Compile failed.');
            toast({ title: 'Compile failed', description: e.message, variant: 'destructive' });
            // Update diagnostics on error as well
            setCompileDiagnostics(prev => ({
                ...prev,
                lastCompileOk: false,
                lastCompileErrorMessage: e.message || 'Compile failed.',
            }));
        } finally {
            setIsCompiling(false);
        }
    }, [sessionRef, firestore, isCompiling, session?.status, session?.childId, storyBook, sessionId, logClientStage, toast, selectedOutputTypeId, router]);

    const handleGeneratePages = async () => {
        if (!storyBook) {
            toast({ title: 'Story not compiled yet', description: 'Compile your story before building pages.' });
            return;
        }
        if (isGeneratingPages) return;
        setIsGeneratingPages(true);
        setPagesError(null);
        try {
            // Use sessionId as storyId since stories are stored with sessionId as their doc ID
            const storyId = storyBook.id || sessionId;
            await logClientStage('pages.started', { storyId });
            const response = await fetch('/api/storyBook/pages', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ storyId }),
            });
            const result = await response.json();
            if (!response.ok || !result?.ok) {
                throw new Error(result?.errorMessage || 'Page generation failed.');
            }
            toast({ title: 'Pages queued', description: 'We are laying out your storybook pages.' });
        } catch (e: any) {
            setPagesError(e.message || 'Page generation failed.');
            toast({ title: 'Page generation failed', description: e.message, variant: 'destructive' });
        } finally {
            setIsGeneratingPages(false);
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

            const messagesRef = collection(firestore, 'storySessions', sessionId, 'messages');
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
            sessionActors: session?.actors || [],
        },
        storyBook: {
            hasStoryBook: !!storyBook,
            status: storyBook?.status || null,
            loading: storyBookLoading,
            error: storyBookError?.message || null,
            pageGeneration: storyBook?.pageGeneration ?? null,
        },
        genkitWarmup: warmupDiagnostics,
        genkitBeat: beatDiagnostics,
        genkitEnding: endingDiagnostics,
        beatInteraction: beatInteractionDiagnostics,
        characterTraits: characterTraitsDiagnostics,
        compile: compileDiagnostics,
        error: sessionError?.message || messagesError?.message || null,
    };

    const handleGenerateArt = async (force = false) => {
        // Use sessionId as storyId since stories are stored with sessionId as their doc ID
        const storyId = storyBook?.id || sessionId;
        if (!storyId) {
            setImageJobError('Storybook not available for this session yet.');
            return;
        }
        setIsImageJobRunning(true);
        setImageJobError(null);
        try {
            await logClientStage('art.started', { storyId, force });
            const response = await fetch('/api/storyBook/images', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    storyId,
                    forceRegenerate: force,
                }),
            });
            const result = await response.json();
            if (!response.ok || !result?.ok) {
                throw new Error(result?.errorMessage || 'Failed to generate art.');
            }
            toast({ title: 'Art generation started', description: `Status: ${result.status}` });
        } catch (error: any) {
            const message = error?.message || 'Unexpected art generation error.';
            setImageJobError(message);
            toast({ title: 'Art generation failed', description: message, variant: 'destructive' });
        } finally {
            setIsImageJobRunning(false);
        }
    };

    const renderCreateBookPanel = () => {
        if (!session) return null;
        const isGeminiMode = session.storyMode === 'gemini3' || session.storyMode === 'gemini4';
        const geminiFinalStory = session.gemini4FinalStory || session.gemini3FinalStory;
        const compileReady = !!storyBook; // Only ready when Story document exists
        // For gemini modes, show panel when story is complete; for other modes, require selectedEndingId
        const showPanel = (isGeminiMode && geminiFinalStory) || session.selectedEndingId || compileReady;
        if (!showPanel) return null;
        const compileStatus: 'pending' | 'running' | 'ready' = compileReady ? 'ready' : isCompiling ? 'running' : 'pending';
        const pagesStatus: 'pending' | 'running' | 'ready' = storyBook?.pageGeneration?.status === 'ready'
            ? 'ready'
            : storyBook?.pageGeneration?.status === 'running' || isGeneratingPages
                ? 'running'
                : 'pending';
        const artStatus: 'pending' | 'running' | 'ready' = storyBook?.imageGeneration?.status === 'ready'
            ? 'ready'
            : storyBook?.imageGeneration?.status === 'running' || isImageJobRunning
                ? 'running'
                : 'pending';
        const statusBadge = (status: 'pending' | 'running' | 'ready') => (
            <Badge variant={status === 'ready' ? 'secondary' : status === 'running' ? 'outline' : 'default'}>
                {status === 'ready' ? 'Ready' : status === 'running' ? 'In progress' : 'Waiting'}
            </Badge>
        );

        return (
            <Card className="w-full max-w-2xl">
                <CardHeader>
                    <CardTitle>Create My Book</CardTitle>
                    <CardDescription>Follow these steps to turn the story into a shareable picture book.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                    <div className="grid gap-2">
                        <Label htmlFor="output-type-select">Output Format</Label>
                        <Select value={selectedOutputTypeId} onValueChange={setSelectedOutputTypeId} disabled={outputTypesLoading || !storyOutputTypes}>
                            <SelectTrigger id="output-type-select">
                                <SelectValue placeholder={outputTypesLoading ? "Loading formats..." : "Select a format"} />
                            </SelectTrigger>
                            <SelectContent>
                                {storyOutputTypes?.map((type) => (
                                    <SelectItem key={type.id} value={type.id}>
                                        {type.name}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                        {storyOutputTypes?.find(t => t.id === selectedOutputTypeId)?.shortDescription && (
                            <p className="text-xs text-muted-foreground">{storyOutputTypes.find(t => t.id === selectedOutputTypeId)?.shortDescription}</p>
                        )}
                    </div>

                    <div className="flex items-center justify-between gap-4">
                        <div>
                            <p className="font-semibold">1. Compile Story Text</p>
                            <p className="text-sm text-muted-foreground">Bundle the chat into a smooth story.</p>
                            {compileError && <p className="text-xs text-destructive mt-1">{compileError}</p>}
                        </div>
                        <div className="flex items-center gap-2">
                            {statusBadge(compileStatus)}
                            <Button size="sm" variant="outline" onClick={triggerCompile} disabled={compileStatus === 'ready' || isCompiling || !selectedOutputTypeId}>
                                {isCompiling ? <LoaderCircle className="mr-2 h-4 w-4 animate-spin" /> : null}
                                {compileStatus === 'ready' ? 'Compiled' : 'Compile'}
                            </Button>
                        </div>
                    </div>
                    <div className="flex items-center justify-between gap-4">
                        <div>
                            <p className="font-semibold">2. Build Pages</p>
                            <p className="text-sm text-muted-foreground">Lay out each page with headings and prompts.</p>
                            {pagesError && <p className="text-xs text-destructive mt-1">{pagesError}</p>}
                            {storyBook?.pageGeneration?.lastErrorMessage && (
                                <p className="text-xs text-destructive mt-1">{storyBook.pageGeneration.lastErrorMessage}</p>
                            )}
                        </div>
                        <div className="flex items-center gap-2">
                            {statusBadge(pagesStatus)}
                            <Button
                                size="sm"
                                variant="outline"
                                onClick={handleGeneratePages}
                                disabled={!compileReady || pagesStatus === 'ready' || isGeneratingPages}
                            >
                                {isGeneratingPages ? <LoaderCircle className="mr-2 h-4 w-4 animate-spin" /> : null}
                                {pagesStatus === 'ready' ? 'Pages Ready' : 'Generate Pages'}
                            </Button>
                        </div>
                    </div>
                    <div className="flex items-center justify-between gap-4">
                        <div>
                            <p className="font-semibold">3. Paint Art</p>
                            <p className="text-sm text-muted-foreground">Create watercolor scenes for each page.</p>
                            {imageJobError && <p className="text-xs text-destructive mt-1">{imageJobError}</p>}
                            {storyBook?.imageGeneration?.lastErrorMessage && (
                                <p className="text-xs text-destructive mt-1">{storyBook.imageGeneration.lastErrorMessage}</p>
                            )}
                        </div>
                        <div className="flex items-center gap-2">
                            {statusBadge(artStatus)}
                            <Button
                                size="sm"
                                variant="outline"
                                onClick={() => handleGenerateArt(false)}
                                disabled={!compileReady || pagesStatus !== 'ready' || isImageJobRunning || artStatus === 'ready'}
                            >
                                {isImageJobRunning ? <LoaderCircle className="mr-2 h-4 w-4 animate-spin" /> : null}
                                {artStatus === 'ready' ? 'Art Ready' : 'Generate Art'}
                            </Button>
                        </div>
                    </div>

                    {/* Show prominent next step when all steps are complete */}
                    {artStatus === 'ready' && (
                        <div className="mt-6 pt-6 border-t">
                            <div className="bg-gradient-to-r from-emerald-50 to-teal-50 dark:from-emerald-950 dark:to-teal-950 rounded-lg p-6 text-center">
                                <CheckCircle className="mx-auto h-12 w-12 text-emerald-500 mb-3" />
                                <h3 className="text-xl font-bold mb-2">Your Storybook is Ready!</h3>
                                <p className="text-muted-foreground mb-4">All pages have been illustrated. View your finished storybook now.</p>
                                <Button size="lg" asChild>
                                    <Link href={`/story/${storyBook?.id || sessionId}`}>
                                        View My Story
                                    </Link>
                                </Button>
                            </div>
                        </div>
                    )}
                </CardContent>
            </Card>
        );
    };

    const renderProgressTracker = () => {
        if (!session) return null;
        const warmupComplete = session.currentPhase !== 'warmup' && !!session.storyTypeId;
        const storyComplete = session.currentPhase === 'ending' || session.status === 'completed';
        const endingComplete = !!session.selectedEndingId;
        const compileComplete = !!storyBook;
        const pagesComplete = storyBook?.pageGeneration?.status === 'ready';
        const artComplete = storyBook?.imageGeneration?.status === 'ready';
        const steps = [
            { key: 'warmup', label: 'Warmup', complete: warmupComplete, active: session.currentPhase === 'warmup' },
            { key: 'story', label: 'Story', complete: storyComplete, active: session.currentPhase === 'story' },
            { key: 'ending', label: 'Ending', complete: endingComplete, active: !endingComplete && session.currentPhase === 'ending' },
            { key: 'compile', label: 'Compile', complete: compileComplete, active: isCompiling },
            { key: 'pages', label: 'Pages', complete: pagesComplete, active: isGeneratingPages || storyBook?.pageGeneration?.status === 'running' },
            { key: 'art', label: 'Art', complete: artComplete, active: isImageJobRunning || storyBook?.imageGeneration?.status === 'running' },
        ];
        return (
            <div className="rounded-lg border bg-muted/40 px-4 py-3 flex flex-wrap items-center gap-3">
                {steps.map((step, index) => (
                    <div key={step.key} className="flex items-center gap-2">
                        <div
                            className={cn(
                                'h-3 w-3 rounded-full border',
                                step.complete
                                    ? 'bg-green-500 border-green-500'
                                    : step.active
                                        ? 'bg-primary border-primary'
                                        : 'bg-muted-foreground/30 border-muted-foreground/30'
                            )}
                        />
                        <span
                            className={cn(
                                'text-xs font-semibold',
                                step.complete ? 'text-foreground' : step.active ? 'text-primary' : 'text-muted-foreground'
                            )}
                        >
                            {step.label}
                        </span>
                        {index < steps.length - 1 && <div className="h-px w-8 bg-border" />}
                    </div>
                ))}
            </div>
        );
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
        const hasStoryBook = !!storyBook;
        const storyBookHelperText = hasStoryBook
            ? null
            : storyBookLoading
                ? 'Checking for a compiled story...'
                : session.status === 'completed'
                    ? 'Run the compile action to unlock the finished text.'
                    : 'Finish this session to generate the storybook.';
        const imageStatus = storyBook?.imageGeneration?.status ?? 'idle';
        const imageReadyCount = storyBook?.imageGeneration?.pagesReady ?? 0;
        const imageTotal = storyBook?.imageGeneration?.pagesTotal ?? storyBook?.pageGeneration?.pagesCount ?? 0;
        const viewerHref = storyBook?.id ? `/story/${storyBook.id}` : `/story/${sessionId}`;
        
        const showStoryTypePicker = !session.storyTypeId && curatedStoryTypes.length > 0;

        if (showStoryTypePicker) {
            return (
                <Card>
                    <CardHeader>
                        <CardTitle>Pick Your Kind of Story</CardTitle>
                        <CardDescription>The Story Guide suggests these based on favorite colors, foods, and games.</CardDescription>
                    </CardHeader>
                    <CardContent className="grid grid-cols-1 gap-4">
                        {curatedStoryTypes.map((type) => (
                            <Card key={type.id} className="border-muted">
                                <CardHeader>
                                    <CardTitle>{type.name}</CardTitle>
                                    <CardDescription>{type.shortDescription}</CardDescription>
                                </CardHeader>
                                <CardContent>
                                    <div className="flex flex-wrap gap-2 mb-3">
                                        {type.tags?.map((tag) => (
                                            <Badge key={tag} variant="outline">{tag}</Badge>
                                        ))}
                                    </div>
                                </CardContent>
                                <CardFooter>
                                    <Button className="w-full" onClick={() => handleStoryTypeSelect(type)} disabled={isSelectingStoryType}>
                                        {isSelectingStoryType ? <LoaderCircle className="mr-2 h-4 w-4 animate-spin" /> : null}
                                        {isSelectingStoryType ? 'Preparing...' : 'Tell this story'}
                                    </Button>
                                </CardFooter>
                            </Card>
                        ))}
                    </CardContent>
                </Card>
            );
        }

        return (
            <>
             <Card className="w-full max-w-2xl flex flex-col">
                <CardHeader>
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                        <div>
                            <CardTitle>Story Chat</CardTitle>
                            <CardDescription>Session ID: <span className="font-mono">{sessionId}</span></CardDescription>
                        </div>
                        <div className="flex flex-col gap-1 w-full sm:w-auto">
                            {hasStoryBook ? (
                                <Button asChild size="sm" variant="secondary">
                                    <Link href={`/story/session/${sessionId}/compiled`}>View Compiled Story</Link>
                                </Button>
                            ) : (
                                <Button size="sm" variant="secondary" disabled>
                                    {storyBookLoading ? 'Checking…' : 'View Compiled Story'}
                                </Button>
                            )}
                            {storyBookHelperText && (
                                <span className="text-xs text-muted-foreground text-center sm:text-left">{storyBookHelperText}</span>
                            )}
                            {storyBookError && (
                                <span className="text-xs text-destructive text-center sm:text-left">Storybook error: {storyBookError.message}</span>
                            )}
                            {hasStoryBook && (
                                <div className="mt-4 rounded-md border border-dashed bg-muted/30 p-3 text-xs sm:text-sm space-y-2">
                                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                                        <div>
                                            <p className="font-semibold text-sm">Storybook Art</p>
                                            <p className="text-muted-foreground">
                                                Status: {imageStatus} · {imageReadyCount}/{imageTotal} ready
                                            </p>
                                            {storyBook?.imageGeneration?.status === 'ready' && (
                                                <p className="text-green-600 font-semibold text-xs mt-1">All done! Open the storybook to read & share.</p>
                                            )}
                                        </div>
                                        <div className="flex flex-wrap gap-2">
                                            <Button
                                                size="sm"
                                                variant="outline"
                                                onClick={() => handleGenerateArt(false)}
                                                disabled={isImageJobRunning || imageStatus === 'running'}
                                            >
                                                {isImageJobRunning ? (
                                                    <LoaderCircle className="mr-1 h-3 w-3 animate-spin" />
                                                ) : (
                                                    <ImageIcon className="mr-1 h-3.5 w-3.5" />
                                                )}
                                                Generate Art
                                            </Button>
                                            <Button size="sm" variant="ghost" asChild>
                                                <Link href={viewerHref}>Open Storybook</Link>
                                            </Button>
                                        </div>
                                    </div>
                                    {imageJobError && (
                                        <p className="text-destructive">{imageJobError}</p>
                                    )}
                                </div>
                            )}
                        </div>
                    </div>
                </CardHeader>
                <CardContent className="flex-grow overflow-y-auto pr-6 space-y-4">
                   {messagesLoading && <div className="flex items-center gap-2"><LoaderCircle className="animate-spin mr-2" />Loading messages...</div>}
                   {messagesError && <p className="text-destructive">Error loading messages: {messagesError.message}</p>}
                   {messages && messages.map((msg: Message) => (
                       <div key={msg.id} className={`flex flex-col ${msg.sender === 'child' ? 'items-end' : 'items-start'}`}>
                            {msg.kind === 'beat_options' && msg.options ? (
                                <div className="p-2 rounded-lg bg-muted w-full">
                                    <p className="text-sm text-muted-foreground mb-2">{getResolvedText(msg.text)}</p>
                                    <div className="flex flex-col gap-2">
                                        {msg.options.map(opt => (
                                            <Button
                                                key={opt.id}
                                                variant="outline"
                                                onClick={() => handleChooseOption(msg, opt)}
                                                disabled={isBeatRunning || isGeneratingMoreOptions || latestOptionsMessage?.id !== msg.id || isWaitingForTraitsAnswer || session.currentPhase !== 'story'}
                                                className="justify-start h-auto"
                                            >
                                                <div className="flex items-center gap-2">
                                                    <span>{getResolvedText(opt.text)}</span>
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
                                            disabled={isBeatRunning || isGeneratingMoreOptions || latestOptionsMessage?.id !== msg.id || isWaitingForTraitsAnswer || session.currentPhase !== 'story'}
                                        >
                                           <RefreshCw className="mr-2 h-4 w-4"/> More choices
                                        </Button>
                                    </div>
                                </div>
                            ) : msg.kind === 'ending_options' && msg.options ? (
                                <div className="p-2 rounded-lg bg-secondary/50 w-full">
                                    <p className="text-sm text-muted-foreground mb-2">Pick your favorite ending:</p>
                                    <div className="flex flex-col gap-2">
                                        {msg.options.map(opt => (
                                            <Button
                                                key={opt.id}
                                                variant="secondary"
                                                onClick={() => handleChooseEnding(msg, opt)}
                                                disabled={!!session.selectedEndingId || isCompiling}
                                                className="justify-start h-auto"
                                            >
                                                <div className="flex items-center gap-2">
                                                    <Star className="h-3.5 w-3.5 text-amber-500" />
                                                    <span>{getResolvedText(opt.text)}</span>
                                                </div>
                                            </Button>
                                        ))}
                                    </div>
                                </div>
                            ) : (
                               <>
                                <span className="text-xs font-bold text-muted-foreground">
                                    {msg.sender === 'assistant' ? 'Story Guide' : 'You'}
                                </span>
                                <p className={`whitespace-pre-wrap p-2 rounded-md ${msg.sender === 'child' ? 'bg-primary text-primary-foreground' : 'bg-muted'}`}>
                                    {getResolvedText(msg.text)}
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
            </>
        )
    };
    
    const renderAdminControls = () => {
        if (adminLoading || !isAdmin) {
            return null;
        }

        const canRunBeat = !!session?.storyTypeId;
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

    const isStoryCompleted = session?.status === 'completed';
    const isGeminiMode = session?.storyMode === 'gemini3' || session?.storyMode === 'gemini4';
    const geminiFinalStory = session?.gemini4FinalStory || session?.gemini3FinalStory;

    const renderGeminiCompletedStory = () => {
        if (!geminiFinalStory) return null;

        // Get the resolved version from messages if available
        const finalMessage = messages?.find(m => m.kind === 'gemini4_final_story' || m.kind === 'gemini3_final_story');
        const displayText = finalMessage?.textResolved || geminiFinalStory;

        return (
            <Card className="w-full max-w-2xl">
                <CardHeader>
                    <CardTitle>{session?.storyTitle || 'Your Story'}</CardTitle>
                    <CardDescription>
                        Created with {session?.storyMode === 'gemini4' ? 'Guided Story' : 'Gemini 3'}
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    <div className="bg-gradient-to-br from-emerald-50 to-teal-50 dark:from-emerald-950 dark:to-teal-950 rounded-lg p-6">
                        <p className="text-lg whitespace-pre-wrap leading-relaxed">{displayText}</p>
                    </div>
                </CardContent>
                <CardFooter className="flex gap-2">
                    <Button variant="outline" onClick={() => router.push(`/story/play/${sessionId}`)}>
                        View Journey
                    </Button>
                </CardFooter>
            </Card>
        );
    };

    return (
        <div className="container mx-auto p-4 sm:p-6 md:p-8 flex flex-col items-center gap-8">
            {/* Show completed Gemini story */}
            {isStoryCompleted && isGeminiMode && geminiFinalStory && (
                <div className="w-full max-w-2xl">
                    {renderGeminiCompletedStory()}
                </div>
            )}

            {/* Only show chat if story is not completed */}
            {!isStoryCompleted && (
                <div className="w-full max-w-2xl">
                  {renderChatContent()}
                </div>
            )}

            <div className="w-full max-w-2xl">
                {renderCreateBookPanel()}
            </div>

            {/* Admin controls always visible for admins */}
            <div className="w-full max-w-2xl">
                {renderAdminControls()}
            </div>

            <DiagnosticsPanel
                pageName="story-session"
                data={diagnostics}
                className="w-full max-w-4xl"
            />
        </div>
    );
}
