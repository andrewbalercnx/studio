
'use client';

import { useAdminStatus } from '@/hooks/use-admin-status';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Copy, LoaderCircle, ChevronDown, ChevronUp, Trash2, Plus, GripVertical, Pencil, X, Check, Music, Play, Square, CheckCircle } from 'lucide-react';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useEffect, useState, useCallback, useRef } from 'react';
import { useFirestore, useAuth } from '@/firebase';
import { collection, doc, onSnapshot, writeBatch, query, orderBy, updateDoc, setDoc } from 'firebase/firestore';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import type { StoryType, StoryTypePromptConfig, ArcStep } from '@/lib/types';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';

// Helper to format age range for display
function formatAgeRange(storyType: StoryType): string {
  const { ageFrom, ageTo, ageRange } = storyType;
  // Support new ageFrom/ageTo fields
  if (ageFrom !== undefined || ageTo !== undefined) {
    if (ageFrom != null && ageTo != null) {
      return `${ageFrom}-${ageTo}`;
    } else if (ageFrom != null) {
      return `${ageFrom}+`;
    } else if (ageTo != null) {
      return `up to ${ageTo}`;
    }
    return 'All ages';
  }
  // Fallback to legacy ageRange
  return ageRange || 'All ages';
}

// Default prompt config for new story types
const defaultPromptConfig: StoryTypePromptConfig = {
    roleDefinition: "You are a gentle storyteller guiding a young child through a magical adventure. You speak in warm, simple language filled with wonder.",
    behaviorRules: [
        "Always use placeholder IDs ($$id$$) for characters - never include display names",
        "Never introduce scary or threatening elements",
        "Keep sentences short and rhythmic for young listeners",
        "Include sensory details that bring the story to life"
    ],
    narrativeStyle: "Warm and cozy with gentle wonder",
    thematicElements: ["Friendship", "Kindness", "Small adventures"],
    pacing: "moderate",
    emotionalTone: "gentle",
    storyBeatInstructions: "Continue the story with gentle pacing. Each beat should include a small discovery or interaction. End each beat with exactly 3 choices for the child.",
    warmupInstructions: "Engage the child in friendly conversation to understand their mood and preferences.",
    endingInstructions: "Bring the story to a cozy, satisfying conclusion with warmth and contentment.",
    model: {
        name: "googleai/gemini-2.5-pro",
        temperature: 0.7,
        maxOutputTokens: 10000
    }
};

const sampleStoryTypes: StoryType[] = [
    {
        id: "animal_adventure_v1",
        name: "Animal Adventure",
        shortDescription: "A friendly animal goes on a small adventure to meet a friend or find something special.",
        ageFrom: 3,
        ageTo: 5,
        status: "live",
        tags: ["animals", "adventure", "gentle"],
        defaultPhaseId: "story_beat_phase_v1",
        endingPhaseId: "ending_phase_v1",
        levelBands: ["low", "medium", "high"],
        arcTemplate: {
            steps: [
                { id: "introduce_character", label: "Introduce Character", guidance: "Introduce the main character in their familiar, cozy world. Show their personality through a simple action or thought. Keep it warm and inviting." },
                { id: "explore_setting", label: "Explore Setting", guidance: "The character ventures into or notices something interesting in their environment. Build curiosity and wonder about the natural world around them." },
                { id: "tiny_goal", label: "Tiny Goal", guidance: "The character decides they want to do something small but meaningful - find a friend, get a treat, or explore a new spot. Keep the goal simple and relatable." },
                { id: "tiny_obstacle", label: "Tiny Obstacle", guidance: "A gentle, non-scary challenge appears. This should be solvable with kindness, creativity, or help from a friend. Never anything frightening." },
                { id: "resolution", label: "Resolution", guidance: "The character overcomes the obstacle in a satisfying way, perhaps with help from a new or existing friend. Celebrate the small victory with warmth." },
                { id: "happy_close", label: "Happy Close", guidance: "End on a cozy, content note. The character is safe, happy, and perhaps has learned something or made a friend. Leave the child feeling good." }
            ]
        },
        promptConfig: {
            roleDefinition: "You are a gentle storyteller guiding a young child through a cozy animal adventure. You speak in warm, simple language filled with wonder about the natural world.",
            behaviorRules: [
                "Always use placeholder IDs ($$id$$) for characters - never include display names",
                "Never introduce scary or threatening elements",
                "Keep sentences short and rhythmic for young listeners",
                "Include sensory details about nature - sounds, smells, textures"
            ],
            narrativeStyle: "Warm and cozy with gentle wonder about animals and nature",
            thematicElements: ["Friendship", "Nature appreciation", "Helping others", "Small adventures"],
            pacing: "slow",
            emotionalTone: "gentle",
            storyBeatInstructions: "Continue the animal adventure with gentle pacing. Each beat should include a small discovery or interaction with nature. Animals should be friendly and curious.",
            warmupInstructions: "Ask about the child's favorite animals. Be curious about what animals they might want to meet on an adventure.",
            endingInstructions: "Bring the animal adventure to a cozy conclusion. The animal friend says goodbye with a promise to meet again.",
            model: {
                name: "googleai/gemini-2.5-pro",
                temperature: 0.7,
                maxOutputTokens: 10000
            }
        }
    },
    {
        id: "magical_friend_v1",
        name: "Magical Friend",
        shortDescription: "A gentle magical friend helps with a small problem using kind, sparkly magic.",
        ageFrom: 3,
        ageTo: 5,
        status: "live",
        tags: ["magic", "friendship", "gentle"],
        defaultPhaseId: "story_beat_phase_v1",
        endingPhaseId: "ending_phase_v1",
        levelBands: ["low", "medium", "high"],
        arcTemplate: {
            steps: [
                { id: "introduce_character", label: "Introduce Character", guidance: "Introduce the main character in their everyday world. Establish their personality and hint at something special about to happen." },
                { id: "meet_magical_friend", label: "Meet Magical Friend", guidance: "A gentle, friendly magical being appears - perhaps a fairy, a talking animal, or a kind wizard. They should feel safe and kind, never scary." },
                { id: "discover_small_problem", label: "Discover Small Problem", guidance: "The character notices a small problem that needs solving - a lost toy, a sad friend, or something that needs fixing. Keep it low-stakes and relatable." },
                { id: "gentle_magic_helps", label: "Gentle Magic Helps", guidance: "The magical friend uses kind, sparkly magic to help. Describe the magic as warm, glowing, and gentle. The solution should feel wonderful and safe." },
                { id: "resolution", label: "Resolution", guidance: "The problem is solved! Show the happiness this brings. Perhaps there's a small lesson about friendship or kindness woven in naturally." },
                { id: "happy_close", label: "Happy Close", guidance: "The magical friend says a warm goodbye (perhaps promising to return), and the character feels content and special. End with cozy warmth." }
            ]
        }
    },
    {
        id: "big_feelings_v1",
        name: "Big Feelings",
        shortDescription: "A character notices a big feeling and gently learns about it with help from a friend.",
        ageFrom: 3,
        ageTo: 5,
        status: "live",
        tags: ["feelings", "friendship", "gentle"],
        defaultPhaseId: "story_beat_phase_v1",
        endingPhaseId: "ending_phase_v1",
        levelBands: ["low", "medium", "high"],
        arcTemplate: {
            steps: [
                { id: "introduce_character", label: "Introduce Character", guidance: "Introduce the main character doing something ordinary. Set up a calm, relatable scene before the feeling emerges." },
                { id: "notice_feeling", label: "Notice Feeling", guidance: "The character notices they're experiencing a big feeling - maybe frustration, sadness, worry, or excitement. Describe how the feeling shows up in their body." },
                { id: "talk_with_helper", label: "Talk With Helper", guidance: "A caring helper (parent, friend, stuffed animal) notices and asks about the feeling. They listen without judgment and validate that it's okay to feel this way." },
                { id: "try_small_action", label: "Try Small Action", guidance: "Together, they try something gentle to help with the feeling - taking deep breaths, a hug, talking it through, or doing something calming. Show this helping." },
                { id: "feeling_softens", label: "Feeling Softens", guidance: "The big feeling starts to feel more manageable. It doesn't have to disappear completely, but the character feels better able to handle it." },
                { id: "happy_close", label: "Happy Close", guidance: "End with the character feeling understood and okay. Reinforce that all feelings are valid and that it's good to talk about them." }
            ]
        }
    },
    {
        id: "favorite_place_adventure_v1",
        name: "Adventure in a Favorite Place",
        shortDescription: "A small adventure happens in the child's favorite place, using warmup information.",
        ageFrom: 3,
        ageTo: 5,
        status: "live",
        tags: ["place", "exploration", "gentle"],
        defaultPhaseId: "story_beat_phase_v1",
        endingPhaseId: "ending_phase_v1",
        levelBands: ["low", "medium", "high"],
        arcTemplate: {
            steps: [
                { id: "introduce_character", label: "Introduce Character", guidance: "Introduce the main character excited about going to or being in their favorite place. Build anticipation and show why this place is special to them." },
                { id: "arrive_at_favorite_place", label: "Arrive at Favorite Place", guidance: "Describe arriving at or exploring the favorite place with wonder and joy. Use sensory details - what they see, hear, smell. Make it feel magical and special." },
                { id: "tiny_goal", label: "Tiny Goal", guidance: "The character decides they want to do something fun or find something special in this place. The goal should feel natural to the setting." },
                { id: "tiny_obstacle", label: "Tiny Obstacle", guidance: "A small, gentle challenge arises - maybe they can't find what they're looking for, or need to figure something out. Keep it age-appropriate and non-scary." },
                { id: "resolution", label: "Resolution", guidance: "The character solves the problem, perhaps discovering something even better than expected. Celebrate the joy of the favorite place." },
                { id: "happy_close", label: "Happy Close", guidance: "End with warm feelings about the favorite place. The character feels happy and can't wait to return. Create a sense of comfort and belonging." }
            ]
        }
    },
    {
        id: "silly_story_v1",
        name: "Silly Story",
        shortDescription: "A very silly story with giggles, funny things, and safe, playful surprises.",
        ageFrom: 3,
        ageTo: 5,
        status: "live",
        tags: ["silly", "funny", "play"],
        defaultPhaseId: "story_beat_phase_v1",
        endingPhaseId: "ending_phase_v1",
        levelBands: ["low", "medium", "high"],
        arcTemplate: {
            steps: [
                { id: "introduce_character", label: "Introduce Character", guidance: "Introduce the main character in a playful way. Maybe they're already doing something a little silly or unusual. Set a fun, lighthearted tone." },
                { id: "discover_silly_thing", label: "Discover Silly Thing", guidance: "The character discovers something wonderfully silly - a backwards-talking bird, shoes that make funny sounds, food that changes colors. Be creative and playful!" },
                { id: "play_with_silliness", label: "Play With Silliness", guidance: "The character (and maybe friends) play with the silly thing. Include funny sounds, silly actions, and lots of giggle-worthy moments. Keep it joyful and goofy." },
                { id: "tiny_surprise", label: "Tiny Surprise", guidance: "Something unexpectedly funny happens - a playful twist that makes things even sillier. Keep surprises safe and delightful, never scary." },
                { id: "resolution", label: "Resolution", guidance: "The silliness reaches a fun peak, then settles into happy giggles. Maybe everyone joins in the silliness for a big, joyful moment." },
                { id: "happy_close", label: "Happy Close", guidance: "End with everyone happy and maybe still giggling. The silly memory will be treasured. Leave the child smiling and feeling playful." }
            ]
        }
    },
    {
        id: "bedtime_calm_v1",
        name: "Bedtime Calm Story",
        shortDescription: "A soft, sleepy story that ends with everyone cozy and calm.",
        ageFrom: 3,
        ageTo: 5,
        status: "live",
        tags: ["bedtime", "calm", "gentle"],
        defaultPhaseId: "story_beat_phase_v1",
        endingPhaseId: "ending_phase_v1",
        levelBands: ["low", "medium", "high"],
        arcTemplate: {
            steps: [
                { id: "introduce_character", label: "Introduce Character", guidance: "Introduce the main character as evening approaches. Use soft, gentle language. The world is quieting down. Keep the pace slow and soothing." },
                { id: "quiet_activity", label: "Quiet Activity", guidance: "The character does something calm and peaceful - watching stars, having warm milk, gentle play with a stuffed friend. Use sensory details that feel cozy." },
                { id: "soft_change", label: "Soft Change", guidance: "Something gentle happens - perhaps a lullaby is heard, soft lights appear, or a comforting presence arrives. Keep it dreamy and peaceful." },
                { id: "getting_cozy", label: "Getting Cozy", guidance: "The character starts to settle in - finding a cozy spot, cuddling something soft, feeling safe and warm. Describe the comfort in detail." },
                { id: "sleepy_close", label: "Sleepy Close", guidance: "Eyes grow heavy, yawns come naturally. The world feels safe and quiet. Use repetitive, soothing language. Everything is peaceful." },
                { id: "happy_close", label: "Happy Close", guidance: "The character drifts off to happy dreams, surrounded by love and warmth. End with the gentlest, most peaceful feeling possible." }
            ]
        }
    }
];

/**
 * Normalizes arc steps to handle both legacy string format and new ArcStep object format.
 */
function normalizeArcSteps(steps: (string | ArcStep)[]): ArcStep[] {
  return steps.map(step =>
    typeof step === 'string'
      ? { id: step, label: step.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()) }
      : step
  );
}

// Arc Step Editor Component
function ArcStepEditor({
  storyType,
  onSave,
  onDirtyChange
}: {
  storyType: StoryType;
  onSave: (steps: ArcStep[]) => Promise<void>;
  onDirtyChange?: (isDirty: boolean) => void;
}) {
  const rawSteps = storyType.arcTemplate?.steps ?? [];
  const [steps, setSteps] = useState<ArcStep[]>(normalizeArcSteps(rawSteps));
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [editForm, setEditForm] = useState<ArcStep>({ id: '', label: '', guidance: '', suggestsNewCharacter: false });
  const [isAddingNew, setIsAddingNew] = useState(false);
  const [newStep, setNewStep] = useState<ArcStep>({ id: '', label: '', guidance: '', suggestsNewCharacter: false });
  const [saving, setSaving] = useState(false);

  const hasChanges = JSON.stringify(normalizeArcSteps(rawSteps)) !== JSON.stringify(steps);

  // Notify parent of dirty state changes (only when hasChanges actually changes)
  const prevHasChanges = useRef(hasChanges);
  useEffect(() => {
    if (prevHasChanges.current !== hasChanges) {
      prevHasChanges.current = hasChanges;
      onDirtyChange?.(hasChanges);
    }
  }, [hasChanges, onDirtyChange]);

  const handleMoveUp = (index: number) => {
    if (index === 0) return;
    const newSteps = [...steps];
    [newSteps[index - 1], newSteps[index]] = [newSteps[index], newSteps[index - 1]];
    setSteps(newSteps);
  };

  const handleMoveDown = (index: number) => {
    if (index === steps.length - 1) return;
    const newSteps = [...steps];
    [newSteps[index], newSteps[index + 1]] = [newSteps[index + 1], newSteps[index]];
    setSteps(newSteps);
  };

  const handleDelete = (index: number) => {
    const newSteps = steps.filter((_, i) => i !== index);
    setSteps(newSteps);
  };

  const handleStartEdit = (index: number) => {
    setEditingIndex(index);
    setEditForm({ ...steps[index] });
  };

  const handleCancelEdit = () => {
    setEditingIndex(null);
    setEditForm({ id: '', label: '', guidance: '', suggestsNewCharacter: false });
  };

  const handleSaveEdit = () => {
    if (editingIndex === null) return;
    const newSteps = [...steps];
    newSteps[editingIndex] = { ...editForm };
    setSteps(newSteps);
    setEditingIndex(null);
    setEditForm({ id: '', label: '', guidance: '', suggestsNewCharacter: false });
  };

  const handleAddNew = () => {
    if (!newStep.id || !newStep.label) return;
    setSteps([...steps, { ...newStep }]);
    setNewStep({ id: '', label: '', guidance: '', suggestsNewCharacter: false });
    setIsAddingNew(false);
  };

  const handleSaveAll = async () => {
    setSaving(true);
    try {
      await onSave(steps);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h4 className="font-medium">Arc Steps ({steps.length})</h4>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setIsAddingNew(true)}
            disabled={isAddingNew}
          >
            <Plus className="h-4 w-4 mr-1" /> Add Step
          </Button>
          {hasChanges && (
            <Button
              size="sm"
              onClick={handleSaveAll}
              disabled={saving}
            >
              {saving ? <LoaderCircle className="h-4 w-4 animate-spin mr-1" /> : null}
              Save Changes
            </Button>
          )}
        </div>
      </div>

      {/* Add New Step Form */}
      {isAddingNew && (
        <Card className="border-dashed border-2 border-primary/50">
          <CardContent className="pt-4 space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="new-id">Step ID</Label>
                <Input
                  id="new-id"
                  placeholder="e.g., introduce_character"
                  value={newStep.id}
                  onChange={(e) => setNewStep({ ...newStep, id: e.target.value.toLowerCase().replace(/\s+/g, '_') })}
                />
              </div>
              <div>
                <Label htmlFor="new-label">Label</Label>
                <Input
                  id="new-label"
                  placeholder="e.g., Introduce Character"
                  value={newStep.label}
                  onChange={(e) => setNewStep({ ...newStep, label: e.target.value })}
                />
              </div>
            </div>
            <div>
              <Label htmlFor="new-guidance">Guidance (optional)</Label>
              <Textarea
                id="new-guidance"
                placeholder="Detailed instructions for the AI..."
                value={newStep.guidance || ''}
                onChange={(e) => setNewStep({ ...newStep, guidance: e.target.value })}
                rows={3}
              />
            </div>
            <div className="flex items-center space-x-2">
              <Checkbox
                id="new-suggests-character"
                checked={newStep.suggestsNewCharacter || false}
                onCheckedChange={(checked) => setNewStep({ ...newStep, suggestsNewCharacter: !!checked })}
              />
              <Label htmlFor="new-suggests-character" className="text-sm font-normal cursor-pointer">
                Suggests introducing a new character
              </Label>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => { setIsAddingNew(false); setNewStep({ id: '', label: '', guidance: '', suggestsNewCharacter: false }); }}>
                Cancel
              </Button>
              <Button size="sm" onClick={handleAddNew} disabled={!newStep.id || !newStep.label}>
                Add Step
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Steps List */}
      <div className="space-y-2">
        {steps.map((step, index) => (
          <Card key={`${step.id}-${index}`} className="relative">
            <CardContent className="pt-4">
              {editingIndex === index ? (
                /* Edit Mode */
                <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label htmlFor={`edit-id-${index}`}>Step ID</Label>
                      <Input
                        id={`edit-id-${index}`}
                        value={editForm.id}
                        onChange={(e) => setEditForm({ ...editForm, id: e.target.value.toLowerCase().replace(/\s+/g, '_') })}
                      />
                    </div>
                    <div>
                      <Label htmlFor={`edit-label-${index}`}>Label</Label>
                      <Input
                        id={`edit-label-${index}`}
                        value={editForm.label}
                        onChange={(e) => setEditForm({ ...editForm, label: e.target.value })}
                      />
                    </div>
                  </div>
                  <div>
                    <Label htmlFor={`edit-guidance-${index}`}>Guidance</Label>
                    <Textarea
                      id={`edit-guidance-${index}`}
                      value={editForm.guidance || ''}
                      onChange={(e) => setEditForm({ ...editForm, guidance: e.target.value })}
                      rows={3}
                    />
                  </div>
                  <div className="flex items-center space-x-2">
                    <Checkbox
                      id={`edit-suggests-character-${index}`}
                      checked={editForm.suggestsNewCharacter || false}
                      onCheckedChange={(checked) => setEditForm({ ...editForm, suggestsNewCharacter: !!checked })}
                    />
                    <Label htmlFor={`edit-suggests-character-${index}`} className="text-sm font-normal cursor-pointer">
                      Suggests introducing a new character
                    </Label>
                  </div>
                  <div className="flex justify-end gap-2">
                    <Button variant="ghost" size="sm" onClick={handleCancelEdit}>
                      <X className="h-4 w-4 mr-1" /> Cancel
                    </Button>
                    <Button size="sm" onClick={handleSaveEdit}>
                      <Check className="h-4 w-4 mr-1" /> Done
                    </Button>
                  </div>
                </div>
              ) : (
                /* View Mode */
                <div className="flex items-start gap-3">
                  <div className="flex flex-col gap-1 pt-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6"
                      onClick={() => handleMoveUp(index)}
                      disabled={index === 0}
                    >
                      <ChevronUp className="h-4 w-4" />
                    </Button>
                    <GripVertical className="h-4 w-4 text-muted-foreground mx-auto" />
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6"
                      onClick={() => handleMoveDown(index)}
                      disabled={index === steps.length - 1}
                    >
                      <ChevronDown className="h-4 w-4" />
                    </Button>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-xs font-mono text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
                        {index + 1}
                      </span>
                      <span className="font-medium">{step.label}</span>
                      <span className="text-xs text-muted-foreground font-mono">({step.id})</span>
                      {step.suggestsNewCharacter && (
                        <span className="text-xs bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-300 px-1.5 py-0.5 rounded">
                          + New Character
                        </span>
                      )}
                    </div>
                    {step.guidance ? (
                      <p className="text-sm text-muted-foreground line-clamp-2">{step.guidance}</p>
                    ) : (
                      <p className="text-sm text-muted-foreground/50 italic">No guidance provided</p>
                    )}
                  </div>
                  <div className="flex gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      onClick={() => handleStartEdit(index)}
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-destructive hover:text-destructive"
                      onClick={() => handleDelete(index)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      {steps.length === 0 && !isAddingNew && (
        <div className="text-center py-8 border-2 border-dashed rounded-lg">
          <p className="text-muted-foreground mb-2">No arc steps defined.</p>
          <Button variant="outline" size="sm" onClick={() => setIsAddingNew(true)}>
            <Plus className="h-4 w-4 mr-1" /> Add First Step
          </Button>
        </div>
      )}
    </div>
  );
}

// Prompt Config Editor Component
function PromptConfigEditor({
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

// Settings Editor Component
function SettingsEditor({
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

// Background Music Editor Component
function BackgroundMusicEditor({
  storyType,
  onSave,
  onDirtyChange
}: {
  storyType: StoryType;
  onSave: (musicConfig: { prompt: string }) => Promise<void>;
  onDirtyChange?: (isDirty: boolean) => void;
}) {
  const auth = useAuth();
  const { toast } = useToast();
  const [prompt, setPrompt] = useState(storyType.backgroundMusic?.prompt || '');
  const [isGenerating, setIsGenerating] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [saving, setSaving] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const musicStatus = storyType.backgroundMusic?.generation?.status || 'idle';
  const audioUrl = storyType.backgroundMusic?.audioUrl;
  const durationMs = storyType.backgroundMusic?.durationMs;

  const hasChanges = prompt !== (storyType.backgroundMusic?.prompt || '');

  // Notify parent of dirty state changes
  const prevHasChanges = useRef(hasChanges);
  useEffect(() => {
    if (prevHasChanges.current !== hasChanges) {
      prevHasChanges.current = hasChanges;
      onDirtyChange?.(hasChanges);
    }
  }, [hasChanges, onDirtyChange]);

  // Update local state when storyType prop changes (e.g., after generation completes)
  useEffect(() => {
    setPrompt(storyType.backgroundMusic?.prompt || '');
  }, [storyType.backgroundMusic?.prompt]);

  const handleSavePrompt = async () => {
    setSaving(true);
    try {
      await onSave({ prompt });
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
      const response = await fetch('/api/music/generate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({
          storyTypeId: storyType.id,
          prompt,
          durationMs: 45000, // 45 seconds
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
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h4 className="font-medium">Background Music</h4>
        {hasChanges && (
          <Button size="sm" onClick={handleSavePrompt} disabled={saving}>
            {saving ? <LoaderCircle className="h-4 w-4 animate-spin mr-2" /> : null}
            Save Prompt
          </Button>
        )}
      </div>

      <p className="text-sm text-muted-foreground">
        Background music plays during story generation when the child&apos;s avatar animation is shown.
        The music automatically lowers in volume when the Read to Me feature is speaking.
      </p>

      {/* Music Prompt */}
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
          Describe the style of background music. Should be calming and child-friendly. Music will be 45 seconds and loop seamlessly.
        </p>
      </div>

      {/* Generate Button */}
      <div className="flex items-center gap-4">
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
              <Music className="h-4 w-4 mr-2" />
              Regenerate Music
            </>
          ) : (
            <>
              <Music className="h-4 w-4 mr-2" />
              Generate Music
            </>
          )}
        </Button>

        {/* Status indicator */}
        {musicStatus === 'ready' && audioUrl && (
          <span className="text-sm text-green-600 flex items-center gap-1">
            <CheckCircle className="h-4 w-4" /> Music ready
          </span>
        )}
        {musicStatus === 'error' && (
          <span className="text-sm text-red-600">
            Error: {storyType.backgroundMusic?.generation?.lastErrorMessage || 'Unknown error'}
          </span>
        )}
      </div>

      {/* Preview Player */}
      {audioUrl && (
        <div className="border rounded-lg p-4 space-y-3 bg-muted/30">
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
                Duration: {Math.round(durationMs / 1000)}s (loops during story generation)
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// Story Type Detail Card
function StoryTypeCard({
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

// Create Story Type Dialog Component
function CreateStoryTypeDialog({
  open,
  onOpenChange,
  onCreate
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreate: (storyType: Omit<StoryType, 'createdAt' | 'updatedAt'>) => Promise<void>;
}) {
  const [saving, setSaving] = useState(false);
  const [formData, setFormData] = useState({
    id: '',
    name: '',
    shortDescription: '',
    ageFrom: 3 as number | null,
    ageTo: 5 as number | null,
    status: 'draft' as 'live' | 'draft',
    tags: ''
  });

  const handleCreate = async () => {
    if (!formData.id || !formData.name || !formData.shortDescription) return;

    setSaving(true);
    try {
      const newStoryType: Omit<StoryType, 'createdAt' | 'updatedAt'> = {
        id: formData.id,
        name: formData.name,
        shortDescription: formData.shortDescription,
        ageFrom: formData.ageFrom,
        ageTo: formData.ageTo,
        status: formData.status,
        tags: formData.tags.split(',').map(t => t.trim()).filter(Boolean),
        defaultPhaseId: 'story_beat_phase_v1',
        endingPhaseId: 'ending_phase_v1',
        levelBands: ['low', 'medium', 'high'],
        arcTemplate: {
          steps: [
            { id: 'introduce_character', label: 'Introduce Character', guidance: 'Introduce the main character in their familiar world.' },
            { id: 'inciting_incident', label: 'Inciting Incident', guidance: 'Something happens that sets the story in motion.' },
            { id: 'rising_action', label: 'Rising Action', guidance: 'The character faces challenges or makes discoveries.' },
            { id: 'climax', label: 'Climax', guidance: 'The story reaches its most exciting moment.' },
            { id: 'resolution', label: 'Resolution', guidance: 'The challenge is resolved and things begin to settle.' },
            { id: 'happy_close', label: 'Happy Close', guidance: 'End on a warm, satisfying note.' }
          ]
        },
        promptConfig: { ...defaultPromptConfig }
      };

      await onCreate(newStoryType);

      // Reset form
      setFormData({
        id: '',
        name: '',
        shortDescription: '',
        ageFrom: 3,
        ageTo: 5,
        status: 'draft',
        tags: ''
      });
      onOpenChange(false);
    } finally {
      setSaving(false);
    }
  };

  const handleNameChange = (name: string) => {
    setFormData({
      ...formData,
      name,
      // Auto-generate ID from name if ID is empty or was auto-generated
      id: formData.id === '' || formData.id === formData.name.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '') + '_v1'
        ? name.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '') + '_v1'
        : formData.id
    });
  };

  const isValid = formData.id && formData.name && formData.shortDescription;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Create New Story Type</DialogTitle>
          <DialogDescription>
            Define a new story template with its own arc structure and prompt configuration.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="create-name">Name *</Label>
            <Input
              id="create-name"
              placeholder="e.g., Space Adventure"
              value={formData.name}
              onChange={(e) => handleNameChange(e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="create-id">ID *</Label>
            <Input
              id="create-id"
              placeholder="e.g., space_adventure_v1"
              value={formData.id}
              onChange={(e) => setFormData({ ...formData, id: e.target.value.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '') })}
              className="font-mono"
            />
            <p className="text-xs text-muted-foreground">Unique identifier (auto-generated from name)</p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="create-description">Short Description *</Label>
            <Textarea
              id="create-description"
              placeholder="A brief description of what this story type is about..."
              value={formData.shortDescription}
              onChange={(e) => setFormData({ ...formData, shortDescription: e.target.value })}
              rows={2}
            />
          </div>

          <div className="space-y-2">
            <Label>Age Range</Label>
            <div className="flex items-center gap-2">
              <Input
                id="create-ageFrom"
                type="number"
                min="0"
                max="18"
                placeholder="Any"
                value={formData.ageFrom ?? ''}
                onChange={(e) => setFormData({
                  ...formData,
                  ageFrom: e.target.value === '' ? null : parseInt(e.target.value)
                })}
                className="w-20"
              />
              <span className="text-muted-foreground">to</span>
              <Input
                id="create-ageTo"
                type="number"
                min="0"
                max="18"
                placeholder="Any"
                value={formData.ageTo ?? ''}
                onChange={(e) => setFormData({
                  ...formData,
                  ageTo: e.target.value === '' ? null : parseInt(e.target.value)
                })}
                className="w-20"
              />
              <span className="text-muted-foreground text-sm">years</span>
            </div>
            <p className="text-xs text-muted-foreground">Leave blank for no limit</p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="create-status">Status</Label>
            <Select value={formData.status} onValueChange={(v) => setFormData({ ...formData, status: v as 'live' | 'draft' })}>
              <SelectTrigger id="create-status">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="draft">Draft</SelectItem>
                <SelectItem value="live">Live</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="create-tags">Tags</Label>
            <Input
              id="create-tags"
              placeholder="e.g., adventure, space, exploration"
              value={formData.tags}
              onChange={(e) => setFormData({ ...formData, tags: e.target.value })}
            />
            <p className="text-xs text-muted-foreground">Comma-separated list of tags</p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleCreate} disabled={!isValid || saving}>
            {saving ? <LoaderCircle className="h-4 w-4 animate-spin mr-2" /> : <Plus className="h-4 w-4 mr-2" />}
            Create Story Type
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function AdminStoryTypesPage() {
  const { isAuthenticated, isAdmin, isWriter, email, loading: authLoading } = useAdminStatus();
  const firestore = useFirestore();
  const auth = useAuth();
  const { toast } = useToast();

  const [types, setTypes] = useState<StoryType[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);

  useEffect(() => {
    if (!firestore || (!isAdmin && !isWriter)) {
      setLoading(false);
      return;
    }

    setLoading(true);
    const typesRef = collection(firestore, 'storyTypes');
    const q = query(typesRef, orderBy('name', 'asc'));

    const unsubscribe = onSnapshot(q,
      (snapshot) => {
        const typeList = snapshot.docs.map(d => ({ ...d.data(), id: d.id } as StoryType));
        setTypes(typeList);
        setLoading(false);
        setError(null);
      },
      (err) => {
        console.error("Error fetching story types:", err);
        setError("Could not fetch story types.");
        setTypes([]);
        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, [firestore, isAdmin, isWriter]);

  const handleCreateSampleTypes = async () => {
    if (!firestore) return;
    try {
        const batch = writeBatch(firestore);
        sampleStoryTypes.forEach(t => {
            const docRef = doc(firestore, "storyTypes", t.id);
            batch.set(docRef, t);
        });
        await batch.commit();
        toast({ title: 'Success', description: 'Sample story types created.' });
    } catch (e: any) {
        console.error("Error creating sample types:", e);
        toast({ title: 'Error', description: e.message, variant: 'destructive' });
    }
  };

  const handleCreateStoryType = async (storyType: Omit<StoryType, 'createdAt' | 'updatedAt'>) => {
    if (!firestore) return;
    try {
      const docRef = doc(firestore, 'storyTypes', storyType.id);
      await setDoc(docRef, {
        ...storyType,
        createdAt: new Date(),
        updatedAt: new Date()
      });
      toast({ title: 'Success', description: `Story type "${storyType.name}" created.` });
    } catch (e: any) {
      console.error("Error creating story type:", e);
      toast({ title: 'Error', description: e.message, variant: 'destructive' });
      throw e;
    }
  };

  const handleUpdateArcSteps = async (storyTypeId: string, steps: ArcStep[]) => {
    if (!firestore) return;
    try {
      const docRef = doc(firestore, 'storyTypes', storyTypeId);
      await updateDoc(docRef, {
        'arcTemplate.steps': steps
      });
      toast({ title: 'Success', description: 'Arc steps updated.' });
    } catch (e: any) {
      console.error("Error updating arc steps:", e);
      toast({ title: 'Error', description: e.message, variant: 'destructive' });
    }
  };

  const handleUpdatePromptConfig = async (storyTypeId: string, promptConfig: StoryTypePromptConfig) => {
    if (!firestore) return;
    try {
      const docRef = doc(firestore, 'storyTypes', storyTypeId);
      await updateDoc(docRef, {
        promptConfig: promptConfig
      });
      toast({ title: 'Success', description: 'Prompt configuration updated.' });
    } catch (e: any) {
      console.error("Error updating prompt config:", e);
      toast({ title: 'Error', description: e.message, variant: 'destructive' });
    }
  };

  const handleUpdateSettings = async (storyTypeId: string, updates: Partial<StoryType>) => {
    if (!firestore) return;
    try {
      const docRef = doc(firestore, 'storyTypes', storyTypeId);
      await updateDoc(docRef, {
        ...updates,
        updatedAt: new Date()
      });
      toast({ title: 'Success', description: 'Story type settings updated.' });
    } catch (e: any) {
      console.error("Error updating settings:", e);
      toast({ title: 'Error', description: e.message, variant: 'destructive' });
    }
  };

  const handleUpdateMusic = async (storyTypeId: string, musicConfig: { prompt: string }) => {
    if (!firestore) return;
    try {
      const docRef = doc(firestore, 'storyTypes', storyTypeId);
      await updateDoc(docRef, {
        'backgroundMusic.prompt': musicConfig.prompt,
        updatedAt: new Date()
      });
      // Note: toast is shown by the BackgroundMusicEditor component
    } catch (e: any) {
      console.error("Error updating music config:", e);
      throw e; // Re-throw so the editor can handle it
    }
  };

  const diagnostics = {
    page: 'admin-storyTypes',
    auth: {
      isAuthenticated,
      email,
      isAdmin,
      loading: authLoading,
      error: null,
    },
    firestore: {
        collection: 'storyTypes',
        count: types.length,
        sampleIds: types.slice(0, 3).map(t => t.id),
    },
    ...(error ? { firestoreError: error } : {})
  };

  const handleCopyDiagnostics = () => {
    const textToCopy = `Page: admin-storyTypes\n\nDiagnostics\n${JSON.stringify(diagnostics, null, 2)}`;
    navigator.clipboard.writeText(textToCopy);
    toast({ title: 'Copied to clipboard!' });
  };

  const renderContent = () => {
    if (authLoading || loading) {
      return <div className="flex items-center gap-2"><LoaderCircle className="h-5 w-5 animate-spin" /><span>Loading story types...</span></div>;
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
    if (types.length === 0) {
        return (
            <div className="text-center py-8 border-2 border-dashed rounded-lg">
                <p className="text-muted-foreground mb-4">No story types found.</p>
                <Button onClick={handleCreateSampleTypes}>Create sample story types</Button>
            </div>
        )
    }

    return (
      <div className="space-y-4">
        {types.map((type) => (
          <StoryTypeCard
            key={type.id}
            storyType={type}
            onUpdateArcSteps={handleUpdateArcSteps}
            onUpdatePromptConfig={handleUpdatePromptConfig}
            onUpdateSettings={handleUpdateSettings}
            onUpdateMusic={handleUpdateMusic}
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
            <CardTitle>Story Types</CardTitle>
            <CardDescription>
              Configuration for different story templates and arcs.
            </CardDescription>
          </div>
          <div className="flex gap-2">
            <Button onClick={() => setCreateDialogOpen(true)}>
              <Plus className="h-4 w-4 mr-2" />
              Create New
            </Button>
            {types.length > 0 && (
              <Button variant="outline" onClick={handleCreateSampleTypes}>
                Reset to Sample Types
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {renderContent()}
        </CardContent>
      </Card>

      <Card className="mt-8">
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Diagnostics</CardTitle>
          <Button variant="ghost" size="icon" onClick={handleCopyDiagnostics}>
            <Copy className="h-4 w-4" />
          </Button>
        </CardHeader>
        <CardContent>
          <pre className="bg-muted p-4 rounded-lg overflow-x-auto">
            <code>{JSON.stringify(diagnostics, null, 2)}</code>
          </pre>
        </CardContent>
      </Card>

      <CreateStoryTypeDialog
        open={createDialogOpen}
        onOpenChange={setCreateDialogOpen}
        onCreate={handleCreateStoryType}
      />
    </div>
  );
}
