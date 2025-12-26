import { NextResponse } from 'next/server';
import { createStoryCharacterFlow } from '@/ai/flows/create-story-character-flow';

/**
 * POST /api/characters/create
 *
 * Unified API endpoint for creating story characters.
 * Used by all story flows (Story Beat, Gemini 3, Gemini 4) to ensure
 * consistent character creation with proper pronouns, description, likes, and dislikes.
 */
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const {
      sessionId,
      parentUid,
      childId,
      characterLabel,
      characterName,
      characterType,
      storyContext,
      childAge,
      generateAvatar,
    } = body;

    // Validate required fields
    if (!sessionId) {
      return NextResponse.json({ ok: false, errorMessage: 'Missing sessionId' }, { status: 400 });
    }
    if (!parentUid) {
      return NextResponse.json({ ok: false, errorMessage: 'Missing parentUid' }, { status: 400 });
    }
    if (!childId) {
      return NextResponse.json({ ok: false, errorMessage: 'Missing childId' }, { status: 400 });
    }
    if (!characterLabel) {
      return NextResponse.json({ ok: false, errorMessage: 'Missing characterLabel' }, { status: 400 });
    }
    if (!characterType) {
      return NextResponse.json({ ok: false, errorMessage: 'Missing characterType' }, { status: 400 });
    }

    // Validate characterType is one of the allowed values
    const validTypes = ['Family', 'Friend', 'Pet', 'Toy', 'Other'];
    if (!validTypes.includes(characterType)) {
      return NextResponse.json(
        { ok: false, errorMessage: `Invalid characterType. Must be one of: ${validTypes.join(', ')}` },
        { status: 400 }
      );
    }

    // Call the unified character creation flow
    const result = await createStoryCharacterFlow({
      sessionId,
      parentUid,
      childId,
      characterLabel,
      characterName,
      characterType,
      storyContext: storyContext || '',
      childAge: childAge ?? null,
      generateAvatar: generateAvatar ?? false,
    });

    if (result.ok) {
      return NextResponse.json(result, { status: 200 });
    } else {
      return NextResponse.json(
        { ok: false, errorMessage: result.errorMessage ?? 'Failed to create character' },
        { status: 500 }
      );
    }
  } catch (e: any) {
    const errorMessage = e.message || 'An unexpected error occurred';
    console.error('[/api/characters/create] Error:', errorMessage);
    return NextResponse.json(
      { ok: false, errorMessage: `API error: ${errorMessage}` },
      { status: 500 }
    );
  }
}
