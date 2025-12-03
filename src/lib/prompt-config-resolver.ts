'use server';
import { getServerFirestore } from '@/lib/server-firestore';
import type { PromptConfig } from './types';

type SessionPromptConfigFields = {
    promptConfigId?: string;
    promptConfigLevelBand?: string;
};

export async function resolvePromptConfigForSession(sessionId: string, phase: 'warmup' | 'storyBeat') {
    const firestore = await getServerFirestore();
    const sessionRef = firestore.collection('storySessions').doc(sessionId);
    const sessionSnap = await sessionRef.get();

    if (!sessionSnap.exists) {
        throw new Error(`Story session ${sessionId} not found.`);
    }

    const session = sessionSnap.data() as SessionPromptConfigFields | undefined;
    const promptConfigId = session?.promptConfigId ?? null;
    const promptConfigLevelBand = session?.promptConfigLevelBand ?? null;

    const debug: any = {
        sessionId,
        phase,
        rawPromptConfigId: promptConfigId,
        levelBand: promptConfigLevelBand,
        triedIds: [] as string[],
    };

    const configsRef = firestore.collection('promptConfigs');

    // 1. Try to load by the specific ID if it exists
    if (promptConfigId) {
        debug.triedIds.push(promptConfigId);
        const directSnap = await configsRef.doc(promptConfigId).get();
        if (directSnap.exists) {
            return { promptConfig: directSnap.data() as PromptConfig, id: promptConfigId, debug };
        }
    }
    
    // 2. Fallback for storyBeat phase
    if (phase === 'storyBeat' && promptConfigLevelBand) {
        const canonicalId = `story_beat_level_${promptConfigLevelBand}_v1`;
        if (!debug.triedIds.includes(canonicalId)) {
            debug.triedIds.push(canonicalId);
            const derivedSnap = await configsRef.doc(canonicalId).get();
            if (derivedSnap.exists) {
                return { promptConfig: derivedSnap.data() as PromptConfig, id: canonicalId, debug };
            }
        }
    }

    // 3. Fallback for warmup phase
    if (phase === 'warmup' && promptConfigLevelBand) {
        const canonicalId = `warmup_level_${promptConfigLevelBand}_v1`;
        if (!debug.triedIds.includes(canonicalId)) {
            debug.triedIds.push(canonicalId);
            const derivedSnap = await configsRef.doc(canonicalId).get();
            if (derivedSnap.exists) {
                return { promptConfig: derivedSnap.data() as PromptConfig, id: canonicalId, debug };
            }
        }
    }
    
    // 4. Ultimate fallback to a known 'low' level config for the phase
    const ultimateFallbackId = `${phase === 'storyBeat' ? 'story_beat' : 'warmup'}_level_low_v1`;
     if (!debug.triedIds.includes(ultimateFallbackId)) {
        debug.triedIds.push(ultimateFallbackId);
        const fallbackSnap = await configsRef.doc(ultimateFallbackId).get();
        if (fallbackSnap.exists) {
            return { promptConfig: fallbackSnap.data() as PromptConfig, id: ultimateFallbackId, debug };
        }
    }


    debug.error = "No matching promptConfig document found after all fallbacks.";
    throw new Error(`PromptConfig resolution failed for session ${sessionId}. Details: ${JSON.stringify(debug)}`);
}
