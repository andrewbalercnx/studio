import { NextResponse } from 'next/server';
import { warmupReplyFlow } from '@/ai/flows/warmup-reply-flow';

export async function POST(request: Request) {
    try {
        const { sessionId } = await request.json();

        if (!sessionId) {
            return NextResponse.json({ ok: false, errorMessage: 'sessionId is required' }, { status: 400 });
        }

        const result = await warmupReplyFlow({ sessionId });

        if (result.ok) {
            return NextResponse.json(result);
        } else {
            // Pass through the detailed error message from the flow
            return NextResponse.json({
                ok: false,
                errorMessage: result.errorMessage || 'An unknown flow error occurred.',
                usedPromptConfigId: result.usedPromptConfigId || null,
                debug: result.debug || null, // Pass debug info
             }, { status: 500 });
        }

    } catch (e: any) {
        const errorMessage = e.message || 'An unexpected error occurred in the API route.';
        // This catches errors in the route handler itself (e.g., JSON parsing)
        return NextResponse.json({ ok: false, errorMessage: `API /warmupReply route error: ${errorMessage}` }, { status: 500 });
    }
}

    