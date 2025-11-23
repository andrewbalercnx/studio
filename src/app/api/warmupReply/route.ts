import { NextResponse } from 'next/server';
import { warmupReplyFlow } from '@/ai/flows/warmup-reply-flow';

export async function POST(request: Request) {
    try {
        const { sessionId } = await request.json();

        if (!sessionId) {
            return NextResponse.json({ error: 'sessionId is required' }, { status: 400 });
        }

        const result = await warmupReplyFlow.run({ sessionId });

        if (result.ok) {
            return NextResponse.json(result);
        } else {
            return NextResponse.json({ error: result.errorMessage }, { status: 500 });
        }

    } catch (e: any) {
        return NextResponse.json({ error: e.message || 'An unexpected error occurred.' }, { status: 500 });
    }
}
