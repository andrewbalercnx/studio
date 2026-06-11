'use client';

import { useMemo, useState, useEffect } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import clsx from 'clsx';
import { useFirestore } from '@/firebase';
import { doc, collection, query, orderBy, where, getDoc, updateDoc } from 'firebase/firestore';
import { useDocument, useCollection } from '@/lib/firestore-hooks';
import type { Story, StoryOutputPage, StoryOutputType, StoryBookOutput, Character, ChildProfile } from '@/lib/types';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import {
  LoaderCircle,
  ArrowLeft,
  RefreshCw,
  AlertTriangle,
  Image as ImageIcon,
  Lock,
  Unlock,
  Share2,
  Printer,
  Link as LinkIcon,
  BookOpen,
  Shield,
  Volume2,
  VolumeX,
  FileText,
} from 'lucide-react';
import { useUser } from '@/firebase/auth/use-user';
import { useParentGuard } from '@/hooks/use-parent-guard';
import { useToast } from '@/hooks/use-toast';
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { useDiagnosticsOptional } from '@/hooks/use-diagnostics';
import { deriveStorybookArtStatus } from '@/lib/storybook-status';
import { ParentBookView } from '@/components/book-reader';
import { PageEditorDialog } from '@/components/storybook/page-editor-dialog';
import { RatingPrompt } from '@/components/feedback/rating-prompt';
import type { ActorNameMapping } from '@/lib/replace-names-with-placeholders';

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
    return {label: 'Ready to Print', variant: 'outline'};
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

/**
 * Parent storybook view (Sprint W2-C).
 *
 * Two distinct stages:
 *  1. CLEAN-UP — the book renders through the same shared page components the
 *     child sees (`ParentBookView` -> `BookPageSpread`), with one addition: an
 *     Edit button on each page (text / picture prompt / single-page repaint).
 *  2. PRINT & SHARE — a clearly subsequent step: print layout, finalize/lock,
 *     ordering, and share links.
 */
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

  const [isGenerating, setIsGenerating] = useState(false);
  const [jobLogs, setJobLogs] = useState<string[]>([]);
  const [jobError, setJobError] = useState<string | null>(null);
  const [finalizing, setFinalizing] = useState(false);
  const [unlocking, setUnlocking] = useState(false);
  const [shareLoading, setShareLoading] = useState(false);
  const [shareSecret, setShareSecret] = useState<string | null>(null);
  const [shareProtectWithCode, setShareProtectWithCode] = useState(true);
  const [customSharePasscode, setCustomSharePasscode] = useState('');
  const [absoluteShareUrl, setAbsoluteShareUrl] = useState<string | null>(null);
  const [selectedOutputTypeId, setSelectedOutputTypeId] = useState<string>('');
  const [isGeneratingAudio, setIsGeneratingAudio] = useState(false);
  const [audioJobError, setAudioJobError] = useState<string | null>(null);

  // Per-page editor state
  const [editorOpen, setEditorOpen] = useState(false);
  const [editorPage, setEditorPage] = useState<StoryOutputPage | null>(null);

  // Actor name <-> $$id$$ mappings for the page editor's placeholder round-trip
  const [actors, setActors] = useState<ActorNameMapping[]>([]);

  const finalization = storyBook?.storybookFinalization ?? null;

  useEffect(() => {
    if (storyOutputTypes && storyOutputTypes.length > 0 && !selectedOutputTypeId) {
      setSelectedOutputTypeId(storyOutputTypes[0].id);
    }
  }, [storyOutputTypes, selectedOutputTypeId]);

  useEffect(() => {
    setShareSecret(null);
    setAbsoluteShareUrl(formatShareUrl(finalization?.shareLink ?? null));
  }, [finalization?.shareLink]);

  // Recovery notification: when a previously failed/degraded generation later
  // completed (server sets artStatus.recoveredAt + recoveryNotified=false),
  // tell the user once and acknowledge it on the document.
  const persistedArtStatus = storybookOutput?.artStatus;
  useEffect(() => {
    if (!storybookRef) return;
    if (persistedArtStatus?.recoveredAt && persistedArtStatus?.recoveryNotified === false) {
      toast({
        title: 'Good news — your book is complete!',
        description: 'The pictures that failed earlier have now finished. Every page is ready.',
      });
      updateDoc(storybookRef, { 'artStatus.recoveryNotified': true }).catch(() => {
        // Best effort: if the ack write fails we may toast again next visit.
      });
    }
  }, [persistedArtStatus?.recoveredAt, persistedArtStatus?.recoveryNotified, storybookRef, toast]);

  // Load actor display names from story.actors (children/characters collections)
  useEffect(() => {
    async function loadActors() {
      if (!firestore || !story?.actors || story.actors.length === 0) {
        setActors([]);
        return;
      }
      const actorIds = story.actors.filter((id: string) => id && typeof id === 'string' && id.trim().length > 0);
      const loaded: ActorNameMapping[] = [];
      for (const actorId of actorIds) {
        try {
          const childDoc = await getDoc(doc(firestore, 'children', actorId));
          if (childDoc.exists()) {
            loaded.push({ id: actorId, displayName: (childDoc.data() as ChildProfile).displayName });
            continue;
          }
        } catch (e) {
          console.warn(`[loadActors] Error fetching child ${actorId}:`, e);
        }
        try {
          const charDoc = await getDoc(doc(firestore, 'characters', actorId));
          if (charDoc.exists()) {
            loaded.push({ id: actorId, displayName: (charDoc.data() as Character).displayName });
            continue;
          }
        } catch (e) {
          console.warn(`[loadActors] Error fetching character ${actorId}:`, e);
        }
      }
      setActors(loaded);
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

  // Audio stats - pages that could have audio (have text content)
  const pagesWithText = pages?.filter((page) => page.bodyText || page.displayText) ?? [];
  const audioReadyCount = pagesWithText.filter((page) => page.audioStatus === 'ready' && page.audioUrl).length;
  const audioGeneratingCount = pagesWithText.filter((page) => page.audioStatus === 'generating').length;
  const totalAudioPages = pagesWithText.length;
  const allAudioReady = totalAudioPages > 0 && audioReadyCount === totalAudioPages;
  const documentImageStatus = storyBook?.imageGeneration?.status ?? 'idle';
  // Calculate true status from actual pages (ignoring the storybook document's cached status)
  const calculatedImageStatus = totalPages > 0 && readyCount === totalPages ? 'ready' :
                                 errorCount > 0 ? 'error' :
                                 documentImageStatus === 'running' ? 'running' : 'pending';
  const disableGenerate = isGenerating || documentImageStatus === 'running' || !!storyBook?.isLocked;

  const isLocked = storyBook?.isLocked ?? false;
  const allImagesReady = calculatedImageStatus === 'ready';
  // Degraded-book contract: live rollup from the pages themselves (the same
  // derivation the server persists as storybook.artStatus).
  const artStatus = useMemo(() => deriveStorybookArtStatus(pages ?? []), [pages]);
  const isDegraded = artStatus.completeness === 'degraded';
  const finalizationBadge = deriveFinalizationBadge(storyBook, readyCount, totalPages);
  const shareExpiresAt = formatTimestamp(finalization?.shareExpiresAt);
  const hasArtStarted = readyCount > 0 || errorCount > 0 || documentImageStatus === 'running' || isGenerating;

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

  const triggerImageJob = async (payload: {pageId?: string; forceRegenerate?: boolean; additionalPrompt?: string} = {}) => {
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

  const handleGenerateAll = () => triggerImageJob({});

  // Single-page repaint (used by the failed-page retry and the editor dialog)
  const handleRetryPage = (page: StoryOutputPage) => {
    if (!page.id) return;
    triggerImageJob({ pageId: page.id, forceRegenerate: true });
  };

  const handleRegenerateFromEditor = (pageId: string, additionalPrompt?: string) => {
    toast({ title: 'Repainting page', description: 'The new picture will appear when it finishes.' });
    triggerImageJob({ pageId, forceRegenerate: true, additionalPrompt });
  };

  const handleRetryFailedPages = async () => {
    if (!storyId || !isNewModel || failedPageIds.length === 0) return;
    setIsGenerating(true);
    setJobError(null);
    try {
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
      toast({title: 'Retrying missing pictures', description: `Started regeneration for ${failedPageIds.length} page(s).`});
    } catch (error: any) {
      setJobError(error?.message || 'Unexpected error while regenerating failed pages.');
    } finally {
      setIsGenerating(false);
    }
  };

  const handleEditPage = (page: StoryOutputPage) => {
    if (isLocked) {
      toast({ title: 'Book is locked', description: 'Unlock the book to edit its pages.' });
      return;
    }
    setEditorPage(page);
    setEditorOpen(true);
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

  const handleGenerateAudio = async (forceRegenerate = false) => {
    if (!storyId || !isNewModel) return;
    setIsGeneratingAudio(true);
    setAudioJobError(null);
    try {
      const response = await authorizedFetch('/api/storyBook/pageAudio', {
        storyId,
        storybookId: bookId,
        forceRegenerate,
      });
      if (response) {
        toast({
          title: 'Audio generation started',
          description: 'Narration is being generated for each page. This may take a few minutes.',
        });
      }
    } catch (error: any) {
      setAudioJobError(error?.message || 'Failed to start audio generation.');
      toast({
        title: 'Audio generation failed',
        description: error?.message ?? 'Unable to generate audio.',
        variant: 'destructive',
      });
    } finally {
      setIsGeneratingAudio(false);
    }
  };

  const statusMessage = isLocked
    ? 'This storybook is locked for printing. Unlock it to edit pages or repaint pictures.'
    : calculatedImageStatus === 'running'
    ? 'Illustrations are currently generating. You can keep browsing while we finish each page.'
    : isDegraded
    ? `${artStatus.pagesReady} of ${artStatus.pagesTotal} illustrations are ready — ${artStatus.pagesFailed} didn't finish. You can read and order the book now, and retry the missing pictures any time.`
    : artStatus.completeness === 'failed'
    ? "The illustrations didn't finish this time. Your story text is safe — retry the artwork when you're ready."
    : calculatedImageStatus === 'error'
    ? 'Some pages need attention. Retry the failed ones or regenerate everything.'
    : calculatedImageStatus === 'ready'
    ? 'Every page is illustrated. Review each page below, then move on to printing.'
    : 'Kick off art generation to bring this storybook to life.';

  // ── Render ──────────────────────────────────────────────────────────────

  if (bookLoading || pagesLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-primary/5 to-background">
        <div className="flex items-center justify-center py-24">
          <LoaderCircle className="h-8 w-8 animate-spin text-primary" />
        </div>
      </div>
    );
  }

  // Legacy storybooks are no longer supported
  if (!isNewModel) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-primary/5 to-background">
        <div className="container mx-auto px-4 py-10">
          <Card className="mx-auto w-full max-w-3xl border-dashed border-destructive">
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
        </div>
      </div>
    );
  }

  const hasPages = !!pages && pages.length > 0;

  return (
    <div className="min-h-screen bg-gradient-to-b from-primary/5 to-background">
    <div className="container mx-auto px-4 py-8 space-y-6">
      {/* Top bar */}
      <div className="mx-auto w-full max-w-4xl flex flex-wrap items-center justify-between gap-2">
        <Button asChild variant="ghost" size="sm">
          <Link href="/stories">
            <ArrowLeft className="mr-1 h-4 w-4" />
            My Stories
          </Link>
        </Button>
        {story?.childId && (
          <Button asChild variant="ghost" size="sm">
            <Link href={`/child/${story.childId}/story/${storyId}/read`}>
              <FileText className="mr-1 h-4 w-4" />
              View Story Text
            </Link>
          </Button>
        )}
      </div>

      {/* Header: title, status, primary actions */}
      <Card className="mx-auto w-full max-w-4xl" data-wiz-target="storybook-viewer-card">
        <CardHeader className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <CardTitle>{storyBook?.metadata?.title ?? storyBook?.storyText?.slice(0, 32) ?? 'Storybook'}</CardTitle>
            <div className="flex flex-wrap gap-2">
              <Badge variant={finalizationBadge.variant} className="uppercase tracking-wide text-xs">
                {finalizationBadge.label}
              </Badge>
              <Badge variant={isDegraded ? 'destructive' : 'secondary'} className="gap-1 text-xs">
                {isDegraded && <AlertTriangle className="h-3 w-3" />}
                Pictures: {readyCount}/{totalPages}
              </Badge>
              <Badge variant={allAudioReady ? 'default' : audioGeneratingCount > 0 ? 'secondary' : 'outline'} className="gap-1 text-xs">
                {audioGeneratingCount > 0 ? (
                  <LoaderCircle className="h-3 w-3 animate-spin" />
                ) : allAudioReady ? (
                  <Volume2 className="h-3 w-3" />
                ) : (
                  <VolumeX className="h-3 w-3" />
                )}
                Audio: {audioReadyCount}/{totalAudioPages}
              </Badge>
              {isLocked && (
                <Badge variant="default" className="gap-1 text-xs">
                  <Lock className="h-3 w-3" />
                  Locked
                </Badge>
              )}
            </div>
          </div>

          <Alert className={clsx(
              isLocked ? 'bg-blue-50 border-blue-200 text-blue-900 [&>svg]:text-blue-600' :
              allImagesReady ? 'bg-emerald-50 border-emerald-200 text-emerald-900 [&>svg]:text-emerald-600' :
              'bg-amber-50 border-amber-200 text-amber-900 [&>svg]:text-amber-600'
          )}>
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>{statusMessage}</AlertDescription>
          </Alert>

          <div className="flex flex-wrap gap-2" data-wiz-target="storybook-actions">
            {hasPages && !hasArtStarted && !isLocked && (
              <Button onClick={handleGenerateAll} disabled={disableGenerate} data-wiz-target="storybook-generate-art">
                {isGenerating ? <LoaderCircle className="mr-2 h-4 w-4 animate-spin" /> : <ImageIcon className="mr-2 h-4 w-4" />}
                Generate Storybook Art
              </Button>
            )}
            {errorCount > 0 && !isLocked && (
              <Button variant="destructive" onClick={handleRetryFailedPages} disabled={disableGenerate}>
                <RefreshCw className="mr-2 h-4 w-4" />
                Retry {errorCount} Missing Picture{errorCount === 1 ? '' : 's'}
              </Button>
            )}
            {artStatus.isViewable && (
              <Button asChild variant="default" data-wiz-target="storybook-read">
                <Link href={`/storybook/${bookId}/read?storyId=${storyId}`}>
                  <BookOpen className="mr-2 h-4 w-4" />
                  Read Book
                </Link>
              </Button>
            )}
            {allImagesReady && (
              <Button
                variant="outline"
                onClick={() => handleGenerateAudio(allAudioReady)}
                disabled={isGeneratingAudio || audioGeneratingCount > 0 || isLocked}
                title={isLocked ? 'Unlock to generate audio.' : allAudioReady ? 'Regenerate all narration' : 'Generate narration for all pages'}
                data-wiz-target="storybook-generate-audio"
              >
                {(isGeneratingAudio || audioGeneratingCount > 0) ? (
                  <LoaderCircle className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Volume2 className="mr-2 h-4 w-4" />
                )}
                {allAudioReady ? 'Regenerate Narration' : 'Generate Narration'}
              </Button>
            )}
          </div>
          {jobError && <p className="text-sm text-destructive">{jobError}</p>}
          {audioJobError && <p className="text-sm text-destructive">{audioJobError}</p>}
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
        </CardHeader>
      </Card>

      {/* No pages yet: choose a format and generate pages */}
      {!hasPages && (
        <Card className="mx-auto w-full max-w-4xl border-dashed">
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
            </CardContent>
        </Card>
      )}

      {/* Stage 1 — clean-up: the book exactly as the child sees it + Edit */}
      {hasPages && (
        <Card className="mx-auto w-full max-w-4xl">
          <CardHeader className="pb-3">
            <CardTitle className="text-lg">Step 1 · Clean up the pages</CardTitle>
            <CardDescription>
              This is the book as your child sees it. Flick through each page — use{' '}
              <span className="font-medium">Edit page</span> to change the words, the picture
              description, or repaint a single picture.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ParentBookView
              pages={pages!}
              onEditPage={handleEditPage}
              onRetryPage={handleRetryPage}
              actionsDisabled={disableGenerate}
            />
          </CardContent>
        </Card>
      )}

      {/* Stage 2 — print & share: a clearly subsequent step */}
      {hasPages && (
        <Card className="mx-auto w-full max-w-4xl">
          <CardHeader className="pb-3">
            <CardTitle className="text-lg">Step 2 · Print &amp; share</CardTitle>
            <CardDescription>
              Happy with every page? Create the print layout and order a printed copy, or lock the
              book to share it.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {isDegraded && (
              <Alert className="bg-amber-50 border-amber-200 text-amber-900 [&>svg]:text-amber-600">
                <AlertTriangle className="h-4 w-4" />
                <AlertTitle>{artStatus.pagesFailed} page{artStatus.pagesFailed === 1 ? ' has' : 's have'} no picture</AlertTitle>
                <AlertDescription>
                  You can still order this book — we&apos;ll ask you to confirm at checkout that
                  those pages will print without art. Or retry the missing pictures in Step 1 first.
                </AlertDescription>
              </Alert>
            )}
            {!artStatus.isOrderable && (
              <p className="text-sm text-muted-foreground">
                Printing unlocks once the illustrations are finished (or partially finished) in Step 1.
              </p>
            )}
            <div className="flex flex-wrap gap-2">
              {artStatus.isOrderable && (
                <Button asChild variant="default" data-wiz-target="storybook-print-layout">
                  <Link href={`/storybook/${bookId}/print-layout?storyId=${storyId}`}>
                    <Printer className="mr-2 h-4 w-4" />
                    Create Print Layout
                  </Link>
                </Button>
              )}
              {artStatus.isOrderable && !isLocked && (
                <Button onClick={handleFinalize} disabled={finalizing} variant="outline" data-wiz-target="storybook-finalize">
                  {finalizing ? (
                    <LoaderCircle className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Lock className="mr-2 h-4 w-4" />
                  )}
                  Finalize for Sharing
                </Button>
              )}
              {isLocked && (
                <Button onClick={handleUnlock} disabled={unlocking} variant="outline" data-wiz-target="storybook-unlock">
                  {unlocking ? (
                    <LoaderCircle className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Unlock className="mr-2 h-4 w-4" />
                  )}
                  Unlock to Edit
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Share Card - only show when finalized */}
      {isLocked && (
        <Card className="mx-auto w-full max-w-4xl" data-wiz-target="storybook-share-card">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Share2 className="h-5 w-5" />
              Share This Book
            </CardTitle>
            <CardDescription>
              Create a link to share this storybook with friends and family.
              {finalization?.shareId && ' Anyone with the link can view the book.'}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {absoluteShareUrl ? (
              <div className="space-y-4">
                <div className="flex items-center gap-2">
                  <Input
                    readOnly
                    value={absoluteShareUrl}
                    className="font-mono text-sm"
                  />
                  <Button
                    variant="outline"
                    size="icon"
                    onClick={() => {
                      navigator.clipboard.writeText(absoluteShareUrl);
                      toast({title: 'Link copied', description: 'Share link copied to clipboard.'});
                    }}
                    title="Copy link"
                  >
                    <LinkIcon className="h-4 w-4" />
                  </Button>
                </div>

                <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
                  {finalization?.shareRequiresPasscode && (
                    <Badge variant="outline" className="gap-1">
                      <Shield className="h-3 w-3" />
                      Passcode protected
                    </Badge>
                  )}
                  {shareExpiresAt && (
                    <span>Expires {shareExpiresAt}</span>
                  )}
                </div>

                {shareSecret && (
                  <Alert className="bg-primary/5 border-primary/20">
                    <Shield className="h-4 w-4" />
                    <AlertTitle>Passcode</AlertTitle>
                    <AlertDescription className="font-mono text-lg">
                      {shareSecret}
                    </AlertDescription>
                  </Alert>
                )}

                <Button
                  variant="destructive"
                  size="sm"
                  onClick={handleShareRevoke}
                  disabled={shareLoading}
                >
                  {shareLoading && <LoaderCircle className="mr-2 h-4 w-4 animate-spin" />}
                  Revoke Share Link
                </Button>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="flex items-center gap-3">
                  <Switch
                    id="passcode-toggle"
                    checked={shareProtectWithCode}
                    onCheckedChange={setShareProtectWithCode}
                  />
                  <label htmlFor="passcode-toggle" className="text-sm font-medium">
                    Require passcode to view
                  </label>
                </div>

                {shareProtectWithCode && (
                  <div className="space-y-2">
                    <label htmlFor="custom-passcode" className="text-sm text-muted-foreground">
                      Custom passcode (optional, leave empty for auto-generated)
                    </label>
                    <Input
                      id="custom-passcode"
                      placeholder="Enter 4+ character passcode"
                      value={customSharePasscode}
                      onChange={(e) => setCustomSharePasscode(e.target.value)}
                      className="max-w-xs"
                    />
                  </div>
                )}

                <Button
                  onClick={handleShareGenerate}
                  disabled={shareLoading}
                  data-wiz-target="storybook-create-share"
                >
                  {shareLoading ? (
                    <LoaderCircle className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Share2 className="mr-2 h-4 w-4" />
                  )}
                  Create Share Link
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Per-page editor */}
      <PageEditorDialog
        open={editorOpen}
        onOpenChange={setEditorOpen}
        page={editorPage}
        storyId={storyId}
        storybookId={bookId}
        actors={actors}
        disabled={disableGenerate}
        onSaved={({ audioReset }) => {
          toast({
            title: 'Page saved',
            description: audioReset
              ? 'The narration for this page was reset — regenerate audio when you finish editing.'
              : undefined,
          });
        }}
        onRegenerate={handleRegenerateFromEditor}
      />

      {/* Post-book rating prompt (Sprint W3-C): floating, non-modal, dismissible.
          Shown to parents the first time a finished (fully illustrated) book is
          viewed; suppression is server-backed (one feedback doc per book). */}
      <RatingPrompt
        trigger="book_first_view"
        subjectId={bookId}
        momentReached={hasPages && allImagesReady}
        variant="floating"
      />
    </div>
    </div>
  );
}
