import { NextResponse } from 'next/server';
import { initFirebaseAdminApp } from '@/firebase/admin/app';
import { requireParentOrAdminUser } from '@/lib/server-auth';
import { imageStyleSampleFlow } from '@/ai/flows/image-style-sample-flow';

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

        const { imageStyleId } = await request.json();

        if (!imageStyleId) {
            return NextResponse.json({ ok: false, errorMessage: 'Missing imageStyleId' }, { status: 400 });
        }

        const result = await imageStyleSampleFlow({ imageStyleId });

        if (result.ok) {
            return NextResponse.json(result, { status: 200 });
        } else {
            return NextResponse.json(
                {
                    ok: false,
                    errorMessage: result.errorMessage ?? 'Unknown error in imageStyleSampleFlow',
                },
                { status: 500 }
            );
        }

    } catch (e: any) {
        const errorMessage = e.message || 'An unexpected error occurred in the API route.';
        return NextResponse.json(
            {
                ok: false,
                errorMessage: `API /imageStyles/generateSample route error: ${errorMessage}`
            },
            { status: 500 }
        );
    }
}
