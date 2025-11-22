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
import { ChatMessage, Role, Choice } from '@/lib/types';


// Define Zod schemas that match the TypeScript types
const ChoiceSchema = z.object({
  id: z.string(),
  text: z.string(),
});

const ChatMessageSchema = z.object({
  id: z.string(),
  role: z.enum(['user', 'assistant']),
  content: z.string(),
  choices: z.array(ChoiceSchema).optional(),
});


const ContinueChatInputSchema = z.object({
  messages: z.array(ChatMessageSchema).describe('The history of the conversation so far.'),
});
export type ContinueChatInput = z.infer<typeof ContinueChatInputSchema>;


const ContinueChatOutputSchema = z.object({
  message: ChatMessageSchema.describe('The next message from the assistant.'),
});
export type ContinueChatOutput = z.infer<typeof ContinueChatOutputSchema>;


export async function continueChat(input: ContinueChatInput): Promise<ContinueChatOutput> {
  return continueChatFlow(input);
}


const continueChatFlow = ai.defineFlow(
  {
    name: 'continueChatFlow',
    inputSchema: ContinueChatInputSchema,
    outputSchema: ContinueChatOutputSchema,
  },
  async (input) => {
    // For now, we'll return a simple, hard-coded response.
    // In the future, this will contain complex logic driven by JSON configuration.
    
    const hasMessages = input.messages.length > 0;

    if (!hasMessages) {
        return {
            message: {
                id: `assistant-${Date.now()}`,
                role: 'assistant',
                content: "Hi! I'm your Story Guide. I'm so excited to help you create a story. First, what's your name?",
            }
        }
    }
    
    const lastUserMessage = input.messages[input.messages.length - 1];
    
    // This is a simple, temporary logic tree. This will be replaced by a
    // configuration-driven system.
    if (lastUserMessage.content.toLowerCase().includes('hello') || input.messages.length === 1) {
         return {
            message: {
                id: `assistant-${Date.now()}`,
                role: 'assistant',
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
            role: 'assistant',
            content: "That sounds wonderful! Let's add a character. Who is the main character in our story?",
        }
    }
  }
);
