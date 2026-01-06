import { NextResponse } from 'next/server';
import { storyBeatFlow } from '@/ai/flows/story-beat-flow';
import type { StoryGeneratorResponse, StoryGeneratorResponseOption } from '@/lib/types';

/**
 * Story Beat API endpoint.
 *
 * This API wraps the storyBeatFlow and normalizes its output to the
 * standard StoryGeneratorResponse format for StoryBrowser compatibility.
 */
export async function POST(request: Request) {
    try {
        const { sessionId, selectedOptionId, moreOptions } = await request.json();

        if (!sessionId) {
            const errorResponse: StoryGeneratorResponse = {
                ok: false,
                sessionId: '',
                question: '',
                options: [],
                errorMessage: 'Missing sessionId',
            };
            return NextResponse.json(errorResponse, { status: 400 });
        }

        // Handle "more options" request - just regenerate options
        // The flow will return new options based on the same arc step
        const result = await storyBeatFlow({ sessionId });

        if (!result.ok) {
            const errorResponse: StoryGeneratorResponse = {
                ok: false,
                sessionId,
                question: '',
                options: [],
                errorMessage: result.errorMessage || 'Unknown error',
            };
            return NextResponse.json(errorResponse, { status: 500 });
        }

        // Normalize options to StoryGeneratorResponseOption format
        const normalizedOptions: StoryGeneratorResponseOption[] = (result.options || []).map((opt: any, idx: number) => ({
            id: opt.id || String.fromCharCode(65 + idx), // A, B, C, D
            text: opt.text,
            textResolved: result.optionsResolved?.[idx]?.text,
            introducesCharacter: opt.introducesCharacter,
            newCharacterName: opt.newCharacterName,
            newCharacterLabel: opt.newCharacterLabel,
            newCharacterType: opt.newCharacterType,
            existingCharacterId: opt.existingCharacterId,
        }));

        // Build the normalized response
        const response: StoryGeneratorResponse = {
            ok: true,
            sessionId,
            // Story continuation goes in headerText
            headerText: result.storyContinuation,
            headerTextResolved: result.storyContinuationResolved,
            // The question prompts the user to choose
            question: 'What happens next?',
            questionResolved: 'What happens next?',
            options: normalizedOptions,
            isStoryComplete: false,
            // Progress from the flow (based on arc step completion)
            progress: result.progress,
            debug: result.debug,
        };

        return NextResponse.json(response, { status: 200 });

    } catch (e: any) {
        const errorMessage = e.message || 'An unexpected error occurred in the API route.';
        const errorResponse: StoryGeneratorResponse = {
            ok: false,
            sessionId: '',
            question: '',
            options: [],
            errorMessage: `API /storyBeat route error: ${errorMessage}`,
        };
        return NextResponse.json(errorResponse, { status: 500 });
    }
}
