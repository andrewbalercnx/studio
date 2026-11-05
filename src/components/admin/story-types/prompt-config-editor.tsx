'use client';
import { LoaderCircle, Plus, X } from 'lucide-react';
import { useEffect, useState, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import type { StoryType, StoryTypePromptConfig } from '@/lib/types';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { defaultPromptConfig } from './shared';

// Prompt Config Editor Component
export function PromptConfigEditor({
  storyType,
  onSave,
  onDirtyChange
}: {
  storyType: StoryType;
  onSave: (promptConfig: StoryTypePromptConfig) => Promise<void>;
  onDirtyChange?: (isDirty: boolean) => void;
}) {
  const [config, setConfig] = useState<StoryTypePromptConfig>(
    storyType.promptConfig || defaultPromptConfig
  );
  const [saving, setSaving] = useState(false);
  const [newRule, setNewRule] = useState('');
  const [newTheme, setNewTheme] = useState('');

  const hasChanges = JSON.stringify(storyType.promptConfig) !== JSON.stringify(config);

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
      await onSave(config);
    } finally {
      setSaving(false);
    }
  };

  const handleAddRule = () => {
    if (!newRule.trim()) return;
    setConfig({ ...config, behaviorRules: [...config.behaviorRules, newRule.trim()] });
    setNewRule('');
  };

  const handleRemoveRule = (index: number) => {
    setConfig({ ...config, behaviorRules: config.behaviorRules.filter((_, i) => i !== index) });
  };

  const handleAddTheme = () => {
    if (!newTheme.trim()) return;
    setConfig({ ...config, thematicElements: [...config.thematicElements, newTheme.trim()] });
    setNewTheme('');
  };

  const handleRemoveTheme = (index: number) => {
    setConfig({ ...config, thematicElements: config.thematicElements.filter((_, i) => i !== index) });
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h4 className="font-medium">Prompt Configuration</h4>
        {hasChanges && (
          <Button size="sm" onClick={handleSave} disabled={saving}>
            {saving ? <LoaderCircle className="h-4 w-4 animate-spin mr-1" /> : null}
            Save Prompt Config
          </Button>
        )}
      </div>

      {!storyType.promptConfig && (
        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3 text-sm text-yellow-800">
          This story type uses legacy PromptConfig. Add a promptConfig to use the new prompt system.
        </div>
      )}

      {/* Role Definition */}
      <div className="space-y-2">
        <Label htmlFor="roleDefinition">Role Definition</Label>
        <Textarea
          id="roleDefinition"
          value={config.roleDefinition}
          onChange={(e) => setConfig({ ...config, roleDefinition: e.target.value })}
          placeholder="Describe who the AI is for this story type..."
          rows={3}
        />
        <p className="text-xs text-muted-foreground">Who the AI is and how it should behave</p>
      </div>

      {/* Behavior Rules */}
      <div className="space-y-2">
        <Label>Behavior Rules</Label>
        <div className="space-y-2">
          {config.behaviorRules.map((rule, index) => (
            <div key={index} className="flex items-center gap-2">
              <span className="flex-1 text-sm bg-muted px-3 py-1.5 rounded">{rule}</span>
              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => handleRemoveRule(index)}>
                <X className="h-4 w-4" />
              </Button>
            </div>
          ))}
          <div className="flex gap-2">
            <Input
              value={newRule}
              onChange={(e) => setNewRule(e.target.value)}
              placeholder="Add a behavior rule..."
              onKeyDown={(e) => e.key === 'Enter' && handleAddRule()}
            />
            <Button variant="outline" size="sm" onClick={handleAddRule}>
              <Plus className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>

      {/* Narrative Style */}
      <div className="space-y-2">
        <Label htmlFor="narrativeStyle">Narrative Style</Label>
        <Input
          id="narrativeStyle"
          value={config.narrativeStyle}
          onChange={(e) => setConfig({ ...config, narrativeStyle: e.target.value })}
          placeholder="e.g., Warm and cozy with gentle wonder"
        />
      </div>

      {/* Thematic Elements */}
      <div className="space-y-2">
        <Label>Thematic Elements</Label>
        <div className="flex flex-wrap gap-2 mb-2">
          {config.thematicElements.map((theme, index) => (
            <span key={index} className="inline-flex items-center gap-1 bg-primary/10 text-primary px-2 py-1 rounded text-sm">
              {theme}
              <button onClick={() => handleRemoveTheme(index)} className="hover:text-destructive">
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>
        <div className="flex gap-2">
          <Input
            value={newTheme}
            onChange={(e) => setNewTheme(e.target.value)}
            placeholder="Add a theme..."
            onKeyDown={(e) => e.key === 'Enter' && handleAddTheme()}
          />
          <Button variant="outline" size="sm" onClick={handleAddTheme}>
            <Plus className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Pacing & Emotional Tone */}
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label>Pacing</Label>
          <Select value={config.pacing} onValueChange={(v) => setConfig({ ...config, pacing: v as 'slow' | 'moderate' | 'fast' })}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="slow">Slow</SelectItem>
              <SelectItem value="moderate">Moderate</SelectItem>
              <SelectItem value="fast">Fast</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label>Emotional Tone</Label>
          <Select value={config.emotionalTone} onValueChange={(v) => setConfig({ ...config, emotionalTone: v as 'gentle' | 'playful' | 'adventurous' | 'calm' })}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="gentle">Gentle</SelectItem>
              <SelectItem value="playful">Playful</SelectItem>
              <SelectItem value="adventurous">Adventurous</SelectItem>
              <SelectItem value="calm">Calm</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Phase Instructions */}
      <div className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="storyBeatInstructions">Story Beat Instructions</Label>
          <Textarea
            id="storyBeatInstructions"
            value={config.storyBeatInstructions}
            onChange={(e) => setConfig({ ...config, storyBeatInstructions: e.target.value })}
            placeholder="Instructions for generating story beats..."
            rows={3}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="warmupInstructions">Warmup Instructions (optional)</Label>
          <Textarea
            id="warmupInstructions"
            value={config.warmupInstructions || ''}
            onChange={(e) => setConfig({ ...config, warmupInstructions: e.target.value })}
            placeholder="Instructions for the warmup phase..."
            rows={2}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="endingInstructions">Ending Instructions (optional)</Label>
          <Textarea
            id="endingInstructions"
            value={config.endingInstructions || ''}
            onChange={(e) => setConfig({ ...config, endingInstructions: e.target.value })}
            placeholder="Instructions for generating endings..."
            rows={2}
          />
        </div>
      </div>

      {/* Model Settings */}
      <div className="space-y-2">
        <Label>Model Settings</Label>
        <div className="grid grid-cols-3 gap-4">
          <div>
            <Label htmlFor="modelName" className="text-xs text-muted-foreground">Model</Label>
            <Input
              id="modelName"
              value={config.model.name}
              onChange={(e) => setConfig({ ...config, model: { ...config.model, name: e.target.value } })}
            />
          </div>
          <div>
            <Label htmlFor="temperature" className="text-xs text-muted-foreground">Temperature</Label>
            <Input
              id="temperature"
              type="number"
              step="0.1"
              min="0"
              max="2"
              value={config.model.temperature ?? 0.7}
              onChange={(e) => setConfig({ ...config, model: { ...config.model, temperature: parseFloat(e.target.value) } })}
            />
          </div>
          <div>
            <Label htmlFor="maxTokens" className="text-xs text-muted-foreground">Max Tokens</Label>
            <Input
              id="maxTokens"
              type="number"
              value={config.model.maxOutputTokens ?? 10000}
              onChange={(e) => setConfig({ ...config, model: { ...config.model, maxOutputTokens: parseInt(e.target.value) } })}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
