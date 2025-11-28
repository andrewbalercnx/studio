'use server';

/**
 * @fileOverview Orchestrates the story creation process through a chat-based flow.
 *
 * - continueChat - A function that takes the current chat history and returns the assistant's next message.
 * - ContinueChatInput - The input type for the continueChat function.
 * - ContinueChatOutput - The return type for the continueChat function.
 */

import { ai } from '@/ai/genkit';
import { z } from 'genkit';
import { StorySession, ChatMessage } from '@/lib/types';


// Define Zod schemas that match the TypeScript types
const ChoiceSchema = z.object({
  id: z.string(),
  text: z.string(),
  value: z.string().optional(),
});

const ChatMessageSchema = z.object({
  id: z.string(),
  role: z.enum(['user', 'assistant', 'system']),
  content: z.string(),
  choices: z.array(ChoiceSchema).optional(),
});

const CharacterSchema = z.object({
    name: z.string(),
    type: z.enum(['self', 'friend', 'family', 'pet', 'imaginary']),
    traits: z.array(z.string()),
    goal: z.string(),
});

const StoryBeatSchema = z.object({
    label: z.string(),
    childPlanText: z.string(),
    draftText: z.string(),
});

const StorySessionSchema = z.object({
    id: z.string(),
    childId: z.string(),
    status: z.enum(['in_progress', 'completed']),
    currentPhase: z.string(),
    currentStepIndex: z.number(),
    storyTitle: z.string().optional(),
    storyVibe: z.string().optional(),
    characters: z.array(CharacterSchema),
    beats: z.array(StoryBeatSchema),
    finalStoryText: z.string().optional(),
    createdAt: z.string().datetime().describe('The ISO 8601 date string of when the session was created.'),
    updatedAt: z.string().datetime().describe('The ISO 8601 date string of when the session was last updated.'),
    messages: z.array(ChatMessageSchema),
});


const ContinueChatInputSchema = z.object({
  session: StorySessionSchema.describe('The entire story session object, including all messages.'),
});
export type ContinueChatInput = z.infer<typeof ContinueChatInputSchema>;


const ContinueChatOutputSchema = z.object({
  message: ChatMessageSchema.describe('The next message from the assistant.'),
});
export type ContinueChatOutput = z.infer<typeof ContinueChatOutputSchema>;


const continueChatFlow = ai.defineFlow(
  {
    name: 'continueChatFlow',
    inputSchema: ContinueChatInputSchema,
    outputSchema: ContinueChatOutputSchema,
  },
  async ({ session }) => {
    // For now, we'll return a simple, hard-coded response.
    // In the future, this will contain complex logic driven by JSON configuration.
    
    const hasMessages = session.messages.length > 0;

    if (!hasMessages) {
        return {
            message: {
                id: `assistant-${Date.now()}`,
                role: 'assistant' as const,
                content: "Hi! I'm your Story Guide. I'm so excited to help you create a story. First, what's your name?",
            }
        }
    }
    
    const lastUserMessage = session.messages[session.messages.length - 1];
    
    // This is a simple, temporary logic tree. This will be replaced by a
    // configuration-driven system.
    if (lastUserMessage.content.toLowerCase().includes('hello') || session.messages.length === 1) {
         return {
            message: {
                id: `assistant-${Date.now()}`,
                role: 'assistant' as const,
                content: `That's a great name! Now, what kind of story should we make?`,
                choices: [
                    { id: 'vibe-1', text: 'Funny' },
                    { id: 'vibe-2', text: 'Magical' },
                    { id: 'vibe-3', text: 'Mystery' },
                ]
            }
        };
    }

    return {
        message: {
            id: `assistant-${Date.now()}`,
            role: 'assistant' as const,
            content: "That sounds wonderful! Let's add a character. Who is the main character in our story?",
        }
    }
  }
);

export async function continueChat(input: ContinueChatInput): Promise<ContinueChatOutput> {
  return continueChatFlow(input);
}
