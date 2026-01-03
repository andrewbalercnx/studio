'use client';

import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useFirestore } from '@/firebase';
import { useUser } from '@/firebase/auth/use-user';
import { doc, collection, query, where, updateDoc, serverTimestamp, addDoc, getDoc, writeBatch, arrayUnion, orderBy, limit as firestoreLimit, getDocs, increment } from 'firebase/firestore';
import { useDocument, useCollection } from '@/lib/firestore-hooks';
import { useToast } from '@/hooks/use-toast';
import { useStoryTTS } from '@/hooks/use-story-tts';
import { useBackgroundMusic } from '@/hooks/use-background-music';
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar';

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { LoaderCircle, Settings, RefreshCw, Sparkles, Star, CheckCircle, Bot, Music, VolumeX } from 'lucide-react';
import Link from 'next/link';

import { ChoiceButton, type ChoiceWithEntities } from './choice-button';
import { CharacterIntroductionCard } from './character-introduction-card';
import { ChildAvatarAnimation } from '@/components/child/child-avatar-animation';
import { SpeechModeToggle } from '@/components/child/speech-mode-toggle';
import { DiagnosticsPanel } from '@/components/diagnostics-panel';

import type {
  StoryGenerator,
  StoryGeneratorResponse,
  StoryGeneratorResponseOption,
  StorySession,
  StoryType,
  StoryOutputType,
  ChildProfile,
  Character,
  Choice,
} from '@/lib/types';

// ============================================================================
// Types
// ============================================================================

type BrowserState =
  | 'loading'           // Loading generator config
  | 'story_type'        // Selecting story type
  | 'generating'        // Calling API
  | 'question'          // Displaying question/options
  | 'character_intro'   // Introducing new character
  | 'ending'            // Ending phase (beat mode)
  | 'compiling'         // Auto-compiling story
  | 'complete'          // Story complete
  | 'error';            // Error state

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

interface CharacterIntroState {
  characterId: string;
  characterName: string;
  characterLabel: string;
  characterType: string;
  pendingOption: Choice;
}

interface StoryBrowserProps {
  sessionId: string;
  generatorId: string;
  childProfile: ChildProfile | null;
  storyTypes?: StoryType[];
  onStoryComplete?: (storyId: string) => void;
  onError?: (error: string) => void;
  showSettingsLink?: boolean;
  /** Where to navigate after story completion. If not provided, uses onStoryComplete callback only */
  completionRedirectPath?: string;
}

// ============================================================================
// Component
// ============================================================================

export function StoryBrowser({
  sessionId,
  generatorId,
  childProfile,
  storyTypes: propStoryTypes,
  onStoryComplete,
  onError,
  showSettingsLink = true,
  completionRedirectPath,
}: StoryBrowserProps) {
  const firestore = useFirestore();
  const router = useRouter();
  const { user } = useUser();
  const { toast } = useToast();

  // ---------------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------------
  const [browserState, setBrowserState] = useState<BrowserState>('loading');
  const [headerText, setHeaderText] = useState<string>('');        // Story continuation (beat mode)
  const [currentQuestion, setCurrentQuestion] = useState<string>('');
  const [currentOptions, setCurrentOptions] = useState<StoryGeneratorResponseOption[]>([]);
  const [finalStory, setFinalStory] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [characterIntro, setCharacterIntro] = useState<CharacterIntroState | null>(null);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [isEndingPhase, setIsEndingPhase] = useState(false);
  const [debugInfo, setDebugInfo] = useState<Record<string, any>>({});
  const [musicEnabled, setMusicEnabled] = useState(true); // User preference for background music

  // Track spoken content to avoid re-speaking
  const lastSpokenContentRef = useRef<string>('');

  // ---------------------------------------------------------------------------
  // Firestore Queries
  // ---------------------------------------------------------------------------
  const generatorRef = useMemo(
    () => (firestore ? doc(firestore, 'storyGenerators', generatorId) : null),
    [firestore, generatorId]
  );
  const { data: generator, loading: generatorLoading, error: generatorError } = useDocument<StoryGenerator>(generatorRef);

  const sessionRef = useMemo(
    () => (firestore ? doc(firestore, 'storySessions', sessionId) : null),
    [firestore, sessionId]
  );
  const { data: session } = useDocument<StorySession>(sessionRef);

  // Story types query (if not provided via props)
  const storyTypesQuery = useMemo(
    () => (firestore && !propStoryTypes ? query(collection(firestore, 'storyTypes'), where('status', '==', 'live')) : null),
    [firestore, propStoryTypes]
  );
  const { data: fetchedStoryTypes } = useCollection<StoryType>(storyTypesQuery);
  const storyTypes = propStoryTypes || fetchedStoryTypes;

  // Story output types for auto-compile
  const storyOutputTypesQuery = useMemo(
    () => (firestore ? query(collection(firestore, 'storyOutputTypes'), where('status', '==', 'live')) : null),
    [firestore]
  );
  const { data: storyOutputTypes } = useCollection<StoryOutputType>(storyOutputTypesQuery);

  // Get active story type for gradient/styling
  const activeStoryType = useMemo(() => {
    if (!storyTypes || !session?.storyTypeId) return null;
    return storyTypes.find((type) => type.id === session.storyTypeId) ?? null;
  }, [storyTypes, session?.storyTypeId]);

  // Character for intro screen (live updates)
  const characterRef = useMemo(
    () => (firestore && characterIntro?.characterId ? doc(firestore, 'characters', characterIntro.characterId) : null),
    [firestore, characterIntro?.characterId]
  );
  const { data: introCharacter } = useDocument<Character>(characterRef);

  // ---------------------------------------------------------------------------
  // TTS & Background Music
  // ---------------------------------------------------------------------------
  const {
    isSpeechModeEnabled,
    speakStoryContent,
    stopSpeech,
    isSpeaking,
    isLoading: isTTSLoading,
  } = useStoryTTS({
    childProfile: childProfile ?? null,
    onError: (error) => toast({ title: 'Speech error', description: error, variant: 'destructive' }),
  });

  // Background music - prefer story type's music, fallback to generator's
  const backgroundMusicUrl = activeStoryType?.backgroundMusic?.audioUrl || generator?.backgroundMusic?.audioUrl;
  const backgroundMusic = useBackgroundMusic({
    audioUrl: backgroundMusicUrl ?? null,
    isSpeaking,
    normalVolume: 0.4,
    duckedVolume: 0.1,
  });

  // Music control based on state and user preference
  useEffect(() => {
    // If user disabled music, stop it
    if (!musicEnabled) {
      if (backgroundMusic.isPlaying) {
        backgroundMusic.fadeOut();
      }
      return;
    }

    const hasAvatar = childProfile?.avatarAnimationUrl || childProfile?.avatarUrl;
    const showingAvatar = browserState === 'generating' || (isSpeechModeEnabled && isTTSLoading);
    const shouldPlayMusic = (showingAvatar && hasAvatar && backgroundMusicUrl) || (isSpeaking && backgroundMusicUrl);

    if (shouldPlayMusic && backgroundMusic.isLoaded && !backgroundMusic.isPlaying) {
      backgroundMusic.play();
    } else if (!shouldPlayMusic && backgroundMusic.isPlaying) {
      backgroundMusic.fadeOut();
    }
  }, [browserState, isTTSLoading, isSpeaking, backgroundMusic, backgroundMusicUrl, childProfile, isSpeechModeEnabled, musicEnabled]);

  // ---------------------------------------------------------------------------
  // Auto-speak when content changes
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (!isSpeechModeEnabled || (browserState !== 'question' && browserState !== 'ending')) return;

    const contentKey = `${headerText}|${currentQuestion}|${currentOptions.map(o => o.textResolved || o.text).join('|')}`;
    if (contentKey !== lastSpokenContentRef.current && (currentQuestion || headerText)) {
      lastSpokenContentRef.current = contentKey;
      speakStoryContent({
        headerText: headerText || undefined,
        questionText: currentQuestion || undefined,
        options: currentOptions.map(o => ({ text: o.textResolved || o.text })),
      });
    }
  }, [headerText, currentQuestion, currentOptions, browserState, isSpeechModeEnabled, speakStoryContent]);

  // ---------------------------------------------------------------------------
  // Initialize browser state
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (generatorLoading) return;

    if (!generator) {
      setErrorMessage(`Generator "${generatorId}" not found`);
      setBrowserState('error');
      return;
    }

    // Check if we need story type selection
    if (generator.capabilities.requiresStoryType && !session?.storyTypeId) {
      setBrowserState('story_type');
      return;
    }

    // If we have content from session, display it
    // Otherwise, call the API to get the first question
    if (browserState === 'loading') {
      callGeneratorAPI();
    }
  }, [generator, generatorLoading, session?.storyTypeId]);

  // ---------------------------------------------------------------------------
  // Auto-compile story when complete
  // ---------------------------------------------------------------------------
  const autoCompileStory = useCallback(async () => {
    if (!user || !firestore || !storyOutputTypes?.length) return;

    const storyOutputTypeId = storyOutputTypes[0].id;
    setBrowserState('compiling');

    try {
      const response = await fetch('/api/storyCompile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, storyOutputTypeId }),
      });
      const result = await response.json();

      if (!response.ok || !result.ok) {
        console.error('[StoryBrowser] Auto-compile failed:', result?.errorMessage);
        toast({ title: 'Story saved with issues', description: 'Your story was created but may need manual compilation.', variant: 'destructive' });
      } else {
        toast({ title: 'Story saved!', description: 'Your story is ready to view.' });
      }
    } catch (e: any) {
      console.error('[StoryBrowser] Auto-compile error:', e);
      toast({ title: 'Story saved with issues', description: e.message, variant: 'destructive' });
    }

    // Navigate if redirect path provided
    if (completionRedirectPath) {
      router.push(completionRedirectPath);
    } else {
      setBrowserState('complete');
      onStoryComplete?.(sessionId);
    }
  }, [user, firestore, sessionId, storyOutputTypes, toast, completionRedirectPath, router, onStoryComplete]);

  // ---------------------------------------------------------------------------
  // API Call
  // ---------------------------------------------------------------------------
  const callGeneratorAPI = useCallback(async (selectedOptionId?: string, userMessage?: string) => {
    if (!generator || !user || !firestore || !sessionRef) return;

    setBrowserState('generating');
    stopSpeech();

    try {
      const response = await fetch(generator.apiEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${await user.getIdToken()}`,
        },
        body: JSON.stringify({
          sessionId,
          selectedOptionId,
          userMessage,
        }),
      });

      if (!response.ok) {
        throw new Error(`API error: ${response.status}`);
      }

      const result: StoryGeneratorResponse = await response.json();

      if (!result.ok) {
        throw new Error(result.errorMessage || 'Unknown error');
      }

      // Store debug info
      setDebugInfo(result.debug || {});

      // Extract actor IDs from response
      const textToScan = [
        result.headerText || '',
        result.question || '',
        result.finalStory || '',
        ...(result.options?.map(o => o.text) || []),
      ].join(' ');
      const newActorIds = extractActorIdsFromText(textToScan);

      // Store messages in Firestore (mirror what the original page does)
      const messagesRef = collection(firestore, 'storySessions', sessionId, 'messages');
      const batch = writeBatch(firestore);

      if (result.isStoryComplete && result.finalStory) {
        // Final story message
        batch.set(doc(messagesRef), {
          sender: 'assistant',
          text: result.finalStory,
          textResolved: result.finalStoryResolved,
          kind: `${generatorId}_final_story`,
          createdAt: serverTimestamp(),
        });
      } else if (result.headerText) {
        // Beat mode: separate continuation and options messages
        batch.set(doc(messagesRef), {
          sender: 'assistant',
          text: result.headerText,
          textResolved: result.headerTextResolved,
          kind: 'beat_continuation',
          createdAt: serverTimestamp(),
        });
        batch.set(doc(messagesRef), {
          sender: 'assistant',
          text: result.question,
          textResolved: result.questionResolved,
          kind: result.isEndingPhase ? 'ending_options' : 'beat_options',
          options: result.options,
          createdAt: serverTimestamp(),
        });
      } else if (result.question) {
        // Standard question message
        batch.set(doc(messagesRef), {
          sender: 'assistant',
          text: result.question,
          textResolved: result.questionResolved,
          kind: `${generatorId}_question`,
          options: result.options,
          createdAt: serverTimestamp(),
        });
      }

      // Update session with new actor IDs
      if (newActorIds.length > 0) {
        batch.update(sessionRef, {
          actors: arrayUnion(...newActorIds),
          updatedAt: serverTimestamp(),
        });
      }

      await batch.commit();

      // Handle story complete
      if (result.isStoryComplete) {
        setFinalStory(result.finalStoryResolved || result.finalStory || null);
        setBrowserState('complete');
        // Show the final story for a few seconds before auto-compiling
        setTimeout(async () => {
          await autoCompileStory();
        }, 5000);
        return;
      }

      // Handle ending phase
      if (result.isEndingPhase) {
        setIsEndingPhase(true);
        setBrowserState('ending');
      } else {
        setIsEndingPhase(false);
        setBrowserState('question');
      }

      // Display content
      setHeaderText(result.headerTextResolved || result.headerText || '');
      setCurrentQuestion(result.questionResolved || result.question);
      setCurrentOptions(result.options);

    } catch (e: any) {
      console.error('[StoryBrowser] API error:', e);
      setErrorMessage(e.message || 'Failed to generate content');
      setBrowserState('error');
      onError?.(e.message);
    }
  }, [generator, user, firestore, sessionId, sessionRef, stopSpeech, generatorId, autoCompileStory, onError]);

  // ---------------------------------------------------------------------------
  // Ending Flow API Call
  // ---------------------------------------------------------------------------
  const callEndingAPI = useCallback(async () => {
    if (!user || !firestore || !sessionRef) return;

    setBrowserState('generating');
    stopSpeech();

    try {
      const response = await fetch('/api/storyEnding', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${await user.getIdToken()}`,
        },
        body: JSON.stringify({ sessionId }),
      });

      if (!response.ok) {
        throw new Error(`Ending API error: ${response.status}`);
      }

      const result = await response.json();

      if (!result.ok) {
        throw new Error(result.errorMessage || 'Failed to generate endings');
      }

      // Store debug info
      setDebugInfo(result.debug || {});

      // Store ending options message in Firestore
      const messagesRef = collection(firestore, 'storySessions', sessionId, 'messages');
      const endings = result.endings || [];
      const endingOptions: StoryGeneratorResponseOption[] = endings.map((ending: { id: string; text: string; textResolved?: string }) => ({
        id: ending.id,
        text: ending.text,
        textResolved: ending.textResolved || ending.text,
      }));

      await addDoc(messagesRef, {
        sender: 'assistant',
        text: 'How would you like your story to end?',
        kind: 'ending_options',
        options: endingOptions,
        createdAt: serverTimestamp(),
      });

      // Display ending options
      setIsEndingPhase(true);
      setHeaderText('');
      setCurrentQuestion('How would you like your story to end?');
      setCurrentOptions(endingOptions);
      setBrowserState('ending');

    } catch (e: any) {
      console.error('[StoryBrowser] Ending API error:', e);
      setErrorMessage(e.message || 'Failed to generate endings');
      setBrowserState('error');
      onError?.(e.message);
    }
  }, [user, firestore, sessionId, sessionRef, stopSpeech, onError]);

  // ---------------------------------------------------------------------------
  // Option Selection
  // ---------------------------------------------------------------------------
  const handleSelectOption = useCallback(async (option: StoryGeneratorResponseOption) => {
    if (!generator || !firestore || !user || !session) return;

    // Store the child's choice in Firestore
    const messagesRef = collection(firestore, 'storySessions', sessionId, 'messages');
    await addDoc(messagesRef, {
      sender: 'child',
      text: option.text,
      kind: isEndingPhase ? 'child_ending_choice' : 'child_choice',
      selectedOptionId: option.id,
      createdAt: serverTimestamp(),
    });

    // Check if this option introduces a character
    if (option.introducesCharacter && generator.capabilities.supportsCharacterIntroduction) {
      // Create the character first
      try {
        const storyTypeContext = activeStoryType?.name || 'adventure';
        const storyContext = `A ${storyTypeContext} story about ${childProfile?.displayName || 'a child'}.`;

        const response = await fetch('/api/characters/create', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${await user.getIdToken()}`,
          },
          body: JSON.stringify({
            sessionId,
            parentUid: session.parentUid,
            childId: session.childId,
            characterLabel: option.newCharacterLabel || 'A new friend',
            characterName: option.newCharacterName || 'New Friend',
            characterType: option.newCharacterType || 'Friend',
            storyContext,
            generateAvatar: true,
          }),
        });

        const result = await response.json();

        if (!response.ok || !result.ok) {
          throw new Error(result.errorMessage || 'Failed to create character');
        }

        // Trigger async avatar generation
        if (result.characterId) {
          fetch('/api/generateCharacterAvatar', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${await user.getIdToken()}`,
            },
            body: JSON.stringify({ characterId: result.characterId }),
          }).catch(err => console.error('Avatar generation failed:', err));
        }

        // Show character introduction
        setCharacterIntro({
          characterId: result.characterId,
          characterName: option.newCharacterName || result.character?.displayName || 'New Friend',
          characterLabel: option.newCharacterLabel || 'A new friend',
          characterType: option.newCharacterType || 'Friend',
          pendingOption: {
            id: option.id,
            text: option.text,
            introducesCharacter: true,
            newCharacterName: option.newCharacterName,
            newCharacterLabel: option.newCharacterLabel,
            newCharacterType: option.newCharacterType as 'Family' | 'Friend' | 'Pet' | 'Toy' | 'Other' | null | undefined,
          },
        });
        setBrowserState('character_intro');
        return;
      } catch (e: any) {
        console.error('[StoryBrowser] Character creation error:', e);
        toast({ title: 'Error', description: 'Could not create character', variant: 'destructive' });
        // Continue with the story anyway
      }
    }

    // Handle "Tell me more" option for gemini4
    if (option.isMoreOption) {
      await callGeneratorAPI(option.id, "Tell me more about this. Can you explain it differently or give me more options?");
      return;
    }

    // If in ending phase, user is selecting their ending - save it and compile
    if (isEndingPhase && sessionRef) {
      console.log('[StoryBrowser] Ending selected, saving and compiling...');

      // Save the selected ending to the session
      await updateDoc(sessionRef, {
        selectedEndingId: option.id,
        selectedEndingText: option.text,
        updatedAt: serverTimestamp(),
      });

      // Auto-compile the story
      await autoCompileStory();
      return;
    }

    // Increment arc step before calling API (only for generators that use story types with arcs)
    // Generators like 'wizard' that don't require story types handle their own completion
    // via the isStoryComplete flag in the API response, so we skip arc management for them.
    if (sessionRef && generator?.capabilities?.requiresStoryType) {
      // Get arc steps from active story type or fetch from Firestore
      let arcSteps = activeStoryType?.arcTemplate?.steps;
      if (!arcSteps && session.storyTypeId) {
        const storyTypeRef = doc(firestore, 'storyTypes', session.storyTypeId);
        const storyTypeDoc = await getDoc(storyTypeRef);
        if (storyTypeDoc.exists()) {
          const storyType = storyTypeDoc.data() as StoryType;
          arcSteps = storyType.arcTemplate?.steps;
        }
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
      }
      // Note: When totalSteps is 0 but requiresStoryType is true, we don't
      // treat it as "reached end" - we let the API drive the story flow

      // Update session with new arc step index
      await updateDoc(sessionRef, {
        arcStepIndex: nextIndex,
        updatedAt: serverTimestamp(),
      });

      // If we've reached the end of the arc, call the ending API
      if (reachedEnd) {
        console.log('[StoryBrowser] Arc completed, calling ending API');
        await callEndingAPI();
        return;
      }
    }

    // Call API with selected option
    await callGeneratorAPI(option.id, option.text);
  }, [generator, firestore, user, session, sessionId, sessionRef, isEndingPhase, activeStoryType, childProfile, callGeneratorAPI, callEndingAPI, autoCompileStory, toast]);

  // ---------------------------------------------------------------------------
  // Continue after character introduction
  // ---------------------------------------------------------------------------
  const handleContinueAfterCharacterIntro = useCallback(async () => {
    if (!characterIntro) return;

    // Continue with the pending option
    const option = characterIntro.pendingOption;
    setCharacterIntro(null);
    await callGeneratorAPI(option.id, option.text);
  }, [characterIntro, callGeneratorAPI]);

  // ---------------------------------------------------------------------------
  // Story Type Selection
  // ---------------------------------------------------------------------------
  const handleStoryTypeSelect = useCallback(async (storyType: StoryType) => {
    if (!firestore || !sessionRef) return;

    try {
      await updateDoc(sessionRef, {
        storyTypeId: storyType.id,
        updatedAt: serverTimestamp(),
      });

      // Now call the API
      await callGeneratorAPI();
    } catch (e: any) {
      console.error('[StoryBrowser] Story type selection error:', e);
      setErrorMessage('Failed to select story type');
      setBrowserState('error');
    }
  }, [firestore, sessionRef, callGeneratorAPI]);

  // ---------------------------------------------------------------------------
  // More Options
  // ---------------------------------------------------------------------------
  const handleMoreOptions = useCallback(async () => {
    if (!generator?.capabilities.supportsMoreOptions) return;

    setIsLoadingMore(true);
    try {
      // Call API with a special flag for more options
      const response = await fetch(generator.apiEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${await user?.getIdToken()}`,
        },
        body: JSON.stringify({
          sessionId,
          moreOptions: true,
        }),
      });

      if (!response.ok) {
        throw new Error(`API error: ${response.status}`);
      }

      const result: StoryGeneratorResponse = await response.json();

      if (result.ok && result.options) {
        setCurrentOptions(result.options);
      }
    } catch (e: any) {
      console.error('[StoryBrowser] More options error:', e);
      toast({ title: 'Error', description: 'Could not load more options', variant: 'destructive' });
    } finally {
      setIsLoadingMore(false);
    }
  }, [generator, user, sessionId, toast]);

  // ---------------------------------------------------------------------------
  // Render Helpers
  // ---------------------------------------------------------------------------
  const gradient = generator?.styling?.gradient || 'from-blue-50 to-indigo-50';
  const darkGradient = generator?.styling?.darkGradient || 'dark:from-blue-950 dark:to-indigo-950';
  const loadingMessage = generator?.styling?.loadingMessage || 'Creating your story...';

  // Determine which state to render
  const isWaitingForTTS = isSpeechModeEnabled && isTTSLoading;
  const showAvatarAnimation = browserState === 'generating' || isWaitingForTTS;

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------
  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col">
      {/* Story Controls Bar - full width bar below header with page-specific controls */}
      <div className="sticky top-14 z-40 w-full border-b border-border/40 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="container flex h-12 max-w-screen-2xl items-center justify-between px-4">
          {/* Left side - Story info (optional) */}
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            {generator && (
              <span className="hidden sm:inline">{generator.name}</span>
            )}
          </div>

          {/* Right side - Controls */}
          <div className="flex items-center gap-2">
            {/* Music Toggle */}
            {backgroundMusicUrl && (
              <Button
                variant={musicEnabled ? 'default' : 'ghost'}
                size="sm"
                onClick={() => setMusicEnabled(!musicEnabled)}
                title={musicEnabled ? 'Turn off background music' : 'Turn on background music'}
                className="gap-2"
              >
                {musicEnabled ? <Music className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />}
                <span className="hidden sm:inline">{musicEnabled ? 'Music On' : 'Music Off'}</span>
              </Button>
            )}
            {/* Narration Toggle */}
            {childProfile?.preferredVoiceId && (
              <SpeechModeToggle childProfile={childProfile} showLabel />
            )}
            {/* Settings Link */}
            {showSettingsLink && (
              <Button variant="ghost" size="sm" asChild className="gap-2">
                <Link href={`/story/session/${sessionId}`} title="Diagnostic View">
                  <Settings className="h-4 w-4" />
                  <span className="hidden sm:inline">Settings</span>
                </Link>
              </Button>
            )}
          </div>
        </div>
      </div>

      {/* Main content area */}
      <div className="flex-grow flex flex-col items-center justify-center w-full max-w-2xl mx-auto text-center p-4">
        {/* Loading/Generating State */}
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
              {isWaitingForTTS ? 'Getting ready to read...' : loadingMessage}
            </p>
          </div>
        )}

        {/* Error State */}
        {browserState === 'error' && (
          <Card className="w-full">
            <CardHeader>
              <CardTitle className="text-destructive">Error</CardTitle>
              <CardDescription>{errorMessage}</CardDescription>
            </CardHeader>
            <CardContent>
              <Button variant="outline" onClick={() => callGeneratorAPI()}>
                Try Again
              </Button>
            </CardContent>
          </Card>
        )}

        {/* Story Type Selection */}
        {browserState === 'story_type' && storyTypes && (
          <Card className="w-full">
            <CardHeader>
              <CardTitle>Pick Your Kind of Story</CardTitle>
              <CardDescription>Choose a story type to begin your adventure!</CardDescription>
            </CardHeader>
            <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {storyTypes.map((type) => (
                <Button
                  key={type.id}
                  variant="outline"
                  className="h-auto p-4 flex flex-col items-start text-left whitespace-normal overflow-hidden"
                  onClick={() => handleStoryTypeSelect(type)}
                >
                  <span className="font-bold">{type.name}</span>
                  <span className="text-xs text-muted-foreground line-clamp-2">{type.shortDescription}</span>
                </Button>
              ))}
            </CardContent>
          </Card>
        )}

        {/* Character Introduction */}
        {browserState === 'character_intro' && characterIntro && (
          <CharacterIntroductionCard
            character={introCharacter}
            characterName={characterIntro.characterName}
            characterLabel={characterIntro.characterLabel}
            characterType={characterIntro.characterType}
            onContinue={handleContinueAfterCharacterIntro}
            isLoading={false}
          />
        )}

        {/* Question Display */}
        {(browserState === 'question' || browserState === 'ending') && !showAvatarAnimation && (
          <div className="space-y-6 w-full">
            {/* Header Text (story continuation for beat mode) */}
            {headerText && (
              <Card className={`w-full bg-gradient-to-br ${gradient} ${darkGradient}`}>
                <CardContent className="pt-6">
                  <p className="text-lg leading-relaxed whitespace-pre-wrap">{headerText}</p>
                </CardContent>
              </Card>
            )}

            {/* Question prompt with avatar */}
            {currentQuestion && (
              <div className="flex flex-col items-center gap-2">
                <Avatar className="h-16 w-16">
                  <AvatarImage src="/icons/magical-book.svg" alt="Story Guide" />
                  <AvatarFallback><Bot /></AvatarFallback>
                </Avatar>
                <p className="text-xl font-medium leading-relaxed">{currentQuestion}</p>
              </div>
            )}

            {/* Options */}
            <div className="grid grid-cols-1 gap-3">
              {currentOptions.map((option, idx) => {
                const optionLabel = option.isMoreOption ? undefined : String.fromCharCode(65 + idx); // A, B, C, D
                const choiceWithEntities: ChoiceWithEntities = {
                  id: option.id,
                  text: option.textResolved || option.text,
                  introducesCharacter: option.introducesCharacter,
                  newCharacterName: option.newCharacterName,
                  newCharacterLabel: option.newCharacterLabel,
                  newCharacterType: option.newCharacterType as 'Family' | 'Friend' | 'Pet' | 'Toy' | 'Other' | null | undefined,
                };

                return (
                  <ChoiceButton
                    key={option.id}
                    choice={choiceWithEntities}
                    onClick={() => handleSelectOption(option)}
                    optionLabel={optionLabel}
                    disabled={browserState !== 'question' && browserState !== 'ending'}
                    variant={option.isMoreOption ? 'outline' : 'secondary'}
                    className={option.isMoreOption ? 'border-dashed' : ''}
                    icon={isEndingPhase ? (
                      <Star className="w-4 h-4 mr-2 text-amber-400 flex-shrink-0" />
                    ) : option.isMoreOption ? (
                      <RefreshCw className="w-4 h-4 mr-2 text-muted-foreground flex-shrink-0" />
                    ) : (
                      <Sparkles className="w-4 h-4 mr-2 text-purple-500 flex-shrink-0" />
                    )}
                  />
                );
              })}
            </div>

            {/* More Options Button */}
            {generator?.capabilities.supportsMoreOptions && !isEndingPhase && (
              <div className="flex justify-center">
                <Button
                  variant="outline"
                  className="border-dashed"
                  onClick={handleMoreOptions}
                  disabled={isLoadingMore}
                >
                  {isLoadingMore ? (
                    <LoaderCircle className="w-4 h-4 mr-2 animate-spin" />
                  ) : (
                    <RefreshCw className="w-4 h-4 mr-2" />
                  )}
                  More choices
                </Button>
              </div>
            )}
          </div>
        )}

        {/* Compiling State */}
        {browserState === 'compiling' && (
          <div className="flex flex-col items-center justify-center gap-4">
            <LoaderCircle className="h-12 w-12 animate-spin text-primary" />
            <p className="text-muted-foreground animate-pulse">Saving your story...</p>
          </div>
        )}

        {/* Story Complete */}
        {browserState === 'complete' && (
          <Card className={`w-full bg-gradient-to-br from-green-50 to-emerald-50 dark:from-green-950 dark:to-emerald-950`}>
            <CardHeader className="text-center">
              <div className="flex justify-center mb-2">
                <CheckCircle className="h-12 w-12 text-green-600" />
              </div>
              <CardTitle>Story Complete!</CardTitle>
              <CardDescription>Your adventure has come to an end.</CardDescription>
            </CardHeader>
            {finalStory && (
              <CardContent>
                <p className="text-lg leading-relaxed whitespace-pre-wrap">{finalStory}</p>
              </CardContent>
            )}
          </Card>
        )}
      </div>

      {/* Diagnostics Panel */}
      <DiagnosticsPanel
        pageName="story-browser"
        className="w-full max-w-4xl mt-8"
        data={{
          sessionId,
          generatorId,
          browserState,
          isEndingPhase,
          errorMessage: errorMessage || undefined,
          // Generator info
          generator: generator ? {
            name: generator.name,
            apiEndpoint: generator.apiEndpoint,
            requiresStoryType: generator.capabilities?.requiresStoryType,
            supportsCharacterIntroduction: generator.capabilities?.supportsCharacterIntroduction,
          } : null,
          generatorLoading,
          generatorError: generatorError?.message || null,
          firestoreReady: !!firestore,
          // Session info
          session: session ? {
            storyTypeId: session.storyTypeId || null,
            arcStepIndex: session.arcStepIndex ?? 0,
            currentPhase: session.currentPhase || null,
            storyMode: session.storyMode || null,
          } : null,
          // Story type info
          activeStoryType: activeStoryType ? {
            id: activeStoryType.id,
            name: activeStoryType.name,
            arcStepsCount: activeStoryType.arcTemplate?.steps?.length ?? 0,
          } : null,
          // Content state
          headerTextLength: headerText?.length || 0,
          currentQuestionLength: currentQuestion?.length || 0,
          optionsCount: currentOptions.length,
          // Audio state
          audio: {
            isSpeechModeEnabled,
            isSpeaking,
            isTTSLoading,
            musicEnabled,
            backgroundMusicPlaying: backgroundMusic.isPlaying,
            backgroundMusicAvailable: !!backgroundMusicUrl,
          },
          // API debug info
          debug: debugInfo,
        }}
      />
    </div>
  );
}
