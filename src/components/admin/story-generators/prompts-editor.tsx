'use client';
import { LoaderCircle } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import type { StoryGenerator } from '@/lib/types';
import { PROMPT_DESCRIPTIONS } from './shared';

// Prompts Editor Component
export function PromptsEditor({
  generator,
  onSave,
}: {
  generator: StoryGenerator;
  onSave: (prompts: Record<string, string>) => Promise<void>;
}) {
  const { toast } = useToast();
  const [prompts, setPrompts] = useState<Record<string, string>>(generator.prompts || {});
  const [saving, setSaving] = useState(false);

  const promptKeys = Object.keys(PROMPT_DESCRIPTIONS[generator.id] || {});
  const hasChanges = JSON.stringify(prompts) !== JSON.stringify(generator.prompts || {});

  // Update local state when generator prop changes
  useEffect(() => {
    setPrompts(generator.prompts || {});
  }, [generator.prompts]);

  const handleSave = async () => {
    setSaving(true);
    try {
      await onSave(prompts);
      toast({ title: 'Saved', description: 'Prompts saved successfully' });
    } catch (error: any) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  if (promptKeys.length === 0) {
    return (
      <div className="text-sm text-muted-foreground">
        This generator uses storyTypes for its prompts configuration.
        See the Story Types admin page to edit prompts.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          Edit the AI prompts used by this generator. Changes take effect immediately.
        </p>
        {hasChanges && (
          <Button onClick={handleSave} disabled={saving}>
            {saving ? <LoaderCircle className="h-4 w-4 animate-spin mr-2" /> : null}
            Save All Prompts
          </Button>
        )}
      </div>

      {promptKeys.map((key) => (
        <div key={key} className="space-y-2">
          <Label htmlFor={`prompt-${key}`} className="font-medium">
            {key}
          </Label>
          <p className="text-xs text-muted-foreground mb-1">
            {PROMPT_DESCRIPTIONS[generator.id]?.[key] || 'Custom prompt'}
          </p>
          <Textarea
            id={`prompt-${key}`}
            value={prompts[key] || ''}
            onChange={(e) => setPrompts({ ...prompts, [key]: e.target.value })}
            placeholder={`Enter ${key} prompt...`}
            rows={6}
            className="font-mono text-sm"
          />
        </div>
      ))}
    </div>
  );
}
