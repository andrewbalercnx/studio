
'use client';

import { useState } from 'react';
import { useAdminStatus } from '@/hooks/use-admin-status';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Copy, LoaderCircle } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';

type StoryBeatApiResponse = {
    ok: boolean;
    sessionId: string;
    errorMessage?: string;
    promptConfigId?: string;
    arcStep?: string;
    storyTypeId?: string;
    storyTypeName?: string;
    storyContinuation?: string;
    options?: { id: string; text: string }[];
    debug?: any;
};

export default function AdminStoryBeatTestPage() {
    const { isAuthenticated, isAdmin, email, loading: authLoading, error: authError } = useAdminStatus();
    const { toast } = useToast();
    
    const [sessionIdInput, setSessionIdInput] = useState('sample-session-1');
    const [loading, setLoading] = useState(false);
    const [lastResponse, setLastResponse] = useState<StoryBeatApiResponse | null>(null);
    const [lastError, setLastError] = useState<string | null>(null);

    const handleRunTest = async () => {
        if (!sessionIdInput) {
            toast({ title: 'Session ID is required', variant: 'destructive' });
            return;
        }
        setLoading(true);
        setLastResponse(null);
        setLastError(null);

        try {
            const response = await fetch('/api/storyBeat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ sessionId: sessionIdInput }),
            });

            const result: StoryBeatApiResponse = await response.json();
            setLastResponse(result);

            if (!response.ok || !result.ok) {
                setLastError(result.errorMessage || 'An unknown error occurred.');
                toast({ title: 'Flow Failed', description: result.errorMessage, variant: 'destructive' });
            } else {
                toast({ title: 'Flow Succeeded!' });
            }

        } catch (e: any) {
            const errorMessage = e.message || 'Failed to fetch from API route.';
            setLastError(errorMessage);
            toast({ title: 'API Error', description: errorMessage, variant: 'destructive' });
        } finally {
            setLoading(false);
        }
    };

    const diagnostics = {
        page: 'admin-storyBeatTest',
        auth: { isAuthenticated, isAdmin, email, loading: authLoading, error: authError },
        input: { sessionId: sessionIdInput },
        flowResult: lastResponse,
        error: lastError,
    };
    
    const handleCopyDiagnostics = () => {
        const textToCopy = `Page: admin-storyBeatTest\n\nDiagnostics\n${JSON.stringify(diagnostics, null, 2)}`;
        navigator.clipboard.writeText(textToCopy);
        toast({ title: 'Copied to clipboard!' });
    };

    const renderResults = () => {
        if (!lastResponse && !lastError) return null;

        return (
            <Card>
                <CardHeader>
                    <CardTitle>Flow Results</CardTitle>
                    <CardDescription>
                         Status: {lastResponse?.ok ? <Badge>Success</Badge> : <Badge variant="destructive">Error</Badge>}
                    </CardDescription>
                </CardHeader>
                {lastResponse?.ok && (
                    <CardContent className="space-y-4">
                        <div>
                            <h3 className="font-semibold">Story Continuation</h3>
                            <p className="p-2 bg-muted rounded-md text-sm">{lastResponse.storyContinuation}</p>
                        </div>
                         <div>
                            <h3 className="font-semibold">Options</h3>
                            <ul className="list-disc list-inside space-y-1 text-sm">
                               {lastResponse.options?.map(opt => (
                                   <li key={opt.id}><strong>Option {opt.id}:</strong> {opt.text}</li>
                               ))}
                            </ul>
                        </div>
                    </CardContent>
                )}
                 {lastError && (
                    <CardContent>
                        <p className="text-destructive">{lastError}</p>
                    </CardContent>
                )}
            </Card>
        )
    };

    const renderContent = () => {
        if (authLoading) return <LoaderCircle className="mx-auto h-8 w-8 animate-spin" />;
        if (!isAuthenticated) return <p>You must be signed in to access admin pages.</p>;
        if (!isAdmin) return <p>You are signed in but do not have admin rights.</p>;

        return (
            <>
                <Card>
                    <CardHeader>
                        <CardTitle>Run Test</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div className="space-y-2">
                            <Label htmlFor="sessionId">Session ID</Label>
                            <Input
                                id="sessionId"
                                value={sessionIdInput}
                                onChange={(e) => setSessionIdInput(e.target.value)}
                                placeholder="Enter a story session ID"
                            />
                        </div>
                    </CardContent>
                    <CardFooter>
                        <Button onClick={handleRunTest} disabled={loading}>
                            {loading ? <><LoaderCircle className="mr-2 h-4 w-4 animate-spin" /> Running...</> : 'Run story beat'}
                        </Button>
                    </CardFooter>
                </Card>
                
                <div className="mt-6">
                    {renderResults()}
                </div>
            </>
        );
    };

    return (
        <div className="container mx-auto p-4 sm:p-6 md:p-8 max-w-4xl">
            <h1 className="text-2xl font-bold mb-1">Story Beat Test</h1>
            <p className="text-muted-foreground mb-6">Test the story-beat Genkit flow for a given session.</p>
            
            {renderContent()}

            <Card className="mt-8">
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
