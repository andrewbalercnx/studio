'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useUser } from '@/firebase/auth/use-user';
import { useFirestore } from '@/firebase';
import { doc, getDoc, setDoc, serverTimestamp, collection, writeBatch } from 'firebase/firestore';
import { useKidsPWA } from '../layout';
import type { ChildProfile, StoryWizardChoice, StoryWizardOutput, StoryWizardAnswer, StoryGenerator } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { LoaderCircle, ArrowLeft, Wand2, Sparkles, BookOpen, MessageCircle, Users, Star } from 'lucide-react';
import Link from 'next/link';
import { storyWizardFlow } from '@/ai/flows/story-wizard-flow';
import { useToast } from '@/hooks/use-toast';
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar';

// Type for entity metadata included in resolved options
type EntityMetadata = {
  id: string;
  displayName: string;
  avatarUrl?: string;
  type: 'character' | 'child';
};

// Extended choice type with entity metadata
type ChoiceWithEntities = StoryWizardChoice & {
  entities?: EntityMetadata[];
};

/**
 * Icon mapping from generator styling.icon string to Lucide component.
 * Add new icons here when creating generators with new icon types.
 */
const ICON_MAP: Record<string, React.ComponentType<{ className?: string }>> = {
  Wand2: Wand2,
  wand: Wand2,
  MessageCircle: MessageCircle,
  chat: MessageCircle,
  Sparkles: Sparkles,
  sparkles: Sparkles,
  BookOpen: BookOpen,
  book: BookOpen,
  Users: Users,
  users: Users,
  Star: Star,
  star: Star,
};

const DefaultIcon = Sparkles;

// Component for rendering a choice button with entity avatars
function ChoiceButton({
  choice,
  onClick,
  disabled,
  className = ''
}: {
  choice: ChoiceWithEntities;
  onClick: () => void;
  disabled?: boolean;
  className?: string;
}) {
  const entities = choice.entities || [];
  const hasEntities = entities.length > 0 && entities.some(e => e.avatarUrl);

  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`w-full text-left p-5 rounded-2xl bg-white border-2 border-amber-200 hover:border-amber-400 hover:shadow-lg active:scale-98 transition-all disabled:opacity-50 disabled:cursor-not-allowed ${className}`}
    >
      <div className="flex items-center gap-3 w-full">
        {hasEntities && (
          <div className="flex -space-x-2 flex-shrink-0">
            {entities.filter(e => e.avatarUrl).slice(0, 3).map((entity) => (
              <Avatar key={entity.id} className="h-10 w-10 border-2 border-white shadow-sm">
                <AvatarImage src={entity.avatarUrl} alt={entity.displayName} />
                <AvatarFallback className="text-xs bg-amber-100 text-amber-700">
                  {entity.displayName.charAt(0).toUpperCase()}
                </AvatarFallback>
              </Avatar>
            ))}
          </div>
        )}
        <span className="flex-1 text-lg text-gray-800 leading-relaxed whitespace-normal">
          {choice.text}
        </span>
      </div>
    </button>
  );
}

// Helper to get icon component from generator styling
function GeneratorIcon({ iconName, className }: { iconName?: string; className?: string }) {
  const IconComponent = iconName ? ICON_MAP[iconName] || DefaultIcon : DefaultIcon;
  return <IconComponent className={className} />;
}

// Flow selection card component for a generator
function GeneratorCard({
  generator,
  onClick,
  disabled,
}: {
  generator: StoryGenerator;
  onClick: () => void;
  disabled?: boolean;
}) {
  // Extract gradient from styling, with fallback
  const gradient = generator.styling?.gradient || 'bg-gradient-to-br from-amber-400 to-orange-500';

  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="w-full text-left p-6 rounded-3xl bg-white border-2 border-amber-200 hover:border-amber-400 hover:shadow-xl active:scale-98 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
    >
      <div className="flex items-center gap-4">
        <div className={`flex-shrink-0 w-16 h-16 rounded-2xl ${gradient} flex items-center justify-center shadow-lg`}>
          <GeneratorIcon iconName={generator.styling?.icon} className="h-8 w-8 text-white" />
        </div>
        <div className="flex-1">
          <h3 className="text-xl font-bold text-gray-900">{generator.name}</h3>
          <p className="text-gray-600 text-sm mt-1">{generator.description}</p>
        </div>
      </div>
    </button>
  );
}

export default function KidsCreateStoryPage() {
  const router = useRouter();
  const { user, loading: userLoading } = useUser();
  const firestore = useFirestore();
  const { childId, childProfile, isLocked } = useKidsPWA();
  const { toast } = useToast();

  // Generator selection state - now uses StoryGenerator from the collection
  const [selectedGenerator, setSelectedGenerator] = useState<StoryGenerator | null>(null);
  const [generators, setGenerators] = useState<StoryGenerator[]>([]);
  const [generatorsLoading, setGeneratorsLoading] = useState(true);

  // Wizard-specific state
  const [isInitializing, setIsInitializing] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [wizardState, setWizardState] = useState<StoryWizardOutput | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [currentAnswers, setCurrentAnswers] = useState<StoryWizardAnswer[]>([]);

  // Fetch generators from storyGenerators collection (filtered by status=live and enabledForKids=true)
  useEffect(() => {
    const fetchGenerators = async () => {
      try {
        const response = await fetch('/api/kids-generators');
        const result = await response.json();
        if (result.ok && result.generators) {
          setGenerators(result.generators);

          // Auto-select if only one generator is available
          if (result.generators.length === 1) {
            setSelectedGenerator(result.generators[0]);
          }
        } else {
          console.error('[KidsCreate] API returned error:', result.errorMessage);
          setGenerators([]);
        }
      } catch (err) {
        console.error('[KidsCreate] Error fetching generators:', err);
        setGenerators([]);
      } finally {
        setGeneratorsLoading(false);
      }
    };

    fetchGenerators();
  }, []);

  // Handle generator selection
  const handleSelectGenerator = useCallback(async (generator: StoryGenerator) => {
    if (!user || !firestore || !childId) return;

    setSelectedGenerator(generator);

    // Wizard generator has special handling (stays on page for Q&A flow)
    // All other generators redirect to /story/play
    if (generator.id !== 'wizard') {
      setIsProcessing(true);
      try {
        // Verify child profile
        const childRef = doc(firestore, 'children', childId);
        const childDoc = await getDoc(childRef);
        if (!childDoc.exists()) {
          throw new Error('Child profile not found');
        }
        const child = childDoc.data() as ChildProfile;
        if (child.ownerParentUid !== user.uid) {
          throw new Error('Permission denied');
        }

        // Create story session with selected generator
        const storySessionRef = doc(collection(firestore, 'storySessions'));
        const newSessionId = storySessionRef.id;

        // Chat flow uses currentPhase: 'story' (legacy), others use their generator id
        const newSessionData = generator.id === 'chat' ? {
          childId: childId,
          parentUid: user.uid,
          status: 'in_progress' as const,
          currentPhase: 'story' as const,
          storyTitle: '',
          storyVibe: '',
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
          id: newSessionId,
        } : {
          childId: childId,
          parentUid: user.uid,
          status: 'in_progress' as const,
          currentPhase: generator.id,
          storyMode: generator.id,
          storyTitle: '',
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
          id: newSessionId,
        };

        const batch = writeBatch(firestore);
        batch.set(storySessionRef, newSessionData);

        const childSessionRef = doc(firestore, 'children', childId, 'sessions', newSessionId);
        batch.set(childSessionRef, newSessionData);

        await batch.commit();

        // Redirect to play page which handles all these flows
        router.push(`/story/play/${newSessionId}`);
      } catch (err: any) {
        console.error('[KidsCreate] Error starting generator:', err);
        setError(err.message || 'Something went wrong');
        setSelectedGenerator(null);
        setIsProcessing(false);
      }
    }
    // For wizard generator, the existing useEffect will handle initialization
  }, [user, firestore, childId, router]);

  // Create story session and start wizard (only when wizard generator is selected)
  useEffect(() => {
    if (userLoading || !user || !firestore || !childId || selectedGenerator?.id !== 'wizard') return;
    if (sessionId) return; // Already initialized

    const initializeWizard = async () => {
      try {
        setIsInitializing(true);
        setError(null);

        // Verify child profile
        const childRef = doc(firestore, 'children', childId);
        const childDoc = await getDoc(childRef);
        if (!childDoc.exists()) {
          throw new Error('Child profile not found');
        }
        const child = childDoc.data() as ChildProfile;
        if (child.ownerParentUid !== user.uid) {
          throw new Error('Permission denied');
        }

        // Create story session
        const storySessionRef = doc(collection(firestore, 'storySessions'));
        const newSessionId = storySessionRef.id;

        const newSessionData = {
          childId: childId,
          parentUid: user.uid,
          status: 'in_progress' as const,
          currentPhase: 'wizard' as const,
          currentStepIndex: 0,
          storyTitle: '',
          storyVibe: '',
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
          id: newSessionId,
          storyMode: 'wizard' as const,
        };

        const batch = writeBatch(firestore);
        batch.set(storySessionRef, newSessionData);

        const childSessionRef = doc(firestore, 'children', childId, 'sessions', newSessionId);
        batch.set(childSessionRef, newSessionData);

        await batch.commit();

        setSessionId(newSessionId);

        // Start wizard flow
        setIsProcessing(true);
        const result = await storyWizardFlow({
          childId: childId,
          sessionId: newSessionId,
          answers: [],
        });

        if (!result.ok) {
          throw new Error((result as any).error || 'Wizard failed to start');
        }

        setWizardState(result);
        if (result.state === 'asking') {
          setCurrentAnswers(result.answers || []);
        }
      } catch (err: any) {
        console.error('[KidsCreate] Error initializing wizard:', err);
        setError(err.message || 'Something went wrong');
      } finally {
        setIsInitializing(false);
        setIsProcessing(false);
      }
    };

    initializeWizard();
  }, [userLoading, user, firestore, childId, selectedGenerator, sessionId]);

  // Handle choice selection (wizard flow)
  const handleSelectChoice = useCallback(async (choice: StoryWizardChoice) => {
    if (!sessionId || !childId || !wizardState || isProcessing) return;
    if (wizardState.state !== 'asking') return;

    const newAnswers: StoryWizardAnswer[] = [
      ...currentAnswers,
      { question: wizardState.question!, answer: choice.text },
    ];

    setIsProcessing(true);
    setError(null);

    try {
      const result = await storyWizardFlow({
        childId: childId,
        sessionId: sessionId,
        answers: newAnswers,
      });

      if (!result.ok) {
        throw new Error((result as any).error || 'Wizard failed');
      }

      setWizardState(result);

      if (result.state === 'asking') {
        setCurrentAnswers(result.answers || []);
      } else if (result.state === 'finished' && result.storyText) {
        // Story is complete - update session and redirect to style selection
        if (firestore) {
          const sessionRef = doc(firestore, 'storySessions', sessionId);
          await setDoc(
            sessionRef,
            {
              status: 'completed',
              storyTitle: result.title || 'A Magical Story',
              storyVibe: result.vibe || '',
              updatedAt: serverTimestamp(),
            },
            { merge: true }
          );
        }

        toast({
          title: 'Story Complete!',
          description: 'Now choose how your book will look!',
        });

        router.push(`/kids/create/${sessionId}/style`);
      }
    } catch (err: any) {
      console.error('[KidsCreate] Error in wizard:', err);
      setError(err.message || 'Something went wrong');
    } finally {
      setIsProcessing(false);
    }
  }, [sessionId, childId, wizardState, currentAnswers, isProcessing, firestore, router, toast]);

  // Redirect if not set up
  useEffect(() => {
    if (!userLoading && (!user || !isLocked || !childId)) {
      router.replace('/kids');
    }
  }, [userLoading, user, isLocked, childId, router]);

  // Loading generators
  if (userLoading || generatorsLoading) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center p-4 gap-4">
        <LoaderCircle className="h-12 w-12 animate-spin text-amber-500" />
        <p className="text-lg text-amber-800 font-medium text-center">
          Loading...
        </p>
      </div>
    );
  }

  // Generator selection screen - display generators from storyGenerators collection
  if (!selectedGenerator && generators.length > 0) {
    return (
      <div className="min-h-screen flex flex-col">
        {/* Header */}
        <header className="px-4 py-4 flex items-center gap-3">
          <Link href="/kids">
            <Button variant="ghost" size="icon" className="text-amber-700">
              <ArrowLeft className="h-5 w-5" />
            </Button>
          </Link>
          <div className="flex-1 flex items-center justify-center">
            <Avatar className="h-8 w-8 border-2 border-amber-300">
              {childProfile?.avatarUrl ? (
                <AvatarImage src={childProfile.avatarUrl} alt={childProfile.displayName} />
              ) : null}
              <AvatarFallback className="bg-gradient-to-br from-amber-200 to-orange-300 text-amber-800 text-sm font-bold">
                {childProfile?.displayName?.charAt(0).toUpperCase() || '?'}
              </AvatarFallback>
            </Avatar>
          </div>
          <div className="w-10" />
        </header>

        {/* Main content */}
        <main className="flex-1 flex flex-col items-center justify-center px-4 pb-8">
          <div className="w-full max-w-md space-y-6">
            <div className="text-center space-y-2">
              <div className="text-5xl mb-4">✨</div>
              <h1 className="text-2xl font-bold text-amber-900 leading-tight">
                How do you want to create your story?
              </h1>
              <p className="text-amber-700">
                Pick your favorite way to begin!
              </p>
            </div>

            <div className="space-y-4">
              {generators.map((generator) => (
                <GeneratorCard
                  key={generator.id}
                  generator={generator}
                  onClick={() => handleSelectGenerator(generator)}
                />
              ))}
            </div>
          </div>
        </main>
      </div>
    );
  }

  // No generators available - show friendly message
  if (!selectedGenerator && generators.length === 0) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center p-4 gap-4">
        <div className="text-5xl mb-4">😢</div>
        <h1 className="text-2xl font-bold text-amber-900 text-center">
          No story adventures available right now
        </h1>
        <p className="text-amber-700 text-center">
          Please ask a grown-up to check the settings.
        </p>
        <Link href="/kids">
          <Button className="mt-4">Go Back Home</Button>
        </Link>
      </div>
    );
  }

  // Loading states (wizard initialization)
  if (isInitializing) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center p-4 gap-4">
        <div className="relative">
          <div className="w-24 h-24 rounded-full bg-gradient-to-br from-amber-200 to-orange-300 flex items-center justify-center animate-pulse">
            <Wand2 className="h-12 w-12 text-amber-700" />
          </div>
        </div>
        <p className="text-lg text-amber-800 font-medium text-center">
          Summoning the Story Wizard...
        </p>
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <Card className="w-full max-w-sm text-center">
          <CardHeader>
            <CardTitle className="text-red-600">Oops!</CardTitle>
            <CardDescription>{error}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Button
              variant="outline"
              className="w-full"
              onClick={() => {
                setError(null);
                setSelectedGenerator(null);
                setSessionId(null);
              }}
            >
              Try Again
            </Button>
            <Button
              variant="ghost"
              className="w-full"
              onClick={() => router.push('/kids')}
            >
              Go Back Home
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Processing state (between questions or starting generator)
  if (isProcessing) {
    const loadingMessage = selectedGenerator?.styling?.loadingMessage || 'Starting your adventure...';
    return (
      <div className="min-h-screen flex flex-col items-center justify-center p-4 gap-6">
        <div className="relative">
          <LoaderCircle className="h-16 w-16 text-amber-500 animate-spin" />
        </div>
        <div className="text-center space-y-2">
          <p className="text-xl text-amber-800 font-medium">
            {selectedGenerator?.id === 'wizard' ? 'The wizard is thinking...' : loadingMessage}
          </p>
          <p className="text-amber-600">
            {selectedGenerator?.id === 'wizard' ? 'Creating the next part of your adventure!' : 'Get ready for something amazing!'}
          </p>
        </div>
      </div>
    );
  }

  // Wizard question display
  if (selectedGenerator?.id === 'wizard' && wizardState?.state === 'asking' && wizardState.question) {
    return (
      <div className="min-h-screen flex flex-col">
        {/* Header with child avatar */}
        <header className="px-4 py-4 flex items-center gap-3">
          <Link href="/kids">
            <Button variant="ghost" size="icon" className="text-amber-700">
              <ArrowLeft className="h-5 w-5" />
            </Button>
          </Link>
          <div className="flex-1 flex items-center justify-center gap-2">
            <Avatar className="h-8 w-8 border-2 border-amber-300">
              {childProfile?.avatarUrl ? (
                <AvatarImage src={childProfile.avatarUrl} alt={childProfile.displayName} />
              ) : null}
              <AvatarFallback className="bg-gradient-to-br from-amber-200 to-orange-300 text-amber-800 text-sm font-bold">
                {childProfile?.displayName?.charAt(0).toUpperCase() || '?'}
              </AvatarFallback>
            </Avatar>
            <p className="text-sm text-amber-700">
              Question {currentAnswers.length + 1}
            </p>
          </div>
          <div className="w-10" /> {/* Spacer for centering */}
        </header>

        {/* Main content */}
        <main className="flex-1 flex flex-col items-center justify-center px-4 pb-8">
          <div className="w-full max-w-md space-y-6">
            {/* Question */}
            <div className="text-center space-y-2">
              <div className="text-5xl mb-4">
                {getQuestionEmoji(currentAnswers.length)}
              </div>
              <h1 className="text-2xl font-bold text-amber-900 leading-tight">
                {wizardState.question}
              </h1>
            </div>

            {/* Choices */}
            <div className="space-y-3">
              {wizardState.choices?.map((choice, index) => (
                <ChoiceButton
                  key={index}
                  choice={choice as ChoiceWithEntities}
                  onClick={() => handleSelectChoice(choice)}
                  disabled={isProcessing}
                />
              ))}
            </div>
          </div>
        </main>

        {/* Progress indicator */}
        <footer className="px-4 py-4 flex justify-center gap-1.5">
          {[...Array(5)].map((_, i) => (
            <div
              key={i}
              className={`h-2 w-8 rounded-full transition-colors ${
                i <= currentAnswers.length ? 'bg-amber-500' : 'bg-amber-200'
              }`}
            />
          ))}
        </footer>
      </div>
    );
  }

  // Fallback loading
  return (
    <div className="min-h-screen flex items-center justify-center">
      <LoaderCircle className="h-12 w-12 animate-spin text-amber-500" />
    </div>
  );
}

// Helper to get question-specific emoji
function getQuestionEmoji(questionIndex: number): string {
  const emojis = ['🌟', '🦄', '🏰', '🎭', '✨'];
  return emojis[questionIndex % emojis.length];
}
