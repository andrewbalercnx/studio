
'use client';

import {useMemo, useState, useEffect} from 'react';
import {useParams, useSearchParams} from 'next/navigation';
import Link from 'next/link';
import clsx from 'clsx';
import {useFirestore} from '@/firebase';
import {doc, collection, query, orderBy, where} from 'firebase/firestore';
import {useDocument, useCollection} from '@/lib/firestore-hooks';
import type {Story, StoryOutputPage, StoryOutputType, StoryBookOutput, Character, ChildProfile} from '@/lib/types';
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
  BookOpen,
} from 'lucide-react';
import {useUser} from '@/firebase/auth/use-user';
import {useParentGuard} from '@/hooks/use-parent-guard';
import {useToast} from '@/hooks/use-toast';
import {PrintOrderDialog} from '@/components/storybook/print-order-dialog';
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert';
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar';
import { getDoc } from 'firebase/firestore';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { useResolvePlaceholders } from '@/hooks/use-resolve-placeholders';
import { useDiagnosticsOptional } from '@/hooks/use-diagnostics';

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
  const searchParams = useSearchParams();
  const bookId = params.bookId;
  // If storyId is provided as query param, this is a new-model storybook (subcollection)
  const storyIdParam = searchParams.get('storyId');
  const isNewModel = !!storyIdParam;
  const storyId = storyIdParam || bookId; // For new model, storyId is separate; for legacy, bookId IS the storyId

  const firestore = useFirestore();
  const {user} = useUser();
  const {toast} = useToast();
  const {isParentGuardValidated, showPinModal} = useParentGuard();
  const diagnostics = useDiagnosticsOptional();

  // For legacy model: load Story document directly
  // For new model: load Story for metadata and StoryBookOutput for status
  const storyRef = useMemo(() => (firestore && storyId ? doc(firestore, 'stories', storyId) : null), [firestore, storyId]);
  const storybookRef = useMemo(
    () => (firestore && isNewModel && storyId && bookId ? doc(firestore, 'stories', storyId, 'storybooks', bookId) : null),
    [firestore, isNewModel, storyId, bookId]
  );

  // Pages query: new model only - pages are in stories/{storyId}/storybooks/{storybookId}/pages
  const pagesQuery = useMemo(
    () => {
      if (!firestore || !isNewModel || !storyId || !bookId) return null;
      return query(collection(firestore, 'stories', storyId, 'storybooks', bookId, 'pages'), orderBy('pageNumber', 'asc'));
    },
    [firestore, isNewModel, storyId, bookId]
  );
  const storyOutputTypesQuery = useMemo(() => firestore ? query(collection(firestore, 'storyOutputTypes'), where('status', '==', 'live')) : null, [firestore]);

  const {data: story, loading: storyLoading} = useDocument<Story>(storyRef);
  const {data: storybookOutput, loading: storybookOutputLoading} = useDocument<StoryBookOutput>(storybookRef);
  const {data: pages, loading: pagesLoading} = useCollection<StoryOutputPage>(pagesQuery);
  const { data: storyOutputTypes, loading: outputTypesLoading } = useCollection<StoryOutputType>(storyOutputTypesQuery);

  // Storybook data - new model only
  const storyBook = useMemo(() => {
    if (!isNewModel || !storybookOutput || !story) return null;
    // Merge story metadata with storybook output status
    return {
      ...story,
      imageGeneration: storybookOutput.imageGeneration,
      pageGeneration: storybookOutput.pageGeneration,
      isLocked: storybookOutput.isLocked,
      storybookFinalization: storybookOutput.finalization,
      metadata: {
        ...story.metadata,
        title: storybookOutput.title || story.metadata?.title,
      },
    } as Story;
  }, [isNewModel, story, storybookOutput]);

  const bookLoading = storyLoading || (isNewModel && storybookOutputLoading);

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
  const [selectedOutputTypeId, setSelectedOutputTypeId] = useState<string>('');

  // Actor list state
  type ActorInfo = {
    id: string;
    displayName: string;
    avatarUrl?: string;
    type: 'child' | 'character';
    characterType?: string;
  };
  const [actors, setActors] = useState<ActorInfo[]>([]);
  const [actorsLoading, setActorsLoading] = useState(false);

  const finalization = storyBook?.storybookFinalization ?? null;

  useEffect(() => {
    if (pages && pages.length > 0 && activeIndex >= pages.length) {
      setActiveIndex(pages.length - 1);
    }
  }, [pages, activeIndex]);
  
  useEffect(() => {
    if (storyOutputTypes && storyOutputTypes.length > 0 && !selectedOutputTypeId) {
      setSelectedOutputTypeId(storyOutputTypes[0].id);
    }
  }, [storyOutputTypes, selectedOutputTypeId]);

  useEffect(() => {
    setShareSecret(null);
    setAbsoluteShareUrl(formatShareUrl(finalization?.shareLink ?? null));
  }, [finalization?.shareLink]);

  // Load actors from story.actors array
  useEffect(() => {
    async function loadActors() {
      if (!firestore || !story?.actors || story.actors.length === 0) {
        setActors([]);
        return;
      }

      setActorsLoading(true);
      const actorIds = story.actors;
      const loadedActors: ActorInfo[] = [];

      for (const actorId of actorIds) {
        // Try children collection first
        try {
          const childDoc = await getDoc(doc(firestore, 'children', actorId));
          if (childDoc.exists()) {
            const child = childDoc.data() as ChildProfile;
            loadedActors.push({
              id: actorId,
              displayName: child.displayName,
              avatarUrl: child.avatarUrl,
              type: 'child',
            });
            continue;
          }
        } catch (e) {
          console.warn(`[loadActors] Error fetching child ${actorId}:`, e);
        }

        // Try characters collection
        try {
          const charDoc = await getDoc(doc(firestore, 'characters', actorId));
          if (charDoc.exists()) {
            const character = charDoc.data() as Character;
            loadedActors.push({
              id: actorId,
              displayName: character.displayName,
              avatarUrl: character.avatarUrl,
              type: 'character',
              characterType: character.type,
            });
            continue;
          }
        } catch (e) {
          console.warn(`[loadActors] Error fetching character ${actorId}:`, e);
        }

        // Actor not found - add placeholder
        loadedActors.push({
          id: actorId,
          displayName: actorId,
          type: 'character',
        });
      }

      setActors(loadedActors);
      setActorsLoading(false);
    }

    loadActors();
  }, [firestore, story?.actors]);

  // Pages that don't require images (title_page and blank pages without imagePrompt)
  const pagesRequiringImages = pages?.filter((page) =>
    page.kind !== 'title_page' && page.kind !== 'blank' && page.imagePrompt
  ) ?? [];
  const readyCount = pagesRequiringImages.filter((page) => page.imageStatus === 'ready').length;
  const errorCount = pagesRequiringImages.filter((page) => page.imageStatus === 'error').length;
  const failedPageIds = pagesRequiringImages.filter((page) => page.imageStatus === 'error').map(p => p.id);
  const totalPages = pagesRequiringImages.length;
  const documentImageStatus = storyBook?.imageGeneration?.status ?? 'idle';
  // Calculate true status from actual pages (ignoring the storybook document's cached status)
  const calculatedImageStatus = totalPages > 0 && readyCount === totalPages ? 'ready' :
                                 errorCount > 0 ? 'error' :
                                 documentImageStatus === 'running' ? 'running' : 'pending';
  const disableGenerate = isGenerating || documentImageStatus === 'running' || !!storyBook?.isLocked;
  const currentPage = pages && pages.length > 0 ? pages[Math.max(0, Math.min(activeIndex, pages.length - 1))] : null;

  // Resolve placeholders in the current page's text
  // This handles pages with unresolved $$childId$$ or $$characterId$$ placeholders
  const rawPageText = currentPage?.displayText || currentPage?.bodyText || null;
  const { resolvedText: currentPageText } = useResolvePlaceholders(rawPageText);

  const isLocked = storyBook?.isLocked ?? false;
  const allImagesReady = calculatedImageStatus === 'ready';
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
    if (!storyId || !isNewModel) return;
    setIsGenerating(true);
    setJobError(null);
    try {
      const response = await fetch('/api/storybookV2/images', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({
          storyId,
          storybookId: bookId,
          ...payload,
        }),
      });
      const result = await response.json();
      // Always capture logs, even on partial success
      setJobLogs(result.logs ?? []);

      if (!response.ok || !result?.ok) {
        // Show partial success info if some pages completed
        const partialInfo = result?.ready && result?.total
          ? ` (${result.ready}/${result.total} images completed)`
          : '';
        throw new Error((result?.errorMessage || 'Failed to generate storybook art.') + partialInfo);
      }
    } catch (error: any) {
      setJobError(error?.message || 'Unexpected error while generating art.');
    } finally {
      setIsGenerating(false);
    }
  };
  
  const handleGeneratePages = async () => {
    if (!storyId || !isNewModel) return;
    if (!selectedOutputTypeId) {
        toast({ title: 'Please select an output type', variant: 'destructive' });
        return;
    }
    setIsGenerating(true);
    setJobError(null);
    try {
        const response = await fetch('/api/storybookV2/pages', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              storyId,
              storybookId: bookId,
              storyOutputTypeId: selectedOutputTypeId,
            }),
        });
        const result = await response.json();
        if (!response.ok || !result.ok) {
            throw new Error(result.errorMessage || 'Failed to generate pages.');
        }
        toast({ title: 'Page generation started', description: 'Your storybook pages are being created.' });
    } catch (error: any) {
        setJobError(error.message || 'An unexpected error occurred.');
    } finally {
        setIsGenerating(false);
    }
  };


  const handleGenerateAll = (forceRegenerate = false) => triggerImageJob({forceRegenerate});
  const handleRegeneratePage = (pageId: string | undefined) => {
    if (!pageId) return;
    triggerImageJob({pageId, forceRegenerate: true});
  };

  const handleRegenerateFailedPages = async () => {
    if (!storyId || !isNewModel || failedPageIds.length === 0) return;
    setIsGenerating(true);
    setJobError(null);
    try {
      // Regenerate each failed page sequentially
      for (const pageId of failedPageIds) {
        const response = await fetch('/api/storybookV2/images', {
          method: 'POST',
          headers: {'Content-Type': 'application/json'},
          body: JSON.stringify({
            storyId,
            storybookId: bookId,
            pageId,
            forceRegenerate: true,
          }),
        });
        const result = await response.json();
        if (!response.ok || !result?.ok) {
          throw new Error(result?.errorMessage || `Failed to regenerate page ${pageId}.`);
        }
      }
      toast({title: 'Regenerating failed pages', description: `Started regeneration for ${failedPageIds.length} failed page(s).`});
    } catch (error: any) {
      setJobError(error?.message || 'Unexpected error while regenerating failed pages.');
    } finally {
      setIsGenerating(false);
    }
  };

  const handleFinalize = async () => {
    if (!storyId || !isNewModel || !requireGuard()) return;
    setFinalizing(true);
    try {
      await authorizedFetch('/api/storybookV2/finalize', {
        storyId,
        storybookId: bookId,
        action: 'finalize',
      });
      toast({title: 'Book finalized', description: 'Storypages locked for printing.'});
    } catch (error: any) {
      toast({title: 'Finalize failed', description: error?.message ?? 'Unable to finalize book.', variant: 'destructive'});
    } finally {
      setFinalizing(false);
    }
  };

  const handleUnlock = async () => {
    if (!storyId || !isNewModel || !requireGuard()) return;
    setUnlocking(true);
    try {
      await authorizedFetch('/api/storybookV2/finalize', {
        storyId,
        storybookId: bookId,
        action: 'unlock',
      });
      toast({title: 'Book unlocked', description: 'You can make edits again.'});
    } catch (error: any) {
      toast({title: 'Unlock failed', description: error?.message ?? 'Unable to unlock book.', variant: 'destructive'});
    } finally {
      setUnlocking(false);
    }
  };

  const handleGeneratePrintable = async () => {
    if (!storyId || !requireGuard()) return;
    setPrintableLoading(true);
    try {
      // Use the print layout stored on the storybook, or fall back to a default
      const printLayoutId = storybookOutput?.printLayoutId || 'a4-portrait-spread-v1';
      const result = await authorizedFetch('/api/storyBook/printable', {
        storyId,
        ...(isNewModel && { storybookId: bookId }),
        outputId: 'storybook',
        printLayoutId,
      });
      if (!result) return;
      toast({title: 'Printable ready', description: 'PDF regenerated successfully.'});
    } catch (error: any) {
      toast({title: 'Printable failed', description: error?.message ?? 'Unable to render PDF.', variant: 'destructive'});
    } finally {
      setPrintableLoading(false);
    }
  };

  const handleShareGenerate = async () => {
    if (!storyId || !requireGuard()) return;
    setShareLoading(true);
    try {
      const result = await authorizedFetch('/api/storyBook/share', {
        bookId: storyId,
        ...(isNewModel && { storybookId: bookId }),
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
    if (!storyId || !requireGuard()) return;
    setShareLoading(true);
    try {
      await authorizedFetch('/api/storyBook/share', {
        bookId: storyId,
        ...(isNewModel && { storybookId: bookId }),
        action: 'revoke',
      });
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
    : calculatedImageStatus === 'running'
    ? 'Illustrations are currently generating. You can keep browsing while we finish each page.'
    : calculatedImageStatus === 'error'
    ? 'Some pages need attention. Retry the failed ones or regenerate everything.'
    : calculatedImageStatus === 'ready'
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

    // Legacy storybooks are no longer supported
    if (!isNewModel) {
      return (
        <Card className="border-dashed border-destructive">
          <CardHeader>
            <CardTitle className="text-destructive">Legacy Storybook</CardTitle>
            <CardDescription>
              This storybook was created with an older format that is no longer supported.
              Please create a new storybook from your story.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild variant="outline">
              <Link href="/stories">Back to My Stories</Link>
            </Button>
          </CardContent>
        </Card>
      );
    }

    if (!pages || pages.length === 0) {
      return (
        <Card className="border-dashed">
            <CardHeader>
                <CardTitle>Create Your Storybook Pages</CardTitle>
                <CardDescription>
                    Choose a format and let the AI generate the pages for your book.
                </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
                <div className="space-y-2">
                    <Label htmlFor="output-type">Book Format</Label>
                    <Select value={selectedOutputTypeId} onValueChange={setSelectedOutputTypeId} disabled={outputTypesLoading}>
                        <SelectTrigger id="output-type">
                            <SelectValue placeholder={outputTypesLoading ? 'Loading formats...' : 'Select a format'} />
                        </SelectTrigger>
                        <SelectContent>
                            {storyOutputTypes?.map(type => (
                                <SelectItem key={type.id} value={type.id}>{type.name}</SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </div>
                <Button onClick={handleGeneratePages} disabled={isGenerating || !selectedOutputTypeId}>
                    {isGenerating ? <LoaderCircle className="mr-2 h-4 w-4 animate-spin" /> : <BookOpen className="mr-2 h-4 w-4" />}
                    Generate Pages
                </Button>
                {jobError && <p className="text-sm text-destructive">{jobError}</p>}
            </CardContent>
        </Card>
      );
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
          {pages.map((page, idx) => {
            // Pages that don't need images (title_page, blank without imagePrompt) are always considered "ready"
            const needsImage = page.kind !== 'title_page' && page.kind !== 'blank' && !!page.imagePrompt;
            const isError = needsImage && page.imageStatus === 'error';
            const isPending = needsImage && (!page.imageStatus || page.imageStatus === 'pending' || page.imageStatus === 'generating');
            return (
              <button
                key={page.id ?? idx}
                className={clsx(
                  'rounded-full border px-3 py-1 text-xs capitalize flex items-center gap-1',
                  idx === activeIndex
                    ? isError
                      ? 'border-destructive bg-destructive text-white'
                      : 'border-primary bg-primary text-white'
                    : isError
                      ? 'border-destructive/60 text-destructive bg-destructive/10'
                      : isPending
                        ? 'border-amber-400/60 text-amber-600 bg-amber-50'
                        : 'border-muted-foreground/40 text-muted-foreground'
                )}
                onClick={() => setActiveIndex(idx)}
                title={isError ? 'Image generation failed - click to view' : isPending ? 'Image pending' : undefined}
              >
                {isError && <AlertTriangle className="h-3 w-3" />}
                {page.kind.replace(/_/g, ' ')}
              </button>
            );
          })}
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
            {currentPageText && <p className="text-lg leading-relaxed">{currentPageText}</p>}
            {/* Show error details for failed pages */}
            {currentPage.imageStatus === 'error' && currentPage.imageMetadata?.lastErrorMessage && (
              <Alert variant="destructive" className="text-sm">
                <AlertTriangle className="h-4 w-4" />
                <AlertTitle>Image Generation Failed</AlertTitle>
                <AlertDescription className="font-mono text-xs break-all">
                  {currentPage.imageMetadata.lastErrorMessage}
                </AlertDescription>
              </Alert>
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
        <Card className="mx-auto w-full max-w-4xl" data-wiz-target="storybook-viewer-card">
          <CardHeader className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <CardTitle>{storyBook?.metadata?.title ?? storyBook?.storyText?.slice(0, 32) ?? 'Storybook Viewer'}</CardTitle>
              </div>
              <div className="flex flex-wrap gap-2">
                <Badge variant={finalizationBadge.variant} className="uppercase tracking-wide text-xs">
                  {finalizationBadge.label}
                </Badge>
                <Badge variant="secondary" className="text-xs">
                  Pages: {readyCount}/{totalPages}
                </Badge>
                {errorCount > 0 && (
                  <Badge variant="destructive" className="gap-1 text-xs">
                    <AlertTriangle className="h-3 w-3" />
                    {errorCount} Failed
                  </Badge>
                )}
                {isLocked && (
                  <Badge variant="default" className="gap-1 text-xs">
                    <Lock className="h-3 w-3" />
                    Locked
                  </Badge>
                )}
              </div>
            </div>
            {/* Actor List */}
            {actors.length > 0 && (
              <div className="flex flex-wrap items-center gap-3 py-2 border-t border-b">
                <span className="text-sm font-medium text-muted-foreground">Cast:</span>
                <div className="flex flex-wrap gap-2">
                  {actors.map((actor) => (
                    <div key={actor.id} className="flex items-center gap-2 bg-muted/50 rounded-full px-3 py-1">
                      <Avatar className="h-6 w-6">
                        {actor.avatarUrl ? (
                          <AvatarImage src={actor.avatarUrl} alt={actor.displayName} />
                        ) : null}
                        <AvatarFallback className="text-xs">
                          {actor.displayName.charAt(0).toUpperCase()}
                        </AvatarFallback>
                      </Avatar>
                      <span className="text-sm">{actor.displayName}</span>
                      {actor.type === 'character' && actor.characterType && (
                        <Badge variant="outline" className="text-xs py-0 px-1">
                          {actor.characterType}
                        </Badge>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
            {actorsLoading && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <LoaderCircle className="h-4 w-4 animate-spin" />
                Loading cast...
              </div>
            )}
            <div className="flex flex-wrap gap-2" data-wiz-target="storybook-actions">
              <Button onClick={() => handleGenerateAll(false)} disabled={disableGenerate} title={isLocked ? 'Unlock to regenerate art.' : undefined} data-wiz-target="storybook-generate-art">
                {disableGenerate ? <LoaderCircle className="mr-2 h-4 w-4 animate-spin" /> : <ImageIcon className="mr-2 h-4 w-4" />}
                {calculatedImageStatus === 'ready' ? 'Refresh Art' : 'Generate Storybook Art'}
              </Button>
              {errorCount > 0 && (
                <Button
                  variant="destructive"
                  onClick={handleRegenerateFailedPages}
                  disabled={disableGenerate}
                  title={isLocked ? 'Unlock to regenerate art.' : `Regenerate ${errorCount} failed page(s)`}
                >
                  <AlertTriangle className="mr-2 h-4 w-4" />
                  Retry {errorCount} Failed
                </Button>
              )}
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
            {jobLogs.length > 0 && diagnostics?.showDiagnosticsPanel && (
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
              {story?.childId && (
                <Button asChild variant="outline">
                  <Link href={`/child/${story.childId}/story/${storyId}/read`}>View Story Text</Link>
                </Button>
              )}
              {allImagesReady && (
                <>
                  <Button asChild variant="default" data-wiz-target="storybook-read">
                    <Link href={isNewModel ? `/storybook/${bookId}/read?storyId=${storyId}` : `/storybook/${bookId}/read`}>
                      <BookOpen className="mr-2 h-4 w-4" />
                      Read Book
                    </Link>
                  </Button>
                  <Button asChild variant="outline" data-wiz-target="storybook-print-layout">
                    <Link href={isNewModel ? `/storybook/${bookId}/print-layout?storyId=${storyId}` : `/storybook/${bookId}/print-layout`}>
                      <Printer className="mr-2 h-4 w-4" />
                      Create Print Layout
                    </Link>
                  </Button>
                </>
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
