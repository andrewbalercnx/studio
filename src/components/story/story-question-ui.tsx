'use client';

import { RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { ChoiceButton, type ChoiceWithEntities } from './choice-button';
import { ChildAvatarAnimation } from '@/components/child/child-avatar-animation';
import { ThinkingIndicator } from '@/components/child-thinking-indicator';
import type { Choice } from '@/lib/types';

interface StoryQuestionUIProps {
  /** Header text displayed above the question (e.g., story continuation) */
  headerText?: string;

  /** The question text to display */
  questionText: string;

  /** Available options/choices */
  options: ChoiceWithEntities[];

  /** Called when an option is selected */
  onSelectOption: (option: Choice) => void;

  /** Whether to show the "More" button for generating new options */
  showMoreButton?: boolean;

  /** Called when "More" button is clicked */
  onMoreOptions?: () => void;

  /** Whether currently loading more options */
  isLoadingMore?: boolean;

  /** Whether the entire UI is in a loading state */
  isLoading?: boolean;

  /** Message to show during loading */
  loadingMessage?: string;

  /** Child's avatar URL for dancing avatar during loading */
  childAvatarUrl?: string | null;

  /** Child's animation URL (mp4/webm/gif) for dancing avatar */
  childAvatarAnimationUrl?: string | null;

  /** Whether the UI is disabled (e.g., during processing) */
  disabled?: boolean;

  /** Optional icon to show next to each option */
  optionIcon?: React.ReactNode;

  /** Gradient style for the header card */
  headerGradient?: string;
}

/**
 * Unified UI component for AI story flow questions.
 * Displays:
 * 1. Optional header text (story continuation)
 * 2. Question with avatar
 * 3. Options with character avatars
 * 4. Optional "More" button
 * 5. Dancing avatar during loading
 */
export function StoryQuestionUI({
  headerText,
  questionText,
  options,
  onSelectOption,
  showMoreButton = false,
  onMoreOptions,
  isLoadingMore = false,
  isLoading = false,
  loadingMessage = 'Thinking...',
  childAvatarUrl,
  childAvatarAnimationUrl,
  disabled = false,
  optionIcon,
  headerGradient = 'from-blue-50 to-indigo-50 dark:from-blue-950 dark:to-indigo-950',
}: StoryQuestionUIProps) {
  // Show loading state with dancing avatar
  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center gap-4 py-8">
        {childAvatarAnimationUrl || childAvatarUrl ? (
          <ChildAvatarAnimation
            avatarAnimationUrl={childAvatarAnimationUrl}
            avatarUrl={childAvatarUrl}
            size="lg"
          />
        ) : (
          <ThinkingIndicator />
        )}
        <p className="text-muted-foreground animate-pulse">{loadingMessage}</p>
      </div>
    );
  }

  return (
    <div className="space-y-6 w-full">
      {/* Header text (story continuation) */}
      {headerText && (
        <Card className={`w-full bg-gradient-to-br ${headerGradient}`}>
          <CardContent className="pt-6">
            <p className="text-lg leading-relaxed whitespace-pre-wrap">
              {headerText}
            </p>
          </CardContent>
        </Card>
      )}

      {/* Question */}
      <div className="flex flex-col items-center gap-2">
        <p className="text-xl font-medium leading-relaxed text-center">
          {questionText}
        </p>
      </div>

      {/* Options grid */}
      <div className="grid grid-cols-1 gap-3 w-full">
        {options.map((opt, idx) => {
          const isMoreOption = opt.isMoreOption;
          return (
            <ChoiceButton
              key={opt.id || idx}
              choice={opt}
              onClick={() => onSelectOption(opt)}
              disabled={disabled || isLoadingMore}
              variant={isMoreOption ? 'outline' : 'secondary'}
              className={isMoreOption ? 'border-dashed' : ''}
              icon={isMoreOption ? (
                <RefreshCw className="w-4 h-4 mr-2 text-muted-foreground flex-shrink-0" />
              ) : optionIcon}
            />
          );
        })}
      </div>

      {/* More button (if not already in options and showMoreButton is true) */}
      {showMoreButton && onMoreOptions && !options.some(o => o.isMoreOption) && (
        <div className="flex justify-center">
          <Button
            variant="outline"
            className="border-dashed"
            onClick={onMoreOptions}
            disabled={disabled || isLoadingMore}
          >
            <RefreshCw className={`w-4 h-4 mr-2 ${isLoadingMore ? 'animate-spin' : ''}`} />
            {isLoadingMore ? 'Getting more options...' : 'More choices'}
          </Button>
        </div>
      )}
    </div>
  );
}
