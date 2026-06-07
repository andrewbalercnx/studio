
import { NextResponse } from 'next/server';
import { endingFlow } from '@/ai/flows/ending-flow';
import { toUserSafeMessage } from '@/lib/ai-error-map';

export async function POST(request: Request) {
    try {
        const { sessionId } = await request.json();

        if (!sessionId) {
            return NextResponse.json({ ok: false, errorMessage: 'Missing sessionId' }, { status: 400 });
        }

        const result = await endingFlow({ sessionId });

        if (result.ok) {
            return NextResponse.json(result, { status: 200 });
        } else {
            return NextResponse.json(
                {
                    ok: false,
                    errorMessage: result.errorMessage ?? 'Unknown error in endingFlow',
                    debug: result.debug ?? null,
                },
                { status: 500 }
            );
        }

    } catch (e: any) {
        console.error('[api/storyEnding] Error:', e);
        return NextResponse.json(
            {
                ok: false,
                errorMessage: toUserSafeMessage(e),
            },
            { status: 500 }
        );
    }
}
