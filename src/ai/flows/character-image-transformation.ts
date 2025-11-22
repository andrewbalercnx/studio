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

const transformImageToCharacterFlow = ai.defineFlow(
  {
    name: 'transformImageToCharacterFlow',
    inputSchema: TransformImageToCharacterInputSchema,
    outputSchema: TransformImageToCharacterOutputSchema,
  },
  async input => {
    const { media } = await ai.generate({
      model: 'googleai/gemini-2.5-flash-image-preview',
      prompt: [
        { media: { url: input.photoDataUri } },
        { text: `Transform this photo into a character in the following art style: ${input.artStyleDescription}.` },
      ],
      config: {
        responseModalities: ['IMAGE'],
      },
    });

    if (!media?.url) {
      throw new Error('Image generation failed.');
    }

    return { transformedImageDataUri: media.url };
  }
);
