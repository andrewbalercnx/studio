
'use server';

/**
 * @fileOverview A Genkit flow to generate a reply during the "warmup" phase.
 */
import { ai } from '@/ai/genkit';
import { getServerFirestore } from '@/lib/server-firestore';
import { z } from 'genkit';
import type { StorySession, ChatMessage } from '@/lib/types';
import { resolvePromptConfigForSession } from '@/lib/prompt-config-resolver';


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
    llmResponseStringified?: string; // Add this field
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
        let llmResponse: any = null; // To hold the response for debugging

        try {
            const firestore = await getServerFirestore();
            
            // 1. Load session to get level band, etc.
            const sessionDoc = await firestore.collection('storySessions').doc(sessionId).get();
            if (!sessionDoc.exists) {
                return { ok: false, errorMessage: `Failed to load story session with id ${sessionId}: document does not exist.` };
            }
            const session = sessionDoc.data() as StorySession;

            // 2. Resolve prompt config using the shared helper
            const { promptConfig, id: resolvedPromptConfigId, debug: resolverDebug } = await resolvePromptConfigForSession(sessionId, 'warmup');


            // 3. Load messages from Firestore
            const messagesSnapshot = await firestore
                .collection('storySessions')
                .doc(sessionId)
                .collection('messages')
                .orderBy('createdAt', 'desc')
                .limit(2)
                .get();
            
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
            
            const configMax = promptConfig.model?.maxOutputTokens;
            const defaultMax = 1000;
            const rawResolved = typeof configMax === 'number' && configMax > 0 ? configMax : defaultMax;
            const resolvedMaxOutputTokens = Math.max(rawResolved, 10000);

            // 6. Call Gemini with the single prompt string
            llmResponse = await ai.generate({
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

            let llmResponseStringForDebug = '[[llmResponse was null]]';
            if (llmResponse) {
                try {
                    llmResponseStringForDebug = JSON.stringify(llmResponse, null, 2);
                } catch (e) {
                    llmResponseStringForDebug = '[[Could not stringify llmResponse]]';
                }
            }


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
                llmResponseStringified: llmResponseStringForDebug,
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
                        debug: { ...promptDebug, resolverDebug },
                    };
                }
                return {
                    ok: false,
                    errorMessage: "Model returned empty or malformed text in raw.candidates.",
                    debug: { ...promptDebug, resolverDebug },
                };
            }
            
            const trimmedAssistantText = assistantText;
            const assistantTextPreview = trimmedAssistantText.slice(0, 80);

            return {
                ok: true,
                assistantText: trimmedAssistantText,
                assistantTextPreview,
                usedPromptConfigId: resolvedPromptConfigId,
                usedLevelBand: session.promptConfigLevelBand,
                debug: { ...promptDebug, resolverDebug },
            };

        } catch (e: any) {
            const errorMessage = e instanceof Error ? e.message : JSON.stringify(e);
            let llmResponseStringForDebug = '[[llmResponse was null]]';
             if (llmResponse) {
                try {
                    llmResponseStringForDebug = JSON.stringify(llmResponse, null, 2);
                } catch (e) {
                    llmResponseStringForDebug = '[[Could not stringify llmResponse]]';
                }
            }
            return {
                ok: false,
                errorMessage: `Unexpected error in warmupReplyFlow for session ${sessionId}: ${errorMessage}`,
                debug: { ...(promptDebug || {}), error: errorMessage, llmResponseStringified: llmResponseStringForDebug },
            };
        }
    }
);
