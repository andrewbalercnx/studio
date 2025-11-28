
'use client';

import { useMemo, useState } from 'react';
import { useUser } from '@/firebase/auth/use-user';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Copy, LoaderCircle } from 'lucide-react';
import Link from 'next/link';
import { useFirestore } from '@/firebase';
import { doc, getDoc, setDoc, serverTimestamp, addDoc, collection, query, where, getDocs, limit, updateDoc } from 'firebase/firestore';
import type { PromptConfig, ChildProfile } from '@/lib/types';
import { useToast } from '@/hooks/use-toast';
import { useAppContext } from '@/hooks/use-app-context';


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
    mainCharacterId: string;
    error?: undefined;
} | {
    error: true;
    message: string;
};


export default function StartStoryPage() {
  const { user, loading: userLoading } = useUser();
  const firestore = useFirestore();
  const { toast } = useToast();
  const [isLoading, setIsLoading] = useState(false);
  const [response, setResponse] = useState<StartStoryResponse | null>(null);
  const { activeChildId, activeChildProfile } = useAppContext();
  const selectedChildName = useMemo(
    () => activeChildProfile?.displayName || activeChildId || 'Your child',
    [activeChildProfile, activeChildId]
  );

    const handleStartStory = async () => {
        if (!user || !firestore) return;
        if (!activeChildId) {
            setResponse({ error: true, message: 'Please select a child profile before starting a story.' });
            toast({ title: 'No child selected', description: 'Choose a child from My Stories first.' });
            return;
        }
        
        setIsLoading(true);
        setResponse(null);

        const childId = activeChildId;

        try {
            // 1. Ensure a child profile exists
        const childRef = doc(firestore, 'children', childId);
        const childDoc = await getDoc(childRef);
        if (!childDoc.exists()) {
            throw new Error('Selected child profile was not found.');
        }

        const childProfile = childDoc.data() as ChildProfile;
        if (childProfile.ownerParentUid && childProfile.ownerParentUid !== user.uid) {
            throw new Error('You do not have permission to use this child profile.');
        }
        if (!childProfile.ownerParentUid) {
            await updateDoc(childRef, { ownerParentUid: user.uid });
            childProfile.ownerParentUid = user.uid;
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
            
            // 4. Create a new story session
            const childSessionsRef = collection(firestore, 'children', childId, 'sessions');
            const childSessionRef = doc(childSessionsRef);
            const storySessionId = childSessionRef.id;

            const newSessionData = {
                childId: childId,
                parentUid: user.uid,
                status: "in_progress",
                currentPhase: "warmup",
                currentStepIndex: 0,
                storyTitle: "",
                storyVibe: "",
                createdAt: serverTimestamp(),
                updatedAt: serverTimestamp(),
                promptConfigId: promptConfig.id,
                promptConfigLevelBand: chosenLevelBand,
                id: storySessionId,
            };

            await setDoc(childSessionRef, newSessionData);
            await setDoc(doc(firestore, 'storySessions', storySessionId), newSessionData, { merge: true });

            // 5. Create the main character
            const charactersRef = collection(firestore, 'characters');
            const newCharacterData = {
                ownerChildId: childId,
                sessionId: storySessionId,
                role: 'child',
                name: childProfile.displayName || 'You',
                realPersonRef: {
                    kind: 'self',
                    label: 'You'
                },
                createdAt: serverTimestamp(),
                updatedAt: serverTimestamp()
            };
            const newCharacterRef = await addDoc(charactersRef, newCharacterData);
            const mainCharacterId = newCharacterRef.id;

            // 6. Link character to session and set session ID on session doc
            await Promise.all([
                updateDoc(childSessionRef, { mainCharacterId: mainCharacterId }),
                setDoc(doc(firestore, 'storySessions', storySessionId), { mainCharacterId: mainCharacterId }, { merge: true }),
            ]);
            
            const initialAssistantMessage = "Hi! I am your Story Guide. What would you like me to call you?";

            // 7. Store initial message in subcollection
            const messagePayload = {
                sender: 'assistant',
                text: initialAssistantMessage,
                createdAt: serverTimestamp()
            };
            await addDoc(collection(firestore, 'storySessions', storySessionId, 'messages'), messagePayload);
            await addDoc(collection(firestore, 'children', childId, 'sessions', storySessionId, 'messages'), messagePayload);

            // 8. Build response object
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
                mainCharacterId,
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
            errorMessage: response?.error ? response.message : null,
            storySessionId: response && !response.error ? response.storySessionId : null,
            promptConfigId: response && !response.error ? response.promptConfigSummary.id : null,
            chosenLevelBand: response && !response.error ? response.chosenLevelBand : null,
            hasMainCharacter: !!(response && !response.error && response.mainCharacterId),
            mainCharacterId: response && !response.error ? response.mainCharacterId : null,
            activeChildId: activeChildId || null,
        }
    };

    const handleCopyDiagnostics = () => {
        const textToCopy = `Page: story-start\n\nDiagnostics\n${JSON.stringify(diagnostics, null, 2)}`;
        navigator.clipboard.writeText(textToCopy);
        toast({ title: 'Copied to clipboard!' });
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
                    <div className="mb-4 text-sm text-muted-foreground">
                        {activeChildId ? `Starting a story for ${selectedChildName}` : 'Select a child from My Stories before starting.'}
                    </div>
                    <Button onClick={handleStartStory} disabled={isLoading || !activeChildId}>
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
                <CardHeader className="flex flex-row items-center justify-between">
                    <CardTitle>Diagnostics</CardTitle>
                    <Button variant="ghost" size="icon" onClick={handleCopyDiagnostics}>
                        <Copy className="h-4 w-4" />
                    </Button>
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
