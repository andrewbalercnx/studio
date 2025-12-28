import { NextResponse } from 'next/server';
import { gemini4Flow } from '@/ai/flows/gemini4-flow';
import { gemini4CreateCharacterFlow } from '@/ai/flows/create-story-character-flow';
import { createLogger, generateRequestId, createTimeoutController } from '@/lib/server-logger';

// Request timeout for AI flows (2 minutes)
const AI_FLOW_TIMEOUT_MS = 120000;

export async function POST(request: Request) {
  const requestId = generateRequestId();
  const logger = createLogger({ route: '/api/gemini4', method: 'POST', requestId });

  try {
    const body = await request.json();
    const { sessionId, userMessage, selectedOptionId, action, characterData } = body;
    logger.info('Request received', { sessionId, action: action ?? 'continueStory' });

    if (!sessionId) {
      logger.warn('Missing sessionId in request');
      return NextResponse.json({ ok: false, errorMessage: 'Missing sessionId' }, { status: 400 });
    }

    // Create abort controller for timeout
    // Note: Genkit flows don't currently accept abort signals, so this provides
    // logging and cleanup but won't interrupt a running flow.
    const { controller, cleanup } = createTimeoutController(
      AI_FLOW_TIMEOUT_MS,
      logger,
      'gemini4Flow'
    );

    try {
      const startTime = Date.now();

      // Handle character creation action
      if (action === 'createCharacter' && characterData) {
        logger.info('Starting character creation flow', { sessionId, characterType: characterData.characterType });
        // TODO: Pass controller.signal to flow when Genkit supports abort signals
        const result = await gemini4CreateCharacterFlow({
          sessionId,
          parentUid: characterData.parentUid,
          childId: characterData.childId,
          characterLabel: characterData.characterLabel,
          characterType: characterData.characterType,
          storyContext: characterData.storyContext,
          childAge: characterData.childAge,
          generateAvatar: characterData.generateAvatar ?? true,
        });

        const durationMs = Date.now() - startTime;

        if (controller.signal.aborted) {
          logger.warn('Character creation completed after timeout was triggered', { sessionId, durationMs });
        }

        if (result.ok) {
          logger.info('Character creation completed successfully', { sessionId, durationMs });
          return NextResponse.json(result, { status: 200 });
        } else {
          logger.error('Character creation failed', new Error(result.errorMessage ?? 'Failed to create character'), { sessionId, durationMs });
          return NextResponse.json(
            { ok: false, errorMessage: result.errorMessage ?? 'Failed to create character' },
            { status: 500 }
          );
        }
      }

      // Main flow - continue story
      logger.info('Starting gemini4Flow', { sessionId, hasUserMessage: !!userMessage, hasSelectedOptionId: !!selectedOptionId });
      // TODO: Pass controller.signal to flow when Genkit supports abort signals
      const result = await gemini4Flow({ sessionId, userMessage, selectedOptionId });
      const durationMs = Date.now() - startTime;

      if (controller.signal.aborted) {
        logger.warn('Flow completed after timeout was triggered', { sessionId, durationMs });
      }

      if (result.ok) {
        logger.info('gemini4Flow completed successfully', { sessionId, durationMs });
        return NextResponse.json(result, { status: 200 });
      } else {
        logger.error('gemini4Flow returned error', new Error(result.errorMessage ?? 'Unknown error'), { sessionId, durationMs });
        return NextResponse.json(
          {
            ok: false,
            errorMessage: result.errorMessage ?? 'Unknown error in gemini4Flow',
            debug: result.debug ?? null,
          },
          { status: 500 }
        );
      }
    } finally {
      cleanup();
    }
  } catch (e: any) {
    const errorMessage = e.message || 'An unexpected error occurred in the API route.';
    logger.error('Unhandled exception in route', e);
    return NextResponse.json(
      {
        ok: false,
        errorMessage: `API /gemini4 route error: ${errorMessage}`,
        requestId,
      },
      { status: 500 }
    );
  }
}
