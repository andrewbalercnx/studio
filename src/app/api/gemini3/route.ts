import { NextResponse } from 'next/server';
import { gemini3Flow } from '@/ai/flows/gemini3-flow';
import { createLogger, generateRequestId, createTimeoutController } from '@/lib/server-logger';

// Request timeout for AI flows (2 minutes)
const AI_FLOW_TIMEOUT_MS = 120000;

export async function POST(request: Request) {
    const requestId = generateRequestId();
    const logger = createLogger({ route: '/api/gemini3', method: 'POST', requestId });

    try {
        const { sessionId } = await request.json();
        logger.info('Request received', { sessionId });

        if (!sessionId) {
            logger.warn('Missing sessionId in request');
            return NextResponse.json({ ok: false, errorMessage: 'Missing sessionId' }, { status: 400 });
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

            if (result.ok) {
                logger.info('Request completed successfully', { sessionId, durationMs });
                return NextResponse.json(result, { status: 200 });
            } else {
                logger.error('gemini3Flow returned error', new Error(result.errorMessage ?? 'Unknown error'), { sessionId, durationMs });
                return NextResponse.json(
                    {
                        ok: false,
                        errorMessage: result.errorMessage ?? 'Unknown error in gemini3Flow',
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
                errorMessage: `API /gemini3 route error: ${errorMessage}`,
                requestId,
            },
            { status: 500 }
        );
    }
}
