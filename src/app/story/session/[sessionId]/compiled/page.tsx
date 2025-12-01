
'use client';

import { useMemo, useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import { useFirestore } from '@/firebase';
import { collection, doc, orderBy, query } from 'firebase/firestore';
import { useCollection, useDocument } from '@/lib/firestore-hooks';
import type { StoryBook, StorySession, StoryBookPage, ChildProfile } from '@/lib/types';
import { LoaderCircle, BookOpen, RefreshCw, Image as ImageIcon } from 'lucide-react';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import Link from 'next/link';
import { resolvePlaceholders, resolveEntitiesInText, replacePlaceholdersInText } from '@/lib/resolve-placeholders';

export default function CompiledStoryBookPage() {
  const params = useParams<{ sessionId: string }>();
  const sessionId = params.sessionId;
  const firestore = useFirestore();

  const bookRef = useMemo(() => (firestore ? doc(firestore, 'storyBooks', sessionId) : null), [firestore, sessionId]);
  const sessionRef = useMemo(() => (firestore ? doc(firestore, 'storySessions', sessionId) : null), [firestore, sessionId]);

  const { data: storyBook, loading: storyBookLoading, error: storyBookError } = useDocument<StoryBook>(bookRef);
  const { data: session } = useDocument<StorySession>(sessionRef);
  const bookId = storyBook?.id ?? sessionId;
  const pagesQuery = useMemo(
    () => (firestore && bookId ? query(collection(firestore, 'storyBooks', bookId, 'pages'), orderBy('pageNumber', 'asc')) : null),
    [firestore, bookId]
  );
  const { data: pages, loading: pagesLoading, error: pagesError } = useCollection<StoryBookPage>(pagesQuery);

  const [resolvedStoryText, setResolvedStoryText] = useState<string | null>(null);

  useEffect(() => {
    async function processStoryText() {
      if (!storyBook?.storyText) {
        setResolvedStoryText(null);
        return;
      }
      if (storyBook.storyText.indexOf('$$') === -1) {
        setResolvedStoryText(storyBook.storyText);
        return;
      }
      try {
        const entityMap = await resolveEntitiesInText(storyBook.storyText);
        setResolvedStoryText(replacePlaceholdersInText(storyBook.storyText, entityMap));
      } catch (e) {
        console.error("Failed to resolve placeholders in story text", e);
        setResolvedStoryText(storyBook.storyText);
      }
    }
    processStoryText();
  }, [storyBook?.storyText]);


  const [isGeneratingPages, setIsGeneratingPages] = useState(false);
  const [pageGenerationError, setPageGenerationError] = useState<string | null>(null);
  const [isGeneratingImages, setIsGeneratingImages] = useState(false);
  const [imageGenerationError, setImageGenerationError] = useState<string | null>(null);
  const [imageLogs, setImageLogs] = useState<string[]>([]);

  const pageStatus = storyBook?.pageGeneration?.status ?? 'idle';
  const lastCompletedAt = (storyBook?.pageGeneration?.lastCompletedAt as any)?.toDate?.();
  const lastRunAt = (storyBook?.pageGeneration?.lastRunAt as any)?.toDate?.();
  const pageButtonLabel = pages && pages.length > 0 ? 'Regenerate Pages' : 'Generate Pages';
  const imageStatus = storyBook?.imageGeneration?.status ?? 'idle';
  const artReady = pages?.filter((page) => page.imageStatus === 'ready').length ?? storyBook?.imageGeneration?.pagesReady ?? 0;
  const artTotal =
    pages?.length ??
    storyBook?.imageGeneration?.pagesTotal ??
    storyBook?.pageGeneration?.pagesCount ??
    0;

  const handleGeneratePages = async () => {
    if (!bookId) {
      setPageGenerationError('No storyBook id available for this session.');
      return;
    }
    setIsGeneratingPages(true);
    setPageGenerationError(null);
    try {
      const response = await fetch('/api/storyBook/pages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bookId }),
      });
      const body = await response.json();
      if (!response.ok || !body.ok) {
        throw new Error(body?.errorMessage || 'Failed to generate pages.');
      }
    } catch (err: any) {
      setPageGenerationError(err?.message || 'Unexpected error while generating pages.');
    } finally {
      setIsGeneratingPages(false);
    }
  };

  const runImageJob = async (payload?: {forceRegenerate?: boolean; pageId?: string}) => {
    if (!bookId) {
      setImageGenerationError('No storyBook id available for this session.');
      return;
    }
    setIsGeneratingImages(true);
    setImageGenerationError(null);
    setImageLogs([]);
    try {
      const response = await fetch('/api/storyBook/images', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          bookId,
          ...(payload ?? {}),
        }),
      });
      const body = await response.json();
      if (!response.ok || !body?.ok) {
        throw new Error(body?.errorMessage || 'Failed to generate images.');
      }
      setImageLogs(body.logs ?? []);
    } catch (error: any) {
      setImageGenerationError(error?.message || 'Unexpected error while generating images.');
    } finally {
      setIsGeneratingImages(false);
    }
  };

  return (
    <div className="container mx-auto px-4 py-8">
      <Card className="max-w-3xl mx-auto">
        <CardHeader className="space-y-2">
          <CardTitle>{session?.storyTitle || 'Compiled Story'}</CardTitle>
          <CardDescription>
            Session ID: <span className="font-mono">{sessionId}</span>
          </CardDescription>
          {storyBook?.status && (
            <Badge variant="outline" className="w-fit uppercase tracking-wide text-xs">
              {storyBook.status.replace('_', ' ')}
            </Badge>
          )}
        </CardHeader>
        <CardContent className="space-y-4">
          {(storyBookLoading || pagesLoading) && (
            <div className="flex items-center justify-center py-10">
              <LoaderCircle className="h-8 w-8 animate-spin text-primary" />
            </div>
          )}

          {storyBookError && (
            <p className="text-destructive text-center">
              Error loading compiled story: {storyBookError.message}
            </p>
          )}

          {!storyBookLoading && !storyBook && !storyBookError && (
            <div className="flex flex-col items-center gap-3 py-10 text-center text-muted-foreground">
              <BookOpen className="h-10 w-10" />
              <p>No compiled storybook found yet.</p>
              <p className="text-sm">Run the compile action from the session view to create one.</p>
            </div>
          )}

          {storyBook && (
            <div className="space-y-6">
              <div className="text-sm text-muted-foreground space-y-1">
                {storyBook.metadata?.paragraphs && (
                  <p>Paragraphs: {storyBook.metadata.paragraphs}</p>
                )}
                {storyBook.metadata?.estimatedPages && (
                  <p>Estimated pages: {storyBook.metadata.estimatedPages}</p>
                )}
                {storyBook.updatedAt?.toDate && (
                  <p>Updated {storyBook.updatedAt.toDate().toLocaleString()}</p>
                )}
              </div>
              <div className="space-y-4 leading-relaxed text-lg">
                {resolvedStoryText ? (
                  resolvedStoryText.split('\n').map((paragraph, index) => (
                    <p key={index}>{paragraph}</p>
                  ))
                ) : (
                  <p className="text-sm text-muted-foreground italic">
                    Loading story text...
                  </p>
                )}
              </div>
              <div className="space-y-4 border-t pt-6">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <h3 className="text-xl font-semibold">Storybook Pages</h3>
                    <p className="text-sm text-muted-foreground">
                      {pages && pages.length > 0
                        ? `Latest generation contains ${pages.length} pages.`
                        : 'Turn the compiled story into previewable pages.'}
                    </p>
                    <div className="mt-2 text-xs text-muted-foreground space-y-1">
                      <p>Status: <span className="font-semibold uppercase">{pageStatus}</span></p>
                      {lastRunAt && <p>Last started: {lastRunAt.toLocaleString()}</p>}
                      {lastCompletedAt && <p>Last finished: {lastCompletedAt.toLocaleString()}</p>}
                      {storyBook.pageGeneration?.pagesCount && (
                        <p>Saved pages: {storyBook.pageGeneration.pagesCount}</p>
                      )}
                    </div>
                  </div>
                  <Button
                    onClick={handleGeneratePages}
                    disabled={isGeneratingPages || !storyBook}
                    variant="outline"
                    className="min-w-[220px]"
                  >
                    {isGeneratingPages && <RefreshCw className="mr-2 h-4 w-4 animate-spin" />}
                    {pageButtonLabel}
                  </Button>
                </div>
                {(pageGenerationError || pagesError) && (
                  <p className="text-sm text-destructive">
                    {pageGenerationError || pagesError?.message}
                  </p>
                )}
                <div className="rounded-md border border-dashed bg-muted/30 p-4 space-y-2">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <h4 className="font-semibold">Storybook Art</h4>
                      <p className="text-sm text-muted-foreground">
                        Status: <span className="font-semibold uppercase">{imageStatus}</span>
                      </p>
                      <p className="text-sm text-muted-foreground">
                        Illustrated pages: {artReady}/{artTotal}
                      </p>
                    </div>
                    <div className="flex w-full min-w-[220px] flex-col gap-2 sm:w-auto">
                      <Button
                        onClick={() => runImageJob()}
                        disabled={isGeneratingImages || imageStatus === 'running'}
                      >
                        {isGeneratingImages ? (
                          <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
                        ) : (
                          <ImageIcon className="mr-2 h-4 w-4" />
                        )}
                        {imageStatus === 'ready' ? 'Refresh Art' : 'Generate Storybook Art'}
                      </Button>
                      <div className="flex gap-2">
                        <Button
                          variant="outline"
                          className="flex-1"
                          onClick={() => runImageJob({ forceRegenerate: true })}
                          disabled={isGeneratingImages || imageStatus === 'running'}
                        >
                          Force Regenerate
                        </Button>
                        <Button variant="ghost" className="flex-1" asChild>
                          <Link href={`/storybook/${bookId}`}>Open Viewer</Link>
                        </Button>
                      </div>
                    </div>
                  </div>
                  {imageGenerationError && (
                    <p className="text-sm text-destructive">{imageGenerationError}</p>
                  )}
                </div>
                {pagesLoading && (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <LoaderCircle className="h-4 w-4 animate-spin" />
                    Loading page previews…
                  </div>
                )}
                {!pagesLoading && pages && pages.length === 0 && (
                  <p className="text-sm text-muted-foreground">No pages generated yet.</p>
                )}
                {pages && pages.length > 0 && (
                  <div className="grid gap-4">
                    {pages.map((page) => (
                      <Card key={page.id ?? page.pageNumber}>
                        <CardHeader className="py-4">
                          <div className="flex items-center justify-between">
                            <CardTitle className="text-base">
                              Page {page.pageNumber}: {page.kind.replace(/_/g, ' ')}
                            </CardTitle>
                            {page.layoutHints?.aspectRatio && (
                              <Badge variant="outline">{page.layoutHints.aspectRatio}</Badge>
                            )}
                            {page.imageStatus && (
                              <Badge
                                variant={page.imageStatus === 'ready' ? 'secondary' : 'destructive'}
                                className="ml-2 uppercase"
                              >
                                {page.imageStatus}
                              </Badge>
                            )}
                          </div>
                          {page.title && (
                            <CardDescription className="text-sm">{page.title}</CardDescription>
                          )}
                        </CardHeader>
                        <CardContent className="space-y-3">
                          {page.imageUrl && (
                            <div className="overflow-hidden rounded-md border bg-muted/20">
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img
                                src={page.imageUrl}
                                alt={page.imagePrompt || `Page ${page.pageNumber} artwork`}
                                className="h-48 w-full object-cover"
                              />
                            </div>
                          )}
                          {page.bodyText && (
                            <p className="text-sm leading-relaxed">{page.displayText}</p>
                          )}
                          {page.imagePrompt && (
                            <p className="text-xs text-muted-foreground">
                              Prompt: {page.imagePrompt}
                            </p>
                          )}
                          <div className="flex flex-wrap gap-2">
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => runImageJob({ pageId: page.id, forceRegenerate: true })}
                              disabled={isGeneratingImages || imageStatus === 'running'}
                            >
                              <RefreshCw className="mr-2 h-4 w-4" />
                              Regenerate art
                            </Button>
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                )}
                {imageLogs.length > 0 && (
                  <div className="rounded-md bg-muted/20 p-4">
                    <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Last art job logs</p>
                    <ul className="mt-2 space-y-1 text-xs font-mono">
                      {imageLogs.map((line, idx) => (
                        <li key={`${line}-${idx}`}>{line}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            </div>
          )}
        </CardContent>
        <CardFooter className="flex flex-wrap gap-3">
          <Button asChild variant="outline">
            <Link href={`/story/session/${sessionId}`}>Back to Session</Link>
          </Button>
          <Button asChild>
            <Link href="/stories">Return to Stories</Link>
          </Button>
        </CardFooter>
      </Card>
    </div>
  );
}
