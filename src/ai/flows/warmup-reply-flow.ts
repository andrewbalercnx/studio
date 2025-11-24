
'use server';

/**
 * @fileOverview A Genkit flow to generate a reply during the "warmup" phase.
 */
import { ai } from '@/ai/genkit';
import { initializeFirebase } from '@/firebase';
import { getDoc, doc, collection, getDocs, query, orderBy, limit } from 'firebase/firestore';
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
    resolvedMaxOutputTokens?: number;
    responseKeys?: string[];
    hasRaw?: boolean;
    hasCandidatesArray?: boolean;
    candidatesLength?: number;
    firstCandidateKeys?: string[];
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
            const messagesQuery = query(messagesRef, orderBy('createdAt', 'desc'), limit(2));
            const messagesSnapshot = await getDocs(messagesQuery);
            
            // Build conversation summary string for the prompt, limiting to the last two messages and 200 chars.
            const conversationSummary = messagesSnapshot.docs
                .reverse() // Reverse to get chronological order
                .map(doc => {
                    const data = doc.data();
                    if (!data.text || typeof data.text !== 'string') {
                        return null;
                    }
                    const label = data.sender === 'child' ? 'Child:' : 'Story Guide:';
                    return `${label} ${data.text}`;
                })
                .filter(Boolean)
                .join('\n')
                .slice(-200); // Truncate to the last 200 characters

            // 4. Build the single prompt string
            const minimalSystemPrompt = `You are the Story Guide, a gentle and friendly helper for young children. Your goal is to learn about the child's world by asking simple, warm questions. Speak in very short, easy-to-understand sentences.`;
            
            const finalPrompt = [
                minimalSystemPrompt,
                "\n\nHere is the conversation so far:\n",
                conversationSummary,
                "\n\nNow, as the Story Guide, give the next short, friendly reply."
            ].join('');
            
            // 5. Build the initial promptDebug object
            promptDebug = {
                hasSystem: minimalSystemPrompt.length > 0,
                systemLength: minimalSystemPrompt.length,
                hasConversationSummary: conversationSummary.length > 0,
                conversationLines: messagesSnapshot.docs.length,
                promptLength: finalPrompt.length,
                promptPreview: finalPrompt.slice(0, 200),
            };
            
            const resolvedMaxOutputTokens = promptConfig.model?.maxOutputTokens ?? 1000;

            // 6. Call Gemini with the single prompt string
            const llmResponse = await ai.generate({
                model: 'googleai/gemini-2.5-flash',
                prompt: finalPrompt,
                config: {
                    ...(promptConfig.model?.temperature != null
                        ? { temperature: promptConfig.model.temperature }
                        : {}),
                    maxOutputTokens: resolvedMaxOutputTokens
                },
            });
            
            let assistantText: string | null = null;
            const raw = (llmResponse as any).raw;

            // Add richer diagnostics
            const candidates = raw?.candidates ?? [];
            const firstCandidate = candidates.length > 0 ? candidates[0] : null;
            
            let rawCandidatePreview: string | null = null;
            try {
                if (firstCandidate) {
                    const json = JSON.stringify(firstCandidate);
                    rawCandidatePreview = json.length > 1200 ? json.slice(0, 1200) + '...(truncated)' : json;
                }
            } catch (e) {
                rawCandidatePreview = "[[error stringifying firstCandidate]]";
            }
            
            const content = firstCandidate?.content;
            const contentParts = Array.isArray(content?.parts) ? content.parts : [];
            const firstPart = contentParts.length > 0 ? contentParts[0] : null;


            promptDebug = {
                ...(promptDebug || {}),
                resolvedMaxOutputTokens,
                responseKeys: llmResponse ? Object.keys(llmResponse as any) : [],
                hasRaw: !!raw,
                hasCandidatesArray: !!(raw && Array.isArray(raw.candidates)),
                candidatesLength: candidates.length,
                firstCandidateKeys: firstCandidate && typeof firstCandidate === "object" ? Object.keys(firstCandidate) : [],
                rawCandidatePreview,
                topLevelFinishReason: (llmResponse as any).finishReason ?? null,
                firstCandidateFinishReason: firstCandidate?.finishReason ?? null,
                contentPartsSummary: contentParts.map((p: any) => Object.keys(p)),
            };

            // Attempt to extract text
            if (firstPart && typeof firstPart.text === 'string' && firstPart.text.trim().length > 0) {
                 assistantText = firstPart.text.trim();
            }


            if (!assistantText) {
                if (promptDebug.firstCandidateFinishReason === 'MAX_TOKENS' || promptDebug.topLevelFinishReason === 'length') {
                    return {
                        ok: false,
                        errorMessage: "Model hit MAX_TOKENS during warmup; increase maxOutputTokens or simplify the prompt.",
                        debug: promptDebug,
                    };
                }
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
