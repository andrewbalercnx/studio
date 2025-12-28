'use client';

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import type { HelpWizardPage, HelpWizardPosition } from '@/lib/types';
import { DEFAULT_WIZARD_POSITION } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { PositionSelector } from '@/components/ui/position-selector';

const pageSchema = z.object({
  title: z.string().min(1, "Title is required"),
  description: z.string().min(1, "Description is required"),
  route: z.string().min(1, "Route is required (e.g., /parent/children)"),
  wizardTargetId: z.string().optional(),
  highlightSelector: z.string().optional(),
});

type HelpWizardPageFormValues = z.infer<typeof pageSchema>;

interface HelpWizardPageFormProps {
  page: HelpWizardPage | null;
  onSave: (page: HelpWizardPage) => void;
  onCancel: () => void;
}

export function HelpWizardPageForm({ page, onSave, onCancel }: HelpWizardPageFormProps) {
  const [position, setPosition] = useState<HelpWizardPosition>(
    page?.position || DEFAULT_WIZARD_POSITION
  );

  const { register, handleSubmit, formState: { errors } } = useForm<HelpWizardPageFormValues>({
    resolver: zodResolver(pageSchema),
    defaultValues: {
      title: page?.title || '',
      description: page?.description || '',
      route: page?.route || '',
      wizardTargetId: page?.wizardTargetId || '',
      highlightSelector: page?.highlightSelector || '',
    }
  });

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    e.stopPropagation();
    handleSubmit((data) => {
      onSave({ ...data, position });
    })(e);
  };

  return (
    <form onSubmit={onSubmit} className="space-y-4">
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
        <Label htmlFor="page-wizard-target">Wizard Target ID (recommended)</Label>
        <Input id="page-wizard-target" {...register('wizardTargetId')} placeholder="header-user-menu" />
        <p className="text-xs text-muted-foreground">
          Target ID from data-wiz-target attribute. Enable &quot;Show Wizard Targets&quot; in the user menu to see available targets.
        </p>
      </div>
      <div className="space-y-2">
        <Label htmlFor="page-highlight">Highlight Selector (legacy)</Label>
        <Input id="page-highlight" {...register('highlightSelector')} placeholder="#element-id or .class-name" />
        <p className="text-xs text-muted-foreground">CSS selector fallback if no Wizard Target ID is set (e.g., #submit-btn, .nav-menu)</p>
      </div>
      <div className="space-y-2">
        <Label>Card Position</Label>
        <div className="flex items-center gap-4">
          <PositionSelector value={position} onChange={setPosition} />
          <p className="text-xs text-muted-foreground flex-1">
            Choose where the help card appears on screen. Default is bottom center.
          </p>
        </div>
      </div>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onCancel}>Cancel</Button>
        <Button type="submit">Save Page</Button>
      </div>
    </form>
  );
}
