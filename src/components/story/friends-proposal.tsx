'use client';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Users, Sparkles, RefreshCw } from 'lucide-react';
import type { FriendsCharacterOption } from '@/lib/types';

interface FriendsProposalProps {
  proposedCharacters: FriendsCharacterOption[];
  onAccept: () => void;
  onChangeCharacters: () => void;
  isLoading?: boolean;
}

/**
 * Simple avatar display of AI-proposed characters for the adventure.
 * Shows a row of character avatars with:
 * - "Let's go!" button to accept the proposed group
 * - "Give me other friends" button to expand to full picker
 */
export function FriendsProposal({
  proposedCharacters,
  onAccept,
  onChangeCharacters,
  isLoading = false,
}: FriendsProposalProps) {
  const selectedCharacters = proposedCharacters.filter((c) => c.isSelected);

  const getCharacterInitials = (name: string) => {
    return name
      .split(' ')
      .map((n) => n[0])
      .join('')
      .toUpperCase()
      .slice(0, 2);
  };

  const getCharacterTypeColor = (type: FriendsCharacterOption['type']) => {
    switch (type) {
      case 'child':
        return 'bg-amber-100 border-amber-300';
      case 'sibling':
        return 'bg-blue-100 border-blue-300';
      case 'Family':
        return 'bg-purple-100 border-purple-300';
      case 'Friend':
        return 'bg-green-100 border-green-300';
      case 'Pet':
        return 'bg-orange-100 border-orange-300';
      case 'Toy':
        return 'bg-pink-100 border-pink-300';
      default:
        return 'bg-gray-100 border-gray-300';
    }
  };

  return (
    <Card className="border-2 border-amber-200 bg-gradient-to-b from-amber-50 to-orange-50">
      <CardContent className="p-6">
        <div className="text-center space-y-6">
          {/* Header */}
          <div className="space-y-2">
            <div className="flex items-center justify-center gap-2">
              <Users className="h-6 w-6 text-amber-600" />
              <h2 className="text-xl font-bold text-amber-900">Your Adventure Team!</h2>
            </div>
            <p className="text-amber-700">
              Here are some friends who&apos;d love to go on an adventure with you!
            </p>
          </div>

          {/* Character Avatars */}
          <div className="flex flex-wrap justify-center gap-4">
            {selectedCharacters.map((character) => (
              <div key={character.id} className="flex flex-col items-center gap-2">
                <div
                  className={`rounded-full p-1 border-2 ${getCharacterTypeColor(character.type)}`}
                >
                  <Avatar className="h-16 w-16 sm:h-20 sm:w-20">
                    <AvatarImage src={character.avatarUrl} alt={character.displayName} />
                    <AvatarFallback className="text-lg font-semibold bg-white">
                      {getCharacterInitials(character.displayName)}
                    </AvatarFallback>
                  </Avatar>
                </div>
                <div className="text-center">
                  <p className="font-medium text-sm text-gray-900">{character.displayName}</p>
                  <p className="text-xs text-gray-500 capitalize">
                    {character.type === 'child' ? 'You!' : character.type}
                  </p>
                </div>
              </div>
            ))}
          </div>

          {/* Action Buttons */}
          <div className="flex flex-col sm:flex-row gap-3 justify-center pt-2">
            <Button
              size="lg"
              className="bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 text-white font-bold"
              onClick={onAccept}
              disabled={isLoading}
            >
              <Sparkles className="h-5 w-5 mr-2" />
              Let&apos;s go!
            </Button>
            <Button
              variant="outline"
              size="lg"
              onClick={onChangeCharacters}
              disabled={isLoading}
              className="border-amber-300 text-amber-700 hover:bg-amber-50"
            >
              <RefreshCw className="h-4 w-4 mr-2" />
              Give me other friends
            </Button>
          </div>

          {selectedCharacters.length === 1 && (
            <p className="text-sm text-amber-600 italic">
              Just you? That&apos;s okay! Solo adventures can be fun too!
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
