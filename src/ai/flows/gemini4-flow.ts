'use server';
/**
 * @fileOverview A Genkit flow for Gemini 4 story creation using ai.chat.
 * Uses stateful chat sessions with Firestore-backed storage for conversation history.
 * Asks structured age-appropriate questions to build a personalized story.
 */

import { ai, aiBeta } from '@/ai/genkit';
import { getServerFirestore } from '@/lib/server-firestore';
import { z } from 'genkit';
import type { StorySession, ChatMessage, Character, ChildProfile } from '@/lib/types';
import { summarizeChildPreferences } from '@/lib/child-preferences';
import { logAIFlow } from '@/lib/ai-flow-logger';
import { FieldValue } from 'firebase-admin/firestore';
import { resolveEntitiesInText, replacePlaceholdersInText, extractEntityMetadataFromText } from '@/lib/resolve-placeholders.server';
import { buildStoryContext } from '@/lib/story-context-builder';
import { buildStorySystemMessage } from '@/lib/build-story-system-message';
import type { MessageData } from 'genkit';

// Note: createStoryCharacterFlow and gemini4CreateCharacterFlow are now imported directly
// from '@/ai/flows/create-story-character-flow' - re-exports removed due to 'use server' constraints

// Simplified option schema to avoid nesting depth issues with Gemini
const OptionSchema = z.object({
  id: z.string().describe("A single uppercase letter: 'A', 'B', 'C', or 'M' for 'Tell me more'."),
  text: z.string().describe("A short, child-friendly choice."),
  isMoreOption: z.boolean().describe("True only for the 'Tell me more' option."),
  introducesCharacter: z.boolean().describe("True if this option introduces a new character."),
  newCharacterName: z.string().describe("If introducesCharacter, a proper name like 'Nutsy' or 'Captain Sparkle'. Otherwise empty string."),
  newCharacterLabel: z.string().describe("If introducesCharacter, a descriptive phrase like 'a friendly dragon who loves flying'. Otherwise empty string. Must be DIFFERENT from newCharacterName."),
  newCharacterType: z.string().describe("If introducesCharacter: Family, Friend, Pet, Toy, or Other. Otherwise empty string."),
  existingCharacterId: z.string().describe("If referencing existing character, their ID. Otherwise empty string."),
});

// Zod schema for the expected JSON output from the model
const Gemini4OutputSchema = z.object({
  question: z.string().describe("The next question to ask the child. Empty string when story is complete."),
  options: z.array(OptionSchema).describe("3 story choices (A, B, C) plus 'Tell me more' (M). Empty array when story is complete."),
  isStoryComplete: z.boolean().describe("True if the story has reached a natural conclusion."),
  finalStory: z.string().describe("If isStoryComplete is true, the complete story text with $$id$$ placeholders. Otherwise empty string."),
  questionPhase: z.string().describe("Current phase: opening, setting, characters, conflict, resolution, or complete."),
});

type Gemini4Output = z.infer<typeof Gemini4OutputSchema>;

type Gemini4DebugInfo = {
  stage: 'loading_session' | 'loading_context' | 'building_chat' | 'sending_message' | 'extract_output' | 'unknown';
  details: Record<string, any>;
};

// Build question sequence guidance based on how many questions have been asked
function getQuestionPhaseGuidance(questionCount: number, childAge: number | null): string {
  const maxQuestions = childAge && childAge <= 5 ? 6 : 8;
  const phase = questionCount;

  if (phase === 0) {
    return `**OPENING QUESTION (Phase 1/${maxQuestions})**
Ask an exciting opening question to understand what kind of adventure the child wants.
Focus on: What does $$childId$$ want to do today? Where do they want to go?
Include options that reference existing characters if available.`;
  } else if (phase === 1) {
    return `**SETTING QUESTION (Phase 2/${maxQuestions})**
Build on their first choice. Establish where the story takes place.
Focus on: Describe the setting with sensory details. What does $$childId$$ see, hear, smell?`;
  } else if (phase === 2) {
    return `**CHARACTER QUESTION (Phase 3/${maxQuestions})**
Introduce or involve characters in the story.
Focus on: Who does $$childId$$ meet? Consider siblings and existing characters.
Options should involve known characters or introduce new ones.`;
  } else if (phase === 3) {
    return `**PROBLEM/CONFLICT QUESTION (Phase 4/${maxQuestions})**
Introduce a challenge or exciting situation.
Focus on: What problem arises? What needs to be solved or discovered?`;
  } else if (phase === 4) {
    return `**ACTION QUESTION (Phase 5/${maxQuestions})**
The child takes action to address the challenge.
Focus on: How does $$childId$$ respond? What do they decide to do?`;
  } else if (phase >= maxQuestions - 1) {
    return `**RESOLUTION QUESTION (Final Phase)**
Time to wrap up the story with a satisfying conclusion.
Focus on: How does the adventure end? What did $$childId$$ learn or accomplish?
After this response, you should complete the story.`;
  } else {
    return `**DEVELOPMENT QUESTION (Phase ${phase + 1}/${maxQuestions})**
Continue developing the story based on their choices.
Build tension or add interesting developments.`;
  }
}

export const gemini4Flow = ai.defineFlow(
  {
    name: 'gemini4Flow',
    inputSchema: z.object({
      sessionId: z.string(),
      userMessage: z.string().optional(), // The child's choice or response
      selectedOptionId: z.string().optional(), // Which option was selected
    }),
    outputSchema: z.any(),
  },
  async ({ sessionId, userMessage, selectedOptionId }) => {
    let debug: Gemini4DebugInfo = { stage: 'unknown', details: {} };

    try {
      const firestore = await getServerFirestore();

      // 1. Load session
      debug.stage = 'loading_session';
      const sessionRef = firestore.collection('storySessions').doc(sessionId);
      const sessionDoc = await sessionRef.get();
      if (!sessionDoc.exists) {
        return { ok: false, sessionId, errorMessage: `Session with id ${sessionId} not found.` };
      }
      const session = sessionDoc.data() as StorySession;
      const { parentUid, childId } = session;

      if (!parentUid) {
        return { ok: false, sessionId, errorMessage: `Session is missing required field: parentUid.` };
      }

      // 2. Load unified story context
      debug.stage = 'loading_context';
      const { data: contextData, formatted: contextFormatted } = await buildStoryContext(
        parentUid,
        childId,
        null // No main character ID in gemini4 flow
      );
      const childProfile = contextData.mainChild;
      const childAge = contextData.childAge;
      const childPreferenceSummary = summarizeChildPreferences(childProfile);
      debug.details.childAge = childAge;
      debug.details.siblingsCount = contextData.siblings.length;
      debug.details.charactersCount = contextData.characters.length;

      // 3. Load existing conversation history from Firestore
      debug.stage = 'building_chat';
      const messagesSnapshot = await firestore
        .collection('storySessions')
        .doc(sessionId)
        .collection('messages')
        .orderBy('createdAt', 'asc')
        .get();

      const existingMessages = messagesSnapshot.docs.map(doc => doc.data() as ChatMessage);
      const messageCount = existingMessages.length;
      debug.details.existingMessageCount = messageCount;

      // Convert to Genkit MessageData format for chat history
      const chatHistory: MessageData[] = existingMessages
        .filter(m => m.kind !== 'system_status') // Skip system messages
        .map(m => ({
          role: m.sender === 'assistant' ? 'model' : 'user',
          content: [{ text: m.text }],
        } as MessageData));

      // Calculate question count (assistant messages that are questions)
      const questionCount = existingMessages.filter(
        m => m.sender === 'assistant' && m.kind === 'gemini4_question'
      ).length;

      // Build the unified system prompt
      const systemMessage = buildStorySystemMessage(contextFormatted, childAge, 'story_beat');
      const phaseGuidance = getQuestionPhaseGuidance(questionCount, childAge);

      const systemPrompt = `${systemMessage}

=== GEMINI 4 MODE ===
Guide the child through a structured story creation with focused questions.
Provide 4 options: A, B, C (story choices) and M ("Tell me more").
${phaseGuidance}

=== CURRENT SESSION ===
Child's inspirations: ${childPreferenceSummary}

=== OUTPUT FORMAT ===
{
  "question": "...",
  "options": [{ "id": "A", "text": "...", "isMoreOption": false, "introducesCharacter": false, "newCharacterName": "", "newCharacterLabel": "", "newCharacterType": "", "existingCharacterId": "" }],
  "isStoryComplete": false,
  "finalStory": "",
  "questionPhase": "opening|setting|characters|conflict|resolution|complete"
}

When story complete: question="", options=[], isStoryComplete=true, finalStory="full story with $$id$$ placeholders"`;

      // 4. Create chat session and send message
      debug.stage = 'sending_message';

      // Determine the user message to send
      let messageToSend: string;
      if (!userMessage && messageCount === 0) {
        // First message - ask AI to start
        messageToSend = "Please start the story by asking me an exciting opening question!";
      } else if (userMessage) {
        messageToSend = userMessage;
      } else {
        // This shouldn't happen, but handle gracefully
        messageToSend = "Please continue the story.";
      }

      // Use aiBeta.chat for stateful conversation (chat is a beta API)
      const chat = aiBeta.chat({
        model: 'googleai/gemini-2.5-pro',
        system: systemPrompt,
        config: {
          temperature: 0.85,
          maxOutputTokens: 4000,
        },
        output: {
          schema: Gemini4OutputSchema,
        },
        messages: chatHistory,
      });

      let llmResponse;
      const startTime = Date.now();
      const modelName = 'googleai/gemini-2.5-pro';
      try {
        llmResponse = await chat.send(messageToSend);
        await logAIFlow({
          flowName: 'gemini4Flow',
          sessionId,
          parentId: parentUid,
          prompt: `System: ${systemPrompt}\n\nHistory: ${chatHistory.length} messages\n\nUser: ${messageToSend}`,
          response: llmResponse,
          startTime,
          modelName,
        });
      } catch (e: any) {
        await logAIFlow({
          flowName: 'gemini4Flow',
          sessionId,
          parentId: parentUid,
          prompt: systemPrompt,
          error: e,
          startTime,
          modelName,
        });
        throw e;
      }

      debug.stage = 'extract_output';
      const result = llmResponse.output as Gemini4Output;

      if (!result) {
        debug.details.rawText = llmResponse.text || 'No text';
        throw new Error("Model returned no structured output for Gemini 4 flow.");
      }

      debug.details.outputPreview = JSON.stringify(result).slice(0, 300);
      debug.details.questionPhase = result.questionPhase;

      // Resolve placeholders in question and options
      const allTexts = [
        result.question,
        ...(result.options?.map(o => o.text) || []),
        result.finalStory || ''
      ].join(' ');

      const entityMap = await resolveEntitiesInText(allTexts);

      // Replace placeholders for display
      const resolvedQuestion = await replacePlaceholdersInText(result.question, entityMap);
      const resolvedOptions = await Promise.all(
        (result.options || []).map(async (option) => ({
          ...option,
          text: await replacePlaceholdersInText(option.text, entityMap),
          entities: await extractEntityMetadataFromText(option.text, entityMap),
        }))
      );
      const resolvedFinalStory = result.finalStory
        ? await replacePlaceholdersInText(result.finalStory, entityMap)
        : null;

      // If story is complete, update session status
      if (result.isStoryComplete && result.finalStory) {
        await sessionRef.update({
          status: 'completed',
          currentPhase: 'completed',
          gemini4FinalStory: result.finalStory, // Store ORIGINAL with placeholders
          updatedAt: FieldValue.serverTimestamp(),
        });
      }

      return {
        ok: true,
        sessionId,
        question: result.question,
        questionResolved: resolvedQuestion,
        options: result.options || [],
        optionsResolved: resolvedOptions,
        isStoryComplete: result.isStoryComplete || false,
        finalStory: result.finalStory || null,
        finalStoryResolved: resolvedFinalStory,
        questionPhase: result.questionPhase || 'opening',
        questionNumber: questionCount + 1,
        debug: {
          ...debug,
          systemPrompt: systemPrompt.slice(0, 500) + '...',
          modelName: 'googleai/gemini-2.5-pro',
        },
      };

    } catch (e: any) {
      debug.details.error = e.message || String(e);
      return {
        ok: false,
        sessionId,
        errorMessage: `Unexpected error in gemini4Flow: ${e.message || String(e)}`,
        debug,
      };
    }
  }
);

// Note: gemini4CreateCharacterFlow has been moved to create-story-character-flow.ts
// and is re-exported above for backward compatibility
