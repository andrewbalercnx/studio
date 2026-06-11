import { NextResponse } from 'next/server';
import { getServerFirestore } from '@/lib/server-firestore';
import type { StoryGenerator } from '@/lib/types';
import { presentGeneratorsForKids } from '@/lib/kids-generator-presentation';

/**
 * GET: Fetch story generators enabled for kids (public endpoint)
 *
 * Returns a user-safe presentation of generators from the storyGenerators
 * collection that are:
 * - status === 'live'
 * - enabledForKids === true
 *
 * Server-first presentation (see src/lib/kids-generator-presentation.ts):
 * - internal fields (prompts, model config, apiEndpoint) are stripped;
 * - model jargon is hidden from names/descriptions/loading messages;
 * - exactly one generator carries `recommended: true` so clients can show a
 *   "Recommended for first-timers" badge.
 *
 * Sorted by order (lower first), then by id.
 */
export async function GET() {
  try {
    const firestore = await getServerFirestore();
    const generatorsRef = firestore.collection('storyGenerators');

    // Query for live generators that are enabled for kids
    const snapshot = await generatorsRef
      .where('status', '==', 'live')
      .where('enabledForKids', '==', true)
      .get();

    const rawGenerators: StoryGenerator[] = [];
    snapshot.forEach((doc) => {
      rawGenerators.push({ ...doc.data(), id: doc.id } as StoryGenerator);
    });

    const generators = presentGeneratorsForKids(rawGenerators);

    return NextResponse.json({
      ok: true,
      generators,
    });

  } catch (error: any) {
    console.error('[kids-generators] GET Error:', error);
    return NextResponse.json(
      { ok: false, errorMessage: error?.message || 'Unexpected error', generators: [] },
      { status: 500 }
    );
  }
}
