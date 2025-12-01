
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
import { useForm, useFieldArray, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

const positiveNumber = z.preprocess(
  (val) => (val === '' ? undefined : parseFloat(String(val))),
  z.number({ required_error: "Value is required." }).positive("Must be a positive number.").optional()
);

const boxSchema = z.object({
  leaf: z.coerce.number().min(1, "Leaf must be 1 or 2.").max(2, "Leaf must be 1 or 2."),
  x: z.preprocess((val) => parseFloat(String(val)), z.number()),
  y: z.preprocess((val) => parseFloat(String(val)), z.number()),
  width: positiveNumber,
  height: positiveNumber,
});


const printLayoutFormSchema = z.object({
  id: z.string().optional(),
  name: z.string().min(1, 'Name is required'),
  leafWidth: positiveNumber,
  leafHeight: positiveNumber,
  leavesPerSpread: z.enum(['1', '2']),
  textBoxes: z.array(boxSchema).min(1, 'At least one text box is required'),
  imageBoxes: z.array(boxSchema).min(1, 'At least one image box is required'),
});


type PrintLayoutFormValues = z.infer<typeof printLayoutFormSchema>;

const defaultFormValues: PrintLayoutFormValues = {
  name: '',
  leafWidth: 8.5,
  leafHeight: 11,
  leavesPerSpread: '1',
  textBoxes: [{ leaf: 1, x: 1, y: 7, width: 6.5, height: 3 }],
  imageBoxes: [{ leaf: 1, x: 1, y: 1, width: 6.5, height: 5.5 }],
};

function PrintLayoutForm({
  editingLayout,
  onSave,
}: {
  editingLayout?: PrintLayout | null;
  onSave: () => void;
}) {
  const firestore = useFirestore();
  const { toast } = useToast();
  const [isSaving, setIsSaving] = useState(false);

  const {
    register,
    control,
    handleSubmit,
    formState: { errors },
  } = useForm<PrintLayoutFormValues>({
    resolver: zodResolver(printLayoutFormSchema),
    defaultValues: editingLayout
      ? {
          id: editingLayout.id,
          name: editingLayout.name,
          leafWidth: editingLayout.leafWidth,
          leafHeight: editingLayout.leafHeight,
          leavesPerSpread: String(editingLayout.leavesPerSpread) as '1' | '2',
          textBoxes: editingLayout.textBoxes || [],
          imageBoxes: editingLayout.imageBoxes || [],
        }
      : defaultFormValues,
  });

  const {
    fields: textBoxFields,
    append: appendTextBox,
    remove: removeTextBox,
  } = useFieldArray({
    control,
    name: 'textBoxes',
  });
  const {
    fields: imageBoxFields,
    append: appendImageBox,
    remove: removeImageBox,
  } = useFieldArray({
    control,
    name: 'imageBoxes',
  });

  const onSubmit = async (data: PrintLayoutFormValues) => {
    if (!firestore) return;

    setIsSaving(true);
    const payload = {
      ...data,
      leavesPerSpread: Number(data.leavesPerSpread) as 1 | 2,
      updatedAt: serverTimestamp(),
    };

    try {
      const docRef = data.id ? doc(firestore, 'printLayouts', data.id) : doc(collection(firestore, 'printLayouts'));
      await setDoc(
        docRef,
        { ...payload, createdAt: payload.updatedAt },
        { merge: true }
      );
      toast({ title: 'Print layout saved' });
      onSave();
    } catch (error: any) {
      toast({ title: 'Error saving layout', description: error.message, variant: 'destructive' });
    } finally {
      setIsSaving(false);
    }
  };
  
  const renderBoxFields = (
    fields: any[],
    removeFn: (index: number) => void,
    prefix: 'textBoxes' | 'imageBoxes'
  ) => (
    <div className="space-y-3">
      {fields.map((field, index) => (
        <div key={field.id} className="grid grid-cols-6 gap-2 items-center rounded-md border p-2">
          <div className="col-span-6 text-xs font-semibold uppercase text-muted-foreground">Box {index + 1}</div>
          <div className="space-y-1">
            <Label className="text-xs">Leaf</Label>
            <Input type="number" {...register(`${prefix}.${index}.leaf`)} defaultValue={field.leaf} />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">X</Label>
            <Input type="number" step="0.1" {...register(`${prefix}.${index}.x`)} defaultValue={field.x} />
          </div>
           <div className="space-y-1">
            <Label className="text-xs">Y</Label>
            <Input type="number" step="0.1" {...register(`${prefix}.${index}.y`)} defaultValue={field.y} />
          </div>
           <div className="space-y-1">
            <Label className="text-xs">W</Label>
            <Input type="number" step="0.1" {...register(`${prefix}.${index}.width`)} defaultValue={field.width} />
          </div>
           <div className="space-y-1">
            <Label className="text-xs">H</Label>
            <Input type="number" step="0.1" {...register(`${prefix}.${index}.height`)} defaultValue={field.height} />
          </div>
           <Button variant="ghost" size="icon" onClick={() => removeFn(index)} className="self-end">
             <Trash2 className="h-4 w-4 text-destructive" />
           </Button>
        </div>
      ))}
    </div>
  );

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="grid gap-2">
          <Label htmlFor="layout-name">Name</Label>
          <Input id="layout-name" {...register('name')} placeholder="e.g. 8.5x11 Portrait" />
          {errors.name && <p className="text-xs text-destructive">{errors.name.message}</p>}
        </div>
        <div className="grid gap-2">
          <Label>Leaves per Spread</Label>
          <Controller
            name="leavesPerSpread"
            control={control}
            render={({ field }) => (
              <Select onValueChange={field.onChange} defaultValue={field.value}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="1">1 (Single Page)</SelectItem>
                  <SelectItem value="2">2 (Facing Pages)</SelectItem>
                </SelectContent>
              </Select>
            )}
          />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div className="grid gap-2">
          <Label htmlFor="leaf-width">Leaf Width (in)</Label>
          <Input id="leaf-width" type="number" step="0.01" {...register('leafWidth')} />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="leaf-height">Leaf Height (in)</Label>
          <Input id="leaf-height" type="number" step="0.01" {...register('leafHeight')} />
        </div>
      </div>
      
      <div>
        <div className="flex items-center justify-between mb-2">
          <Label>Text Boxes</Label>
          <Button type="button" size="sm" variant="outline" onClick={() => appendTextBox({ leaf: 1, x: 1, y: 1, width: 6, height: 2 })}>
            <Plus className="mr-2 h-4 w-4" /> Add
          </Button>
        </div>
        {renderBoxFields(textBoxFields, removeTextBox, 'textBoxes')}
        {errors.textBoxes && <p className="text-xs text-destructive mt-1">{errors.textBoxes.message || errors.textBoxes.root?.message}</p>}
      </div>

       <div>
        <div className="flex items-center justify-between mb-2">
          <Label>Image Boxes</Label>
          <Button type="button" size="sm" variant="outline" onClick={() => appendImageBox({ leaf: 1, x: 1, y: 1, width: 6, height: 4 })}>
            <Plus className="mr-2 h-4 w-4" /> Add
          </Button>
        </div>
        {renderBoxFields(imageBoxFields, removeImageBox, 'imageBoxes')}
        {errors.imageBoxes && <p className="text-xs text-destructive mt-1">{errors.imageBoxes.message || errors.imageBoxes.root?.message}</p>}
      </div>

      <DialogFooter>
        <Button type="submit" disabled={isSaving}>
          {isSaving ? <LoaderCircle className="mr-2 h-4 w-4 animate-spin" /> : null}
          Save Layout
        </Button>
      </DialogFooter>
    </form>
  );
}


function PrintLayoutsPanel() {
  const firestore = useFirestore();
  const layoutsQuery = useMemo(() => (firestore ? collection(firestore, 'printLayouts') : null), [firestore]);
  const { data: layouts, loading, error } = useCollection<PrintLayout>(layoutsQuery);
  const { toast } = useToast();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingLayout, setEditingLayout] = useState<PrintLayout | null>(null);

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
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>{editingLayout ? 'Edit Print Layout' : 'New Print Layout'}</DialogTitle>
          </DialogHeader>
          <PrintLayoutForm editingLayout={editingLayout} onSave={handleSave} />
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
