
'use server';

/**
 * @fileOverview A Genkit flow to generate a reply during the "warmup" phase.
 */
import { ai } from '@/ai/genkit';
import { initializeFirebase } from '@/firebase';
import { getDoc, doc, collection, getDocs, query, orderBy } from 'firebase/firestore';
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
            const { firestore } = initializeFirebase();

            // 1. Load session
            const sessionRef = doc(firestore, 'storySessions', sessionId);
            const sessionDoc = await getDoc(sessionRef);
            if (!sessionDoc.exists()) {
                return { ok: false, errorMessage: `Failed to load story session with id ${sessionId}: document does not exist.` };
            }
            const session = sessionDoc.data() as StorySession;

            // 2. Load prompt config
            const { promptConfigId, promptConfigLevelBand } = session;
            if (!promptConfigId) {
                return { ok: false, errorMessage: `No promptConfigId found on session ${sessionId}.` };
            }

            const promptConfigRef = doc(firestore, 'promptConfigs', promptConfigId);
            const promptConfigDoc = await getDoc(promptConfigRef);
            if (!promptConfigDoc.exists()) {
                return { ok: false, errorMessage: `Prompt config '${promptConfigId}' not found in promptConfigs collection.` };
            }
            const promptConfig = promptConfigDoc.data() as PromptConfig;

            // 3. Load messages
            const messagesRef = collection(firestore, `storySessions/${sessionId}/messages`);
            const messagesQuery = query(messagesRef, orderBy('createdAt', 'asc'));
            const messagesSnapshot = await getDocs(messagesQuery);
            const messages = messagesSnapshot.docs.map(doc => doc.data() as ChatMessage);

            // 4. Build prompt
            const history = messages.map(msg => ({
                role: msg.sender === 'child' ? 'user' : 'model',
                content: [{ text: msg.text }],
            }));
            
            const systemPromptText = [
                promptConfig.systemPrompt,
                `MODE INSTRUCTIONS: ${promptConfig.modeInstructions}`,
            ].join('\n\n');
            
            // 5. Call Gemini
            const llmResponse = await ai.generate({
                model: 'googleai/gemini-2.5-flash',
                system: systemPromptText,
                history: history,
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
