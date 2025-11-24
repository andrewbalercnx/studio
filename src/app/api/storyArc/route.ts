
import { NextResponse } from 'next/server';
import { storyArcEngineFlow } from '@/ai/flows/story-arc-flow';

export async function POST(request: Request) {
    try {
        const body = await request.json();
        const { sessionId, storyTypeId, arcStepIndex, storySoFar, characterRoster, basicPlot } = body;

        // Basic validation
        if (!sessionId || !storyTypeId || typeof arcStepIndex !== 'number') {
            return NextResponse.json({ ok: false, errorMessage: 'Missing required fields: sessionId, storyTypeId, arcStepIndex' }, { status: 400 });
        }

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
        console.error('Error in /api/storyArc:', e);
        return NextResponse.json(
            { 
                ok: false, 
                errorMessage: `API /storyArc route error: ${e.message || 'An unexpected error occurred.'}` 
            }, 
            { status: 500 }
        );
    }
}
