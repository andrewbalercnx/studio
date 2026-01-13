import { NextResponse, after } from 'next/server';
import { storyCompileFlow } from '@/ai/flows/story-compile-flow';
import { storyAudioFlow } from '@/ai/flows/story-audio-flow';
import { storyTitleFlow } from '@/ai/flows/story-title-flow';
import { storyActorAvatarFlow } from '@/ai/flows/story-actor-avatar-flow';
import { createLogger, generateRequestId, createTimeoutController } from '@/lib/server-logger';
import { getServerFirestore } from '@/lib/server-firestore';
import { FieldValue } from 'firebase-admin/firestore';

// Request timeout for story compile (3 minutes - longer due to complexity)
const COMPILE_TIMEOUT_MS = 180000;

// Lock timeout - if a compile has been running for longer than this, allow a new one
const COMPILE_LOCK_TIMEOUT_MS = 120000; // 2 minutes

export async function POST(request: Request) {
    const requestId = generateRequestId();
    const logger = createLogger({ route: '/api/storyCompile', method: 'POST', requestId });
    let sessionId: string | undefined;

    try {
        const body = await request.json();
        sessionId = body.sessionId;
        const storyOutputTypeId = body.storyOutputTypeId;
        logger.info('Request received', { sessionId, storyOutputTypeId });

        if (!sessionId) {
            logger.warn('Missing sessionId in request');
            return NextResponse.json({ ok: false, errorMessage: 'Missing sessionId' }, { status: 400 });
        }
        // storyOutputTypeId is now optional - story can be compiled without it
        // and storyOutputType can be selected later when creating a storybook

        // Idempotency check: prevent duplicate compile requests
        const firestore = await getServerFirestore();
        const sessionRef = firestore.collection('storySessions').doc(sessionId);
        const sessionDoc = await sessionRef.get();

        if (sessionDoc.exists) {
            const sessionData = sessionDoc.data();
            const compileInProgress = sessionData?.compileInProgress;
            const compileStartedAt = sessionData?.compileStartedAt;

            // Check if compile is already in progress (and hasn't timed out)
            if (compileInProgress) {
                const startedAtMs = compileStartedAt?.toMillis?.() || 0;
                const elapsedMs = Date.now() - startedAtMs;

                if (elapsedMs < COMPILE_LOCK_TIMEOUT_MS) {
                    logger.warn('Compile already in progress, rejecting duplicate request', {
                        sessionId,
                        elapsedMs,
                        compileStartedAt: compileStartedAt?.toDate?.()?.toISOString()
                    });
                    return NextResponse.json({
                        ok: false,
                        errorMessage: 'Story compilation is already in progress. Please wait.',
                        alreadyInProgress: true
                    }, { status: 409 }); // 409 Conflict
                } else {
                    logger.warn('Previous compile timed out, allowing new request', { sessionId, elapsedMs });
                }
            }

            // Check if already successfully compiled
            if (sessionData?.status === 'completed') {
                const storyRef = firestore.collection('stories').doc(sessionId);
                const storyDoc = await storyRef.get();
                if (storyDoc.exists) {
                    logger.info('Story already compiled, returning existing result', { sessionId });
                    return NextResponse.json({
                        ok: true,
                        sessionId,
                        storyId: sessionId,
                        alreadyCompiled: true
                    }, { status: 200 });
                }
            }

            // Set compile lock
            await sessionRef.update({
                compileInProgress: true,
                compileStartedAt: FieldValue.serverTimestamp(),
                compileRequestId: requestId,
            });
        }

        const startTime = Date.now();
        // Create abort controller for timeout
        // Note: Genkit flows don't currently accept abort signals, so this provides
        // logging and cleanup but won't interrupt a running flow.
        const { controller, cleanup } = createTimeoutController(
            COMPILE_TIMEOUT_MS,
            logger,
            'storyCompileFlow'
        );

        try {
            // TODO: Pass controller.signal to flow when Genkit supports abort signals
            const result = await storyCompileFlow({ sessionId, storyOutputTypeId });
            const durationMs = Date.now() - startTime;

            // Release compile lock
            try {
                await sessionRef.update({
                    compileInProgress: false,
                    compileCompletedAt: FieldValue.serverTimestamp(),
                });
            } catch (lockError) {
                logger.warn('Failed to release compile lock', { sessionId, error: lockError });
            }

            if (controller.signal.aborted) {
                logger.warn('Flow completed after timeout was triggered', { sessionId, durationMs });
            }

            if (result.ok && result.storyId) {
                logger.info('storyCompileFlow completed successfully', { sessionId, storyId: result.storyId, durationMs });

                // Trigger background generation tasks in parallel using after()
                // This ensures tasks complete even after the response is sent
                // - storyCompileFlow already generated: storyText + synopsis
                // - Now run in parallel: storyTitleFlow + storyActorAvatarFlow + storyAudioFlow
                // Note: storyTitleFlow now reads the already-generated synopsis

                const storyId = result.storyId;

                // Use after() to ensure background tasks complete on serverless
                after(async () => {
                    logger.info('Starting background generation tasks', { storyId });

                    // Run all tasks in parallel
                    const results = await Promise.allSettled([
                        // Audio narration (independent)
                        storyAudioFlow({ storyId }),
                        // Composite actor avatar (independent)
                        storyActorAvatarFlow({ storyId }),
                        // Title generation (reads existing synopsis from compile)
                        storyTitleFlow({ storyId }),
                    ]);

                    // Log results
                    const [audioResult, avatarResult, titleResult] = results;

                    if (audioResult.status === 'rejected') {
                        logger.error('Background audio generation failed', audioResult.reason, { storyId });
                    } else {
                        logger.info('Background audio generation completed', { storyId, ok: audioResult.value?.ok });
                    }

                    if (avatarResult.status === 'rejected') {
                        logger.error('Background actor avatar generation failed', avatarResult.reason, { storyId });
                    } else {
                        logger.info('Background actor avatar generation completed', { storyId, ok: avatarResult.value?.ok });
                    }

                    if (titleResult.status === 'rejected') {
                        logger.error('Background title generation failed', titleResult.reason, { storyId });
                    } else {
                        logger.info('Background title generation completed', { storyId, ok: titleResult.value?.ok });
                    }

                    logger.info('All background generation tasks completed', { storyId });
                });

                return NextResponse.json(result, { status: 200 });
            } else if (result.ok) {
                // No storyId returned (shouldn't happen, but handle gracefully)
                logger.warn('storyCompileFlow returned ok but no storyId', { sessionId, durationMs });
                return NextResponse.json(result, { status: 200 });
            } else {
                logger.error('storyCompileFlow returned error', new Error(result.errorMessage ?? 'Unknown error'), { sessionId, durationMs });
                return NextResponse.json(
                    {
                        ok: false,
                        errorMessage: result.errorMessage ?? 'Unknown error in storyCompileFlow',
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

        // Release compile lock on error (only if sessionId was successfully parsed)
        if (sessionId) {
            try {
                const firestore = await getServerFirestore();
                const sessionRef = firestore.collection('storySessions').doc(sessionId);
                await sessionRef.update({
                    compileInProgress: false,
                    compileErrorAt: FieldValue.serverTimestamp(),
                    compileLastError: errorMessage,
                });
            } catch (lockError) {
                logger.warn('Failed to release compile lock after error', { sessionId, error: lockError });
            }
        }

        return NextResponse.json(
            {
                ok: false,
                errorMessage: `API /storyCompile route error: ${errorMessage}`,
                requestId,
            },
            { status: 500 }
        );
    }
}
