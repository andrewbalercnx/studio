import { NextResponse } from 'next/server';
import { gemini3Flow } from '@/ai/flows/gemini3-flow';
import { createLogger, generateRequestId, createTimeoutController } from '@/lib/server-logger';
import type { StoryGeneratorResponse, StoryGeneratorResponseOption } from '@/lib/types';

// Request timeout for AI flows (2 minutes)
const AI_FLOW_TIMEOUT_MS = 120000;

/**
 * Gemini3 Story API endpoint.
 *
 * This API wraps the gemini3Flow and normalizes its output to the
 * standard StoryGeneratorResponse format for StoryBrowser compatibility.
 */
export async function POST(request: Request) {
    const requestId = generateRequestId();
    const logger = createLogger({ route: '/api/gemini3', method: 'POST', requestId });

    try {
        const { sessionId } = await request.json();
        logger.info('Request received', { sessionId });

        if (!sessionId) {
            logger.warn('Missing sessionId in request');
            const errorResponse: StoryGeneratorResponse = {
                ok: false,
                sessionId: '',
                question: '',
                options: [],
                errorMessage: 'Missing sessionId',
            };
            return NextResponse.json(errorResponse, { status: 400 });
        }

        // Create abort controller for timeout
        // Note: Genkit flows don't currently accept abort signals, so this provides
        // logging and cleanup but won't interrupt a running flow. The flow will
        // continue to completion even after timeout is logged.
        const { controller, cleanup } = createTimeoutController(
            AI_FLOW_TIMEOUT_MS,
            logger,
            'gemini3Flow'
        );

        try {
            const startTime = Date.now();
            // TODO: Pass controller.signal to flow when Genkit supports abort signals
            const result = await gemini3Flow({ sessionId });
            const durationMs = Date.now() - startTime;

            // Check if we timed out while waiting
            if (controller.signal.aborted) {
                logger.warn('Flow completed after timeout was triggered', { sessionId, durationMs });
            }

            if (!result.ok) {
                logger.error('gemini3Flow returned error', new Error(result.errorMessage ?? 'Unknown error'), { sessionId, durationMs });
                const errorResponse: StoryGeneratorResponse = {
                    ok: false,
                    sessionId,
                    question: '',
                    options: [],
                    errorMessage: result.errorMessage ?? 'Unknown error in gemini3Flow',
                    debug: result.debug ?? undefined,
                };
                return NextResponse.json(errorResponse, { status: 500 });
            }

            logger.info('Request completed successfully', { sessionId, durationMs });

            // Normalize options to StoryGeneratorResponseOption format
            // Merge options with their resolved counterparts
            const normalizedOptions: StoryGeneratorResponseOption[] = (result.options || []).map((opt: any, idx: number) => ({
                id: opt.id || String.fromCharCode(65 + idx), // A, B, C, D
                text: opt.text,
                textResolved: result.optionsResolved?.[idx]?.text,
                introducesCharacter: opt.introducesCharacter,
                newCharacterName: opt.newCharacterName,
                newCharacterLabel: opt.newCharacterLabel,
                newCharacterType: opt.newCharacterType,
            }));

            // Build the normalized response
            const response: StoryGeneratorResponse = {
                ok: true,
                sessionId,
                question: result.question,
                questionResolved: result.questionResolved,
                options: normalizedOptions,
                isStoryComplete: result.isStoryComplete || false,
                finalStory: result.finalStory || undefined,
                finalStoryResolved: result.finalStoryResolved || undefined,
                progress: result.progress,
                debug: result.debug,
            };

            return NextResponse.json(response, { status: 200 });
        } finally {
            cleanup();
        }

    } catch (e: any) {
        const errorMessage = e.message || 'An unexpected error occurred in the API route.';
        logger.error('Unhandled exception in route', e);
        const errorResponse: StoryGeneratorResponse = {
            ok: false,
            sessionId: '',
            question: '',
            options: [],
            errorMessage: `API /gemini3 route error: ${errorMessage}`,
        };
        return NextResponse.json(errorResponse, { status: 500 });
    }
}
