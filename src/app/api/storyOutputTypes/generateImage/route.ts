import { NextResponse } from 'next/server';
import { initFirebaseAdminApp } from '@/firebase/admin/app';
import { requireParentOrAdminUser } from '@/lib/server-auth';
import { storyOutputTypeImageFlow } from '@/ai/flows/story-output-type-image-flow';

export async function POST(request: Request) {
    try {
        await initFirebaseAdminApp();
        const user = await requireParentOrAdminUser(request);

        if (!user.claims.isAdmin) {
            return NextResponse.json(
                { ok: false, errorMessage: 'Admin access required' },
                { status: 403 }
            );
        }

        const { storyOutputTypeId } = await request.json();

        if (!storyOutputTypeId) {
            return NextResponse.json({ ok: false, errorMessage: 'Missing storyOutputTypeId' }, { status: 400 });
        }

        const result = await storyOutputTypeImageFlow({ storyOutputTypeId });

        if (result.ok) {
            return NextResponse.json(result, { status: 200 });
        } else {
            return NextResponse.json(
                {
                    ok: false,
                    errorMessage: result.errorMessage ?? 'Unknown error in storyOutputTypeImageFlow',
                },
                { status: 500 }
            );
        }

    } catch (e: any) {
        const errorMessage = e.message || 'An unexpected error occurred in the API route.';
        return NextResponse.json(
            {
                ok: false,
                errorMessage: `API /storyOutputTypes/generateImage route error: ${errorMessage}`
            },
            { status: 500 }
        );
    }
}
