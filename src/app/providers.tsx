
'use client';

import { FirebaseClientProvider } from '@/firebase/client-provider';
import Header from '@/components/header';
import { Toaster } from '@/components/ui/toaster';
import { FirebaseErrorListener } from '@/components/FirebaseErrorListener';

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <FirebaseClientProvider>
      <div className="relative flex min-h-screen flex-col">
        <Header />
        <main className="flex-1">{children}</main>
      </div>
      <Toaster />
      <FirebaseErrorListener />
    </FirebaseClientProvider>
  );
}
