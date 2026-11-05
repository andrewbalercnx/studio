'use client';
import { LoaderCircle } from 'lucide-react';
import { useEffect, useState, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import type { StoryType } from '@/lib/types';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

// Settings Editor Component
export function SettingsEditor({
  storyType,
  onSave,
  onDirtyChange
}: {
  storyType: StoryType;
  onSave: (updates: Partial<StoryType>) => Promise<void>;
  onDirtyChange?: (isDirty: boolean) => void;
}) {
  const [settings, setSettings] = useState({
    name: storyType.name,
    shortDescription: storyType.shortDescription,
    ageFrom: storyType.ageFrom ?? null,
    ageTo: storyType.ageTo ?? null,
    status: storyType.status,
    tags: storyType.tags.join(', '),
    defaultPhaseId: storyType.defaultPhaseId || 'story_beat_phase_v1',
    endingPhaseId: storyType.endingPhaseId || 'ending_phase_v1',
    levelBands: (storyType.levelBands || ['low', 'medium', 'high']).join(', '),
  });
  const [saving, setSaving] = useState(false);

  const hasChanges =
    settings.name !== storyType.name ||
    settings.shortDescription !== storyType.shortDescription ||
    settings.ageFrom !== (storyType.ageFrom ?? null) ||
    settings.ageTo !== (storyType.ageTo ?? null) ||
    settings.status !== storyType.status ||
    settings.tags !== storyType.tags.join(', ') ||
    settings.defaultPhaseId !== (storyType.defaultPhaseId || 'story_beat_phase_v1') ||
    settings.endingPhaseId !== (storyType.endingPhaseId || 'ending_phase_v1') ||
    settings.levelBands !== (storyType.levelBands || ['low', 'medium', 'high']).join(', ');

  // Notify parent of dirty state changes (only when hasChanges actually changes)
  const prevHasChanges = useRef(hasChanges);
  useEffect(() => {
    if (prevHasChanges.current !== hasChanges) {
      prevHasChanges.current = hasChanges;
      onDirtyChange?.(hasChanges);
    }
  }, [hasChanges, onDirtyChange]);

  const handleSave = async () => {
    setSaving(true);
    try {
      await onSave({
        name: settings.name,
        shortDescription: settings.shortDescription,
        ageFrom: settings.ageFrom,
        ageTo: settings.ageTo,
        status: settings.status,
        tags: settings.tags.split(',').map(t => t.trim()).filter(Boolean),
        defaultPhaseId: settings.defaultPhaseId,
        endingPhaseId: settings.endingPhaseId,
        levelBands: settings.levelBands.split(',').map(t => t.trim()).filter(Boolean),
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h4 className="font-medium">Story Type Settings</h4>
        {hasChanges && (
          <Button size="sm" onClick={handleSave} disabled={saving}>
            {saving ? <LoaderCircle className="h-4 w-4 animate-spin mr-1" /> : null}
            Save Settings
          </Button>
        )}
      </div>

      {/* Basic Info */}
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="settings-name">Name</Label>
          <Input
            id="settings-name"
            value={settings.name}
            onChange={(e) => setSettings({ ...settings, name: e.target.value })}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="settings-id">ID (read-only)</Label>
          <Input
            id="settings-id"
            value={storyType.id}
            disabled
            className="font-mono bg-muted"
          />
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="settings-description">Short Description</Label>
        <Textarea
          id="settings-description"
          value={settings.shortDescription}
          onChange={(e) => setSettings({ ...settings, shortDescription: e.target.value })}
          rows={2}
        />
      </div>

      {/* Age Range */}
      <div className="space-y-2">
        <Label>Age Range</Label>
        <div className="flex items-center gap-2">
          <div className="flex-1">
            <Input
              id="settings-ageFrom"
              type="number"
              min="0"
              max="18"
              placeholder="Any"
              value={settings.ageFrom ?? ''}
              onChange={(e) => setSettings({
                ...settings,
                ageFrom: e.target.value === '' ? null : parseInt(e.target.value)
              })}
            />
          </div>
          <span className="text-muted-foreground">to</span>
          <div className="flex-1">
            <Input
              id="settings-ageTo"
              type="number"
              min="0"
              max="18"
              placeholder="Any"
              value={settings.ageTo ?? ''}
              onChange={(e) => setSettings({
                ...settings,
                ageTo: e.target.value === '' ? null : parseInt(e.target.value)
              })}
            />
          </div>
          <span className="text-muted-foreground whitespace-nowrap">years old</span>
        </div>
        <p className="text-xs text-muted-foreground">Leave blank for no limit (e.g., "3 to blank" means ages 3+)</p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="settings-status">Status</Label>
        <Select value={settings.status} onValueChange={(v) => setSettings({ ...settings, status: v as 'live' | 'draft' })}>
          <SelectTrigger id="settings-status">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="draft">Draft</SelectItem>
            <SelectItem value="live">Live</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-2">
        <Label htmlFor="settings-tags">Tags</Label>
        <Input
          id="settings-tags"
          value={settings.tags}
          onChange={(e) => setSettings({ ...settings, tags: e.target.value })}
          placeholder="e.g., adventure, animals, gentle"
        />
        <p className="text-xs text-muted-foreground">Comma-separated list of tags</p>
      </div>

      {/* Phase Configuration */}
      <div className="border-t pt-4">
        <h5 className="font-medium mb-4">Phase Configuration</h5>
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="settings-defaultPhase">Default Phase ID</Label>
            <Select value={settings.defaultPhaseId} onValueChange={(v) => setSettings({ ...settings, defaultPhaseId: v })}>
              <SelectTrigger id="settings-defaultPhase">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="warmup_phase_v1">warmup_phase_v1</SelectItem>
                <SelectItem value="story_beat_phase_v1">story_beat_phase_v1</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">Phase to start the story in</p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="settings-endingPhase">Ending Phase ID</Label>
            <Select value={settings.endingPhaseId} onValueChange={(v) => setSettings({ ...settings, endingPhaseId: v })}>
              <SelectTrigger id="settings-endingPhase">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ending_phase_v1">ending_phase_v1</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">Phase used for story endings</p>
          </div>
        </div>
      </div>

      {/* Level Bands */}
      <div className="space-y-2">
        <Label htmlFor="settings-levelBands">Level Bands</Label>
        <Input
          id="settings-levelBands"
          value={settings.levelBands}
          onChange={(e) => setSettings({ ...settings, levelBands: e.target.value })}
          placeholder="e.g., low, medium, high"
        />
        <p className="text-xs text-muted-foreground">Comma-separated list of level bands for age-appropriate adjustments</p>
      </div>
    </div>
  );
}
