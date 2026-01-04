'use client';

import { useEffect, useState } from 'react';
import { useAppContext } from '@/hooks/use-app-context';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { LoaderCircle, MessageCircle, Wand2, Sparkles, BookOpen, Users, Star } from 'lucide-react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { useFirestore } from '@/firebase';
import { collection, getDocs, query, where } from 'firebase/firestore';
import type { StoryGenerator } from '@/lib/types';

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

/**
 * Default icon to use if generator's icon is not in ICON_MAP
 */
const DefaultIcon = Sparkles;

/**
 * Preferred display order for generators.
 * Generators not in this list will appear at the end in alphabetical order.
 */
const PREFERRED_ORDER = ['chat', 'wizard', 'gemini3', 'gemini4', 'friends'];

function GeneratorIcon({ iconName, className }: { iconName?: string; className?: string }) {
  const IconComponent = iconName ? ICON_MAP[iconName] || DefaultIcon : DefaultIcon;
  return <IconComponent className={className} />;
}

export default function StartStoryChoicePage() {
  const { activeChildProfile, activeChildProfileLoading } = useAppContext();
  const firestore = useFirestore();

  const [generators, setGenerators] = useState<StoryGenerator[]>([]);
  const [loading, setLoading] = useState(true);

  // Fetch generators that are live and enabled for kids
  useEffect(() => {
    const fetchGenerators = async () => {
      if (!firestore) {
        setLoading(false);
        return;
      }

      try {
        // Query for live generators that are enabled for kids
        const generatorsQuery = query(
          collection(firestore, 'storyGenerators'),
          where('status', '==', 'live'),
          where('enabledForKids', '==', true)
        );
        const snapshot = await getDocs(generatorsQuery);

        const generatorList: StoryGenerator[] = [];
        snapshot.forEach((doc) => {
          generatorList.push({ ...doc.data(), id: doc.id } as StoryGenerator);
        });

        // Sort by preferred order, then alphabetically for unlisted generators
        generatorList.sort((a, b) => {
          const aIndex = PREFERRED_ORDER.indexOf(a.id);
          const bIndex = PREFERRED_ORDER.indexOf(b.id);

          // Both in preferred order: sort by order
          if (aIndex !== -1 && bIndex !== -1) {
            return aIndex - bIndex;
          }
          // Only a in preferred order: a comes first
          if (aIndex !== -1) return -1;
          // Only b in preferred order: b comes first
          if (bIndex !== -1) return 1;
          // Neither in preferred order: alphabetical by name
          return a.name.localeCompare(b.name);
        });

        setGenerators(generatorList);
      } catch (err) {
        console.error('[story/start] Error fetching generators:', err);
      } finally {
        setLoading(false);
      }
    };

    fetchGenerators();
  }, [firestore]);

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

  // Dynamic grid columns based on number of generators
  const gridCols = generators.length <= 2
    ? 'md:grid-cols-2'
    : generators.length === 3
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
        {generators.map((generator) => {
          const gradient = generator.styling?.gradient || 'bg-gray-500';
          const iconName = generator.styling?.icon;

          // Determine text color based on gradient
          const textColorClass = gradient.includes('bg-accent')
            ? 'text-accent-foreground'
            : gradient.includes('bg-primary')
              ? 'text-primary-foreground'
              : 'text-white';

          return (
            <Link key={generator.id} href={`/story/start/${generator.id}`}>
              <div className="flex cursor-pointer flex-col items-center gap-4 rounded-full border-4 border-transparent p-8 text-center transition-all hover:border-primary/50 hover:bg-primary/10">
                <div className={`flex h-32 w-32 items-center justify-center rounded-full ${gradient} ${textColorClass}`}>
                  <GeneratorIcon iconName={iconName} className="h-16 w-16" />
                </div>
                <h2 className="text-2xl font-semibold">{generator.name}</h2>
                <p className="max-w-xs text-muted-foreground">{generator.description}</p>
              </div>
            </Link>
          );
        })}
      </div>

      {generators.length === 0 && (
        <div className="text-center text-muted-foreground">
          <p>No story generators are currently available.</p>
          <p className="text-sm mt-2">Please check with your administrator.</p>
        </div>
      )}
    </div>
  );
}
