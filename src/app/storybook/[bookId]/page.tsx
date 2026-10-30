'use client';

import { useMemo, useState, useEffect } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import clsx from 'clsx';
import { useFirestore } from '@/firebase';
import { doc, collection, query, orderBy } from 'firebase/firestore';
import { useDocument, useCollection } from '@/lib/firestore-hooks';
import type { Story, StoryOutputPage, StoryBookOutput } from '@/lib/types';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import {
  LoaderCircle,
  ArrowLeft,
  AlertTriangle,
  Lock,
  Share2,
  Printer,
  Link as LinkIcon,
  BookOpen,
  Shield,
  FileText,
} from 'lucide-react';
import { useUser } from '@/firebase/auth/use-user';
import { useParentGuard } from '@/hooks/use-parent-guard';
import { useToast } from '@/hooks/use-toast';
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert';
import { deriveStorybookArtStatus } from '@/lib/storybook-status';
import { ParentBookView } from '@/components/book-reader';
import { RatingPrompt } from '@/components/feedback/rating-prompt';

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
 * Parent view of a storybook made before the Book pipeline (`stories/{id}/storybooks`).
 *
 * Read-only since slice 5.2 removed `storybookV2`: the pages, the print path
 * (print layout, order) and share links of already-finalized books still work
 * until the trial data reset. Generating, repainting, editing and finalizing
 * are gone; new Books live at `/books/{bookId}`.
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


  const {data: story, loading: storyLoading} = useDocument<Story>(storyRef);
  const {data: storybookOutput, loading: storybookOutputLoading} = useDocument<StoryBookOutput>(storybookRef);
  const {data: pages, loading: pagesLoading} = useCollection<StoryOutputPage>(pagesQuery);

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

  const [shareLoading, setShareLoading] = useState(false);
  const [shareSecret, setShareSecret] = useState<string | null>(null);
  const [shareProtectWithCode, setShareProtectWithCode] = useState(true);
  const [customSharePasscode, setCustomSharePasscode] = useState('');
  const [absoluteShareUrl, setAbsoluteShareUrl] = useState<string | null>(null);
  const finalization = storyBook?.storybookFinalization ?? null;

  useEffect(() => {
    setShareSecret(null);
    setAbsoluteShareUrl(formatShareUrl(finalization?.shareLink ?? null));
  }, [finalization?.shareLink]);

  // Pages that don't require images (title_page and blank pages without imagePrompt)
  const pagesRequiringImages = pages?.filter((page) =>
    page.kind !== 'title_page' && page.kind !== 'blank' && page.imagePrompt
  ) ?? [];
  const readyCount = pagesRequiringImages.filter((page) => page.imageStatus === 'ready').length;
  const errorCount = pagesRequiringImages.filter((page) => page.imageStatus === 'error').length;
  const totalPages = pagesRequiringImages.length;

  const documentImageStatus = storyBook?.imageGeneration?.status ?? 'idle';
  // Calculate true status from actual pages (ignoring the storybook document's cached status)
  const calculatedImageStatus = totalPages > 0 && readyCount === totalPages ? 'ready' :
                                 errorCount > 0 ? 'error' :
                                 documentImageStatus === 'running' ? 'running' : 'pending';

  const isLocked = storyBook?.isLocked ?? false;
  const allImagesReady = calculatedImageStatus === 'ready';
  // Degraded-book contract: live rollup from the pages themselves (the same
  // derivation the server persists as storybook.artStatus).
  const artStatus = useMemo(() => deriveStorybookArtStatus(pages ?? []), [pages]);
  const isDegraded = artStatus.completeness === 'degraded';
  const finalizationBadge = deriveFinalizationBadge(storyBook, readyCount, totalPages);
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
    ? 'This storybook is locked for printing and sharing.'
    : isDegraded
    ? `${artStatus.pagesReady} of ${artStatus.pagesTotal} illustrations are ready — ${artStatus.pagesFailed} didn't finish. You can still read and order this book.`
    : calculatedImageStatus === 'ready'
    ? 'Every page is illustrated.'
    : 'This storybook was made with an earlier version of StoryPic and can no longer be changed. Make a new book from the story instead.';

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
            {artStatus.isViewable && (
              <Button asChild variant="default" data-wiz-target="storybook-read">
                <Link href={`/storybook/${bookId}/read?storyId=${storyId}`}>
                  <BookOpen className="mr-2 h-4 w-4" />
                  Read Book
                </Link>
              </Button>
            )}
          </div>
        </CardHeader>
      </Card>

      {/* Stage 1 — clean-up: the book exactly as the child sees it + Edit */}
      {hasPages && (
        <Card className="mx-auto w-full max-w-4xl">
          <CardHeader className="pb-3">
            <CardTitle className="text-lg">The pages</CardTitle>
            <CardDescription>This is the book as your child sees it.</CardDescription>
          </CardHeader>
          <CardContent>
            <ParentBookView pages={pages!} actionsDisabled />
          </CardContent>
        </Card>
      )}

      {/* Stage 2 — print & share: a clearly subsequent step */}
      {hasPages && (
        <Card className="mx-auto w-full max-w-4xl">
          <CardHeader className="pb-3">
            <CardTitle className="text-lg">Print &amp; share</CardTitle>
            <CardDescription>Create the print layout and order a printed copy.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {isDegraded && (
              <Alert className="bg-amber-50 border-amber-200 text-amber-900 [&>svg]:text-amber-600">
                <AlertTriangle className="h-4 w-4" />
                <AlertTitle>{artStatus.pagesFailed} page{artStatus.pagesFailed === 1 ? ' has' : 's have'} no picture</AlertTitle>
                <AlertDescription>
                  You can still order this book — we&apos;ll ask you to confirm at checkout that
                  those pages will print without art.
                </AlertDescription>
              </Alert>
            )}
            {!artStatus.isOrderable && (
              <p className="text-sm text-muted-foreground">
                This storybook has no finished illustrations, so it cannot be printed.
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
