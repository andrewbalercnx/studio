
import { NextResponse } from 'next/server';
import { characterAvatarFlow } from '@/ai/flows/character-avatar-flow';
import { requireParentOrAdminUser } from '@/lib/server-auth';
import { AuthError } from '@/lib/auth-error';
import { toUserSafeMessage } from '@/lib/ai-error-map';

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
    // Raw error stays in server logs; the response message must be user-safe.
    console.error('[api/generateCharacterAvatar] Error:', e);
    return NextResponse.json(
      {
        ok: false,
        errorMessage: toUserSafeMessage(e),
      },
      { status: 500 }
    );
  }
}
