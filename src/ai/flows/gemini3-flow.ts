'use server';
/**
 * @fileOverview A Genkit flow for Gemini 3 free-form story creation.
 * Gemini has free rein to ask creative questions and build a story progressively.
 */

import { ai } from '@/ai/genkit';
import { getServerFirestore } from '@/lib/server-firestore';
import { z } from 'genkit';
import type { StorySession, ChatMessage, Character, ChildProfile } from '@/lib/types';
import { summarizeChildPreferences } from '@/lib/child-preferences';
import { logAIFlow } from '@/lib/ai-flow-logger';
import { FieldValue } from 'firebase-admin/firestore';
import { resolveEntitiesInText, replacePlaceholdersInText, extractEntityMetadataFromText } from '@/lib/resolve-placeholders.server';
import { buildStoryContext } from '@/lib/story-context-builder';
import { buildStorySystemMessage } from '@/lib/build-story-system-message';

type Gemini3DebugInfo = {
    stage: 'loading_session' | 'loading_context' | 'loading_child' | 'loading_characters' | 'loading_messages' | 'ai_generate' | 'extract_output' | 'json_parse' | 'json_validate' | 'unknown';
    details: Record<string, any>;
};

// Simplified Zod schema for Gemini output (to avoid "maximum nesting depth" API errors)
// Character introduction fields moved to a simpler structure
const Gemini3OptionSchema = z.object({
  id: z.string().describe("A single uppercase letter, e.g., 'A', 'B', 'C', 'D'."),
  text: z.string().describe("A short, child-friendly choice."),
  introducesCharacter: z.boolean().optional().describe("Set to true if this option introduces a new character."),
  newCharacterName: z.string().optional().describe("If introducesCharacter is true, the character's proper name (e.g., 'Nutsy', 'Captain Sparkle')."),
  newCharacterLabel: z.string().optional().describe("If introducesCharacter is true, a descriptive phrase (e.g., 'a friendly squirrel who loves acorns')."),
  newCharacterType: z.string().optional().describe("If introducesCharacter is true, one of: Family, Friend, Pet, Toy, Other."),
});

const Gemini3OutputSchema = z.object({
  question: z.string().describe("The next question or story continuation. Empty string when story is complete."),
  options: z.array(Gemini3OptionSchema).describe("2-4 choices during story development. Empty array when story is complete."),
  isStoryComplete: z.boolean().optional().describe("Set to true if the story has reached a natural conclusion."),
  finalStory: z.string().optional().describe("If isStoryComplete is true, the complete story text with placeholders."),
});

export const gemini3Flow = ai.defineFlow(
    {
        name: 'gemini3Flow',
        inputSchema: z.object({ sessionId: z.string() }),
        outputSchema: z.any(), // Using any to allow for custom error/success shapes
    },
    async ({ sessionId }) => {
        let debug: Gemini3DebugInfo = { stage: 'unknown', details: {} };

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
            const { mainCharacterId, parentUid, childId } = session;

            if (!parentUid) {
                return { ok: false, sessionId, errorMessage: `Session is missing required field: parentUid.` };
            }

            // 2. Load unified story context (child, siblings, characters)
            debug.stage = 'loading_context';
            const { data: contextData, formatted: contextFormatted } = await buildStoryContext(
                parentUid,
                childId,
                mainCharacterId
            );
            const childProfile = contextData.mainChild;
            const childAge = contextData.childAge;
            const childPreferenceSummary = summarizeChildPreferences(childProfile);
            debug.details.childPreferenceSummary = childPreferenceSummary.slice(0, 400);
            debug.details.childAge = childAge;
            debug.details.siblingsCount = contextData.siblings.length;
            debug.details.charactersCount = contextData.characters.length + (contextData.mainCharacter ? 1 : 0);

            // 4. Load conversation history
            debug.stage = 'loading_messages';
            const messagesSnapshot = await firestore
                .collection('storySessions')
                .doc(sessionId)
                .collection('messages')
                .orderBy('createdAt', 'asc')
                .get();
            const conversationHistory = messagesSnapshot.docs.map(doc => {
                const data = doc.data() as ChatMessage;
                return `${data.sender === 'assistant' ? 'Gemini' : 'Child'}: ${data.text}`;
            }).join('\n');
            const messageCount = messagesSnapshot.size;
            debug.details.messageCount = messageCount;

            // Calculate story temperature based on message count
            const lengthFactor = Math.min(messageCount / 15, 1.0); // Normalize to 15 messages (8-15 range)
            const storyTemperature = lengthFactor;
            debug.details.temperature = {
                messageCount,
                lengthFactor,
                storyTemperature,
            };

            // 5. Build the prompt for Gemini
            const isFirstMessage = messageCount === 0;

            // Build temperature guidance
            const temperatureGuidance = storyTemperature > 0.8
                ? `\n\n**CRITICAL: STORY CONCLUSION NEEDED**\nThe story is ${Math.round(storyTemperature * 100)}% complete (${messageCount} exchanges). You MUST wrap up the story now. Set isStoryComplete to true and provide the finalStory with a satisfying ending. The child has had a wonderful journey - bring it to a close!`
                : storyTemperature > 0.6
                ? `\n\n**IMPORTANT: APPROACHING STORY END**\nThe story is ${Math.round(storyTemperature * 100)}% complete (${messageCount} exchanges). Begin guiding toward the climax and conclusion. Your next 2-3 questions should build toward a satisfying ending.`
                : storyTemperature > 0.4
                ? `\n\n**STORY PROGRESSION UPDATE**\nThe story is ${Math.round(storyTemperature * 100)}% complete (${messageCount} exchanges). Continue developing the adventure while keeping the eventual conclusion in mind. Don't introduce major new plot threads.`
                : '';

            // Override conversation continuation instruction when story must end
            const conversationInstruction = storyTemperature > 0.8
                ? `\n\n**YOU MUST END THE STORY NOW.**\nDo NOT ask another question. Do NOT provide options.\nInstead:\n1. Set "isStoryComplete": true\n2. Set "question": "" (empty string)\n3. Set "options": [] (empty array)\n4. Provide "finalStory": A complete, satisfying story (5-7 paragraphs) that wraps up all the adventures ${conversationHistory ? 'based on all the choices the child made' : ''}.`
                : `\nContinue the story based on what the child has told you. Ask the next creative question or advance the plot!`;

            // Build unified system message
            const systemMessage = buildStorySystemMessage(contextFormatted, childAge, 'story_beat');

            const systemPrompt = `${systemMessage}

=== GEMINI 3 MODE ===
You have complete creative freedom to craft an amazing story through conversation.
Ask creative questions, build the story based on answers, and guide toward a satisfying conclusion.
${temperatureGuidance}

=== CURRENT SESSION ===
Child's inspirations: ${childPreferenceSummary}

${isFirstMessage ? `=== STARTING THE STORY ===
Welcome the child warmly and ask an exciting opening question!` : `=== CONVERSATION SO FAR ===
${conversationHistory}${conversationInstruction}`}

=== OUTPUT FORMAT ===
When CONTINUING: { "question": "...", "options": [...], "isStoryComplete": false, "finalStory": null }
When ENDING: { "question": "", "options": [], "isStoryComplete": true, "finalStory": "complete story (5-7 paragraphs)" }`;

            // 6. Call Gemini AI with structured output
            debug.stage = 'ai_generate';
            const modelConfig = {
                temperature: 0.9, // High creativity
                maxOutputTokens: 8000, // Increased to handle complex stories with full context
            };
            debug.details.modelConfig = modelConfig;

            let llmResponse;
            const startTime = Date.now();
            const modelName = 'googleai/gemini-2.5-pro';
            try {
                llmResponse = await ai.generate({
                    model: modelName,
                    prompt: systemPrompt,
                    output: {
                        schema: Gemini3OutputSchema,
                    },
                    config: modelConfig,
                });
                await logAIFlow({ flowName: 'gemini3Flow', sessionId, parentId: parentUid, prompt: systemPrompt, response: llmResponse, startTime, modelName });
            } catch (e: any) {
                await logAIFlow({ flowName: 'gemini3Flow', sessionId, parentId: parentUid, prompt: systemPrompt, error: e, startTime, modelName });
                throw e;
            }

            debug.stage = 'extract_output';
            const result = llmResponse.output;

            if (!result) {
                debug.details.rawText = llmResponse.text || 'No text';
                debug.details.finishReason = (llmResponse as any)?.finishReason || 'unknown';
                throw new Error("Model returned no structured output for Gemini 3 flow.");
            }

            debug.details.outputPreview = JSON.stringify(result).slice(0, 300);
            debug.details.finishReason = (llmResponse as any)?.finishReason || 'unknown';

            // Resolve placeholders in question and options
            const allTexts = [
                result.question,
                ...(result.options?.map(o => o.text) || []),
                result.finalStory || ''
            ].join(' ');

            const entityMap = await resolveEntitiesInText(allTexts);

            // Replace placeholders in question
            const resolvedQuestion = await replacePlaceholdersInText(result.question, entityMap);

            // Replace placeholders in options
            const resolvedOptions = await Promise.all(
                (result.options || []).map(async (option) => ({
                    ...option,
                    text: await replacePlaceholdersInText(option.text, entityMap),
                    entities: await extractEntityMetadataFromText(option.text, entityMap),
                }))
            );

            // Replace placeholders in final story if present
            const resolvedFinalStory = result.finalStory
                ? await replacePlaceholdersInText(result.finalStory, entityMap)
                : null;

            // If story is complete, update session status with ORIGINAL (not resolved)
            if (result.isStoryComplete && result.finalStory) {
                await sessionRef.update({
                    status: 'completed',
                    currentPhase: 'completed',
                    gemini3FinalStory: result.finalStory, // Store ORIGINAL with placeholders
                    updatedAt: FieldValue.serverTimestamp(),
                });
            }

            return {
                ok: true,
                sessionId,
                // Return both original and resolved for storage vs display
                question: result.question, // Original with placeholders
                questionResolved: resolvedQuestion, // Resolved for display
                options: result.options || [], // Original with placeholders
                optionsResolved: resolvedOptions, // Resolved for display
                isStoryComplete: result.isStoryComplete || false,
                finalStory: result.finalStory || null, // Original with placeholders
                finalStoryResolved: resolvedFinalStory, // Resolved for display
                debug: {
                    ...debug,
                    fullPrompt: systemPrompt, // Include full prompt for diagnostics
                    modelName: 'googleai/gemini-2.5-pro',
                },
            };

        } catch (e: any) {
            debug.details.error = e.message || String(e);
            return {
                ok: false,
                sessionId,
                errorMessage: `Unexpected error in gemini3Flow: ${e.message || String(e)}`,
                debug,
            };
        }
    }
);
