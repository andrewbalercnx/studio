'use client';
import { useMemo, useState, useEffect, useCallback } from 'react';
import { useFirestore } from '@/firebase';
import { collection } from 'firebase/firestore';
import { useCollection } from '@/lib/firestore-hooks';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useToast } from '@/hooks/use-toast';
import { LoaderCircle, Plus, Edit, Trash2, Link2, Copy } from 'lucide-react';
import type { PrintLayout, PrintProduct } from '@/lib/types';
import SampleLayoutData from '@/data/print-layouts.json';
import { query, where } from 'firebase/firestore';
import { api } from '@/lib/api';
import { PrintLayoutForm } from './print-layout-form';

export function PrintLayoutsPanel() {
  const firestore = useFirestore();
  const layoutsQuery = useMemo(() => (firestore ? collection(firestore, 'printLayouts') : null), [firestore]);
  const { data: layouts, loading, error } = useCollection<PrintLayout>(layoutsQuery);

  // Load print products for the form dropdown
  const printProductsQuery = useMemo(
    () => firestore ? query(collection(firestore, 'printProducts'), where('active', '==', true)) : null,
    [firestore]
  );
  const { data: printProducts, loading: productsLoading } = useCollection<PrintProduct>(printProductsQuery);

  const { toast } = useToast();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingLayout, setEditingLayout] = useState<PrintLayout | null>(null);

  const handleSeedLayouts = useCallback(async () => {
    if (!firestore) return;
    try {
      await api.catalog.admin.batch(
        'printLayouts',
        SampleLayoutData.printLayouts.map((layout) => ({ id: layout.id, data: layout as unknown as Record<string, unknown> }))
      );
      toast({ title: 'Success', description: 'Default print layout has been seeded.' });
    } catch (e: any) {
      toast({ title: 'Error seeding data', description: e.message, variant: 'destructive' });
    }
  }, [firestore, toast]);
  
  useEffect(() => {
    if (!loading && !error && layouts?.length === 0) {
      handleSeedLayouts();
    }
  }, [loading, error, layouts, handleSeedLayouts]);

  const openCreate = () => {
    setEditingLayout(null);
    setDialogOpen(true);
  };

  const openEdit = (item: PrintLayout) => {
    setEditingLayout(item);
    setDialogOpen(true);
  };
  
  const handleSave = () => {
    setDialogOpen(false);
  };

  const handleDuplicate = async (layout: PrintLayout) => {
    if (!firestore) return;
    try {
      const { id, createdAt, updatedAt, ...layoutData } = layout;
      await api.catalog.admin.create('printLayouts', { ...layoutData, name: `${layout.name} (Copy)` });
      toast({ title: 'Layout duplicated', description: `Created "${layout.name} (Copy)"` });
    } catch (e: any) {
      toast({ title: 'Error duplicating layout', description: e.message, variant: 'destructive' });
    }
  };

  const handleDelete = async (layout: PrintLayout) => {
    if (!firestore) return;
    if (!confirm(`Are you sure you want to delete "${layout.name}"? This cannot be undone.`)) {
      return;
    }
    try {
      await api.catalog.admin.remove('printLayouts', layout.id);
      toast({ title: 'Layout deleted', description: `"${layout.name}" has been deleted.` });
    } catch (e: any) {
      toast({ title: 'Error deleting layout', description: e.message, variant: 'destructive' });
    }
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
          <CardTitle>Print Layouts</CardTitle>
          <CardDescription>Manage the physical layouts for printed books.</CardDescription>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={handleSeedLayouts}>
            Re-seed Defaults
          </Button>
          <Button onClick={openCreate}>
            <Plus className="mr-2 h-4 w-4" /> New Layout
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {(loading || productsLoading) && <LoaderCircle className="h-6 w-6 animate-spin text-muted-foreground" />}
        {!loading && !productsLoading && layouts && layouts.length === 0 && (
          <p className="text-sm text-muted-foreground">No print layouts yet. Seeding default...</p>
        )}
        {!loading && !productsLoading && layouts && layouts.length > 0 && (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Dimensions</TableHead>
                <TableHead>Spreads</TableHead>
                <TableHead>Print Product</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {layouts.map((layout) => {
                const linkedProduct = layout.printProductId
                  ? printProducts?.find(p => p.id === layout.printProductId)
                  : null;
                return (
                  <TableRow key={layout.id}>
                    <TableCell className="font-medium">{layout.name}</TableCell>
                    <TableCell>{layout.leafWidth}" x {layout.leafHeight}"</TableCell>
                    <TableCell>{layout.leavesPerSpread === 2 ? 'Two-leaf' : 'One-leaf'}</TableCell>
                    <TableCell>
                      {linkedProduct ? (
                        <span className="flex items-center gap-1 text-sm">
                          <Link2 className="h-3 w-3 text-green-600" />
                          {linkedProduct.name}
                        </span>
                      ) : (
                        <span className="text-muted-foreground text-sm">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        <Button variant="ghost" size="sm" onClick={() => openEdit(layout)}>
                          <Edit className="mr-1 h-4 w-4" /> Edit
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => handleDuplicate(layout)}>
                          <Copy className="mr-1 h-4 w-4" /> Duplicate
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => handleDelete(layout)} className="text-destructive hover:text-destructive">
                          <Trash2 className="mr-1 h-4 w-4" /> Delete
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </CardContent>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingLayout ? 'Edit Print Layout' : 'New Print Layout'}</DialogTitle>
          </DialogHeader>
          <PrintLayoutForm
            editingLayout={editingLayout}
            onSave={handleSave}
            printProducts={printProducts || []}
          />
        </DialogContent>
      </Dialog>
    </Card>
  );
}
