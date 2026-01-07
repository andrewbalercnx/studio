'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { doc, setDoc, updateDoc, serverTimestamp, collection as firestoreCollection } from 'firebase/firestore';
import { useFirestore } from '@/firebase';
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
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { useToast } from '@/hooks/use-toast';
import { useUser } from '@/firebase/auth/use-user';
import { useUploadFile } from '@/firebase/storage/use-upload-file';
import { LoaderCircle, Sparkles, Upload, User as UserIcon, X, Volume2, Square } from 'lucide-react';
import Image from 'next/image';
import type { ChildProfile, Character, Pronouns } from '@/lib/types';
import { DEFAULT_TTS_VOICE } from '@/lib/tts-config';

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
  entity?: ChildProfile | Character | null;
  parentUid: string;
  children?: ChildProfile[]; // For character editor to select childId
  onSave: () => void;
  onCancel?: () => void;
};

export function EntityEditor({
  entityType,
  entity,
  parentUid,
  children = [],
  onSave,
  onCancel
}: EntityEditorProps) {
  const firestore = useFirestore();
  const { toast } = useToast();
  const { user } = useUser();
  const { uploadFile, uploadCharacterPhoto, isUploading } = useUploadFile();
  const isEditing = !!entity;
  const isCharacter = entityType === 'character';

  // Common fields
  const [displayName, setDisplayName] = useState('');
  const [pronouns, setPronouns] = useState<Pronouns | ''>('');
  const [dateOfBirth, setDateOfBirth] = useState('');
  const [description, setDescription] = useState('');
  const [likes, setLikes] = useState<string[]>([]);
  const [dislikes, setDislikes] = useState<string[]>([]);
  const [photos, setPhotos] = useState<string[]>([]);
  const [avatarUrl, setAvatarUrl] = useState<string>('');

  // Character-specific fields
  const [characterType, setCharacterType] = useState<Character['type']>('Friend');
  const [relationship, setRelationship] = useState<string>(''); // For Family type characters
  const [childId, setChildId] = useState<string>('__family_wide__'); // Special value = family-wide

  // Child-specific fields
  const [namePronunciation, setNamePronunciation] = useState<string>('');

  // Pronunciation test state
  const [isTestingPronunciation, setIsTestingPronunciation] = useState(false);
  const [isPlayingPronunciation, setIsPlayingPronunciation] = useState(false);
  const pronunciationAudioRef = useRef<HTMLAudioElement | null>(null);

  // Avatar generation state
  const [isGeneratingAvatar, setIsGeneratingAvatar] = useState(false);
  const [generatedAvatar, setGeneratedAvatar] = useState<string | null>(null);
  const [avatarFeedback, setAvatarFeedback] = useState('');

  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState('');

  // Initialize form from entity
  useEffect(() => {
    if (entity) {
      setDisplayName(entity.displayName || '');
      setPronouns((entity as any).pronouns || '');
      setDescription(entity.description || '');
      setLikes((entity as any).likes || []);
      setDislikes((entity as any).dislikes || []);
      setPhotos((entity as any).photos || []);
      setAvatarUrl(entity.avatarUrl || '');

      // Handle dateOfBirth (could be Firestore Timestamp or string)
      if (entity.dateOfBirth) {
        try {
          let dateStr = '';
          if (typeof entity.dateOfBirth?.toDate === 'function') {
            const date = entity.dateOfBirth.toDate();
            dateStr = date.toISOString().split('T')[0];
          } else if (typeof entity.dateOfBirth === 'string') {
            dateStr = new Date(entity.dateOfBirth).toISOString().split('T')[0];
          } else if (entity.dateOfBirth instanceof Date) {
            dateStr = entity.dateOfBirth.toISOString().split('T')[0];
          }
          setDateOfBirth(dateStr);
        } catch (e) {
          console.error('Error parsing date:', e);
        }
      }

      if (isCharacter && 'type' in entity) {
        setCharacterType((entity as Character).type || 'Friend');
        setRelationship((entity as Character).relationship || '');
        setChildId((entity as Character).childId || '__family_wide__');
        // Load pronunciation for characters
        setNamePronunciation((entity as Character).namePronunciation || '');
      }

      // Child-specific: load pronunciation
      if (!isCharacter) {
        const childEntity = entity as ChildProfile;
        setNamePronunciation(childEntity.namePronunciation || '');
      }
    }
  }, [entity, isCharacter]);

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
      const voiceId = !isCharacter && entity
        ? (entity as ChildProfile).preferredVoiceId
        : undefined;

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
  }, [isPlayingPronunciation, stopPronunciationPlayback, namePronunciation, displayName, user, isCharacter, entity, toast]);

  const handlePhotoUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    if (!user || !entity?.id) return;
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      const collectionName = isCharacter ? 'characters' : 'children';

      // Convert File to dataUrl
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = () => reject(new Error('Failed to read file'));
        reader.readAsDataURL(file);
      });

      // Use the appropriate upload function based on entity type
      const downloadUrl = isCharacter
        ? await uploadCharacterPhoto({
            characterId: entity.id,
            dataUrl,
            fileName: file.name,
          })
        : await uploadFile({
            childId: entity.id,
            dataUrl,
            fileName: file.name,
          });

      const newPhotos = [...photos, downloadUrl].filter((url): url is string => url !== null);
      setPhotos(newPhotos);

      // Update Firestore
      if (firestore) {
        const docRef = doc(firestore, collectionName, entity.id);
        await updateDoc(docRef, { photos: newPhotos });
        toast({ title: 'Photo uploaded successfully' });
      }
    } catch (err: any) {
      console.error('Error uploading photo:', err);
      toast({ title: 'Error uploading photo', description: err.message, variant: 'destructive' });
    }
  };

  const handleRemovePhoto = async (photoUrl: string) => {
    if (!entity?.id || !firestore || !user) return;

    try {
      const newPhotos = photos.filter(p => p !== photoUrl);
      setPhotos(newPhotos);

      const collectionName = isCharacter ? 'characters' : 'children';
      const docRef = doc(firestore, collectionName, entity.id);
      await updateDoc(docRef, { photos: newPhotos });
      toast({ title: 'Photo removed' });

      // Trigger image description regeneration in background
      const idToken = await user.getIdToken();
      fetch('/api/regenerate-image-description', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${idToken}`,
        },
        body: JSON.stringify({
          entityId: entity.id,
          entityType: isCharacter ? 'character' : 'child',
        }),
      }).catch((err) => {
        console.error('Error triggering image description regeneration:', err);
      });
    } catch (err: any) {
      console.error('Error removing photo:', err);
      toast({ title: 'Error removing photo', description: err.message, variant: 'destructive' });
    }
  };

  const handleGenerateAvatar = async () => {
    if (!user || !entity?.id) {
      toast({ title: 'Error', description: 'Please save the entity first before generating an avatar', variant: 'destructive' });
      return;
    }

    setIsGeneratingAvatar(true);
    setError('');

    try {
      const idToken = await user.getIdToken();
      const apiEndpoint = isCharacter ? '/api/generateCharacterAvatar' : '/api/generateAvatar';
      const idField = isCharacter ? 'characterId' : 'childId';

      const res = await fetch(apiEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${idToken}`,
        },
        body: JSON.stringify({ [idField]: entity.id, feedback: avatarFeedback }),
      });

      const result = await res.json();
      if (!res.ok || !result.ok) {
        throw new Error(result.errorMessage || 'Failed to generate avatar.');
      }

      setGeneratedAvatar(result.imageUrl);
      setAvatarFeedback('');
      toast({ title: 'Avatar generated successfully!' });
    } catch (err: any) {
      console.error('Error generating avatar:', err);
      setError(err.message);
      toast({ title: 'Avatar generation failed', description: err.message, variant: 'destructive' });
    } finally {
      setIsGeneratingAvatar(false);
    }
  };

  const handleAcceptAvatar = async () => {
    if (!generatedAvatar || !entity?.id || !firestore) return;

    try {
      const collectionName = isCharacter ? 'characters' : 'children';
      const docRef = doc(firestore, collectionName, entity.id);
      await updateDoc(docRef, { avatarUrl: generatedAvatar });

      setAvatarUrl(generatedAvatar);
      setGeneratedAvatar(null);
      toast({ title: 'Avatar updated successfully!' });
    } catch (err: any) {
      console.error('Error updating avatar:', err);
      toast({ title: 'Error updating avatar', description: err.message, variant: 'destructive' });
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!displayName.trim()) {
      setError('Name is required');
      return;
    }

    if (!firestore) {
      setError('Firestore not initialized');
      return;
    }

    setIsSaving(true);

    try {
      const collectionName = isCharacter ? 'characters' : 'children';
      const docId = entity?.id || doc(firestoreCollection(firestore, collectionName)).id;
      const docRef = doc(firestore, collectionName, docId);

      // Parse date of birth
      let dobValue: any = null;
      if (dateOfBirth) {
        dobValue = new Date(dateOfBirth);
      }

      // Helper function to remove undefined fields
      const removeUndefined = (obj: any) => {
        const cleaned: any = {};
        Object.keys(obj).forEach(key => {
          if (obj[key] !== undefined) {
            cleaned[key] = obj[key];
          }
        });
        return cleaned;
      };

      // Common data
      const commonData: any = {
        displayName: displayName.trim(),
        likes,
        dislikes,
        ownerParentUid: parentUid,
        updatedAt: serverTimestamp(),
      };

      // Only add optional fields if they have values
      if (pronouns) {
        commonData.pronouns = pronouns;
      }
      if (description.trim()) {
        commonData.description = description.trim();
      }
      if (dobValue) {
        commonData.dateOfBirth = dobValue;
      }

      if (isCharacter) {
        // Character data
        const characterData: any = {
          ...commonData,
          type: characterType,
        };

        // Only add relationship if type is Family and relationship is set
        if (characterType === 'Family' && relationship) {
          characterData.relationship = relationship;
        }

        // Only add childId if it's not the family-wide default
        if (childId !== '__family_wide__') {
          characterData.childId = childId;
        }

        // Only add pronunciation if it has a value
        if (namePronunciation.trim()) {
          characterData.namePronunciation = namePronunciation.trim();
        }

        const cleanedData = removeUndefined(characterData);

        if (isEditing) {
          await updateDoc(docRef, cleanedData);
        } else {
          await setDoc(docRef, {
            ...characterData,
            id: docId,
            photos: [],
            avatarUrl: `https://picsum.photos/seed/${docId}/200/200`,
            createdAt: serverTimestamp(),
            isParentGenerated: true, // Parent-created character
            usageCount: 0, // Not used in any story yet
          });
        }
      } else {
        // Child data
        const childData: any = {
          ...commonData,
        };

        // Only add pronunciation if it has a value
        if (namePronunciation.trim()) {
          childData.namePronunciation = namePronunciation.trim();
        }

        const cleanedChildData = removeUndefined(childData);

        if (isEditing) {
          await updateDoc(docRef, cleanedChildData);
        } else {
          await setDoc(docRef, {
            ...childData,
            id: docId,
            photos: [],
            avatarUrl: `https://picsum.photos/seed/${displayName.trim()}/200/200`,
            preferredVoiceId: DEFAULT_TTS_VOICE, // Set default TTS voice (Alice) for new children
            autoReadAloud: true, // Enable "Read to Me" by default
            createdAt: serverTimestamp(),
          });
        }
      }

      onSave();
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
                const validTypes = ['Family', 'Friend', 'Pet', 'Toy', 'Other'];
                if (!validTypes.includes(val)) return;
                setCharacterType(val as Character['type']);
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

      {isEditing && entity?.id && (
        <>
          {/* Photo Upload Section - works for both children and characters */}
          <Card className="bg-muted/30">
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <Upload className="h-4 w-4" /> Photos
              </CardTitle>
              <CardDescription>
                {isCharacter
                  ? 'Upload photos of this character to help generate a better avatar'
                  : 'Upload photos to help generate a better avatar'}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {photos.length > 0 && (
                <div className="grid grid-cols-3 gap-2">
                  {photos.map((photoUrl, idx) => (
                    <div key={idx} className="relative group">
                      <Image
                        src={photoUrl}
                        alt={`Photo ${idx + 1}`}
                        width={100}
                        height={100}
                        className="rounded-md object-cover w-full h-24"
                      />
                      <button
                        type="button"
                        onClick={() => handleRemovePhoto(photoUrl)}
                        className="absolute top-1 right-1 bg-destructive text-destructive-foreground rounded-full p-1 opacity-0 group-hover:opacity-100 transition-opacity"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
              <div>
                <Input
                  type="file"
                  accept="image/*"
                  onChange={handlePhotoUpload}
                  disabled={isUploading}
                  className="cursor-pointer"
                />
                {isUploading && <p className="text-sm text-muted-foreground mt-2">Uploading...</p>}
              </div>
            </CardContent>
          </Card>

          {/* AI Avatar Generator Section */}
          <Card className="bg-muted/30">
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <Sparkles className="text-primary h-4 w-4" /> AI Avatar Generator
              </CardTitle>
              <CardDescription>
                {isCharacter
                  ? 'Create a cartoon avatar from the character description'
                  : `Create a cartoon avatar${photos.length > 0 ? ' from photos and profile' : ' from the profile description'}`}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex justify-center">
                {isGeneratingAvatar ? (
                  <div className="h-40 w-40 flex items-center justify-center bg-muted rounded-full">
                    <LoaderCircle className="h-10 w-10 animate-spin text-primary" />
                  </div>
                ) : generatedAvatar ? (
                  <Image
                    src={generatedAvatar}
                    alt="Generated avatar"
                    width={160}
                    height={160}
                    className="rounded-full border-4 border-primary shadow-md object-cover"
                  />
                ) : avatarUrl ? (
                  <Image
                    src={avatarUrl}
                    alt="Current avatar"
                    width={160}
                    height={160}
                    className="rounded-full border-2 border-muted-foreground/20 object-cover"
                  />
                ) : (
                  <div className="h-40 w-40 flex items-center justify-center bg-muted rounded-full text-muted-foreground">
                    <UserIcon className="h-10 w-10" />
                  </div>
                )}
              </div>
              <div className="space-y-2">
                <Label htmlFor="avatarFeedback">Feedback (optional)</Label>
                <Textarea
                  id="avatarFeedback"
                  value={avatarFeedback}
                  onChange={(e) => setAvatarFeedback(e.target.value)}
                  placeholder="e.g., make the hair blonder, add glasses..."
                  rows={2}
                  disabled={isGeneratingAvatar}
                />
              </div>
              <div className="flex gap-2">
                <Button
                  type="button"
                  onClick={handleGenerateAvatar}
                  disabled={isGeneratingAvatar}
                  variant="outline"
                  className="flex-1"
                >
                  {isGeneratingAvatar ? 'Generating...' : generatedAvatar ? 'Regenerate' : 'Generate Avatar'}
                </Button>
                {generatedAvatar && (
                  <Button type="button" onClick={handleAcceptAvatar} className="flex-1">
                    Accept & Save
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>
        </>
      )}

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
