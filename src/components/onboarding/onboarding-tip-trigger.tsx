'use client';

import { useEffect, useRef, useState } from 'react';
import { useUser } from '@/firebase/auth/use-user';
import { useFirestore } from '@/firebase';
import { useAppContext } from '@/hooks/use-app-context';
import { doc, getDoc } from 'firebase/firestore';
import type { HelpWizard, UserProfile } from '@/lib/types';
import type { OnboardingTipId } from '@/lib/onboarding';
import { track, ANALYTICS_EVENTS } from '@/lib/analytics';

/**
 * Auto-shows an in-context help-wizard tip the FIRST time a family reaches a
 * surface (story creation, art generation) — guided first-run instead of help
 * buried in a menu (Sprint W2-B).
 *
 * Reuses the existing help-wizard infrastructure: the tip itself is a normal
 * `helpWizards/{wizardId}` document (seeded from src/data/help-wizards.json
 * via the admin Help Wizards page) rendered by <HelpWizard/>. This component
 * only decides WHEN to start it:
 *
 *  - never if the tip was already shown (users/{uid}.onboardingState.tipsSeen)
 *  - never once onboarding is dismissed or complete (returning users)
 *  - never on top of another active wizard (e.g. the startup tour)
 *  - never if the wizard doc is missing or not live (e.g. emulator/E2E runs)
 *
 * The shown-flag is persisted server-side via POST /api/user/onboarding so a
 * tip fires exactly once per account, across devices.
 */
export function OnboardingTipTrigger({
  tipId,
  wizardId,
}: {
  tipId: OnboardingTipId;
  wizardId: string;
}) {
  const { user, loading: userLoading } = useUser();
  const firestore = useFirestore();
  const { activeWizard, startWizard } = useAppContext();
  const [hasChecked, setHasChecked] = useState(false);
  // Read once on mount; deliberately not reactive to wizard close/open churn.
  const activeWizardAtMount = useRef(activeWizard);

  useEffect(() => {
    if (userLoading || !user || !firestore || hasChecked) return;
    setHasChecked(true); // one-shot per mount, regardless of outcome

    const maybeShowTip = async () => {
      try {
        // Another wizard (e.g. the startup tour) is showing — don't stack.
        if (activeWizardAtMount.current) return;

        const userDoc = await getDoc(doc(firestore, 'users', user.uid));
        if (!userDoc.exists()) return;
        const profile = userDoc.data() as UserProfile;
        const onboarding = profile.onboardingState;

        if (onboarding?.tipsSeen?.[tipId]) return; // already shown
        if (onboarding?.dismissed || onboarding?.completedAtMs) return; // past onboarding

        const wizardDoc = await getDoc(doc(firestore, 'helpWizards', wizardId));
        if (!wizardDoc.exists()) return;
        const wizard = wizardDoc.data() as HelpWizard;
        if (wizard.status !== 'live' || !wizard.pages?.length) return;

        startWizard(wizardId);
        track(ANALYTICS_EVENTS.onboardingTipShown, { tipId });

        // Mark seen immediately (not on close) so the tip can never loop.
        const idToken = await user.getIdToken();
        await fetch('/api/user/onboarding', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
          body: JSON.stringify({ action: 'tipSeen', tipId }),
        });
      } catch (error) {
        // Tips are progressive enhancement — never let them break the surface.
        console.debug('[OnboardingTipTrigger] Skipping tip:', error);
      }
    };

    maybeShowTip();
  }, [user, userLoading, firestore, hasChecked, tipId, wizardId, startWizard]);

  return null;
}
