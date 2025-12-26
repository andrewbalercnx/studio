
import { NextResponse } from 'next/server';
import { avatarAnimationFlow } from '@/ai/flows/avatar-animation-flow';
import { requireParentOrAdminUser } from '@/lib/server-auth';
import { AuthError } from '@/lib/auth-error';

export async function POST(request: Request) {
  try {
    await requireParentOrAdminUser(request);
    const { childId, characterId, forceRegenerate } = await request.json();

    if (!childId && !characterId) {
      return NextResponse.json({ ok: false, errorMessage: 'Missing childId or characterId' }, { status: 400 });
    }

    console.log('[api/generateAvatar/animation] Starting animation generation:', { childId, characterId, forceRegenerate });

    const result = await avatarAnimationFlow({ childId, characterId, forceRegenerate });

    console.log('[api/generateAvatar/animation] Animation generation result:', result);

    return NextResponse.json({
      ok: result.ok,
      animationUrl: result.animationUrl,
      errorMessage: result.errorMessage,
      debugInfo: result.debugInfo,
    }, { status: result.ok ? 200 : 500 });

  } catch (e: any) {
    if (e instanceof AuthError) {
      return NextResponse.json({ ok: false, errorMessage: e.message }, { status: e.status });
    }
    const errorMessage = e.message || 'An unexpected error occurred.';
    console.error('[api/generateAvatar/animation] Error:', e);
    return NextResponse.json(
      {
        ok: false,
        errorMessage: `API /generateAvatar/animation route error: ${errorMessage}`
      },
      { status: 500 }
    );
  }
}
