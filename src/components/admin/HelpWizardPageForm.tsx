'use client';

import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import type { HelpWizardPage } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';

const pageSchema = z.object({
  title: z.string().min(1, "Title is required"),
  description: z.string().min(1, "Description is required"),
  route: z.string().min(1, "Route is required (e.g., /parent/children)"),
  highlightSelector: z.string().optional(),
});

type HelpWizardPageFormValues = z.infer<typeof pageSchema>;

interface HelpWizardPageFormProps {
  page: HelpWizardPage | null;
  onSave: (page: HelpWizardPage) => void;
  onCancel: () => void;
}

export function HelpWizardPageForm({ page, onSave, onCancel }: HelpWizardPageFormProps) {
  const { register, handleSubmit, formState: { errors } } = useForm<HelpWizardPageFormValues>({
    resolver: zodResolver(pageSchema),
    defaultValues: {
      title: page?.title || '',
      description: page?.description || '',
      route: page?.route || '',
      highlightSelector: page?.highlightSelector || '',
    }
  });

  const onSubmit = (data: HelpWizardPageFormValues) => {
    onSave(data);
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="page-title">Page Title</Label>
        <Input id="page-title" {...register('title')} />
        {errors.title && <p className="text-xs text-destructive">{errors.title.message}</p>}
      </div>
      <div className="space-y-2">
        <Label htmlFor="page-description">Description</Label>
        <Textarea id="page-description" {...register('description')} rows={3} />
        {errors.description && <p className="text-xs text-destructive">{errors.description.message}</p>}
      </div>
      <div className="space-y-2">
        <Label htmlFor="page-route">Route</Label>
        <Input id="page-route" {...register('route')} placeholder="/path/to/page" />
        {errors.route && <p className="text-xs text-destructive">{errors.route.message}</p>}
      </div>
      <div className="space-y-2">
        <Label htmlFor="page-highlight">Highlight Selector (optional)</Label>
        <Input id="page-highlight" {...register('highlightSelector')} placeholder="#element-id or .class-name" />
        <p className="text-xs text-muted-foreground">CSS selector to highlight an element on the page (e.g., #submit-btn, .nav-menu)</p>
      </div>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onCancel}>Cancel</Button>
        <Button type="submit">Save Page</Button>
      </div>
    </form>
  );
}
