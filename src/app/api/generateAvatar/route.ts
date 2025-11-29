
import { NextResponse } from 'next/server';
import { avatarFlow } from '@/ai/flows/avatar-flow';
import { requireParentOrAdminUser } from '@/lib/server-auth';
import { AuthError } from '@/lib/auth-error';

export async function POST(request: Request) {
  try {
    await requireParentOrAdminUser(request);
    const { childId, feedback } = await request.json();

    if (!childId) {
      return NextResponse.json({ ok: false, errorMessage: 'Missing childId' }, { status: 400 });
    }

    const result = await avatarFlow({ childId, feedback });
    
    return NextResponse.json({ ok: true, ...result }, { status: 200 });

  } catch (e: any) {
    if (e instanceof AuthError) {
      return NextResponse.json({ ok: false, errorMessage: e.message }, { status: e.status });
    }
    const errorMessage = e.message || 'An unexpected error occurred.';
    console.error('[api/generateAvatar] Error:', e);
    return NextResponse.json(
      { 
        ok: false, 
        errorMessage: `API /generateAvatar route error: ${errorMessage}` 
      }, 
      { status: 500 }
    );
  }
}
