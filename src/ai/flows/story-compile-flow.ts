
'use server';

/**
 * @fileOverview A Genkit flow to compile a story session into a single narrative text.
 */

import { ai } from '@/ai/genkit';
import { initializeFirebase } from '@/firebase';
import { getDoc, doc, collection, getDocs, query, orderBy, where, updateDoc, serverTimestamp, setDoc } from 'firebase/firestore';
import { z } from 'genkit';
import type { StorySession, ChatMessage, StoryType, Character, ChildProfile, StoryOutputType } from '@/lib/types';
import { summarizeChildPreferences } from '@/lib/child-preferences';
import { logSessionEvent } from '@/lib/session-events';

type StoryCompileDebugInfo = {
    stage: 'init' | 'loading_session' | 'loading_dependencies' | 'building_prompt' | 'ai_generate' | 'ai_generate_result' | 'json_parse' | 'json_validate' | 'unknown';
    details: Record<string, any>;
};

const StoryCompileResultSchema = z.object({
  storyText: z.string().min(50, "Story text must be at least 50 characters."),
  metadata: z.object({
    paragraphs: z.number().int().nonnegative(),
    estimatedPages: z.number().int().nonnegative().optional(),
  }).optional(),
});


export const storyCompileFlow = ai.defineFlow(
    {
        name: 'storyCompileFlow',
        inputSchema: z.object({ sessionId: z.string(), storyOutputTypeId: z.string() }),
        outputSchema: z.any(), // Using any to allow for custom error/success shapes
    },
    async ({ sessionId, storyOutputTypeId }) => {
        let debug: StoryCompileDebugInfo = { stage: 'init', details: { sessionId, storyOutputTypeId } };

        try {
            const { firestore } = initializeFirebase();

            // 1. Load session
            debug.stage = 'loading_session';
            const sessionRef = doc(firestore, 'storySessions', sessionId);
            const sessionDoc = await getDoc(sessionRef);
            if (!sessionDoc.exists()) {
                throw new Error(`Session with id ${sessionId} not found.`);
            }
            const session = sessionDoc.data() as StorySession;
            const { childId, storyTypeId, parentUid } = session;
            if (!childId || !storyTypeId || !parentUid) {
                throw new Error(`Session is missing childId, storyTypeId, or parentUid.`);
            }
            debug.details.childId = childId;
            debug.details.storyTypeId = storyTypeId;
            debug.details.parentUid = parentUid;

            // 2. Load dependencies
            debug.stage = 'loading_dependencies';
            const childRef = doc(firestore, 'children', childId);
            const storyTypeRef = doc(firestore, 'storyTypes', storyTypeId);
            const storyOutputTypeRef = doc(firestore, 'storyOutputTypes', storyOutputTypeId);
            const charactersQuery = query(collection(firestore, 'characters'), where('sessionId', '==', sessionId));
            const messagesQuery = query(collection(firestore, 'storySessions', sessionId, 'messages'), orderBy('createdAt', 'asc'));

            const [childDoc, storyTypeDoc, storyOutputTypeDoc, charactersSnapshot, messagesSnapshot] = await Promise.all([
                getDoc(childRef),
                getDoc(storyTypeRef),
                getDoc(storyOutputTypeRef),
                getDocs(charactersQuery),
                getDocs(messagesSnapshot),
            ]);
            
            if (!storyTypeDoc.exists()) throw new Error(`StoryType with id ${storyTypeId} not found.`);
            if (!storyOutputTypeDoc.exists()) throw new Error(`StoryOutputType with id ${storyOutputTypeId} not found.`);
            
            const childProfile = childDoc.exists() ? childDoc.data() as ChildProfile : null;
            const storyType = storyTypeDoc.data() as StoryType;
            const storyOutputType = storyOutputTypeDoc.data() as StoryOutputType;
            const characters = charactersSnapshot.docs.map(d => d.data() as Character);
            const messages = messagesSnapshot.docs.map(d => d.data() as ChatMessage);
            const childPreferenceSummary = summarizeChildPreferences(childProfile);

            debug.details.childName = childProfile?.displayName;
            debug.details.storyTypeName = storyType.name;
            debug.details.storyOutputTypeName = storyOutputType.name;
            debug.details.characterCount = characters.length;
            debug.details.messageCount = messages.length;

            // 3. Build story skeleton for the prompt
            debug.stage = 'building_prompt';
            const characterRoster = characters.map(c => `- ${c.displayName} (${c.role}, traits: ${c.traits?.join(', ') || 'none'})`).join('\n');
            const storySoFar = messages
                .filter(m => m.kind !== 'beat_options' && m.kind !== 'character_traits_question') // Exclude non-narrative prompts
                .map(m => {
                    const prefix = m.sender === 'child' ? `$$${childId}$$:` : 'Story Guide:';
                    return `${prefix} ${m.text}`;
                })
                .join('\n');
            
            const systemPrompt = `You are a master storyteller who specializes in compiling interactive chat sessions into a single, beautifully written story for a very young child (age 3-5). The story must be gentle, warm, and safe, with very short, simple sentences. It must be written in the third person. Do not include any meta-commentary, choices, or system prompts from the original chat. The final text should read like a classic, calm picture-book narrative.`;
            
            const finalPrompt = `
${systemPrompt}

**Output Style Requirements:**
- **Target Format:** A ${storyOutputType.name} (${storyOutputType.shortDescription})
- **AI Hints:** ${storyOutputType.aiHints?.style || 'Standard picture book prose.'}
${storyOutputType.aiHints?.allowRhyme ? '- The output MUST rhyme.' : ''}

**Story Context:**
- **Story Type:** ${storyType.name} (${storyType.shortDescription})
- **Main Character:** ${characters.find(c => c.role === 'child')?.displayName || 'The hero'}
- **Child Preferences:** 
${childPreferenceSummary}
- **Other Characters:**
${characterRoster}

**Interactive Session Log:**
${storySoFar}

**Your Task:**
Based on the session log and context, rewrite the entire interaction into a single, coherent story. The story should flow from beginning to end without any interruptions. Pay close attention to the **Output Style Requirements**.

**Output Format (Crucial):**
You MUST return a single JSON object matching this exact shape. Do not include any markdown, code fences, or explanatory text.

{
  "storyText": "A complete, linear story text, rewritten from the session log. It should be at least 50 words long.",
  "metadata": {
    "paragraphs": <number of paragraphs in storyText>
  }
}

Now, generate the JSON object containing the compiled story.
`;
            debug.details.promptLength = finalPrompt.length;
            debug.details.promptPreview = finalPrompt.slice(0, 500) + '...';

            // 4. Call Genkit AI
            debug.stage = 'ai_generate';
            const maxOutputTokens = 4000;
            const temperature = 0.5;
            debug.details.modelName = 'googleai/gemini-2.5-flash';
            debug.details.temperature = temperature;
            debug.details.maxOutputTokens = maxOutputTokens;

            const llmResponse = await ai.generate({
                model: 'googleai/gemini-2.5-flash',
                prompt: finalPrompt,
                config: { temperature, maxOutputTokens },
            });
            
            debug.stage = 'ai_generate_result';
            const rawText = llmResponse.text;
            debug.details.finishReason = (llmResponse as any).finishReason ?? (llmResponse as any).raw?.candidates?.[0]?.finishReason;
            debug.details.rawTextPreview = rawText ? rawText.slice(0, 200) : null;
            if (!rawText || rawText.trim() === '') {
                if (debug.details.finishReason === 'MAX_TOKENS' || debug.details.finishReason === 'length') {
                    throw new Error("Model hit MAX_TOKENS during story compilation.");
                }
                throw new Error("Model returned empty text for story compilation.");
            }
            
            // 5. Parse and validate
            debug.stage = 'json_parse';
            let parsed: z.infer<typeof StoryCompileResultSchema>;
            try {
                const jsonMatch = rawText.match(/```json\n([\s\S]*?)\n```/);
                const jsonToParse = jsonMatch ? jsonMatch[1].trim() : rawText.trim();
                parsed = JSON.parse(jsonToParse);
            } catch (err: any) {
                debug.details.parseError = err.message;
                throw new Error("Model output is not valid JSON for story compilation.");
            }

            debug.stage = 'json_validate';
            const validationResult = StoryCompileResultSchema.safeParse(parsed);
            if (!validationResult.success) {
                debug.details.validationErrors = validationResult.error.issues;
                throw new Error(`Model JSON does not match expected story compilation shape. Errors: ${validationResult.error.message}`);
            }
            
            const { storyText, metadata } = validationResult.data;

            // --- Phase State Correction ---
            await updateDoc(sessionRef, {
                currentPhase: 'final',
                status: 'completed',
                finalStoryText: storyText,
                updatedAt: serverTimestamp(),
                storyOutputTypeId: storyOutputTypeId, // Save the selected output type
            });
            debug.details.phaseCorrected = `Set currentPhase to 'final' and status to 'completed'`;

            // --- StoryBook upsert ---
            const bookRef = doc(firestore, 'storyBooks', sessionId);
            const existingBookSnap = await getDoc(bookRef);
            const now = serverTimestamp();
            const createdAtValue = existingBookSnap.exists()
                ? (existingBookSnap.data()?.createdAt ?? serverTimestamp())
                : now;

            const bookPayload: Record<string, any> = {
                storySessionId: sessionId,
                childId,
                parentUid,
                storyText,
                status: 'text_ready',
                updatedAt: now,
                createdAt: createdAtValue,
                'metadata.storyOutputTypeId': storyOutputTypeId,
                'metadata.storyOutputTypeName': storyOutputType.name,
                'metadata.artStyleHint': storyOutputType.aiHints?.style,
            };

            if (metadata) {
                bookPayload.metadata = {...(bookPayload.metadata || {}), ...metadata};
            }

            if (!existingBookSnap.exists() || !existingBookSnap.data()?.pageGeneration) {
                bookPayload.pageGeneration = { status: 'idle' };
            }
            if (!existingBookSnap.exists() || !existingBookSnap.data()?.imageGeneration) {
                bookPayload.imageGeneration = { status: 'idle' };
            }

            await setDoc(bookRef, bookPayload, { merge: true });
            debug.details.storyBookDocId = bookRef.id;

            await logSessionEvent({
                firestore,
                sessionId,
                event: 'compile.completed',
                status: 'completed',
                source: 'server',
                attributes: {
                    storyTypeId,
                    storyOutputTypeId,
                    bookId: bookRef.id,
                    storyLength: storyText.length,
                },
            });

            return {
                ok: true,
                sessionId,
                storyText,
                metadata,
                bookId: bookRef.id,
                debug: process.env.NODE_ENV === 'development' ? {
                    ...debug,
                    storyLength: storyText.length,
                    paragraphs: metadata?.paragraphs,
                } : undefined,
            };

        } catch (e: any) {
            debug.details.error = e.message || String(e);
            return {
                ok: false,
                sessionId,
                errorMessage: `Unexpected error in storyCompileFlow: ${e.message || String(e)}`,
                debug,
            };
        }
    }
);
