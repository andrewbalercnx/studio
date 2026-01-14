'use client';

import { useAdminStatus } from '@/hooks/use-admin-status';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  LoaderCircle,
  ChevronDown,
  ChevronUp,
  Play,
  Square,
  CheckCircle,
  RefreshCw,
  Volume2,
  Sparkles,
} from 'lucide-react';
import { Switch } from '@/components/ui/switch';
import { DiagnosticsPanel } from '@/components/diagnostics-panel';
import { useEffect, useState, useRef, useCallback } from 'react';
import { useFirestore, useAuth } from '@/firebase';
import { collection, doc, onSnapshot, updateDoc } from 'firebase/firestore';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import type { AnswerAnimation } from '@/lib/types';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Slider } from '@/components/ui/slider';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

// Easing options for animations
const EASING_OPTIONS = [
  { value: 'ease', label: 'Ease (default)' },
  { value: 'ease-in', label: 'Ease In' },
  { value: 'ease-out', label: 'Ease Out' },
  { value: 'ease-in-out', label: 'Ease In Out' },
  { value: 'linear', label: 'Linear' },
];

// Animation Test Dialog Component
function AnimationTestDialog({
  animation,
  open,
  onClose,
}: {
  animation: AnswerAnimation;
  open: boolean;
  onClose: () => void;
}) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [showCard, setShowCard] = useState(true);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const handleTest = useCallback(() => {
    if (isPlaying) return;

    setShowCard(true);
    setIsPlaying(true);

    // Small delay to ensure card is visible before animating
    setTimeout(() => {
      // Play sound effect if available
      if (animation.soundEffect?.audioUrl) {
        audioRef.current = new Audio(animation.soundEffect.audioUrl);
        audioRef.current.play().catch(console.error);
      }
    }, 50);

    // Reset after animation completes
    setTimeout(() => {
      setIsPlaying(false);
      setShowCard(true);
    }, animation.durationMs + 500);
  }, [isPlaying, animation.durationMs, animation.soundEffect?.audioUrl]);

  // Cleanup audio on close
  useEffect(() => {
    if (!open && audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }
  }, [open]);

  // Reset state when dialog opens
  useEffect(() => {
    if (open) {
      setIsPlaying(false);
      setShowCard(true);
    }
  }, [open]);

  const animationStyle = isPlaying
    ? {
        animation: `${animation.cssAnimationName} ${animation.durationMs}ms ${animation.easing} forwards`,
      }
    : {};

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Test Animation: {animation.name}</DialogTitle>
          <DialogDescription>
            Preview how this animation will look and sound.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Inject CSS keyframes */}
          <style dangerouslySetInnerHTML={{ __html: animation.cssKeyframes }} />

          {/* Test area */}
          <div className="relative h-48 bg-gradient-to-br from-amber-50 to-orange-50 rounded-lg overflow-hidden flex items-center justify-center">
            {showCard && (
              <div
                className="bg-white rounded-xl shadow-lg p-4 w-48 border-2 border-amber-200"
                style={animationStyle}
              >
                <div className="text-center">
                  <div className="text-2xl mb-2">🎯</div>
                  <p className="font-medium text-gray-700">Sample Choice</p>
                  <p className="text-sm text-gray-500">This is what a card looks like</p>
                </div>
              </div>
            )}
          </div>

          {/* Controls */}
          <div className="flex items-center justify-between">
            <Button onClick={handleTest} disabled={isPlaying}>
              {isPlaying ? (
                <>
                  <LoaderCircle className="h-4 w-4 animate-spin mr-2" />
                  Playing...
                </>
              ) : (
                <>
                  <Play className="h-4 w-4 mr-2" />
                  Play Animation
                </>
              )}
            </Button>

            <div className="text-sm text-muted-foreground">
              Duration: {animation.durationMs}ms ({(animation.durationMs / 1000).toFixed(1)}s)
            </div>
          </div>

          {/* Sound effect status */}
          {animation.soundEffect?.audioUrl ? (
            <p className="text-sm text-green-600 flex items-center gap-1">
              <Volume2 className="h-4 w-4" />
              Sound effect will play with animation
            </p>
          ) : (
            <p className="text-sm text-muted-foreground">
              No sound effect generated yet
            </p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// Sound Effect Editor Component
function SoundEffectEditor({
  animation,
  onSave,
  onGenerate,
}: {
  animation: AnswerAnimation;
  onSave: (data: { prompt: string; durationSeconds: number; promptInfluence: number }) => Promise<void>;
  onGenerate: () => Promise<void>;
}) {
  const { toast } = useToast();
  const [prompt, setPrompt] = useState(animation.soundEffect?.prompt || '');
  const [durationSeconds, setDurationSeconds] = useState(animation.soundEffect?.durationSeconds || 0.5);
  const [promptInfluence, setPromptInfluence] = useState(animation.soundEffect?.promptInfluence || 0.3);
  const [saving, setSaving] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const sfxStatus = animation.soundEffect?.generation?.status || 'idle';
  const audioUrl = animation.soundEffect?.audioUrl;

  const hasChanges =
    prompt !== (animation.soundEffect?.prompt || '') ||
    durationSeconds !== (animation.soundEffect?.durationSeconds || 0.5) ||
    promptInfluence !== (animation.soundEffect?.promptInfluence || 0.3);

  // Update local state when animation prop changes
  useEffect(() => {
    setPrompt(animation.soundEffect?.prompt || '');
    setDurationSeconds(animation.soundEffect?.durationSeconds || 0.5);
    setPromptInfluence(animation.soundEffect?.promptInfluence || 0.3);
  }, [animation.soundEffect]);

  const handleSave = async () => {
    setSaving(true);
    try {
      await onSave({ prompt, durationSeconds, promptInfluence });
      toast({ title: 'Saved', description: 'Sound effect settings saved' });
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      toast({ title: 'Error', description: errorMessage, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  const handleGenerate = async () => {
    setGenerating(true);
    try {
      await onGenerate();
      toast({ title: 'Success', description: 'Sound effect generated!' });
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      toast({ title: 'Error', description: errorMessage, variant: 'destructive' });
    } finally {
      setGenerating(false);
    }
  };

  const handlePlay = () => {
    if (!audioUrl) return;
    if (audioRef.current) {
      audioRef.current.pause();
    }
    audioRef.current = new Audio(audioUrl);
    audioRef.current.play().catch(console.error);
    setIsPlaying(true);
    audioRef.current.onended = () => setIsPlaying(false);
  };

  const handleStop = () => {
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
      <div className="space-y-2">
        <Label htmlFor="sfxPrompt">Sound Effect Prompt</Label>
        <Textarea
          id="sfxPrompt"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="e.g., quick whoosh sound, cartoon swoosh"
          rows={2}
        />
        <p className="text-xs text-muted-foreground">
          Describe the sound effect you want. Keep it short and descriptive.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label>Duration: {durationSeconds.toFixed(1)}s</Label>
          <Slider
            value={[durationSeconds]}
            onValueChange={([val]) => setDurationSeconds(val)}
            min={0.5}
            max={5}
            step={0.1}
          />
          <p className="text-xs text-muted-foreground">
            0.5s - 5s (match animation duration)
          </p>
        </div>

        <div className="space-y-2">
          <Label>Prompt Influence: {promptInfluence.toFixed(1)}</Label>
          <Slider
            value={[promptInfluence]}
            onValueChange={([val]) => setPromptInfluence(val)}
            min={0}
            max={1}
            step={0.1}
          />
          <p className="text-xs text-muted-foreground">
            0 = more creative, 1 = more literal
          </p>
        </div>
      </div>

      <div className="flex items-center gap-3">
        {hasChanges && (
          <Button variant="outline" onClick={handleSave} disabled={saving}>
            {saving ? <LoaderCircle className="h-4 w-4 animate-spin mr-2" /> : null}
            Save Settings
          </Button>
        )}

        <Button
          onClick={handleGenerate}
          disabled={!prompt || generating || sfxStatus === 'generating'}
        >
          {generating || sfxStatus === 'generating' ? (
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
              <Volume2 className="h-4 w-4 mr-2" />
              Generate Sound
            </>
          )}
        </Button>

        {sfxStatus === 'ready' && audioUrl && (
          <span className="text-sm text-green-600 flex items-center gap-1">
            <CheckCircle className="h-4 w-4" /> Ready
          </span>
        )}
        {sfxStatus === 'error' && (
          <span className="text-sm text-red-600">
            Error: {animation.soundEffect?.generation?.lastErrorMessage || 'Unknown'}
          </span>
        )}
      </div>

      {audioUrl && (
        <div className="border rounded-lg p-3 bg-muted/30">
          <div className="flex items-center gap-3">
            {!isPlaying ? (
              <Button variant="outline" size="sm" onClick={handlePlay}>
                <Play className="h-4 w-4 mr-1" /> Play Sound
              </Button>
            ) : (
              <Button variant="outline" size="sm" onClick={handleStop}>
                <Square className="h-4 w-4 mr-1" /> Stop
              </Button>
            )}
            <span className="text-xs text-muted-foreground">
              Duration: {durationSeconds.toFixed(1)}s
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

// Animation Card Component
function AnimationCard({
  animation,
  onUpdate,
  onGenerateSound,
}: {
  animation: AnswerAnimation;
  onUpdate: (data: Partial<AnswerAnimation>) => Promise<void>;
  onGenerateSound: () => Promise<void>;
}) {
  const { toast } = useToast();
  const [expanded, setExpanded] = useState(false);
  const [testDialogOpen, setTestDialogOpen] = useState(false);

  // Local state for editable fields
  const [durationMs, setDurationMs] = useState(animation.durationMs);
  const [easing, setEasing] = useState(animation.easing);
  const [isActive, setIsActive] = useState(animation.isActive);
  const [saving, setSaving] = useState(false);

  const hasSound = !!animation.soundEffect?.audioUrl;
  const hasChanges =
    durationMs !== animation.durationMs ||
    easing !== animation.easing ||
    isActive !== animation.isActive;

  // Update local state when animation prop changes
  useEffect(() => {
    setDurationMs(animation.durationMs);
    setEasing(animation.easing);
    setIsActive(animation.isActive);
  }, [animation.durationMs, animation.easing, animation.isActive]);

  const handleSaveSettings = async () => {
    setSaving(true);
    try {
      await onUpdate({ durationMs, easing, isActive });
      toast({ title: 'Saved', description: 'Animation settings updated' });
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      toast({ title: 'Error', description: errorMessage, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  const handleToggleActive = async (checked: boolean) => {
    setIsActive(checked);
    try {
      await onUpdate({ isActive: checked });
    } catch (error: unknown) {
      setIsActive(!checked); // Revert on error
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      toast({ title: 'Error', description: errorMessage, variant: 'destructive' });
    }
  };

  const handleSaveSoundEffect = async (data: {
    prompt: string;
    durationSeconds: number;
    promptInfluence: number;
  }) => {
    await onUpdate({
      soundEffect: {
        ...animation.soundEffect,
        prompt: data.prompt,
        durationSeconds: data.durationSeconds,
        promptInfluence: data.promptInfluence,
        generation: animation.soundEffect?.generation || { status: 'idle' },
      },
    });
  };

  return (
    <>
      <Card className={!isActive ? 'opacity-60' : ''}>
        <CardHeader
          className="cursor-pointer hover:bg-muted/50 transition-colors py-3"
          onClick={() => setExpanded(!expanded)}
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <span className="text-2xl">
                {animation.type === 'selection' ? '🎉' : '🎯'}
              </span>
              <div>
                <CardTitle className="text-base flex items-center gap-2">
                  {animation.name}
                  <span
                    className={`text-xs px-2 py-0.5 rounded ${
                      animation.type === 'selection'
                        ? 'bg-purple-100 text-purple-800'
                        : 'bg-blue-100 text-blue-800'
                    }`}
                  >
                    {animation.type}
                  </span>
                  {hasSound && (
                    <span className="text-xs bg-green-100 text-green-800 px-2 py-0.5 rounded flex items-center gap-1">
                      <Volume2 className="h-3 w-3" /> Sound
                    </span>
                  )}
                </CardTitle>
                <CardDescription className="text-xs">
                  {animation.durationMs}ms • {animation.easing}
                </CardDescription>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Switch
                checked={isActive}
                onCheckedChange={handleToggleActive}
                onClick={(e) => e.stopPropagation()}
              />
              <Button variant="ghost" size="icon">
                {expanded ? (
                  <ChevronUp className="h-5 w-5" />
                ) : (
                  <ChevronDown className="h-5 w-5" />
                )}
              </Button>
            </div>
          </div>
        </CardHeader>

        {expanded && (
          <CardContent className="border-t pt-4 space-y-6">
            {/* Animation Settings */}
            <div className="space-y-4">
              <h4 className="font-medium">Animation Settings</h4>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Duration: {durationMs}ms ({(durationMs / 1000).toFixed(1)}s)</Label>
                  <Slider
                    value={[durationMs]}
                    onValueChange={([val]) => setDurationMs(val)}
                    min={100}
                    max={2000}
                    step={50}
                  />
                </div>

                <div className="space-y-2">
                  <Label>Easing</Label>
                  <Select value={easing} onValueChange={setEasing}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {EASING_OPTIONS.map((opt) => (
                        <SelectItem key={opt.value} value={opt.value}>
                          {opt.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="flex items-center gap-3">
                {hasChanges && (
                  <Button onClick={handleSaveSettings} disabled={saving}>
                    {saving ? <LoaderCircle className="h-4 w-4 animate-spin mr-2" /> : null}
                    Save Settings
                  </Button>
                )}
                <Button variant="outline" onClick={() => setTestDialogOpen(true)}>
                  <Play className="h-4 w-4 mr-2" />
                  Test Animation
                </Button>
              </div>
            </div>

            {/* Sound Effect Section */}
            <div className="border-t pt-4">
              <h4 className="font-medium mb-4">Sound Effect</h4>
              <SoundEffectEditor
                animation={animation}
                onSave={handleSaveSoundEffect}
                onGenerate={onGenerateSound}
              />
            </div>

            {/* CSS Preview */}
            <div className="border-t pt-4">
              <h4 className="font-medium mb-2">CSS Keyframes</h4>
              <pre className="text-xs bg-muted p-3 rounded-lg overflow-x-auto">
                {animation.cssKeyframes}
              </pre>
            </div>
          </CardContent>
        )}
      </Card>

      <AnimationTestDialog
        animation={{ ...animation, durationMs, easing }}
        open={testDialogOpen}
        onClose={() => setTestDialogOpen(false)}
      />
    </>
  );
}

export default function AdminAnswerAnimationsPage() {
  const { isAuthenticated, isAdmin, isWriter, email, loading: authLoading } = useAdminStatus();
  const firestore = useFirestore();
  const auth = useAuth();
  const { toast } = useToast();

  const [animations, setAnimations] = useState<AnswerAnimation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [seeding, setSeeding] = useState(false);

  const exitAnimations = animations.filter((a) => a.type === 'exit');
  const selectionAnimations = animations.filter((a) => a.type === 'selection');

  useEffect(() => {
    if (!firestore || (!isAdmin && !isWriter)) {
      setLoading(false);
      return;
    }

    setLoading(true);
    const animationsRef = collection(firestore, 'answerAnimations');

    const unsubscribe = onSnapshot(
      animationsRef,
      (snapshot) => {
        const animList = snapshot.docs.map(
          (d) => ({ ...d.data(), id: d.id } as AnswerAnimation)
        );
        // Sort by order, then by name
        animList.sort((a, b) => {
          if (a.order !== b.order) return a.order - b.order;
          return a.name.localeCompare(b.name);
        });
        setAnimations(animList);
        setLoading(false);
        setError(null);
      },
      (err) => {
        console.error('Error fetching animations:', err);
        setError('Could not fetch answer animations.');
        setAnimations([]);
        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, [firestore, isAdmin, isWriter]);

  const handleSeedAnimations = async () => {
    if (!auth.currentUser) return;
    setSeeding(true);
    try {
      const token = await auth.currentUser.getIdToken();
      const response = await fetch('/api/soundEffects/seed', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
      const result = await response.json();
      if (!result.ok) {
        throw new Error(result.errorMessage);
      }
      toast({ title: 'Success', description: result.message });
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      toast({ title: 'Error', description: errorMessage, variant: 'destructive' });
    } finally {
      setSeeding(false);
    }
  };

  const handleUpdateAnimation = async (animationId: string, data: Partial<AnswerAnimation>) => {
    if (!firestore) return;
    const docRef = doc(firestore, 'answerAnimations', animationId);
    await updateDoc(docRef, data);
  };

  const handleGenerateSound = async (animationId: string) => {
    if (!auth.currentUser) return;
    const token = await auth.currentUser.getIdToken();
    const response = await fetch('/api/soundEffects/generate', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ animationId }),
    });
    const result = await response.json();
    if (!result.ok) {
      throw new Error(result.errorMessage);
    }
  };

  const diagnostics = {
    page: 'admin-answerAnimations',
    auth: {
      isAuthenticated,
      email,
      isAdmin,
      isWriter,
      loading: authLoading,
    },
    firestore: {
      collection: 'answerAnimations',
      count: animations.length,
      exitCount: exitAnimations.length,
      selectionCount: selectionAnimations.length,
    },
    ...(error ? { error } : {}),
  };

  const renderContent = () => {
    if (authLoading || loading) {
      return (
        <div className="flex items-center gap-2">
          <LoaderCircle className="h-5 w-5 animate-spin" />
          <span>Loading animations...</span>
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
    if (animations.length === 0) {
      return (
        <div className="text-center py-8 border-2 border-dashed rounded-lg">
          <Sparkles className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
          <p className="text-muted-foreground mb-4">No answer animations found.</p>
          <Button onClick={handleSeedAnimations} disabled={seeding}>
            {seeding ? <LoaderCircle className="h-4 w-4 animate-spin mr-2" /> : null}
            Seed Default Animations
          </Button>
        </div>
      );
    }

    return (
      <Tabs defaultValue="exit">
        <TabsList className="mb-4">
          <TabsTrigger value="exit">
            Exit Animations ({exitAnimations.length})
          </TabsTrigger>
          <TabsTrigger value="selection">
            Selection Animation ({selectionAnimations.length})
          </TabsTrigger>
        </TabsList>

        <TabsContent value="exit" className="space-y-3">
          <p className="text-sm text-muted-foreground mb-4">
            These animations are randomly selected to remove non-selected answer cards from the screen.
          </p>
          {exitAnimations.map((anim) => (
            <AnimationCard
              key={anim.id}
              animation={anim}
              onUpdate={(data) => handleUpdateAnimation(anim.id, data)}
              onGenerateSound={() => handleGenerateSound(anim.id)}
            />
          ))}
        </TabsContent>

        <TabsContent value="selection" className="space-y-3">
          <p className="text-sm text-muted-foreground mb-4">
            This animation celebrates the selected answer and then moves it off-screen.
          </p>
          {selectionAnimations.map((anim) => (
            <AnimationCard
              key={anim.id}
              animation={anim}
              onUpdate={(data) => handleUpdateAnimation(anim.id, data)}
              onGenerateSound={() => handleGenerateSound(anim.id)}
            />
          ))}
        </TabsContent>
      </Tabs>
    );
  };

  return (
    <div className="container mx-auto p-4 sm:p-6 md:p-8">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle>Answer Animations</CardTitle>
            <CardDescription>
              Configure animations and sound effects for Q&A answer cards. When a child
              answers a question, non-selected answers animate off-screen with sound
              effects, followed by the selected answer celebrating and exiting.
            </CardDescription>
          </div>
          {animations.length > 0 && (
            <Button variant="outline" onClick={handleSeedAnimations} disabled={seeding}>
              {seeding ? (
                <LoaderCircle className="h-4 w-4 animate-spin mr-2" />
              ) : (
                <RefreshCw className="h-4 w-4 mr-2" />
              )}
              Reset Defaults
            </Button>
          )}
        </CardHeader>
        <CardContent>{renderContent()}</CardContent>
      </Card>

      <DiagnosticsPanel pageName="admin-answerAnimations" data={diagnostics} className="mt-8" />
    </div>
  );
}
