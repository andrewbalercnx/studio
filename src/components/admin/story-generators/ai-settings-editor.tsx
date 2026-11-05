'use client';
import { LoaderCircle } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import type { StoryGenerator, AIModelName, StoryGeneratorPromptConfig } from '@/lib/types';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { AI_MODELS, PROMPT_DESCRIPTIONS, USE_DEFAULT_VALUE } from './shared';

// AI Settings Editor Component
export function AISettingsEditor({
  generator,
  onSave,
}: {
  generator: StoryGenerator;
  onSave: (data: {
    defaultModel?: AIModelName;
    defaultTemperature?: number;
    promptConfig?: Record<string, StoryGeneratorPromptConfig>;
  }) => Promise<void>;
}) {
  const { toast } = useToast();
  const [defaultModel, setDefaultModel] = useState<AIModelName | undefined>(generator.defaultModel);
  const [defaultTemperature, setDefaultTemperature] = useState<number | undefined>(generator.defaultTemperature);
  const [promptConfig, setPromptConfig] = useState<Record<string, StoryGeneratorPromptConfig>>(
    generator.promptConfig || {}
  );
  const [saving, setSaving] = useState(false);

  // Get prompt keys for this generator
  const promptKeys = Object.keys(PROMPT_DESCRIPTIONS[generator.id] || {});

  // Update local state when generator prop changes
  useEffect(() => {
    setDefaultModel(generator.defaultModel);
    setDefaultTemperature(generator.defaultTemperature);
    setPromptConfig(generator.promptConfig || {});
  }, [generator.defaultModel, generator.defaultTemperature, generator.promptConfig]);

  const hasChanges =
    defaultModel !== generator.defaultModel ||
    defaultTemperature !== generator.defaultTemperature ||
    JSON.stringify(promptConfig) !== JSON.stringify(generator.promptConfig || {});

  const handlePromptConfigChange = (
    promptKey: string,
    field: 'model' | 'temperature',
    value: string | number | undefined
  ) => {
    setPromptConfig((prev) => {
      const current = prev[promptKey] || {};
      if (value === undefined || value === '') {
        // Remove the field if undefined/empty
        const { [field]: _, ...rest } = current;
        if (Object.keys(rest).length === 0) {
          // Remove the whole key if empty
          const { [promptKey]: __, ...remaining } = prev;
          return remaining;
        }
        return { ...prev, [promptKey]: rest };
      }
      return {
        ...prev,
        [promptKey]: {
          ...current,
          [field]: value,
        },
      };
    });
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await onSave({
        defaultModel,
        defaultTemperature,
        promptConfig: Object.keys(promptConfig).length > 0 ? promptConfig : undefined,
      });
      toast({ title: 'Saved', description: 'AI settings updated successfully' });
    } catch (error: any) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <p className="text-sm text-muted-foreground">
        Configure the AI model and temperature settings for this generator. Per-prompt settings override the defaults.
      </p>

      {/* Default Settings */}
      <div className="space-y-4 p-4 rounded-lg border bg-muted/30">
        <h4 className="font-medium">Default Settings</h4>
        <p className="text-xs text-muted-foreground">
          These defaults apply to all prompts unless overridden below.
        </p>

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label>Default Model</Label>
            <Select
              value={defaultModel || USE_DEFAULT_VALUE}
              onValueChange={(v) => setDefaultModel(v === USE_DEFAULT_VALUE ? undefined : v as AIModelName)}
            >
              <SelectTrigger>
                <SelectValue placeholder="Use system default" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={USE_DEFAULT_VALUE}>Use system default</SelectItem>
                {AI_MODELS.map((model) => (
                  <SelectItem key={model.value} value={model.value}>
                    {model.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>Default Temperature</Label>
            <Input
              type="number"
              min="0"
              max="2"
              step="0.1"
              value={defaultTemperature ?? ''}
              onChange={(e) => setDefaultTemperature(e.target.value ? parseFloat(e.target.value) : undefined)}
              placeholder="Use system default"
            />
            <p className="text-xs text-muted-foreground">0 = focused, 2 = creative</p>
          </div>
        </div>
      </div>

      {/* Per-Prompt Settings */}
      {promptKeys.length > 0 && (
        <div className="space-y-4">
          <h4 className="font-medium">Per-Prompt Settings</h4>
          <p className="text-xs text-muted-foreground">
            Override model and temperature for specific prompts. Leave empty to use defaults.
          </p>

          <div className="space-y-3">
            {promptKeys.map((promptKey) => {
              const description = PROMPT_DESCRIPTIONS[generator.id]?.[promptKey] || promptKey;
              const config = promptConfig[promptKey] || {};

              return (
                <div key={promptKey} className="p-3 rounded-lg border bg-card">
                  <div className="mb-2">
                    <Label className="text-sm font-medium">{promptKey}</Label>
                    <p className="text-xs text-muted-foreground">{description}</p>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <Label className="text-xs">Model</Label>
                      <Select
                        value={config.model || USE_DEFAULT_VALUE}
                        onValueChange={(v) => handlePromptConfigChange(promptKey, 'model', v === USE_DEFAULT_VALUE ? undefined : v)}
                      >
                        <SelectTrigger className="h-8 text-xs">
                          <SelectValue placeholder="Use default" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value={USE_DEFAULT_VALUE}>Use default</SelectItem>
                          {AI_MODELS.map((model) => (
                            <SelectItem key={model.value} value={model.value}>
                              {model.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Temperature</Label>
                      <Input
                        type="number"
                        min="0"
                        max="2"
                        step="0.1"
                        className="h-8 text-xs"
                        value={config.temperature ?? ''}
                        onChange={(e) =>
                          handlePromptConfigChange(
                            promptKey,
                            'temperature',
                            e.target.value ? parseFloat(e.target.value) : undefined
                          )
                        }
                        placeholder="Use default"
                      />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {hasChanges && (
        <div className="pt-4">
          <Button onClick={handleSave} disabled={saving}>
            {saving ? <LoaderCircle className="h-4 w-4 animate-spin mr-2" /> : null}
            Save AI Settings
          </Button>
        </div>
      )}
    </div>
  );
}
