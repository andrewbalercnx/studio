import { NextResponse } from 'next/server';
import { warmupReplyFlow } from '@/ai/flows/warmup-reply-flow';

export async function POST(request: Request) {
    try {
        const { sessionId } = await request.json();

        if (!sessionId) {
            return NextResponse.json({ ok: false, errorMessage: 'sessionId is required' }, { status: 400 });
        }

        const result = await warmupReplyFlow.run({ sessionId });

        if (result.ok) {
            return NextResponse.json(result);
        } else {
            return NextResponse.json({ ok: false, errorMessage: result.errorMessage || 'An unknown flow error occurred.' }, { status: 500 });
        }

    } catch (e: any) {
        return NextResponse.json({ ok: false, errorMessage: e.message || 'An unexpected error occurred.' }, { status: 500 });
    }
}
