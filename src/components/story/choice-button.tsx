'use client';

import { Button } from '@/components/ui/button';
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { UserPlus } from 'lucide-react';
import type { Choice } from '@/lib/types';

// Type for entity metadata included in resolved options
export type EntityMetadata = {
  id: string;
  displayName: string;
  avatarUrl?: string;
  type: 'character' | 'child';
};

// Extended choice type with entity metadata
export type ChoiceWithEntities = Choice & {
  entities?: EntityMetadata[];
  isMoreOption?: boolean;
};

interface ChoiceButtonProps {
  choice: ChoiceWithEntities;
  onClick: () => void;
  disabled?: boolean;
  icon?: React.ReactNode;
  variant?: 'secondary' | 'outline';
  className?: string;
  /** Optional label like "A", "B", "C" shown in a badge */
  optionLabel?: string;
}

/**
 * A button for displaying story choices with optional character avatars.
 * Shows up to 3 overlapping avatars for characters mentioned in the choice.
 * Shows a "New friend" indicator when the choice introduces a new character.
 */
export function ChoiceButton({
  choice,
  onClick,
  disabled,
  icon,
  variant = 'secondary',
  className = '',
  optionLabel
}: ChoiceButtonProps) {
  const entities = choice.entities || [];
  const hasEntities = entities.length > 0 && entities.some(e => e.avatarUrl);
  const introducesCharacter = choice.introducesCharacter;

  return (
    <Button
      variant={variant}
      size="lg"
      className={`h-auto min-h-[48px] py-3 px-4 text-base whitespace-normal text-wrap text-left justify-start ${introducesCharacter ? 'ring-2 ring-purple-300 dark:ring-purple-700' : ''} ${className}`}
      onClick={onClick}
      disabled={disabled}
    >
      <div className="flex items-center gap-3 w-full">
        {optionLabel && (
          <div className="flex-shrink-0 w-8 h-8 rounded-full bg-primary text-primary-foreground flex items-center justify-center font-bold text-lg">
            {optionLabel}
          </div>
        )}
        {introducesCharacter && (
          <div className="flex-shrink-0">
            <Badge variant="secondary" className="gap-1 bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-300">
              <UserPlus className="h-3 w-3" />
              New friend
            </Badge>
          </div>
        )}
        {hasEntities && !introducesCharacter && !optionLabel && (
          <div className="flex -space-x-2 flex-shrink-0">
            {entities.filter(e => e.avatarUrl).slice(0, 3).map((entity) => (
              <Avatar key={entity.id} className="h-8 w-8 border-2 border-background">
                <AvatarImage src={entity.avatarUrl} alt={entity.displayName} />
                <AvatarFallback className="text-xs">
                  {entity.displayName.charAt(0).toUpperCase()}
                </AvatarFallback>
              </Avatar>
            ))}
          </div>
        )}
        <span className="flex-1 leading-relaxed">
          {icon}
          {choice.text}
        </span>
      </div>
    </Button>
  );
}
