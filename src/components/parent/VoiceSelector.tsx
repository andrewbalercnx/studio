'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Volume2, Loader2, Check, Star, Mic, MicOff, Trash2, Plus, User } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useUser } from '@/firebase/auth/use-user';
import type { ChildProfile, ParentVoice } from '@/lib/types';
import { DEFAULT_VOICE_RECORDING_TEXT } from '@/lib/types';
import { ELEVENLABS_BRITISH_VOICES, ELEVENLABS_OTHER_VOICES, ELEVENLABS_TTS_VOICES, DEFAULT_TTS_VOICE } from '@/lib/tts-config';

type VoiceSelectorProps = {
  child: ChildProfile;
  onVoiceSelect: (voiceId: string) => Promise<void>;
  onAutoReadAloudChange?: (enabled: boolean) => Promise<void>;
};

export function VoiceSelector({ child, onVoiceSelect, onAutoReadAloudChange }: VoiceSelectorProps) {
  const { toast } = useToast();
  const { user } = useUser();
  const [selectedVoice, setSelectedVoice] = useState<string>(child.preferredVoiceId || DEFAULT_TTS_VOICE);
  const [autoReadAloud, setAutoReadAloud] = useState<boolean>(child.autoReadAloud ?? false);
  const [previewingVoice, setPreviewingVoice] = useState<string | null>(null);
  const [loadingPreview, setLoadingPreview] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [savingAutoRead, setSavingAutoRead] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // Parent voice state
  const [parentVoices, setParentVoices] = useState<ParentVoice[]>([]);
  const [loadingParentVoices, setLoadingParentVoices] = useState(true);
  const [showRecorder, setShowRecorder] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [recordedBlob, setRecordedBlob] = useState<Blob | null>(null);
  const [newVoiceName, setNewVoiceName] = useState('');
  const [creatingVoice, setCreatingVoice] = useState(false);
  const [deletingVoice, setDeletingVoice] = useState<string | null>(null);
  const [voiceRecordingText, setVoiceRecordingText] = useState<string>(DEFAULT_VOICE_RECORDING_TEXT);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  // Load parent voices on mount
  useEffect(() => {
    async function loadParentVoices() {
      if (!user) return;

      try {
        const idToken = await user.getIdToken();
        const response = await fetch('/api/voices/clone', {
          headers: { Authorization: `Bearer ${idToken}` },
        });
        const result = await response.json();
        if (result.ok) {
          setParentVoices(result.voices || []);
        }
      } catch (error) {
        console.error('[VoiceSelector] Failed to load parent voices:', error);
      } finally {
        setLoadingParentVoices(false);
      }
    }

    loadParentVoices();
  }, [user]);

  // Load voice recording text config
  useEffect(() => {
    async function loadVoiceConfig() {
      if (!user) return;

      try {
        const idToken = await user.getIdToken();
        const response = await fetch('/api/admin/system-config/voice', {
          headers: { Authorization: `Bearer ${idToken}` },
        });
        const result = await response.json();
        if (result.ok && result.config?.voiceRecordingText) {
          setVoiceRecordingText(result.config.voiceRecordingText);
        }
      } catch (error) {
        console.error('[VoiceSelector] Failed to load voice config:', error);
        // Keep using default text
      }
    }

    loadVoiceConfig();
  }, [user]);

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
      const idToken = await user.getIdToken();

      // Call the preview API
      const response = await fetch('/api/voices/preview', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({ voiceName: voiceId }),
      });

      const result = await response.json();

      if (!result.ok) {
        throw new Error(result.errorMessage || 'Failed to generate preview');
      }

      // Create audio from base64 data
      const audioBlob = new Blob(
        [Uint8Array.from(atob(result.audioData), c => c.charCodeAt(0))],
        { type: result.mimeType }
      );
      const audioUrl = URL.createObjectURL(audioBlob);

      const audio = new Audio(audioUrl);
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
      // Find voice name from preset or parent voices
      const presetVoice = ELEVENLABS_TTS_VOICES.find(v => v.id === selectedVoice);
      const parentVoice = parentVoices.find(v => v.elevenLabsVoiceId === selectedVoice);
      const voiceName = presetVoice?.name || parentVoice?.name || selectedVoice;
      toast({
        title: 'Voice saved!',
        description: `${child.displayName}'s stories will now use the ${voiceName} voice.`,
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
  }, [selectedVoice, onVoiceSelect, child.displayName, toast, parentVoices]);

  const handleAutoReadAloudChange = useCallback(async (enabled: boolean) => {
    setSavingAutoRead(true);
    setAutoReadAloud(enabled);

    try {
      if (onAutoReadAloudChange) {
        await onAutoReadAloudChange(enabled);
      }
      toast({
        title: enabled ? 'Read aloud enabled' : 'Read aloud disabled',
        description: enabled
          ? `Stories will automatically be read to ${child.displayName}.`
          : `Stories will not automatically be read aloud.`,
      });
    } catch (error) {
      // Revert on error
      setAutoReadAloud(!enabled);
      toast({
        title: 'Failed to update setting',
        description: 'Please try again.',
        variant: 'destructive',
      });
    } finally {
      setSavingAutoRead(false);
    }
  }, [onAutoReadAloudChange, child.displayName, toast]);

  // Recording functions
  const startRecording = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream, { mimeType: 'audio/webm' });
      mediaRecorderRef.current = mediaRecorder;
      chunksRef.current = [];

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
          chunksRef.current.push(e.data);
        }
      };

      mediaRecorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: 'audio/webm' });
        setRecordedBlob(blob);
        stream.getTracks().forEach(track => track.stop());
      };

      mediaRecorder.start();
      setIsRecording(true);
    } catch (error: any) {
      toast({
        title: 'Microphone access denied',
        description: 'Please allow microphone access to record your voice.',
        variant: 'destructive',
      });
    }
  }, [toast]);

  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
    }
  }, [isRecording]);

  const handleCreateVoice = useCallback(async () => {
    if (!user || !recordedBlob || !newVoiceName.trim()) {
      toast({
        title: 'Missing information',
        description: 'Please record audio and enter a name for the voice.',
        variant: 'destructive',
      });
      return;
    }

    setCreatingVoice(true);

    try {
      const idToken = await user.getIdToken();

      const formData = new FormData();
      formData.append('name', newVoiceName.trim());
      formData.append('audio', recordedBlob, 'recording.webm');

      const response = await fetch('/api/voices/clone', {
        method: 'POST',
        headers: { Authorization: `Bearer ${idToken}` },
        body: formData,
      });

      const result = await response.json();

      if (!result.ok) {
        throw new Error(result.errorMessage || 'Failed to create voice');
      }

      // Add new voice to list
      setParentVoices(prev => [result.voice, ...prev]);
      setNewVoiceName('');
      setRecordedBlob(null);
      setShowRecorder(false);

      toast({
        title: 'Voice created!',
        description: `"${newVoiceName}" is now available as a narrator voice.`,
      });
    } catch (error: any) {
      toast({
        title: 'Failed to create voice',
        description: error.message || 'Please try again.',
        variant: 'destructive',
      });
    } finally {
      setCreatingVoice(false);
    }
  }, [user, recordedBlob, newVoiceName, toast]);

  const handleDeleteVoice = useCallback(async (voiceId: string) => {
    if (!user) return;

    setDeletingVoice(voiceId);

    try {
      const idToken = await user.getIdToken();

      const response = await fetch('/api/voices/clone', {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({ voiceId }),
      });

      const result = await response.json();

      if (!result.ok) {
        throw new Error(result.errorMessage || 'Failed to delete voice');
      }

      // Remove from list
      setParentVoices(prev => prev.filter(v => v.elevenLabsVoiceId !== voiceId));

      // If this was the selected voice, switch to default
      if (selectedVoice === voiceId) {
        setSelectedVoice(DEFAULT_TTS_VOICE);
      }

      toast({
        title: 'Voice deleted',
        description: result.childrenUpdated > 0
          ? `Voice removed. ${result.childrenUpdated} children switched to default voice.`
          : 'Voice has been removed.',
      });
    } catch (error: any) {
      toast({
        title: 'Failed to delete voice',
        description: error.message || 'Please try again.',
        variant: 'destructive',
      });
    } finally {
      setDeletingVoice(null);
    }
  }, [user, selectedVoice, toast]);

  // Get current voice name for display
  const getCurrentVoiceName = () => {
    const currentId = child.preferredVoiceId || DEFAULT_TTS_VOICE;
    const presetVoice = ELEVENLABS_TTS_VOICES.find(v => v.id === currentId);
    if (presetVoice) return presetVoice.name;
    const parentVoice = parentVoices.find(v => v.elevenLabsVoiceId === currentId);
    if (parentVoice) return parentVoice.name;
    return 'Rachel';
  };

  const hasChanged = selectedVoice !== (child.preferredVoiceId || DEFAULT_TTS_VOICE);

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-semibold mb-2">Story Narrator Voice</h3>
        <p className="text-sm text-muted-foreground">
          Choose a voice for reading {child.displayName}'s stories aloud.
        </p>
      </div>

      {/* Read Aloud Toggle */}
      <div className="flex items-center justify-between rounded-lg border p-4">
        <div className="space-y-0.5">
          <Label htmlFor="auto-read-aloud" className="text-base font-medium">
            Read to Me
          </Label>
          <p className="text-sm text-muted-foreground">
            Automatically read text and options aloud during story creation and reading.
          </p>
        </div>
        <Switch
          id="auto-read-aloud"
          checked={autoReadAloud}
          onCheckedChange={handleAutoReadAloudChange}
          disabled={savingAutoRead}
        />
      </div>

      {/* Parent Voices Section */}
      {(parentVoices.length > 0 || showRecorder) && (
        <div className="space-y-3">
          <h4 className="text-sm font-medium flex items-center gap-2">
            <User className="h-4 w-4" />
            Family Voices
          </h4>

          <RadioGroup
            value={selectedVoice}
            onValueChange={setSelectedVoice}
            className="grid grid-cols-1 sm:grid-cols-2 gap-3"
          >
            {parentVoices.map((voice) => (
              <div key={voice.elevenLabsVoiceId} className="relative">
                <RadioGroupItem
                  value={voice.elevenLabsVoiceId}
                  id={`voice-${voice.elevenLabsVoiceId}`}
                  className="peer sr-only"
                />
                <Label
                  htmlFor={`voice-${voice.elevenLabsVoiceId}`}
                  className="flex items-center justify-between rounded-lg border-2 border-muted bg-popover p-4 hover:bg-accent hover:text-accent-foreground peer-data-[state=checked]:border-primary cursor-pointer"
                >
                  <div className="flex items-center gap-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{voice.name}</span>
                        {selectedVoice === voice.elevenLabsVoiceId && (
                          <Check className="h-4 w-4 text-primary" />
                        )}
                      </div>
                      <p className="text-sm text-muted-foreground">Custom family voice</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={(e) => {
                        e.preventDefault();
                        handlePreviewVoice(voice.elevenLabsVoiceId);
                      }}
                      disabled={loadingPreview !== null && loadingPreview !== voice.elevenLabsVoiceId}
                    >
                      {loadingPreview === voice.elevenLabsVoiceId ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Volume2 className="h-4 w-4" />
                      )}
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={(e) => {
                        e.preventDefault();
                        if (confirm(`Delete "${voice.name}"? Children using this voice will switch to the default.`)) {
                          handleDeleteVoice(voice.elevenLabsVoiceId);
                        }
                      }}
                      disabled={deletingVoice === voice.elevenLabsVoiceId}
                    >
                      {deletingVoice === voice.elevenLabsVoiceId ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Trash2 className="h-4 w-4 text-destructive" />
                      )}
                    </Button>
                  </div>
                </Label>
              </div>
            ))}
          </RadioGroup>
        </div>
      )}

      {/* Voice Recording Section */}
      {showRecorder ? (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Record New Voice</CardTitle>
            <CardDescription>
              Read the script below aloud in a clear, natural voice. The varied styles help create a better voice clone.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="voice-name">Voice Name</Label>
              <Input
                id="voice-name"
                placeholder="e.g., Mum, Dad, Grandma"
                value={newVoiceName}
                onChange={(e) => setNewVoiceName(e.target.value)}
                disabled={creatingVoice}
              />
            </div>

            {/* Recording Script */}
            <div className="space-y-2">
              <Label>Recording Script</Label>
              <ScrollArea className="h-64 rounded-md border bg-muted/50 p-3">
                <div className="text-sm whitespace-pre-wrap pr-4">
                  {voiceRecordingText}
                </div>
              </ScrollArea>
              <p className="text-xs text-muted-foreground">
                Read naturally with varied pacing and emotion as suggested in brackets. Recording 1-2 minutes creates the best results.
              </p>
            </div>

            <div className="flex items-center gap-4">
              {!recordedBlob ? (
                <Button
                  type="button"
                  variant={isRecording ? 'destructive' : 'outline'}
                  onClick={isRecording ? stopRecording : startRecording}
                  disabled={creatingVoice}
                  className="flex-1"
                >
                  {isRecording ? (
                    <>
                      <MicOff className="mr-2 h-4 w-4" />
                      Stop Recording
                    </>
                  ) : (
                    <>
                      <Mic className="mr-2 h-4 w-4" />
                      Start Recording
                    </>
                  )}
                </Button>
              ) : (
                <div className="flex-1 flex items-center gap-2">
                  <span className="text-sm text-green-600">Recording ready</span>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setRecordedBlob(null)}
                    disabled={creatingVoice}
                  >
                    Re-record
                  </Button>
                </div>
              )}
            </div>

            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setShowRecorder(false);
                  setRecordedBlob(null);
                  setNewVoiceName('');
                }}
                disabled={creatingVoice}
              >
                Cancel
              </Button>
              <Button
                type="button"
                onClick={handleCreateVoice}
                disabled={!recordedBlob || !newVoiceName.trim() || creatingVoice}
              >
                {creatingVoice ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Creating Voice...
                  </>
                ) : (
                  'Create Voice'
                )}
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : (
        <Button
          type="button"
          variant="outline"
          onClick={() => setShowRecorder(true)}
          className="w-full"
        >
          <Plus className="mr-2 h-4 w-4" />
          Add Family Voice
        </Button>
      )}

      {/* British Voices Section */}
      <div className="space-y-3">
        <h4 className="text-sm font-medium">British Voices</h4>
        <RadioGroup
          value={selectedVoice}
          onValueChange={setSelectedVoice}
          className="grid grid-cols-1 sm:grid-cols-2 gap-3"
        >
          {ELEVENLABS_BRITISH_VOICES.map((voice) => (
            <div key={voice.id} className="relative">
              <RadioGroupItem
                value={voice.id}
                id={`voice-${voice.id}`}
                className="peer sr-only"
              />
              <Label
                htmlFor={`voice-${voice.id}`}
                className="flex items-center justify-between rounded-lg border-2 border-muted bg-popover p-4 hover:bg-accent hover:text-accent-foreground peer-data-[state=checked]:border-primary cursor-pointer"
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
                  disabled={loadingPreview !== null && loadingPreview !== voice.id}
                >
                  {loadingPreview === voice.id ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Volume2 className="h-4 w-4" />
                  )}
                </Button>
              </Label>
            </div>
          ))}
        </RadioGroup>
      </div>

      {/* Other Voices Section */}
      <div className="space-y-3">
        <h4 className="text-sm font-medium">Other Voices</h4>
        <RadioGroup
          value={selectedVoice}
          onValueChange={setSelectedVoice}
          className="grid grid-cols-1 sm:grid-cols-2 gap-3"
        >
          {ELEVENLABS_OTHER_VOICES.map((voice) => (
            <div key={voice.id} className="relative">
              <RadioGroupItem
                value={voice.id}
                id={`voice-${voice.id}`}
                className="peer sr-only"
              />
              <Label
                htmlFor={`voice-${voice.id}`}
                className="flex items-center justify-between rounded-lg border-2 border-muted bg-popover p-4 hover:bg-accent hover:text-accent-foreground peer-data-[state=checked]:border-primary cursor-pointer"
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
                  disabled={loadingPreview !== null && loadingPreview !== voice.id}
                >
                  {loadingPreview === voice.id ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Volume2 className="h-4 w-4" />
                  )}
                </Button>
              </Label>
            </div>
          ))}
        </RadioGroup>
      </div>

      <div className="flex items-center justify-between pt-4 border-t">
        <div className="text-sm text-muted-foreground">
          {hasChanged ? (
            <span className="text-amber-600">Unsaved changes</span>
          ) : (
            <span>Current voice: <strong>{getCurrentVoiceName()}</strong></span>
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
    </div>
  );
}
