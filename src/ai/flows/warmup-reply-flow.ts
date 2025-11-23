
'use server';

/**
 * @fileOverview A Genkit flow to generate a reply during the "warmup" phase.
 */
import { ai } from '@/ai/genkit';
import { initializeFirebase } from '@/firebase';
import { getDoc, doc, collection, getDocs, query, orderBy } from 'firebase/firestore';
import { z } from 'genkit';
import type { StorySession, ChatMessage, PromptConfig } from '@/lib/types';

// Define a type for the debug object
type PromptDebug = {
    hasSystem: boolean;
    systemLength: number;
    messagesType: string;
    messageCount: number;
    messagesShape: any[];
} | null;


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
            debug: z.any().optional(),
        }),
    },
    async ({ sessionId }) => {
        let promptDebug: PromptDebug = null;

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
            
            const history = messagesSnapshot.docs.map(doc => {
                const data = doc.data();
                if (!data.text || typeof data.text !== 'string') {
                    return null;
                }
                const role = data.sender === 'child' ? 'user' : 'model';
                return {
                    role: role,
                    content: [{ text: data.text }],
                };
            }).filter(Boolean) as any[]; // Filter out nulls and cast
            
            // 4. Build prompt
            const systemPromptText = [
                promptConfig.systemPrompt,
                `MODE INSTRUCTIONS: ${promptConfig.modeInstructions}`,
            ].join('\n\n');

            // 5. Build the promptDebug object
            promptDebug = {
                hasSystem: typeof systemPromptText === 'string' && systemPromptText.length > 0,
                systemLength: typeof systemPromptText === 'string' ? systemPromptText.length : 0,
                messagesType: typeof history,
                messageCount: Array.isArray(history) ? history.length : 0,
                messagesShape: Array.isArray(history) ? history.map((msg, index) => {
                    if (!msg) {
                        return { index, hasValue: false };
                    }
                    const contentIsArray = Array.isArray(msg.content);
                    const firstPart = contentIsArray && msg.content[0];
                    return {
                        index,
                        hasValue: true,
                        role: msg.role || null,
                        hasContentArray: contentIsArray,
                        contentLength: contentIsArray ? msg.content.length : 0,
                        firstPartKeys: firstPart ? Object.keys(firstPart) : [],
                        firstTextPreview: firstPart && typeof firstPart.text === 'string' ? firstPart.text.slice(0, 40) : null,
                    };
                }) : [],
            };

            // 6. Pre-flight validation of the messages array
            if (!Array.isArray(history)) {
                throw new Error('Invalid history: not an array');
            }
            for (let i = 0; i < history.length; i++) {
                const msg = history[i];
                if (!msg) throw new Error(`Invalid message at index ${i}: message is null or undefined.`);
                if (typeof msg.role !== 'string') throw new Error(`Invalid message at index ${i}: role is missing or not a string.`);
                if (!Array.isArray(msg.content)) throw new Error(`Invalid message at index ${i}: content is missing or not an array.`);
                if (msg.content.length === 0 || !msg.content[0]) throw new Error(`Invalid message at index ${i}: content[0] is missing.`);
                if (typeof msg.content[0].text !== 'string') throw new Error(`Invalid message at index ${i}: content[0].text is missing or not a string.`);
            }
            
            // 7. Call Gemini
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
                debug: promptDebug,
            };
        }
    }
);
