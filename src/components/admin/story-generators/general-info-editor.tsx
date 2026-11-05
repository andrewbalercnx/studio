'use client';
import { LoaderCircle } from 'lucide-react';
import { Switch } from '@/components/ui/switch';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import type { StoryGenerator } from '@/lib/types';
import { DEFAULT_GENERATOR_INFO } from './shared';

// General Info Editor Component
export function GeneralInfoEditor({
  generator,
  onSave,
}: {
  generator: StoryGenerator;
  onSave: (data: { name: string; description: string; enabledForKids?: boolean; order?: number }) => Promise<void>;
}) {
  const { toast } = useToast();
  const defaultInfo = DEFAULT_GENERATOR_INFO[generator.id] || { name: generator.id, description: '' };
  const [name, setName] = useState(generator.name || defaultInfo.name);
  const [description, setDescription] = useState(generator.description || defaultInfo.description);
  const [enabledForKids, setEnabledForKids] = useState(generator.enabledForKids ?? true);
  const [order, setOrder] = useState<number | undefined>(generator.order);
  const [saving, setSaving] = useState(false);

  const hasChanges = name !== (generator.name || defaultInfo.name) ||
    description !== (generator.description || defaultInfo.description) ||
    enabledForKids !== (generator.enabledForKids ?? true) ||
    order !== generator.order;

  // Update local state when generator prop changes
  useEffect(() => {
    setName(generator.name || defaultInfo.name);
    setDescription(generator.description || defaultInfo.description);
    setEnabledForKids(generator.enabledForKids ?? true);
    setOrder(generator.order);
  }, [generator.name, generator.description, generator.enabledForKids, generator.order, defaultInfo.name, defaultInfo.description]);

  const handleSave = async () => {
    if (!name.trim()) {
      toast({ title: 'Error', description: 'Name is required', variant: 'destructive' });
      return;
    }
    setSaving(true);
    try {
      await onSave({ name: name.trim(), description: description.trim(), enabledForKids, order });
      toast({ title: 'Saved', description: 'Generator info updated successfully' });
    } catch (error: any) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Edit the display name and description shown throughout the app.
      </p>

      <div className="space-y-2">
        <Label htmlFor="generatorName">Display Name</Label>
        <Input
          id="generatorName"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Enter generator name..."
        />
        <p className="text-xs text-muted-foreground">
          This name is shown to users when selecting a story creation mode.
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="generatorDescription">Description</Label>
        <Textarea
          id="generatorDescription"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Enter description..."
          rows={2}
        />
        <p className="text-xs text-muted-foreground">
          A brief description of what this generator does.
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="generatorOrder">Display Order</Label>
        <Input
          id="generatorOrder"
          type="number"
          value={order ?? ''}
          onChange={(e) => setOrder(e.target.value ? parseInt(e.target.value, 10) : undefined)}
          placeholder="0"
          className="w-32"
        />
        <p className="text-xs text-muted-foreground">
          Lower numbers appear first on story creation pages. Default is 0.
        </p>
      </div>

      <div className="flex items-center justify-between p-4 rounded-lg border bg-muted/30">
        <div className="space-y-0.5">
          <Label htmlFor="enabledForKids" className="text-base">Enabled for Kids</Label>
          <p className="text-sm text-muted-foreground">
            Show this generator as an option in the kids story creation flow
          </p>
        </div>
        <Switch
          id="enabledForKids"
          checked={enabledForKids}
          onCheckedChange={setEnabledForKids}
        />
      </div>

      <div className="space-y-4 pt-4 border-t text-sm">
        <div>
          <Label className="text-muted-foreground">ID</Label>
          <p className="font-mono">{generator.id}</p>
        </div>
        <div>
          <Label className="text-muted-foreground">API Endpoint</Label>
          <p className="font-mono">{generator.apiEndpoint}</p>
        </div>
        {generator.styling && (
          <div>
            <Label className="text-muted-foreground">Styling</Label>
            <p>Gradient: {generator.styling.gradient}</p>
            <p>Loading: {generator.styling.loadingMessage}</p>
          </div>
        )}
      </div>

      {hasChanges && (
        <div className="pt-4">
          <Button onClick={handleSave} disabled={saving}>
            {saving ? <LoaderCircle className="h-4 w-4 animate-spin mr-2" /> : null}
            Save Changes
          </Button>
        </div>
      )}
    </div>
  );
}
