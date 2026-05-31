'use server';

import { NextResponse } from 'next/server';
import { ai } from '@/ai/genkit';

/**
 * AI connection warm-up endpoint.
 *
 * Makes a minimal 1-token generation call to gemini-2.5-flash to establish
 * the TCP/TLS connection and HTTP/2 session to the Google AI API. Called
 * fire-and-forget from the story session page on mount, so that the connection
 * is warm when the first story beat fires after the child selects a story type.
 *
 * No authentication required — output is discarded, no sensitive data involved.
 * Cost: ~$0.000001 per call (negligible).
 */
export async function POST() {
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
