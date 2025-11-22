'use server';
/**
 * @fileOverview Provides story suggestions and guiding questions to help young users create engaging stories.
 *
 * - storySuggestionAndGuidance - A function that orchestrates the story creation process.
 * - StorySuggestionAndGuidanceInput - The input type for the storySuggestionAndGuidance function.
 * - StorySuggestionAndGuidanceOutput - The return type for the storySuggestionAndGuidance function.
 */

import {ai} from '@/ai/genkit';
import {z} from 'genkit';

const StorySuggestionAndGuidanceInputSchema = z.object({
  previousResponses: z.array(z.string()).optional().describe('Previous responses from the user, if any.'),
});
export type StorySuggestionAndGuidanceInput = z.infer<typeof StorySuggestionAndGuidanceInputSchema>;

const StorySuggestionAndGuidanceOutputSchema = z.object({
  nextQuestion: z.string().describe('The next guiding question for the user.'),
  storySuggestion: z.string().optional().describe('A story suggestion for the user, if applicable.'),
});
export type StorySuggestionAndGuidanceOutput = z.infer<typeof StorySuggestionAndGuidanceOutputSchema>;

export async function storySuggestionAndGuidance(input: StorySuggestionAndGuidanceInput): Promise<StorySuggestionAndGuidanceOutput> {
  return storySuggestionAndGuidanceFlow(input);
}

const storySuggestionAndGuidanceFlow = ai.defineFlow(
  {
    name: 'storySuggestionAndGuidanceFlow',
    inputSchema: StorySuggestionAndGuidanceInputSchema,
    outputSchema: StorySuggestionAndGuidanceOutputSchema,
  },
  async (input) => {
    const { output } = await ai.generate({
      model: 'googleai/gemini-2.5-flash',
      output: { schema: StorySuggestionAndGuidanceOutputSchema },
      prompt: `You are a helpful assistant that guides children in creating their own stories.

        Based on the child's previous responses (if any), suggest a story idea or ask a question to help them develop their story further.

        Previous Responses: ${input.previousResponses?.join('\n') || 'None'}
        
        If the story is just starting, begin by suggesting a story idea, such as "Once upon a time, there was a magical kingdom...".

        Otherwise, ask a question that encourages them to add details about characters, settings, or plot points.
        Make sure the question is engaging and fun for a child.
      `,
    });
    return output!;
  }
);
