
'use client';

import { useState } from 'react';
import { useUser } from '@/firebase/auth/use-user';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { LoaderCircle } from 'lucide-react';
import Link from 'next/link';
import { useFirestore } from '@/firebase';
import { doc, getDoc, setDoc, serverTimestamp, addDoc, collection, query, where, getDocs, limit } from 'firebase/firestore';
import type { PromptConfig, ChildProfile } from '@/lib/types';


type StartStoryResponse = {
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
    error?: undefined;
} | {
    error: true;
    message: string;
};


export default function StartStoryPage() {
    const { user, loading: userLoading } = useUser();
    const firestore = useFirestore();
    const [isLoading, setIsLoading] = useState(false);
    const [response, setResponse] = useState<StartStoryResponse | null>(null);

    const handleStartStory = async () => {
        if (!user || !firestore) return;
        
        setIsLoading(true);
        setResponse(null);

        const childDisplayName = user.displayName 
            || (user.email ? user.email.split('@')[0] : null)
            || "Unnamed Child";
        
        const childId = user.uid;

        try {
            // 1. Ensure a child profile exists
            const childRef = doc(firestore, 'children', childId);
            const childDoc = await getDoc(childRef);
            let childProfile: ChildProfile;

            if (!childDoc.exists()) {
                const newChildProfileData = {
                    id: childId,
                    displayName: childDisplayName,
                    createdAt: serverTimestamp(),
                    estimatedLevel: 2,
                    favouriteGenres: ["funny", "magical"],
                    favouriteCharacterTypes: ["self", "pet"],
                    preferredStoryLength: "short",
                    helpPreference: "more_scaffolding",
                };
                await setDoc(childRef, newChildProfileData);
                childProfile = { ...newChildProfileData, createdAt: new Date() } as ChildProfile;
            } else {
                childProfile = childDoc.data() as ChildProfile;
            }

            // 2. Determine child level band
            const childEstimatedLevel = childProfile.estimatedLevel || 2;
            let chosenLevelBand: 'low' | 'medium' | 'high';
            if (childEstimatedLevel <= 2) chosenLevelBand = "low";
            else if (childEstimatedLevel === 3) chosenLevelBand = "medium";
            else chosenLevelBand = "high";

            // 3. Select a warmup promptConfig
            const promptConfigsRef = collection(firestore, 'promptConfigs');
            const q = query(
                promptConfigsRef, 
                where('phase', '==', 'warmup'),
                where('levelBand', '==', chosenLevelBand),
                where('status', '==', 'live'),
                limit(1)
            );
            
            const querySnapshot = await getDocs(q);
            let promptConfig: PromptConfig | null = null;
            
            if (!querySnapshot.empty) {
                promptConfig = querySnapshot.docs[0].data() as PromptConfig;
            } else {
                const fallbackRef = doc(firestore, 'promptConfigs', 'warmup_level_low_v1');
                const fallbackDoc = await getDoc(fallbackRef);
                if (fallbackDoc.exists()) {
                    promptConfig = fallbackDoc.data() as PromptConfig;
                }
            }

            if (!promptConfig) {
                throw new Error("No warmup promptConfig found (including fallback).");
            }
            
            // 4. Create a new story session, now including prompt info
            const storySessionsRef = collection(firestore, 'storySessions');
            const newSessionData = {
                childId: childId,
                status: "in_progress",
                currentPhase: "warmup",
                currentStepIndex: 0,
                storyTitle: "",
                storyVibe: "",
                createdAt: serverTimestamp(),
                updatedAt: serverTimestamp(),
                characters: [],
                beats: [],
                promptConfigId: promptConfig.id,
                promptConfigLevelBand: chosenLevelBand,
            };
            const newSessionRef = await addDoc(storySessionsRef, newSessionData);
            const storySessionId = newSessionRef.id;
            await setDoc(newSessionRef, { id: storySessionId }, { merge: true });

            
            const initialAssistantMessage = "Hi! I am your Story Guide. What would you like me to call you?";

            // 5. Store initial message in subcollection
            const messagesRef = collection(firestore, 'storySessions', storySessionId, 'messages');
            await addDoc(messagesRef, {
                sender: 'assistant',
                text: initialAssistantMessage,
                createdAt: serverTimestamp()
            });

            // 6. Build response object
            const result: StartStoryResponse = {
                storySessionId: storySessionId,
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
                initialAssistantMessage,
            };
            setResponse(result);

        } catch (e: any) {
            console.error("Error starting story:", e);
            setResponse({ error: true, message: e.message || 'An unknown error occurred.' });
        }
        setIsLoading(false);
    };
    
    const diagnostics = {
        page: 'story-start',
        auth: {
            isAuthenticated: !!user,
            email: user?.email || null,
        },
        result: {
            hasResponse: !!response,
            hasError: !!response?.error,
            storySessionId: response && !response.error ? response.storySessionId : null,
            promptConfigId: response && !response.error ? response.promptConfigSummary.id : null,
            chosenLevelBand: response && !response.error ? response.chosenLevelBand : null,
        }
    };
    
    const renderContent = () => {
        if (userLoading) {
            return <div className="flex items-center justify-center"><LoaderCircle className="h-8 w-8 animate-spin text-primary" /></div>;
        }

        if (!user) {
            return (
                <div className="text-center">
                    <p className="text-muted-foreground mb-4">Please sign in to start a story.</p>
                    <Button asChild><Link href="/login">Sign In</Link></Button>
                </div>
            );
        }

        return (
            <div className="space-y-6">
                <div className="text-center">
                    <Button onClick={handleStartStory} disabled={isLoading}>
                        {isLoading ? <><LoaderCircle className="animate-spin mr-2" /> Starting...</> : 'Start a new story'}
                    </Button>
                </div>

                {response && !response.error && (
                    <div className="text-center">
                        <Button asChild>
                            <Link href={`/story/session/${response.storySessionId}`}>Go to this story</Link>
                        </Button>
                    </div>
                )}

                {response && (
                    <Card>
                        <CardHeader>
                            <CardTitle>Backend Response</CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            {response.error ? (
                                <p className="text-destructive">Error: {response.message}</p>
                            ) : (
                                <div>
                                    <p className="font-bold">Assistant:</p>
                                    <p className="p-2 bg-muted rounded-md">{response.initialAssistantMessage}</p>
                                </div>
                            )}

                            <div>
                                <p className="font-bold mt-4">Raw JSON Response:</p>
                                <pre className="bg-muted p-4 rounded-lg overflow-x-auto text-sm">
                                    <code>{JSON.stringify(response, null, 2)}</code>
                                </pre>
                            </div>
                        </CardContent>
                    </Card>
                )}
            </div>
        );
    };

    return (
        <div className="container mx-auto p-4 sm:p-6 md:p-8 max-w-3xl">
            <Card className="mb-8">
                <CardHeader>
                    <CardTitle>Start a Story</CardTitle>
                    <CardDescription>
                        Start a new story with your Story Guide.
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    {renderContent()}
                </CardContent>
            </Card>

            <Card>
                <CardHeader>
                    <CardTitle>Diagnostics</CardTitle>
                </CardHeader>
                <CardContent>
                    <pre className="bg-muted p-4 rounded-lg overflow-x-auto text-sm">
                        <code>{JSON.stringify(diagnostics, null, 2)}</code>
                    </pre>
                </CardContent>
            </Card>
        </div>
    );
}
