
'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAppContext } from '@/hooks/use-app-context';
import { LoaderCircle } from 'lucide-react';
import { useUser } from '@/firebase/auth/use-user';

export default function RoleRouterPage() {
  const router = useRouter();
  const { roleMode } = useAppContext();
  const { user, loading: userLoading } = useUser();

  useEffect(() => {
    if (roleMode === 'unknown' || userLoading) {
      // Still determining role, wait.
      return;
    }

    if (!user) {
      router.push('/login');
      return;
    }

    switch (roleMode) {
      case 'admin':
        router.push('/admin');
        break;
      case 'writer':
        router.push('/writer');
        break;
      case 'parent':
      case 'child':
      default:
        router.push('/parent');
        break;
    }
  }, [roleMode, router, user, userLoading]);

  return (
    <div className="h-screen w-screen flex flex-col items-center justify-center gap-4">
      <LoaderCircle className="h-12 w-12 animate-spin text-primary" />
      <p className="text-muted-foreground">Redirecting you...</p>
    </div>
  );
}
