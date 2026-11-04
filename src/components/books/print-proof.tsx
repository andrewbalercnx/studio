'use client';

/**
 * Admin-only print proof (slice 5.5a): pick a compatible template, render the
 * Book's print PDFs (this locks the Book), and open the interior and cover.
 * Parents get ordering in slice 5.5b; this is how the render is checked first.
 */
import { useCallback, useEffect, useState } from 'react';
import { FileText, LoaderCircle, Printer } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { useToast } from '@/hooks/use-toast';
import { ChoiceKeys, getPrintOptions, getRender, listRenders, startRender, type PrintOption, type RenderView } from '@/lib/books/api';

function priceLabel(option: PrintOption): string {
  if (!option.price) return 'no price';
  return new Intl.NumberFormat('en-GB', { style: 'currency', currency: option.price.currency }).format(option.price.amountMinor / 100);
}

export function PrintProof({ bookId, canRender }: { bookId: string; canRender: boolean }) {
  const { toast } = useToast();
  const [options, setOptions] = useState<PrintOption[] | null>(null);
  const [layoutId, setLayoutId] = useState('');
  const [renders, setRenders] = useState<RenderView[]>([]);
  const [pending, setPending] = useState<string | null>(null);
  const [keys] = useState(() => new ChoiceKeys());

  const refresh = useCallback(async () => {
    try {
      const [opts, list] = await Promise.all([getPrintOptions(bookId), listRenders(bookId)]);
      setOptions(opts);
      setRenders(list);
      setLayoutId((current) => current || opts.find((o) => o.isCurrent)?.layoutId || opts[0]?.layoutId || '');
    } catch (err) {
      toast({ title: 'Could not load print templates', description: (err as Error).message, variant: 'destructive' });
      setOptions([]);
    }
  }, [bookId, toast]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Poll a render in progress.
  useEffect(() => {
    if (!pending) return;
    const timer = setInterval(async () => {
      try {
        const view = await getRender(bookId, pending);
        if (view.status === 'rendering') return;
        setPending(null);
        if (view.status === 'failed') toast({ title: 'Render failed', description: view.error ?? undefined, variant: 'destructive' });
        await refresh();
      } catch {
        // Keep polling; a blip should not stop it.
      }
    }, 3000);
    return () => clearInterval(timer);
  }, [bookId, pending, refresh, toast]);

  const render = async () => {
    if (!layoutId) return;
    try {
      const result = await startRender(bookId, layoutId, keys.keyFor(layoutId));
      if (result.status === 'ready') await refresh();
      else setPending(result.renderId);
    } catch (err) {
      toast({ title: 'Could not start the render', description: (err as Error).message, variant: 'destructive' });
    }
  };

  return (
    <Card className="mx-auto max-w-2xl" data-testid="print-proof">
      <CardContent className="space-y-3 p-4">
        <div className="flex items-center gap-2 text-sm font-medium text-amber-900">
          <Printer className="h-4 w-4" />
          Print proof (admin)
        </div>
        {options === null ? (
          <LoaderCircle className="h-5 w-5 animate-spin text-amber-500" />
        ) : options.length === 0 ? (
          <p className="text-sm text-muted-foreground">No print template fits this book.</p>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <select
              className="rounded-md border px-2 py-1 text-sm"
              value={layoutId}
              onChange={(e) => setLayoutId(e.target.value)}
              aria-label="Print template"
            >
              {options.map((o) => (
                <option key={o.layoutId} value={o.layoutId}>
                  {o.name}: {o.interiorPages} pages, {priceLabel(o)}
                </option>
              ))}
            </select>
            <Button size="sm" variant="outline" disabled={!canRender || !!pending} onClick={render}>
              {pending ? <LoaderCircle className="mr-2 h-4 w-4 animate-spin" /> : <Printer className="mr-2 h-4 w-4" />}
              {pending ? 'Rendering…' : 'Render PDFs (locks the book)'}
            </Button>
          </div>
        )}
        {!canRender && <p className="text-xs text-muted-foreground">A book can be printed once every picture is drawn.</p>}
        {renders.length > 0 && (
          <ul className="space-y-1 text-sm">
            {renders.map((r) => (
              <li key={r.renderId} className="flex flex-wrap items-center gap-3">
                <span className="text-muted-foreground">
                  {r.createdAt ? new Date(r.createdAt).toLocaleString() : r.renderId} · {r.layoutId} · {r.interiorPages} pages
                  {r.spineWidthMm !== null ? ` · spine ${r.spineWidthMm} mm` : ''}
                </span>
                {r.files.map((f) =>
                  f.url ? (
                    <a key={f.role} href={f.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-amber-700 underline">
                      <FileText className="h-3 w-3" />
                      {f.role}
                    </a>
                  ) : null
                )}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
