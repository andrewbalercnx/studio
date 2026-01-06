import { NextResponse } from 'next/server';
import { getServerFirestore } from '@/lib/server-firestore';
import type { StoryGenerator } from '@/lib/types';

/**
 * GET: Fetch story generators enabled for kids (public endpoint)
 *
 * Returns generators from the storyGenerators collection that are:
 * - status === 'live'
 * - enabledForKids === true
 *
 * Sorted by order (lower first), then by name.
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

    const generators: StoryGenerator[] = [];
    snapshot.forEach((doc) => {
      generators.push({ ...doc.data(), id: doc.id } as StoryGenerator);
    });

    // Sort by order field (lower first), then alphabetically by name
    generators.sort((a, b) => {
      const orderA = a.order ?? 0;
      const orderB = b.order ?? 0;
      if (orderA !== orderB) return orderA - orderB;
      return (a.name || a.id).localeCompare(b.name || b.id);
    });

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
