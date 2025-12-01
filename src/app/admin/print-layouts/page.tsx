
'use client';

import { useMemo, useState, useEffect, useCallback } from 'react';
import { useFirestore } from '@/firebase';
import { collection, doc, addDoc, setDoc, serverTimestamp } from 'firebase/firestore';
import { useCollection } from '@/lib/firestore-hooks';
import { useAdminStatus } from '@/hooks/use-admin-status';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useToast } from '@/hooks/use-toast';
import { LoaderCircle, Plus, Edit, Trash2 } from 'lucide-react';
import type { PrintLayout } from '@/lib/types';
import SampleLayoutData from '@/data/print-layouts.json';
import { writeBatch } from 'firebase/firestore';

type PrintLayoutForm = {
  id?: string;
  name: string;
  leafWidth: string;
  leafHeight: string;
  leavesPerSpread: '1' | '2';
};

const defaultForm: PrintLayoutForm = {
  name: '',
  leafWidth: '8.5',
  leafHeight: '11',
  leavesPerSpread: '1',
};

function PrintLayoutsPanel() {
  const firestore = useFirestore();
  const layoutsQuery = useMemo(() => (firestore ? collection(firestore, 'printLayouts') : null), [firestore]);
  const { data: layouts, loading, error } = useCollection<PrintLayout>(layoutsQuery);
  const { toast } = useToast();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [form, setForm] = useState<PrintLayoutForm>(defaultForm);

  const handleSeedLayouts = useCallback(async () => {
    if (!firestore) return;
    try {
      const batch = writeBatch(firestore);
      SampleLayoutData.printLayouts.forEach((layout) => {
        const docRef = doc(firestore, 'printLayouts', layout.id);
        batch.set(docRef, {
          ...layout,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      });
      await batch.commit();
      toast({ title: 'Success', description: 'Default print layout has been seeded.' });
    } catch (e: any) {
      toast({ title: 'Error seeding data', description: e.message, variant: 'destructive' });
    }
  }, [firestore, toast]);
  
  useEffect(() => {
    // If loading is finished, there's no error, and the collection is empty, seed it.
    if (!loading && !error && layouts?.length === 0) {
      handleSeedLayouts();
    }
  }, [loading, error, layouts, handleSeedLayouts]);

  const openCreate = () => {
    setForm(defaultForm);
    setDialogOpen(true);
  };

  const openEdit = (item: PrintLayout) => {
    setForm({
      id: item.id,
      name: item.name,
      leafWidth: String(item.leafWidth),
      leafHeight: String(item.leafHeight),
      leavesPerSpread: String(item.leavesPerSpread) as '1' | '2',
    });
    setDialogOpen(true);
  };

  const handleSave = async () => {
    if (!firestore) return;
    if (!form.name) {
      toast({ title: 'Name is required.', variant: 'destructive' });
      return;
    }
    setIsSaving(true);
    
    // Basic hardcoded boxes for now
    const textBoxes = [{ leaf: 1, x: 1, y: 7, width: 6.5, height: 3 }];
    const imageBoxes = [{ leaf: 1, x: 1, y: 1, width: 6.5, height: 5.5 }];

    const payload = {
      name: form.name,
      leafWidth: parseFloat(form.leafWidth) || 8.5,
      leafHeight: parseFloat(form.leafHeight) || 11,
      leavesPerSpread: parseInt(form.leavesPerSpread, 10) as 1 | 2,
      textBoxes,
      imageBoxes,
      updatedAt: serverTimestamp(),
    };
    try {
      const docRef = form.id ? doc(firestore, 'printLayouts', form.id) : doc(collection(firestore, 'printLayouts'));
      await setDoc(docRef, { ...payload, createdAt: payload.updatedAt }, { merge: true });
      
      toast({ title: 'Print layout saved' });
      setDialogOpen(false);
    } catch (error: any) {
      toast({ title: 'Error saving layout', description: error.message, variant: 'destructive' });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
          <CardTitle>Print Layouts</CardTitle>
          <CardDescription>Manage the physical layouts for printed books.</CardDescription>
        </div>
        <Button onClick={openCreate}>
          <Plus className="mr-2 h-4 w-4" /> New Layout
        </Button>
      </CardHeader>
      <CardContent>
        {loading && <LoaderCircle className="h-6 w-6 animate-spin text-muted-foreground" />}
        {!loading && layouts && layouts.length === 0 && (
          <p className="text-sm text-muted-foreground">No print layouts yet. Seeding default...</p>
        )}
        {!loading && layouts && layouts.length > 0 && (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Dimensions</TableHead>
                <TableHead>Spreads</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {layouts.map((layout) => (
                <TableRow key={layout.id}>
                  <TableCell className="font-medium">{layout.name}</TableCell>
                  <TableCell>{layout.leafWidth}" x {layout.leafHeight}"</TableCell>
                  <TableCell>{layout.leavesPerSpread === 2 ? 'Two-leaf' : 'One-leaf'}</TableCell>
                  <TableCell className="text-right">
                    <Button variant="ghost" size="sm" onClick={() => openEdit(layout)}>
                      <Edit className="mr-1 h-4 w-4" /> Edit
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{form.id ? 'Edit Print Layout' : 'New Print Layout'}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="layout-name">Name</Label>
              <Input id="layout-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. 8.5x11 Portrait" />
            </div>
            <div className="grid grid-cols-2 gap-4">
                <div className="grid gap-2">
                    <Label htmlFor="leaf-width">Leaf Width (in)</Label>
                    <Input id="leaf-width" type="number" value={form.leafWidth} onChange={(e) => setForm({ ...form, leafWidth: e.target.value })} />
                </div>
                <div className="grid gap-2">
                    <Label htmlFor="leaf-height">Leaf Height (in)</Label>
                    <Input id="leaf-height" type="number" value={form.leafHeight} onChange={(e) => setForm({ ...form, leafHeight: e.target.value })} />
                </div>
            </div>
          </div>
          <DialogFooter>
            <Button onClick={handleSave} disabled={isSaving}>
              {isSaving ? <LoaderCircle className="mr-2 h-4 w-4 animate-spin" /> : null}
              Save Layout
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

export default function AdminPrintLayoutsPage() {
    const { isAdmin, loading: adminLoading } = useAdminStatus();

    if (adminLoading) {
        return <div className="flex justify-center items-center h-screen"><LoaderCircle className="h-8 w-8 animate-spin" /></div>;
    }

    if (!isAdmin) {
        return <p className="text-destructive text-center p-8">Admin access required.</p>;
    }

    return (
        <div className="container mx-auto p-4 sm:p-6 md:p-8">
            <PrintLayoutsPanel />
        </div>
    );
}
