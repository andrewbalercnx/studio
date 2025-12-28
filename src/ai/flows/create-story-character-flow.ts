'use server';

/**
 * @fileOverview A unified Genkit flow for creating story characters.
 * Used by all story flows (Story Beat, Gemini 3, Gemini 4) to ensure
 * consistent character creation with proper pronouns, description, likes, and dislikes.
 */

import { ai } from '@/ai/genkit';
import { getServerFirestore } from '@/lib/server-firestore';
import { z } from 'genkit';
import { FieldValue } from 'firebase-admin/firestore';
import { generateCharacterProfile } from '@/ai/flows/character-profile-generator';

const CreateStoryCharacterInputSchema = z.object({
  sessionId: z.string(),
  parentUid: z.string(),
  childId: z.string(),
  characterLabel: z.string().describe("A descriptive phrase like 'a friendly dragon who loves flying'"),
  characterName: z.string().optional().describe("Optional override for the display name"),
  characterType: z.enum(['Family', 'Friend', 'Pet', 'Toy', 'Other']),
  storyContext: z.string().describe("Recent story text for context"),
  childAge: z.number().nullable(),
  generateAvatar: z.boolean().optional().default(false),
});

const CreateStoryCharacterOutputSchema = z.object({
  ok: z.boolean(),
  characterId: z.string().optional(),
  character: z.any().optional(),
  errorMessage: z.string().optional(),
});

export type CreateStoryCharacterInput = z.infer<typeof CreateStoryCharacterInputSchema>;
export type CreateStoryCharacterOutput = z.infer<typeof CreateStoryCharacterOutputSchema>;

/**
 * Extracts a display name from a character label.
 * For labels like "a friendly squirrel who loves acorns", extracts "squirrel".
 * For labels like "Nutsy the squirrel", extracts "Nutsy".
 */
function extractDisplayName(label: string, explicitName?: string): string {
  if (explicitName) return explicitName;

  // Try pattern: "a [adjectives] [noun] who..."
  const aPatternMatch = label.match(/^a\s+(?:.*?\s+)?(\w+)(?:\s+who|\s+that|\s*$)/i);
  if (aPatternMatch) {
    return aPatternMatch[1].charAt(0).toUpperCase() + aPatternMatch[1].slice(1);
  }

  // Try pattern: "[Name] the [type]"
  const thePatternMatch = label.match(/^(\w+)\s+the\s+/i);
  if (thePatternMatch) {
    return thePatternMatch[1];
  }

  // Fallback: use the whole label, capitalized
  return label.charAt(0).toUpperCase() + label.slice(1);
}

export const createStoryCharacterFlow = ai.defineFlow(
  {
    name: 'createStoryCharacterFlow',
    inputSchema: CreateStoryCharacterInputSchema,
    outputSchema: CreateStoryCharacterOutputSchema,
  },
  async ({ sessionId, parentUid, childId, characterLabel, characterName, characterType, storyContext, childAge, generateAvatar }) => {
    try {
      const firestore = await getServerFirestore();

      // Extract display name from label
      const displayName = extractDisplayName(characterLabel, characterName);

      // Generate character profile using AI
      const profile = await generateCharacterProfile({
        name: displayName,
        type: characterType,
        label: characterLabel,
        storyContext,
        childAge,
      });

      // Create character in Firestore
      const charactersRef = firestore.collection('characters');
      const newCharacterData = {
        ownerParentUid: parentUid,
        childId: childId,
        displayName: displayName,
        pronouns: profile.pronouns,
        type: characterType,
        description: profile.description,
        dateOfBirth: profile.dateOfBirth,
        likes: profile.likes,
        dislikes: profile.dislikes,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
        avatarUrl: `https://picsum.photos/seed/${encodeURIComponent(displayName)}/200/200`,
        photos: [],
        isParentGenerated: false, // AI-generated during story
        usageCount: 1, // Created during story, so count starts at 1
        lastUsedAt: FieldValue.serverTimestamp(),
      };

      const newCharacterRef = await charactersRef.add(newCharacterData);

      // Update session with new supporting character
      const sessionRef = firestore.collection('storySessions').doc(sessionId);
      await sessionRef.update({
        supportingCharacterIds: FieldValue.arrayUnion(newCharacterRef.id),
        updatedAt: FieldValue.serverTimestamp(),
      });

      // Note: Avatar generation is handled separately via /api/generateCharacterAvatar
      // The client can call this after receiving the character ID if generateAvatar is true

      return {
        ok: true,
        characterId: newCharacterRef.id,
        character: {
          id: newCharacterRef.id,
          ...newCharacterData,
          // Convert FieldValue to null for JSON serialization
          createdAt: null,
          updatedAt: null,
        },
      };
    } catch (e: any) {
      console.error('[createStoryCharacterFlow] Error:', e);
      return {
        ok: false,
        errorMessage: `Failed to create character: ${e.message || String(e)}`,
      };
    }
  }
);

// Alias for backward compatibility with gemini4 flow
export const gemini4CreateCharacterFlow = createStoryCharacterFlow;
