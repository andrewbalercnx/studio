
'use server';

/**
 * @fileOverview A Genkit flow to generate a reply during the "warmup" phase.
 */
import { ai } from '@/ai/genkit';
import { initFirebaseAdminApp } from '@/firebase/admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { z } from 'genkit';
import type { StorySession, ChatMessage, PromptConfig } from '@/lib/types';

export const warmupReplyFlow = ai.defineFlow(
    {
        name: 'warmupReplyFlow',
        inputSchema: z.object({ sessionId: z.string() }),
        outputSchema: z.object({
            ok: z.boolean(),
            assistantText: z.string().optional(),
            errorMessage: z.string().optional(),
            usedPromptConfigId: z.string().optional(),
            usedLevelBand: z.string().optional(),
        }),
    },
    async ({ sessionId }) => {
        try {
            await initFirebaseAdminApp();
            const firestore = getFirestore();

            // 1. Load session
            const sessionRef = firestore.collection('storySessions').doc(sessionId);
            const sessionDoc = await sessionRef.get();
            if (!sessionDoc.exists) {
                return { ok: false, errorMessage: `Failed to load story session with id ${sessionId}: document does not exist.` };
            }
            const session = sessionDoc.data() as StorySession;

            // 2. Load prompt config
            const { promptConfigId, promptConfigLevelBand } = session;
            if (!promptConfigId) {
                return { ok: false, errorMessage: `No promptConfigId found on session ${sessionId}.` };
            }

            const promptConfigRef = firestore.collection('promptConfigs').doc(promptConfigId);
            const promptConfigDoc = await promptConfigRef.get();
            if (!promptConfigDoc.exists) {
                return { ok: false, errorMessage: `Prompt config '${promptConfigId}' not found in promptConfigs collection.` };
            }
            const promptConfig = promptConfigDoc.data() as PromptConfig;

            // 3. Load messages
            const messagesRef = sessionRef.collection('messages').orderBy('createdAt', 'asc');
            const messagesSnapshot = await messagesRef.get();
            const messages = messagesSnapshot.docs.map(doc => doc.data() as ChatMessage);

            // 4. Build prompt
            const model = ai.model(promptConfig.model?.name || 'gemini-2.5-pro');

            const history = messages.map(msg => ({
                role: msg.sender === 'child' ? 'user' : 'model',
                content: [{ text: msg.text }],
            }));
            
            const systemPrompt = [
                { text: promptConfig.systemPrompt },
                { text: `MODE INSTRUCTIONS: ${promptConfig.modeInstructions}` },
            ];

            // 5. Call Gemini
            const llmResponse = await ai.generate({
                model,
                prompt: {
                    system: systemPrompt.map(p => p.text).join('\n\n'),
                    messages: [...history],
                },
                config: {
                    temperature: promptConfig.model?.temperature || 0.6,
                    maxOutputTokens: promptConfig.model?.maxOutputTokens || 250,
                },
            });

            const assistantText = llmResponse.text;
            
            return {
                ok: true,
                assistantText,
                usedPromptConfigId: promptConfigId,
                usedLevelBand: promptConfigLevelBand,
            };

        } catch (e: any) {
            const errorMessage = e instanceof Error ? e.message : JSON.stringify(e);
            return {
                ok: false,
                errorMessage: `Unexpected error in warmupReplyFlow for session ${sessionId}: ${errorMessage}`,
            };
        }
    }
);
