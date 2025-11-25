
import { NextResponse } from 'next/server';
import { storyCompileFlow } from '@/ai/flows/story-compile-flow';

export async function POST(request: Request) {
    try {
        const { sessionId } = await request.json();

        if (!sessionId) {
            return NextResponse.json({ ok: false, errorMessage: 'Missing sessionId' }, { status: 400 });
        }

        const result = await storyCompileFlow({ sessionId });

        if (result.ok) {
            return NextResponse.json(result, { status: 200 });
        } else {
            return NextResponse.json(
                {
                    ok: false,
                    errorMessage: result.errorMessage ?? 'Unknown error in storyCompileFlow',
                    debug: result.debug ?? null,
                },
                { status: 500 }
            );
        }

    } catch (e: any) {
        const errorMessage = e.message || 'An unexpected error occurred in the API route.';
        return NextResponse.json(
            { 
                ok: false, 
                errorMessage: `API /storyCompile route error: ${errorMessage}` 
            }, 
            { status: 500 }
        );
    }
}
