import { NextResponse } from 'next/server';
import { storyActorAvatarFlow } from '@/ai/flows/story-actor-avatar-flow';
import { requireParentOrAdminUser } from '@/lib/server-auth';
import { AuthError } from '@/lib/auth-error';

type ActorAvatarJobRequest = {
  storyId: string;
  forceRegenerate?: boolean;
};

/**
 * API route for generating a composite actor avatar for a story.
 * Creates a group illustration featuring all characters in the story.
 *
 * This runs as a fire-and-forget background task - the API returns immediately
 * with status 'generating', and the client should poll the story document for completion.
 * The story.actorAvatarGeneration.status field tracks: 'generating' -> 'ready' | 'error'
 */
export async function POST(request: Request) {
  try {
    await requireParentOrAdminUser(request);

    const body = (await request.json()) as ActorAvatarJobRequest;
    const { storyId, forceRegenerate = false } = body;

    if (!storyId || typeof storyId !== 'string') {
      return NextResponse.json(
        { ok: false, errorMessage: 'Missing storyId' },
        { status: 400 }
      );
    }

    // Fire-and-forget: Start actor avatar generation in background
    // Don't await - let it run while we return immediately
    // The flow updates story.actorAvatarGeneration.status as it progresses
    storyActorAvatarFlow({
      storyId,
      forceRegenerate,
    }).then(result => {
      if (!result.ok) {
        console.error(`[api/storyBook/actorAvatar] Background generation failed for ${storyId}:`, result.errorMessage);
      } else {
        console.log(`[api/storyBook/actorAvatar] Background generation completed for ${storyId}`);
      }
    }).catch(err => {
      console.error(`[api/storyBook/actorAvatar] Background generation error for ${storyId}:`, err);
    });

    // Return immediately - client should poll story document for status
    return NextResponse.json({
      ok: true,
      status: 'generating',
      message: 'Actor avatar generation started. Poll story document for completion.',
    });
  } catch (e: any) {
    if (e instanceof AuthError) {
      return NextResponse.json(
        { ok: false, errorMessage: e.message },
        { status: e.status }
      );
    }

    const errorMessage = e.message || 'An unexpected error occurred.';
    console.error('[api/storyBook/actorAvatar] Error:', e);

    return NextResponse.json(
      {
        ok: false,
        errorMessage: `API /storyBook/actorAvatar route error: ${errorMessage}`,
      },
      { status: 500 }
    );
  }
}
