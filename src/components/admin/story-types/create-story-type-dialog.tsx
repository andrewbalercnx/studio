'use client';
import { LoaderCircle, Plus } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import type { StoryType } from '@/lib/types';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { defaultPromptConfig } from './shared';

// Create Story Type Dialog Component
export function CreateStoryTypeDialog({
  open,
  onOpenChange,
  onCreate
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreate: (storyType: Omit<StoryType, 'createdAt' | 'updatedAt'>) => Promise<void>;
}) {
  const [saving, setSaving] = useState(false);
  const [formData, setFormData] = useState({
    id: '',
    name: '',
    shortDescription: '',
    ageFrom: 3 as number | null,
    ageTo: 5 as number | null,
    status: 'draft' as 'live' | 'draft',
    tags: ''
  });

  const handleCreate = async () => {
    if (!formData.id || !formData.name || !formData.shortDescription) return;

    setSaving(true);
    try {
      const newStoryType: Omit<StoryType, 'createdAt' | 'updatedAt'> = {
        id: formData.id,
        name: formData.name,
        shortDescription: formData.shortDescription,
        ageFrom: formData.ageFrom,
        ageTo: formData.ageTo,
        status: formData.status,
        tags: formData.tags.split(',').map(t => t.trim()).filter(Boolean),
        defaultPhaseId: 'story_beat_phase_v1',
        endingPhaseId: 'ending_phase_v1',
        levelBands: ['low', 'medium', 'high'],
        arcTemplate: {
          steps: [
            { id: 'introduce_character', label: 'Introduce Character', guidance: 'Introduce the main character in their familiar world.' },
            { id: 'inciting_incident', label: 'Inciting Incident', guidance: 'Something happens that sets the story in motion.' },
            { id: 'rising_action', label: 'Rising Action', guidance: 'The character faces challenges or makes discoveries.' },
            { id: 'climax', label: 'Climax', guidance: 'The story reaches its most exciting moment.' },
            { id: 'resolution', label: 'Resolution', guidance: 'The challenge is resolved and things begin to settle.' },
            { id: 'happy_close', label: 'Happy Close', guidance: 'End on a warm, satisfying note.' }
          ]
        },
        promptConfig: { ...defaultPromptConfig }
      };

      await onCreate(newStoryType);

      // Reset form
      setFormData({
        id: '',
        name: '',
        shortDescription: '',
        ageFrom: 3,
        ageTo: 5,
        status: 'draft',
        tags: ''
      });
      onOpenChange(false);
    } finally {
      setSaving(false);
    }
  };

  const handleNameChange = (name: string) => {
    setFormData({
      ...formData,
      name,
      // Auto-generate ID from name if ID is empty or was auto-generated
      id: formData.id === '' || formData.id === formData.name.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '') + '_v1'
        ? name.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '') + '_v1'
        : formData.id
    });
  };

  const isValid = formData.id && formData.name && formData.shortDescription;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Create New Story Type</DialogTitle>
          <DialogDescription>
            Define a new story template with its own arc structure and prompt configuration.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="create-name">Name *</Label>
            <Input
              id="create-name"
              placeholder="e.g., Space Adventure"
              value={formData.name}
              onChange={(e) => handleNameChange(e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="create-id">ID *</Label>
            <Input
              id="create-id"
              placeholder="e.g., space_adventure_v1"
              value={formData.id}
              onChange={(e) => setFormData({ ...formData, id: e.target.value.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '') })}
              className="font-mono"
            />
            <p className="text-xs text-muted-foreground">Unique identifier (auto-generated from name)</p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="create-description">Short Description *</Label>
            <Textarea
              id="create-description"
              placeholder="A brief description of what this story type is about..."
              value={formData.shortDescription}
              onChange={(e) => setFormData({ ...formData, shortDescription: e.target.value })}
              rows={2}
            />
          </div>

          <div className="space-y-2">
            <Label>Age Range</Label>
            <div className="flex items-center gap-2">
              <Input
                id="create-ageFrom"
                type="number"
                min="0"
                max="18"
                placeholder="Any"
                value={formData.ageFrom ?? ''}
                onChange={(e) => setFormData({
                  ...formData,
                  ageFrom: e.target.value === '' ? null : parseInt(e.target.value)
                })}
                className="w-20"
              />
              <span className="text-muted-foreground">to</span>
              <Input
                id="create-ageTo"
                type="number"
                min="0"
                max="18"
                placeholder="Any"
                value={formData.ageTo ?? ''}
                onChange={(e) => setFormData({
                  ...formData,
                  ageTo: e.target.value === '' ? null : parseInt(e.target.value)
                })}
                className="w-20"
              />
              <span className="text-muted-foreground text-sm">years</span>
            </div>
            <p className="text-xs text-muted-foreground">Leave blank for no limit</p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="create-status">Status</Label>
            <Select value={formData.status} onValueChange={(v) => setFormData({ ...formData, status: v as 'live' | 'draft' })}>
              <SelectTrigger id="create-status">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="draft">Draft</SelectItem>
                <SelectItem value="live">Live</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="create-tags">Tags</Label>
            <Input
              id="create-tags"
              placeholder="e.g., adventure, space, exploration"
              value={formData.tags}
              onChange={(e) => setFormData({ ...formData, tags: e.target.value })}
            />
            <p className="text-xs text-muted-foreground">Comma-separated list of tags</p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleCreate} disabled={!isValid || saving}>
            {saving ? <LoaderCircle className="h-4 w-4 animate-spin mr-2" /> : <Plus className="h-4 w-4 mr-2" />}
            Create Story Type
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
