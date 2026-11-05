'use client';

/**
 * Add or edit a Child or Character (slice 5.7b). Saves through the routes
 * (`peopleApi`); photos and the avatar are managed by `LikenessPanel`, whose
 * parts are made by server jobs. The browser never writes these documents.
 */
import { useState, useEffect, useRef, useCallback } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ArrayInput } from './ArrayInput';
import { LikenessPanel } from './LikenessPanel';
import { useToast } from '@/hooks/use-toast';
import { useUser } from '@/firebase/auth/use-user';
import { LoaderCircle, Volume2, Square } from 'lucide-react';
import { newIdempotencyKey, peopleApi, type CharacterInput, type ChildInput, type PersonView } from '@/lib/people/api';
import { DEFAULT_TTS_VOICE } from '@/lib/tts-config';

type Pronouns = 'he/him' | 'she/her' | 'they/them';
type CharacterType = 'Family' | 'Friend' | 'Pet' | 'Toy' | 'Other';
const CHARACTER_TYPES: CharacterType[] = ['Family', 'Friend', 'Pet', 'Toy', 'Other'];

const PRONOUN_OPTIONS: { value: Pronouns; label: string }[] = [
  { value: 'he/him', label: 'He/Him' },
  { value: 'she/her', label: 'She/Her' },
  { value: 'they/them', label: 'They/Them' },
];

const RELATIONSHIP_OPTIONS = [
  { value: 'mother', label: 'Mother' },
  { value: 'father', label: 'Father' },
  { value: 'grandmother', label: 'Grandmother' },
  { value: 'grandfather', label: 'Grandfather' },
  { value: 'aunt', label: 'Aunt' },
  { value: 'uncle', label: 'Uncle' },
  { value: 'sibling', label: 'Sibling' },
  { value: 'brother', label: 'Brother' },
  { value: 'sister', label: 'Sister' },
  { value: 'cousin', label: 'Cousin' },
  { value: 'stepmother', label: 'Stepmother' },
  { value: 'stepfather', label: 'Stepfather' },
  { value: 'godmother', label: 'Godmother' },
  { value: 'godfather', label: 'Godfather' },
  { value: 'guardian', label: 'Guardian' },
  { value: 'other', label: 'Other' },
];

type EntityType = 'child' | 'character';

type EntityEditorProps = {
  entityType: EntityType;
  entity?: PersonView | null;
  /** For the character editor: the children it may be scoped to. */
  childOptions?: Array<{ id: string; displayName: string }>;
  /** Called after a successful save, with the saved view. */
  onSave: (saved?: PersonView) => void;
  onCancel?: () => void;
  /** Fired once after a NEW entity is successfully created (not on edit/cancel). */
  onCreated?: (created: PersonView) => void;
  /** Called when photos or the avatar change while editing. */
  onLikenessChange?: (person: PersonView) => void;
};

export function EntityEditor({
  entityType,
  entity,
  childOptions: children = [],
  onSave,
  onCancel,
  onCreated,
  onLikenessChange,
}: EntityEditorProps) {
  const { toast } = useToast();
  const { user } = useUser();
  const isEditing = !!entity;
  const isCharacter = entityType === 'character';

  // Common fields
  const [displayName, setDisplayName] = useState('');
  const [pronouns, setPronouns] = useState<Pronouns | ''>('');
  const [dateOfBirth, setDateOfBirth] = useState('');
  const [description, setDescription] = useState('');
  const [likes, setLikes] = useState<string[]>([]);
  const [dislikes, setDislikes] = useState<string[]>([]);

  // Character-specific fields
  const [characterType, setCharacterType] = useState<CharacterType>('Friend');
  const [relationship, setRelationship] = useState<string>(''); // For Family type characters
  const [childId, setChildId] = useState<string>('__family_wide__'); // Special value = family-wide

  const [namePronunciation, setNamePronunciation] = useState<string>('');

  // Pronunciation test state
  const [isTestingPronunciation, setIsTestingPronunciation] = useState(false);
  const [isPlayingPronunciation, setIsPlayingPronunciation] = useState(false);
  const pronunciationAudioRef = useRef<HTMLAudioElement | null>(null);

  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState('');
  // One key per create attempt, so a retried click does not add a second child.
  const createKey = useRef(newIdempotencyKey());

  // Initialize form from entity
  useEffect(() => {
    if (!entity) return;
    setDisplayName(entity.displayName || '');
    setPronouns((entity.pronouns as Pronouns | null) || '');
    setDescription(entity.description || '');
    setLikes(entity.likes || []);
    setDislikes(entity.dislikes || []);
    setDateOfBirth(entity.dateOfBirth || '');
    setNamePronunciation(entity.namePronunciation || '');
    if (entity.kind === 'character') {
      setCharacterType(CHARACTER_TYPES.includes(entity.type as CharacterType) ? (entity.type as CharacterType) : 'Friend');
      setRelationship(entity.relationship || '');
      setChildId(entity.childId || '__family_wide__');
    }
  }, [entity]);

  // Stop pronunciation audio playback
  const stopPronunciationPlayback = useCallback(() => {
    if (pronunciationAudioRef.current) {
      pronunciationAudioRef.current.pause();
      pronunciationAudioRef.current.currentTime = 0;
      pronunciationAudioRef.current = null;
    }
    setIsPlayingPronunciation(false);
  }, []);

  // Test pronunciation with TTS
  const handleTestPronunciation = useCallback(async () => {
    // If already playing, stop
    if (isPlayingPronunciation) {
      stopPronunciationPlayback();
      return;
    }

    // Need text to test - use pronunciation if set, otherwise displayName
    const textToSpeak = namePronunciation.trim() || displayName.trim();
    if (!textToSpeak) {
      toast({
        title: 'Nothing to test',
        description: 'Enter a name or pronunciation first',
        variant: 'destructive',
      });
      return;
    }

    if (!user) {
      toast({
        title: 'Not authenticated',
        description: 'Please sign in to test pronunciation',
        variant: 'destructive',
      });
      return;
    }

    setIsTestingPronunciation(true);

    try {
      const idToken = await user.getIdToken();

      // Get the voice ID from the child entity if available
      const voiceId = entity?.kind === 'child' ? entity.preferredVoiceId ?? undefined : undefined;

      const response = await fetch('/api/tts', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${idToken}`,
        },
        body: JSON.stringify({
          text: textToSpeak,
          voiceId,
        }),
      });

      const data = await response.json();

      if (!data.ok) {
        throw new Error(data.errorMessage || 'Failed to generate speech');
      }

      // Create audio from base64
      const audioBlob = new Blob(
        [Uint8Array.from(atob(data.audioData), c => c.charCodeAt(0))],
        { type: data.mimeType }
      );
      const audioUrl = URL.createObjectURL(audioBlob);
      const audio = new Audio(audioUrl);
      pronunciationAudioRef.current = audio;

      audio.onended = () => {
        setIsPlayingPronunciation(false);
        URL.revokeObjectURL(audioUrl);
        pronunciationAudioRef.current = null;
      };

      audio.onerror = () => {
        setIsPlayingPronunciation(false);
        URL.revokeObjectURL(audioUrl);
        pronunciationAudioRef.current = null;
        toast({
          title: 'Playback error',
          description: 'Could not play the audio',
          variant: 'destructive',
        });
      };

      setIsPlayingPronunciation(true);
      await audio.play();
    } catch (error: any) {
      console.error('Error testing pronunciation:', error);
      toast({
        title: 'Test failed',
        description: error.message || 'Could not generate speech',
        variant: 'destructive',
      });
    } finally {
      setIsTestingPronunciation(false);
    }
  }, [isPlayingPronunciation, stopPronunciationPlayback, namePronunciation, displayName, user, entity, toast]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!displayName.trim()) {
      setError('Name is required');
      return;
    }

    setIsSaving(true);
    const profile = {
      displayName: displayName.trim(),
      namePronunciation: namePronunciation.trim() || null,
      pronouns: pronouns || null,
      description: description.trim() || null,
      likes,
      dislikes,
      dateOfBirth: dateOfBirth || null,
    };

    try {
      let saved: PersonView;
      if (isCharacter) {
        const input: CharacterInput = {
          ...profile,
          type: characterType,
          relationship: characterType === 'Family' && relationship ? relationship : null,
          childId: childId === '__family_wide__' ? null : childId,
        };
        saved = entity
          ? await peopleApi.update('character', entity.id, input)
          : await peopleApi.create('character', { ...input, idempotencyKey: createKey.current });
      } else {
        const input: ChildInput = profile;
        saved = entity
          ? await peopleApi.update('child', entity.id, input)
          : await peopleApi.create('child', { ...input, preferredVoiceId: DEFAULT_TTS_VOICE, autoReadAloud: true, idempotencyKey: createKey.current });
      }

      if (!isEditing) {
        createKey.current = newIdempotencyKey();
        onCreated?.(saved);
      }
      onSave(saved);
    } catch (err: any) {
      console.error('Error saving entity:', err);
      setError(err.message || 'Failed to save');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {error && (
        <div className="bg-destructive/10 text-destructive p-3 rounded-md text-sm">
          {error}
        </div>
      )}

      <div className="space-y-2">
        <Label htmlFor="displayName">
          Name <span className="text-destructive">*</span>
        </Label>
        <Input
          id="displayName"
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          placeholder={isCharacter ? 'Character name' : 'Child name'}
          required
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="pronouns">Pronouns (optional)</Label>
        <Select
          value={pronouns || '__none__'}
          onValueChange={(val) => {
            // Guard against spurious/invalid value changes (e.g., empty strings)
            const validValues = ['__none__', 'he/him', 'she/her', 'they/them'];
            if (!validValues.includes(val)) return;
            setPronouns(val === '__none__' ? '' : val as Pronouns);
          }}
        >
          <SelectTrigger>
            <SelectValue placeholder="Select pronouns..." />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__none__">Not specified (uses they/them)</SelectItem>
            {PRONOUN_OPTIONS.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">
          Used in story text to refer to {isCharacter ? 'this character' : 'your child'}.
        </p>
      </div>

      {/* Name Pronunciation for TTS - available for both children and characters */}
      <div className="space-y-2">
        <Label htmlFor="namePronunciation">Name Pronunciation (optional)</Label>
        <div className="flex gap-2">
          <Input
            id="namePronunciation"
            value={namePronunciation}
            onChange={(e) => setNamePronunciation(e.target.value)}
            placeholder="e.g., SEE-oh-ban for Siobhan"
            className="flex-1"
          />
          <Button
            type="button"
            variant="outline"
            size="icon"
            onClick={handleTestPronunciation}
            disabled={isTestingPronunciation || (!namePronunciation.trim() && !displayName.trim())}
            title={isPlayingPronunciation ? 'Stop' : 'Test pronunciation'}
          >
            {isTestingPronunciation ? (
              <LoaderCircle className="h-4 w-4 animate-spin" />
            ) : isPlayingPronunciation ? (
              <Square className="h-4 w-4" />
            ) : (
              <Volume2 className="h-4 w-4" />
            )}
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          How to pronounce the name for AI voice narration. Use phonetic spelling (e.g., &quot;SEE-oh-ban&quot; for Siobhan, &quot;SHIV-on&quot; for Siobhán).
        </p>
      </div>

      {isCharacter && (
        <>
          <div className="space-y-2">
            <Label htmlFor="type">Type</Label>
            <Select
              value={characterType}
              onValueChange={(val) => {
                // Guard against spurious/invalid value changes (e.g., empty strings)
                if (!CHARACTER_TYPES.includes(val as CharacterType)) return;
                setCharacterType(val as CharacterType);
                // Clear relationship if switching away from Family
                if (val !== 'Family') {
                  setRelationship('');
                }
              }}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="Family">Family</SelectItem>
                <SelectItem value="Friend">Friend</SelectItem>
                <SelectItem value="Pet">Pet</SelectItem>
                <SelectItem value="Toy">Toy</SelectItem>
                <SelectItem value="Other">Other</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Relationship field - only shown when type is Family */}
          {characterType === 'Family' && (
            <div className="space-y-2">
              <Label htmlFor="relationship">Relationship</Label>
              <Select
                value={relationship || '__none__'}
                onValueChange={(val) => {
                  const validValues = ['__none__', ...RELATIONSHIP_OPTIONS.map(r => r.value)];
                  if (!validValues.includes(val)) return;
                  setRelationship(val === '__none__' ? '' : val);
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select relationship..." />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">Not specified</SelectItem>
                  {RELATIONSHIP_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                The family member&apos;s relationship to the child (e.g., mother, father, grandmother).
              </p>
            </div>
          )}

          {children.length > 0 && (
            <div className="space-y-2">
              <Label htmlFor="childId">
                Character Scope
              </Label>
              <Select
                value={childId}
                onValueChange={(val) => {
                  // Guard against spurious/invalid value changes (e.g., empty strings)
                  const validValues = ['__family_wide__', ...children.map(c => c.id)];
                  if (!val || !validValues.includes(val)) return;
                  setChildId(val);
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Family-wide (all children)" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__family_wide__">Family-wide (all children)</SelectItem>
                  {children.map((child) => (
                    <SelectItem key={child.id} value={child.id}>
                      {child.displayName} only
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                {childId === '__family_wide__'
                  ? 'This character is available to all children in the family'
                  : 'This character is specific to one child'}
              </p>
            </div>
          )}
        </>
      )}

      <div className="space-y-2">
        <Label htmlFor="dateOfBirth">Date of Birth (optional)</Label>
        <Input
          id="dateOfBirth"
          type="date"
          value={dateOfBirth}
          onChange={(e) => setDateOfBirth(e.target.value)}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="description">Description (optional)</Label>
        <Textarea
          id="description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder={isCharacter ? 'Describe this character...' : 'Describe your child...'}
          rows={3}
        />
      </div>

      <ArrayInput
        label="Likes"
        value={likes}
        onChange={setLikes}
        placeholder="Add something they like..."
        variant="secondary"
      />

      <ArrayInput
        label="Dislikes"
        value={dislikes}
        onChange={setDislikes}
        placeholder="Add something they dislike..."
        variant="destructive"
      />

      {isEditing && entity && <LikenessPanel person={entity} onChange={onLikenessChange} />}

      <div className="flex gap-2 pt-4">
        <Button type="submit" disabled={isSaving}>
          {isSaving ? 'Saving...' : isEditing ? 'Update' : 'Create'}
        </Button>
        {onCancel && (
          <Button type="button" variant="outline" onClick={onCancel} disabled={isSaving}>
            Cancel
          </Button>
        )}
      </div>
    </form>
  );
}
