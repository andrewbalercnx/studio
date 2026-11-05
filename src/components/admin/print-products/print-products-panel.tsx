'use client';
import { useMemo, useState, useCallback } from 'react';
import { useFirestore } from '@/firebase';
import { collection, query, orderBy } from 'firebase/firestore';
import { useCollection } from '@/lib/firestore-hooks';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useToast } from '@/hooks/use-toast';
import { LoaderCircle, Plus, Edit, Trash2, Copy, Sprout } from 'lucide-react';
import type { PrintProduct } from '@/lib/types';
import { useUser } from '@/firebase/auth/use-user';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { api } from '@/lib/api';
import { PrintProductForm } from './print-product-form';

export function PrintProductsPanel() {
  const firestore = useFirestore();
  const { user } = useUser();
  const productsQuery = useMemo(
    () => (firestore ? query(collection(firestore, 'printProducts'), orderBy('displayOrder', 'asc')) : null),
    [firestore]
  );
  const { data: products, loading, error } = useCollection<PrintProduct>(productsQuery);
  const { toast } = useToast();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<PrintProduct | null>(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [productToDelete, setProductToDelete] = useState<PrintProduct | null>(null);
  const [isSeeding, setIsSeeding] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  const handleSeedProduct = useCallback(async () => {
    if (!user) return;

    setIsSeeding(true);
    try {
      const token = await user.getIdToken();
      const response = await fetch('/api/admin/print-products/seed', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      const result = await response.json();

      if (response.ok && result.ok) {
        toast({ title: 'Success', description: result.message });
      } else {
        toast({
          title: 'Seed failed',
          description: result.errorMessage || 'Unknown error',
          variant: 'destructive',
        });
      }
    } catch (error: any) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    } finally {
      setIsSeeding(false);
    }
  }, [user, toast]);

  const openCreate = () => {
    setEditingProduct(null);
    setDialogOpen(true);
  };

  const openEdit = (item: PrintProduct) => {
    setEditingProduct(item);
    setDialogOpen(true);
  };

  const openCopy = (item: PrintProduct) => {
    // Create a copy with a new name and no ID
    const copy: PrintProduct = {
      ...item,
      id: '',
      name: `${item.name} (Copy)`,
    };
    setEditingProduct(copy as any);
    setDialogOpen(true);
  };

  const confirmDelete = (item: PrintProduct) => {
    setProductToDelete(item);
    setDeleteDialogOpen(true);
  };

  const handleDelete = async () => {
    if (!firestore || !productToDelete) return;

    setIsDeleting(true);
    try {
      await api.catalog.admin.remove('printProducts', productToDelete.id);
      toast({ title: 'Product deleted' });
    } catch (error: any) {
      toast({ title: 'Error deleting product', description: error.message, variant: 'destructive' });
    } finally {
      setIsDeleting(false);
      setDeleteDialogOpen(false);
      setProductToDelete(null);
    }
  };

  const handleSave = () => {
    setDialogOpen(false);
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
          <CardTitle>Print Products</CardTitle>
          <CardDescription>Manage print product configurations for Mixam integration.</CardDescription>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={handleSeedProduct} disabled={isSeeding}>
            {isSeeding ? <LoaderCircle className="mr-2 h-4 w-4 animate-spin" /> : <Sprout className="mr-2 h-4 w-4" />}
            Seed Default
          </Button>
          <Button onClick={openCreate}>
            <Plus className="mr-2 h-4 w-4" /> New Product
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {loading && <LoaderCircle className="h-6 w-6 animate-spin text-muted-foreground" />}
        {error && <p className="text-sm text-destructive">Error loading products: {error.message}</p>}
        {!loading && products && products.length === 0 && (
          <p className="text-sm text-muted-foreground">No print products yet. Click &quot;Seed Default&quot; to create the initial hardcover product.</p>
        )}
        {!loading && products && products.length > 0 && (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Order</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {products.map((product) => (
                <TableRow key={product.id}>
                  <TableCell className="font-medium">{product.name}</TableCell>
                  <TableCell className="capitalize">{product.mixamSpec?.subProduct?.replace(/_/g, ' ') || 'N/A'}</TableCell>
                  <TableCell>
                    <span
                      className={`inline-flex items-center rounded-full px-2 py-1 text-xs font-medium ${
                        product.active
                          ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200'
                          : 'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-200'
                      }`}
                    >
                      {product.active ? 'Active' : 'Inactive'}
                    </span>
                  </TableCell>
                  <TableCell>{product.displayOrder}</TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      <Button variant="ghost" size="sm" onClick={() => openEdit(product)}>
                        <Edit className="h-4 w-4" />
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => openCopy(product)}>
                        <Copy className="h-4 w-4" />
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => confirmDelete(product)}>
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-4xl">
          <DialogHeader>
            <DialogTitle>{editingProduct?.id ? 'Edit Print Product' : 'New Print Product'}</DialogTitle>
          </DialogHeader>
          <PrintProductForm editingProduct={editingProduct} onSave={handleSave} />
        </DialogContent>
      </Dialog>

      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Print Product</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete &quot;{productToDelete?.name}&quot;? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} disabled={isDeleting} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              {isDeleting ? <LoaderCircle className="mr-2 h-4 w-4 animate-spin" /> : null}
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
