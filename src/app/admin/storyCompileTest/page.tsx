
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
import { Textarea } from '@/components/ui/textarea';

type StoryCompileApiResponse = {
    ok: boolean;
    sessionId?: string;
    errorMessage?: string;
    storyText?: string;
    metadata?: {
        paragraphs?: number;
    };
    debug?: any;
};

export default function AdminStoryCompileTestPage() {
    const { isAuthenticated, isAdmin, loading: authLoading, error: authError } = useAdminStatus();
    const { toast } = useToast();
    
    const [sessionIdInput, setSessionIdInput] = useState('sample-session-1');
    const [loading, setLoading] = useState(false);
    const [lastResponse, setLastResponse] = useState<StoryCompileApiResponse | null>(null);
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
            const response = await fetch('/api/storyCompile', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ sessionId: sessionIdInput }),
            });

            const result: StoryCompileApiResponse = await response.json();
            setLastResponse(result);

            if (!response.ok || !result.ok) {
                setLastError(result.errorMessage || 'An unknown API error occurred.');
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
        page: 'admin-storyCompileTest',
        auth: { isAuthenticated, isAdmin, loading: authLoading, error: authError },
        input: { sessionId: sessionIdInput },
        flowResult: lastResponse,
        error: lastError,
    };
    
    const handleCopyDiagnostics = () => {
        const textToCopy = `Page: admin-storyCompileTest\n\nDiagnostics\n${JSON.stringify(diagnostics, null, 2)}`;
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
                {lastResponse?.ok && lastResponse.storyText && (
                    <CardContent className="space-y-4">
                        <div>
                            <h3 className="font-semibold">Compiled Story Text</h3>
                            <Textarea
                                readOnly
                                value={lastResponse.storyText}
                                className="h-64 mt-2 font-mono text-sm bg-muted"
                            />
                        </div>
                         <div>
                            <h3 className="font-semibold">Metadata</h3>
                            <p className="p-2 bg-muted rounded-md text-sm">
                                Paragraphs: {lastResponse.metadata?.paragraphs ?? 'N/A'}
                            </p>
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
                            {loading ? <><LoaderCircle className="mr-2 h-4 w-4 animate-spin" /> Compiling...</> : 'Run Story Compile'}
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
            <h1 className="text-2xl font-bold mb-1">Story Compile Test</h1>
            <p className="text-muted-foreground mb-6">Test the story compilation Genkit flow for a given session.</p>
            
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
