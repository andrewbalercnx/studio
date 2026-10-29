'use client';

import { use, useCallback, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { LoaderCircle } from 'lucide-react';
import { useUser } from '@/firebase/auth/use-user';
import { useToast } from '@/hooks/use-toast';
import { useKidsPWA } from '../../layout';
import { StoryPlay } from '@/components/creation';

/** Kids PWA: make the story, turn by turn; once it is complete, choose how the book looks. */
export default function KidsPlayStoryPage({ params }: { params: Promise<{ storyId: string }> }) {
  const { storyId } = use(params);
  const router = useRouter();
  const { toast } = useToast();
  const { user, loading: userLoading } = useUser();
  const { childId, childProfile, isLocked } = useKidsPWA();

  useEffect(() => {
    if (!userLoading && (!user || !isLocked || !childId)) {
      router.replace('/kids');
    }
  }, [userLoading, user, isLocked, childId, router]);

  const onComplete = useCallback(
    (id: string) => {
      toast({ title: 'Story Complete!', description: 'Now choose how your book will look!' });
      router.push(`/kids/create/${id}/style`);
    },
    [router, toast]
  );

  if (userLoading || !user || !childId) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <LoaderCircle className="h-12 w-12 animate-spin text-amber-500" />
      </div>
    );
  }

  return <StoryPlay storyId={storyId} child={childProfile} homeHref="/kids" onComplete={onComplete} />;
}
