
'use client';

import { useAdminStatus } from '@/hooks/use-admin-status';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { LoaderCircle, ChevronDown, ChevronUp, Music, Play, Square, CheckCircle, RefreshCw, Pencil, Users } from 'lucide-react';
import { Switch } from '@/components/ui/switch';
import { DiagnosticsPanel } from '@/components/diagnostics-panel';
import { useEffect, useState, useRef } from 'react';
import { useFirestore, useAuth } from '@/firebase';
import { collection, doc, onSnapshot, updateDoc } from 'firebase/firestore';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import type { StoryGenerator, AIModelName, StoryGeneratorPromptConfig } from '@/lib/types';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Cpu } from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

// Prompt key descriptions for each generator
const PROMPT_DESCRIPTIONS: Record<string, Record<string, string>> = {
  wizard: {
    questionGeneration: 'Prompt for generating multiple-choice questions during the wizard flow',
    storyGeneration: 'Prompt for generating the final story based on the child\'s answers',
  },
  gemini3: {
    systemPrompt: 'Main system prompt for the open-ended creative story generation',
  },
  gemini4: {
    systemPrompt: 'Main system prompt for the guided story creation with phases',
    phase_opening: 'Opening question phase guidance',
    phase_setting: 'Setting question phase guidance',
    phase_characters: 'Character introduction phase guidance',
    phase_conflict: 'Problem/conflict phase guidance',
    phase_action: 'Action phase guidance',
    phase_resolution: 'Resolution phase guidance',
    phase_development: 'Development phase guidance (used for extra questions)',
  },
  friends: {
    characterProposal: 'Prompt for AI to propose initial character selection for the adventure',
    scenarioGeneration: 'Prompt for generating adventure scenario options',
    synopsisGeneration: 'Prompt for drafting story synopses based on chosen scenario',
    storyGeneration: 'Prompt for generating the final complete story',
  },
};

// Default fallback info (used if generator data is missing)
const DEFAULT_GENERATOR_INFO: Record<string, { name: string; description: string }> = {
  wizard: {
    name: 'Story Wizard',
    description: 'A 4-question wizard that gathers story preferences before generating a complete story',
  },
  gemini3: {
    name: 'Gemini Free',
    description: 'Open-ended creative story generation with full AI freedom',
  },
  gemini4: {
    name: 'Guided Story',
    description: 'AI-guided story creation with structured phases',
  },
  beat: {
    name: 'Story Beats',
    description: 'Turn-by-turn story generation with structured narrative beats and arcs (uses storyTypes for configuration)',
  },
  friends: {
    name: 'Fun with my friends',
    description: 'Create an adventure story by choosing companions, picking a scenario, and watching your story come to life',
  },
};

// Available AI models
const AI_MODELS: { value: AIModelName; label: string; description: string }[] = [
  { value: 'googleai/gemini-2.5-pro', label: 'Gemini 2.5 Pro', description: 'Most capable, best for complex tasks' },
  { value: 'googleai/gemini-2.5-flash', label: 'Gemini 2.5 Flash', description: 'Fast and efficient' },
  { value: 'googleai/gemini-2.0-flash', label: 'Gemini 2.0 Flash', description: 'Previous generation, very fast' },
];

// Sentinel value for "use default" option (Radix Select doesn't allow empty string values)
const USE_DEFAULT_VALUE = '__use_default__';

// AI Settings Editor Component
function AISettingsEditor({
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

// Background Music Editor Component
function BackgroundMusicEditor({
  generator,
  onSavePrompt,
}: {
  generator: StoryGenerator;
  onSavePrompt: (prompt: string) => Promise<void>;
}) {
  const auth = useAuth();
  const { toast } = useToast();
  const [prompt, setPrompt] = useState(generator.backgroundMusic?.prompt || '');
  const [isGenerating, setIsGenerating] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [saving, setSaving] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const musicStatus = generator.backgroundMusic?.generation?.status || 'idle';
  const audioUrl = generator.backgroundMusic?.audioUrl;
  const durationMs = generator.backgroundMusic?.durationMs;

  const hasChanges = prompt !== (generator.backgroundMusic?.prompt || '');

  // Update local state when generator prop changes
  useEffect(() => {
    setPrompt(generator.backgroundMusic?.prompt || '');
  }, [generator.backgroundMusic?.prompt]);

  const handleSavePrompt = async () => {
    setSaving(true);
    try {
      await onSavePrompt(prompt);
      toast({ title: 'Saved', description: 'Music prompt saved successfully' });
    } catch (error: any) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  const handleGenerateMusic = async () => {
    if (!auth.currentUser || !prompt) return;
    setIsGenerating(true);
    try {
      const token = await auth.currentUser.getIdToken();
      const response = await fetch('/api/music/generate-generator', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({
          generatorId: generator.id,
          prompt,
          durationMs: 45000,
        }),
      });
      const result = await response.json();
      if (!result.ok) {
        throw new Error(result.errorMessage);
      }
      toast({ title: 'Success', description: 'Background music generated!' });
    } catch (error: any) {
      toast({ title: 'Error generating music', description: error.message, variant: 'destructive' });
    } finally {
      setIsGenerating(false);
    }
  };

  const handlePlayPreview = () => {
    if (!audioUrl) return;
    if (audioRef.current) {
      audioRef.current.pause();
    }
    audioRef.current = new Audio(audioUrl);
    audioRef.current.loop = true;
    audioRef.current.volume = 0.5;
    audioRef.current.play().catch((e) => {
      console.error('Play failed:', e);
      toast({ title: 'Playback error', description: 'Could not play audio', variant: 'destructive' });
    });
    setIsPlaying(true);
    audioRef.current.onended = () => setIsPlaying(false);
  };

  const handleStopPreview = () => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }
    setIsPlaying(false);
  };

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }
    };
  }, []);

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Background music plays during story generation when the child&apos;s avatar animation is shown.
        The music automatically lowers in volume when Read to Me is speaking.
      </p>

      <div className="space-y-2">
        <Label htmlFor="musicPrompt">Music Prompt</Label>
        <Textarea
          id="musicPrompt"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="e.g., gentle whimsical lullaby with soft piano and magical sparkles, suitable for children"
          rows={3}
        />
        <p className="text-xs text-muted-foreground">
          Describe the style of background music. Should be calming and child-friendly.
        </p>
      </div>

      <div className="flex items-center gap-3">
        {hasChanges && (
          <Button variant="outline" onClick={handleSavePrompt} disabled={saving}>
            {saving ? <LoaderCircle className="h-4 w-4 animate-spin mr-2" /> : null}
            Save Prompt
          </Button>
        )}

        <Button
          onClick={handleGenerateMusic}
          disabled={!prompt || isGenerating || musicStatus === 'generating'}
        >
          {isGenerating || musicStatus === 'generating' ? (
            <>
              <LoaderCircle className="h-4 w-4 animate-spin mr-2" />
              Generating...
            </>
          ) : audioUrl ? (
            <>
              <RefreshCw className="h-4 w-4 mr-2" />
              Regenerate
            </>
          ) : (
            <>
              <Music className="h-4 w-4 mr-2" />
              Generate Music
            </>
          )}
        </Button>

        {musicStatus === 'ready' && audioUrl && (
          <span className="text-sm text-green-600 flex items-center gap-1">
            <CheckCircle className="h-4 w-4" /> Ready
          </span>
        )}
        {musicStatus === 'error' && (
          <span className="text-sm text-red-600">
            Error: {generator.backgroundMusic?.generation?.lastErrorMessage || 'Unknown'}
          </span>
        )}
      </div>

      {audioUrl && (
        <div className="border rounded-lg p-4 space-y-2 bg-muted/30">
          <Label>Preview</Label>
          <div className="flex items-center gap-3">
            {!isPlaying ? (
              <Button variant="outline" size="sm" onClick={handlePlayPreview}>
                <Play className="h-4 w-4 mr-1" /> Play
              </Button>
            ) : (
              <Button variant="outline" size="sm" onClick={handleStopPreview}>
                <Square className="h-4 w-4 mr-1" /> Stop
              </Button>
            )}
            {durationMs && (
              <span className="text-xs text-muted-foreground">
                Duration: {Math.round(durationMs / 1000)}s (loops)
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// Prompts Editor Component
function PromptsEditor({
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

// General Info Editor Component
function GeneralInfoEditor({
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

// Generator Card Component
function GeneratorCard({
  generator,
  onUpdateMusic,
  onUpdatePrompts,
  onUpdateInfo,
  onUpdateAISettings,
}: {
  generator: StoryGenerator;
  onUpdateMusic: (generatorId: string, prompt: string) => Promise<void>;
  onUpdatePrompts: (generatorId: string, prompts: Record<string, string>) => Promise<void>;
  onUpdateInfo: (generatorId: string, data: { name: string; description: string; enabledForKids?: boolean; order?: number }) => Promise<void>;
  onUpdateAISettings: (generatorId: string, data: { defaultModel?: AIModelName; defaultTemperature?: number; promptConfig?: Record<string, StoryGeneratorPromptConfig> }) => Promise<void>;
}) {
  const [expanded, setExpanded] = useState(false);
  const defaultInfo = DEFAULT_GENERATOR_INFO[generator.id] || { name: generator.id, description: '' };
  const displayName = generator.name || defaultInfo.name;
  const displayDescription = generator.description || defaultInfo.description;
  const hasMusic = !!generator.backgroundMusic?.audioUrl;
  const hasPrompts = Object.keys(generator.prompts || {}).length > 0;
  const isConfigurable = generator.id !== 'beat'; // beat uses storyTypes

  return (
    <Card>
      <CardHeader
        className="cursor-pointer hover:bg-muted/50 transition-colors"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-lg flex items-center gap-2">
              {displayName}
              <span className={`text-xs px-2 py-0.5 rounded ${
                generator.status === 'live' ? 'bg-green-100 text-green-800' : 'bg-yellow-100 text-yellow-800'
              }`}>
                {generator.status}
              </span>
              {hasMusic && (
                <span className="text-xs bg-purple-100 text-purple-800 px-2 py-0.5 rounded flex items-center gap-1">
                  <Music className="h-3 w-3" /> Music
                </span>
              )}
              {hasPrompts && (
                <span className="text-xs bg-blue-100 text-blue-800 px-2 py-0.5 rounded">
                  Custom Prompts
                </span>
              )}
            </CardTitle>
            <CardDescription>{displayDescription}</CardDescription>
          </div>
          <Button variant="ghost" size="icon">
            {expanded ? <ChevronUp className="h-5 w-5" /> : <ChevronDown className="h-5 w-5" />}
          </Button>
        </div>
      </CardHeader>

      {expanded && (
        <CardContent className="border-t pt-4">
          {isConfigurable ? (
            <Tabs defaultValue="info">
              <TabsList className="mb-4">
                <TabsTrigger value="info" className="flex items-center gap-1">
                  <Pencil className="h-4 w-4" /> General
                </TabsTrigger>
                <TabsTrigger value="music" className="flex items-center gap-1">
                  <Music className="h-4 w-4" /> Music
                </TabsTrigger>
                <TabsTrigger value="prompts">Prompts</TabsTrigger>
                <TabsTrigger value="ai" className="flex items-center gap-1">
                  <Cpu className="h-4 w-4" /> AI Settings
                </TabsTrigger>
              </TabsList>

              <TabsContent value="info">
                <GeneralInfoEditor
                  generator={generator}
                  onSave={(data) => onUpdateInfo(generator.id, data)}
                />
              </TabsContent>

              <TabsContent value="music">
                <BackgroundMusicEditor
                  generator={generator}
                  onSavePrompt={(prompt) => onUpdateMusic(generator.id, prompt)}
                />
              </TabsContent>

              <TabsContent value="prompts">
                <PromptsEditor
                  generator={generator}
                  onSave={(prompts) => onUpdatePrompts(generator.id, prompts)}
                />
              </TabsContent>

              <TabsContent value="ai">
                <AISettingsEditor
                  generator={generator}
                  onSave={(data) => onUpdateAISettings(generator.id, data)}
                />
              </TabsContent>
            </Tabs>
          ) : (
            <div className="space-y-4">
              <GeneralInfoEditor
                generator={generator}
                onSave={(data) => onUpdateInfo(generator.id, data)}
              />
              <div className="text-sm text-muted-foreground border-t pt-4 mt-4">
                <p>The Story Beats generator uses <strong>Story Types</strong> for prompts and music configuration.</p>
                <p className="mt-2">
                  Each story type has its own prompts, arc steps, and background music.
                  Visit the <a href="/admin/storyTypes" className="text-primary underline">Story Types</a> page to configure them.
                </p>
              </div>
            </div>
          )}
        </CardContent>
      )}
    </Card>
  );
}

export default function AdminStoryGeneratorsPage() {
  const { isAuthenticated, isAdmin, isWriter, email, loading: authLoading } = useAdminStatus();
  const firestore = useFirestore();
  const auth = useAuth();
  const { toast } = useToast();

  const [generators, setGenerators] = useState<StoryGenerator[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [seeding, setSeeding] = useState(false);

  useEffect(() => {
    if (!firestore || (!isAdmin && !isWriter)) {
      setLoading(false);
      return;
    }

    setLoading(true);
    const generatorsRef = collection(firestore, 'storyGenerators');

    const unsubscribe = onSnapshot(generatorsRef,
      (snapshot) => {
        const genList = snapshot.docs.map(d => ({ ...d.data(), id: d.id } as StoryGenerator));
        // Sort by order (lower first), then by name
        genList.sort((a, b) => {
          const orderA = a.order ?? 0;
          const orderB = b.order ?? 0;
          if (orderA !== orderB) return orderA - orderB;
          return (a.name || a.id).localeCompare(b.name || b.id);
        });
        setGenerators(genList);
        setLoading(false);
        setError(null);
      },
      (err) => {
        console.error("Error fetching generators:", err);
        setError("Could not fetch story generators.");
        setGenerators([]);
        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, [firestore, isAdmin, isWriter]);

  const handleSeedGenerators = async () => {
    if (!auth.currentUser) return;
    setSeeding(true);
    try {
      const token = await auth.currentUser.getIdToken();
      const response = await fetch('/api/admin/story-generators/seed', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
        },
      });
      const result = await response.json();
      if (!result.ok) {
        throw new Error(result.errorMessage);
      }
      toast({ title: 'Success', description: result.message });
    } catch (error: any) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    } finally {
      setSeeding(false);
    }
  };

  const handleUpdateMusic = async (generatorId: string, prompt: string) => {
    if (!firestore) return;
    const docRef = doc(firestore, 'storyGenerators', generatorId);
    await updateDoc(docRef, {
      'backgroundMusic.prompt': prompt,
    });
  };

  const handleUpdatePrompts = async (generatorId: string, prompts: Record<string, string>) => {
    if (!firestore) return;
    const docRef = doc(firestore, 'storyGenerators', generatorId);
    await updateDoc(docRef, {
      prompts,
    });
  };

  const handleUpdateInfo = async (generatorId: string, data: { name: string; description: string; enabledForKids?: boolean; order?: number }) => {
    if (!firestore) return;
    const docRef = doc(firestore, 'storyGenerators', generatorId);
    await updateDoc(docRef, {
      name: data.name,
      description: data.description,
      ...(data.enabledForKids !== undefined && { enabledForKids: data.enabledForKids }),
      ...(data.order !== undefined && { order: data.order }),
    });
  };

  const handleUpdateAISettings = async (
    generatorId: string,
    data: { defaultModel?: AIModelName; defaultTemperature?: number; promptConfig?: Record<string, StoryGeneratorPromptConfig> }
  ) => {
    if (!firestore) return;
    const docRef = doc(firestore, 'storyGenerators', generatorId);
    await updateDoc(docRef, {
      ...(data.defaultModel !== undefined && { defaultModel: data.defaultModel }),
      ...(data.defaultTemperature !== undefined && { defaultTemperature: data.defaultTemperature }),
      ...(data.promptConfig !== undefined && { promptConfig: data.promptConfig }),
    });
  };

  const diagnostics = {
    page: 'admin-storyGenerators',
    auth: {
      isAuthenticated,
      email,
      isAdmin,
      isWriter,
      loading: authLoading,
    },
    firestore: {
      collection: 'storyGenerators',
      count: generators.length,
      ids: generators.map(g => g.id),
    },
    ...(error ? { error } : {}),
  };

  const renderContent = () => {
    if (authLoading || loading) {
      return (
        <div className="flex items-center gap-2">
          <LoaderCircle className="h-5 w-5 animate-spin" />
          <span>Loading generators...</span>
        </div>
      );
    }
    if (!isAuthenticated) {
      return <p>You must be signed in to access admin pages.</p>;
    }
    if (!isAdmin && !isWriter) {
      return <p>You are signed in but do not have admin or writer rights.</p>;
    }
    if (error) {
      return <p className="text-destructive">{error}</p>;
    }
    if (generators.length === 0) {
      return (
        <div className="text-center py-8 border-2 border-dashed rounded-lg">
          <p className="text-muted-foreground mb-4">No story generators found.</p>
          <Button onClick={handleSeedGenerators} disabled={seeding}>
            {seeding ? <LoaderCircle className="h-4 w-4 animate-spin mr-2" /> : null}
            Seed Default Generators
          </Button>
        </div>
      );
    }

    return (
      <div className="space-y-4">
        {generators.map((gen) => (
          <GeneratorCard
            key={gen.id}
            generator={gen}
            onUpdateMusic={handleUpdateMusic}
            onUpdatePrompts={handleUpdatePrompts}
            onUpdateInfo={handleUpdateInfo}
            onUpdateAISettings={handleUpdateAISettings}
          />
        ))}
      </div>
    );
  };

  return (
    <div className="container mx-auto p-4 sm:p-6 md:p-8">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle>Story Generators</CardTitle>
            <CardDescription>
              Configure background music and AI prompts for story generation flows.
            </CardDescription>
          </div>
          {generators.length > 0 && (
            <Button variant="outline" onClick={handleSeedGenerators} disabled={seeding}>
              {seeding ? <LoaderCircle className="h-4 w-4 animate-spin mr-2" /> : <RefreshCw className="h-4 w-4 mr-2" />}
              Reset Defaults
            </Button>
          )}
        </CardHeader>
        <CardContent>
          {renderContent()}
        </CardContent>
      </Card>

      <DiagnosticsPanel pageName="admin-storyGenerators" data={diagnostics} className="mt-8" />
    </div>
  );
}
