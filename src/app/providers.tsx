
'use client';

import { usePathname } from 'next/navigation';
import { FirebaseClientProvider } from '@/firebase/client-provider';
import Header from '@/components/header';
import { Toaster } from '@/components/ui/toaster';
import { FirebaseErrorListener } from '@/components/FirebaseErrorListener';
import { ParentGuardProvider } from '@/hooks/use-parent-guard';
import { AppContextProvider } from '@/hooks/use-app-context';
import { DiagnosticsProvider } from '@/hooks/use-diagnostics';
import { WizardTargetDiagnosticsProvider } from '@/hooks/use-wizard-target-diagnostics';
import { PathRecordingProvider } from '@/hooks/use-path-recording';
import { HelpWizard } from '@/components/help-wizard';
import { WizardTargetOverlay } from '@/components/wizard-target-overlay';
import { StartupWizardTrigger } from '@/components/startup-wizard-trigger';

// Routes that should not show the standard header/chrome
const PUBLIC_ROUTES = ['/storybook/share/'];

function isPublicRoute(pathname: string | null): boolean {
  if (!pathname) return false;
  return PUBLIC_ROUTES.some(route => pathname.startsWith(route));
}

export function Providers({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isPublic = isPublicRoute(pathname);

  // Public routes get minimal chrome - no header, no wizards, no overlays
  if (isPublic) {
    return (
      <div className="relative min-h-screen">
        {children}
        <Toaster />
      </div>
    );
  }

  return (
    <FirebaseClientProvider>
      <AppContextProvider>
        <DiagnosticsProvider>
          <WizardTargetDiagnosticsProvider>
            <PathRecordingProvider>
              <ParentGuardProvider>
              <div className="relative flex min-h-screen flex-col">
                <Header />
                <main className="flex-1">{children}</main>
              </div>
              <Toaster />
              <FirebaseErrorListener />
              <HelpWizard />
              <WizardTargetOverlay />
              <StartupWizardTrigger />
            </ParentGuardProvider>
            </PathRecordingProvider>
          </WizardTargetDiagnosticsProvider>
        </DiagnosticsProvider>
      </AppContextProvider>
    </FirebaseClientProvider>
  );
}
