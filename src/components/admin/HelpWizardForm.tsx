'use client';

import { useState } from 'react';
import { useForm, useFieldArray, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useFirestore } from '@/firebase';
import { doc, setDoc, serverTimestamp, addDoc, collection } from 'firebase/firestore';
import { useToast } from '@/hooks/use-toast';
import type { HelpWizard, HelpWizardPage } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { LoaderCircle, PlusCircle, Trash2, ArrowUp, ArrowDown, Edit } from 'lucide-react';
import { HelpWizardPageForm } from './HelpWizardPageForm';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';

const wizardSchema = z.object({
  title: z.string().min(3, "Title must be at least 3 characters"),
  status: z.enum(['draft', 'live']),
  order: z.coerce.number().int().min(0, "Order must be 0 or greater"),
  pages: z.array(z.object({
    title: z.string().min(1),
    description: z.string().min(1),
    route: z.string().min(1),
    highlightSelector: z.string().optional(),
  })).min(1, "At least one page is required"),
});

type HelpWizardFormValues = z.infer<typeof wizardSchema>;

export function HelpWizardForm({ wizard, onSave }: { wizard: HelpWizard | null, onSave: () => void }) {
  const firestore = useFirestore();
  const { toast } = useToast();
  const [isSaving, setIsSaving] = useState(false);
  const [pageFormOpen, setPageFormOpen] = useState(false);
  const [editingPageIndex, setEditingPageIndex] = useState<number | null>(null);

  const { control, register, handleSubmit, formState: { errors }, setValue } = useForm<HelpWizardFormValues>({
    resolver: zodResolver(wizardSchema),
    defaultValues: {
      title: wizard?.title || '',
      status: wizard?.status || 'draft',
      order: wizard?.order ?? 0,
      pages: wizard?.pages || [],
    }
  });

  const { fields, append, remove, move } = useFieldArray({
    control,
    name: 'pages'
  });

  const openPageForm = (index: number | null = null) => {
    setEditingPageIndex(index);
    setPageFormOpen(true);
  };

  const handleSavePage = (pageData: HelpWizardPage, index: number | null) => {
    if (index !== null) {
      setValue(`pages.${index}`, pageData, { shouldValidate: true });
    } else {
      append(pageData);
    }
    setPageFormOpen(false);
  };

  const onSubmit = async (data: HelpWizardFormValues) => {
    if (!firestore) return;
    setIsSaving(true);
    
    const payload = {
      ...data,
      updatedAt: serverTimestamp(),
    };

    try {
      if (wizard) {
        await setDoc(doc(firestore, 'helpWizards', wizard.id), payload, { merge: true });
      } else {
        const newDocRef = doc(collection(firestore, 'helpWizards'));
        await setDoc(newDocRef, { ...payload, id: newDocRef.id, createdAt: serverTimestamp() });
      }
      toast({ title: 'Success', description: 'Help wizard saved.' });
      onSave();
    } catch (e: any) {
      toast({ title: 'Error', description: e.message, variant: 'destructive' });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
      <Dialog open={pageFormOpen} onOpenChange={setPageFormOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingPageIndex !== null ? 'Edit Page' : 'Add New Page'}</DialogTitle>
            <DialogDescription>Define a step in the guided tour.</DialogDescription>
          </DialogHeader>
          <HelpWizardPageForm
            page={editingPageIndex !== null ? fields[editingPageIndex] : null}
            onSave={(pageData) => handleSavePage(pageData, editingPageIndex)}
            onCancel={() => setPageFormOpen(false)}
          />
        </DialogContent>
      </Dialog>
      
      <div className="space-y-2">
        <Label htmlFor="title">Wizard Title</Label>
        <Input id="title" {...register('title')} />
        {errors.title && <p className="text-xs text-destructive">{errors.title.message}</p>}
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="status">Status</Label>
          <Controller
            name="status"
            control={control}
            render={({ field }) => (
              <Select onValueChange={field.onChange} defaultValue={field.value}>
                <SelectTrigger id="status"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="draft">Draft</SelectItem>
                  <SelectItem value="live">Live</SelectItem>
                </SelectContent>
              </Select>
            )}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="order">Display Order</Label>
          <Input id="order" type="number" min={0} {...register('order')} />
          {errors.order && <p className="text-xs text-destructive">{errors.order.message}</p>}
        </div>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-lg">Pages</CardTitle>
          <Button type="button" variant="outline" size="sm" onClick={() => openPageForm()}>
            <PlusCircle className="mr-2 h-4 w-4" />
            Add Page
          </Button>
        </CardHeader>
        <CardContent className="space-y-2">
          {fields.map((field, index) => (
            <div key={field.id} className="flex items-center gap-2 rounded-md border p-3">
              <div className="flex-grow">
                <p className="font-semibold">{field.title}</p>
                <p className="text-sm text-muted-foreground">{field.route}</p>
              </div>
              <div className="flex items-center gap-1">
                <Button type="button" variant="ghost" size="icon" disabled={index === 0} onClick={() => move(index, index - 1)}>
                  <ArrowUp className="h-4 w-4" />
                </Button>
                <Button type="button" variant="ghost" size="icon" disabled={index === fields.length - 1} onClick={() => move(index, index + 1)}>
                  <ArrowDown className="h-4 w-4" />
                </Button>
                <Button type="button" variant="ghost" size="icon" onClick={() => openPageForm(index)}>
                    <Edit className="h-4 w-4" />
                </Button>
                <Button type="button" variant="ghost" size="icon" className="text-destructive" onClick={() => remove(index)}>
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </div>
          ))}
          {fields.length === 0 && <p className="text-sm text-muted-foreground text-center py-4">No pages yet. Add one to start.</p>}
          {errors.pages && <p className="text-xs text-destructive">{errors.pages.message}</p>}
        </CardContent>
      </Card>
      
      <Button type="submit" disabled={isSaving} className="w-full">
        {isSaving ? <LoaderCircle className="animate-spin mr-2" /> : null}
        Save Wizard
      </Button>
    </form>
  );
}
