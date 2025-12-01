
'use client';

import {useMemo, useState, useEffect} from 'react';
import {useParams} from 'next/navigation';
import Link from 'next/link';
import clsx from 'clsx';
import {useFirestore} from '@/firebase';
import {doc, collection, query, orderBy} from 'firebase/firestore';
import {useDocument, useCollection} from '@/lib/firestore-hooks';
import type {Story, StoryOutputPage} from '@/lib/types';
import {Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter} from '@/components/ui/card';
import {Badge} from '@/components/ui/badge';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {Switch} from '@/components/ui/switch';
import {
  LoaderCircle,
  ChevronLeft,
  ChevronRight,
  RefreshCw,
  AlertTriangle,
  Image as ImageIcon,
  Lock,
  Unlock,
  Share2,
  Printer,
  Link as LinkIcon,
  PackageCheck,
} from 'lucide-react';
import {useUser} from '@/firebase/auth/use-user';
import {useParentGuard} from '@/hooks/use-parent-guard';
import {useToast} from '@/hooks/use-toast';
import {PrintOrderDialog} from '@/components/storybook/print-order-dialog';
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert';

type StatusBadge = {label: string; variant: 'default' | 'secondary' | 'outline'};

function toDate(value?: any): Date | null {
  if (!value) return null;
  if (value.toDate) return value.toDate();
  if (value instanceof Date) return value;
  return null;
}

function formatTimestamp(value?: any): string | null {
  const date = toDate(value);
  if (!date) return null;
  return date.toLocaleString();
}

function deriveFinalizationBadge(book?: Story | null, readyPages = 0, totalPages = 0): StatusBadge {
  const status = book?.storybookFinalization?.status;
  if (status === 'ordered') return {label: 'Ordered', variant: 'default'};
  if (status === 'printable_ready') return {label: 'Printable Ready', variant: 'secondary'};
  if (status === 'finalized' || book?.isLocked) return {label: 'Finalized', variant: 'default'};
  if (readyPages > 0 && totalPages > 0 && readyPages === totalPages && book?.imageGeneration?.status === 'ready') {
    return {label: 'Ready to Finalize', variant: 'outline'};
  }
  return {label: 'Draft', variant: 'outline'};
}

function formatShareUrl(path?: string | null): string | null {
  if (!path) return null;
  if (typeof window === 'undefined') return path;
  try {
    return new URL(path, window.location.origin).toString();
  } catch {
    return path;
  }
}

export default function StorybookViewerPage() {
  const params = useParams<{bookId: string}>();
  const bookId = params.bookId;
  const firestore = useFirestore();
  const {user} = useUser();
  const {toast} = useToast();
  const {isParentGuardValidated, showPinModal} = useParentGuard();

  const bookRef = useMemo(() => (firestore && bookId ? doc(firestore, 'stories', bookId) : null), [firestore, bookId]);
  const pagesQuery = useMemo(
    () =>
      firestore && bookId
        ? query(collection(firestore, 'stories', bookId, 'outputs', 'storybook', 'pages'), orderBy('pageNumber', 'asc'))
        : null,
    [firestore, bookId]
  );

  const {data: storyBook, loading: bookLoading} = useDocument<Story>(bookRef);
  const {data: pages, loading: pagesLoading} = useCollection<StoryOutputPage>(pagesQuery);

  const [activeIndex, setActiveIndex] = useState(0);
  const [isGenerating, setIsGenerating] = useState(false);
  const [jobLogs, setJobLogs] = useState<string[]>([]);
  const [jobError, setJobError] = useState<string | null>(null);
  const [finalizing, setFinalizing] = useState(false);
  const [unlocking, setUnlocking] = useState(false);
  const [printableLoading, setPrintableLoading] = useState(false);
  const [shareLoading, setShareLoading] = useState(false);
  const [shareSecret, setShareSecret] = useState<string | null>(null);
  const [shareProtectWithCode, setShareProtectWithCode] = useState(true);
  const [customSharePasscode, setCustomSharePasscode] = useState('');
  const [absoluteShareUrl, setAbsoluteShareUrl] = useState<string | null>(null);
  const [orderDialogOpen, setOrderDialogOpen] = useState(false);

  const finalization = storyBook?.storybookFinalization ?? null;

  useEffect(() => {
    if (pages && pages.length > 0 && activeIndex >= pages.length) {
      setActiveIndex(pages.length - 1);
    }
  }, [pages, activeIndex]);

  useEffect(() => {
    setShareSecret(null);
    setAbsoluteShareUrl(formatShareUrl(finalization?.shareLink ?? null));
  }, [finalization?.shareLink]);

  const readyCount = pages?.filter((page) => page.imageStatus === 'ready').length ?? 0;
  const totalPages = pages?.length ?? 0;
  const imageStatus = storyBook?.imageGeneration?.status ?? 'idle';
  const disableGenerate = isGenerating || imageStatus === 'running' || !!storyBook?.isLocked;
  const currentPage = pages && pages.length > 0 ? pages[Math.max(0, Math.min(activeIndex, pages.length - 1))] : null;
  const isLocked = storyBook?.isLocked ?? false;
  const allImagesReady = imageStatus === 'ready' && readyCount === totalPages && totalPages > 0;
  const finalizationBadge = deriveFinalizationBadge(storyBook, readyCount, totalPages);
  const printableReady = finalization?.printableStatus === 'ready' && !!finalization?.printablePdfUrl;
  const shareExpiresAt = formatTimestamp(finalization?.shareExpiresAt);

  const requireGuard = () => {
    if (isParentGuardValidated) return true;
    showPinModal();
    return false;
  };

  const authorizedFetch = async (url: string, body: Record<string, any>) => {
    if (!user) {
      toast({title: 'Sign in required', description: 'Please sign in again.', variant: 'destructive'});
      return null;
    }
    const token = await user.getIdToken();
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
    });
    const data = await response.json();
    if (!response.ok || data?.ok === false) {
      throw new Error(data?.errorMessage || 'Request failed.');
    }
    return data;
  };

  const triggerImageJob = async (payload: {pageId?: string; forceRegenerate?: boolean} = {}) => {
    if (!bookId) return;
    setIsGenerating(true);
    setJobError(null);
    try {
      const response = await fetch('/api/storyBook/images', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({
          storyId: bookId,
          ...payload,
        }),
      });
      const result = await response.json();
      if (!response.ok || !result?.ok) {
        throw new Error(result?.errorMessage || 'Failed to generate storybook art.');
      }
      setJobLogs(result.logs ?? []);
    } catch (error: any) {
      setJobError(error?.message || 'Unexpected error while generating art.');
    } finally {
      setIsGenerating(false);
    }
  };

  const handleGenerateAll = (forceRegenerate = false) => triggerImageJob({forceRegenerate});
  const handleRegeneratePage = (pageId: string | undefined) => {
    if (!pageId) return;
    triggerImageJob({pageId, forceRegenerate: true});
  };

  const handleFinalize = async () => {
    if (!bookId || !requireGuard()) return;
    setFinalizing(true);
    try {
      await authorizedFetch('/api/storyBook/finalize', {storyId: bookId, outputId: 'storybook', action: 'finalize'});
      toast({title: 'Book finalized', description: 'Storypages locked for printing.'});
    } catch (error: any) {
      toast({title: 'Finalize failed', description: error?.message ?? 'Unable to finalize book.', variant: 'destructive'});
    } finally {
      setFinalizing(false);
    }
  };

  const handleUnlock = async () => {
    if (!bookId || !requireGuard()) return;
    setUnlocking(true);
    try {
      await authorizedFetch('/api/storyBook/finalize', {storyId: bookId, outputId: 'storybook', action: 'unlock'});
      toast({title: 'Book unlocked', description: 'You can make edits again.'});
    } catch (error: any) {
      toast({title: 'Unlock failed', description: error?.message ?? 'Unable to unlock book.', variant: 'destructive'});
    } finally {
      setUnlocking(false);
    }
  };

  const handleGeneratePrintable = async () => {
    if (!bookId || !requireGuard()) return;
    setPrintableLoading(true);
    try {
      const result = await authorizedFetch('/api/storyBook/printable', {storyId: bookId, outputId: 'storybook', printLayoutId: 'a4-portrait-spread-v1'});
      if (!result) return;
      toast({title: 'Printable ready', description: 'PDF regenerated successfully.'});
    } catch (error: any) {
      toast({title: 'Printable failed', description: error?.message ?? 'Unable to render PDF.', variant: 'destructive'});
    } finally {
      setPrintableLoading(false);
    }
  };

  const handleShareGenerate = async () => {
    if (!bookId || !requireGuard()) return;
    setShareLoading(true);
    try {
      const result = await authorizedFetch('/api/storyBook/share', {
        bookId,
        action: 'create',
        protectWithCode: shareProtectWithCode,
        passcode: shareProtectWithCode && customSharePasscode ? customSharePasscode : undefined,
      });
      if (!result) return;
      setShareSecret(result.passcode ?? null);
      toast({title: 'Share link ready', description: 'Copy the link below to share.'});
    } catch (error: any) {
      toast({title: 'Share link failed', description: error?.message ?? 'Unable to create share link.', variant: 'destructive'});
    } finally {
      setShareLoading(false);
    }
  };

  const handleShareRevoke = async () => {
    if (!bookId || !requireGuard()) return;
    setShareLoading(true);
    try {
      await authorizedFetch('/api/storyBook/share', {bookId, action: 'revoke'});
      setShareSecret(null);
      toast({title: 'Share link revoked'});
    } catch (error: any) {
      toast({title: 'Revoke failed', description: error?.message ?? 'Unable to revoke share link.', variant: 'destructive'});
    } finally {
      setShareLoading(false);
    }
  };

  const statusMessage = isLocked
    ? 'This storybook is locked for printing. Unlock it to regenerate pages or art.'
    : imageStatus === 'running'
    ? 'Illustrations are currently generating. You can keep browsing while we finish each page.'
    : imageStatus === 'error'
    ? 'Some pages need attention. Retry the failed ones or regenerate everything.'
    : imageStatus === 'ready'
    ? 'Every page has finished illustration and is ready for review.'
    : 'Kick off art generation to bring this storybook to life.';

  const nextPage = () => {
    if (!pages || pages.length === 0) return;
    setActiveIndex((prev) => Math.min(prev + 1, pages.length - 1));
  };

  const prevPage = () => {
    if (!pages || pages.length === 0) return;
    setActiveIndex((prev) => Math.max(prev - 1, 0));
  };

  const renderViewer = () => {
    if (bookLoading || pagesLoading) {
      return (
        <div className="flex items-center justify-center py-16">
          <LoaderCircle className="h-8 w-8 animate-spin text-primary" />
        </div>
      );
    }

    if (!pages || pages.length === 0) {
      return <p className="text-muted-foreground text-center py-10">No pages available yet. Generate pages from the session view first.</p>;
    }

    return (
      <div className="space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Button variant="outline" size="sm" onClick={prevPage} disabled={activeIndex === 0}>
            <ChevronLeft className="mr-1 h-4 w-4" /> Previous
          </Button>
          <div className="text-sm text-muted-foreground">
            Page {activeIndex + 1} of {pages.length}
          </div>
          <Button variant="outline" size="sm" onClick={nextPage} disabled={activeIndex >= pages.length - 1}>
            Next <ChevronRight className="ml-1 h-4 w-4" />
          </Button>
        </div>
        <div className="flex flex-wrap gap-2 justify-center">
          {pages.map((page, idx) => (
            <button
              key={page.id ?? idx}
              className={clsx(
                'rounded-full border px-3 py-1 text-xs capitalize',
                idx === activeIndex ? 'border-primary bg-primary text-white' : 'border-muted-foreground/40 text-muted-foreground'
              )}
              onClick={() => setActiveIndex(idx)}
            >
              {page.kind.replace(/_/g, ' ')}
            </button>
          ))}
        </div>

        {currentPage && (
          <div className="space-y-4">
            <div className="relative overflow-hidden rounded-xl border bg-muted/30">
              {currentPage.imageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={currentPage.imageUrl}
                  alt={currentPage.imagePrompt || `Page ${currentPage.pageNumber} artwork`}
                  className="h-[480px] w-full object-cover"
                />
              ) : (
                <div className="flex h-[320px] w-full flex-col items-center justify-center gap-2 text-muted-foreground">
                  <ImageIcon className="h-10 w-10" />
                  <p>No illustration yet.</p>
                </div>
              )}
              <div className="absolute left-4 top-4">
                <Badge variant="secondary" className="capitalize">
                  {currentPage.kind.replace(/_/g, ' ')}
                </Badge>
              </div>
              <div className="absolute right-4 top-4">
                <Badge variant={currentPage.imageStatus === 'ready' ? 'default' : 'destructive'}>
                  {currentPage.imageStatus ?? 'pending'}
                </Badge>
              </div>
            </div>
            {currentPage.title && <h3 className="text-2xl font-semibold">{currentPage.title}</h3>}
            {(currentPage.displayText || currentPage.bodyText) && <p className="text-lg leading-relaxed">{currentPage.displayText || currentPage.bodyText}</p>}
            {currentPage.imagePrompt && (
              <p className="text-xs text-muted-foreground">
                Prompt: <span className="font-medium">{currentPage.imagePrompt}</span>
              </p>
            )}
            <div className="flex flex-wrap gap-3">
              <Button
                variant="outline"
                size="sm"
                onClick={() => handleRegeneratePage(currentPage.id)}
                disabled={disableGenerate}
                title={isLocked ? 'Unlock the book to regenerate art.' : undefined}
              >
                <RefreshCw className="mr-2 h-4 w-4" />
                Regenerate this page
              </Button>
            </div>
          </div>
        )}
      </div>
    );
  };

  const openOrderDialog = () => {
    if (!requireGuard()) return;
    setOrderDialogOpen(true);
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-primary/5 to-background">
    <div className="container mx-auto px-4 py-10 space-y-6">
      <div className="grid gap-6 lg:grid-cols-1">
        <Card className="mx-auto w-full max-w-4xl">
          <CardHeader className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <CardTitle>{storyBook?.metadata?.title ?? storyBook?.storyText?.slice(0, 32) ?? 'Storybook Viewer'}</CardTitle>
                <CardDescription>
                  Book ID: <span className="font-mono text-xs">{bookId}</span>
                </CardDescription>
              </div>
              <div className="flex flex-wrap gap-2">
                <Badge variant={finalizationBadge.variant} className="uppercase tracking-wide text-xs">
                  {finalizationBadge.label}
                </Badge>
                <Badge variant="secondary" className="text-xs">
                  Pages: {readyCount}/{totalPages}
                </Badge>
                {isLocked && (
                  <Badge variant="default" className="gap-1 text-xs">
                    <Lock className="h-3 w-3" />
                    Locked
                  </Badge>
                )}
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => handleGenerateAll(false)} disabled={disableGenerate} title={isLocked ? 'Unlock to regenerate art.' : undefined}>
                {disableGenerate ? <LoaderCircle className="mr-2 h-4 w-4 animate-spin" /> : <ImageIcon className="mr-2 h-4 w-4" />}
                {imageStatus === 'ready' ? 'Refresh Art' : 'Generate Storybook Art'}
              </Button>
              <Button
                variant="outline"
                onClick={() => handleGenerateAll(true)}
                disabled={disableGenerate}
                title={isLocked ? 'Unlock to regenerate art.' : undefined}
              >
                <RefreshCw className="mr-2 h-4 w-4" />
                Force Regenerate All
              </Button>
            </div>
            <Alert variant={isLocked ? 'default' : allImagesReady ? 'default' : 'destructive'} className={clsx(
                isLocked ? 'bg-blue-50 border-blue-200 text-blue-900 [&>svg]:text-blue-600' : 
                allImagesReady ? 'bg-emerald-50 border-emerald-200 text-emerald-900 [&>svg]:text-emerald-600' : 
                'bg-amber-50 border-amber-200 text-amber-900 [&>svg]:text-amber-600'
            )}>
                <AlertTriangle className="h-4 w-4" />
                <AlertDescription>{statusMessage}</AlertDescription>
            </Alert>
          </CardHeader>
          <CardContent>{renderViewer()}</CardContent>
          <CardFooter className="flex flex-col gap-3">
            {jobError && <p className="text-sm text-destructive">{jobError}</p>}
            {jobLogs.length > 0 && (
              <div className="w-full rounded-md bg-muted/40 p-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Last generation logs</p>
                <ul className="mt-2 space-y-1 text-xs font-mono">
                  {jobLogs.map((line, idx) => (
                    <li key={`${line}-${idx}`}>{line}</li>
                  ))}
                </ul>
              </div>
            )}
            <div className="flex flex-wrap gap-2">
              <Button asChild variant="outline">
                <Link href="/stories">Back to My Stories</Link>
              </Button>
              {storyBook?.storySessionId && (
                <Button asChild variant="outline">
                  <Link href={`/story/session/${storyBook.storySessionId}/compiled`}>View Story Text</Link>
                </Button>
              )}
            </div>
          </CardFooter>
        </Card>

      </div>

      <PrintOrderDialog
        open={orderDialogOpen}
        onOpenChange={setOrderDialogOpen}
        bookId={bookId}
        finalization={finalization}
        onSuccess={() => {
          toast({title: 'Order submitted', description: 'Check Parent → Orders for status.'});
        }}
      />
    </div>
    </div>
  );
}
