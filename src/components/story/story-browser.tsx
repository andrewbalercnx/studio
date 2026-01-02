'use client';

import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useFirestore } from '@/firebase';
import { useUser } from '@/firebase/auth/use-user';
import { doc, collection, query, where, updateDoc, serverTimestamp, addDoc, getDoc } from 'firebase/firestore';
import { useDocument, useCollection } from '@/lib/firestore-hooks';
import { useToast } from '@/hooks/use-toast';
import { useStoryTTS } from '@/hooks/use-story-tts';
import { useBackgroundMusic } from '@/hooks/use-background-music';

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { LoaderCircle, Settings, RefreshCw, Sparkles, Star, CheckCircle } from 'lucide-react';
import Link from 'next/link';

import { ChoiceButton, type ChoiceWithEntities } from './choice-button';
import { CharacterIntroductionCard } from './character-introduction-card';
import { ChildAvatarAnimation } from '@/components/child/child-avatar-animation';
import { SpeechModeToggle } from '@/components/child/speech-mode-toggle';

import type {
  StoryGenerator,
  StoryGeneratorResponse,
  StoryGeneratorResponseOption,
  StorySession,
  StoryType,
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
  | 'complete'          // Story complete
  | 'error';            // Error state

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
}: StoryBrowserProps) {
  const firestore = useFirestore();
  const { user } = useUser();
  const { toast } = useToast();

  // ---------------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------------
  const [browserState, setBrowserState] = useState<BrowserState>('loading');
  const [currentQuestion, setCurrentQuestion] = useState<string>('');
  const [currentOptions, setCurrentOptions] = useState<StoryGeneratorResponseOption[]>([]);
  const [finalStory, setFinalStory] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [characterIntro, setCharacterIntro] = useState<CharacterIntroState | null>(null);
  const [isLoadingMore, setIsLoadingMore] = useState(false);

  // Track spoken content to avoid re-speaking
  const lastSpokenContentRef = useRef<string>('');

  // ---------------------------------------------------------------------------
  // Firestore Queries
  // ---------------------------------------------------------------------------
  const generatorRef = useMemo(
    () => (firestore ? doc(firestore, 'storyGenerators', generatorId) : null),
    [firestore, generatorId]
  );
  const { data: generator, loading: generatorLoading } = useDocument<StoryGenerator>(generatorRef);

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

  const backgroundMusicUrl = generator?.backgroundMusic?.audioUrl;
  const backgroundMusic = useBackgroundMusic({
    audioUrl: backgroundMusicUrl ?? null,
    isSpeaking,
    normalVolume: 0.4,
    duckedVolume: 0.1,
  });

  // Music control based on state
  useEffect(() => {
    const hasAvatar = childProfile?.avatarAnimationUrl || childProfile?.avatarUrl;
    const showingAvatar = browserState === 'generating' || (isSpeechModeEnabled && isTTSLoading);
    const shouldPlayMusic = (showingAvatar && hasAvatar && backgroundMusicUrl) || (isSpeaking && backgroundMusicUrl);

    if (shouldPlayMusic && backgroundMusic.isLoaded && !backgroundMusic.isPlaying) {
      backgroundMusic.play();
    } else if (!shouldPlayMusic && backgroundMusic.isPlaying) {
      backgroundMusic.fadeOut();
    }
  }, [browserState, isTTSLoading, isSpeaking, backgroundMusic, backgroundMusicUrl, childProfile, isSpeechModeEnabled]);

  // ---------------------------------------------------------------------------
  // Auto-speak when content changes
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (!isSpeechModeEnabled || browserState !== 'question') return;

    const contentKey = `${currentQuestion}|${currentOptions.map(o => o.textResolved || o.text).join('|')}`;
    if (contentKey !== lastSpokenContentRef.current && currentQuestion) {
      lastSpokenContentRef.current = contentKey;
      speakStoryContent({
        questionText: currentQuestion,
        options: currentOptions.map(o => ({ text: o.textResolved || o.text })),
      });
    }
  }, [currentQuestion, currentOptions, browserState, isSpeechModeEnabled, speakStoryContent]);

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
  // API Call
  // ---------------------------------------------------------------------------
  const callGeneratorAPI = useCallback(async (selectedOptionId?: string) => {
    if (!generator || !user || !firestore) return;

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
        }),
      });

      if (!response.ok) {
        throw new Error(`API error: ${response.status}`);
      }

      const result: StoryGeneratorResponse = await response.json();

      if (!result.ok) {
        throw new Error(result.errorMessage || 'Unknown error');
      }

      // Handle story complete
      if (result.isStoryComplete) {
        setFinalStory(result.finalStoryResolved || result.finalStory || null);
        setBrowserState('complete');
        onStoryComplete?.(sessionId);
        return;
      }

      // Display question and options
      setCurrentQuestion(result.questionResolved || result.question);
      setCurrentOptions(result.options);
      setBrowserState('question');

    } catch (e: any) {
      console.error('[StoryBrowser] API error:', e);
      setErrorMessage(e.message || 'Failed to generate content');
      setBrowserState('error');
      onError?.(e.message);
    }
  }, [generator, user, firestore, sessionId, stopSpeech, onStoryComplete, onError]);

  // ---------------------------------------------------------------------------
  // Option Selection
  // ---------------------------------------------------------------------------
  const handleSelectOption = useCallback(async (option: StoryGeneratorResponseOption) => {
    if (!generator || !firestore || !user) return;

    // Check if this option introduces a character
    if (option.introducesCharacter && generator.capabilities.supportsCharacterIntroduction) {
      // Create the character first
      try {
        const response = await fetch('/api/characters/create', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${await user.getIdToken()}`,
          },
          body: JSON.stringify({
            sessionId,
            name: option.newCharacterName || 'New Friend',
            label: option.newCharacterLabel || 'A new friend',
            type: option.newCharacterType || 'Friend',
          }),
        });

        if (!response.ok) {
          throw new Error('Failed to create character');
        }

        const { characterId } = await response.json();

        // Show character introduction
        setCharacterIntro({
          characterId,
          characterName: option.newCharacterName || 'New Friend',
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

    // Call API with selected option
    await callGeneratorAPI(option.id);
  }, [generator, firestore, user, sessionId, callGeneratorAPI, toast]);

  // ---------------------------------------------------------------------------
  // Continue after character introduction
  // ---------------------------------------------------------------------------
  const handleContinueAfterCharacterIntro = useCallback(async () => {
    if (!characterIntro) return;

    // Continue with the pending option
    await callGeneratorAPI(characterIntro.pendingOption.id);
    setCharacterIntro(null);
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
    <div className="min-h-screen bg-background text-foreground flex flex-col items-center p-4">
      {/* Header */}
      <div className="fixed top-0 right-14 z-50 h-14 flex items-center gap-2">
        {childProfile && <SpeechModeToggle childProfile={childProfile} />}
        {showSettingsLink && (
          <Button variant="ghost" size="icon" asChild>
            <Link href={`/story/session/${sessionId}`} title="Diagnostic View">
              <Settings className="h-4 w-4" />
            </Link>
          </Button>
        )}
      </div>

      <div className="flex-grow flex flex-col items-center justify-center w-full max-w-2xl text-center">
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
        {browserState === 'question' && !showAvatarAnimation && (
          <div className="space-y-6 w-full">
            {/* Question */}
            <Card className={`w-full bg-gradient-to-br ${gradient} ${darkGradient}`}>
              <CardContent className="pt-6">
                <p className="text-xl font-medium leading-relaxed">{currentQuestion}</p>
              </CardContent>
            </Card>

            {/* Options */}
            <div className="grid grid-cols-1 gap-3">
              {currentOptions.map((option, idx) => {
                const optionLabel = String.fromCharCode(65 + idx); // A, B, C, D
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
                    disabled={browserState !== 'question'}
                  />
                );
              })}
            </div>

            {/* More Options Button */}
            {generator?.capabilities.supportsMoreOptions && (
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
    </div>
  );
}
