import { NextResponse } from 'next/server';
import { initFirebaseAdminApp } from '@/firebase/admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { requireAuthenticatedUser } from '@/lib/server-auth';
import { AuthError } from '@/lib/auth-error';
import { friendsFlow } from '@/ai/flows/friends-flow';
import type { StorySession, StoryGeneratorResponse, StoryGeneratorResponseOption } from '@/lib/types';

/**
 * "Fun with my friends" Story Generator API endpoint.
 *
 * This API handles the multi-phase friends story flow:
 * 1. Character Selection - AI proposes characters, child confirms or modifies
 * 2. Scenario Selection - AI generates adventure scenario options
 * 3. Synopsis Selection - AI drafts story synopses
 * 4. Story Generation - AI writes the full story
 *
 * Request body:
 * - sessionId: string (required)
 * - selectedOptionId: string (optional) - for scenario/synopsis selection
 * - action: 'confirm_characters' | 'change_characters' | 'more_synopses' (optional)
 * - selectedCharacterIds: string[] (optional) - for character selection
 */
export async function POST(request: Request) {
  try {
    await initFirebaseAdminApp();
    const user = await requireAuthenticatedUser(request);
    const firestore = getFirestore();

    const body = await request.json();
    const { sessionId, selectedOptionId, action, selectedCharacterIds } = body;

    if (!sessionId) {
      return NextResponse.json(
        { ok: false, errorMessage: 'Missing sessionId' } as StoryGeneratorResponse,
        { status: 400 }
      );
    }

    // Fetch the session
    const sessionRef = firestore.collection('storySessions').doc(sessionId);
    const sessionSnap = await sessionRef.get();

    if (!sessionSnap.exists) {
      return NextResponse.json(
        { ok: false, errorMessage: 'Session not found' } as StoryGeneratorResponse,
        { status: 404 }
      );
    }

    const session = { id: sessionSnap.id, ...sessionSnap.data() } as StorySession;

    // Verify ownership
    if (session.parentUid !== user.uid) {
      return NextResponse.json(
        { ok: false, errorMessage: 'Unauthorized' } as StoryGeneratorResponse,
        { status: 403 }
      );
    }

    // Call the friends flow
    const result = await friendsFlow({
      childId: session.childId,
      sessionId,
      action,
      selectedCharacterIds,
      selectedOptionId,
    });

    if (!result.ok) {
      const errorResult = result as { state: 'error'; error: string; ok: false };
      return NextResponse.json(
        {
          ok: false,
          sessionId,
          question: '',
          options: [],
          errorMessage: errorResult.error,
        } as StoryGeneratorResponse,
        { status: 500 }
      );
    }

    // Convert flow output to StoryGeneratorResponse format
    // Progress values for friends flow:
    // character_selection = 0.25, scenario_selection = 0.50, synopsis_selection = 0.75, complete = 1.0
    if (result.state === 'character_selection') {
      const response: StoryGeneratorResponse = {
        ok: true,
        sessionId,
        question: result.question,
        questionResolved: result.question,
        options: [], // Character selection uses custom UI, not standard options
        isStoryComplete: false,
        friendsPhase: 'character_selection',
        proposedCharacters: result.proposedCharacters,
        availableCharacters: result.availableCharacters,
        progress: 0.25,
      };
      return NextResponse.json(response);
    }

    if (result.state === 'scenario_selection') {
      // Convert scenarios to options format
      const options: StoryGeneratorResponseOption[] = result.scenarios.map((scenario) => ({
        id: scenario.id,
        text: `${scenario.title}: ${scenario.description}`,
        textResolved: `${scenario.title}: ${scenario.description}`,
      }));

      const response: StoryGeneratorResponse = {
        ok: true,
        sessionId,
        question: result.question,
        questionResolved: result.question,
        options,
        isStoryComplete: false,
        friendsPhase: 'scenario_selection',
        scenarios: result.scenarios,
        progress: 0.5,
      };
      return NextResponse.json(response);
    }

    if (result.state === 'synopsis_selection') {
      // Convert synopses to options format, plus add "More stories" option
      const options: StoryGeneratorResponseOption[] = [
        ...result.synopses.map((synopsis) => ({
          id: synopsis.id,
          text: `${synopsis.title}: ${synopsis.summary}`,
          textResolved: `${synopsis.title}: ${synopsis.summary}`,
        })),
        {
          id: 'MORE',
          text: 'Show me different stories',
          textResolved: 'Show me different stories',
          isMoreOption: true,
        },
      ];

      const response: StoryGeneratorResponse = {
        ok: true,
        sessionId,
        question: result.question,
        questionResolved: result.question,
        options,
        isStoryComplete: false,
        friendsPhase: 'synopsis_selection',
        synopses: result.synopses,
        progress: 0.75,
      };
      return NextResponse.json(response);
    }

    if (result.state === 'finished') {
      const response: StoryGeneratorResponse = {
        ok: true,
        sessionId,
        question: 'Your story is complete!',
        questionResolved: 'Your story is complete!',
        options: [],
        isStoryComplete: true,
        finalStory: result.storyText,
        finalStoryResolved: result.storyText,
        friendsPhase: 'complete',
        progress: 1.0,
      };
      return NextResponse.json(response);
    }

    // Shouldn't reach here
    return NextResponse.json(
      {
        ok: false,
        sessionId,
        question: '',
        options: [],
        errorMessage: 'Unknown flow state',
      } as StoryGeneratorResponse,
      { status: 500 }
    );
  } catch (error: any) {
    if (error instanceof AuthError) {
      return NextResponse.json(
        { ok: false, errorMessage: error.message } as StoryGeneratorResponse,
        { status: error.status }
      );
    }

    console.error('[api/storyFriends] Error:', error);
    return NextResponse.json(
      {
        ok: false,
        sessionId: '',
        question: '',
        options: [],
        errorMessage: error?.message || 'Unexpected error',
      } as StoryGeneratorResponse,
      { status: 500 }
    );
  }
}
