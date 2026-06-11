'use client';

/**
 * Parent-facing order progress timeline (Sprint W3-C).
 *
 * Pure renderer: receives the SERVER-derived `OrderTimeline` (from
 * GET /api/printOrders/my-orders or POST /api/printOrders/mixam) and draws it.
 * No status mapping happens here — see src/lib/order-timeline.ts.
 */
import clsx from 'clsx';
import { AlertTriangle, Check, PackageX, Truck } from 'lucide-react';
import type { OrderTimeline } from '@/lib/order-timeline';

function formatStepDate(iso?: string): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

export function OrderTimelineView({
  timeline,
  className,
}: {
  timeline: OrderTimeline;
  className?: string;
}) {
  if (timeline.state === 'cancelled' || timeline.state === 'failed') {
    return (
      <div
        className={clsx(
          'flex items-center gap-2 rounded-md border border-muted bg-muted/40 p-3 text-sm text-muted-foreground',
          className
        )}
      >
        <PackageX className="h-4 w-4 shrink-0" />
        <span>
          {timeline.state === 'cancelled'
            ? 'This order was cancelled.'
            : "This order couldn't be completed."}
        </span>
      </div>
    );
  }

  return (
    <div className={className}>
      <ol className="flex items-start" aria-label="Order progress">
        {timeline.steps.map((step, idx) => {
          const isLast = idx === timeline.steps.length - 1;
          const isCurrent = step.state === 'current';
          const isComplete = step.state === 'complete';
          const showAttention = isCurrent && timeline.attention;
          const stepDate = formatStepDate(step.at);
          return (
            <li
              key={step.id}
              className={clsx('flex-1', !isLast && 'min-w-0')}
              aria-current={isCurrent ? 'step' : undefined}
            >
              <div className="flex items-center">
                <div
                  className={clsx(
                    'flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 text-[10px]',
                    isComplete && 'border-emerald-500 bg-emerald-500 text-white',
                    isCurrent && !showAttention && 'border-primary bg-primary/10 text-primary',
                    showAttention && 'border-amber-500 bg-amber-100 text-amber-700',
                    step.state === 'upcoming' && 'border-muted-foreground/30 bg-background text-muted-foreground/50'
                  )}
                >
                  {isComplete ? (
                    step.id === 'shipped' ? <Truck className="h-3.5 w-3.5" /> : <Check className="h-3.5 w-3.5" />
                  ) : showAttention ? (
                    <AlertTriangle className="h-3 w-3" />
                  ) : (
                    <span className="h-1.5 w-1.5 rounded-full bg-current" />
                  )}
                </div>
                {!isLast && (
                  <div
                    className={clsx(
                      'mx-1 h-0.5 flex-1 rounded',
                      isComplete ? 'bg-emerald-500' : 'bg-muted-foreground/20'
                    )}
                  />
                )}
              </div>
              <div className="mt-1 pr-1">
                <p
                  className={clsx(
                    'text-[11px] leading-tight',
                    isCurrent ? 'font-semibold text-foreground' : isComplete ? 'text-foreground' : 'text-muted-foreground'
                  )}
                >
                  {step.label}
                </p>
                {stepDate && <p className="text-[10px] text-muted-foreground">{stepDate}</p>}
              </div>
            </li>
          );
        })}
      </ol>

      {timeline.state === 'shipped' && (
        <p className="mt-2 text-xs font-medium text-emerald-700">Your book is on its way.</p>
      )}
      {timeline.state === 'delivered' && (
        <p className="mt-2 text-xs font-medium text-emerald-700">Delivered — enjoy!</p>
      )}
      {timeline.attention && timeline.attentionNote && (
        <p className="mt-2 flex items-start gap-1.5 text-xs text-amber-700">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          {timeline.attentionNote}
        </p>
      )}
    </div>
  );
}
