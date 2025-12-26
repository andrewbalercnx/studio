import { NextResponse } from 'next/server';
import { storyPageAudioFlow } from '@/ai/flows/story-page-audio-flow';
import { requireParentOrAdminUser } from '@/lib/server-auth';
import { AuthError } from '@/lib/auth-error';

type PageAudioJobRequest = {
  storyId: string;
  storybookId?: string; // If provided, use new model path: stories/{storyId}/storybooks/{storybookId}/pages
  pageId?: string; // If provided, only generate audio for this specific page
  forceRegenerate?: boolean;
  voiceConfig?: {
    voiceName?: string;
  };
};

/**
 * API route for generating audio narration for storybook pages.
 * Uses Gemini Pro TTS to create child-friendly audio with British English accent.
 *
 * This runs as a fire-and-forget background task - the API returns immediately
 * with status 'generating', and the client should poll the page documents for completion.
 * Each page's audioStatus field tracks: 'generating' -> 'ready' | 'error'
 */
export async function POST(request: Request) {
  try {
    await requireParentOrAdminUser(request);

    const body = (await request.json()) as PageAudioJobRequest;
    const { storyId, storybookId, pageId, forceRegenerate = false, voiceConfig } = body;

    if (!storyId || typeof storyId !== 'string') {
      return NextResponse.json(
        { ok: false, errorMessage: 'Missing storyId' },
        { status: 400 }
      );
    }

    // Fire-and-forget: Start audio generation in background
    // Use setImmediate/setTimeout to ensure the response is sent first, then run the flow
    console.log(`[api/storyBook/pageAudio] Starting background audio generation for storyId: ${storyId}, storybookId: ${storybookId || 'none (legacy)'}, pageId: ${pageId || 'all'}`);

    // Run synchronously but don't block the response - Next.js will keep the function alive
    (async () => {
      try {
        console.log(`[api/storyBook/pageAudio] Background task starting for ${storyId}`);
        const result = await storyPageAudioFlow({
          storyId,
          storybookId,
          pageId,
          forceRegenerate,
          voiceConfig,
        });
        if (!result.ok) {
          console.error(`[api/storyBook/pageAudio] Background generation failed for ${storyId}:`, result.errorMessage);
        } else {
          console.log(`[api/storyBook/pageAudio] Background generation completed for ${storyId}: ${result.pagesProcessed} pages processed, ${result.pagesSkipped} skipped`);
        }
      } catch (err) {
        console.error(`[api/storyBook/pageAudio] Background generation error for ${storyId}:`, err);
      }
    })();

    // Return immediately - client should poll page documents for status
    return NextResponse.json({
      ok: true,
      status: 'generating',
      message: pageId
        ? `Audio generation started for page ${pageId}. Poll page document for completion.`
        : 'Audio generation started for all pages. Poll page documents for completion.',
    });
  } catch (e: any) {
    if (e instanceof AuthError) {
      return NextResponse.json(
        { ok: false, errorMessage: e.message },
        { status: e.status }
      );
    }

    const errorMessage = e.message || 'An unexpected error occurred.';
    console.error('[api/storyBook/pageAudio] Error:', e);

    return NextResponse.json(
      {
        ok: false,
        errorMessage: `API /storyBook/pageAudio route error: ${errorMessage}`,
      },
      { status: 500 }
    );
  }
}
