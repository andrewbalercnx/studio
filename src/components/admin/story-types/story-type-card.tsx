'use client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ChevronDown, ChevronUp, Check, Music } from 'lucide-react';
import { useEffect, useState, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import type { StoryType, StoryTypePromptConfig, ArcStep } from '@/lib/types';
import { ArcStepEditor } from './arc-step-editor';
import { BackgroundMusicEditor } from './background-music-editor';
import { PromptConfigEditor } from './prompt-config-editor';
import { SettingsEditor } from './settings-editor';
import { formatAgeRange } from './shared';

// Story Type Detail Card
export function StoryTypeCard({
  storyType,
  onUpdateArcSteps,
  onUpdatePromptConfig,
  onUpdateSettings,
  onUpdateMusic
}: {
  storyType: StoryType;
  onUpdateArcSteps: (storyTypeId: string, steps: ArcStep[]) => Promise<void>;
  onUpdatePromptConfig: (storyTypeId: string, promptConfig: StoryTypePromptConfig) => Promise<void>;
  onUpdateSettings: (storyTypeId: string, updates: Partial<StoryType>) => Promise<void>;
  onUpdateMusic: (storyTypeId: string, musicConfig: { prompt: string }) => Promise<void>;
}) {
  const [expanded, setExpanded] = useState(false);
  const [activeTab, setActiveTab] = useState<'settings' | 'arc' | 'prompt' | 'music'>('settings');
  const [dirtyState, setDirtyState] = useState({ settings: false, arc: false, prompt: false, music: false });

  const hasUnsavedChanges = dirtyState.settings || dirtyState.arc || dirtyState.prompt || dirtyState.music;

  // Browser beforeunload warning
  useEffect(() => {
    if (!hasUnsavedChanges) return;

    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [hasUnsavedChanges]);

  const handleToggleExpanded = useCallback(() => {
    if (expanded && hasUnsavedChanges) {
      const confirmed = window.confirm(
        'You have unsaved changes. Are you sure you want to collapse this section? Your changes will be lost.'
      );
      if (!confirmed) return;
    }
    setExpanded(!expanded);
  }, [expanded, hasUnsavedChanges]);

  const handleTabChange = useCallback((newTab: 'settings' | 'arc' | 'prompt' | 'music') => {
    // Check if current tab has unsaved changes
    const currentTabDirty = dirtyState[activeTab];
    if (currentTabDirty) {
      const confirmed = window.confirm(
        'You have unsaved changes in this tab. Are you sure you want to switch tabs? Your changes will be lost.'
      );
      if (!confirmed) return;
    }
    setActiveTab(newTab);
  }, [activeTab, dirtyState]);

  return (
    <Card className={hasUnsavedChanges ? 'ring-2 ring-yellow-400' : ''}>
      <CardHeader
        className="cursor-pointer hover:bg-muted/50 transition-colors"
        onClick={handleToggleExpanded}
      >
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-lg flex items-center gap-2">
              {storyType.name}
              {hasUnsavedChanges && (
                <span className="text-xs bg-yellow-100 text-yellow-800 px-2 py-0.5 rounded">Unsaved changes</span>
              )}
              {storyType.promptConfig && !hasUnsavedChanges && (
                <span className="text-xs bg-green-100 text-green-800 px-2 py-0.5 rounded">New Prompt System</span>
              )}
            </CardTitle>
            <CardDescription>{storyType.shortDescription}</CardDescription>
          </div>
          <div className="flex items-center gap-4">
            <div className="text-right text-sm">
              <div className="text-muted-foreground">Age: {formatAgeRange(storyType)}</div>
              <div className={storyType.status === 'live' ? 'text-green-600' : 'text-yellow-600'}>
                {storyType.status}
              </div>
            </div>
            <Button variant="ghost" size="icon">
              {expanded ? <ChevronUp className="h-5 w-5" /> : <ChevronDown className="h-5 w-5" />}
            </Button>
          </div>
        </div>
      </CardHeader>
      {expanded && (
        <CardContent className="border-t pt-4">
          {/* Tab Navigation */}
          <div className="flex gap-2 mb-4 border-b">
            <button
              className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
                activeTab === 'settings' ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'
              } ${dirtyState.settings ? 'text-yellow-600' : ''}`}
              onClick={() => handleTabChange('settings')}
            >
              Settings{dirtyState.settings ? ' *' : ''}
            </button>
            <button
              className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
                activeTab === 'arc' ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'
              } ${dirtyState.arc ? 'text-yellow-600' : ''}`}
              onClick={() => handleTabChange('arc')}
            >
              Arc Steps{dirtyState.arc ? ' *' : ''}
            </button>
            <button
              className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
                activeTab === 'prompt' ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'
              } ${dirtyState.prompt ? 'text-yellow-600' : ''}`}
              onClick={() => handleTabChange('prompt')}
            >
              Prompt Config{dirtyState.prompt ? ' *' : ''}
            </button>
            <button
              className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors flex items-center gap-1 ${
                activeTab === 'music' ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'
              } ${dirtyState.music ? 'text-yellow-600' : ''}`}
              onClick={() => handleTabChange('music')}
            >
              <Music className="h-4 w-4" />
              Music{dirtyState.music ? ' *' : ''}
            </button>
          </div>

          {activeTab === 'settings' && (
            <SettingsEditor
              storyType={storyType}
              onSave={(updates) => onUpdateSettings(storyType.id, updates)}
              onDirtyChange={(isDirty) => setDirtyState(prev => ({ ...prev, settings: isDirty }))}
            />
          )}

          {activeTab === 'arc' && (
            <ArcStepEditor
              storyType={storyType}
              onSave={(steps) => onUpdateArcSteps(storyType.id, steps)}
              onDirtyChange={(isDirty) => setDirtyState(prev => ({ ...prev, arc: isDirty }))}
            />
          )}

          {activeTab === 'prompt' && (
            <PromptConfigEditor
              storyType={storyType}
              onSave={(config) => onUpdatePromptConfig(storyType.id, config)}
              onDirtyChange={(isDirty) => setDirtyState(prev => ({ ...prev, prompt: isDirty }))}
            />
          )}

          {activeTab === 'music' && (
            <BackgroundMusicEditor
              storyType={storyType}
              onSave={(musicConfig) => onUpdateMusic(storyType.id, musicConfig)}
              onDirtyChange={(isDirty) => setDirtyState(prev => ({ ...prev, music: isDirty }))}
            />
          )}
        </CardContent>
      )}
    </Card>
  );
}
