'use client';
import { LoaderCircle, Music, Play, Square, CheckCircle, RefreshCw } from 'lucide-react';
import { useEffect, useState, useRef } from 'react';
import { useAuth } from '@/firebase';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import type { StoryGenerator } from '@/lib/types';
import { api } from '@/lib/api';

// Background Music Editor Component
export function BackgroundMusicEditor({
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
