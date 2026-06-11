'use client';

import { useMemo, useState, useCallback, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useAppContext } from '@/hooks/use-app-context';
import { useUser } from '@/firebase/auth/use-user';
import { useFirestore } from '@/firebase';
import { doc, updateDoc, serverTimestamp, deleteField } from 'firebase/firestore';
import { useCollection } from '@/lib/firestore-hooks';
import { collection, query } from 'firebase/firestore';
import type { ImageStyle, PrintLayout } from '@/lib/types';
import { useParentGuard } from '@/hooks/use-parent-guard';
import { useToast } from '@/hooks/use-toast';
import {
  LoaderCircle,
  BookOpen,
  Volume2,
  Printer,
  RefreshCw,
  Eye,
  CheckCircle2,
  AlertCircle,
  Clock,
  ExternalLink,
  ShoppingCart,
  FileText,
  ArrowLeft,
  User,
  Sparkles,
} from 'lucide-react';
import Link from 'next/link';
import Image from 'next/image';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { format } from 'date-fns';
import { DeleteButton, UndoBanner, useDeleteWithUndo } from '@/components/shared/DeleteWithUndo';
import type {
  StorybookListItem,
  StorybooksResponse,
} from '@/app/api/parent/storybooks/route';

function formatFriendlyDate(date: Date): string {
  const day = date.getDate();
  const suffix =
    day === 1 || day === 21 || day === 31 ? 'st'
    : day === 2 || day === 22 ? 'nd'
    : day === 3 || day === 23 ? 'rd'
    : 'th';
  return `${day}${suffix} ${format(date, 'MMMM yyyy')}`;
}

type StorybookWithMeta = StorybookListItem & {
  createdAtDate: Date;
  thumbnailLoaded?: boolean;
  pagesWithAudio?: number;
  totalPages?: number;
};

function StatusBadge({ status }: { status?: string }) {
  if (!status) return null;
  const statusConfig: Record<string, { variant: 'default' | 'secondary' | 'destructive' | 'outline'; icon: React.ReactNode; label: string }> = {
    ready:   { variant: 'default',      icon: <CheckCircle2 className="h-3 w-3" />,                          label: 'Images Ready' },
    running: { variant: 'secondary',    icon: <LoaderCircle className="h-3 w-3 animate-spin" />,             label: 'Generating Art' },
    idle:    { variant: 'outline',      icon: <Clock className="h-3 w-3" />,                                 label: 'Pending Art' },
    error:   { variant: 'destructive',  icon: <AlertCircle className="h-3 w-3" />,                           label: 'Error' },
    pending: { variant: 'outline',      icon: <Clock className="h-3 w-3" />,                                 label: 'Pending Art' },
  };
  const config = statusConfig[status] || statusConfig.pending;
  return (
    <Badge variant={config.variant} className="flex items-center gap-1 text-xs">
      {config.icon}
      {config.label}
    </Badge>
  );
}

function AudioStatusBadge({ status, pagesWithAudio, totalPages }: { status?: string; pagesWithAudio?: number; totalPages?: number }) {
  if (status === 'ready') {
    return (
      <Badge variant="default" className="flex items-center gap-1 text-xs">
        <Volume2 className="h-3 w-3" />Audio Ready
      </Badge>
    );
  }
  if (status === 'partial' && pagesWithAudio !== undefined && totalPages !== undefined) {
    return (
      <Badge variant="secondary" className="flex items-center gap-1 text-xs">
        <Volume2 className="h-3 w-3" />{pagesWithAudio}/{totalPages} pages
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="flex items-center gap-1 text-xs">
      <Volume2 className="h-3 w-3" />No Audio
    </Badge>
  );
}

function StorybookCard({
  storybook,
  imageStyles,
  onRegenerateAudio,
  onGeneratePrintable,
  onDelete,
  isRegeneratingAudio,
  isGeneratingPrintable,
}: {
  storybook: StorybookWithMeta;
  imageStyles?: ImageStyle[];
  onRegenerateAudio: (storybook: StorybookWithMeta) => void;
  onGeneratePrintable: (storybook: StorybookWithMeta) => void;
  onDelete: (storybookId: string) => Promise<void>;
  isRegeneratingAudio: boolean;
  isGeneratingPrintable: boolean;
}) {
  const imageStyleTitle = imageStyles?.find((s) => s.id === storybook.imageStyleId)?.title || 'Custom';

  // Degraded-book contract (server-computed): partial-art books stay orderable.
  const isDegraded = storybook.artCompleteness === 'degraded';
  const canPrint =
    storybook.isNewModel &&
    (storybook.imageGenerationStatus === 'ready' || storybook.isOrderable === true);

  const viewUrl = storybook.isNewModel
    ? `/storybook/${storybook.storybookId}?storyId=${storybook.storyId}`
    : `/storybook/${storybook.storybookId}`;

  const readUrl = storybook.isNewModel
    ? `/storybook/${storybook.storybookId}/read?storyId=${storybook.storyId}`
    : `/storybook/${storybook.storybookId}/read`;

  return (
    <Card className="flex flex-col" data-wiz-target={`storybook-card-${storybook.storybookId}`}>
      <div className="aspect-video relative bg-gradient-to-br from-primary/20 to-primary/5 rounded-t-lg overflow-hidden">
        {storybook.thumbnailUrl ? (
          <Image src={storybook.thumbnailUrl} alt={storybook.title || 'Storybook'} fill className="object-cover" />
        ) : storybook.thumbnailLoaded === false ? (
          <div className="absolute inset-0 flex items-center justify-center">
            <LoaderCircle className="h-8 w-8 animate-spin text-primary/40" />
          </div>
        ) : (
          <div className="absolute inset-0 flex items-center justify-center">
            <BookOpen className="h-12 w-12 text-primary/40" />
          </div>
        )}
      </div>

      <CardHeader className="pb-2">
        <CardTitle className="text-base line-clamp-2">{storybook.title || 'Untitled Book'}</CardTitle>
        <CardDescription className="flex flex-wrap gap-1.5">
          <Badge variant="outline" className="text-xs">{imageStyleTitle}</Badge>
          {isDegraded ? (
            <Badge variant="secondary" className="flex items-center gap-1 text-xs bg-amber-100 text-amber-900 hover:bg-amber-100">
              <AlertCircle className="h-3 w-3" />
              {storybook.artPagesReady}/{storybook.artPagesTotal} pictures
            </Badge>
          ) : (
            <StatusBadge status={storybook.imageGenerationStatus} />
          )}
          <AudioStatusBadge status={storybook.audioStatus} pagesWithAudio={storybook.pagesWithAudio} totalPages={storybook.totalPages} />
        </CardDescription>
      </CardHeader>

      <CardContent className="pb-2 flex-grow">
        <p className="text-xs text-muted-foreground">Created {formatFriendlyDate(storybook.createdAtDate)}</p>
      </CardContent>

      <CardFooter className="flex flex-wrap gap-2">
        <Button asChild variant="outline" size="sm">
          <Link href={viewUrl}><Eye className="mr-1 h-3 w-3" />View</Link>
        </Button>
        <Button asChild variant="outline" size="sm">
          <Link href={readUrl}><BookOpen className="mr-1 h-3 w-3" />Read</Link>
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => onRegenerateAudio(storybook)}
          disabled={isRegeneratingAudio || storybook.imageGenerationStatus !== 'ready'}
        >
          {isRegeneratingAudio ? <LoaderCircle className="mr-1 h-3 w-3 animate-spin" /> : <Volume2 className="mr-1 h-3 w-3" />}
          Audio
        </Button>
        <Button
          variant={!canPrint && storybook.imageGenerationStatus === 'error' ? 'destructive' : 'outline'}
          size="sm"
          onClick={() => onGeneratePrintable(storybook)}
          disabled={isGeneratingPrintable || !canPrint}
          title={
            !storybook.isNewModel ? 'Legacy storybook - print not supported'
            : isDegraded ? 'Some pages have no pictures — you can still order, with confirmation'
            : !canPrint && storybook.imageGenerationStatus === 'error' ? 'Image generation failed - view book to retry'
            : !canPrint ? `Images: ${storybook.imageGenerationStatus || 'pending'}`
            : undefined
          }
        >
          {isGeneratingPrintable ? <LoaderCircle className="mr-1 h-3 w-3 animate-spin" />
            : !canPrint && storybook.imageGenerationStatus === 'error' ? <AlertCircle className="mr-1 h-3 w-3" />
            : <Printer className="mr-1 h-3 w-3" />}
          {!canPrint && storybook.imageGenerationStatus === 'error' ? 'Images Failed'
            : storybook.printablePdfUrl ? 'Print Options'
            : 'Print'}
        </Button>
        <DeleteButton
          item={{ id: storybook.storybookId, name: storybook.title || 'Untitled Book' }}
          itemType="storybook"
          onDelete={onDelete}
          buttonVariant="outline"
        />
      </CardFooter>
    </Card>
  );
}

export default function ChildStorybooksPage() {
  const params = useParams();
  const childId = params.childId as string;

  const { user, idTokenResult, loading: userLoading } = useUser();
  const firestore = useFirestore();
  const { isParentGuardValidated } = useParentGuard();
  const { toast } = useToast();
  const router = useRouter();
  const { setActiveChildId } = useAppContext();

  // Empty-state CTA: jump straight into this child's experience to start a
  // story (same flow as the "Who is playing?" home screen).
  const handleStartStory = useCallback(() => {
    setActiveChildId(childId);
    router.push(`/child/${childId}`);
  }, [setActiveChildId, router, childId]);

  const [childName, setChildName] = useState('');
  const [childAvatarUrl, setChildAvatarUrl] = useState<string | null>(null);
  const [storybooks, setStorybooks] = useState<StorybookWithMeta[]>([]);
  const [loading, setLoading] = useState(true);
  const [regeneratingAudioFor, setRegeneratingAudioFor] = useState<string | null>(null);
  const [generatingPrintableFor, setGeneratingPrintableFor] = useState<string | null>(null);
  const { deletedItem, markAsDeleted, clearDeletedItem } = useDeleteWithUndo();

  const [printResult, setPrintResult] = useState<{
    storybook: StorybookWithMeta;
    pdfUrl: string;
    coverPdfUrl?: string;
    interiorPdfUrl?: string;
  } | null>(null);
  const [isRegeneratingPdfs, setIsRegeneratingPdfs] = useState(false);
  const [selectedPrintLayoutId, setSelectedPrintLayoutId] = useState<string | null>(null);

  const [storybookMetaMap, setStorybookMetaMap] = useState<Map<string, StorybookWithMeta>>(new Map());

  const imageStylesQuery = useMemo(() => {
    if (!firestore || !user || userLoading || !idTokenResult) return null;
    return query(collection(firestore, 'imageStyles'));
  }, [firestore, user, userLoading, idTokenResult]);
  const { data: imageStyles } = useCollection<ImageStyle>(imageStylesQuery);

  const printLayoutsQuery = useMemo(() => {
    if (!firestore || !user || userLoading || !idTokenResult) return null;
    return query(collection(firestore, 'printLayouts'));
  }, [firestore, user, userLoading, idTokenResult]);
  const { data: printLayouts } = useCollection<PrintLayout>(printLayoutsQuery);

  // Apply thumbnail batch updates to flat storybooks array
  const applyThumbnailBatch = useCallback((thumbnails: any[]) => {
    setStorybooks((prev) =>
      prev.map((sb) => {
        const t = thumbnails.find((t: any) => t.storybookId === sb.storybookId);
        if (!t) return sb;
        return {
          ...sb,
          thumbnailUrl: t.thumbnailUrl || sb.thumbnailUrl,
          thumbnailLoaded: true,
          audioStatus: t.audioStatus || sb.audioStatus,
          pagesWithAudio: t.pagesWithAudio,
          totalPages: t.totalPages,
          imageGenerationStatus: t.calculatedImageStatus || sb.imageGenerationStatus,
        };
      })
    );
    setStorybookMetaMap((prev) => {
      const updated = new Map(prev);
      for (const t of thumbnails) {
        const existing = updated.get(t.storybookId);
        if (existing) {
          updated.set(t.storybookId, {
            ...existing,
            thumbnailUrl: t.thumbnailUrl || existing.thumbnailUrl,
            thumbnailLoaded: true,
            audioStatus: t.audioStatus || existing.audioStatus,
            pagesWithAudio: t.pagesWithAudio,
            totalPages: t.totalPages,
            imageGenerationStatus: t.calculatedImageStatus || existing.imageGenerationStatus,
          });
        }
      }
      return updated;
    });
  }, []);

  const fetchThumbnails = useCallback(
    async (
      storybooksToFetch: Array<{ storybookId: string; storyId: string; isNewModel: boolean }>,
      idToken: string
    ) => {
      const BATCH_SIZE = 50;
      for (let i = 0; i < storybooksToFetch.length; i += BATCH_SIZE) {
        const batch = storybooksToFetch.slice(i, i + BATCH_SIZE);
        try {
          const response = await fetch('/api/parent/storybooks/thumbnails', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
            body: JSON.stringify({ storybooks: batch }),
          });
          if (response.ok) {
            const data = await response.json();
            applyThumbnailBatch(data.thumbnails || []);
          }
        } catch (error) {
          console.error('[child-storybooks] Error fetching thumbnail batch:', error);
        }
      }
      // Mark any remaining as loaded
      setStorybooks((prev) => prev.map((sb) => ({ ...sb, thumbnailLoaded: sb.thumbnailLoaded ?? true })));
    },
    [applyThumbnailBatch]
  );

  const fetchStorybooks = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      const idToken = await user.getIdToken();
      // ?childId= triggers a single-doc child read + filters storybook subcollection
      // reads to only this child's stories — faster than loading all children/storybooks
      const response = await fetch(`/api/parent/storybooks?childId=${childId}`, {
        headers: { Authorization: `Bearer ${idToken}` },
      });

      if (response.status === 404) {
        setStorybooks([]);
        setLoading(false);
        return;
      }
      if (!response.ok) throw new Error('Failed to fetch storybooks');

      const data: StorybooksResponse = await response.json();
      const childData = data.children[0];

      if (childData) {
        setChildName(childData.displayName);
        setChildAvatarUrl(childData.avatarUrl ?? null);
      }

      const books: StorybookWithMeta[] = (childData?.storybooks ?? []).map((sb) => ({
        ...sb,
        createdAtDate: new Date(sb.createdAt),
        thumbnailLoaded: sb.thumbnailUrl ? true : false,
      }));

      const metaMap = new Map<string, StorybookWithMeta>();
      for (const sb of books) metaMap.set(sb.storybookId, sb);
      setStorybookMetaMap(metaMap);
      setStorybooks(books);

      // Storybooks without a cached thumbnail need a page subcollection fetch.
      // On repeat visits most books will already have thumbnailUrl on the doc,
      // so this secondary fetch is only triggered for genuinely new books.
      const needingThumbnails = books
        .filter((sb) => !sb.thumbnailUrl)
        .map(({ storybookId, storyId, isNewModel }) => ({ storybookId, storyId, isNewModel }));

      if (needingThumbnails.length > 0) {
        fetchThumbnails(needingThumbnails, idToken);
      }
    } catch (error) {
      console.error('[child-storybooks] Error fetching storybooks:', error);
      toast({ title: 'Error loading storybooks', description: 'Please try refreshing the page.', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  }, [user, childId, fetchThumbnails, toast]);

  useEffect(() => {
    if (!userLoading && user && idTokenResult) {
      fetchStorybooks();
    }
  }, [user, userLoading, idTokenResult, fetchStorybooks]);

  const handleRegenerateAudio = useCallback(async (storybook: StorybookWithMeta) => {
    if (!user) return;
    setRegeneratingAudioFor(storybook.storybookId);
    try {
      const idToken = await user.getIdToken();
      const response = await fetch('/api/storyBook/pageAudio', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
        body: JSON.stringify({
          storyId: storybook.storyId,
          ...(storybook.isNewModel && { storybookId: storybook.storybookId }),
          forceRegenerate: true,
        }),
      });
      const result = await response.json();
      if (!result.ok) {
        toast({ title: 'Audio generation failed', description: result.errorMessage || 'Please try again.', variant: 'destructive' });
      } else {
        toast({ title: 'Audio generation started', description: 'Audio is being generated in the background.' });
      }
    } catch {
      toast({ title: 'Audio generation failed', description: 'Please check your connection and try again.', variant: 'destructive' });
    } finally {
      setRegeneratingAudioFor(null);
    }
  }, [user, toast]);

  const handleGeneratePrintable = useCallback(async (storybook: StorybookWithMeta) => {
    if (!user) return;

    if (storybook.storyId === storybook.storybookId) {
      toast({ title: 'Print not available', description: 'This storybook format does not support print generation.', variant: 'destructive' });
      return;
    }

    if (storybook.printablePdfUrl) {
      setSelectedPrintLayoutId(null);
      setPrintResult({ storybook, pdfUrl: storybook.printablePdfUrl, coverPdfUrl: storybook.printableCoverPdfUrl || undefined, interiorPdfUrl: storybook.printableInteriorPdfUrl || undefined });
      return;
    }

    setGeneratingPrintableFor(storybook.storybookId);
    try {
      const idToken = await user.getIdToken();
      const response = await fetch('/api/storyBook/printable', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
        body: JSON.stringify({ storyId: storybook.storyId, storybookId: storybook.storybookId, printLayoutId: storybook.printLayoutId || 'mixam-8x10-hardcover' }),
      });
      const result = await response.json();
      if (!result.ok) {
        toast({ title: 'Print generation failed', description: result.errorMessage || 'Please try again.', variant: 'destructive' });
      } else {
        toast({ title: 'Print PDF generated', description: 'Your printable book is ready for review.' });
        if (result.printablePdfUrl) {
          setStorybooks((prev) =>
            prev.map((sb) =>
              sb.storybookId === storybook.storybookId
                ? { ...sb, printablePdfUrl: result.printablePdfUrl, printableCoverPdfUrl: result.coverPdfUrl }
                : sb
            )
          );
          setSelectedPrintLayoutId(null);
          setPrintResult({ storybook: { ...storybook, printablePdfUrl: result.printablePdfUrl, printableCoverPdfUrl: result.coverPdfUrl, printableInteriorPdfUrl: result.interiorPdfUrl }, pdfUrl: result.printablePdfUrl, coverPdfUrl: result.coverPdfUrl, interiorPdfUrl: result.interiorPdfUrl });
        }
      }
    } catch {
      toast({ title: 'Print generation failed', description: 'Please check your connection and try again.', variant: 'destructive' });
    } finally {
      setGeneratingPrintableFor(null);
    }
  }, [user, toast]);

  const handleRegeneratePdfs = useCallback(async () => {
    if (!user || !printResult) return;
    const storybook = printResult.storybook;
    setIsRegeneratingPdfs(true);
    const layoutId = selectedPrintLayoutId || storybook.printLayoutId || 'mixam-8x10-hardcover';
    try {
      const idToken = await user.getIdToken();
      const response = await fetch('/api/storyBook/printable', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
        body: JSON.stringify({ storyId: storybook.storyId, storybookId: storybook.storybookId, printLayoutId: layoutId, forceRegenerate: true }),
      });
      const result = await response.json();
      if (!result.ok) {
        toast({ title: 'PDF regeneration failed', description: result.errorMessage || 'Please try again.', variant: 'destructive' });
      } else {
        toast({ title: 'PDFs regenerated', description: 'Your printable book has been updated.' });
        if (result.printablePdfUrl) {
          setStorybooks((prev) =>
            prev.map((sb) =>
              sb.storybookId === storybook.storybookId
                ? { ...sb, printablePdfUrl: result.printablePdfUrl, printableCoverPdfUrl: result.coverPdfUrl, printableInteriorPdfUrl: result.interiorPdfUrl }
                : sb
            )
          );
          setPrintResult({ storybook: { ...storybook, printablePdfUrl: result.printablePdfUrl, printableCoverPdfUrl: result.coverPdfUrl, printableInteriorPdfUrl: result.interiorPdfUrl }, pdfUrl: result.printablePdfUrl, coverPdfUrl: result.coverPdfUrl, interiorPdfUrl: result.interiorPdfUrl });
        }
      }
    } catch (error: any) {
      toast({ title: 'PDF regeneration failed', description: error?.message || 'Please check your connection.', variant: 'destructive' });
    } finally {
      setIsRegeneratingPdfs(false);
    }
  }, [user, toast, printResult, selectedPrintLayoutId]);

  const handleDeleteStorybook = useCallback(async (storybookId: string) => {
    if (!firestore || !user) return;
    const storybook = storybookMetaMap.get(storybookId);
    if (!storybook) return;

    const docPath = storybook.isNewModel
      ? `stories/${storybook.storyId}/storybooks/${storybookId}`
      : `stories/${storybook.storyId}`;

    await updateDoc(doc(firestore, docPath), {
      deletedAt: serverTimestamp(),
      deletedBy: user.uid,
      updatedAt: serverTimestamp(),
    });

    setStorybooks((prev) => prev.filter((sb) => sb.storybookId !== storybookId));
    markAsDeleted({ id: storybookId, name: storybook.title || 'Untitled Book', type: 'storybook' });
    toast({ title: 'Storybook deleted', description: `${storybook.title || 'Storybook'} has been removed.` });
  }, [firestore, user, storybookMetaMap, markAsDeleted, toast]);

  const handleUndoDelete = useCallback(async (storybookId: string) => {
    if (!firestore) return;
    const storybook = storybookMetaMap.get(storybookId);
    if (!storybook) return;

    const docPath = storybook.isNewModel
      ? `stories/${storybook.storyId}/storybooks/${storybookId}`
      : `stories/${storybook.storyId}`;

    await updateDoc(doc(firestore, docPath), {
      deletedAt: deleteField(),
      deletedBy: deleteField(),
      updatedAt: serverTimestamp(),
    });

    setStorybooks((prev) =>
      [...prev, storybook].sort((a, b) => b.createdAtDate.getTime() - a.createdAtDate.getTime())
    );
    toast({ title: 'Undo successful', description: 'The storybook has been restored.' });
  }, [firestore, storybookMetaMap, toast]);

  if (!isParentGuardValidated) return null;

  const isLoadingPage = userLoading || loading;

  return (
    <div className="container mx-auto p-4 sm:p-6 md:p-8 space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="sm" asChild>
          <Link href="/parent/storybooks">
            <ArrowLeft className="mr-1 h-4 w-4" />
            All Children
          </Link>
        </Button>
      </div>

      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          {(childName || childAvatarUrl) && (
            <Avatar className="h-12 w-12">
              <AvatarImage src={childAvatarUrl || undefined} alt={childName} />
              <AvatarFallback>
                {childName?.charAt(0).toUpperCase() || <User className="h-6 w-6" />}
              </AvatarFallback>
            </Avatar>
          )}
          <div>
            <h1 className="text-3xl font-bold">{childName || 'Storybooks'}</h1>
            <p className="text-muted-foreground">
              {isLoadingPage ? 'Loading...' : `${storybooks.length} ${storybooks.length === 1 ? 'book' : 'books'}`}
            </p>
          </div>
        </div>
        <Button variant="outline" onClick={fetchStorybooks} disabled={isLoadingPage} data-wiz-target="storybooks-refresh">
          <RefreshCw className={`mr-2 h-4 w-4 ${isLoadingPage ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
      </div>

      {/* Content */}
      {isLoadingPage ? (
        <div className="flex items-center justify-center py-16">
          <LoaderCircle className="h-8 w-8 animate-spin text-primary" />
        </div>
      ) : storybooks.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12 gap-4">
            <BookOpen className="h-12 w-12 text-muted-foreground" />
            <div className="text-center max-w-md">
              <p className="font-medium">No completed storybooks yet</p>
              <p className="text-muted-foreground">
                Make up a story with {childName || 'this child'}, pick an art style, and the
                finished book will appear here.
              </p>
            </div>
            <Button onClick={handleStartStory}>
              <Sparkles className="mr-2 h-4 w-4" />
              Start a story{childName ? ` with ${childName}` : ''}
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {storybooks.map((sb) => (
            <StorybookCard
              key={`${sb.storyId}-${sb.storybookId}`}
              storybook={sb}
              imageStyles={imageStyles ?? undefined}
              onRegenerateAudio={handleRegenerateAudio}
              onGeneratePrintable={handleGeneratePrintable}
              onDelete={handleDeleteStorybook}
              isRegeneratingAudio={regeneratingAudioFor === sb.storybookId}
              isGeneratingPrintable={generatingPrintableFor === sb.storybookId}
            />
          ))}
        </div>
      )}

      <UndoBanner deletedItem={deletedItem} onUndo={handleUndoDelete} onDismiss={clearDeletedItem} />

      {/* Print Options Dialog */}
      <Dialog open={!!printResult} onOpenChange={(open) => !open && setPrintResult(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Printer className="h-5 w-5 text-primary" />
              Print Options
            </DialogTitle>
            <DialogDescription>
              &ldquo;{printResult?.storybook.title || 'Untitled Book'}&rdquo; — View, regenerate, or order your print-ready PDFs.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <h4 className="text-sm font-medium">Generated PDFs</h4>
              <div className="space-y-2">
                {printResult?.coverPdfUrl && (
                  <Button variant="outline" className="w-full justify-start" onClick={() => window.open(printResult.coverPdfUrl, '_blank')}>
                    <FileText className="mr-2 h-4 w-4" />Cover PDF (Front + Back)<ExternalLink className="ml-auto h-4 w-4 text-muted-foreground" />
                  </Button>
                )}
                {printResult?.interiorPdfUrl && (
                  <Button variant="outline" className="w-full justify-start" onClick={() => window.open(printResult.interiorPdfUrl, '_blank')}>
                    <FileText className="mr-2 h-4 w-4" />Interior Pages PDF<ExternalLink className="ml-auto h-4 w-4 text-muted-foreground" />
                  </Button>
                )}
                <Button variant="outline" className="w-full justify-start" onClick={() => printResult?.pdfUrl && window.open(printResult.pdfUrl, '_blank')}>
                  <FileText className="mr-2 h-4 w-4" />Combined PDF (All Pages)<ExternalLink className="ml-auto h-4 w-4 text-muted-foreground" />
                </Button>
              </div>
            </div>

            <div className="space-y-2">
              <h4 className="text-sm font-medium">Print Layout</h4>
              <Select
                value={selectedPrintLayoutId || '__default__'}
                onValueChange={(value) => setSelectedPrintLayoutId(value === '__default__' ? null : value)}
              >
                <SelectTrigger>
                  <SelectValue>
                    {selectedPrintLayoutId === null ? (
                      <span>
                        {printLayouts?.find((l) => l.id === printResult?.storybook.printLayoutId)?.name || 'Default Layout'}
                        <span className="text-muted-foreground ml-1">(default)</span>
                      </span>
                    ) : (
                      printLayouts?.find((l) => l.id === selectedPrintLayoutId)?.name || selectedPrintLayoutId
                    )}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__default__">
                    {printLayouts?.find((l) => l.id === printResult?.storybook.printLayoutId)?.name || 'Default Layout'}
                    <span className="text-muted-foreground ml-1">(default)</span>
                  </SelectItem>
                  {printLayouts?.filter((l) => l.id !== printResult?.storybook.printLayoutId).map((layout) => (
                    <SelectItem key={layout.id} value={layout.id}>
                      {layout.name}
                      <span className="text-muted-foreground ml-1">({layout.leafWidth}&quot; × {layout.leafHeight}&quot;)</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">Select a different layout to regenerate PDFs with different dimensions.</p>
            </div>

            <div className="space-y-2">
              <h4 className="text-sm font-medium">Actions</h4>
              <Button variant="outline" className="w-full justify-start" onClick={handleRegeneratePdfs} disabled={isRegeneratingPdfs}>
                {isRegeneratingPdfs ? <LoaderCircle className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
                {isRegeneratingPdfs ? 'Regenerating...' : 'Regenerate PDFs'}
              </Button>
            </div>

            <div className="rounded-lg bg-muted p-3 text-sm">
              <p className="font-medium mb-1">Next Steps</p>
              <ol className="list-decimal list-inside space-y-1 text-muted-foreground">
                <li>Review the PDF files above</li>
                <li>Proceed to order to select print options</li>
                <li>Complete your order with Mixam</li>
              </ol>
            </div>
          </div>

          <DialogFooter className="flex-col sm:flex-row gap-2">
            <Button variant="outline" onClick={() => setPrintResult(null)}>Close</Button>
            <Button asChild>
              <Link href={`/storybook/${printResult?.storybook.storyId}/order?storybookId=${printResult?.storybook.storybookId}`}>
                <ShoppingCart className="mr-2 h-4 w-4" />Proceed to Order
              </Link>
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
