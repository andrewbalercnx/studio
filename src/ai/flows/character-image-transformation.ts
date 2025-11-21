'use server';

/**
 * @fileOverview A flow for transforming uploaded photos into characters matching a chosen art style.
 *
 * - transformImageToCharacter - A function that handles the image transformation process.
 * - TransformImageToCharacterInput - The input type for the transformImageToCharacter function.
 * - TransformImageToCharacterOutput - The return type for the transformImageToCharacter function.
 */

import {ai} from '@/ai/genkit';
import {z} from 'genkit';

const TransformImageToCharacterInputSchema = z.object({
  photoDataUri: z
    .string()
    .describe(
      'A photo of a person to transform into a character, as a data URI that must include a MIME type and use Base64 encoding. Expected format: \'data:<mimetype>;base64,<encoded_data>\'.' /* data */
    ),
  artStyleDescription: z.string().describe('The description of the desired art style.'),
});
export type TransformImageToCharacterInput = z.infer<typeof TransformImageToCharacterInputSchema>;

const TransformImageToCharacterOutputSchema = z.object({
  transformedImageDataUri: z
    .string()
    .describe(
      'The transformed image as a data URI that must include a MIME type and use Base64 encoding. Expected format: \'data:<mimetype>;base64,<encoded_data>\'.' /* data */
    ),
});
export type TransformImageToCharacterOutput = z.infer<typeof TransformImageToCharacterOutputSchema>;

export async function transformImageToCharacter(
  input: TransformImageToCharacterInput
): Promise<TransformImageToCharacterOutput> {
  return transformImageToCharacterFlow(input);
}

const transformImageToCharacterPrompt = ai.definePrompt({
  name: 'transformImageToCharacterPrompt',
  input: {schema: TransformImageToCharacterInputSchema},
  output: {schema: TransformImageToCharacterOutputSchema},
  prompt: `You are an AI that transforms photos of people into characters in a specified art style.

  The user will provide a photo and a description of the desired art style.
  Your task is to transform the photo into a character that matches the specified art style.

  Art Style Description: {{{artStyleDescription}}}
  Photo: {{media url=photoDataUri}}

  Return the transformed image as a data URI.
  `,
});

const transformImageToCharacterFlow = ai.defineFlow(
  {
    name: 'transformImageToCharacterFlow',
    inputSchema: TransformImageToCharacterInputSchema,
    outputSchema: TransformImageToCharacterOutputSchema,
  },
  async input => {
    const {output} = await transformImageToCharacterPrompt(input);
    return output!;
  }
);
