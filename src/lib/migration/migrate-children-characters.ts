'use server';

import { getServerFirestore } from '@/lib/server-firestore';
import { FieldValue } from 'firebase-admin/firestore';
import { ai } from '@/ai/genkit';
import { z } from 'genkit';
import type { Pronouns } from '@/lib/types';

// Schema for AI pronoun inference
const PronounInferenceSchema = z.object({
  pronouns: z.enum(['he/him', 'she/her', 'they/them']).describe('The most likely pronouns based on the name and description'),
  confidence: z.enum(['high', 'medium', 'low']).describe('Confidence level in the inference'),
});

type OldChildPreferences = {
  favoriteColors?: string[];
  favoriteFoods?: string[];
  favoriteGames?: string[];
  favoriteSubjects?: string[];
};

type OldChildProfile = {
  id: string;
  displayName: string;
  description?: string;
  ownerParentUid: string;
  dateOfBirth?: any;
  photos?: string[];
  avatarUrl?: string;
  createdAt: any;
  updatedAt?: any;
  estimatedLevel?: number;
  favouriteGenres?: string[];
  favouriteCharacterTypes?: string[];
  preferredStoryLength?: 'short' | 'medium' | 'long';
  helpPreference?: 'more_scaffolding' | 'balanced' | 'independent';
  preferences?: OldChildPreferences;
};

type OldCharacter = {
  id: string;
  ownerParentUid: string;
  displayName: string;
  description?: string;
  relatedTo?: string;
  sessionId?: string;
  role: 'family' | 'friend' | 'pet' | 'toy';
  realPersonRef?: {
    kind: 'self' | 'family' | 'friend';
    label: string;
  };
  traits?: string[];
  traitsLastUpdatedAt?: Date;
  visualNotes?: {
    hair?: string;
    clothing?: string;
    specialItem?: string;
    styleHint?: string;
  };
  avatarUrl?: string;
  photos?: string[];
  createdAt: any;
  updatedAt: any;
  introducedFromOptionId?: string;
  introducedFromMessageId?: string;
};

export async function migrateChildren(): Promise<{
  success: boolean;
  migratedCount: number;
  errors: string[];
}> {
  const errors: string[] = [];
  let migratedCount = 0;

  try {
    const firestore = await getServerFirestore();
    const childrenSnapshot = await firestore.collection('children').get();

    let batch = firestore.batch();
    let batchCount = 0;

    for (const doc of childrenSnapshot.docs) {
      try {
        const oldData = doc.data() as OldChildProfile;

        // Consolidate all preferences into likes array
        const likes: string[] = [];
        if (oldData.preferences?.favoriteColors?.length) {
          likes.push(...oldData.preferences.favoriteColors);
        }
        if (oldData.preferences?.favoriteFoods?.length) {
          likes.push(...oldData.preferences.favoriteFoods);
        }
        if (oldData.preferences?.favoriteGames?.length) {
          likes.push(...oldData.preferences.favoriteGames);
        }
        if (oldData.preferences?.favoriteSubjects?.length) {
          likes.push(...oldData.preferences.favoriteSubjects);
        }

        // Build update object
        const updateData: any = {
          likes,
          dislikes: [], // Initialize as empty
          updatedAt: FieldValue.serverTimestamp(),
          // Delete old fields
          estimatedLevel: FieldValue.delete(),
          favouriteGenres: FieldValue.delete(),
          favouriteCharacterTypes: FieldValue.delete(),
          preferredStoryLength: FieldValue.delete(),
          helpPreference: FieldValue.delete(),
          preferences: FieldValue.delete(),
        };

        batch.update(doc.ref, updateData);
        batchCount++;
        migratedCount++;

        // Commit batch if we hit the limit
        if (batchCount >= 500) {
          await batch.commit();
          batch = firestore.batch();
          batchCount = 0;
        }
      } catch (err: any) {
        errors.push(`Error migrating child ${doc.id}: ${err.message}`);
      }
    }

    // Commit any remaining operations
    if (batchCount > 0) {
      await batch.commit();
    }

    return {
      success: errors.length === 0,
      migratedCount,
      errors,
    };
  } catch (err: any) {
    return {
      success: false,
      migratedCount,
      errors: [`Fatal error during migration: ${err.message}`],
    };
  }
}

export async function migrateCharacters(): Promise<{
  success: boolean;
  migratedCount: number;
  errors: string[];
}> {
  const errors: string[] = [];
  let migratedCount = 0;

  try {
    const firestore = await getServerFirestore();
    const charactersSnapshot = await firestore.collection('characters').get();

    let batch = firestore.batch();
    let batchCount = 0;

    for (const doc of charactersSnapshot.docs) {
      try {
        const oldData = doc.data() as OldCharacter;

        // Map old role to new type (capitalize first letter)
        const typeMapping: Record<string, 'Family' | 'Friend' | 'Pet' | 'Toy' | 'Other'> = {
          'family': 'Family',
          'friend': 'Friend',
          'pet': 'Pet',
          'toy': 'Toy',
        };
        const newType = typeMapping[oldData.role] || 'Other';

        // Map traits to likes
        const likes = oldData.traits || [];

        // Map relatedTo to childId
        const childId = oldData.relatedTo;

        // Build update object
        const updateData: any = {
          type: newType,
          likes,
          dislikes: [], // Initialize as empty
          updatedAt: FieldValue.serverTimestamp(),
          // Delete old fields
          role: FieldValue.delete(),
          relatedTo: FieldValue.delete(),
          sessionId: FieldValue.delete(),
          realPersonRef: FieldValue.delete(),
          traits: FieldValue.delete(),
          traitsLastUpdatedAt: FieldValue.delete(),
          visualNotes: FieldValue.delete(),
          introducedFromOptionId: FieldValue.delete(),
          introducedFromMessageId: FieldValue.delete(),
        };

        // Only set childId if it exists, otherwise delete it (for family-wide characters)
        if (childId) {
          updateData.childId = childId;
        } else {
          updateData.childId = FieldValue.delete();
        }

        batch.update(doc.ref, updateData);
        batchCount++;
        migratedCount++;

        // Commit batch if we hit the limit
        if (batchCount >= 500) {
          await batch.commit();
          batch = firestore.batch();
          batchCount = 0;
        }
      } catch (err: any) {
        errors.push(`Error migrating character ${doc.id}: ${err.message}`);
      }
    }

    // Commit any remaining operations
    if (batchCount > 0) {
      await batch.commit();
    }

    return {
      success: errors.length === 0,
      migratedCount,
      errors,
    };
  } catch (err: any) {
    return {
      success: false,
      migratedCount,
      errors: [`Fatal error during migration: ${err.message}`],
    };
  }
}

export async function migrateAll(): Promise<{
  success: boolean;
  childrenMigrated: number;
  charactersMigrated: number;
  errors: string[];
}> {
  const childrenResult = await migrateChildren();
  const charactersResult = await migrateCharacters();

  return {
    success: childrenResult.success && charactersResult.success,
    childrenMigrated: childrenResult.migratedCount,
    charactersMigrated: charactersResult.migratedCount,
    errors: [...childrenResult.errors, ...charactersResult.errors],
  };
}

// Helper function to infer pronouns using AI
async function inferPronouns(name: string, description?: string, type?: string): Promise<Pronouns> {
  const prompt = `Based on the following information, infer the most appropriate pronouns for this person/character.

Name: ${name}
${description ? `Description: ${description}` : ''}
${type ? `Type: ${type}` : ''}

Rules:
- Infer pronouns based on name and any contextual clues
- Use "they/them" if gender is unclear or ambiguous
- For pets, use appropriate pronouns based on name/description hints, defaulting to "they/them"
- Be culturally aware that names can have different gender associations in different cultures

Return the most appropriate pronouns.`;

  try {
    const result = await ai.generate({
      model: 'googleai/gemini-2.0-flash',
      prompt,
      output: {
        schema: PronounInferenceSchema,
      },
    });

    const output = result.output as z.infer<typeof PronounInferenceSchema>;
    return output.pronouns as Pronouns;
  } catch (error) {
    console.error('[inferPronouns] Error:', error);
    return 'they/them'; // Default fallback
  }
}

export async function migrateChildrenPronouns(): Promise<{
  success: boolean;
  migratedCount: number;
  skippedCount: number;
  errors: string[];
}> {
  const errors: string[] = [];
  let migratedCount = 0;
  let skippedCount = 0;

  try {
    const firestore = await getServerFirestore();
    const childrenSnapshot = await firestore.collection('children').get();

    for (const doc of childrenSnapshot.docs) {
      try {
        const data = doc.data();

        // Skip if pronouns already set
        if (data.pronouns) {
          skippedCount++;
          continue;
        }

        const name = data.displayName || '';
        const description = data.description || '';

        // Infer pronouns using AI
        const pronouns = await inferPronouns(name, description, 'child');

        // Update the document
        await doc.ref.update({
          pronouns,
          updatedAt: FieldValue.serverTimestamp(),
        });

        migratedCount++;
        console.log(`[migrateChildrenPronouns] Updated ${name} with pronouns: ${pronouns}`);
      } catch (err: any) {
        errors.push(`Error migrating pronouns for child ${doc.id}: ${err.message}`);
      }
    }

    return {
      success: errors.length === 0,
      migratedCount,
      skippedCount,
      errors,
    };
  } catch (err: any) {
    return {
      success: false,
      migratedCount,
      skippedCount,
      errors: [`Fatal error during children pronouns migration: ${err.message}`],
    };
  }
}

export async function migrateCharactersPronouns(): Promise<{
  success: boolean;
  migratedCount: number;
  skippedCount: number;
  errors: string[];
}> {
  const errors: string[] = [];
  let migratedCount = 0;
  let skippedCount = 0;

  try {
    const firestore = await getServerFirestore();
    const charactersSnapshot = await firestore.collection('characters').get();

    for (const doc of charactersSnapshot.docs) {
      try {
        const data = doc.data();

        // Skip if pronouns already set
        if (data.pronouns) {
          skippedCount++;
          continue;
        }

        const name = data.displayName || '';
        const description = data.description || '';
        const type = data.type || data.role || '';

        // Infer pronouns using AI
        const pronouns = await inferPronouns(name, description, type);

        // Update the document
        await doc.ref.update({
          pronouns,
          updatedAt: FieldValue.serverTimestamp(),
        });

        migratedCount++;
        console.log(`[migrateCharactersPronouns] Updated ${name} with pronouns: ${pronouns}`);
      } catch (err: any) {
        errors.push(`Error migrating pronouns for character ${doc.id}: ${err.message}`);
      }
    }

    return {
      success: errors.length === 0,
      migratedCount,
      skippedCount,
      errors,
    };
  } catch (err: any) {
    return {
      success: false,
      migratedCount,
      skippedCount,
      errors: [`Fatal error during characters pronouns migration: ${err.message}`],
    };
  }
}

export async function migrateAllPronouns(): Promise<{
  success: boolean;
  childrenMigrated: number;
  childrenSkipped: number;
  charactersMigrated: number;
  charactersSkipped: number;
  errors: string[];
}> {
  const childrenResult = await migrateChildrenPronouns();
  const charactersResult = await migrateCharactersPronouns();

  return {
    success: childrenResult.success && charactersResult.success,
    childrenMigrated: childrenResult.migratedCount,
    childrenSkipped: childrenResult.skippedCount,
    charactersMigrated: charactersResult.migratedCount,
    charactersSkipped: charactersResult.skippedCount,
    errors: [...childrenResult.errors, ...charactersResult.errors],
  };
}
