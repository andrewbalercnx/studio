
'use server';

/**
 * @fileOverview Flow to initialize a new story session.
 * 
 * NOTE: This server action is currently not used. The logic has been moved
 * to the client-side in /story/start/page.tsx to work around a server
 * credential issue. It is kept here for reference.
 */

import { getFirestore } from 'firebase-admin/firestore';
import { initFirebaseAdminApp } from '@/firebase/admin/app';
import type { ChildProfile, StorySession, PromptConfig } from '@/lib/types';

initFirebaseAdminApp();

type StartWarmupStoryInput = {
    childId: string;
    childDisplayName: string | null;
};

type StartWarmupStoryResponse = {
    storySessionId: string;
    childId: string;
    childEstimatedLevel: number;
    chosenLevelBand: string;
    promptConfigSummary: {
        id: string;
        phase: string;
        levelBand: string;
        version: number;
        status: string;
    };
    initialAssistantMessage: string;
};

type ErrorResponse = {
    error: true;
    message: string;
};


export async function startWarmupStory(input: StartWarmupStoryInput): Promise<StartWarmupStoryResponse | ErrorResponse> {
    const { childId, childDisplayName } = input;
    
    if (!childId) {
        return { error: true, message: "Missing childId" };
    }

    const firestore = getFirestore();
    const childRef = firestore.collection('children').doc(childId);

    let childProfile: ChildProfile;
    let childEstimatedLevel: number;

    try {
        const childDoc = await childRef.get();

        if (!childDoc.exists) {
            const createdAt = new Date();
            const newChildProfile: ChildProfile = {
                id: childId,
                displayName: childDisplayName || 'Unnamed Child',
                ownerParentUid: 'legacy-parent',
                createdAt,
                likes: [],
                dislikes: [],
                estimatedLevel: 2,
                favouriteGenres: ["funny", "magical"],
                favouriteCharacterTypes: ["self", "pet"],
                preferredStoryLength: "short",
                helpPreference: "more_scaffolding"
            };
            await childRef.set(newChildProfile);
            childProfile = newChildProfile;
            childEstimatedLevel = newChildProfile.estimatedLevel ?? 2;
        } else {
            childProfile = childDoc.data() as ChildProfile;
            childEstimatedLevel = typeof childProfile.estimatedLevel === 'number' ? childProfile.estimatedLevel : 2;
        }

        // Determine level band
        let chosenLevelBand: string;
        if (childEstimatedLevel <= 2) chosenLevelBand = "low";
        else if (childEstimatedLevel === 3) chosenLevelBand = "medium";
        else if (childEstimatedLevel >= 4) chosenLevelBand = "high";
        else chosenLevelBand = "low"; // Default case

        // Create new story session
        const storySessionsRef = firestore.collection('storySessions');
        const newSessionRef = storySessionsRef.doc();
        const now = new Date();
        const newSessionData: Omit<StorySession, 'messages'> = {
            id: newSessionRef.id,
            childId: childId,
            parentUid: childProfile.ownerParentUid,
            status: "in_progress",
            currentPhase: "warmup",
            currentStepIndex: 0,
            storyTitle: "",
            storyVibe: "",
            createdAt: now,
            updatedAt: now,
        };
        await newSessionRef.set(newSessionData);

        // Select prompt config
        const promptConfigsRef = firestore.collection('promptConfigs');
        const query = promptConfigsRef
            .where('phase', '==', 'warmup')
            .where('levelBand', '==', chosenLevelBand)
            .where('status', '==', 'live')
            .limit(1);

        let promptConfigSnapshot = await query.get();
        let promptConfig: any = null; // Changed to any to satisfy TS on fallback
        
        if (promptConfigSnapshot.empty) {
            // Fallback
            const fallbackRef = firestore.collection('promptConfigs').doc('warmup_level_low_v1');
            const fallbackDoc = await fallbackRef.get();
            if (fallbackDoc.exists) {
                promptConfig = fallbackDoc.data() as PromptConfig;
            }
        } else {
            promptConfig = promptConfigSnapshot.docs[0].data() as PromptConfig;
        }
        
        if (!promptConfig) {
            return { error: true, message: "No warmup promptConfig found (including fallback)." };
        }
        
        const initialAssistantMessage = "Hi! I am your Story Guide. What would you like me to call you?";

        return {
            storySessionId: newSessionData.id,
            childId: childId,
            childEstimatedLevel: childEstimatedLevel,
            chosenLevelBand: chosenLevelBand,
            promptConfigSummary: {
                id: promptConfig.id,
                phase: promptConfig.phase,
                levelBand: promptConfig.levelBand,
                version: promptConfig.version,
                status: promptConfig.status,
            },
            initialAssistantMessage: initialAssistantMessage,
        };

    } catch (e: any) {
        console.error("Error in startWarmupStory:", e);
        return { error: true, message: e.message || "An unexpected error occurred." };
    }
}

    
