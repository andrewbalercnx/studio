'use server';

import { NextResponse } from 'next/server';
import { ai } from '@/ai/genkit';
import { requireUser, routeAuthErrorResponse } from '@/lib/route-auth.server';

/**
 * AI connection warm-up endpoint.
 *
 * Makes a minimal 1-token generation call to gemini-2.5-flash to establish
 * the TCP/TLS connection and HTTP/2 session to the Google AI API. Called
 * fire-and-forget from the story session page on mount, so that the connection
 * is warm when the first story beat fires after the child selects a story type.
 *
 * Requires a signed-in user: the output is discarded, but each call is a
 * billed model request (~$0.000001), so it must not be open to anyone.
 */
export async function POST(request: Request) {
    try {
        await requireUser(request);
    } catch (error) {
        const authResponse = routeAuthErrorResponse(error);
        if (authResponse) return authResponse;
        throw error;
    }
    const startTime = Date.now();
    try {
        await ai.generate({
            model: 'googleai/gemini-2.5-flash',
            prompt: 'Hi',
            config: {
                maxOutputTokens: 1,
                thinkingConfig: { thinkingBudget: 0 },
            },
        });
        return NextResponse.json({ ok: true, durationMs: Date.now() - startTime });
    } catch {
        // Warm-up failures are non-fatal — the beat call will still work, just from cold
        return NextResponse.json({ ok: false, durationMs: Date.now() - startTime });
    }
}
