'use client';

import { use, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { useAppContext } from '@/hooks/use-app-context';
import { BookChooser, ageFromDateOfBirth } from '@/components/books';

/**
 * Web child shell: the child picks a Form and a Style for a finished story.
 * The Book is created on the server (`POST /api/books`, which charges the
 * book allowance and starts the pipeline); the child then watches it at
 * `/books/{bookId}`.
 */
export default function CreateBookPage({ params }: { params: Promise<{ childId: string; storyId: string }> }) {
  const { childId, storyId } = use(params);
  const router = useRouter();
  const { activeChildProfile, setActiveChildId } = useAppContext();
  const childAge = useMemo(() => ageFromDateOfBirth(activeChildProfile?.dateOfBirth), [activeChildProfile]);

  useEffect(() => {
    setActiveChildId(childId);
  }, [childId, setActiveChildId]);

  return (
    <div className="min-h-screen bg-gradient-to-b from-amber-50 to-orange-50">
      <BookChooser
        storyId={storyId}
        childAge={childAge}
        onCreated={(bookId) => router.push(`/books/${bookId}`)}
        onExit={() => router.push(`/child/${childId}/stories`)}
      />
    </div>
  );
}
