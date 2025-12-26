import { NextResponse } from 'next/server';
import { storyAudioFlow } from '@/ai/flows/story-audio-flow';
import { requireParentOrAdminUser } from '@/lib/server-auth';
import { AuthError } from '@/lib/auth-error';

type AudioJobRequest = {
  storyId: string;
  forceRegenerate?: boolean;
  voiceConfig?: {
    voiceName?: string;
  };
};

/**
 * API route for generating audio narration for a story.
 * Uses Gemini Pro TTS to create child-friendly audio with British English accent.
 *
 * This runs as a fire-and-forget background task - the API returns immediately
 * with status 'generating', and the client should poll the story document for completion.
 * The story.audioGeneration.status field tracks: 'generating' -> 'ready' | 'error'
 */
export async function POST(request: Request) {
  try {
    await requireParentOrAdminUser(request);

    const body = (await request.json()) as AudioJobRequest;
    const { storyId, forceRegenerate = false, voiceConfig } = body;

    if (!storyId || typeof storyId !== 'string') {
      return NextResponse.json(
        { ok: false, errorMessage: 'Missing storyId' },
        { status: 400 }
      );
    }

    // Fire-and-forget: Start audio generation in background
    // Don't await - let it run while we return immediately
    // The flow updates story.audioGeneration.status as it progresses
    storyAudioFlow({
      storyId,
      forceRegenerate,
      voiceConfig,
    }).then(result => {
      if (!result.ok) {
        console.error(`[api/storyBook/audio] Background generation failed for ${storyId}:`, result.errorMessage);
      } else {
        console.log(`[api/storyBook/audio] Background generation completed for ${storyId}`);
      }
    }).catch(err => {
      console.error(`[api/storyBook/audio] Background generation error for ${storyId}:`, err);
    });

    // Return immediately - client should poll story document for status
    return NextResponse.json({
      ok: true,
      status: 'generating',
      message: 'Audio generation started. Poll story document for completion.',
    });
  } catch (e: any) {
    if (e instanceof AuthError) {
      return NextResponse.json(
        { ok: false, errorMessage: e.message },
        { status: e.status }
      );
    }

    const errorMessage = e.message || 'An unexpected error occurred.';
    console.error('[api/storyBook/audio] Error:', e);

    return NextResponse.json(
      {
        ok: false,
        errorMessage: `API /storyBook/audio route error: ${errorMessage}`,
      },
      { status: 500 }
    );
  }
}
