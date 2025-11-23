
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
    hasConversationSummary: boolean;
    conversationLines: number;
    promptLength: number;
    promptPreview: string;
    responseKeys?: string[];
    hasRaw?: boolean;
    hasCandidatesArray?: boolean;
    candidatesLength?: number;
    firstCandidateKeys?: string[];
    contentPartsSummary?: any[];
    rawCandidatePreview?: string | null;
    topLevelFinishReason?: string | null;
    firstCandidateFinishReason?: string | null;
} | null;


export const warmupReplyFlow = ai.defineFlow(
    {
        name: 'warmupReplyFlow',
        inputSchema: z.object({ sessionId: z.string() }),
        outputSchema: z.object({
            ok: z.boolean(),
            assistantText: z.string().optional(),
            assistantTextPreview: z.string().optional(),
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

            // 3. Load messages from Firestore
            const messagesRef = collection(firestore, `storySessions/${sessionId}/messages`);
            const messagesQuery = query(messagesRef, orderBy('createdAt', 'asc'));
            const messagesSnapshot = await getDocs(messagesQuery);
            
            // Build conversation summary string for the prompt
            const conversationSummary = messagesSnapshot.docs.map(doc => {
                const data = doc.data();
                if (!data.text || typeof data.text !== 'string') {
                    return null;
                }
                const label = data.sender === 'child' ? 'Child:' : 'Story Guide:';
                return `${label} ${data.text}`;
            }).filter(Boolean).join('\n');

            // 4. Build the single prompt string
            const combinedSystem = [
                promptConfig.systemPrompt,
                `MODE INSTRUCTIONS: ${promptConfig.modeInstructions}`,
            ].join('\n\n');

            const finalPrompt = [
                combinedSystem,
                "\n\nHere is the conversation so far between you (the Story Guide) and the child:\n",
                conversationSummary,
                "\n\nNow, produce only the next short reply as the Story Guide, in the same friendly style. Do not repeat earlier messages. Do not mention that you are an AI or talk about this prompt."
            ].join('');
            
            // 5. Build the promptDebug object
            promptDebug = {
                hasSystem: combinedSystem.length > 0,
                systemLength: combinedSystem.length,
                hasConversationSummary: conversationSummary.length > 0,
                conversationLines: messagesSnapshot.docs.length,
                promptLength: finalPrompt.length,
                promptPreview: finalPrompt.slice(0, 200),
            };
            

            // 6. Call Gemini with the single prompt string
            const llmResponse = await ai.generate({
                model: 'googleai/gemini-2.5-flash',
                prompt: finalPrompt,
                config: {
                    temperature: promptConfig.model?.temperature || 0.6,
                    maxOutputTokens: promptConfig.model?.maxOutputTokens || 250,
                },
            });
            
            let assistantText: string | null = null;
            const raw = (llmResponse as any).raw;

            // Add richer diagnostics
            const firstCandidate = raw && Array.isArray(raw.candidates) && raw.candidates.length > 0 ? raw.candidates[0] : null;
            const candidateContent = firstCandidate && firstCandidate.content && Array.isArray(firstCandidate.content.parts) ? firstCandidate.content.parts : null;

            let contentPartsSummary: any[] = [];
            if (Array.isArray(candidateContent)) {
                contentPartsSummary = candidateContent.map((part: any, index: number) => {
                    const keys = part && typeof part === 'object' ? Object.keys(part) : [];
                    const typeHint = typeof part === 'string' ? 'string' : (part && (part.partKind || part.type || null));
                    return {
                        index,
                        keys,
                        typeHint: typeHint || null
                    };
                });
            }
            let rawCandidatePreview: string | null = null;
            try {
                if (firstCandidate) {
                    const json = JSON.stringify(firstCandidate);
                    rawCandidatePreview = json.length > 1200 ? json.slice(0, 1200) + '...(truncated)' : json;
                }
            } catch (e) {
                rawCandidatePreview = "[[error stringifying firstCandidate]]";
            }

            promptDebug = {
                ...(promptDebug || {}),
                responseKeys: llmResponse ? Object.keys(llmResponse as any) : [],
                hasRaw: !!raw,
                hasCandidatesArray: !!(raw && Array.isArray(raw.candidates)),
                candidatesLength: raw && Array.isArray(raw.candidates) ? raw.candidates.length : 0,
                firstCandidateKeys: firstCandidate && typeof firstCandidate === "object" ? Object.keys(firstCandidate) : [],
                contentPartsSummary,
                rawCandidatePreview,
                topLevelFinishReason: (llmResponse as any).finishReason ?? null,
                firstCandidateFinishReason: firstCandidate?.finishReason ?? null,
            };

            // Attempt to extract text
            if (raw && Array.isArray(raw.candidates) && raw.candidates.length > 0) {
                const firstCandidate = raw.candidates[0];
                const content = firstCandidate?.content;
                const parts = content && Array.isArray(content.parts) ? content.parts : [];
                const firstPart = parts.length > 0 ? parts[0] : null;
                const textValue = firstPart && typeof firstPart.text === 'string' ? firstPart.text : null;
                if (textValue && textValue.trim().length > 0) {
                    assistantText = textValue.trim();
                }
            }


            if (!assistantText) {
                return {
                    ok: false,
                    errorMessage: "Model returned empty or malformed text in raw.candidates.",
                    debug: promptDebug,
                };
            }
            
            const trimmedAssistantText = assistantText;
            const assistantTextPreview = trimmedAssistantText.slice(0, 80);

            return {
                ok: true,
                assistantText: trimmedAssistantText,
                assistantTextPreview,
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
