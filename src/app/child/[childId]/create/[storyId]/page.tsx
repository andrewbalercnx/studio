'use client';

import { use, useCallback, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { LoaderCircle } from 'lucide-react';
import { useUser } from '@/firebase/auth/use-user';
import { useAppContext } from '@/hooks/use-app-context';
import { useToast } from '@/hooks/use-toast';
import { StoryPlay } from '@/components/creation';

/** Web child shell: make the story, turn by turn; once it is complete, choose the book's Form and Style. */
export default function ChildPlayStoryPage({ params }: { params: Promise<{ childId: string; storyId: string }> }) {
  const { childId, storyId } = use(params);
  const router = useRouter();
  const { toast } = useToast();
  const { user, loading: userLoading } = useUser();
  const { activeChildId, setActiveChildId, activeChildProfile } = useAppContext();

  useEffect(() => {
    if (childId && childId !== activeChildId) setActiveChildId(childId);
  }, [childId, activeChildId, setActiveChildId]);

  const onComplete = useCallback(
    (id: string) => {
      toast({ title: 'Story Complete!', description: 'Now choose how your book will look!' });
      router.push(`/child/${childId}/create-book/${id}`);
    },
    [router, toast, childId]
  );

  if (userLoading || !user) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <LoaderCircle className="h-12 w-12 animate-spin text-amber-500" />
      </div>
    );
  }

  return (
    <div className="bg-gradient-to-b from-amber-50 to-orange-50">
      <StoryPlay storyId={storyId} child={activeChildProfile} homeHref={`/child/${childId}`} onComplete={onComplete} />
    </div>
  );
}
