'use client';

import { useEffect, useState, useRef } from 'react';
import { useUser } from '@/firebase/auth/use-user';
import { useFirestore } from '@/firebase';
import { useAppContext } from '@/hooks/use-app-context';
import { doc, getDoc, updateDoc, collection, query, where, getDocs, limit } from 'firebase/firestore';
import type { UserProfile, HelpWizard } from '@/lib/types';

/**
 * StartupWizardTrigger checks if the current user is new and hasn't seen the
 * default startup wizard yet. If so, it automatically starts that wizard.
 *
 * When the wizard closes (either by completing or by user closing it), it marks
 * the user's profile as having completed the startup wizard.
 */
export function StartupWizardTrigger() {
  const { user, loading: userLoading } = useUser();
  const firestore = useFirestore();
  const { activeWizard, startWizard } = useAppContext();
  const [hasChecked, setHasChecked] = useState(false);
  const startupWizardIdRef = useRef<string | null>(null);

  // Track when the startup wizard was started, to know when it closes
  const wasShowingStartupWizard = useRef(false);

  useEffect(() => {
    // Don't check until auth is loaded and we have a user
    if (userLoading || !user || !firestore || hasChecked) return;

    const checkAndStartWizard = async () => {
      try {
        // 1. Check user profile for hasCompletedStartupWizard
        const userDocRef = doc(firestore, 'users', user.uid);
        const userDoc = await getDoc(userDocRef);

        if (!userDoc.exists()) {
          // User document doesn't exist yet - might be very new user
          // Wait for it to be created
          setHasChecked(true);
          return;
        }

        const userProfile = userDoc.data() as UserProfile;

        if (userProfile.hasCompletedStartupWizard) {
          // User has already seen the startup wizard
          setHasChecked(true);
          return;
        }

        // 2. Find the default startup wizard
        const wizardsQuery = query(
          collection(firestore, 'helpWizards'),
          where('isDefaultStartup', '==', true),
          where('status', '==', 'live'),
          limit(1)
        );

        const wizardsSnapshot = await getDocs(wizardsQuery);

        if (wizardsSnapshot.empty) {
          // No default startup wizard configured
          setHasChecked(true);
          return;
        }

        const startupWizard = wizardsSnapshot.docs[0].data() as HelpWizard;
        startupWizardIdRef.current = startupWizard.id;

        // 3. Start the wizard
        console.debug('[StartupWizardTrigger] Starting default wizard for new user:', startupWizard.id);
        startWizard(startupWizard.id);
        wasShowingStartupWizard.current = true;

      } catch (error) {
        console.error('[StartupWizardTrigger] Error checking/starting startup wizard:', error);
      } finally {
        setHasChecked(true);
      }
    };

    checkAndStartWizard();
  }, [user, userLoading, firestore, hasChecked, startWizard]);

  // When the wizard closes, mark the user as having completed it
  useEffect(() => {
    if (!firestore || !user) return;

    // If we were showing the startup wizard and now it's closed
    if (wasShowingStartupWizard.current && !activeWizard) {
      console.debug('[StartupWizardTrigger] Startup wizard closed, marking user as completed');
      wasShowingStartupWizard.current = false;

      // Mark user as having completed the startup wizard
      const userDocRef = doc(firestore, 'users', user.uid);
      updateDoc(userDocRef, {
        hasCompletedStartupWizard: true,
      }).catch((error) => {
        console.error('[StartupWizardTrigger] Error marking startup wizard as completed:', error);
      });
    }
  }, [activeWizard, firestore, user]);

  // This component doesn't render anything
  return null;
}
