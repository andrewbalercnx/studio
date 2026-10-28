
import { NextResponse } from 'next/server';
import { avatarFlow } from '@/ai/flows/avatar-flow';
import { requireParentOrAdminUser } from '@/lib/server-auth';
import { AuthError } from '@/lib/auth-error';
import { assertChildOwner, routeAuthErrorResponse } from '@/lib/route-auth.server';
import { toUserSafeMessage } from '@/lib/ai-error-map';

export async function POST(request: Request) {
  try {
    const user = await requireParentOrAdminUser(request);
    const { childId, feedback } = await request.json();

    if (!childId) {
      return NextResponse.json({ ok: false, errorMessage: 'Missing childId' }, { status: 400 });
    }

    await assertChildOwner(user, childId);

    const result = await avatarFlow({ childId, feedback });
    
    return NextResponse.json({ ok: true, ...result }, { status: 200 });

  } catch (e: any) {
    const ownershipResponse = routeAuthErrorResponse(e);
    if (ownershipResponse) return ownershipResponse;
    if (e instanceof AuthError) {
      return NextResponse.json({ ok: false, errorMessage: e.message }, { status: e.status });
    }
    // Raw error stays in server logs; the response message must be user-safe.
    console.error('[api/generateAvatar] Error:', e);
    return NextResponse.json(
      {
        ok: false,
        errorMessage: toUserSafeMessage(e),
      },
      { status: 500 }
    );
  }
}
