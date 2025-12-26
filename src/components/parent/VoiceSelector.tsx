'use client';

import { useState, useCallback, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Volume2, Loader2, Check, Star, Upload, VolumeX } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useUser } from '@/firebase/auth/use-user';
import type { ChildProfile } from '@/lib/types';
import { GEMINI_TTS_VOICES, DEFAULT_TTS_VOICE } from '@/lib/tts-config';

type VoiceSelectorProps = {
  child: ChildProfile;
  onVoiceSelect: (voiceId: string) => Promise<void>;
};

export function VoiceSelector({ child, onVoiceSelect }: VoiceSelectorProps) {
  const { toast } = useToast();
  const { user } = useUser();
  const [selectedVoice, setSelectedVoice] = useState<string>(child.preferredVoiceId || DEFAULT_TTS_VOICE);
  const [previewingVoice, setPreviewingVoice] = useState<string | null>(null);
  const [loadingPreview, setLoadingPreview] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // Stop any currently playing audio
  const stopPlayback = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
      audioRef.current = null;
    }
    setPreviewingVoice(null);
  }, []);

  const handlePreviewVoice = useCallback(async (voiceId: string) => {
    // If already playing this voice, stop it
    if (previewingVoice === voiceId) {
      stopPlayback();
      return;
    }

    // Stop any currently playing audio
    stopPlayback();

    if (!user) {
      toast({
        title: 'Sign in required',
        description: 'Please sign in to preview voices.',
        variant: 'destructive',
      });
      return;
    }

    setLoadingPreview(voiceId);

    try {
      // Get fresh ID token for auth
      const idToken = await user.getIdToken();

      // Call the preview API to get real Gemini TTS audio
      const response = await fetch('/api/voices/preview', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${idToken}`,
        },
        body: JSON.stringify({ voiceName: voiceId }),
      });

      const result = await response.json();

      if (!result.ok) {
        throw new Error(result.errorMessage || 'Failed to generate preview');
      }

      // Create audio from base64 data
      console.log('[VoiceSelector] Creating audio from base64, mimeType:', result.mimeType, 'dataLength:', result.audioData?.length);
      const audioBlob = new Blob(
        [Uint8Array.from(atob(result.audioData), c => c.charCodeAt(0))],
        { type: result.mimeType }
      );
      const audioUrl = URL.createObjectURL(audioBlob);
      console.log('[VoiceSelector] Created blob URL:', audioUrl);

      let audio: HTMLAudioElement;
      try {
        audio = new Audio(audioUrl);
      } catch (err) {
        console.error('[VoiceSelector] Failed to create Audio element:', err);
        URL.revokeObjectURL(audioUrl);
        throw err;
      }
      audioRef.current = audio;

      audio.onended = () => {
        setPreviewingVoice(null);
        audioRef.current = null;
        URL.revokeObjectURL(audioUrl);
      };

      audio.onerror = () => {
        setPreviewingVoice(null);
        audioRef.current = null;
        URL.revokeObjectURL(audioUrl);
        toast({
          title: 'Playback failed',
          description: 'Could not play voice preview',
          variant: 'destructive',
        });
      };

      setPreviewingVoice(voiceId);
      setLoadingPreview(null);
      await audio.play();
    } catch (error: any) {
      setLoadingPreview(null);
      setPreviewingVoice(null);
      toast({
        title: 'Preview failed',
        description: error.message || 'Could not generate voice preview',
        variant: 'destructive',
      });
    }
  }, [previewingVoice, stopPlayback, toast, user]);

  const handleSave = useCallback(async () => {
    setSaving(true);
    try {
      await onVoiceSelect(selectedVoice);
      toast({
        title: 'Voice saved!',
        description: `${child.displayName}'s stories will now use the ${selectedVoice} voice.`,
      });
    } catch (error) {
      toast({
        title: 'Failed to save',
        description: 'Please try again.',
        variant: 'destructive',
      });
    } finally {
      setSaving(false);
    }
  }, [selectedVoice, onVoiceSelect, child.displayName, toast]);

  const hasChanged = selectedVoice !== (child.preferredVoiceId || DEFAULT_TTS_VOICE);

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-semibold mb-2">Story Narrator Voice</h3>
        <p className="text-sm text-muted-foreground">
          Choose a voice for reading {child.displayName}'s stories aloud.
          The narrator will use a British English accent, suitable for {child.displayName}'s age.
        </p>
      </div>

      <RadioGroup
        value={selectedVoice}
        onValueChange={setSelectedVoice}
        className="grid grid-cols-1 sm:grid-cols-2 gap-3"
      >
        {GEMINI_TTS_VOICES.map((voice) => (
          <div key={voice.id} className="relative">
            <RadioGroupItem
              value={voice.id}
              id={`voice-${voice.id}`}
              className="peer sr-only"
            />
            <Label
              htmlFor={`voice-${voice.id}`}
              className="flex items-center justify-between rounded-lg border-2 border-muted bg-popover p-4 hover:bg-accent hover:text-accent-foreground peer-data-[state=checked]:border-primary [&:has([data-state=checked])]:border-primary cursor-pointer"
            >
              <div className="flex items-center gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{voice.name}</span>
                    {voice.recommended && (
                      <Star className="h-3 w-3 text-amber-500 fill-amber-500" />
                    )}
                    {selectedVoice === voice.id && (
                      <Check className="h-4 w-4 text-primary" />
                    )}
                  </div>
                  <p className="text-sm text-muted-foreground">{voice.description}</p>
                </div>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={(e) => {
                  e.preventDefault();
                  handlePreviewVoice(voice.id);
                }}
                disabled={(loadingPreview !== null || previewingVoice !== null) && loadingPreview !== voice.id && previewingVoice !== voice.id}
              >
                {loadingPreview === voice.id ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : previewingVoice === voice.id ? (
                  <VolumeX className="h-4 w-4" />
                ) : (
                  <Volume2 className="h-4 w-4" />
                )}
              </Button>
            </Label>
          </div>
        ))}
      </RadioGroup>

      <div className="flex items-center justify-between pt-4 border-t">
        <div className="text-sm text-muted-foreground">
          {hasChanged ? (
            <span className="text-amber-600">Unsaved changes</span>
          ) : (
            <span>Current voice: <strong>{child.preferredVoiceId || DEFAULT_TTS_VOICE}</strong></span>
          )}
        </div>
        <Button
          onClick={handleSave}
          disabled={!hasChanged || saving}
        >
          {saving ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Saving...
            </>
          ) : (
            'Save Voice Preference'
          )}
        </Button>
      </div>

      {/* Future: Custom voice upload section */}
      <Card className="bg-muted/50 border-dashed">
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Upload className="h-4 w-4" />
            Custom Voice
          </CardTitle>
          <CardDescription>
            Coming soon: Upload a voice sample to create a custom narrator voice.
          </CardDescription>
        </CardHeader>
      </Card>
    </div>
  );
}