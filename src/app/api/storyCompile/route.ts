
import { NextResponse } from 'next/server';
import { storyCompileFlow } from '@/ai/flows/story-compile-flow';
import { storyAudioFlow } from '@/ai/flows/story-audio-flow';
import { storyTitleFlow } from '@/ai/flows/story-title-flow';
import { storyActorAvatarFlow } from '@/ai/flows/story-actor-avatar-flow';

export async function POST(request: Request) {
    try {
        const { sessionId, storyOutputTypeId } = await request.json();

        if (!sessionId) {
            return NextResponse.json({ ok: false, errorMessage: 'Missing sessionId' }, { status: 400 });
        }
        // storyOutputTypeId is now optional - story can be compiled without it
        // and storyOutputType can be selected later when creating a storybook

        const result = await storyCompileFlow({ sessionId, storyOutputTypeId });

        if (result.ok && result.storyId) {
            // Trigger background generation tasks in parallel:
            // - storyCompileFlow already generated: storyText + synopsis
            // - Now run in parallel: storyTitleFlow + storyActorAvatarFlow + storyAudioFlow
            // Note: storyTitleFlow now reads the already-generated synopsis

            const storyId = result.storyId;

            // Audio narration (independent)
            storyAudioFlow({ storyId }).catch((err) => {
                console.error('[storyCompile] Background audio generation failed:', err);
            });

            // Composite actor avatar (independent)
            storyActorAvatarFlow({ storyId }).catch((err) => {
                console.error('[storyCompile] Background actor avatar generation failed:', err);
            });

            // Title generation (reads existing synopsis from compile)
            storyTitleFlow({ storyId }).catch((err) => {
                console.error('[storyCompile] Background title generation failed:', err);
            });

            return NextResponse.json(result, { status: 200 });
        } else if (result.ok) {
            // No storyId returned (shouldn't happen, but handle gracefully)
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
