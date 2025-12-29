import { z } from 'zod';
import { ai } from '@/ai/genkit';
import { getFirestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { logAIFlow } from '@/lib/ai-flow-logger';

const StoryOutputTypeImageInputSchema = z.object({
    storyOutputTypeId: z.string().describe("The ID of the storyOutputType document"),
});

const StoryOutputTypeImageOutputSchema = z.object({
    ok: z.boolean(),
    imageUrl: z.string().optional(),
    errorMessage: z.string().optional(),
});

export async function storyOutputTypeImageFlow(input: z.infer<typeof StoryOutputTypeImageInputSchema>): Promise<z.infer<typeof StoryOutputTypeImageOutputSchema>> {
    try {
        const { storyOutputTypeId } = input;

        // 1. Load storyOutputType document
        const firestore = getFirestore();
        const outputTypeRef = firestore.collection('storyOutputTypes').doc(storyOutputTypeId);
        const outputTypeSnap = await outputTypeRef.get();

        if (!outputTypeSnap.exists) {
            return {
                ok: false,
                errorMessage: `StoryOutputType ${storyOutputTypeId} not found`,
            };
        }

        const outputType = outputTypeSnap.data();
        if (!outputType) {
            return {
                ok: false,
                errorMessage: `StoryOutputType ${storyOutputTypeId} has no data`,
            };
        }

        const { imagePrompt, childFacingLabel } = outputType;

        if (!imagePrompt) {
            return {
                ok: false,
                errorMessage: 'StoryOutputType must have an imagePrompt to generate an image',
            };
        }

        // 2. Generate the image using Gemini image generation
        // The prompt describes what kind of book/output this represents
        const fullPrompt = `${imagePrompt}

Create a whimsical, child-friendly illustration that represents "${childFacingLabel}". The image should be colorful, inviting, and appropriate for young children selecting what kind of story they want to create.`;

        let imageResponse;
        const startTime = Date.now();
        const modelName = 'googleai/gemini-2.5-flash-image-preview';
        try {
            imageResponse = await ai.generate({
                model: modelName,
                prompt: fullPrompt,
                config: {
                    responseModalities: ['TEXT', 'IMAGE'],
                },
            });

            await logAIFlow({
                flowName: 'storyOutputTypeImageFlow',
                prompt: fullPrompt,
                response: imageResponse,
                startTime,
                modelName,
            });
        } catch (e: any) {
            await logAIFlow({
                flowName: 'storyOutputTypeImageFlow',
                prompt: fullPrompt,
                error: e,
                startTime,
                modelName,
            });
            throw e;
        }

        // 3. Extract the generated image
        const media = imageResponse.media;
        if (!media || !media.url) {
            return {
                ok: false,
                errorMessage: 'Image generation failed: No media URL returned',
            };
        }

        // 4. Parse the data URI to get the image buffer
        const dataUrl = media.url;
        const match = /^data:(.+);base64,(.*)$/i.exec(dataUrl);
        if (!match) {
            return {
                ok: false,
                errorMessage: 'Invalid media format returned from model',
            };
        }
        const mimeType = match[1];
        const base64Data = match[2];
        const imageBuffer = Buffer.from(base64Data, 'base64');

        // 5. Upload to Firebase Storage
        const storage = getStorage();
        const bucket = storage.bucket();

        // Determine file extension from mime type
        let extension = 'png';
        if (mimeType === 'image/jpeg') extension = 'jpg';
        else if (mimeType === 'image/webp') extension = 'webp';
        else if (mimeType === 'image/png') extension = 'png';

        const fileName = `storyOutputTypes/${storyOutputTypeId}/image_${Date.now()}.${extension}`;
        const file = bucket.file(fileName);

        await file.save(imageBuffer, {
            metadata: {
                contentType: mimeType,
            },
        });

        // Make the file publicly accessible
        await file.makePublic();

        // Get the public URL
        const publicUrl = `https://storage.googleapis.com/${bucket.name}/${fileName}`;

        // 6. Update the storyOutputType document with the new image URL
        await outputTypeRef.update({
            imageUrl: publicUrl,
            updatedAt: new Date(),
        });

        return {
            ok: true,
            imageUrl: publicUrl,
        };

    } catch (e: any) {
        console.error('[storyOutputTypeImageFlow] Error:', e);
        return {
            ok: false,
            errorMessage: `Unexpected error: ${e.message || String(e)}`,
        };
    }
}
