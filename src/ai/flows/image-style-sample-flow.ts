import { z } from 'zod';
import { ai } from '@/ai/genkit';
import { getFirestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { logAIFlow } from '@/lib/ai-flow-logger';
import { getImageGenerationModel } from '@/lib/ai-model-config';

// Fallback model name if config fails to load
const FALLBACK_IMAGE_MODEL = 'googleai/gemini-2.5-flash-image';

const ImageStyleSampleInputSchema = z.object({
    imageStyleId: z.string().describe("The ID of the imageStyle document"),
});

const ImageStyleSampleOutputSchema = z.object({
    ok: z.boolean(),
    imageUrl: z.string().optional(),
    errorMessage: z.string().optional(),
});

export async function imageStyleSampleFlow(input: z.infer<typeof ImageStyleSampleInputSchema>): Promise<z.infer<typeof ImageStyleSampleOutputSchema>> {
    try {
        const { imageStyleId } = input;

        // 1. Load imageStyle document
        const firestore = getFirestore();
        const imageStyleRef = firestore.collection('imageStyles').doc(imageStyleId);
        const imageStyleSnap = await imageStyleRef.get();

        if (!imageStyleSnap.exists) {
            return {
                ok: false,
                errorMessage: `ImageStyle ${imageStyleId} not found`,
            };
        }

        const imageStyle = imageStyleSnap.data();
        if (!imageStyle) {
            return {
                ok: false,
                errorMessage: `ImageStyle ${imageStyleId} has no data`,
            };
        }

        const { sampleDescription, stylePrompt } = imageStyle;

        if (!sampleDescription || !stylePrompt) {
            return {
                ok: false,
                errorMessage: 'ImageStyle must have both sampleDescription and stylePrompt',
            };
        }

        // 2. Generate the image using Gemini image generation
        const fullPrompt = `${sampleDescription}

Style: ${stylePrompt}`;

        // Load the image generation model from central config
        const imageModel = await getImageGenerationModel().catch(() => FALLBACK_IMAGE_MODEL);

        let imageResponse;
        const startTime = Date.now();
        const modelName = imageModel;
        try {
            imageResponse = await ai.generate({
                model: imageModel,
                prompt: fullPrompt,
                config: {
                    responseModalities: ['TEXT', 'IMAGE'],
                },
            });
        } catch (e: any) {
            await logAIFlow({
                flowName: 'imageStyleSampleFlow',
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
            const finishReason = imageResponse.finishReason;
            const finishMessage = imageResponse.finishMessage;
            const textResponse = imageResponse.text?.substring(0, 200);
            const failureReason = `No image returned. finishReason=${finishReason}, finishMessage=${finishMessage || 'none'}, text=${textResponse || 'none'}`;

            // Log the failed attempt - mark as failure
            await logAIFlow({
                flowName: 'imageStyleSampleFlow',
                prompt: fullPrompt,
                response: imageResponse,
                startTime,
                modelName,
                isFailure: true,
                failureReason,
            });
            return {
                ok: false,
                errorMessage: `Image generation failed: ${failureReason}`,
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

        const fileName = `imageStyles/${imageStyleId}/sample_${Date.now()}.${extension}`;
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

        // Log success with the final image URL
        await logAIFlow({
            flowName: 'imageStyleSampleFlow',
            prompt: fullPrompt,
            response: imageResponse,
            startTime,
            modelName,
            imageUrl: publicUrl,
        });

        // 6. Update the imageStyle document with the new sample image URL
        await imageStyleRef.update({
            sampleImageUrl: publicUrl,
            updatedAt: new Date(),
        });

        return {
            ok: true,
            imageUrl: publicUrl,
        };

    } catch (e: any) {
        console.error('[imageStyleSampleFlow] Error:', e);
        return {
            ok: false,
            errorMessage: `Unexpected error: ${e.message || String(e)}`,
        };
    }
}
