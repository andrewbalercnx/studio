import { NextResponse } from 'next/server';
import { gemini4Flow } from '@/ai/flows/gemini4-flow';
import { gemini4CreateCharacterFlow } from '@/ai/flows/create-story-character-flow';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { sessionId, userMessage, selectedOptionId, action, characterData } = body;

    if (!sessionId) {
      return NextResponse.json({ ok: false, errorMessage: 'Missing sessionId' }, { status: 400 });
    }

    // Handle character creation action
    if (action === 'createCharacter' && characterData) {
      const result = await gemini4CreateCharacterFlow({
        sessionId,
        parentUid: characterData.parentUid,
        childId: characterData.childId,
        characterLabel: characterData.characterLabel,
        characterType: characterData.characterType,
        storyContext: characterData.storyContext,
        childAge: characterData.childAge,
        generateAvatar: characterData.generateAvatar ?? true,
      });

      if (result.ok) {
        return NextResponse.json(result, { status: 200 });
      } else {
        return NextResponse.json(
          { ok: false, errorMessage: result.errorMessage ?? 'Failed to create character' },
          { status: 500 }
        );
      }
    }

    // Main flow - continue story
    const result = await gemini4Flow({ sessionId, userMessage, selectedOptionId });

    if (result.ok) {
      return NextResponse.json(result, { status: 200 });
    } else {
      return NextResponse.json(
        {
          ok: false,
          errorMessage: result.errorMessage ?? 'Unknown error in gemini4Flow',
          debug: result.debug ?? null,
        },
        { status: 500 }
      );
    }
  } catch (e: any) {
    const errorMessage = e.message || 'An unexpected error occurred in the API route.';
    return NextResponse.json(
      {
        ok: false,
        errorMessage: `API /gemini4 route error: ${errorMessage}`,
      },
      { status: 500 }
    );
  }
}
