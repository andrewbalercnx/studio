'use client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ChevronDown, ChevronUp, Music, Pencil } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import type { StoryGenerator, AIModelName, StoryGeneratorPromptConfig } from '@/lib/types';
import { Cpu } from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { AISettingsEditor } from './ai-settings-editor';
import { BackgroundMusicEditor } from './background-music-editor';
import { GeneralInfoEditor } from './general-info-editor';
import { PromptsEditor } from './prompts-editor';
import { DEFAULT_GENERATOR_INFO } from './shared';

// Generator Card Component
export function GeneratorCard({
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
