
'use client';

import { FirebaseClientProvider } from '@/firebase/client-provider';
import Header from '@/components/header';
import { Toaster } from '@/components/ui/toaster';
import { FirebaseErrorListener } from '@/components/FirebaseErrorListener';
import { ParentGuardProvider } from '@/hooks/use-parent-guard';
import { AppContextProvider } from '@/hooks/use-app-context';
import { DiagnosticsProvider } from '@/hooks/use-diagnostics';
import { WizardTargetDiagnosticsProvider } from '@/hooks/use-wizard-target-diagnostics';
import { HelpWizard } from '@/components/help-wizard';
import { WizardTargetOverlay } from '@/components/wizard-target-overlay';

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <FirebaseClientProvider>
      <AppContextProvider>
        <DiagnosticsProvider>
          <WizardTargetDiagnosticsProvider>
            <ParentGuardProvider>
              <div className="relative flex min-h-screen flex-col">
                <Header />
                <main className="flex-1">{children}</main>
              </div>
              <Toaster />
              <FirebaseErrorListener />
              <HelpWizard />
              <WizardTargetOverlay />
            </ParentGuardProvider>
          </WizardTargetDiagnosticsProvider>
        </DiagnosticsProvider>
      </AppContextProvider>
    </FirebaseClientProvider>
  );
}
