'use client';

import { useState, useCallback } from 'react';
import { useUser } from '@/firebase/auth/use-user';
import { useAdminStatus } from '@/hooks/use-admin-status';
import { useToast } from '@/hooks/use-toast';
import {
  LoaderCircle,
  Trash2,
  RefreshCw,
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  Shield,
  Users,
  Smile,
  BookOpen,
  FileText,
  Printer,
  Clock,
  Archive,
  CheckCircle2,
  XCircle,
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
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
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
import { Checkbox } from '@/components/ui/checkbox';
import { ScrollArea } from '@/components/ui/scroll-area';

type CleanupItem = {
  id: string;
  collection: string;
  path: string;
  reason: string;
  details: Record<string, unknown>;
  canDelete: boolean;
};

type CleanupCategory = {
  name: string;
  description: string;
  items: CleanupItem[];
  totalCount: number;
};

type CleanupScanResult = {
  timestamp: string;
  categories: CleanupCategory[];
  summary: {
    totalItems: number;
    deletableItems: number;
    categoryCounts: Record<string, number>;
  };
};

type DeleteResult = {
  success: boolean;
  deleted: number;
  failed: number;
  errors: string[];
  deletedItems: string[];
};

const categoryIcons: Record<string, React.ElementType> = {
  'Orphaned Children': Users,
  'Orphaned Characters': Smile,
  'Orphaned/Incomplete Sessions': Clock,
  'Orphaned Stories': BookOpen,
  'Non-Production Users': Shield,
  'Orphaned Print Documents': Printer,
  'Old AI Logs': FileText,
  'Deprecated Collections': Archive,
};

function CategorySection({
  category,
  selectedItems,
  onToggleItem,
  onToggleAll,
  onDeleteCategory,
  isDeleting,
}: {
  category: CleanupCategory;
  selectedItems: Set<string>;
  onToggleItem: (path: string) => void;
  onToggleAll: (categoryName: string, items: CleanupItem[]) => void;
  onDeleteCategory: (categoryName: string) => void;
  isDeleting: boolean;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const Icon = categoryIcons[category.name] || Archive;

  const selectedInCategory = category.items.filter(item =>
    selectedItems.has(item.path)
  ).length;

  const allSelected =
    category.items.length > 0 && selectedInCategory === category.items.length;
  const someSelected = selectedInCategory > 0 && !allSelected;

  if (category.items.length === 0) return null;

  return (
    <Card className="mb-4">
      <Collapsible open={isOpen} onOpenChange={setIsOpen}>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CollapsibleTrigger asChild>
              <Button
                variant="ghost"
                className="flex items-center gap-3 p-0 h-auto hover:bg-transparent justify-start"
              >
                <Icon className="h-5 w-5 text-muted-foreground" />
                <div className="text-left">
                  <CardTitle className="text-lg">{category.name}</CardTitle>
                  <CardDescription className="text-sm">
                    {category.description}
                  </CardDescription>
                </div>
                <Badge variant="secondary" className="ml-2">
                  {category.totalCount}
                </Badge>
                {isOpen ? (
                  <ChevronDown className="h-5 w-5 text-muted-foreground" />
                ) : (
                  <ChevronRight className="h-5 w-5 text-muted-foreground" />
                )}
              </Button>
            </CollapsibleTrigger>

            <div className="flex items-center gap-2">
              {selectedInCategory > 0 && (
                <Badge variant="outline">
                  {selectedInCategory} selected
                </Badge>
              )}
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button
                    variant="destructive"
                    size="sm"
                    disabled={isDeleting}
                  >
                    {isDeleting ? (
                      <LoaderCircle className="h-4 w-4 animate-spin mr-2" />
                    ) : (
                      <Trash2 className="h-4 w-4 mr-2" />
                    )}
                    Delete All
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle className="flex items-center gap-2">
                      <AlertTriangle className="h-5 w-5 text-destructive" />
                      Delete All {category.name}?
                    </AlertDialogTitle>
                    <AlertDialogDescription>
                      This will permanently delete {category.totalCount} items.
                      This action cannot be undone.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction
                      onClick={() => onDeleteCategory(category.name)}
                      className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                    >
                      Delete All
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          </div>
        </CardHeader>

        <CollapsibleContent>
          <CardContent>
            <div className="flex items-center gap-2 mb-4 pb-2 border-b">
              <Checkbox
                checked={allSelected}
                ref={(el) => {
                  if (el) {
                    (el as HTMLButtonElement & { indeterminate?: boolean }).indeterminate = someSelected;
                  }
                }}
                onCheckedChange={() =>
                  onToggleAll(category.name, category.items)
                }
              />
              <span className="text-sm text-muted-foreground">
                Select all in this category
              </span>
            </div>

            <ScrollArea className="h-[400px]">
              <div className="space-y-2">
                {category.items.map((item) => (
                  <div
                    key={item.path}
                    className="flex items-start gap-3 p-3 rounded-lg border bg-muted/30 hover:bg-muted/50"
                  >
                    <Checkbox
                      checked={selectedItems.has(item.path)}
                      onCheckedChange={() => onToggleItem(item.path)}
                      disabled={!item.canDelete}
                    />
                    <div className="flex-grow min-w-0">
                      <div className="flex items-center gap-2">
                        <code className="text-xs bg-muted px-1.5 py-0.5 rounded font-mono">
                          {item.path}
                        </code>
                        {!item.canDelete && (
                          <Badge variant="outline" className="text-xs">
                            Protected
                          </Badge>
                        )}
                      </div>
                      <p className="text-sm text-muted-foreground mt-1">
                        {item.reason}
                      </p>
                      <div className="flex flex-wrap gap-2 mt-2">
                        {Object.entries(item.details)
                          .filter(([, v]) => v !== null && v !== undefined)
                          .slice(0, 4)
                          .map(([key, value]) => (
                            <Badge
                              key={key}
                              variant="secondary"
                              className="text-xs font-normal"
                            >
                              {key}: {String(value).substring(0, 30)}
                              {String(value).length > 30 ? '...' : ''}
                            </Badge>
                          ))}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </ScrollArea>
          </CardContent>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  );
}

export default function AdminCleanupPage() {
  const { user } = useUser();
  const { isAdmin, loading: adminLoading } = useAdminStatus();
  const { toast } = useToast();

  const [scanResult, setScanResult] = useState<CleanupScanResult | null>(null);
  const [scanning, setScanning] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deletingCategory, setDeletingCategory] = useState<string | null>(null);
  const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set());
  const [lastDeleteResult, setLastDeleteResult] = useState<DeleteResult | null>(
    null
  );

  const scan = useCallback(async () => {
    if (!user) return;

    setScanning(true);
    setLastDeleteResult(null);
    setSelectedItems(new Set());

    try {
      const token = await user.getIdToken();
      const response = await fetch('/api/admin/cleanup', {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Scan failed');
      }

      const result = await response.json();
      setScanResult(result);

      toast({
        title: 'Scan complete',
        description: `Found ${result.summary.totalItems} items for cleanup`,
      });
    } catch (error: any) {
      toast({
        title: 'Scan failed',
        description: error.message,
        variant: 'destructive',
      });
    } finally {
      setScanning(false);
    }
  }, [user, toast]);

  const toggleItem = useCallback((path: string) => {
    setSelectedItems((prev) => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  }, []);

  const toggleAll = useCallback(
    (categoryName: string, items: CleanupItem[]) => {
      const categoryPaths = items.map((i) => i.path);
      const allSelected = categoryPaths.every((p) => selectedItems.has(p));

      setSelectedItems((prev) => {
        const next = new Set(prev);
        if (allSelected) {
          categoryPaths.forEach((p) => next.delete(p));
        } else {
          categoryPaths.forEach((p) => next.add(p));
        }
        return next;
      });
    },
    [selectedItems]
  );

  const deleteSelected = useCallback(async () => {
    if (!user || selectedItems.size === 0 || !scanResult) return;

    setDeleting(true);

    try {
      const token = await user.getIdToken();

      // Build items array from selected paths
      const items: CleanupItem[] = [];
      for (const category of scanResult.categories) {
        for (const item of category.items) {
          if (selectedItems.has(item.path)) {
            items.push(item);
          }
        }
      }

      const response = await fetch('/api/admin/cleanup', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ items }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Delete failed');
      }

      const result: DeleteResult = await response.json();
      setLastDeleteResult(result);

      if (result.success) {
        toast({
          title: 'Delete complete',
          description: `Successfully deleted ${result.deleted} items`,
        });
      } else {
        toast({
          title: 'Delete partially complete',
          description: `Deleted ${result.deleted}, failed ${result.failed}`,
          variant: 'destructive',
        });
      }

      // Refresh scan
      await scan();
    } catch (error: any) {
      toast({
        title: 'Delete failed',
        description: error.message,
        variant: 'destructive',
      });
    } finally {
      setDeleting(false);
    }
  }, [user, selectedItems, scanResult, toast, scan]);

  const deleteCategory = useCallback(
    async (categoryName: string) => {
      if (!user) return;

      setDeletingCategory(categoryName);

      try {
        const token = await user.getIdToken();

        const response = await fetch(
          `/api/admin/cleanup?category=${encodeURIComponent(categoryName)}`,
          {
            method: 'DELETE',
            headers: {
              Authorization: `Bearer ${token}`,
            },
          }
        );

        if (!response.ok) {
          const error = await response.json();
          throw new Error(error.error || 'Delete failed');
        }

        const result: DeleteResult = await response.json();
        setLastDeleteResult(result);

        if (result.success) {
          toast({
            title: 'Category deleted',
            description: `Successfully deleted ${result.deleted} items from ${categoryName}`,
          });
        } else {
          toast({
            title: 'Delete partially complete',
            description: `Deleted ${result.deleted}, failed ${result.failed}`,
            variant: 'destructive',
          });
        }

        // Refresh scan
        await scan();
      } catch (error: any) {
        toast({
          title: 'Delete failed',
          description: error.message,
          variant: 'destructive',
        });
      } finally {
        setDeletingCategory(null);
      }
    },
    [user, toast, scan]
  );

  if (adminLoading) {
    return (
      <div className="container mx-auto p-4 sm:p-6 md:p-8">
        <Card>
          <CardContent className="flex items-center justify-center py-12">
            <LoaderCircle className="h-8 w-8 animate-spin" />
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <div className="container mx-auto p-4 sm:p-6 md:p-8">
        <Card>
          <CardContent className="py-12 text-center">
            <Shield className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
            <p className="text-muted-foreground">
              You must be an admin to access this page.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="container mx-auto p-4 sm:p-6 md:p-8 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Database Cleanup</h1>
          <p className="text-muted-foreground">
            Remove orphaned, test, and deprecated data from the database.
          </p>
        </div>
        <Button onClick={scan} disabled={scanning}>
          {scanning ? (
            <LoaderCircle className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="mr-2 h-4 w-4" />
          )}
          {scanning ? 'Scanning...' : 'Scan Database'}
        </Button>
      </div>

      {/* Warning Banner */}
      <Card className="border-amber-500/50 bg-amber-500/10">
        <CardContent className="flex items-start gap-4 py-4">
          <AlertTriangle className="h-6 w-6 text-amber-500 flex-shrink-0 mt-0.5" />
          <div>
            <p className="font-medium text-amber-700 dark:text-amber-400">
              Caution: Permanent Deletion
            </p>
            <p className="text-sm text-muted-foreground mt-1">
              This tool permanently deletes data. Only children belonging to{' '}
              <code className="bg-muted px-1 rounded">parent@rcnx.io</code> and
              the help-child are preserved. All other user data will be flagged
              for deletion.
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Last Delete Result */}
      {lastDeleteResult && (
        <Card
          className={
            lastDeleteResult.success
              ? 'border-green-500/50 bg-green-500/10'
              : 'border-red-500/50 bg-red-500/10'
          }
        >
          <CardContent className="flex items-start gap-4 py-4">
            {lastDeleteResult.success ? (
              <CheckCircle2 className="h-6 w-6 text-green-500 flex-shrink-0 mt-0.5" />
            ) : (
              <XCircle className="h-6 w-6 text-red-500 flex-shrink-0 mt-0.5" />
            )}
            <div>
              <p className="font-medium">
                {lastDeleteResult.success
                  ? 'Deletion Complete'
                  : 'Deletion Partially Complete'}
              </p>
              <p className="text-sm text-muted-foreground mt-1">
                Deleted: {lastDeleteResult.deleted}, Failed:{' '}
                {lastDeleteResult.failed}
              </p>
              {lastDeleteResult.errors.length > 0 && (
                <ul className="text-xs text-muted-foreground mt-2 list-disc list-inside">
                  {lastDeleteResult.errors.slice(0, 5).map((err, i) => (
                    <li key={i}>{err}</li>
                  ))}
                  {lastDeleteResult.errors.length > 5 && (
                    <li>...and {lastDeleteResult.errors.length - 5} more errors</li>
                  )}
                </ul>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Scan Results */}
      {!scanResult && !scanning && (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12 gap-4">
            <RefreshCw className="h-12 w-12 text-muted-foreground opacity-50" />
            <div className="text-center">
              <p className="font-medium">No scan results</p>
              <p className="text-muted-foreground">
                Click "Scan Database" to identify items for cleanup.
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {scanning && (
        <Card>
          <CardContent className="flex items-center justify-center py-12">
            <LoaderCircle className="h-8 w-8 animate-spin text-primary" />
            <span className="ml-3 text-muted-foreground">
              Scanning database for cleanup candidates...
            </span>
          </CardContent>
        </Card>
      )}

      {scanResult && !scanning && (
        <>
          {/* Summary */}
          <Card>
            <CardHeader>
              <CardTitle>Scan Summary</CardTitle>
              <CardDescription>
                Last scanned: {new Date(scanResult.timestamp).toLocaleString()}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="text-center p-4 bg-muted rounded-lg">
                  <div className="text-3xl font-bold">
                    {scanResult.summary.totalItems}
                  </div>
                  <div className="text-sm text-muted-foreground">
                    Total Items
                  </div>
                </div>
                <div className="text-center p-4 bg-muted rounded-lg">
                  <div className="text-3xl font-bold text-destructive">
                    {scanResult.summary.deletableItems}
                  </div>
                  <div className="text-sm text-muted-foreground">Deletable</div>
                </div>
                <div className="text-center p-4 bg-muted rounded-lg">
                  <div className="text-3xl font-bold text-blue-500">
                    {selectedItems.size}
                  </div>
                  <div className="text-sm text-muted-foreground">Selected</div>
                </div>
                <div className="text-center p-4 bg-muted rounded-lg">
                  <div className="text-3xl font-bold">
                    {scanResult.categories.filter((c) => c.totalCount > 0).length}
                  </div>
                  <div className="text-sm text-muted-foreground">Categories</div>
                </div>
              </div>

              {selectedItems.size > 0 && (
                <div className="mt-4 flex justify-end">
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button variant="destructive" disabled={deleting}>
                        {deleting ? (
                          <LoaderCircle className="h-4 w-4 animate-spin mr-2" />
                        ) : (
                          <Trash2 className="h-4 w-4 mr-2" />
                        )}
                        Delete {selectedItems.size} Selected Items
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle className="flex items-center gap-2">
                          <AlertTriangle className="h-5 w-5 text-destructive" />
                          Delete Selected Items?
                        </AlertDialogTitle>
                        <AlertDialogDescription>
                          This will permanently delete {selectedItems.size} items.
                          This action cannot be undone.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction
                          onClick={deleteSelected}
                          className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                        >
                          Delete Selected
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Categories */}
          {scanResult.categories
            .filter((c) => c.totalCount > 0)
            .map((category) => (
              <CategorySection
                key={category.name}
                category={category}
                selectedItems={selectedItems}
                onToggleItem={toggleItem}
                onToggleAll={toggleAll}
                onDeleteCategory={deleteCategory}
                isDeleting={deletingCategory === category.name}
              />
            ))}

          {scanResult.summary.totalItems === 0 && (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-12 gap-4">
                <CheckCircle2 className="h-12 w-12 text-green-500 opacity-50" />
                <div className="text-center">
                  <p className="font-medium">Database is clean</p>
                  <p className="text-muted-foreground">
                    No orphaned or deprecated data was found.
                  </p>
                </div>
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
