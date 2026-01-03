'use client';

import { useState } from 'react';
import { Volume2, VolumeX, LoaderCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useFirestore } from '@/firebase';
import { doc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { useToast } from '@/hooks/use-toast';
import type { ChildProfile } from '@/lib/types';

interface SpeechModeToggleProps {
  /** The child profile */
  childProfile: ChildProfile;
  /** Optional className for styling */
  className?: string;
  /** Show text label next to icon (hidden on small screens) */
  showLabel?: boolean;
}

/**
 * Toggle button for speech mode in the child's story creation interface.
 * Only visible when the child has a preferred TTS voice set.
 * Persists the setting to Firestore.
 */
export function SpeechModeToggle({ childProfile, className, showLabel }: SpeechModeToggleProps) {
  const firestore = useFirestore();
  const { toast } = useToast();
  const [isUpdating, setIsUpdating] = useState(false);

  // Don't render if child doesn't have a preferred voice
  if (!childProfile.preferredVoiceId) {
    return null;
  }

  const isEnabled = childProfile.autoReadAloud ?? false;

  const handleToggle = async () => {
    if (!firestore || isUpdating) return;

    setIsUpdating(true);
    try {
      const childRef = doc(firestore, 'children', childProfile.id);
      await updateDoc(childRef, {
        autoReadAloud: !isEnabled,
        updatedAt: serverTimestamp(),
      });

      toast({
        title: !isEnabled ? 'Speech mode on' : 'Speech mode off',
        description: !isEnabled
          ? 'Text will be read aloud'
          : 'Text will not be read aloud',
      });
    } catch (error: any) {
      console.error('[SpeechModeToggle] Error updating:', error);
      toast({
        title: 'Could not update setting',
        description: error.message || 'Please try again',
        variant: 'destructive',
      });
    } finally {
      setIsUpdating(false);
    }
  };

  return (
    <Button
      variant={isEnabled ? 'default' : 'outline'}
      size={showLabel ? 'sm' : 'icon'}
      onClick={handleToggle}
      disabled={isUpdating}
      className={showLabel ? `gap-2 ${className || ''}` : className}
      title={isEnabled ? 'Turn off speech mode' : 'Turn on speech mode'}
    >
      {isUpdating ? (
        <LoaderCircle className="h-4 w-4 animate-spin" />
      ) : isEnabled ? (
        <Volume2 className="h-4 w-4" />
      ) : (
        <VolumeX className="h-4 w-4" />
      )}
      {showLabel && (
        <span className="hidden sm:inline">
          {isEnabled ? 'Read to Me' : 'Read to Me Off'}
        </span>
      )}
    </Button>
  );
}
