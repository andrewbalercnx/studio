'use client';

import { useState } from 'react';
import { useUser } from '@/firebase/auth/use-user';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { LoaderCircle } from 'lucide-react';
import Link from 'next/link';
import { startWarmupStory } from '@/ai/flows/start-story-flow';

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
    const [isLoading, setIsLoading] = useState(false);
    const [response, setResponse] = useState<StartStoryResponse | null>(null);

    const handleStartStory = async () => {
        if (!user) return;
        
        setIsLoading(true);
        setResponse(null);

        const childDisplayName = user.displayName 
            || (user.email ? user.email.split('@')[0] : null)
            || "Unnamed Child";

        try {
            const result = await startWarmupStory({
                childId: user.uid,
                childDisplayName: childDisplayName
            });
            setResponse(result);
        } catch (e: any) {
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
