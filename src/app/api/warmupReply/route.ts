
import { NextResponse } from 'next/server';
import { warmupReplyFlow } from '@/ai/flows/warmup-reply-flow';
import { createLogger, generateRequestId } from '@/lib/server-logger';
import { toUserSafeMessage } from '@/lib/ai-error-map';
import { requireSessionOwner, routeAuthErrorResponse } from '@/lib/route-auth.server';

export async function POST(request: Request) {
    const requestId = generateRequestId();
    const logger = createLogger({ route: '/api/warmupReply', method: 'POST', requestId });

    try {
        const { sessionId } = await request.json();
        logger.info('Request received', { sessionId });

        if (!sessionId) {
            logger.warn('Missing sessionId in request');
            return NextResponse.json({ ok: false, errorMessage: 'sessionId is required' }, { status: 400 });
        }

        await requireSessionOwner(request, sessionId);

        const startTime = Date.now();
        const result = await warmupReplyFlow({ sessionId });
        const durationMs = Date.now() - startTime;

        if (result.ok) {
            logger.info('Request completed successfully', { sessionId, durationMs });
            return NextResponse.json(result);
        } else {
            logger.error('warmupReplyFlow returned error', new Error(result.errorMessage || 'Unknown flow error'), { sessionId, durationMs });
            // Pass through the detailed error message and the full debug object from the flow
            return NextResponse.json({
                ok: false,
                errorMessage: result.errorMessage || 'An unknown flow error occurred.',
                usedPromptConfigId: result.usedPromptConfigId || null,
                debug: result.debug || null,
                requestId,
             }, { status: 500 });
        }

    } catch (e: any) {
        const authResponse = routeAuthErrorResponse(e, { requestId });
        if (authResponse) return authResponse;
        logger.error('Unhandled exception in route', e);
        return NextResponse.json({ ok: false, errorMessage: toUserSafeMessage(e), requestId }, { status: 500 });
    }
}
