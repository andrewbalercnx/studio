'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useUser } from '@/firebase/auth/use-user';
import { useAppContext } from '@/hooks/use-app-context';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { CheckCircle2, Circle, X, ArrowRight, BookHeart } from 'lucide-react';
import { track, ANALYTICS_EVENTS } from '@/lib/analytics';
import { cn } from '@/lib/utils';
import type { OnboardingResponse } from '@/app/api/user/onboarding/route';

/**
 * First-run "create your first book" checklist (Sprint W2-B).
 *
 * Non-modal and dismissible by design: it guides without ever blocking the
 * funnel. Step completion is derived SERVER-SIDE by GET /api/user/onboarding
 * from real account state; this component only renders the result.
 *
 * Renders nothing for returning users (all steps complete), after dismissal,
 * for non-parent roles, and while loading — so established accounts see zero
 * change.
 */
export function OnboardingChecklist({ className }: { className?: string }) {
  const { user, idTokenResult, loading: userLoading } = useUser();
  const { roleMode } = useAppContext();
  const pathname = usePathname();
  const [data, setData] = useState<OnboardingResponse | null>(null);
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    if (userLoading || !user || !idTokenResult) return;
    let cancelled = false;

    const load = async () => {
      try {
        const idToken = await user.getIdToken();
        const response = await fetch('/api/user/onboarding', {
          headers: { Authorization: `Bearer ${idToken}` },
        });
        if (!response.ok) return;
        const result: OnboardingResponse = await response.json();
        if (cancelled) return;
        setData(result);

        // Funnel instrumentation: one event per step transition, plus the
        // signup→first-book duration the moment the first book is observed.
        for (const stepId of result.newlyCompletedStepIds ?? []) {
          track(ANALYTICS_EVENTS.onboardingStepCompleted, { stepId });
        }
        if (result.firstBookJustReady) {
          track(ANALYTICS_EVENTS.onboardingFirstBookReady, {
            durationMs: result.timeToFirstBookMs ?? undefined,
          });
        }
      } catch (error) {
        // Checklist is a guide, never a blocker — fail silent.
        console.debug('[OnboardingChecklist] Failed to load onboarding state:', error);
      }
    };

    load();
    return () => {
      cancelled = true;
    };
  }, [user, userLoading, idTokenResult]);

  const handleDismiss = useCallback(async () => {
    setHidden(true); // Optimistic — never make the parent wait to clear UI.
    track(ANALYTICS_EVENTS.onboardingChecklistDismissed, {});
    try {
      if (!user) return;
      const idToken = await user.getIdToken();
      await fetch('/api/user/onboarding', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
        body: JSON.stringify({ action: 'dismiss' }),
      });
    } catch (error) {
      console.debug('[OnboardingChecklist] Failed to persist dismissal:', error);
    }
  }, [user]);

  // Admins/writers manage content, not first books; kids mode has its own UI.
  if (roleMode !== 'parent') return null;
  if (hidden || !data || data.dismissed || data.complete) return null;

  const steps = data.steps ?? [];
  const completedCount = steps.filter((s) => s.complete).length;
  const nextStep = steps.find((s) => !s.complete);

  return (
    <Card className={cn('border-primary/30', className)} data-wiz-target="onboarding-checklist">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2">
            <BookHeart className="h-5 w-5 text-primary" />
            <CardTitle className="text-lg">Make your first book</CardTitle>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 -mr-1 -mt-1 text-muted-foreground"
            onClick={handleDismiss}
            aria-label="Dismiss checklist"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
        <CardDescription>
          {completedCount} of {steps.length} steps done — five small steps from blank page to a
          picture book starring your child.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ol className="space-y-2">
          {steps.map((step) => {
            const isNext = step.id === nextStep?.id;
            return (
              <li key={step.id} className="flex items-start gap-3">
                {step.complete ? (
                  <CheckCircle2 className="h-5 w-5 mt-0.5 shrink-0 text-green-600" aria-hidden />
                ) : (
                  <Circle
                    className={cn(
                      'h-5 w-5 mt-0.5 shrink-0',
                      isNext ? 'text-primary' : 'text-muted-foreground/50'
                    )}
                    aria-hidden
                  />
                )}
                <div className="flex-1 min-w-0">
                  <p
                    className={cn(
                      'text-sm font-medium leading-5',
                      step.complete && 'text-muted-foreground line-through',
                      isNext && 'text-foreground'
                    )}
                  >
                    {step.title}
                  </p>
                  {isNext && (
                    <div className="mt-1 space-y-2">
                      <p className="text-sm text-muted-foreground">{step.description}</p>
                      {/* No button when the CTA targets the page we're on. */}
                      {pathname !== step.href && (
                        <Button asChild size="sm" data-wiz-target="onboarding-next-step">
                          <Link href={step.href}>
                            Do this step
                            <ArrowRight className="ml-2 h-4 w-4" />
                          </Link>
                        </Button>
                      )}
                    </div>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      </CardContent>
    </Card>
  );
}
