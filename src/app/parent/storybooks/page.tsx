'use client';

import { useMemo, useState, useCallback } from 'react';
import { useUser } from '@/firebase/auth/use-user';
import { useFirestore } from '@/firebase';
import { collection, query, where, orderBy, getDocs, doc, updateDoc, serverTimestamp, deleteField } from 'firebase/firestore';
import { useCollection } from '@/lib/firestore-hooks';
import type { Story, StoryBookOutput, ChildProfile, ImageStyle, PrintLayout } from '@/lib/types';
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
import { useEffect } from 'react';
import { DeleteButton, UndoBanner, useDeleteWithUndo } from '@/components/shared/DeleteWithUndo';

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

type StorybookWithMeta = {
  storybookId: string;
  storyId: string;
  childId: string;
  title?: string;
  thumbnailUrl?: string;
  imageStyleId: string;
  createdAt: Date;
  imageGenerationStatus?: string;
  audioStatus?: 'none' | 'partial' | 'ready';
  pagesWithAudio?: number;
  totalPages?: number;
  isNewModel: boolean;
  // Print layout for generating printable PDFs
  printLayoutId?: string;
  // Printable PDF status
  printablePdfUrl?: string;
  printableCoverPdfUrl?: string;
  printableInteriorPdfUrl?: string;
};

type ChildWithStorybooks = {
  child: ChildProfile;
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
        ) : (
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
          Created {formatFriendlyDate(storybook.createdAt)}
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
  const { child, storybooks } = childWithStorybooks;

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <CollapsibleTrigger asChild>
        <Button variant="ghost" className="w-full justify-start gap-3 p-3 h-auto">
          <Avatar className="h-10 w-10">
            <AvatarImage src={child.avatarUrl} alt={child.displayName} />
            <AvatarFallback>
              {child.displayName?.charAt(0) || <User className="h-5 w-5" />}
            </AvatarFallback>
          </Avatar>
          <div className="flex-grow text-left">
            <p className="font-semibold">{child.displayName}</p>
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

  // Query children for this parent
  const childrenQuery = useMemo(() => {
    if (!user || !firestore || userLoading || !idTokenResult) return null;
    return query(
      collection(firestore, 'children'),
      where('ownerParentUid', '==', user.uid)
    );
  }, [user, firestore, userLoading, idTokenResult]);

  const { data: children, loading: childrenLoading } = useCollection<ChildProfile>(childrenQuery);

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

  // Filter out deleted children
  const visibleChildren = useMemo(() => {
    return (children || []).filter(child => !child.deletedAt);
  }, [children]);

  // Load storybooks for all children
  useEffect(() => {
    const loadStorybooks = async () => {
      if (!firestore || !visibleChildren.length || childrenLoading) return;

      setLoading(true);
      const results: ChildWithStorybooks[] = [];

      for (const child of visibleChildren) {
        const storybooks: StorybookWithMeta[] = [];

        // Query stories for this child
        const storiesQuery = query(
          collection(firestore, 'stories'),
          where('childId', '==', child.id)
        );
        const storiesSnap = await getDocs(storiesQuery);

        for (const storyDoc of storiesSnap.docs) {
          const story = storyDoc.data() as Story;
          const storyId = storyDoc.id;

          // Skip soft-deleted stories
          if (story.deletedAt) continue;

          // Helper to get cover image, audio stats, and calculated image status
          const getPageStats = async (pagesPath: string) => {
            try {
              const pagesRef = collection(firestore, pagesPath);
              const pagesQuery = query(pagesRef, orderBy('pageNumber', 'asc'));
              const pagesSnap = await getDocs(pagesQuery);

              let thumbnailUrl: string | undefined;
              let pagesWithAudio = 0;
              const totalPages = pagesSnap.size;

              // Track image status for pages that actually need images
              let pagesRequiringImages = 0;
              let pagesWithReadyImages = 0;
              let pagesWithErrorImages = 0;

              for (const pageDoc of pagesSnap.docs) {
                const page = pageDoc.data();
                // Get cover image from page 0
                if (page.pageNumber === 0 && page.imageUrl && page.imageStatus === 'ready') {
                  thumbnailUrl = page.imageUrl;
                }
                // Count pages with audio
                if (page.audioStatus === 'ready' && page.audioUrl) {
                  pagesWithAudio++;
                }
                // Calculate image status - exclude title_page and blank pages without imagePrompt
                const needsImage = page.kind !== 'title_page' && page.kind !== 'blank' && !!page.imagePrompt;
                if (needsImage) {
                  pagesRequiringImages++;
                  if (page.imageStatus === 'ready') {
                    pagesWithReadyImages++;
                  } else if (page.imageStatus === 'error') {
                    pagesWithErrorImages++;
                  }
                }
              }

              const audioStatus: 'none' | 'partial' | 'ready' =
                pagesWithAudio === 0
                  ? 'none'
                  : pagesWithAudio === totalPages
                  ? 'ready'
                  : 'partial';

              // Calculate actual image generation status from page data
              const calculatedImageStatus: string =
                pagesRequiringImages > 0 && pagesWithReadyImages === pagesRequiringImages
                  ? 'ready'
                  : pagesWithErrorImages > 0
                    ? 'error'
                    : 'pending';

              return { thumbnailUrl, audioStatus, pagesWithAudio, totalPages, calculatedImageStatus };
            } catch {
              return { thumbnailUrl: undefined, audioStatus: 'none' as const, pagesWithAudio: 0, totalPages: 0, calculatedImageStatus: 'pending' };
            }
          };

          // Check legacy model - show if pages are ready (regardless of image status)
          // This allows users to see storybooks while images are still generating
          if (story.pageGeneration?.status === 'ready' || story.imageGeneration?.status === 'ready') {
            const stats = await getPageStats(`stories/${storyId}/outputs/storybook/pages`);
            storybooks.push({
              storybookId: storyId,
              storyId: storyId,
              childId: child.id,
              title: story.metadata?.title,
              thumbnailUrl: stats.thumbnailUrl,
              imageStyleId: story.selectedImageStyleId || '',
              createdAt: story.updatedAt?.toDate?.() || story.createdAt?.toDate?.() || new Date(),
              // Use calculated status from actual pages, not the document's cached status
              imageGenerationStatus: stats.calculatedImageStatus,
              audioStatus: stats.audioStatus,
              pagesWithAudio: stats.pagesWithAudio,
              totalPages: stats.totalPages,
              isNewModel: false,
            });
          }

          // Check new model (storybooks subcollection)
          try {
            const storybooksRef = collection(firestore, 'stories', storyId, 'storybooks');
            const storybooksSnap = await getDocs(storybooksRef);

            for (const sbDoc of storybooksSnap.docs) {
              const sb = sbDoc.data() as StoryBookOutput;
              console.log(`[storybooks] Found storybook ${sbDoc.id}:`, {
                deletedAt: sb.deletedAt,
                pageGenStatus: sb.pageGeneration?.status,
                imageGenStatus: sb.imageGeneration?.status,
              });
              // Skip soft-deleted storybooks
              if (sb.deletedAt) continue;
              // Show if pages are ready (regardless of image status)
              // This allows users to see storybooks while images are still generating
              if (sb.pageGeneration?.status === 'ready' || sb.imageGeneration?.status === 'ready') {
                const stats = await getPageStats(`stories/${storyId}/storybooks/${sbDoc.id}/pages`);
                storybooks.push({
                  storybookId: sbDoc.id,
                  storyId: storyId,
                  childId: child.id,
                  title: sb.title || story.metadata?.title,
                  thumbnailUrl: stats.thumbnailUrl,
                  imageStyleId: sb.imageStyleId,
                  createdAt: sb.createdAt?.toDate?.() || new Date(),
                  // Use calculated status from actual pages, not the document's cached status
                  imageGenerationStatus: stats.calculatedImageStatus,
                  audioStatus: stats.audioStatus,
                  pagesWithAudio: stats.pagesWithAudio,
                  totalPages: stats.totalPages,
                  isNewModel: true,
                  // Print layout for generating printable PDFs
                  printLayoutId: sb.printLayoutId || undefined,
                  // Include printable PDF URLs from finalization if available
                  printablePdfUrl: sb.finalization?.printablePdfUrl || undefined,
                  printableCoverPdfUrl: sb.finalization?.printableCoverPdfUrl || undefined,
                  printableInteriorPdfUrl: sb.finalization?.printableInteriorPdfUrl || undefined,
                });
                console.log(`[storybooks] Added storybook ${sbDoc.id} with calculatedImageStatus: ${stats.calculatedImageStatus} (document had: ${sb.imageGeneration?.status})`);
              } else {
                console.log(`[storybooks] Skipped storybook ${sbDoc.id} - not ready`);
              }
            }
          } catch (err) {
            console.error('Error loading storybooks for story:', storyId, err);
          }
        }

        // Sort storybooks by date, most recent first
        storybooks.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

        results.push({ child, storybooks });
      }

      // Sort children by number of storybooks (descending)
      results.sort((a, b) => b.storybooks.length - a.storybooks.length);

      // Build metadata map for delete/undo operations
      const metaMap = new Map<string, StorybookWithMeta>();
      for (const { storybooks } of results) {
        for (const sb of storybooks) {
          metaMap.set(sb.storybookId, sb);
        }
      }
      setStorybookMetaMap(metaMap);

      setChildrenWithStorybooks(results);
      setLoading(false);
    };

    loadStorybooks();
  }, [firestore, visibleChildren, childrenLoading]);

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
          coverPdfUrl: storybook.printableCoverPdfUrl,
          interiorPdfUrl: storybook.printableInteriorPdfUrl,
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
          if (cws.child.id === storybook.childId) {
            return {
              ...cws,
              storybooks: [...cws.storybooks, storybook].sort(
                (a, b) => b.createdAt.getTime() - a.createdAt.getTime()
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
    setLoading(true);
    // Force re-render by clearing state
    setChildrenWithStorybooks([]);
  }, []);

  if (!isParentGuardValidated) {
    return null;
  }

  const isLoading = userLoading || childrenLoading || loading;
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
                key={cws.child.id}
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
