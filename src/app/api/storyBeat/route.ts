import { NextResponse } from 'next/server';
import { storyBeatFlow } from '@/ai/flows/story-beat-flow';

export async function POST(request: Request) {
    try {
        const { sessionId } = await request.json();

        if (!sessionId) {
            return NextResponse.json({ ok: false, errorMessage: 'Missing sessionId' }, { status: 400 });
        }

        const result = await storyBeatFlow({ sessionId });

        if (result.ok) {
            return NextResponse.json(result, { status: 200 });
        } else {
            return NextResponse.json(result, { status: 500 });
        }

    } catch (e: any) {
        const errorMessage = e.message || 'An unexpected error occurred in the API route.';
        return NextResponse.json({ ok: false, errorMessage: `API /storyBeat route error: ${errorMessage}` }, { status: 500 });
    }
}
