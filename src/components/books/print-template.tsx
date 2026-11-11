'use client';

/**
 * The parent ties a print template to a finished Book (ADR-0011: the parent
 * picks the Layout). The Book's pictures never change: the server makes a
 * print copy of each at the template's picture shape (cropped, or extended by
 * the image model when the shapes are far apart), free of charge. The list is
 * the server's: templates this Book fits, cheapest first; only priced ones
 * can be ordered, so only those are offered.
 */
import { useEffect, useState } from 'react';
import { LoaderCircle, Ruler } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { api, formatMoney, type PrintOption } from '@/lib/api';
import type { BookPrintState, BookStatus } from '@/lib/books/types';

export function PrintTemplate({
  bookId,
  layoutId,
  status,
  print,
  requireGuard,
}: {
  bookId: string;
  layoutId: string | null;
  status: BookStatus;
  print: BookPrintState | null;
  requireGuard: () => boolean;
}) {
  const { toast } = useToast();
  const [options, setOptions] = useState<PrintOption[] | null>(null);
  const [selected, setSelected] = useState<string>(layoutId ?? '');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api.books
      .printOptions(bookId)
      .then((opts) => !cancelled && setOptions(opts.filter((o) => o.price)))
      .catch(() => !cancelled && setOptions([]));
    return () => {
      cancelled = true;
    };
  }, [bookId, layoutId]);

  useEffect(() => setSelected(layoutId ?? ''), [layoutId]);

  const current = options?.find((o) => o.layoutId === layoutId) ?? null;
  const choice = options?.find((o) => o.layoutId === selected) ?? null;
  const mine = print && print.layoutId === layoutId ? print : null;
  const preparing = mine?.status === 'preparing';
  const needsRetry = !!layoutId && (!mine || mine.status === 'failed' || mine.status === 'partial');
  const locked = status === 'locked';

  const use = async () => {
    if (!choice || !requireGuard()) return;
    setSaving(true);
    try {
      await api.books.setLayout(bookId, choice.layoutId);
      toast({ title: `Preparing the pictures for ${choice.name}`, description: 'Your book stays exactly as it is.' });
    } catch (err) {
      toast({ title: 'Could not use that print template', description: (err as Error).message, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  let state: string | null = null;
  if (mine?.status === 'preparing') state = `Preparing the pictures for print: ${mine.done} of ${mine.total}.`;
  else if (mine?.status === 'ready') state = 'The pictures for print are ready. Check them in the preview below.';
  else if (mine) state = `${mine.failed} of ${mine.total} pictures could not be prepared for print.`;

  return (
    <div className="w-full space-y-3" data-testid="print-template">
      <div className="flex items-center gap-2 font-medium text-amber-900">
        <Ruler className="h-4 w-4" />
        Print template:{' '}
        <span data-testid="print-template-current">{layoutId ? (current?.name ?? layoutId) : 'not chosen yet'}</span>
      </div>
      {state && <p className="text-sm text-amber-900" data-testid="print-template-state">{state}</p>}

      {!options ? (
        <LoaderCircle className="h-5 w-5 animate-spin text-amber-500" />
      ) : locked ? (
        <p className="text-sm text-muted-foreground">Unlock the book to change its print template.</p>
      ) : status === 'partial' ? (
        <p className="text-sm text-muted-foreground">Draw the missing pictures again before choosing a print template.</p>
      ) : status !== 'ready' ? (
        <p className="text-sm text-muted-foreground">You can choose a print template once the pictures are finished.</p>
      ) : options.length === 0 ? (
        <p className="text-sm text-muted-foreground">No print template fits this book yet.</p>
      ) : (
        <>
          <p className="text-sm text-muted-foreground">
            Pick the size and shape for a printed copy. Your book stays exactly as it is: each picture gets a copy shaped
            for the printed page, free of charge.
          </p>
          <div className="space-y-2" role="radiogroup" aria-label="Print template">
            {options.map((o) => (
              <button
                key={o.layoutId}
                type="button"
                role="radio"
                aria-checked={o.layoutId === selected}
                onClick={() => setSelected(o.layoutId)}
                className={`flex w-full items-center justify-between rounded-md border p-3 text-left ${o.layoutId === selected ? 'border-amber-500 bg-amber-50' : 'border-border'}`}
              >
                <span>
                  <span className="block font-medium text-amber-900">
                    {o.name}
                    {o.isCurrent ? ' (chosen)' : ''}
                  </span>
                  <span className="text-sm text-muted-foreground">
                    {o.trim.widthIn} × {o.trim.heightIn} in · {o.interiorPages} pages{o.leavesPerSpread === 2 ? ' · words and pictures on facing pages' : ''}
                  </span>
                </span>
                <span className="font-semibold text-amber-900">{o.price ? formatMoney(o.price.amountMinor, o.price.currency) : ''}</span>
              </button>
            ))}
          </div>
          {choice && choice.layoutId === layoutId && needsRetry ? (
            <Button variant="outline" disabled={saving} onClick={use} data-testid="print-template-retry">
              Prepare the pictures for print again
            </Button>
          ) : (
            <Button
              variant="outline"
              disabled={!choice || choice.layoutId === layoutId || saving || preparing}
              onClick={use}
              data-testid="print-template-use"
            >
              Use this template
            </Button>
          )}
        </>
      )}
    </div>
  );
}
