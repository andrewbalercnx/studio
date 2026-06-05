'use client';

import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { useDiagnostics } from '@/hooks/use-diagnostics';
import { getConsent, setConsent, CONSENT_CHANGE_EVENT, type ConsentState } from '@/lib/analytics/consent';
import { Button } from '@/components/ui/button';

/**
 * Parent-facing analytics consent banner. Only appears when analytics is admin-enabled and consent
 * is still unset — and never on the child-facing `/kids/*` surfaces (the parent consents, not the
 * child). Kept minimal so it doesn't dominate the top-of-funnel.
 */
export function ConsentBanner() {
  const { config } = useDiagnostics();
  const pathname = usePathname();
  const [consent, setConsentState] = useState<ConsentState>('granted'); // hide until mounted read
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    const read = () => setConsentState(getConsent());
    read();
    window.addEventListener(CONSENT_CHANGE_EVENT, read);
    return () => window.removeEventListener(CONSENT_CHANGE_EVENT, read);
  }, []);

  if (!mounted) return null;
  if (!config.enableAnalytics) return null; // nothing to consent to yet
  if (consent !== 'unset') return null; // decision already made
  if (pathname?.startsWith('/kids')) return null; // child surface — parent decides elsewhere

  return (
    <div className="fixed inset-x-0 bottom-0 z-50 border-t bg-background/95 p-4 shadow-lg backdrop-blur">
      <div className="mx-auto flex max-w-3xl flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-muted-foreground">
          We use privacy-friendly analytics to understand how families use StoryPic and improve it.
          We never collect children&apos;s names, photos, or story content. You can change this anytime.
        </p>
        <div className="flex shrink-0 gap-2">
          <Button variant="outline" size="sm" onClick={() => setConsent('denied')}>
            Decline
          </Button>
          <Button size="sm" onClick={() => setConsent('granted')}>
            Allow
          </Button>
        </div>
      </div>
    </div>
  );
}
