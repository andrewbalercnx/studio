'use client';

import { use, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { LoaderCircle } from 'lucide-react';
import { useUser } from '@/firebase/auth/use-user';
import { useKidsPWA } from '../../../layout';
import { OnboardingTipTrigger } from '@/components/onboarding/onboarding-tip-trigger';
import { BookChooser, ageFromDateOfBirth } from '@/components/books';

/**
 * Kids PWA: the child picks a Form and a Style for a finished story; the Book
 * is created on the server (`POST /api/books`) and the child watches it at
 * `/kids/book/{bookId}`.
 */
export default function KidsStyleSelectionPage({ params }: { params: Promise<{ storyId: string }> }) {
  const { storyId } = use(params);
  const router = useRouter();
  const { user, loading: userLoading } = useUser();
  const { childId, childProfile, isLocked } = useKidsPWA();
  const childAge = useMemo(() => ageFromDateOfBirth(childProfile?.dateOfBirth), [childProfile]);

  useEffect(() => {
    if (!userLoading && (!user || !isLocked || !childId)) {
      router.replace('/kids');
    }
  }, [userLoading, user, isLocked, childId, router]);

  if (userLoading || !user || !childId) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <LoaderCircle className="h-12 w-12 animate-spin text-amber-500" />
      </div>
    );
  }

  return (
    <div className="min-h-screen">
      {/* First-use tip (auto-shows once per account; no-op once seen). */}
      <OnboardingTipTrigger tipId="artGeneration" wizardId="tip-first-art" />
      <BookChooser
        storyId={storyId}
        childAge={childAge}
        onCreated={(bookId) => router.push(`/kids/book/${bookId}`)}
        onExit={() => router.push(`/kids/story/${storyId}/read`)}
      />
    </div>
  );
}
