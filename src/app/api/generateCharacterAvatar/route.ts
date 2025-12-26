
import { NextResponse } from 'next/server';
import { characterAvatarFlow } from '@/ai/flows/character-avatar-flow';
import { requireParentOrAdminUser } from '@/lib/server-auth';
import { AuthError } from '@/lib/auth-error';

export async function POST(request: Request) {
  try {
    await requireParentOrAdminUser(request);
    const { characterId, feedback } = await request.json();

    if (!characterId) {
      return NextResponse.json({ ok: false, errorMessage: 'Missing characterId' }, { status: 400 });
    }

    const result = await characterAvatarFlow({ characterId, feedback });

    return NextResponse.json({ ok: true, ...result }, { status: 200 });

  } catch (e: any) {
    if (e instanceof AuthError) {
      return NextResponse.json({ ok: false, errorMessage: e.message }, { status: e.status });
    }
    const errorMessage = e.message || 'An unexpected error occurred.';
    console.error('[api/generateCharacterAvatar] Error:', e);
    return NextResponse.json(
      {
        ok: false,
        errorMessage: `API /generateCharacterAvatar route error: ${errorMessage}`
      },
      { status: 500 }
    );
  }
}
