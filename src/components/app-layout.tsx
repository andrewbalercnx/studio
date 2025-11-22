'use client';

import { FirebaseClientProvider } from '@/firebase/client-provider';
import Header from './header';
import { Toaster } from './ui/toaster';
import { cn } from '@/lib/utils';

export function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <FirebaseClientProvider>
      <div className={cn("h-full font-body antialiased bg-background")}>
        <div className="relative flex min-h-screen flex-col">
          <Header />
          <main className="flex-1">{children}</main>
        </div>
        <Toaster />
      </div>
    </FirebaseClientProvider>
  );
}
