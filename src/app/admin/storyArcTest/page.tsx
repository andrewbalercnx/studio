
'use client';

import { useState } from 'react';
import { useAdminStatus } from '@/hooks/use-admin-status';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { LoaderCircle } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';

type StoryArcApiResponse = {
    ok: boolean;
    errorMessage?: string;
    nextArcStep?: string;
    plotGuidance?: string;
    arcComplete?: boolean;
};

const basicPlots = [
    'Overcoming the Monster',
    'Rags to Riches',
    'The Quest',
    'Voyage and Return',
    'Comedy',
    'Tragedy',
    'Rebirth'
];

export default function AdminStoryArcTestPage() {
    const { isAuthenticated, isAdmin, loading: authLoading, error: authError } = useAdminStatus();
    const { toast } = useToast();
    
    const [sessionIdInput, setSessionIdInput] = useState('sample-session-1');
    const [storyTypeIdInput, setStoryTypeIdInput] = useState('animal_adventure_v1');
    const [arcStepIndexInput, setArcStepIndexInput] = useState('0');
    const [basicPlotInput, setBasicPlotInput] = useState(basicPlots[0]);
    const [loading, setLoading] = useState(false);
    const [lastResponse, setLastResponse] = useState<StoryArcApiResponse | null>(null);
    const [lastError, setLastError] = useState<string | null>(null);

    const handleRunTest = async () => {
        if (!sessionIdInput || !storyTypeIdInput) {
            toast({ title: 'Session ID and Story Type ID are required', variant: 'destructive' });
            return;
        }
        const arcStepIndex = parseInt(arcStepIndexInput, 10);
        if (isNaN(arcStepIndex)) {
            toast({ title: 'Arc Step Index must be a number', variant: 'destructive' });
            return;
        }

        setLoading(true);
        setLastResponse(null);
        setLastError(null);

        try {
            const response = await fetch('/api/storyArc', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ 
                    sessionId: sessionIdInput,
                    storyTypeId: storyTypeIdInput,
                    arcStepIndex: arcStepIndex,
                    basicPlot: basicPlotInput
                 }),
            });

            const result: StoryArcApiResponse = await response.json();
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
        page: 'admin-storyArcTest',
        auth: { isAuthenticated, isAdmin, loading: authLoading, error: authError },
        input: { 
            sessionId: sessionIdInput,
            storyTypeId: storyTypeIdInput,
            arcStepIndex: arcStepIndexInput,
            basicPlot: basicPlotInput
        },
        flowResult: lastResponse,
        error: lastError,
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
                            <h3 className="font-semibold">Next Arc Step</h3>
                            <p className="p-2 bg-muted rounded-md text-sm font-mono">{lastResponse.nextArcStep}</p>
                        </div>
                         <div>
                            <h3 className="font-semibold">Plot Guidance</h3>
                            <p className="p-2 bg-muted rounded-md text-sm">{lastResponse.plotGuidance}</p>
                        </div>
                         <div>
                            <h3 className="font-semibold">Arc Complete</h3>
                            <p className="p-2 bg-muted rounded-md text-sm">{lastResponse.arcComplete ? 'Yes' : 'No'}</p>
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
                    <CardContent className="space-y-4">
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            <div className="space-y-2">
                                <Label htmlFor="sessionId">Session ID</Label>
                                <Input
                                    id="sessionId"
                                    value={sessionIdInput}
                                    onChange={(e) => setSessionIdInput(e.target.value)}
                                    placeholder="Enter a story session ID"
                                />
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="storyTypeId">Story Type ID</Label>
                                <Input
                                    id="storyTypeId"
                                    value={storyTypeIdInput}
                                    onChange={(e) => setStoryTypeIdInput(e.target.value)}
                                    placeholder="e.g., animal_adventure_v1"
                                />
                            </div>
                        </div>
                         <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            <div className="space-y-2">
                                <Label htmlFor="arcStepIndex">Arc Step Index</Label>
                                <Input
                                    id="arcStepIndex"
                                    type="number"
                                    value={arcStepIndexInput}
                                    onChange={(e) => setArcStepIndexInput(e.target.value)}
                                />
                            </div>
                             <div className="space-y-2">
                                <Label htmlFor="basicPlot">Basic Plot</Label>
                                <Select onValueChange={setBasicPlotInput} defaultValue={basicPlotInput}>
                                    <SelectTrigger id="basicPlot">
                                        <SelectValue placeholder="Select a plot type" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {basicPlots.map(plot => (
                                            <SelectItem key={plot} value={plot}>{plot}</SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>
                        </div>
                    </CardContent>
                    <CardFooter>
                        <Button onClick={handleRunTest} disabled={loading}>
                            {loading ? <><LoaderCircle className="mr-2 h-4 w-4 animate-spin" /> Running...</> : 'Run Story Arc Engine'}
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
            <h1 className="text-2xl font-bold mb-1">Story Arc Engine Test</h1>
            <p className="text-muted-foreground mb-6">Test the story arc engine flow for a given session and step.</p>
            
            {renderContent()}

            <Card className="mt-8">
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
