import { NextResponse } from 'next/server';
import { initFirebaseAdminApp } from '@/firebase/admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { requireAuthenticatedUser } from '@/lib/server-auth';
import { AuthError } from '@/lib/auth-error';
import { storyWizardFlow } from '@/ai/flows/story-wizard-flow';
import type { StorySession, StoryWizardAnswer, StoryGeneratorResponse, StoryGeneratorResponseOption } from '@/lib/types';

/**
 * Story Wizard API endpoint.
 *
 * This API normalizes the wizard flow to the standard StoryGeneratorResponse format
 * used by the StoryBrowser component.
 *
 * The wizard flow is stateful - it asks 4 questions and then generates a story.
 * The Q&A state is stored in the session's wizardAnswers field.
 *
 * Flow:
 * 1. First call (no selectedOptionId): Returns first question
 * 2. Subsequent calls (with selectedOptionId): Adds answer, returns next question or final story
 */
export async function POST(request: Request) {
  try {
    await initFirebaseAdminApp();
    const user = await requireAuthenticatedUser(request);
    const firestore = getFirestore();

    const { sessionId, selectedOptionId } = await request.json();

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

    const session = sessionSnap.data() as StorySession & { wizardLastQuestion?: string };

    // Verify ownership
    if (session.parentUid !== user.uid) {
      return NextResponse.json(
        { ok: false, errorMessage: 'Unauthorized' } as StoryGeneratorResponse,
        { status: 403 }
      );
    }

    // Get current answers from session
    let currentAnswers: StoryWizardAnswer[] = session.wizardAnswers || [];

    // If an option was selected, add it to the answers
    if (selectedOptionId && session.wizardLastQuestion) {
      // selectedOptionId is the option letter (A, B, C, D)
      // We need to find the corresponding choice text from the last response
      // Since we don't store the choices, we'll use the selectedOptionId as a marker
      // and let the flow handle it. But actually the StoryBrowser sends the option.id
      // which is the letter, not the text.
      //
      // Problem: We need the actual choice text. Let's store the last choices too.
      //
      // For now, let's retrieve the choice text from stored data
      const lastChoices = (session as any).wizardLastChoices as { text: string }[] | undefined;
      if (lastChoices) {
        const optionIndex = selectedOptionId.charCodeAt(0) - 65; // A=0, B=1, etc.
        if (optionIndex >= 0 && optionIndex < lastChoices.length) {
          const selectedChoice = lastChoices[optionIndex];
          currentAnswers = [
            ...currentAnswers,
            { question: session.wizardLastQuestion, answer: selectedChoice.text }
          ];
        }
      }
    }

    // Call the wizard flow
    const result = await storyWizardFlow({
      childId: session.childId,
      sessionId,
      answers: currentAnswers,
    });

    if (!result.ok) {
      const errorResult = result as { state: 'error'; error: string; ok: false };
      return NextResponse.json(
        {
          ok: false,
          sessionId,
          question: '',
          options: [],
          errorMessage: errorResult.error
        } as StoryGeneratorResponse,
        { status: 500 }
      );
    }

    if (result.state === 'asking') {
      const askingResult = result as {
        state: 'asking';
        question: string;
        choices: { text: string }[];
        answers: StoryWizardAnswer[];
        ok: true;
      };

      // Convert choices to StoryGeneratorResponseOption format
      const options: StoryGeneratorResponseOption[] = askingResult.choices.map((choice, idx) => ({
        id: String.fromCharCode(65 + idx), // A, B, C, D
        text: choice.text,
        introducesCharacter: false,
      }));

      // Store state for the next call
      await sessionRef.update({
        wizardAnswers: askingResult.answers,
        wizardLastQuestion: askingResult.question,
        wizardLastChoices: askingResult.choices,
        updatedAt: FieldValue.serverTimestamp(),
      });

      const response: StoryGeneratorResponse = {
        ok: true,
        sessionId,
        question: askingResult.question,
        questionResolved: askingResult.question,
        options,
        isStoryComplete: false,
      };

      return NextResponse.json(response);
    }

    if (result.state === 'finished') {
      const finishedResult = result as {
        state: 'finished';
        title: string;
        vibe: string;
        storyText: string;
        storyId: string;
        ok: true;
      };

      // Update session status
      await sessionRef.update({
        status: 'completed',
        storyTitle: finishedResult.title,
        storyVibe: finishedResult.vibe,
        updatedAt: FieldValue.serverTimestamp(),
      });

      const response: StoryGeneratorResponse = {
        ok: true,
        sessionId,
        question: 'Your story is complete!',
        questionResolved: 'Your story is complete!',
        options: [],
        isStoryComplete: true,
        finalStory: finishedResult.storyText,
        finalStoryResolved: finishedResult.storyText,
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
        errorMessage: 'Unknown wizard state'
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

    console.error('[api/storyWizard] Error:', error);
    return NextResponse.json(
      {
        ok: false,
        sessionId: '',
        question: '',
        options: [],
        errorMessage: error?.message || 'Unexpected error'
      } as StoryGeneratorResponse,
      { status: 500 }
    );
  }
}
