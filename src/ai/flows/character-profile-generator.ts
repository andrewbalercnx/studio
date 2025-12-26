'use server';

/**
 * @fileOverview Helper functions to generate rich character profiles for story characters
 */

import { ai } from '@/ai/genkit';
import { z } from 'genkit';
import { logAIFlow } from '@/lib/ai-flow-logger';
import type { Pronouns } from '@/lib/types';

const CharacterProfileSchema = z.object({
  description: z.string().describe('A brief, child-friendly description of the character (1-2 sentences)'),
  age: z.number().optional().describe('Estimated age in years, if applicable'),
  pronouns: z.enum(['he/him', 'she/her', 'they/them']).describe('Pronouns for the character based on the description and context'),
  likes: z.array(z.string()).min(3).max(5).describe('3-5 things the character likes'),
  dislikes: z.array(z.string()).min(2).max(3).describe('2-3 things the character dislikes'),
});

export type CharacterProfileInput = {
  name: string;
  type: 'Family' | 'Friend' | 'Pet' | 'Toy' | 'Other';
  label: string;
  storyContext: string;
  childAge?: number | null;
};

export type CharacterProfile = {
  description: string;
  pronouns: Pronouns;
  dateOfBirth: Date | null;
  likes: string[];
  dislikes: string[];
};

export async function generateCharacterProfile(input: CharacterProfileInput): Promise<CharacterProfile> {
  const ageContext = input.childAge ? `The main character (child) is ${input.childAge} years old.` : '';

  const prompt = `Generate a character profile for a children's story character.

Character: ${input.name}
Type: ${input.type}
Description: ${input.label}
Story Context: ${input.storyContext}
${ageContext}

Create an age-appropriate, imaginative character profile that would fit naturally into a children's story. The character should be friendly, engaging, and appropriate for young children.

For pronouns:
- Infer pronouns from the character's name, description, and type
- Use "they/them" if gender is unclear or if the character is non-binary
- Pets and toys may use he/him, she/her, or they/them based on context

For the age:
- Pets and toys: don't assign a specific age
- Adult characters (family, friends): choose an appropriate adult age
- Child characters: make them around the same age as the main character, or slightly older/younger

Generate realistic, story-appropriate likes and dislikes that match the character's personality and role.`;

  const startTime = Date.now();
  try {
    const result = await ai.generate({
      model: 'googleai/gemini-2.5-pro',
      prompt,
      output: {
        schema: CharacterProfileSchema,
      },
    });

    await logAIFlow({
      flowName: 'generateCharacterProfile',
      sessionId: null,
      prompt,
      response: result,
      startTime,
    });

    const profileData = result.output as z.infer<typeof CharacterProfileSchema>;

    let dateOfBirth: Date | null = null;
    if (profileData.age && profileData.age > 0) {
      const now = new Date();
      dateOfBirth = new Date(now.getFullYear() - profileData.age, now.getMonth(), now.getDate());
    }

    return {
      description: profileData.description,
      pronouns: profileData.pronouns as Pronouns,
      dateOfBirth,
      likes: profileData.likes,
      dislikes: profileData.dislikes,
    };
  } catch (error: any) {
    console.error('[generateCharacterProfile] Error:', error);
    await logAIFlow({
      flowName: 'generateCharacterProfile',
      sessionId: null,
      prompt,
      error,
      startTime,
    });

    return {
      description: `A ${input.label} who appears in the story`,
      pronouns: 'they/them' as Pronouns,
      dateOfBirth: null,
      likes: [],
      dislikes: [],
    };
  }
}
