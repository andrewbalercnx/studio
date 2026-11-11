'use client';

/**
 * Parent only: the print copies of a Book's pictures for its template, at the
 * shape they will be printed (`books/{id}/pages/{n}.printArt`, written by
 * `book.printArt`). Pages still being prepared show a placeholder; a picture
 * the image model extended to fit is marked so the parent can check it.
 */
import { AlertCircle, LoaderCircle } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ART_PAGE_KINDS, type BookPageDoc, type BookPrintState } from '@/lib/books/types';
import { cssAspectRatio } from '@/lib/books/format';

function labelOf(page: BookPageDoc): string {
  if (page.kind === 'cover') return 'Front cover';
  if (page.kind === 'back') return 'Back cover';
  return page.manuscriptPage ? `Page ${page.manuscriptPage}` : `Page ${page.pageNumber}`;
}

export function PrintPreview({ pages, print }: { pages: BookPageDoc[]; print: BookPrintState }) {
  const artPages = pages.filter((p) => ART_PAGE_KINDS.has(p.kind) || p.kind === 'back').sort((a, b) => a.pageNumber - b.pageNumber);
  const extended = artPages.filter((p) => p.printArt?.run === print.run && p.printArt.method === 'extend').length;

  return (
    <Card className="mx-auto max-w-2xl" data-testid="print-preview">
      <CardHeader>
        <CardTitle className="text-amber-900">Print preview</CardTitle>
        <CardDescription>
          The pictures as they will be printed. The words are added on each printed page.
          {extended > 0 ? ` ${extended} ${extended === 1 ? 'picture was' : 'pictures were'} extended to fit the page: check they look right.` : ''}
        </CardDescription>
      </CardHeader>
      <CardContent className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {artPages.map((page) => {
          const copy = page.printArt?.run === print.run ? page.printArt : null;
          const failed = copy?.job?.status === 'failed' || copy?.job?.status === 'cancelled' || (!copy && print.status !== 'preparing');
          return (
            <figure key={page.pageNumber} className="space-y-1" data-testid={`print-preview-${page.pageNumber}`}>
              <div
                className="flex w-full items-center justify-center overflow-hidden rounded-md border bg-amber-50"
                style={{ aspectRatio: copy?.aspect ? String(copy.aspect) : cssAspectRatio() }}
              >
                {copy?.url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={copy.url} alt={`${labelOf(page)} for print`} className="h-full w-full object-cover" />
                ) : failed ? (
                  <AlertCircle className="h-6 w-6 text-red-500" aria-label="Could not be prepared" />
                ) : (
                  <LoaderCircle className="h-6 w-6 animate-spin text-amber-500" aria-label="Being prepared" />
                )}
              </div>
              <figcaption className="text-center text-xs text-muted-foreground">
                {labelOf(page)}
                {copy?.method === 'extend' ? ' · extended' : ''}
              </figcaption>
            </figure>
          );
        })}
      </CardContent>
    </Card>
  );
}
