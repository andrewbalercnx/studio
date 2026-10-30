'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { LoaderCircle } from 'lucide-react';
import { useUser } from '@/firebase/auth/use-user';
import { useKidsPWA } from '../layout';
import { ModeChooser } from '@/components/creation';

/**
 * Kids PWA: choose how to make a story. The Story is created on the server
 * (`POST /api/stories`) and played at `/kids/create/{storyId}` — every mode
 * stays inside the PWA.
 */
export default function KidsCreateStoryPage() {
  const router = useRouter();
  const { user, loading: userLoading } = useUser();
  const { childId, childProfile, isLocked } = useKidsPWA();

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
    <ModeChooser
      childId={childId}
      child={childProfile}
      homeHref="/kids"
      onCreated={(storyId) => router.push(`/kids/create/${storyId}`)}
    />
  );
}
