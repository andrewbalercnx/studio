'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Checkbox } from '@/components/ui/checkbox';
import { Users, Check, ArrowLeft } from 'lucide-react';
import type { FriendsCharacterOption } from '@/lib/types';

interface CharacterPickerProps {
  availableCharacters: FriendsCharacterOption[];
  initialSelection: string[];
  onConfirm: (selectedIds: string[]) => void;
  onBack: () => void;
  isLoading?: boolean;
  mainChildId?: string;
}

/**
 * Full grid picker for selecting characters for the adventure.
 * Shows all available characters with checkboxes.
 * The main child is always selected and cannot be deselected.
 */
export function CharacterPicker({
  availableCharacters,
  initialSelection,
  onConfirm,
  onBack,
  isLoading = false,
  mainChildId,
}: CharacterPickerProps) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set(initialSelection));

  const handleToggle = (characterId: string) => {
    // Don't allow deselecting the main child
    if (characterId === mainChildId) return;

    const newSelection = new Set(selectedIds);
    if (newSelection.has(characterId)) {
      newSelection.delete(characterId);
    } else {
      newSelection.add(characterId);
    }
    setSelectedIds(newSelection);
  };

  const handleConfirm = () => {
    onConfirm(Array.from(selectedIds));
  };

  const getCharacterInitials = (name: string) => {
    return name
      .split(' ')
      .map((n) => n[0])
      .join('')
      .toUpperCase()
      .slice(0, 2);
  };

  const getCharacterTypeLabel = (type: FriendsCharacterOption['type']) => {
    switch (type) {
      case 'child':
        return 'You';
      case 'sibling':
        return 'Sibling';
      default:
        return type;
    }
  };

  const getCharacterTypeBadgeColor = (type: FriendsCharacterOption['type']) => {
    switch (type) {
      case 'child':
        return 'bg-amber-100 text-amber-800';
      case 'sibling':
        return 'bg-blue-100 text-blue-800';
      case 'Family':
        return 'bg-purple-100 text-purple-800';
      case 'Friend':
        return 'bg-green-100 text-green-800';
      case 'Pet':
        return 'bg-orange-100 text-orange-800';
      case 'Toy':
        return 'bg-pink-100 text-pink-800';
      default:
        return 'bg-gray-100 text-gray-800';
    }
  };

  const selectedCount = selectedIds.size;

  return (
    <Card className="border-2 border-amber-200">
      <CardHeader className="bg-gradient-to-r from-amber-50 to-orange-50 border-b">
        <div className="flex items-center justify-between">
          <Button variant="ghost" size="sm" onClick={onBack} disabled={isLoading}>
            <ArrowLeft className="h-4 w-4 mr-1" />
            Back
          </Button>
          <CardTitle className="flex items-center gap-2">
            <Users className="h-5 w-5 text-amber-600" />
            Choose Your Friends
          </CardTitle>
          <div className="w-16" /> {/* Spacer for centering */}
        </div>
      </CardHeader>
      <CardContent className="p-4">
        <p className="text-center text-sm text-muted-foreground mb-4">
          Tap on characters to add or remove them from your adventure team!
        </p>

        {/* Character Grid */}
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3 mb-6">
          {availableCharacters.map((character) => {
            const isSelected = selectedIds.has(character.id);
            const isMainChild = character.id === mainChildId;

            return (
              <button
                key={character.id}
                onClick={() => handleToggle(character.id)}
                disabled={isMainChild || isLoading}
                className={`
                  relative p-3 rounded-xl border-2 transition-all
                  ${isSelected
                    ? 'border-amber-400 bg-amber-50 shadow-md'
                    : 'border-gray-200 bg-white hover:border-gray-300'
                  }
                  ${isMainChild ? 'cursor-not-allowed' : 'cursor-pointer'}
                  disabled:opacity-80
                `}
              >
                {/* Selection Indicator */}
                {isSelected && (
                  <div className="absolute top-1 right-1 bg-amber-500 rounded-full p-0.5">
                    <Check className="h-3 w-3 text-white" />
                  </div>
                )}

                <div className="flex flex-col items-center gap-2">
                  <Avatar className="h-14 w-14 sm:h-16 sm:w-16">
                    <AvatarImage src={character.avatarUrl} alt={character.displayName} />
                    <AvatarFallback className="text-sm font-semibold">
                      {getCharacterInitials(character.displayName)}
                    </AvatarFallback>
                  </Avatar>
                  <div className="text-center">
                    <p className="font-medium text-sm truncate max-w-full">
                      {character.displayName}
                    </p>
                    <span
                      className={`text-xs px-2 py-0.5 rounded-full ${getCharacterTypeBadgeColor(
                        character.type
                      )}`}
                    >
                      {getCharacterTypeLabel(character.type)}
                    </span>
                  </div>
                </div>

                {isMainChild && (
                  <p className="text-xs text-amber-600 mt-1">Always included</p>
                )}
              </button>
            );
          })}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between pt-4 border-t">
          <p className="text-sm text-muted-foreground">
            {selectedCount} character{selectedCount !== 1 ? 's' : ''} selected
          </p>
          <Button
            size="lg"
            className="bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600"
            onClick={handleConfirm}
            disabled={isLoading || selectedCount === 0}
          >
            <Check className="h-4 w-4 mr-2" />
            Confirm Team
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
