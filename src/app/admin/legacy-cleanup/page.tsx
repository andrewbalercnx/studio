'use client';

import { useState, useCallback } from 'react';
import { useFirestore } from '@/firebase';
import { useUser } from '@/firebase/auth/use-user';
import { useAdminStatus } from '@/hooks/use-admin-status';
import { useToast } from '@/hooks/use-toast';
import {
  collection,
  query,
  getDocs,
  doc,
  deleteDoc,
  writeBatch,
  updateDoc,
  deleteField,
} from 'firebase/firestore';
import {
  LoaderCircle,
  Trash2,
  Search,
  AlertTriangle,
  CheckCircle2,
  BookOpen,
  FileText,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { formatDistanceToNow } from 'date-fns';

type LegacyStorybook = {
  storyId: string;
  storyTitle?: string;
  childId?: string;
  parentUid?: string;
  pageCount: number;
  imageGenStatus?: string;
  pageGenStatus?: string;
  createdAt?: Date;
  updatedAt?: Date;
};

type StoryWithStaleLegacyFields = {
  storyId: string;
  storyTitle?: string;
  childId?: string;
  hasPageGeneration: boolean;
  hasImageGeneration: boolean;
  hasStorybookFinalization: boolean;
  hasSelectedImageStyleId: boolean;
  hasIsLocked: boolean;
  hasNewModelStorybooks: boolean;
  updatedAt?: Date;
};

type ScanResult = {
  legacyStorybooks: LegacyStorybook[];
  storiesWithStaleLegacyFields: StoryWithStaleLegacyFields[];
  newModelStorybooks: number;
  totalStoriesScanned: number;
  scanTime: Date;
};

export default function LegacyCleanupPage() {
  const firestore = useFirestore();
  const { user } = useUser();
  const { isAdmin, loading: adminLoading } = useAdminStatus();
  const { toast } = useToast();

  const [scanning, setScanning] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [scanResult, setScanResult] = useState<ScanResult | null>(null);

  const scanForLegacyObjects = useCallback(async () => {
    if (!firestore) return;

    setScanning(true);
    setScanResult(null);

    try {
      const storiesRef = collection(firestore, 'stories');
      const storiesSnap = await getDocs(storiesRef);

      const legacyStorybooks: LegacyStorybook[] = [];
      const storiesWithStaleLegacyFields: StoryWithStaleLegacyFields[] = [];
      let newModelStorybooksCount = 0;

      for (const storyDoc of storiesSnap.docs) {
        const storyData = storyDoc.data();
        const storyId = storyDoc.id;

        let hasLegacyPages = false;
        let hasNewModelStorybooks = false;

        // Check for legacy storybook: stories/{storyId}/outputs/storybook/pages
        try {
          const legacyPagesRef = collection(
            firestore,
            'stories',
            storyId,
            'outputs',
            'storybook',
            'pages'
          );
          const legacyPagesSnap = await getDocs(legacyPagesRef);

          if (legacyPagesSnap.size > 0) {
            hasLegacyPages = true;
            legacyStorybooks.push({
              storyId,
              storyTitle: storyData.metadata?.title || storyData.storyText?.slice(0, 50),
              childId: storyData.childId,
              parentUid: storyData.parentUid,
              pageCount: legacyPagesSnap.size,
              imageGenStatus: storyData.imageGeneration?.status,
              pageGenStatus: storyData.pageGeneration?.status,
              createdAt: storyData.createdAt?.toDate?.(),
              updatedAt: storyData.updatedAt?.toDate?.(),
            });
          }
        } catch (err) {
          // Collection doesn't exist or access denied - that's fine
        }

        // Count new model storybooks: stories/{storyId}/storybooks/*
        try {
          const newStorybooksRef = collection(firestore, 'stories', storyId, 'storybooks');
          const newStorybooksSnap = await getDocs(newStorybooksRef);
          if (newStorybooksSnap.size > 0) {
            hasNewModelStorybooks = true;
            newModelStorybooksCount += newStorybooksSnap.size;
          }
        } catch (err) {
          // Collection doesn't exist or access denied - that's fine
        }

        // Check for stale legacy fields on the story document itself
        // These are fields that were used in the legacy model but should now be on StoryBookOutput
        const hasPageGeneration = !!storyData.pageGeneration;
        const hasImageGeneration = !!storyData.imageGeneration;
        const hasStorybookFinalization = !!storyData.storybookFinalization;
        const hasSelectedImageStyleId = !!storyData.selectedImageStyleId;
        const hasIsLocked = storyData.isLocked === true;

        // Only flag if story has legacy fields but no legacy storybook pages
        // (If it has legacy pages, we'll clean those up first)
        const hasAnyLegacyField = hasPageGeneration || hasImageGeneration ||
                                   hasStorybookFinalization || hasSelectedImageStyleId || hasIsLocked;

        if (hasAnyLegacyField && !hasLegacyPages) {
          storiesWithStaleLegacyFields.push({
            storyId,
            storyTitle: storyData.metadata?.title || storyData.storyText?.slice(0, 50),
            childId: storyData.childId,
            hasPageGeneration,
            hasImageGeneration,
            hasStorybookFinalization,
            hasSelectedImageStyleId,
            hasIsLocked,
            hasNewModelStorybooks,
            updatedAt: storyData.updatedAt?.toDate?.(),
          });
        }
      }

      setScanResult({
        legacyStorybooks,
        storiesWithStaleLegacyFields,
        newModelStorybooks: newModelStorybooksCount,
        totalStoriesScanned: storiesSnap.size,
        scanTime: new Date(),
      });

      toast({
        title: 'Scan complete',
        description: `Found ${legacyStorybooks.length} legacy storybooks and ${newModelStorybooksCount} new model storybooks`,
      });
    } catch (err: any) {
      toast({
        title: 'Scan failed',
        description: err.message || 'An error occurred while scanning',
        variant: 'destructive',
      });
    } finally {
      setScanning(false);
    }
  }, [firestore, toast]);

  const deleteAllLegacyStorybooks = useCallback(async () => {
    if (!firestore || !scanResult || scanResult.legacyStorybooks.length === 0) return;

    setDeleting(true);

    try {
      let deletedCount = 0;

      for (const legacy of scanResult.legacyStorybooks) {
        // Delete all pages in the legacy storybook
        const pagesRef = collection(
          firestore,
          'stories',
          legacy.storyId,
          'outputs',
          'storybook',
          'pages'
        );
        const pagesSnap = await getDocs(pagesRef);

        // Use batched writes for efficiency
        const batch = writeBatch(firestore);
        pagesSnap.docs.forEach((pageDoc) => {
          batch.delete(pageDoc.ref);
        });
        await batch.commit();

        // Delete the storybook output document itself
        const outputDoc = doc(firestore, 'stories', legacy.storyId, 'outputs', 'storybook');
        await deleteDoc(outputDoc);

        deletedCount++;
      }

      toast({
        title: 'Deletion complete',
        description: `Deleted ${deletedCount} legacy storybooks`,
      });

      // Re-scan to update the UI
      await scanForLegacyObjects();
    } catch (err: any) {
      toast({
        title: 'Deletion failed',
        description: err.message || 'An error occurred while deleting',
        variant: 'destructive',
      });
    } finally {
      setDeleting(false);
    }
  }, [firestore, scanResult, toast, scanForLegacyObjects]);

  const deleteSingleLegacyStorybook = useCallback(
    async (storyId: string) => {
      if (!firestore) return;

      setDeleting(true);

      try {
        // Delete all pages in the legacy storybook
        const pagesRef = collection(
          firestore,
          'stories',
          storyId,
          'outputs',
          'storybook',
          'pages'
        );
        const pagesSnap = await getDocs(pagesRef);

        const batch = writeBatch(firestore);
        pagesSnap.docs.forEach((pageDoc) => {
          batch.delete(pageDoc.ref);
        });
        await batch.commit();

        // Delete the storybook output document itself
        const outputDoc = doc(firestore, 'stories', storyId, 'outputs', 'storybook');
        await deleteDoc(outputDoc);

        toast({
          title: 'Deleted',
          description: `Legacy storybook for story ${storyId} has been deleted`,
        });

        // Re-scan to update the UI
        await scanForLegacyObjects();
      } catch (err: any) {
        toast({
          title: 'Deletion failed',
          description: err.message || 'An error occurred while deleting',
          variant: 'destructive',
        });
      } finally {
        setDeleting(false);
      }
    },
    [firestore, toast, scanForLegacyObjects]
  );

  const cleanStaleLegacyFields = useCallback(
    async (storyId: string) => {
      if (!firestore) return;

      setDeleting(true);

      try {
        const storyRef = doc(firestore, 'stories', storyId);
        await updateDoc(storyRef, {
          pageGeneration: deleteField(),
          imageGeneration: deleteField(),
          storybookFinalization: deleteField(),
          selectedImageStyleId: deleteField(),
          isLocked: deleteField(),
        });

        toast({
          title: 'Cleaned',
          description: `Removed stale legacy fields from story ${storyId}`,
        });

        // Re-scan to update the UI
        await scanForLegacyObjects();
      } catch (err: any) {
        toast({
          title: 'Cleanup failed',
          description: err.message || 'An error occurred while cleaning fields',
          variant: 'destructive',
        });
      } finally {
        setDeleting(false);
      }
    },
    [firestore, toast, scanForLegacyObjects]
  );

  const cleanAllStaleLegacyFields = useCallback(async () => {
    if (!firestore || !scanResult || scanResult.storiesWithStaleLegacyFields.length === 0) return;

    setDeleting(true);

    try {
      let cleanedCount = 0;

      for (const story of scanResult.storiesWithStaleLegacyFields) {
        const storyRef = doc(firestore, 'stories', story.storyId);
        await updateDoc(storyRef, {
          pageGeneration: deleteField(),
          imageGeneration: deleteField(),
          storybookFinalization: deleteField(),
          selectedImageStyleId: deleteField(),
          isLocked: deleteField(),
        });
        cleanedCount++;
      }

      toast({
        title: 'Cleanup complete',
        description: `Cleaned stale legacy fields from ${cleanedCount} stories`,
      });

      // Re-scan to update the UI
      await scanForLegacyObjects();
    } catch (err: any) {
      toast({
        title: 'Cleanup failed',
        description: err.message || 'An error occurred while cleaning fields',
        variant: 'destructive',
      });
    } finally {
      setDeleting(false);
    }
  }, [firestore, scanResult, toast, scanForLegacyObjects]);

  if (adminLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <LoaderCircle className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <div className="container mx-auto py-10">
        <Card>
          <CardHeader>
            <CardTitle>Access Denied</CardTitle>
            <CardDescription>You must be an admin to access this page.</CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  return (
    <div className="container mx-auto py-10 space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-amber-500" />
            Legacy Storybook Cleanup
          </CardTitle>
          <CardDescription>
            Identify and remove legacy storybooks that use the old data model
            (stories/{'{storyId}'}/outputs/storybook/pages). New model storybooks use
            stories/{'{storyId}'}/storybooks/{'{storybookId}'}/pages.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex gap-4">
            <Button onClick={scanForLegacyObjects} disabled={scanning || deleting}>
              {scanning ? (
                <LoaderCircle className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Search className="mr-2 h-4 w-4" />
              )}
              Scan for Legacy Objects
            </Button>

            {scanResult && scanResult.legacyStorybooks.length > 0 && (
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="destructive" disabled={deleting}>
                    {deleting ? (
                      <LoaderCircle className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <Trash2 className="mr-2 h-4 w-4" />
                    )}
                    Delete All Legacy Storybooks ({scanResult.legacyStorybooks.length})
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
                    <AlertDialogDescription>
                      This will permanently delete {scanResult.legacyStorybooks.length} legacy
                      storybooks. This action cannot be undone.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction
                      onClick={deleteAllLegacyStorybooks}
                      className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                    >
                      Delete All
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            )}
          </div>
        </CardContent>
      </Card>

      {scanResult && (
        <Card>
          <CardHeader>
            <CardTitle>Scan Results</CardTitle>
            <CardDescription>
              Scanned {scanResult.totalStoriesScanned} stories at{' '}
              {scanResult.scanTime.toLocaleTimeString()}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Summary */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <Card className={scanResult.legacyStorybooks.length > 0 ? 'border-amber-500' : 'border-green-500'}>
                <CardContent className="pt-6">
                  <div className="flex items-center gap-3">
                    {scanResult.legacyStorybooks.length > 0 ? (
                      <AlertTriangle className="h-8 w-8 text-amber-500" />
                    ) : (
                      <CheckCircle2 className="h-8 w-8 text-green-500" />
                    )}
                    <div>
                      <p className="text-2xl font-bold">{scanResult.legacyStorybooks.length}</p>
                      <p className="text-sm text-muted-foreground">Legacy Storybooks</p>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card className={scanResult.storiesWithStaleLegacyFields.length > 0 ? 'border-amber-500' : 'border-green-500'}>
                <CardContent className="pt-6">
                  <div className="flex items-center gap-3">
                    {scanResult.storiesWithStaleLegacyFields.length > 0 ? (
                      <AlertTriangle className="h-8 w-8 text-amber-500" />
                    ) : (
                      <CheckCircle2 className="h-8 w-8 text-green-500" />
                    )}
                    <div>
                      <p className="text-2xl font-bold">{scanResult.storiesWithStaleLegacyFields.length}</p>
                      <p className="text-sm text-muted-foreground">Stale Legacy Fields</p>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card className="border-green-500">
                <CardContent className="pt-6">
                  <div className="flex items-center gap-3">
                    <BookOpen className="h-8 w-8 text-green-500" />
                    <div>
                      <p className="text-2xl font-bold">{scanResult.newModelStorybooks}</p>
                      <p className="text-sm text-muted-foreground">New Model Storybooks</p>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardContent className="pt-6">
                  <div className="flex items-center gap-3">
                    <FileText className="h-8 w-8 text-muted-foreground" />
                    <div>
                      <p className="text-2xl font-bold">{scanResult.totalStoriesScanned}</p>
                      <p className="text-sm text-muted-foreground">Total Stories</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Legacy Storybooks Table */}
            {scanResult.legacyStorybooks.length > 0 && (
              <div className="space-y-4">
                <h3 className="text-lg font-semibold">Legacy Storybooks</h3>
                <div className="border rounded-lg">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Story ID</TableHead>
                        <TableHead>Title</TableHead>
                        <TableHead>Pages</TableHead>
                        <TableHead>Page Status</TableHead>
                        <TableHead>Image Status</TableHead>
                        <TableHead>Updated</TableHead>
                        <TableHead>Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {scanResult.legacyStorybooks.map((legacy) => (
                        <TableRow key={legacy.storyId}>
                          <TableCell className="font-mono text-xs">
                            {legacy.storyId.slice(0, 12)}...
                          </TableCell>
                          <TableCell className="max-w-[200px] truncate">
                            {legacy.storyTitle || 'Untitled'}
                          </TableCell>
                          <TableCell>{legacy.pageCount}</TableCell>
                          <TableCell>
                            <Badge
                              variant={
                                legacy.pageGenStatus === 'ready'
                                  ? 'default'
                                  : legacy.pageGenStatus === 'error'
                                  ? 'destructive'
                                  : 'secondary'
                              }
                            >
                              {legacy.pageGenStatus || 'unknown'}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            <Badge
                              variant={
                                legacy.imageGenStatus === 'ready'
                                  ? 'default'
                                  : legacy.imageGenStatus === 'error'
                                  ? 'destructive'
                                  : 'secondary'
                              }
                            >
                              {legacy.imageGenStatus || 'unknown'}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-sm text-muted-foreground">
                            {legacy.updatedAt
                              ? formatDistanceToNow(legacy.updatedAt, { addSuffix: true })
                              : 'Unknown'}
                          </TableCell>
                          <TableCell>
                            <div className="flex gap-2">
                              <Button
                                variant="outline"
                                size="sm"
                                asChild
                              >
                                <a
                                  href={`/story/${legacy.storyId}`}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                >
                                  View
                                </a>
                              </Button>
                              <AlertDialog>
                                <AlertDialogTrigger asChild>
                                  <Button variant="destructive" size="sm" disabled={deleting}>
                                    <Trash2 className="h-3 w-3" />
                                  </Button>
                                </AlertDialogTrigger>
                                <AlertDialogContent>
                                  <AlertDialogHeader>
                                    <AlertDialogTitle>Delete this legacy storybook?</AlertDialogTitle>
                                    <AlertDialogDescription>
                                      This will permanently delete the legacy storybook for story{' '}
                                      {legacy.storyId}. The story itself will not be deleted.
                                    </AlertDialogDescription>
                                  </AlertDialogHeader>
                                  <AlertDialogFooter>
                                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                                    <AlertDialogAction
                                      onClick={() => deleteSingleLegacyStorybook(legacy.storyId)}
                                      className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                                    >
                                      Delete
                                    </AlertDialogAction>
                                  </AlertDialogFooter>
                                </AlertDialogContent>
                              </AlertDialog>
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </div>
            )}

            {scanResult.legacyStorybooks.length === 0 && scanResult.storiesWithStaleLegacyFields.length === 0 && (
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <CheckCircle2 className="h-16 w-16 text-green-500 mb-4" />
                <h3 className="text-xl font-semibold">No Legacy Objects Found</h3>
                <p className="text-muted-foreground mt-2">
                  All storybooks are using the new data model and no stale legacy fields were found.
                  You can safely remove legacy API endpoints.
                </p>
              </div>
            )}

            {/* Stories with Stale Legacy Fields */}
            {scanResult.storiesWithStaleLegacyFields.length > 0 && (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-lg font-semibold">Stories with Stale Legacy Fields</h3>
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button variant="outline" size="sm" disabled={deleting}>
                        <Trash2 className="mr-2 h-3 w-3" />
                        Clean All ({scanResult.storiesWithStaleLegacyFields.length})
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Clean all stale legacy fields?</AlertDialogTitle>
                        <AlertDialogDescription>
                          This will remove legacy fields (pageGeneration, imageGeneration,
                          storybookFinalization, selectedImageStyleId, isLocked) from{' '}
                          {scanResult.storiesWithStaleLegacyFields.length} stories. The stories
                          themselves will not be deleted.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction onClick={cleanAllStaleLegacyFields}>
                          Clean All
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </div>
                <p className="text-sm text-muted-foreground">
                  These stories have legacy storybook fields but no actual legacy storybook data.
                  These fields can be safely removed.
                </p>
                <div className="border rounded-lg">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Story ID</TableHead>
                        <TableHead>Title</TableHead>
                        <TableHead>Legacy Fields</TableHead>
                        <TableHead>Has New Storybooks</TableHead>
                        <TableHead>Updated</TableHead>
                        <TableHead>Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {scanResult.storiesWithStaleLegacyFields.map((story) => (
                        <TableRow key={story.storyId}>
                          <TableCell className="font-mono text-xs">
                            {story.storyId.slice(0, 12)}...
                          </TableCell>
                          <TableCell className="max-w-[200px] truncate">
                            {story.storyTitle || 'Untitled'}
                          </TableCell>
                          <TableCell>
                            <div className="flex flex-wrap gap-1">
                              {story.hasPageGeneration && (
                                <Badge variant="secondary" className="text-xs">pageGen</Badge>
                              )}
                              {story.hasImageGeneration && (
                                <Badge variant="secondary" className="text-xs">imageGen</Badge>
                              )}
                              {story.hasStorybookFinalization && (
                                <Badge variant="secondary" className="text-xs">finalization</Badge>
                              )}
                              {story.hasSelectedImageStyleId && (
                                <Badge variant="secondary" className="text-xs">imageStyle</Badge>
                              )}
                              {story.hasIsLocked && (
                                <Badge variant="secondary" className="text-xs">isLocked</Badge>
                              )}
                            </div>
                          </TableCell>
                          <TableCell>
                            {story.hasNewModelStorybooks ? (
                              <Badge variant="default" className="text-xs">Yes</Badge>
                            ) : (
                              <Badge variant="outline" className="text-xs">No</Badge>
                            )}
                          </TableCell>
                          <TableCell className="text-sm text-muted-foreground">
                            {story.updatedAt
                              ? formatDistanceToNow(story.updatedAt, { addSuffix: true })
                              : 'Unknown'}
                          </TableCell>
                          <TableCell>
                            <AlertDialog>
                              <AlertDialogTrigger asChild>
                                <Button variant="outline" size="sm" disabled={deleting}>
                                  Clean
                                </Button>
                              </AlertDialogTrigger>
                              <AlertDialogContent>
                                <AlertDialogHeader>
                                  <AlertDialogTitle>Clean stale legacy fields?</AlertDialogTitle>
                                  <AlertDialogDescription>
                                    This will remove legacy fields from story {story.storyId}.
                                    The story itself will not be deleted.
                                  </AlertDialogDescription>
                                </AlertDialogHeader>
                                <AlertDialogFooter>
                                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                                  <AlertDialogAction
                                    onClick={() => cleanStaleLegacyFields(story.storyId)}
                                  >
                                    Clean
                                  </AlertDialogAction>
                                </AlertDialogFooter>
                              </AlertDialogContent>
                            </AlertDialog>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
