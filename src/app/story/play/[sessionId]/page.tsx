
'use client';

import { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useUser } from '@/firebase/auth/use-user';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { LoaderCircle, CheckCircle, RefreshCw, Sparkles, Star, Bot, Settings, Copy } from 'lucide-react';
import Link from 'next/link';
import { useFirestore } from '@/firebase';
import { doc, collection, addDoc, serverTimestamp, query, orderBy, updateDoc, writeBatch, getDocs, limit, arrayUnion, DocumentReference, getDoc, increment, where } from 'firebase/firestore';
import type { StorySession, ChatMessage as Message, Choice, Character, StoryType, StoryBook, ChildProfile, StoryOutputType } from '@/lib/types';
import { useCollection, useDocument } from '@/lib/firestore-hooks';
import { useToast } from '@/hooks/use-toast';
import { useStoryTTS } from '@/hooks/use-story-tts';
import { useBackgroundMusic } from '@/hooks/use-background-music';
import { Badge } from '@/components/ui/badge';
import { logSessionEvent } from '@/lib/session-events';
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar';
import { ChoiceButton, CharacterIntroductionCard, type ChoiceWithEntities } from '@/components/story';
import { ChildAvatarAnimation } from '@/components/child/child-avatar-animation';
import { SpeechModeToggle } from '@/components/child/speech-mode-toggle';

// Helper to extract $$id$$ placeholders from text
function extractActorIdsFromText(text: string): string[] {
    const regex = /\$\$([a-zA-Z0-9_-]+)\$\$/g;
    const ids = new Set<string>();
    let match;
    while ((match = regex.exec(text)) !== null) {
        ids.add(match[1]);
    }
    return Array.from(ids);
}

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


export default function StoryPlayPage() {
    const params = useParams<{ sessionId: string }>();
    const sessionId = params.sessionId;
    const router = useRouter();
    const { user, loading: userLoading } = useUser();
    const firestore = useFirestore();
    const { toast } = useToast();
    
    const [isProcessing, setIsProcessing] = useState(false);
    const [isSelectingStoryType, setIsSelectingStoryType] = useState(false);
    const [isCompiling, setIsCompiling] = useState(false);
    const [hasAutoCompiled, setHasAutoCompiled] = useState(false);

    // Track the last message ID that was spoken to avoid replaying
    const lastSpokenMessageIdRef = useRef<string | null>(null);

    // State for character introduction flow
    const [introducingCharacter, setIntroducingCharacter] = useState<{
        characterId: string;
        characterName: string;
        characterLabel: string;
        characterType: string;
        chosenOption: Choice;
    } | null>(null);
    
    const sessionRef = useMemo(() => firestore ? doc(firestore, 'storySessions', sessionId) : null, [firestore, sessionId]);
    const { data: session, loading: sessionLoading, error: sessionError } = useDocument<StorySession>(sessionRef);
    const messagesQuery = useMemo(() => firestore ? query(collection(firestore, 'storySessions', sessionId, 'messages'), orderBy('createdAt', 'desc'), limit(5)) : null, [firestore, sessionId]);
    const { data: recentMessages, loading: messagesLoading, error: messagesError } = useCollection<Message>(messagesQuery);
    const childRef = useMemo(() => (session?.childId && firestore) ? doc(firestore, 'children', session.childId) : null, [firestore, session?.childId]);
    const { data: childProfile } = useDocument<ChildProfile>(childRef);

    // TTS for speech mode
    const { isSpeechModeEnabled, speakStoryContent, stopSpeech, isSpeaking, isLoading: isTTSLoading } = useStoryTTS({
        childProfile: childProfile ?? null,
        onError: (error) => toast({ title: 'Speech error', description: error, variant: 'destructive' }),
    });

    const storyTypesQuery = useMemo(() => firestore ? query(collection(firestore, 'storyTypes'), where('status', '==', 'live')) : null, [firestore]);
    const { data: storyTypes } = useCollection<StoryType>(storyTypesQuery);

    // Get the active story type for background music
    const activeStoryType = useMemo(() => {
        if (!storyTypes || !session?.storyTypeId) return null;
        return storyTypes.find((type) => type.id === session.storyTypeId) ?? null;
    }, [storyTypes, session?.storyTypeId]);

    // Background music during story generation
    const backgroundMusicUrl = activeStoryType?.backgroundMusic?.audioUrl;
    const backgroundMusic = useBackgroundMusic({
        audioUrl: backgroundMusicUrl,
        isSpeaking, // Duck when TTS speaks
        normalVolume: 0.4,
        duckedVolume: 0.1,
    });

    // Start/stop background music based on processing state, avatar visibility, TTS loading/speaking
    // Music plays during: processing, TTS loading, or TTS speaking (ducked when speaking)
    useEffect(() => {
        const hasAvatar = childProfile?.avatarAnimationUrl || childProfile?.avatarUrl;
        const isShowingAvatar = isProcessing || (isSpeechModeEnabled && isTTSLoading);
        const shouldPlayMusic = (isShowingAvatar && hasAvatar && backgroundMusicUrl) || (isSpeaking && backgroundMusicUrl);

        if (shouldPlayMusic && backgroundMusic.isLoaded && !backgroundMusic.isPlaying) {
            backgroundMusic.play();
        } else if (!shouldPlayMusic && backgroundMusic.isPlaying) {
            backgroundMusic.fadeOut();
        }
    }, [isProcessing, childProfile?.avatarAnimationUrl, childProfile?.avatarUrl, backgroundMusicUrl, backgroundMusic, isSpeaking, isSpeechModeEnabled, isTTSLoading]);

    // Cleanup background music on unmount
    useEffect(() => {
        return () => {
            backgroundMusic.stop();
        };
    }, [backgroundMusic.stop]);

    const storyOutputTypesQuery = useMemo(() => firestore ? query(collection(firestore, 'storyOutputTypes'), where('status', '==', 'live')) : null, [firestore]);
    const { data: storyOutputTypes } = useCollection<StoryOutputType>(storyOutputTypesQuery);

    // Fetch character document when introducing a character (for live avatar updates)
    const introducingCharacterRef = useMemo(() =>
        (introducingCharacter?.characterId && firestore)
            ? doc(firestore, 'characters', introducingCharacter.characterId)
            : null,
        [firestore, introducingCharacter?.characterId]
    );
    const { data: introducingCharacterData } = useDocument<Character>(introducingCharacterRef);

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
                return { type, score: tagMatches, matchesAge: matchesChildAge(type, childAge) };
            })
            .filter(({ matchesAge }) => matchesAge)
            .sort((a, b) => b.score - a.score)
            .slice(0, 4)
            .map(({ type }) => type);
    }, [storyTypes, preferenceKeywords, childAge]);

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
            // No warmup phase - go directly to story
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

            const { storyContinuation, storyContinuationResolved, options, optionsResolved, debug: flowDebug } = flowResult;

            // Extract actor IDs from story continuation and options
            const continuationActorIds = extractActorIdsFromText(storyContinuation || '');
            const optionActorIds = options?.flatMap((opt: Choice) => extractActorIdsFromText(opt.text || '')) || [];
            const newActorIds = [...new Set([...continuationActorIds, ...optionActorIds])];

            const messagesRef = collection(firestore, 'storySessions', sessionId, 'messages');
            const batch = writeBatch(firestore);
            // Store original with placeholders, but also store resolved version for display
            batch.set(doc(messagesRef), {
                sender: 'assistant',
                text: storyContinuation,
                textResolved: storyContinuationResolved,
                kind: 'beat_continuation',
                createdAt: serverTimestamp()
            });
            batch.set(doc(messagesRef), {
                sender: 'assistant',
                text: "What happens next?",
                kind: 'beat_options',
                options: options,
                optionsResolved: optionsResolved,
                createdAt: serverTimestamp()
            });

            // Update session with new actor IDs (using arrayUnion to avoid duplicates)
            if (newActorIds.length > 0) {
                batch.update(sessionRef, {
                    actors: arrayUnion(...newActorIds),
                    updatedAt: serverTimestamp(),
                });
            }

            // Store debug information in session for diagnostics
            const debugUpdate: Record<string, any> = {
                'debug.lastUpdatedAt': serverTimestamp(),
                'debug.lastExtractedActorIds': newActorIds,
                'debug.lastStoryContinuationPreview': (storyContinuation || '').substring(0, 200),
            };
            if (flowDebug) {
                debugUpdate['debug.lastPrompt'] = flowDebug.fullPrompt || flowDebug.promptPreview || 'Not available';
                debugUpdate['debug.lastFlowDebug'] = flowDebug;
            }
            batch.update(sessionRef, debugUpdate);

            await batch.commit();

        } catch (e: any) {
            toast({ title: "Error running beat", description: e.message, variant: "destructive" });
        } finally {
             setIsProcessing(false);
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
        const recentStory = recentMessages?.slice(0, 3).map(m => m.text).join(' ') || '';
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

            // Extract actor IDs from endings
            const endingActorIds = endings.flatMap((ending: Choice) => extractActorIdsFromText(ending.text || ''));
            const newActorIds = [...new Set(endingActorIds)];

            const messagesRef = collection(firestore, 'storySessions', sessionId, 'messages');
            const batch = writeBatch(firestore);
            batch.set(doc(messagesRef), { sender: 'assistant', text: "Which ending do you like best?", kind: 'ending_options', options: endings, createdAt: serverTimestamp() });

            // Update session with phase change and any new actor IDs
            const sessionUpdate: Record<string, any> = {
                currentPhase: 'ending',
                updatedAt: serverTimestamp(),
                'progress.storyArcCompletedAt': serverTimestamp()
            };
            if (newActorIds.length > 0) {
                sessionUpdate.actors = arrayUnion(...newActorIds);
            }
            batch.update(sessionRef, sessionUpdate);
            await batch.commit();
            await logClientStage('ending.presented', { endings: endings.length });
        } catch (e: any) {
            toast({ title: 'Error running ending flow', description: e.message, variant: 'destructive' });
        } finally {
            setIsProcessing(false);
        }
    }, [firestore, sessionRef, sessionId, toast, logClientStage]);

    const runGemini3AndAppendMessages = async () => {
        if (!firestore || !sessionRef) return;

        setIsProcessing(true);
        try {
            const response = await fetch('/api/gemini3', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ sessionId }),
            });
            const flowResult = await response.json();

            if (!response.ok || !flowResult.ok) throw new Error(flowResult.errorMessage || "An unknown API error occurred.");

            const { question, questionResolved, options, optionsResolved, isStoryComplete, finalStory, finalStoryResolved, debug: flowDebug } = flowResult;
            const messagesRef = collection(firestore, 'storySessions', sessionId, 'messages');

            // Extract actor IDs from question/story and options
            const textToScan = isStoryComplete ? (finalStory || '') : (question || '');
            const textActorIds = extractActorIdsFromText(textToScan);
            const optionActorIds = options?.flatMap((opt: Choice) => extractActorIdsFromText(opt.text || '')) || [];
            const newActorIds = [...new Set([...textActorIds, ...optionActorIds])];

            // Store debug information in session for diagnostics
            const sessionUpdates: Record<string, any> = {};
            if (flowDebug) {
                sessionUpdates['debug.lastPrompt'] = flowDebug.fullPrompt || 'Not available';
                sessionUpdates['debug.lastFlowDebug'] = flowDebug;
                sessionUpdates['debug.lastUpdatedAt'] = serverTimestamp();
            }
            // Add new actor IDs to session
            if (newActorIds.length > 0) {
                sessionUpdates.actors = arrayUnion(...newActorIds);
                sessionUpdates.updatedAt = serverTimestamp();
            }
            if (Object.keys(sessionUpdates).length > 0) {
                await updateDoc(sessionRef, sessionUpdates);
            }

            if (isStoryComplete && finalStory) {
                // Story is complete - store ORIGINAL with placeholders, but also store resolved for display
                await addDoc(messagesRef, {
                    sender: 'assistant',
                    text: finalStory, // ORIGINAL with placeholders
                    textResolved: finalStoryResolved, // Resolved for display
                    kind: 'gemini3_final_story',
                    createdAt: serverTimestamp()
                });
                await logClientStage('gemini3.completed');
            } else {
                // Continue the conversation - store ORIGINAL with placeholders, but also store resolved for display
                await addDoc(messagesRef, {
                    sender: 'assistant',
                    text: question, // ORIGINAL with placeholders
                    textResolved: questionResolved, // Resolved for display
                    kind: 'gemini3_question',
                    options: options, // ORIGINAL with placeholders
                    optionsResolved: optionsResolved, // Resolved for display
                    createdAt: serverTimestamp()
                });
            }

        } catch (e: any) {
            toast({ title: "Error running Gemini 3", description: e.message, variant: "destructive" });
        } finally {
            setIsProcessing(false);
        }
    };

    const handleChooseOption = async (chosenOption: Choice) => {
        if (!user || !sessionId || !firestore || !sessionRef || !session || isProcessing || !session.storyTypeId) return;

        setIsProcessing(true);
        const messagesRef = collection(firestore, 'storySessions', sessionId, 'messages');
        await addDoc(messagesRef, { sender: 'child', text: chosenOption.text, kind: 'child_choice', selectedOptionId: chosenOption.id, createdAt: serverTimestamp() });

        if (chosenOption.introducesCharacter) {
            // Create the character and show introduction card
            const characterResult = await createStoryCharacter(chosenOption);
            if (characterResult) {
                // Show character introduction card instead of proceeding immediately
                setIntroducingCharacter({
                    characterId: characterResult.characterId,
                    characterName: chosenOption.newCharacterName || characterResult.displayName,
                    characterLabel: chosenOption.newCharacterLabel || 'A new friend',
                    characterType: chosenOption.newCharacterType || 'Friend',
                    chosenOption,
                });
                setIsProcessing(false);
                return; // Don't proceed with story beat yet
            }
        }

        // No character introduction - proceed with story
        await proceedWithStoryBeat();
    };

    // Handler for continuing after character introduction
    const handleContinueAfterCharacterIntro = async () => {
        if (!introducingCharacter || !sessionRef || !firestore || isProcessing) return;

        setIsProcessing(true);
        // Clear the introducing character state
        setIntroducingCharacter(null);

        // Proceed with story beat
        await proceedWithStoryBeat();
    };

    // Shared logic for proceeding with story beat
    const proceedWithStoryBeat = async () => {
        if (!sessionRef || !session) {
            setIsProcessing(false);
            return;
        }

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
    };

    const handleMoreBeatOptions = async () => {
        if (!firestore || !sessionRef || isProcessing) return;

        setIsProcessing(true);
        try {
            const response = await fetch('/api/storyBeat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ sessionId }),
            });
            const flowResult = await response.json();

            if (!response.ok || !flowResult.ok) throw new Error(flowResult.errorMessage || "An unknown API error occurred.");

            const { options, optionsResolved } = flowResult;

            // Find the latest beat_options message and update it with new options
            const messagesRef = collection(firestore, 'storySessions', sessionId, 'messages');
            const messagesSnapshot = await getDocs(query(messagesRef, orderBy('createdAt', 'desc'), limit(5)));
            const beatOptionsDoc = messagesSnapshot.docs.find(d => d.data().kind === 'beat_options');

            if (beatOptionsDoc) {
                await updateDoc(beatOptionsDoc.ref, {
                    options: options,
                    optionsResolved: optionsResolved,
                    updatedAt: serverTimestamp()
                });
            }

        } catch (e: any) {
            toast({ title: "Error getting more options", description: e.message, variant: "destructive" });
        } finally {
            setIsProcessing(false);
        }
    };

    const handleMoreGemini3Options = async () => {
        if (!firestore || !sessionRef || isProcessing) return;

        setIsProcessing(true);
        try {
            const response = await fetch('/api/gemini3', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ sessionId, requestMoreOptions: true }),
            });
            const flowResult = await response.json();

            if (!response.ok || !flowResult.ok) throw new Error(flowResult.errorMessage || "An unknown API error occurred.");

            const { options, optionsResolved } = flowResult;

            // Find the latest gemini3_question message and update it with new options
            const messagesRef = collection(firestore, 'storySessions', sessionId, 'messages');
            const messagesSnapshot = await getDocs(query(messagesRef, orderBy('createdAt', 'desc'), limit(5)));
            const gemini3QuestionDoc = messagesSnapshot.docs.find(d => d.data().kind === 'gemini3_question');

            if (gemini3QuestionDoc) {
                await updateDoc(gemini3QuestionDoc.ref, {
                    options: options,
                    optionsResolved: optionsResolved,
                    updatedAt: serverTimestamp()
                });
            }

        } catch (e: any) {
            toast({ title: "Error getting more options", description: e.message, variant: "destructive" });
        } finally {
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

        // Compile the story - this is the end of story creation
        toast({ title: 'Great choice!', description: 'Compiling your story...' });

        try {
            const compileResponse = await fetch('/api/storyCompile', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ sessionId }),
            });
            const compileResult = await compileResponse.json();

            if (!compileResponse.ok || !compileResult.ok) {
                throw new Error(compileResult.errorMessage || 'Failed to compile story');
            }

            await logClientStage('compile.completed');
            toast({ title: 'Story complete!', description: 'Your story has been saved.' });

            // Navigate to child's stories page - story creation is complete
            if (session?.childId) {
                router.push(`/child/${session.childId}/stories`);
            } else {
                router.push('/stories');
            }
        } catch (e: any) {
            toast({ title: 'Error saving story', description: e.message, variant: 'destructive' });
            setIsProcessing(false);
        }
    };

    const handleGemini3Choice = async (chosenOption: Choice) => {
        if (!user || !sessionId || !firestore || !sessionRef || !session || isProcessing) return;

        setIsProcessing(true);
        const messagesRef = collection(firestore, 'storySessions', sessionId, 'messages');
        await addDoc(messagesRef, { sender: 'child', text: chosenOption.text, kind: 'gemini3_choice', selectedOptionId: chosenOption.id, createdAt: serverTimestamp() });

        // Handle character introduction if needed
        if (chosenOption.introducesCharacter) {
            // Use the unified character creation API
            await createStoryCharacter(chosenOption);
        }

        // Get next Gemini 3 question
        await runGemini3AndAppendMessages();
    };

    const handleStoryTypeSelect = async (storyType: StoryType) => {
        if (!firestore || !sessionRef || isProcessing) return;
        setIsProcessing(true);
        try {
            const timestamp = serverTimestamp();
            // Generate a story title based on child name and story type
            // Only generate if not already set (non-empty)
            const existingTitle = session?.storyTitle?.trim();
            const childName = childProfile?.displayName || 'Your';
            const newTitle = existingTitle || `${childName}'s ${storyType.name}`;
            await updateDoc(sessionRef, {
                storyTypeId: storyType.id,
                storyPhaseId: storyType.defaultPhaseId || 'story_beat_phase_v1',
                endingPhaseId: storyType.endingPhaseId || 'ending_phase_v1',
                arcStepIndex: 0,
                currentPhase: 'story', // No warmup phase - start directly in story
                storyTitle: newTitle,
                updatedAt: timestamp,
                'progress.storyTypeChosenAt': timestamp,
            });
            await logClientStage('story_type.chosen', { storyTypeId: storyType.id });
            await runBeatAndAppendMessages();
        } catch (e: any) {
            toast({ title: 'Could not start story', description: e.message || 'Please try another type.', variant: 'destructive' });
            setIsProcessing(false);
        }
    };

    const runGemini4AndAppendMessages = async (userMessage?: string, selectedOptionId?: string) => {
        if (!firestore || !sessionRef) return;

        setIsProcessing(true);
        try {
            const response = await fetch('/api/gemini4', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ sessionId, userMessage, selectedOptionId }),
            });
            const flowResult = await response.json();

            if (!response.ok || !flowResult.ok) throw new Error(flowResult.errorMessage || "An unknown API error occurred.");

            const { question, questionResolved, options, optionsResolved, isStoryComplete, finalStory, finalStoryResolved, questionPhase, debug: flowDebug } = flowResult;
            const messagesRef = collection(firestore, 'storySessions', sessionId, 'messages');

            // Extract actor IDs from question/story and options
            const textToScan = isStoryComplete ? (finalStory || '') : (question || '');
            const textActorIds = extractActorIdsFromText(textToScan);
            const optionActorIds = options?.flatMap((opt: Choice) => extractActorIdsFromText(opt.text || '')) || [];
            const newActorIds = [...new Set([...textActorIds, ...optionActorIds])];

            // Store debug information in session for diagnostics
            const sessionUpdates: Record<string, any> = {};
            if (flowDebug) {
                sessionUpdates['debug.lastPrompt'] = flowDebug.systemPrompt || 'Not available';
                sessionUpdates['debug.lastFlowDebug'] = flowDebug;
                sessionUpdates['debug.lastUpdatedAt'] = serverTimestamp();
            }
            // Add new actor IDs to session
            if (newActorIds.length > 0) {
                sessionUpdates.actors = arrayUnion(...newActorIds);
                sessionUpdates.updatedAt = serverTimestamp();
            }
            if (Object.keys(sessionUpdates).length > 0) {
                await updateDoc(sessionRef, sessionUpdates);
            }

            if (isStoryComplete && finalStory) {
                // Story is complete
                await addDoc(messagesRef, {
                    sender: 'assistant',
                    text: finalStory,
                    textResolved: finalStoryResolved,
                    kind: 'gemini4_final_story',
                    createdAt: serverTimestamp()
                });
                await logClientStage('gemini4.completed', { questionPhase });
            } else {
                // Continue the conversation
                await addDoc(messagesRef, {
                    sender: 'assistant',
                    text: question,
                    textResolved: questionResolved,
                    kind: 'gemini4_question',
                    options: options,
                    optionsResolved: optionsResolved,
                    createdAt: serverTimestamp()
                });
            }

        } catch (e: any) {
            toast({ title: "Error running story flow", description: e.message, variant: "destructive" });
        } finally {
            setIsProcessing(false);
        }
    };

    const handleGemini4Choice = async (chosenOption: Choice) => {
        if (!user || !sessionId || !firestore || !sessionRef || !session || isProcessing) return;

        setIsProcessing(true);
        const messagesRef = collection(firestore, 'storySessions', sessionId, 'messages');

        // Handle "Tell me more" option - don't save as child message, just re-ask
        if ((chosenOption as any).isMoreOption) {
            await runGemini4AndAppendMessages("Tell me more about this. Can you explain it differently or give me more options?", chosenOption.id);
            return;
        }

        await addDoc(messagesRef, { sender: 'child', text: chosenOption.text, kind: 'gemini4_choice', selectedOptionId: chosenOption.id, createdAt: serverTimestamp() });

        // Handle character introduction if needed
        if (chosenOption.introducesCharacter) {
            // Use the unified character creation API
            await createStoryCharacter(chosenOption);
        }

        // Get next question
        await runGemini4AndAppendMessages(chosenOption.text, chosenOption.id);
    };

    // Trigger first question for gemini3 or gemini4 mode
    useEffect(() => {
        if (session?.storyMode === 'gemini3' && recentMessages?.length === 0 && !isProcessing && firestore && sessionRef) {
            runGemini3AndAppendMessages();
        }
        if (session?.storyMode === 'gemini4' && recentMessages?.length === 0 && !isProcessing && firestore && sessionRef) {
            runGemini4AndAppendMessages();
        }
    }, [session?.storyMode, recentMessages?.length, firestore, sessionRef]);

    // Auto-compile when story is complete (gemini3_final_story or gemini4_final_story)
    const autoCompileStory = useCallback(async () => {
        if (!user || !session || hasAutoCompiled || isCompiling) return;

        // Need a story output type to compile
        const storyOutputTypeId = storyOutputTypes?.[0]?.id;
        if (!storyOutputTypeId) {
            console.warn('[auto-compile] No storyOutputTypes available, cannot auto-compile');
            return;
        }

        setIsCompiling(true);
        setHasAutoCompiled(true);

        try {
            await logClientStage('auto_compile.started', { storyOutputTypeId });
            const response = await fetch('/api/storyCompile', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ sessionId, storyOutputTypeId }),
            });
            const result = await response.json();

            if (!response.ok || !result.ok) {
                console.error('[auto-compile] Failed:', result?.errorMessage);
                toast({ title: 'Story saved with issues', description: 'Your story was created but may need manual compilation.', variant: 'destructive' });
            } else {
                await logClientStage('auto_compile.completed');
                toast({ title: 'Story saved!', description: 'Your story is ready to view.' });
            }
        } catch (e: any) {
            console.error('[auto-compile] Error:', e);
            toast({ title: 'Story saved with issues', description: e.message, variant: 'destructive' });
        } finally {
            setIsCompiling(false);
        }
    }, [user, session, sessionId, hasAutoCompiled, isCompiling, storyOutputTypes, logClientStage, toast]);

    // Watch for final story messages and auto-compile
    useEffect(() => {
        const latestMsg = recentMessages?.find(m => m.sender === 'assistant');
        const isFinalStory = latestMsg?.kind === 'gemini3_final_story' || latestMsg?.kind === 'gemini4_final_story';

        // Wait for storyOutputTypes to be loaded before auto-compiling
        if (isFinalStory && !hasAutoCompiled && !isCompiling && storyOutputTypes && storyOutputTypes.length > 0) {
            autoCompileStory();
        }
    }, [recentMessages, hasAutoCompiled, isCompiling, storyOutputTypes, autoCompileStory]);

    // TTS: Speak story content when new messages arrive and speech mode is enabled
    useEffect(() => {
        const allMessages = recentMessages?.map(m => ({ sender: m.sender, kind: m.kind })) || [];
        const latestAssistant = recentMessages?.find(m => m.sender === 'assistant');

        console.log('[StoryPlayPage TTS] Effect triggered:', {
            isSpeechModeEnabled,
            isProcessing,
            hasChildProfile: !!childProfile,
            preferredVoiceId: childProfile?.preferredVoiceId,
            autoReadAloud: childProfile?.autoReadAloud,
            messagesCount: recentMessages?.length || 0,
            allMessages,
            latestAssistantKind: latestAssistant?.kind,
            latestAssistantId: latestAssistant?.id,
            lastSpokenMessageId: lastSpokenMessageIdRef.current,
        });

        if (!isSpeechModeEnabled || isProcessing) {
            console.log('[StoryPlayPage TTS] Skipping - speechMode:', isSpeechModeEnabled, 'processing:', isProcessing);
            return;
        }

        if (!latestAssistant) {
            console.log('[StoryPlayPage TTS] No assistant message found in recentMessages');
            return;
        }

        // Skip if we already spoke this message (prevents replaying on re-renders)
        if (latestAssistant.id === lastSpokenMessageIdRef.current) {
            console.log('[StoryPlayPage TTS] Already spoke this message, skipping:', latestAssistant.id);
            return;
        }

        // Determine what content to speak based on message kind
        const beatContinuation = recentMessages?.find(m => m.sender === 'assistant' && m.kind === 'beat_continuation');
        const beatOptions = recentMessages?.find(m => m.sender === 'assistant' && m.kind === 'beat_options');

        // Build content for different message types
        let headerText: string | undefined;
        let questionText: string | undefined;
        let options: Array<{ text: string }> | undefined;

        switch (latestAssistant.kind) {
            case 'beat_continuation':
            case 'beat_options':
                // For beat flow, combine continuation and options
                headerText = (beatContinuation as any)?.textResolved || beatContinuation?.text;
                questionText = (beatOptions as any)?.textResolved || beatOptions?.text;
                options = (beatOptions as any)?.optionsResolved || beatOptions?.options;
                break;
            case 'gemini3_question':
            case 'gemini4_question':
                questionText = (latestAssistant as any).textResolved || latestAssistant.text;
                options = (latestAssistant as any).optionsResolved || latestAssistant.options;
                break;
            case 'ending_options':
                questionText = (latestAssistant as any).textResolved || latestAssistant.text;
                options = latestAssistant.options;
                break;
            case 'gemini3_final_story':
            case 'gemini4_final_story':
                headerText = (latestAssistant as any).textResolved || latestAssistant.text;
                break;
            default:
                console.log('[StoryPlayPage TTS] Unknown message kind, not speaking:', latestAssistant.kind);
                return; // Don't speak for other message types
        }

        console.log('[StoryPlayPage TTS] Calling speakStoryContent with:', {
            headerText: headerText?.substring(0, 50),
            questionText: questionText?.substring(0, 50),
            optionsCount: options?.length,
        });

        // Mark this message as spoken before calling speakStoryContent
        lastSpokenMessageIdRef.current = latestAssistant.id;
        speakStoryContent({ headerText, questionText, options });
    }, [recentMessages, isSpeechModeEnabled, isProcessing, speakStoryContent, childProfile]);

    if (userLoading || sessionLoading) {
        return <div className="h-screen w-screen flex items-center justify-center bg-background"><LoaderCircle className="h-12 w-12 animate-spin text-primary" /></div>;
    }

    if (!user || !session) {
        return <div className="p-8 text-center"><p>Could not load story. Please try again.</p><Button asChild variant="link"><Link href="/stories">Back to stories</Link></Button></div>;
    }

    const latestAssistantMessage = recentMessages?.find(m => m.sender === 'assistant');
    // Get the latest beat_continuation message separately to display the story text
    const latestBeatContinuation = recentMessages?.find(m => m.sender === 'assistant' && m.kind === 'beat_continuation');
    // Get the latest beat_options message separately to display the choices
    const latestBeatOptions = recentMessages?.find(m => m.sender === 'assistant' && m.kind === 'beat_options');
    // Show story type picker if no story type is set and we have story types available OR if no messages exist yet
    const showStoryTypePicker = !session.storyTypeId && (curatedStoryTypes.length > 0 || (!latestAssistantMessage && storyTypes && storyTypes.length > 0));

    // When speech mode is enabled, keep showing the avatar animation while TTS is loading
    // This syncs the text reveal with the audio playback
    const isWaitingForTTS = isSpeechModeEnabled && isTTSLoading;
    const showAvatarAnimation = isProcessing || isWaitingForTTS;

    return (
        <div className="min-h-screen bg-background text-foreground flex flex-col items-center p-4">
            {/* Speech mode toggle - positioned within header, left of the user menu */}
            <div className="fixed top-0 right-14 z-50 h-14 flex items-center gap-2">
                {childProfile && (
                    <SpeechModeToggle childProfile={childProfile} />
                )}
                <Button variant="ghost" size="icon" asChild>
                    <Link href={`/story/session/${sessionId}`} title="Diagnostic View">
                        <Settings className="h-4 w-4" />
                    </Link>
                </Button>
            </div>

            <div className="flex-grow flex flex-col items-center justify-center w-full max-w-2xl text-center">
                {showAvatarAnimation && (
                    <div className="flex flex-col items-center justify-center gap-4">
                        {childProfile?.avatarAnimationUrl || childProfile?.avatarUrl ? (
                            <ChildAvatarAnimation
                                avatarAnimationUrl={childProfile.avatarAnimationUrl}
                                avatarUrl={childProfile.avatarUrl}
                                size="lg"
                            />
                        ) : (
                            <LoaderCircle className="h-12 w-12 animate-spin text-primary" />
                        )}
                        <p className="text-muted-foreground animate-pulse">
                            {isWaitingForTTS ? 'Getting ready to read...' : 'Creating your story...'}
                        </p>
                    </div>
                )}

                {!showAvatarAnimation && (
                    <>
                        {showStoryTypePicker ? (
                            <Card className="w-full">
                                <CardHeader>
                                    <CardTitle>Pick Your Kind of Story</CardTitle>
                                    <CardDescription>
                                        {curatedStoryTypes.length > 0
                                            ? "The Story Guide suggests these based on your favorite things."
                                            : "Choose a story type to begin your adventure!"}
                                    </CardDescription>
                                </CardHeader>
                                <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                    {(curatedStoryTypes.length > 0 ? curatedStoryTypes : storyTypes || []).map(type => (
                                        <Button key={type.id} variant="outline" className="h-auto p-4 flex flex-col items-start text-left whitespace-normal overflow-hidden" onClick={() => handleStoryTypeSelect(type)}>
                                            <span className="font-bold">{type.name}</span>
                                            <span className="text-xs text-muted-foreground line-clamp-2">{type.shortDescription}</span>
                                        </Button>
                                    ))}
                                </CardContent>
                            </Card>
                        ) : latestAssistantMessage ? (
                            <div className="space-y-6 w-full">
                                {/* Display beat continuation text if it exists - but NOT when showing ending options */}
                                {latestBeatContinuation && latestAssistantMessage.kind !== 'ending_options' && (
                                    <div className="flex flex-col items-center gap-4 mb-6">
                                        <Card className="w-full bg-gradient-to-br from-blue-50 to-indigo-50 dark:from-blue-950 dark:to-indigo-950">
                                            <CardContent className="pt-6">
                                                <p className="text-lg leading-relaxed whitespace-pre-wrap">
                                                    {(latestBeatContinuation as any).textResolved || latestBeatContinuation.text}
                                                </p>
                                            </CardContent>
                                        </Card>
                                    </div>
                                )}

                                {/* Display "What happens next?" prompt if we have beat options - but NOT when showing ending options or character intro */}
                                {latestBeatOptions && latestAssistantMessage.kind !== 'ending_options' && !introducingCharacter && (
                                    <div className="flex flex-col items-center gap-2">
                                        <Avatar className="h-16 w-16">
                                            <AvatarImage src="/icons/magical-book.svg" alt="Story Guide" />
                                            <AvatarFallback><Bot /></AvatarFallback>
                                        </Avatar>
                                        <p className="text-xl font-medium leading-relaxed">{(latestBeatOptions as any).textResolved || latestBeatOptions.text}</p>
                                    </div>
                                )}

                                {/* Character Introduction Card - shown when a new character is being introduced */}
                                {introducingCharacter && (
                                    <CharacterIntroductionCard
                                        character={introducingCharacterData}
                                        characterName={introducingCharacter.characterName}
                                        characterLabel={introducingCharacter.characterLabel}
                                        characterType={introducingCharacter.characterType}
                                        onContinue={handleContinueAfterCharacterIntro}
                                        isLoading={isProcessing}
                                        disabled={isProcessing}
                                    />
                                )}

                                {latestBeatOptions && latestAssistantMessage.kind !== 'ending_options' && !introducingCharacter && (
                                    <div className="space-y-3 w-full">
                                        <div className="grid grid-cols-1 gap-3">
                                            {((latestBeatOptions as any).optionsResolved || latestBeatOptions.options)?.map((opt: ChoiceWithEntities, idx: number) => {
                                                // Get the original option for onClick (with placeholders for storage)
                                                const originalOpt = latestBeatOptions.options?.[idx] || opt;
                                                const optionLabel = String.fromCharCode(65 + idx); // A, B, C, D...
                                                return (
                                                    <ChoiceButton
                                                        key={opt.id}
                                                        choice={opt}
                                                        onClick={() => handleChooseOption(originalOpt)}
                                                        disabled={isProcessing}
                                                        optionLabel={optionLabel}
                                                    />
                                                );
                                            })}
                                        </div>
                                        <div className="flex justify-center">
                                            <Button
                                                variant="outline"
                                                className="border-dashed"
                                                onClick={handleMoreBeatOptions}
                                                disabled={isProcessing}
                                            >
                                                <RefreshCw className="w-4 h-4 mr-2" />
                                                More choices
                                            </Button>
                                        </div>
                                    </div>
                                )}

                                {/* For other message types, use the generic latestAssistantMessage */}
                                {latestAssistantMessage && !latestBeatOptions && !latestBeatContinuation && latestAssistantMessage.kind !== 'ending_options' && (
                                    <div className="flex flex-col items-center gap-2">
                                        <Avatar className="h-16 w-16">
                                            <AvatarImage src="/icons/magical-book.svg" alt="Story Guide" />
                                            <AvatarFallback><Bot /></AvatarFallback>
                                        </Avatar>
                                        <p className="text-xl font-medium leading-relaxed">{(latestAssistantMessage as any).textResolved || latestAssistantMessage.text}</p>
                                    </div>
                                )}

                                {latestAssistantMessage.kind === 'ending_options' && (
                                    <div className="flex flex-col items-center gap-2 mb-4">
                                        <Avatar className="h-16 w-16">
                                            <AvatarImage src="/icons/magical-book.svg" alt="Story Guide" />
                                            <AvatarFallback><Bot /></AvatarFallback>
                                        </Avatar>
                                        <p className="text-xl font-medium leading-relaxed">{(latestAssistantMessage as any).textResolved || latestAssistantMessage.text}</p>
                                    </div>
                                )}

                                {latestAssistantMessage.kind === 'ending_options' && (
                                     <div className="grid grid-cols-1 gap-3 w-full">
                                        {latestAssistantMessage.options?.map((opt, idx) => (
                                            <ChoiceButton
                                                key={opt.id}
                                                choice={opt as ChoiceWithEntities}
                                                onClick={() => handleChooseEnding(opt)}
                                                disabled={isProcessing}
                                                optionLabel={String.fromCharCode(65 + idx)}
                                                icon={<Star className="w-4 h-4 mr-2 text-amber-400 flex-shrink-0" />}
                                            />
                                        ))}
                                    </div>
                                )}

                                {latestAssistantMessage.kind === 'gemini3_question' && (
                                    <div className="space-y-3 w-full">
                                        <div className="grid grid-cols-1 gap-3">
                                            {((latestAssistantMessage as any).optionsResolved || latestAssistantMessage.options)?.map((opt: ChoiceWithEntities, idx: number) => {
                                                // Get the original option for the onClick handler (with placeholders)
                                                const originalOpt = latestAssistantMessage.options?.[idx] || opt;
                                                return (
                                                    <ChoiceButton
                                                        key={opt.id}
                                                        choice={opt}
                                                        onClick={() => handleGemini3Choice(originalOpt)}
                                                        disabled={isProcessing}
                                                        optionLabel={String.fromCharCode(65 + idx)}
                                                        icon={<Sparkles className="w-4 h-4 mr-2 text-purple-500 flex-shrink-0" />}
                                                    />
                                                );
                                            })}
                                        </div>
                                        <div className="flex justify-center">
                                            <Button
                                                variant="outline"
                                                className="border-dashed"
                                                onClick={handleMoreGemini3Options}
                                                disabled={isProcessing}
                                            >
                                                <RefreshCw className="w-4 h-4 mr-2" />
                                                More choices
                                            </Button>
                                        </div>
                                    </div>
                                )}

                                {latestAssistantMessage.kind === 'gemini3_final_story' && (
                                    <div className="space-y-4 w-full">
                                        <Card className="bg-gradient-to-br from-purple-50 to-pink-50 dark:from-purple-950 dark:to-pink-950">
                                            <CardContent className="pt-6">
                                                <p className="text-lg whitespace-pre-wrap">{(latestAssistantMessage as any).textResolved || latestAssistantMessage.text}</p>
                                            </CardContent>
                                        </Card>
                                        {isCompiling ? (
                                            <Button disabled className="w-full">
                                                <LoaderCircle className="h-4 w-4 mr-2 animate-spin" />
                                                Saving your story...
                                            </Button>
                                        ) : (
                                            <Button
                                                onClick={() => router.push(`/child/${session?.childId}/stories`)}
                                                className="w-full"
                                            >
                                                <CheckCircle className="h-4 w-4 mr-2" />
                                                See My Stories
                                            </Button>
                                        )}
                                    </div>
                                )}

                                {latestAssistantMessage.kind === 'gemini4_question' && (
                                    <div className="grid grid-cols-1 gap-3 w-full">
                                        {((latestAssistantMessage as any).optionsResolved || latestAssistantMessage.options)?.map((opt: ChoiceWithEntities, idx: number) => {
                                            const originalOpt = latestAssistantMessage.options?.[idx] || opt;
                                            const isMoreOption = (originalOpt as any).isMoreOption;
                                            return (
                                                <ChoiceButton
                                                    key={opt.id}
                                                    choice={opt}
                                                    onClick={() => handleGemini4Choice(originalOpt)}
                                                    disabled={isProcessing}
                                                    variant={isMoreOption ? "outline" : "secondary"}
                                                    className={isMoreOption ? 'border-dashed' : ''}
                                                    optionLabel={isMoreOption ? undefined : String.fromCharCode(65 + idx)}
                                                    icon={isMoreOption ? (
                                                        <RefreshCw className="w-4 h-4 mr-2 text-muted-foreground flex-shrink-0" />
                                                    ) : (
                                                        <Sparkles className="w-4 h-4 mr-2 text-emerald-500 flex-shrink-0" />
                                                    )}
                                                />
                                            );
                                        })}
                                    </div>
                                )}

                                {latestAssistantMessage.kind === 'gemini4_final_story' && (
                                    <div className="space-y-4 w-full">
                                        <Card className="bg-gradient-to-br from-emerald-50 to-teal-50 dark:from-emerald-950 dark:to-teal-950">
                                            <CardContent className="pt-6">
                                                <p className="text-lg whitespace-pre-wrap">{(latestAssistantMessage as any).textResolved || latestAssistantMessage.text}</p>
                                            </CardContent>
                                        </Card>
                                        {isCompiling ? (
                                            <Button disabled className="w-full">
                                                <LoaderCircle className="h-4 w-4 mr-2 animate-spin" />
                                                Saving your story...
                                            </Button>
                                        ) : (
                                            <Button
                                                onClick={() => router.push(`/child/${session?.childId}/stories`)}
                                                className="w-full"
                                            >
                                                <CheckCircle className="h-4 w-4 mr-2" />
                                                See My Stories
                                            </Button>
                                        )}
                                    </div>
                                )}

                                                            </div>
                        ) : (
                            <LoaderCircle className="h-8 w-8 animate-spin text-primary" />
                        )}
                    </>
                )}
            </div>

            <Card className="w-full max-w-4xl mt-8">
                <CardHeader className="flex flex-row items-center justify-between">
                    <CardTitle>Diagnostics</CardTitle>
                    <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => {
                            const diagnostics = {
                                _version: 'v2-actors-tracking',
                                sessionId,
                                session: {
                                    currentPhase: session?.currentPhase,
                                    storyTypeId: session?.storyTypeId,
                                    arcStepIndex: session?.arcStepIndex,
                                    selectedEndingId: session?.selectedEndingId,
                                    pendingCharacterTraits: session?.pendingCharacterTraits,
                                    status: session?.status,
                                    actors: session?.actors || [],
                                },
                                latestAssistantMessage: {
                                    kind: latestAssistantMessage?.kind,
                                    text: latestAssistantMessage?.text?.substring(0, 100),
                                    optionsCount: latestAssistantMessage?.options?.length,
                                },
                                state: {
                                    isProcessing,
                                    showStoryTypePicker: !session?.storyTypeId && curatedStoryTypes.length > 0,
                                    introducingCharacter: !!introducingCharacter,
                                },
                                audio: {
                                    isSpeechModeEnabled,
                                    isSpeaking,
                                    isTTSLoading,
                                    childHasPreferredVoice: !!childProfile?.preferredVoiceId,
                                    childAutoReadAloud: !!childProfile?.autoReadAloud,
                                    backgroundMusicUrl: backgroundMusicUrl || null,
                                    backgroundMusicLoaded: backgroundMusic.isLoaded,
                                    backgroundMusicPlaying: backgroundMusic.isPlaying,
                                    activeStoryTypeId: activeStoryType?.id || null,
                                    activeStoryTypeHasMusic: !!activeStoryType?.backgroundMusic?.audioUrl,
                                },
                                debug: {
                                    lastPrompt: (session as any)?.debug?.lastPrompt || 'Not available',
                                    lastResponse: (session as any)?.debug?.lastResponse || 'Not available',
                                    lastFlowDebug: (session as any)?.debug?.lastFlowDebug || 'Not available',
                                    lastExtractedActorIds: (session as any)?.debug?.lastExtractedActorIds || [],
                                    lastStoryContinuationPreview: (session as any)?.debug?.lastStoryContinuationPreview || 'Not available',
                                },
                            };
                            const textToCopy = `Page: story-play\n\nDiagnostics\n${JSON.stringify(diagnostics, null, 2)}`;
                            navigator.clipboard.writeText(textToCopy);
                            toast({ title: 'Diagnostics copied to clipboard' });
                        }}
                    >
                        <Copy className="h-4 w-4" />
                    </Button>
                </CardHeader>
                <CardContent>
                    <pre className="bg-muted p-4 rounded-lg overflow-x-auto text-sm max-h-[600px]">
                        <code>{JSON.stringify({
                            _version: 'v2-actors-tracking',
                            sessionId,
                            session: {
                                currentPhase: session?.currentPhase,
                                storyTypeId: session?.storyTypeId,
                                arcStepIndex: session?.arcStepIndex,
                                selectedEndingId: session?.selectedEndingId,
                                pendingCharacterTraits: session?.pendingCharacterTraits,
                                status: session?.status,
                                actors: session?.actors || [],
                            },
                            latestAssistantMessage: {
                                kind: latestAssistantMessage?.kind,
                                text: latestAssistantMessage?.text?.substring(0, 100),
                                optionsCount: latestAssistantMessage?.options?.length,
                            },
                            state: {
                                isProcessing,
                                showStoryTypePicker: !session?.storyTypeId && curatedStoryTypes.length > 0,
                                introducingCharacter: !!introducingCharacter,
                            },
                            audio: {
                                isSpeechModeEnabled,
                                isSpeaking,
                                isTTSLoading,
                                childHasPreferredVoice: !!childProfile?.preferredVoiceId,
                                childAutoReadAloud: !!childProfile?.autoReadAloud,
                                backgroundMusicUrl: backgroundMusicUrl || null,
                                backgroundMusicLoaded: backgroundMusic.isLoaded,
                                backgroundMusicPlaying: backgroundMusic.isPlaying,
                                activeStoryTypeId: activeStoryType?.id || null,
                                activeStoryTypeHasMusic: !!activeStoryType?.backgroundMusic?.audioUrl,
                            },
                            debug: {
                                lastPrompt: (session as any)?.debug?.lastPrompt || 'Not available',
                                lastResponse: (session as any)?.debug?.lastResponse || 'Not available',
                                lastFlowDebug: (session as any)?.debug?.lastFlowDebug || 'Not available',
                                lastExtractedActorIds: (session as any)?.debug?.lastExtractedActorIds || [],
                                lastStoryContinuationPreview: (session as any)?.debug?.lastStoryContinuationPreview || 'Not available',
                            },
                        }, null, 2)}</code>
                    </pre>
                </CardContent>
            </Card>
        </div>
    );
}

