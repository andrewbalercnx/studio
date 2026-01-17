'use client';

import { useMemo, useState, useCallback, useEffect } from 'react';
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
  ChevronDown,
  ChevronRight,
  User,
  CheckCircle2,
  AlertCircle,
  Clock,
  ExternalLink,
  ShoppingCart,
  FileText,
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
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
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
  ChildWithStorybooks as APIChildWithStorybooks,
  StorybooksResponse,
} from '@/app/api/parent/storybooks/route';

/**
 * Format a date in a friendly format like "12th December 2025"
 */
function formatFriendlyDate(date: Date): string {
  const day = date.getDate();
  const suffix = (day === 1 || day === 21 || day === 31) ? 'st'
    : (day === 2 || day === 22) ? 'nd'
    : (day === 3 || day === 23) ? 'rd'
    : 'th';
  return `${day}${suffix} ${format(date, 'MMMM yyyy')}`;
}

// Extended type for client-side with loaded thumbnails
type StorybookWithMeta = StorybookListItem & {
  // Client-side computed fields
  createdAtDate: Date;
  thumbnailLoaded?: boolean;
  pagesWithAudio?: number;
  totalPages?: number;
};

type ChildWithStorybooks = {
  childId: string;
  displayName: string;
  avatarUrl?: string | null;
  storybooks: StorybookWithMeta[];
};

function StatusBadge({ status }: { status?: string }) {
  if (!status) return null;

  const statusConfig: Record<string, { variant: 'default' | 'secondary' | 'destructive' | 'outline'; icon: React.ReactNode; label: string }> = {
    ready: { variant: 'default', icon: <CheckCircle2 className="h-3 w-3" />, label: 'Images Ready' },
    running: { variant: 'secondary', icon: <LoaderCircle className="h-3 w-3 animate-spin" />, label: 'Generating Art' },
    idle: { variant: 'outline', icon: <Clock className="h-3 w-3" />, label: 'Pending Art' },
    error: { variant: 'destructive', icon: <AlertCircle className="h-3 w-3" />, label: 'Error' },
    pending: { variant: 'outline', icon: <Clock className="h-3 w-3" />, label: 'Pending Art' },
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
        <Volume2 className="h-3 w-3" />
        Audio Ready
      </Badge>
    );
  }
  if (status === 'partial' && pagesWithAudio !== undefined && totalPages !== undefined) {
    return (
      <Badge variant="secondary" className="flex items-center gap-1 text-xs">
        <Volume2 className="h-3 w-3" />
        {pagesWithAudio}/{totalPages} pages
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="flex items-center gap-1 text-xs">
      <Volume2 className="h-3 w-3" />
      No Audio
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

  const viewUrl = storybook.isNewModel
    ? `/storybook/${storybook.storybookId}?storyId=${storybook.storyId}`
    : `/storybook/${storybook.storybookId}`;

  const readUrl = storybook.isNewModel
    ? `/storybook/${storybook.storybookId}/read?storyId=${storybook.storyId}`
    : `/storybook/${storybook.storybookId}/read`;

  return (
    <Card className="flex flex-col" data-wiz-target={`storybook-card-${storybook.storybookId}`}>
      {/* Thumbnail */}
      <div className="aspect-video relative bg-gradient-to-br from-primary/20 to-primary/5 rounded-t-lg overflow-hidden">
        {storybook.thumbnailUrl ? (
          <Image
            src={storybook.thumbnailUrl}
            alt={storybook.title || 'Storybook'}
            fill
            className="object-cover"
          />
        ) : storybook.thumbnailLoaded === false ? (
          // Thumbnail is loading
          <div className="absolute inset-0 flex items-center justify-center">
            <LoaderCircle className="h-8 w-8 animate-spin text-primary/40" />
          </div>
        ) : (
          // No thumbnail available or not yet loaded
          <div className="absolute inset-0 flex items-center justify-center">
            <BookOpen className="h-12 w-12 text-primary/40" />
          </div>
        )}
      </div>

      <CardHeader className="pb-2">
        <CardTitle className="text-base line-clamp-2">
          {storybook.title || 'Untitled Book'}
        </CardTitle>
        <CardDescription className="flex flex-wrap gap-1.5">
          <Badge variant="outline" className="text-xs">
            {imageStyleTitle}
          </Badge>
          <StatusBadge status={storybook.imageGenerationStatus} />
          <AudioStatusBadge
            status={storybook.audioStatus}
            pagesWithAudio={storybook.pagesWithAudio}
            totalPages={storybook.totalPages}
          />
        </CardDescription>
      </CardHeader>

      <CardContent className="pb-2 flex-grow">
        <p className="text-xs text-muted-foreground">
          Created {formatFriendlyDate(storybook.createdAtDate)}
        </p>
      </CardContent>

      <CardFooter className="flex flex-wrap gap-2">
        <Button asChild variant="outline" size="sm">
          <Link href={viewUrl}>
            <Eye className="mr-1 h-3 w-3" />
            View
          </Link>
        </Button>
        <Button asChild variant="outline" size="sm">
          <Link href={readUrl}>
            <BookOpen className="mr-1 h-3 w-3" />
            Read
          </Link>
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => onRegenerateAudio(storybook)}
          disabled={isRegeneratingAudio || storybook.imageGenerationStatus !== 'ready'}
        >
          {isRegeneratingAudio ? (
            <LoaderCircle className="mr-1 h-3 w-3 animate-spin" />
          ) : (
            <Volume2 className="mr-1 h-3 w-3" />
          )}
          Audio
        </Button>
        {/* Print button - always show for new model, show disabled state for legacy */}
        <Button
          variant={storybook.imageGenerationStatus === 'error' ? 'destructive' : 'outline'}
          size="sm"
          onClick={() => onGeneratePrintable(storybook)}
          disabled={!storybook.isNewModel || isGeneratingPrintable || storybook.imageGenerationStatus !== 'ready'}
          title={
            !storybook.isNewModel
              ? 'Legacy storybook - print not supported'
              : storybook.imageGenerationStatus === 'error'
                ? 'Image generation failed - view book to retry'
                : storybook.imageGenerationStatus !== 'ready'
                  ? `Images: ${storybook.imageGenerationStatus || 'pending'}`
                  : undefined
          }
        >
          {isGeneratingPrintable ? (
            <LoaderCircle className="mr-1 h-3 w-3 animate-spin" />
          ) : storybook.imageGenerationStatus === 'error' ? (
            <AlertCircle className="mr-1 h-3 w-3" />
          ) : (
            <Printer className="mr-1 h-3 w-3" />
          )}
          {storybook.imageGenerationStatus === 'error'
            ? 'Images Failed'
            : storybook.printablePdfUrl
              ? 'Print Options'
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

function ChildStorybooksSection({
  childWithStorybooks,
  imageStyles,
  onRegenerateAudio,
  onGeneratePrintable,
  onDeleteStorybook,
  regeneratingAudioFor,
  generatingPrintableFor,
}: {
  childWithStorybooks: ChildWithStorybooks;
  imageStyles?: ImageStyle[];
  onRegenerateAudio: (storybook: StorybookWithMeta) => void;
  onGeneratePrintable: (storybook: StorybookWithMeta) => void;
  onDeleteStorybook: (storybookId: string) => Promise<void>;
  regeneratingAudioFor: string | null;
  generatingPrintableFor: string | null;
}) {
  const [isOpen, setIsOpen] = useState(true);
  const { storybooks, displayName, avatarUrl } = childWithStorybooks;

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <CollapsibleTrigger asChild>
        <Button variant="ghost" className="w-full justify-start gap-3 p-3 h-auto">
          <Avatar className="h-10 w-10">
            <AvatarImage src={avatarUrl || undefined} alt={displayName} />
            <AvatarFallback>
              {displayName?.charAt(0) || <User className="h-5 w-5" />}
            </AvatarFallback>
          </Avatar>
          <div className="flex-grow text-left">
            <p className="font-semibold">{displayName}</p>
            <p className="text-sm text-muted-foreground">
              {storybooks.length} {storybooks.length === 1 ? 'book' : 'books'}
            </p>
          </div>
          {isOpen ? (
            <ChevronDown className="h-5 w-5 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-5 w-5 text-muted-foreground" />
          )}
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        {storybooks.length === 0 ? (
          <div className="py-6 text-center text-muted-foreground">
            <BookOpen className="h-8 w-8 mx-auto mb-2 opacity-50" />
            <p>No completed storybooks yet</p>
          </div>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3 p-4">
            {storybooks.map((sb) => (
              <StorybookCard
                key={`${sb.storyId}-${sb.storybookId}`}
                storybook={sb}
                imageStyles={imageStyles}
                onRegenerateAudio={onRegenerateAudio}
                onGeneratePrintable={onGeneratePrintable}
                onDelete={onDeleteStorybook}
                isRegeneratingAudio={regeneratingAudioFor === sb.storybookId}
                isGeneratingPrintable={generatingPrintableFor === sb.storybookId}
              />
            ))}
          </div>
        )}
      </CollapsibleContent>
    </Collapsible>
  );
}

export default function ParentStorybooksPage() {
  const { user, idTokenResult, loading: userLoading } = useUser();
  const firestore = useFirestore();
  const { isParentGuardValidated } = useParentGuard();
  const { toast } = useToast();

  const [childrenWithStorybooks, setChildrenWithStorybooks] = useState<ChildWithStorybooks[]>([]);
  const [loading, setLoading] = useState(true);
  const [thumbnailsLoading, setThumbnailsLoading] = useState(false);
  const [regeneratingAudioFor, setRegeneratingAudioFor] = useState<string | null>(null);
  const [generatingPrintableFor, setGeneratingPrintableFor] = useState<string | null>(null);
  const { deletedItem, markAsDeleted, clearDeletedItem } = useDeleteWithUndo();

  // Print result dialog state
  const [printResult, setPrintResult] = useState<{
    storybook: StorybookWithMeta;
    pdfUrl: string;
    coverPdfUrl?: string;
    interiorPdfUrl?: string;
  } | null>(null);
  const [isRegeneratingPdfs, setIsRegeneratingPdfs] = useState(false);
  // Selected print layout for regeneration (null = use storybook's default)
  const [selectedPrintLayoutId, setSelectedPrintLayoutId] = useState<string | null>(null);

  // Track storybook metadata for delete/undo
  const [storybookMetaMap, setStorybookMetaMap] = useState<Map<string, StorybookWithMeta>>(new Map());

  // Query image styles for display
  const imageStylesQuery = useMemo(() => {
    if (!firestore || !user || userLoading || !idTokenResult) return null;
    return query(collection(firestore, 'imageStyles'));
  }, [firestore, user, userLoading, idTokenResult]);
  const { data: imageStyles } = useCollection<ImageStyle>(imageStylesQuery);

  // Query print layouts for the print options dialog
  const printLayoutsQuery = useMemo(() => {
    if (!firestore || !user || userLoading || !idTokenResult) return null;
    return query(collection(firestore, 'printLayouts'));
  }, [firestore, user, userLoading, idTokenResult]);
  const { data: printLayouts } = useCollection<PrintLayout>(printLayoutsQuery);

  // Fetch storybooks from API
  const fetchStorybooks = useCallback(async () => {
    if (!user) return;

    setLoading(true);
    try {
      const idToken = await user.getIdToken();
      const response = await fetch('/api/parent/storybooks', {
        headers: {
          Authorization: `Bearer ${idToken}`,
        },
      });

      if (!response.ok) {
        throw new Error('Failed to fetch storybooks');
      }

      const data: StorybooksResponse = await response.json();

      // Convert API response to client format
      const children: ChildWithStorybooks[] = data.children.map((child) => ({
        childId: child.childId,
        displayName: child.displayName,
        avatarUrl: child.avatarUrl,
        storybooks: child.storybooks.map((sb) => ({
          ...sb,
          createdAtDate: new Date(sb.createdAt),
          thumbnailLoaded: sb.thumbnailUrl ? true : false, // Mark as loaded if we have it
        })),
      }));

      // Build metadata map for delete/undo operations
      const metaMap = new Map<string, StorybookWithMeta>();
      for (const child of children) {
        for (const sb of child.storybooks) {
          metaMap.set(sb.storybookId, sb);
        }
      }
      setStorybookMetaMap(metaMap);
      setChildrenWithStorybooks(children);

      // Fetch thumbnails for storybooks that don't have them
      const storybooksNeedingThumbnails = children.flatMap((child) =>
        child.storybooks
          .filter((sb) => !sb.thumbnailUrl)
          .map((sb) => ({
            storybookId: sb.storybookId,
            storyId: sb.storyId,
            isNewModel: sb.isNewModel,
          }))
      );

      if (storybooksNeedingThumbnails.length > 0) {
        console.log('[storybooks] Fetching thumbnails for', storybooksNeedingThumbnails.length, 'storybooks:', storybooksNeedingThumbnails.map(s => s.storybookId));
        setThumbnailsLoading(true);
        fetchThumbnails(storybooksNeedingThumbnails, idToken);
      } else {
        console.log('[storybooks] All storybooks have thumbnails, no fetch needed');
      }
    } catch (error) {
      console.error('Error fetching storybooks:', error);
      toast({
        title: 'Error loading storybooks',
        description: 'Please try refreshing the page.',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  }, [user, toast]);

  // Fetch thumbnails in batches
  const fetchThumbnails = useCallback(
    async (
      storybooks: Array<{ storybookId: string; storyId: string; isNewModel: boolean }>,
      idToken: string
    ) => {
      try {
        const response = await fetch('/api/parent/storybooks/thumbnails', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${idToken}`,
          },
          body: JSON.stringify({ storybooks }),
        });

        if (!response.ok) {
          throw new Error('Failed to fetch thumbnails');
        }

        const data = await response.json();
        console.log('[storybooks] Received thumbnails:', data.thumbnails?.map((t: any) => ({ id: t.storybookId, url: t.thumbnailUrl ? 'found' : 'null' })));

        // Update storybooks with thumbnail data
        setChildrenWithStorybooks((prev) =>
          prev.map((child) => ({
            ...child,
            storybooks: child.storybooks.map((sb) => {
              const thumbnail = data.thumbnails.find(
                (t: any) => t.storybookId === sb.storybookId
              );
              if (thumbnail) {
                return {
                  ...sb,
                  thumbnailUrl: thumbnail.thumbnailUrl || sb.thumbnailUrl,
                  thumbnailLoaded: true,
                  audioStatus: thumbnail.audioStatus || sb.audioStatus,
                  pagesWithAudio: thumbnail.pagesWithAudio,
                  totalPages: thumbnail.totalPages,
                  imageGenerationStatus: thumbnail.calculatedImageStatus || sb.imageGenerationStatus,
                };
              }
              return { ...sb, thumbnailLoaded: true };
            }),
          }))
        );

        // Also update the metadata map
        setStorybookMetaMap((prev) => {
          const updated = new Map(prev);
          for (const thumbnail of data.thumbnails) {
            const existing = updated.get(thumbnail.storybookId);
            if (existing) {
              updated.set(thumbnail.storybookId, {
                ...existing,
                thumbnailUrl: thumbnail.thumbnailUrl || existing.thumbnailUrl,
                thumbnailLoaded: true,
                audioStatus: thumbnail.audioStatus || existing.audioStatus,
                pagesWithAudio: thumbnail.pagesWithAudio,
                totalPages: thumbnail.totalPages,
                imageGenerationStatus: thumbnail.calculatedImageStatus || existing.imageGenerationStatus,
              });
            }
          }
          return updated;
        });
      } catch (error) {
        console.error('Error fetching thumbnails:', error);
        // Mark all as loaded even on error to stop loading state
        setChildrenWithStorybooks((prev) =>
          prev.map((child) => ({
            ...child,
            storybooks: child.storybooks.map((sb) => ({ ...sb, thumbnailLoaded: true })),
          }))
        );
      } finally {
        setThumbnailsLoading(false);
      }
    },
    []
  );

  // Load storybooks on mount
  useEffect(() => {
    if (!userLoading && user && idTokenResult) {
      fetchStorybooks();
    }
  }, [user, userLoading, idTokenResult, fetchStorybooks]);

  // Handle regenerate audio
  const handleRegenerateAudio = useCallback(
    async (storybook: StorybookWithMeta) => {
      if (!user) return;

      setRegeneratingAudioFor(storybook.storybookId);
      try {
        const idToken = await user.getIdToken();
        const response = await fetch('/api/storyBook/pageAudio', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${idToken}`,
          },
          body: JSON.stringify({
            storyId: storybook.storyId,
            ...(storybook.isNewModel && { storybookId: storybook.storybookId }),
            forceRegenerate: true,
          }),
        });

        const result = await response.json();
        if (!result.ok) {
          toast({
            title: 'Audio generation failed',
            description: result.errorMessage || 'Please try again.',
            variant: 'destructive',
          });
        } else {
          toast({
            title: 'Audio generation started',
            description: 'Audio is being generated in the background. Check back in a few minutes.',
          });
        }
      } catch {
        toast({
          title: 'Audio generation failed',
          description: 'Please check your connection and try again.',
          variant: 'destructive',
        });
      } finally {
        setRegeneratingAudioFor(null);
      }
    },
    [user, toast]
  );

  // Handle generate printable or show print options panel
  const handleGeneratePrintable = useCallback(
    async (storybook: StorybookWithMeta) => {
      if (!user) return;

      // Safety check: new-model storybooks must have distinct storyId and storybookId
      if (storybook.storyId === storybook.storybookId) {
        console.error('[storybooks] Cannot generate print for storybook with matching IDs:', {
          storyId: storybook.storyId,
          storybookId: storybook.storybookId,
          isNewModel: storybook.isNewModel,
        });
        toast({
          title: 'Print not available',
          description: 'This storybook format does not support print generation.',
          variant: 'destructive',
        });
        return;
      }

      // If PDFs already exist, show the print options panel directly
      if (storybook.printablePdfUrl) {
        setSelectedPrintLayoutId(null); // Reset to default when opening dialog
        setPrintResult({
          storybook,
          pdfUrl: storybook.printablePdfUrl,
          coverPdfUrl: storybook.printableCoverPdfUrl || undefined,
          interiorPdfUrl: storybook.printableInteriorPdfUrl || undefined,
        });
        return;
      }

      setGeneratingPrintableFor(storybook.storybookId);
      try {
        const idToken = await user.getIdToken();

        // Use the print layout stored on the storybook (derived from child's default at creation time)
        // Fall back to mixam-8x10-hardcover if not set
        const response = await fetch('/api/storyBook/printable', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${idToken}`,
          },
          body: JSON.stringify({
            storyId: storybook.storyId,
            storybookId: storybook.storybookId, // New model path: stories/{storyId}/storybooks/{storybookId}
            printLayoutId: storybook.printLayoutId || 'mixam-8x10-hardcover',
          }),
        });

        const result = await response.json();
        if (!result.ok) {
          toast({
            title: 'Print generation failed',
            description: result.errorMessage || 'Please try again.',
            variant: 'destructive',
          });
        } else {
          toast({
            title: 'Print PDF generated',
            description: 'Your printable book is ready for review.',
          });
          // Update local state to show the PDF link instead of Print button
          if (result.printablePdfUrl) {
            setChildrenWithStorybooks((prev) =>
              prev.map((cws) => ({
                ...cws,
                storybooks: cws.storybooks.map((sb) =>
                  sb.storybookId === storybook.storybookId
                    ? {
                        ...sb,
                        printablePdfUrl: result.printablePdfUrl,
                        printableCoverPdfUrl: result.coverPdfUrl,
                      }
                    : sb
                ),
              }))
            );
            // Also update the metadata map
            setStorybookMetaMap((prev) => {
              const updated = new Map(prev);
              const existing = updated.get(storybook.storybookId);
              if (existing) {
                updated.set(storybook.storybookId, {
                  ...existing,
                  printablePdfUrl: result.printablePdfUrl,
                  printableCoverPdfUrl: result.coverPdfUrl,
                });
              }
              return updated;
            });
            // Show the print result dialog for next steps
            setSelectedPrintLayoutId(null); // Reset to default when opening dialog
            setPrintResult({
              storybook: {
                ...storybook,
                printablePdfUrl: result.printablePdfUrl,
                printableCoverPdfUrl: result.coverPdfUrl,
                printableInteriorPdfUrl: result.interiorPdfUrl,
              },
              pdfUrl: result.printablePdfUrl,
              coverPdfUrl: result.coverPdfUrl,
              interiorPdfUrl: result.interiorPdfUrl,
            });
          }
        }
      } catch {
        toast({
          title: 'Print generation failed',
          description: 'Please check your connection and try again.',
          variant: 'destructive',
        });
      } finally {
        setGeneratingPrintableFor(null);
      }
    },
    [user, toast]
  );

  // Handle regenerate PDFs from the print options dialog
  const handleRegeneratePdfs = useCallback(
    async () => {
      if (!user || !printResult) return;

      const storybook = printResult.storybook;
      setIsRegeneratingPdfs(true);

      // Use selected layout if set, otherwise fall back to storybook's default
      const layoutId = selectedPrintLayoutId || storybook.printLayoutId || 'mixam-8x10-hardcover';

      try {
        const idToken = await user.getIdToken();
        const response = await fetch('/api/storyBook/printable', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${idToken}`,
          },
          body: JSON.stringify({
            storyId: storybook.storyId,
            storybookId: storybook.storybookId,
            printLayoutId: layoutId,
            forceRegenerate: true,
          }),
        });

        const result = await response.json();
        if (!result.ok) {
          const errorMsg = result.errorMessage || 'Please try again.';
          console.error('[storybooks] PDF regeneration failed:', errorMsg, result);
          toast({
            title: 'PDF regeneration failed',
            description: errorMsg,
            variant: 'destructive',
          });
        } else {
          toast({
            title: 'PDFs regenerated',
            description: 'Your printable book has been updated.',
          });
          // Update local state
          if (result.printablePdfUrl) {
            setChildrenWithStorybooks((prev) =>
              prev.map((cws) => ({
                ...cws,
                storybooks: cws.storybooks.map((sb) =>
                  sb.storybookId === storybook.storybookId
                    ? {
                        ...sb,
                        printablePdfUrl: result.printablePdfUrl,
                        printableCoverPdfUrl: result.coverPdfUrl,
                        printableInteriorPdfUrl: result.interiorPdfUrl,
                      }
                    : sb
                ),
              }))
            );
            // Update dialog state
            setPrintResult({
              storybook: {
                ...storybook,
                printablePdfUrl: result.printablePdfUrl,
                printableCoverPdfUrl: result.coverPdfUrl,
                printableInteriorPdfUrl: result.interiorPdfUrl,
              },
              pdfUrl: result.printablePdfUrl,
              coverPdfUrl: result.coverPdfUrl,
              interiorPdfUrl: result.interiorPdfUrl,
            });
          }
        }
      } catch (error: any) {
        console.error('[storybooks] PDF regeneration error:', error);
        toast({
          title: 'PDF regeneration failed',
          description: error?.message || 'Please check your connection and try again.',
          variant: 'destructive',
        });
      } finally {
        setIsRegeneratingPdfs(false);
      }
    },
    [user, toast, printResult, selectedPrintLayoutId]
  );

  // Handle delete storybook
  const handleDeleteStorybook = useCallback(
    async (storybookId: string) => {
      if (!firestore || !user) return;

      const storybook = storybookMetaMap.get(storybookId);
      if (!storybook) return;

      // Determine the correct document path based on model type
      const docPath = storybook.isNewModel
        ? `stories/${storybook.storyId}/storybooks/${storybookId}`
        : `stories/${storybook.storyId}`;

      const docRef = doc(firestore, docPath);
      await updateDoc(docRef, {
        deletedAt: serverTimestamp(),
        deletedBy: user.uid,
        updatedAt: serverTimestamp(),
      });

      // Remove from local state immediately
      setChildrenWithStorybooks((prev) =>
        prev.map((cws) => ({
          ...cws,
          storybooks: cws.storybooks.filter((sb) => sb.storybookId !== storybookId),
        }))
      );

      markAsDeleted({
        id: storybookId,
        name: storybook.title || 'Untitled Book',
        type: 'storybook',
      });
      toast({ title: 'Storybook deleted', description: `${storybook.title || 'Storybook'} has been removed.` });
    },
    [firestore, user, storybookMetaMap, markAsDeleted, toast]
  );

  // Handle undo delete
  const handleUndoDelete = useCallback(
    async (storybookId: string) => {
      if (!firestore) return;

      const storybook = storybookMetaMap.get(storybookId);
      if (!storybook) return;

      const docPath = storybook.isNewModel
        ? `stories/${storybook.storyId}/storybooks/${storybookId}`
        : `stories/${storybook.storyId}`;

      const docRef = doc(firestore, docPath);
      await updateDoc(docRef, {
        deletedAt: deleteField(),
        deletedBy: deleteField(),
        updatedAt: serverTimestamp(),
      });

      // Add back to local state
      setChildrenWithStorybooks((prev) =>
        prev.map((cws) => {
          if (cws.childId === storybook.childId) {
            return {
              ...cws,
              storybooks: [...cws.storybooks, storybook].sort(
                (a, b) => b.createdAtDate.getTime() - a.createdAtDate.getTime()
              ),
            };
          }
          return cws;
        })
      );

      toast({ title: 'Undo successful', description: 'The storybook has been restored.' });
    },
    [firestore, storybookMetaMap, toast]
  );

  // Handle refresh
  const handleRefresh = useCallback(() => {
    fetchStorybooks();
  }, [fetchStorybooks]);

  if (!isParentGuardValidated) {
    return null;
  }

  const isLoading = userLoading || loading;
  const totalBooks = childrenWithStorybooks.reduce((sum, c) => sum + c.storybooks.length, 0);

  return (
    <div className="container mx-auto p-4 sm:p-6 md:p-8 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Storybooks</h1>
          <p className="text-muted-foreground">
            {isLoading
              ? 'Loading...'
              : `${totalBooks} ${totalBooks === 1 ? 'book' : 'books'} across ${childrenWithStorybooks.length} ${childrenWithStorybooks.length === 1 ? 'child' : 'children'}`}
          </p>
        </div>
        <Button variant="outline" onClick={handleRefresh} disabled={isLoading} data-wiz-target="storybooks-refresh">
          <RefreshCw className={`mr-2 h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
      </div>

      {/* Content */}
      {isLoading ? (
        <Card>
          <CardContent className="flex items-center justify-center py-12">
            <LoaderCircle className="h-8 w-8 animate-spin text-primary" />
          </CardContent>
        </Card>
      ) : childrenWithStorybooks.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12 gap-4">
            <BookOpen className="h-12 w-12 text-muted-foreground" />
            <div className="text-center">
              <p className="font-medium">No storybooks yet</p>
              <p className="text-muted-foreground">
                Create stories with your children to see their books here.
              </p>
            </div>
            <Button asChild>
              <Link href="/parent">Go to Children</Link>
            </Button>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0 divide-y">
            {childrenWithStorybooks.map((cws) => (
              <ChildStorybooksSection
                key={cws.childId}
                childWithStorybooks={cws}
                imageStyles={imageStyles ?? undefined}
                onRegenerateAudio={handleRegenerateAudio}
                onGeneratePrintable={handleGeneratePrintable}
                onDeleteStorybook={handleDeleteStorybook}
                regeneratingAudioFor={regeneratingAudioFor}
                generatingPrintableFor={generatingPrintableFor}
              />
            ))}
          </CardContent>
        </Card>
      )}

      <UndoBanner
        deletedItem={deletedItem}
        onUndo={handleUndoDelete}
        onDismiss={clearDeletedItem}
      />

      {/* Print Options Dialog */}
      <Dialog open={!!printResult} onOpenChange={(open) => !open && setPrintResult(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Printer className="h-5 w-5 text-primary" />
              Print Options
            </DialogTitle>
            <DialogDescription>
              &ldquo;{printResult?.storybook.title || 'Untitled Book'}&rdquo; - View, regenerate, or order your print-ready PDFs.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <h4 className="text-sm font-medium">Generated PDFs</h4>
              <div className="space-y-2">
                {printResult?.coverPdfUrl && (
                  <Button
                    variant="outline"
                    className="w-full justify-start"
                    onClick={() => window.open(printResult.coverPdfUrl, '_blank')}
                  >
                    <FileText className="mr-2 h-4 w-4" />
                    Cover PDF (Front + Back)
                    <ExternalLink className="ml-auto h-4 w-4 text-muted-foreground" />
                  </Button>
                )}
                {printResult?.interiorPdfUrl && (
                  <Button
                    variant="outline"
                    className="w-full justify-start"
                    onClick={() => window.open(printResult.interiorPdfUrl, '_blank')}
                  >
                    <FileText className="mr-2 h-4 w-4" />
                    Interior Pages PDF
                    <ExternalLink className="ml-auto h-4 w-4 text-muted-foreground" />
                  </Button>
                )}
                <Button
                  variant="outline"
                  className="w-full justify-start"
                  onClick={() => printResult?.pdfUrl && window.open(printResult.pdfUrl, '_blank')}
                >
                  <FileText className="mr-2 h-4 w-4" />
                  Combined PDF (All Pages)
                  <ExternalLink className="ml-auto h-4 w-4 text-muted-foreground" />
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
                        {printLayouts?.find(l => l.id === printResult?.storybook.printLayoutId)?.name || 'Default Layout'}
                        <span className="text-muted-foreground ml-1">(default)</span>
                      </span>
                    ) : (
                      printLayouts?.find(l => l.id === selectedPrintLayoutId)?.name || selectedPrintLayoutId
                    )}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__default__">
                    {printLayouts?.find(l => l.id === printResult?.storybook.printLayoutId)?.name || 'Default Layout'}
                    <span className="text-muted-foreground ml-1">(default)</span>
                  </SelectItem>
                  {printLayouts?.filter(l => l.id !== printResult?.storybook.printLayoutId).map((layout) => (
                    <SelectItem key={layout.id} value={layout.id}>
                      {layout.name}
                      <span className="text-muted-foreground ml-1">
                        ({layout.leafWidth}" × {layout.leafHeight}")
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Select a different layout to regenerate PDFs with different dimensions or formatting.
              </p>
            </div>

            <div className="space-y-2">
              <h4 className="text-sm font-medium">Actions</h4>
              <Button
                variant="outline"
                className="w-full justify-start"
                onClick={handleRegeneratePdfs}
                disabled={isRegeneratingPdfs}
              >
                {isRegeneratingPdfs ? (
                  <LoaderCircle className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <RefreshCw className="mr-2 h-4 w-4" />
                )}
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
            <Button variant="outline" onClick={() => setPrintResult(null)}>
              Close
            </Button>
            <Button asChild>
              <Link href={`/storybook/${printResult?.storybook.storyId}/order?storybookId=${printResult?.storybook.storybookId}`}>
                <ShoppingCart className="mr-2 h-4 w-4" />
                Proceed to Order
              </Link>
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
