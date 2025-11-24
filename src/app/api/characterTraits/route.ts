
import { NextResponse } from 'next/server';
import { characterTraitsFlow } from '@/ai/flows/character-traits-flow';

export async function POST(request: Request) {
    try {
        const { sessionId, characterId } = await request.json();

        if (!sessionId || !characterId) {
            return NextResponse.json({ ok: false, errorMessage: 'Missing sessionId or characterId' }, { status: 400 });
        }

        const result = await characterTraitsFlow({ sessionId, characterId });

        if (result.ok) {
            return NextResponse.json(result, { status: 200 });
        } else {
            return NextResponse.json(result, { status: 500 });
        }

    } catch (e: any) {
        const errorMessage = e.message || 'An unexpected error occurred in the API route.';
        return NextResponse.json({ ok: false, errorMessage: `API /characterTraits route error: ${errorMessage}` }, { status: 500 });
    }
}
