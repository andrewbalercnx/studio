import { NextResponse } from 'next/server';
import { initFirebaseAdminApp } from '@/firebase/admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { requireParentOrAdminUser } from '@/lib/server-auth';
import { AuthError } from '@/lib/auth-error';
import type { StoryGenerator } from '@/lib/types';

/**
 * Default story generator configurations.
 * These define the capabilities and styling for each story generation mode.
 */
const defaultGenerators: Omit<StoryGenerator, 'createdAt' | 'updatedAt'>[] = [
  {
    id: 'wizard',
    name: 'Story Wizard',
    description: 'A 4-question wizard that gathers story preferences before generating a complete story.',
    status: 'live',
    capabilities: {
      minChoices: 2,
      maxChoices: 4,
      supportsMoreOptions: false,
      supportsCharacterIntroduction: false,
      supportsFinalStory: true,
      requiresStoryType: false,
    },
    apiEndpoint: '/api/storyWizard',
    styling: {
      gradient: 'from-purple-50 to-pink-50',
      darkGradient: 'dark:from-purple-950 dark:to-pink-950',
      icon: 'Sparkles',
      loadingMessage: 'The wizard is creating your adventure...',
    },
  },
  {
    id: 'gemini3',
    name: 'Gemini Free',
    description: 'Open-ended creative story generation with full AI freedom.',
    status: 'live',
    capabilities: {
      minChoices: 2,
      maxChoices: 4,
      supportsMoreOptions: false,
      supportsCharacterIntroduction: true,
      supportsFinalStory: true,
      requiresStoryType: false,
    },
    apiEndpoint: '/api/gemini3',
    styling: {
      gradient: 'from-blue-50 to-cyan-50',
      darkGradient: 'dark:from-blue-950 dark:to-cyan-950',
      icon: 'Sparkles',
      loadingMessage: 'Gemini is crafting your story...',
    },
  },
  {
    id: 'gemini4',
    name: 'Guided Story',
    description: 'Structured story generation with story type selection and guided progression.',
    status: 'live',
    capabilities: {
      minChoices: 2,
      maxChoices: 4,
      supportsMoreOptions: true,
      supportsCharacterIntroduction: true,
      supportsFinalStory: true,
      requiresStoryType: true,
    },
    apiEndpoint: '/api/gemini4',
    styling: {
      gradient: 'from-emerald-50 to-teal-50',
      darkGradient: 'dark:from-emerald-950 dark:to-teal-950',
      icon: 'Sparkles',
      loadingMessage: 'Creating the next chapter...',
    },
  },
  {
    id: 'beat',
    name: 'Story Beats',
    description: 'Turn-by-turn story generation with structured narrative beats and arcs.',
    status: 'live',
    capabilities: {
      minChoices: 2,
      maxChoices: 4,
      supportsMoreOptions: true,
      supportsCharacterIntroduction: true,
      supportsFinalStory: false,
      requiresStoryType: true,
    },
    apiEndpoint: '/api/storyBeat',
    styling: {
      gradient: 'from-indigo-50 to-violet-50',
      darkGradient: 'dark:from-indigo-950 dark:to-violet-950',
      icon: 'Sparkles',
      loadingMessage: 'Creating the next story beat...',
    },
  },
];

/**
 * Seeds the storyGenerators collection with default configurations.
 * Admin-only endpoint.
 */
export async function POST(request: Request) {
  try {
    await initFirebaseAdminApp();
    const user = await requireParentOrAdminUser(request);

    if (!user.claims.isAdmin) {
      return NextResponse.json(
        { ok: false, errorMessage: 'Admin access required' },
        { status: 403 }
      );
    }

    const firestore = getFirestore();
    const batch = firestore.batch();
    const results: { id: string; action: 'created' | 'updated' }[] = [];

    for (const generator of defaultGenerators) {
      const docRef = firestore.collection('storyGenerators').doc(generator.id);
      const existingDoc = await docRef.get();

      if (existingDoc.exists) {
        // Update existing document (preserve createdAt)
        batch.update(docRef, {
          ...generator,
          updatedAt: FieldValue.serverTimestamp(),
        });
        results.push({ id: generator.id, action: 'updated' });
      } else {
        // Create new document
        batch.set(docRef, {
          ...generator,
          createdAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        });
        results.push({ id: generator.id, action: 'created' });
      }
    }

    await batch.commit();

    return NextResponse.json({
      ok: true,
      message: `Seeded ${results.length} story generators`,
      results,
    });

  } catch (error: any) {
    if (error instanceof AuthError) {
      return NextResponse.json(
        { ok: false, errorMessage: error.message },
        { status: error.status }
      );
    }

    console.error('[admin/story-generators/seed] Error:', error);
    return NextResponse.json(
      { ok: false, errorMessage: error?.message || 'Unexpected error' },
      { status: 500 }
    );
  }
}
