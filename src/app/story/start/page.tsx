'use client';

import { useEffect, useState } from 'react';
import { useAppContext } from '@/hooks/use-app-context';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { LoaderCircle, MessageCircle, Wand2, Sparkles, BookOpen } from 'lucide-react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { useFirestore } from '@/firebase';
import { collection, getDocs } from 'firebase/firestore';
import type { StoryGenerator } from '@/lib/types';

// Flow configuration from API
type FlowsConfig = {
  wizard: boolean;
  chat: boolean;
  gemini3: boolean;
  gemini4: boolean;
};

// Generator ID to flow key mapping
const GENERATOR_TO_FLOW: Record<string, keyof FlowsConfig> = {
  wizard: 'wizard',
  chat: 'chat',
  gemini3: 'gemini3',
  gemini4: 'gemini4',
};

// Default generator info (fallback if not in Firestore)
const DEFAULT_GENERATOR_INFO: Record<string, { name: string; description: string; gradient: string; icon: 'wand' | 'chat' | 'sparkles' | 'book' }> = {
  chat: {
    name: 'Create with Chat',
    description: 'Talk with the Story Guide step-by-step to build your tale.',
    gradient: 'bg-accent',
    icon: 'chat',
  },
  wizard: {
    name: 'Magic Story Wizard',
    description: 'Answer a few questions and let the AI create a full story for you!',
    gradient: 'bg-primary',
    icon: 'wand',
  },
  gemini3: {
    name: 'Creative Adventure',
    description: 'Let Gemini lead the way with creative questions to craft your unique adventure!',
    gradient: 'bg-gradient-to-br from-purple-500 to-pink-500',
    icon: 'sparkles',
  },
  gemini4: {
    name: 'Guided Story',
    description: 'Answer age-appropriate questions with 3 choices + "tell me more" to build your story!',
    gradient: 'bg-gradient-to-br from-emerald-500 to-teal-500',
    icon: 'book',
  },
};

// Order to display generators
const GENERATOR_ORDER = ['chat', 'wizard', 'gemini3', 'gemini4'];

function GeneratorIcon({ type, className }: { type: 'wand' | 'chat' | 'sparkles' | 'book'; className?: string }) {
  switch (type) {
    case 'wand':
      return <Wand2 className={className} />;
    case 'chat':
      return <MessageCircle className={className} />;
    case 'sparkles':
      return <Sparkles className={className} />;
    case 'book':
      return <BookOpen className={className} />;
  }
}

export default function StartStoryChoicePage() {
  const { activeChildProfile, activeChildProfileLoading } = useAppContext();
  const firestore = useFirestore();

  const [enabledFlows, setEnabledFlows] = useState<FlowsConfig | null>(null);
  const [generators, setGenerators] = useState<Map<string, StoryGenerator>>(new Map());
  const [loading, setLoading] = useState(true);

  // Fetch enabled flows and generator data
  useEffect(() => {
    const fetchData = async () => {
      try {
        // Fetch flows config
        const flowsResponse = await fetch('/api/kids-flows');
        const flowsResult = await flowsResponse.json();
        if (flowsResult.ok && flowsResult.flows) {
          setEnabledFlows(flowsResult.flows);
        } else {
          // Default to all enabled if API fails
          setEnabledFlows({ wizard: true, chat: true, gemini3: true, gemini4: true });
        }

        // Fetch generators from Firestore for custom names
        if (firestore) {
          const snapshot = await getDocs(collection(firestore, 'storyGenerators'));
          const generatorMap = new Map<string, StoryGenerator>();
          snapshot.forEach((doc) => {
            generatorMap.set(doc.id, { ...doc.data(), id: doc.id } as StoryGenerator);
          });
          setGenerators(generatorMap);
        }
      } catch (err) {
        console.error('[story/start] Error fetching data:', err);
        // Default to all enabled if API fails
        setEnabledFlows({ wizard: true, chat: true, gemini3: true, gemini4: true });
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [firestore]);

  // Get generator info (from Firestore or fallback to defaults)
  const getGeneratorInfo = (id: string) => {
    const generator = generators.get(id);
    const defaults = DEFAULT_GENERATOR_INFO[id] || {
      name: id,
      description: '',
      gradient: 'bg-gray-500',
      icon: 'sparkles' as const
    };

    return {
      name: generator?.name || defaults.name,
      description: generator?.description || defaults.description,
      gradient: generator?.styling?.gradient || defaults.gradient,
      icon: defaults.icon, // Icons are fixed based on generator type
    };
  };

  if (activeChildProfileLoading || loading) {
    return (
      <div className="container mx-auto flex min-h-screen items-center justify-center p-4">
        <LoaderCircle className="h-12 w-12 animate-spin text-primary" />
      </div>
    );
  }

  if (!activeChildProfile) {
    return (
      <div className="container mx-auto flex min-h-screen items-center justify-center p-4">
        <Card className="w-full max-w-md text-center">
          <CardHeader>
            <CardTitle>Choose a Profile</CardTitle>
            <CardDescription>
              Please select a child profile from the parent dashboard before starting a new story.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild>
              <Link href="/parent">Back to Parent Dashboard</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Filter generators based on enabled flows
  const enabledGenerators = GENERATOR_ORDER.filter((id) => {
    const flowKey = GENERATOR_TO_FLOW[id];
    return flowKey && enabledFlows?.[flowKey];
  });

  // Dynamic grid columns based on number of enabled generators
  const gridCols = enabledGenerators.length <= 2
    ? 'md:grid-cols-2'
    : enabledGenerators.length === 3
      ? 'md:grid-cols-3'
      : 'md:grid-cols-2 lg:grid-cols-4';

  return (
    <div className="container mx-auto flex min-h-screen flex-col items-center justify-center gap-10 p-4">
      <div className="text-center">
        <h1 className="text-4xl font-bold font-headline">How do you want to create your story?</h1>
        <p className="mt-2 text-lg text-muted-foreground">
          Choose a way to begin your adventure, {activeChildProfile.displayName}.
        </p>
      </div>
      <div className={`grid grid-cols-1 gap-8 ${gridCols}`}>
        {enabledGenerators.map((id) => {
          const info = getGeneratorInfo(id);
          const textColorClass = info.gradient.includes('bg-accent')
            ? 'text-accent-foreground'
            : info.gradient.includes('bg-primary')
              ? 'text-primary-foreground'
              : 'text-white';

          return (
            <Link key={id} href={`/story/start/${id}`}>
              <div className="flex cursor-pointer flex-col items-center gap-4 rounded-full border-4 border-transparent p-8 text-center transition-all hover:border-primary/50 hover:bg-primary/10">
                <div className={`flex h-32 w-32 items-center justify-center rounded-full ${info.gradient} ${textColorClass}`}>
                  <GeneratorIcon type={info.icon} className="h-16 w-16" />
                </div>
                <h2 className="text-2xl font-semibold">{info.name}</h2>
                <p className="max-w-xs text-muted-foreground">{info.description}</p>
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
