
'use client';

import { FirebaseClientProvider } from '@/firebase/client-provider';
import Header from '@/components/header';
import { Toaster } from '@/components/ui/toaster';
import { FirebaseErrorListener } from '@/components/FirebaseErrorListener';
import { ParentGuardProvider } from '@/hooks/use-parent-guard';
import { AppContextProvider } from '@/hooks/use-app-context';

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <FirebaseClientProvider>
      <AppContextProvider>
        <ParentGuardProvider>
          <div className="relative flex min-h-screen flex-col">
            <Header />
            <main className="flex-1">{children}</main>
          </div>
          <Toaster />
          <FirebaseErrorListener />
        </ParentGuardProvider>
      </AppContextProvider>
    </FirebaseClientProvider>
  );
}
