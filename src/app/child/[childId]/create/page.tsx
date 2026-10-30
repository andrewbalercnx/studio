'use client';

import { use, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { LoaderCircle } from 'lucide-react';
import { useUser } from '@/firebase/auth/use-user';
import { useAppContext } from '@/hooks/use-app-context';
import { ModeChooser } from '@/components/creation';

/**
 * Web child shell: choose how to make a story (the same chooser as the kids
 * PWA). The Story is created on the server and played at
 * `/child/{childId}/create/{storyId}`.
 */
export default function ChildCreateStoryPage({ params }: { params: Promise<{ childId: string }> }) {
  const { childId } = use(params);
  const router = useRouter();
  const { user, loading: userLoading } = useUser();
  const { activeChildId, setActiveChildId, activeChildProfile } = useAppContext();

  useEffect(() => {
    if (childId && childId !== activeChildId) setActiveChildId(childId);
  }, [childId, activeChildId, setActiveChildId]);

  if (userLoading || !user) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <LoaderCircle className="h-12 w-12 animate-spin text-amber-500" />
      </div>
    );
  }

  return (
    <div className="bg-gradient-to-b from-amber-50 to-orange-50">
      <ModeChooser
        childId={childId}
        child={activeChildProfile}
        homeHref={`/child/${childId}`}
        onCreated={(storyId) => router.push(`/child/${childId}/create/${storyId}`)}
      />
    </div>
  );
}
