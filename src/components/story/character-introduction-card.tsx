'use client';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Sparkles, UserPlus, ArrowRight, LoaderCircle } from 'lucide-react';
import type { Character } from '@/lib/types';

interface CharacterIntroductionCardProps {
  /** The character being introduced (may be partial while loading) */
  character?: Partial<Character> | null;
  /** Character name from the choice option */
  characterName: string;
  /** Character description/label from the choice option */
  characterLabel: string;
  /** Character type from the choice option */
  characterType?: string;
  /** Called when the user clicks Continue */
  onContinue: () => void;
  /** Whether currently loading/processing */
  isLoading?: boolean;
  /** Loading message to display */
  loadingMessage?: string;
  /** Whether the continue button is disabled */
  disabled?: boolean;
}

/**
 * A card that introduces a new character to the story.
 * Shows character details and avatar (which may load asynchronously).
 * User clicks Continue to proceed with the story.
 */
export function CharacterIntroductionCard({
  character,
  characterName,
  characterLabel,
  characterType = 'Friend',
  onContinue,
  isLoading = false,
  loadingMessage = 'Creating your new friend...',
  disabled = false,
}: CharacterIntroductionCardProps) {
  // Use character data if available, otherwise fall back to props
  const displayName = character?.displayName || characterName;
  const avatarUrl = character?.avatarUrl;
  const description = character?.description || characterLabel;
  const type = character?.type || characterType;

  // Determine avatar generation status
  const isAvatarGenerating = !avatarUrl && !isLoading;

  return (
    <Card className="w-full max-w-md mx-auto bg-gradient-to-br from-purple-50 to-pink-50 dark:from-purple-950 dark:to-pink-950 border-purple-200 dark:border-purple-800">
      <CardHeader className="text-center pb-2">
        <div className="flex justify-center mb-2">
          <Badge variant="secondary" className="gap-1 bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-300">
            <UserPlus className="h-3 w-3" />
            New Character
          </Badge>
        </div>
        <CardTitle className="text-2xl flex items-center justify-center gap-2">
          <Sparkles className="h-5 w-5 text-purple-500" />
          Meet {displayName}!
          <Sparkles className="h-5 w-5 text-purple-500" />
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col items-center gap-4">
        {/* Avatar */}
        <div className="relative">
          <Avatar className="h-32 w-32 border-4 border-purple-200 dark:border-purple-700 shadow-lg">
            {avatarUrl ? (
              <AvatarImage src={avatarUrl} alt={displayName} />
            ) : null}
            <AvatarFallback className="text-4xl bg-purple-100 dark:bg-purple-900 text-purple-600 dark:text-purple-300">
              {isAvatarGenerating ? (
                <LoaderCircle className="h-12 w-12 animate-spin text-purple-400" />
              ) : (
                displayName.charAt(0).toUpperCase()
              )}
            </AvatarFallback>
          </Avatar>
          {isAvatarGenerating && (
            <div className="absolute -bottom-1 left-1/2 -translate-x-1/2">
              <Badge variant="outline" className="text-xs bg-white dark:bg-gray-900">
                Creating avatar...
              </Badge>
            </div>
          )}
        </div>

        {/* Character type badge */}
        <Badge variant="outline" className="text-sm">
          {type}
        </Badge>

        {/* Description */}
        <p className="text-center text-muted-foreground text-lg leading-relaxed">
          {description}
        </p>

        {/* Loading state */}
        {isLoading && (
          <div className="flex items-center gap-2 text-muted-foreground">
            <LoaderCircle className="h-4 w-4 animate-spin" />
            <span className="text-sm">{loadingMessage}</span>
          </div>
        )}
      </CardContent>
      <CardFooter className="flex justify-center pt-2">
        <Button
          size="lg"
          onClick={onContinue}
          disabled={disabled || isLoading}
          className="gap-2 bg-purple-600 hover:bg-purple-700 text-white"
        >
          Continue the Adventure
          <ArrowRight className="h-4 w-4" />
        </Button>
      </CardFooter>
    </Card>
  );
}
