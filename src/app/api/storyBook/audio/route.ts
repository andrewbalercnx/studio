import { NextResponse } from 'next/server';
import { after } from 'next/server';
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
 * Uses ElevenLabs TTS to create child-friendly audio narration.
 *
 * This uses Next.js `after()` to run audio generation after the response is sent,
 * ensuring the serverless function stays alive until the work completes.
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

    // Use Next.js after() to run audio generation after response is sent
    // This keeps the serverless function alive until the work completes
    after(async () => {
      console.log(`[api/storyBook/audio] Starting background audio generation for ${storyId}`);
      try {
        const result = await storyAudioFlow({
          storyId,
          forceRegenerate,
          voiceConfig,
        });
        if (!result.ok) {
          console.error(`[api/storyBook/audio] Background generation failed for ${storyId}:`, result.errorMessage);
        } else {
          console.log(`[api/storyBook/audio] Background generation completed for ${storyId}`);
        }
      } catch (err) {
        console.error(`[api/storyBook/audio] Background generation error for ${storyId}:`, err);
      }
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
