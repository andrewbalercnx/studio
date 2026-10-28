
import { NextResponse } from 'next/server';
import { storyArcEngineFlow } from '@/ai/flows/story-arc-flow';
import { toUserSafeMessage } from '@/lib/ai-error-map';
import { requireSessionOwner, routeAuthErrorResponse } from '@/lib/route-auth.server';

export async function POST(request: Request) {
    try {
        const body = await request.json();
        const { sessionId, storyTypeId, arcStepIndex, storySoFar, characterRoster, basicPlot } = body;

        // Basic validation
        if (!sessionId || !storyTypeId || typeof arcStepIndex !== 'number') {
            return NextResponse.json({ ok: false, errorMessage: 'Missing required fields: sessionId, storyTypeId, arcStepIndex' }, { status: 400 });
        }

        await requireSessionOwner(request, sessionId);

        const result = await storyArcEngineFlow({
            sessionId,
            storyTypeId,
            arcStepIndex,
            storySoFar,
            characterRoster,
            basicPlot
        });

        return NextResponse.json({ ok: true, ...result }, { status: 200 });

    } catch (e: any) {
        const authResponse = routeAuthErrorResponse(e);
        if (authResponse) return authResponse;
        console.error('Error in /api/storyArc:', e);
        return NextResponse.json(
            {
                ok: false,
                errorMessage: toUserSafeMessage(e),
            },
            { status: 500 }
        );
    }
}
