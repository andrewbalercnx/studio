import { NextResponse } from 'next/server';
import { storyPaginationFlow } from '@/ai/flows/story-pagination-flow';
import { createLogger, generateRequestId } from '@/lib/server-logger';

// Allow up to 2 minutes for pagination
export const maxDuration = 120;

export async function POST(request: Request) {
    const requestId = generateRequestId();
    const logger = createLogger({ route: '/api/storyPagination', method: 'POST', requestId });

    try {
        const { storyId, storyOutputTypeId } = await request.json();
        logger.info('Request received', { storyId, storyOutputTypeId });

        if (!storyId || typeof storyId !== 'string') {
            logger.warn('Missing storyId in request');
            return NextResponse.json({ ok: false, errorMessage: 'Missing storyId', requestId }, { status: 400 });
        }

        if (!storyOutputTypeId || typeof storyOutputTypeId !== 'string') {
            logger.warn('Missing storyOutputTypeId in request');
            return NextResponse.json({ ok: false, errorMessage: 'Missing storyOutputTypeId', requestId }, { status: 400 });
        }

        const startTime = Date.now();

        const result = await storyPaginationFlow({
            storyId,
            storyOutputTypeId,
        });

        const durationMs = Date.now() - startTime;

        if (result.ok) {
            logger.info('storyPaginationFlow completed successfully', {
                storyId,
                storyOutputTypeId,
                pageCount: result.pages?.length ?? 0,
                durationMs,
            });
            return NextResponse.json(result, { status: 200 });
        } else {
            logger.error('storyPaginationFlow returned error', new Error(result.errorMessage ?? 'Unknown error'), {
                storyId,
                storyOutputTypeId,
                durationMs,
            });
            return NextResponse.json(result, { status: 500 });
        }

    } catch (e: any) {
        const errorMessage = e.message || 'An unexpected error occurred in the API route.';
        logger.error('Unhandled exception in route', e);
        return NextResponse.json(
            {
                ok: false,
                errorMessage: `API /storyPagination route error: ${errorMessage}`,
                requestId,
            },
            { status: 500 }
        );
    }
}
