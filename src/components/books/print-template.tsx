'use client';

/**
 * The parent ties a print template to a finished Book (ADR-0011: the parent
 * picks the Layout). Pictures are drawn at the template's picture shape, so a
 * change redraws them all on the server (free; the words stay). The list is
 * the server's: templates this Book fits, cheapest first; only priced ones
 * can be ordered, so only those are offered.
 */
import { useEffect, useState } from 'react';
import { LoaderCircle, Ruler } from 'lucide-react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { api, formatMoney, type PrintOption } from '@/lib/api';
import type { BookStatus } from '@/lib/books/types';

export function PrintTemplate({
  bookId,
  layoutId,
  status,
  requireGuard,
}: {
  bookId: string;
  layoutId: string | null;
  status: BookStatus;
  requireGuard: () => boolean;
}) {
  const { toast } = useToast();
  const [options, setOptions] = useState<PrintOption[] | null>(null);
  const [selected, setSelected] = useState<string>(layoutId ?? '');
  const [confirming, setConfirming] = useState(false);
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
  const finished = status === 'ready' || status === 'partial';
  const locked = status === 'locked';

  const save = async () => {
    if (!choice) return;
    setSaving(true);
    try {
      await api.books.setLayout(bookId, choice.layoutId);
      toast({ title: `Drawing the pictures again for ${choice.name}`, description: 'This takes a few minutes. The words stay the same.' });
    } catch (err) {
      toast({ title: 'Could not change the print template', description: (err as Error).message, variant: 'destructive' });
    } finally {
      setSaving(false);
      setConfirming(false);
    }
  };

  return (
    <div className="w-full space-y-3" data-testid="print-template">
      <div className="flex items-center gap-2 font-medium text-amber-900">
        <Ruler className="h-4 w-4" />
        Print template:{' '}
        <span data-testid="print-template-current">{layoutId ? (current?.name ?? layoutId) : 'not chosen yet'}</span>
      </div>

      {!options ? (
        <LoaderCircle className="h-5 w-5 animate-spin text-amber-500" />
      ) : locked ? (
        <p className="text-sm text-muted-foreground">Unlock the book to change its print template.</p>
      ) : !finished ? (
        <p className="text-sm text-muted-foreground">
          {layoutId ? 'The pictures are being drawn for this template.' : 'You can choose a print template once the pictures are finished.'}
        </p>
      ) : options.length === 0 ? (
        <p className="text-sm text-muted-foreground">No print template fits this book yet.</p>
      ) : (
        <>
          <p className="text-sm text-muted-foreground">
            Pick the size and shape for a printed copy. The pictures are drawn again to fit it, free of charge.
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
                    {o.isCurrent ? ' (current)' : ''}
                  </span>
                  <span className="text-sm text-muted-foreground">
                    {o.trim.widthIn} × {o.trim.heightIn} in · {o.interiorPages} pages{o.leavesPerSpread === 2 ? ' · words and pictures on facing pages' : ''}
                  </span>
                </span>
                <span className="font-semibold text-amber-900">{o.price ? formatMoney(o.price.amountMinor, o.price.currency) : ''}</span>
              </button>
            ))}
          </div>
          <Button
            variant="outline"
            disabled={!choice || choice.layoutId === layoutId || saving}
            onClick={() => requireGuard() && setConfirming(true)}
            data-testid="print-template-use"
          >
            Use this template
          </Button>
        </>
      )}

      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Draw the pictures again?</AlertDialogTitle>
            <AlertDialogDescription>
              Every picture is drawn again to fit {choice?.name ?? 'this template'}. It is free and takes a few minutes; the words stay the same,
              and the new pictures replace the ones you see now.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={saving}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={saving}
              onClick={(e) => {
                e.preventDefault();
                void save();
              }}
            >
              {saving ? 'Starting…' : 'Draw them again'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
