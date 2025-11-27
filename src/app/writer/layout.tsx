'use client';

import { ReactNode } from 'react';
import { useAppContext } from '@/hooks/use-app-context';
import { LoaderCircle } from 'lucide-react';
import { Card } from '@/components/ui/card';

export default function WriterLayout({ children }: { children: ReactNode }) {
  const { roleMode } = useAppContext();

  if (roleMode === 'unknown') {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <LoaderCircle className="h-10 w-10 animate-spin text-primary" />
      </div>
    );
  }

  if (roleMode !== 'writer' && roleMode !== 'admin') {
    return (
      <div className="flex min-h-screen items-center justify-center p-6">
        <Card className="max-w-md p-6 text-center">
          <p className="text-lg font-semibold">Writer Access Required</p>
          <p className="mt-2 text-sm text-muted-foreground">
            You must be granted the Writer role to view the Story Editor workspace.
          </p>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-muted/30">
      {children}
    </div>
  );
}
