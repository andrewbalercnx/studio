
'use client';

import { useState, useEffect } from 'react';
import { useAdminStatus } from '@/hooks/use-admin-status';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { LoaderCircle } from 'lucide-react';
import { DiagnosticsPanel } from '@/components/diagnostics-panel';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useFirestore } from '@/firebase';
import { collection, query, orderBy, limit, onSnapshot } from 'firebase/firestore';
import type { StorySession } from '@/lib/types';

type StoryCompileApiResponse = {
    ok: boolean;
    sessionId?: string;
    errorMessage?: string;
    storyText?: string;         // Resolved text with names
    rawStoryText?: string;      // Text with $$id$$ placeholders
    synopsis?: string;
    metadata?: {
        paragraphs?: number;
    };
    debug?: any;
};

type SessionOption = {
    id: string;
    childId: string;
    status: string;
    currentPhase: string;
    storyMode?: string;
    storyTypeId?: string;
    parentUid?: string;
    hasGeminiFinalStory?: boolean;
    friendsPhase?: string;
};

// Determine if a session can be compiled based on its mode and state
function getCompileStatus(session: SessionOption): { canCompile: boolean; reason: string } {
    const { storyMode, childId, storyTypeId, parentUid, hasGeminiFinalStory, friendsPhase, currentPhase } = session;

    // Friends mode requires story_generation to be complete
    if (storyMode === 'friends') {
        if (friendsPhase === 'complete') {
            return { canCompile: true, reason: 'Friends story ready' };
        }
        return { canCompile: false, reason: `Friends mode in '${friendsPhase || currentPhase}' phase (needs 'complete')` };
    }

    // Wizard mode requires story generation to be complete (status: completed or currentPhase: final)
    if (storyMode === 'wizard') {
        if (currentPhase === 'final' || session.status === 'completed') {
            return { canCompile: true, reason: 'Wizard story ready' };
        }
        return { canCompile: false, reason: `Wizard mode in '${currentPhase}' phase (needs story doc)` };
    }

    // Gemini modes require final story text
    if (storyMode === 'gemini3' || storyMode === 'gemini4') {
        if (hasGeminiFinalStory) {
            return { canCompile: true, reason: `${storyMode} story ready` };
        }
        return { canCompile: false, reason: `${storyMode} mode missing final story text` };
    }

    // Standard chat mode requires childId, storyTypeId, and parentUid
    if (!childId) {
        return { canCompile: false, reason: 'Missing childId' };
    }
    if (!storyTypeId) {
        return { canCompile: false, reason: 'Missing storyTypeId' };
    }
    if (!parentUid) {
        return { canCompile: false, reason: 'Missing parentUid' };
    }

    return { canCompile: true, reason: 'Chat mode ready' };
}

export default function AdminStoryCompileTestPage() {
    const { isAuthenticated, isAdmin, isWriter, loading: authLoading, error: authError } = useAdminStatus();
    const { toast } = useToast();
    const firestore = useFirestore();

    const [sessionIdInput, setSessionIdInput] = useState('');
    const [loading, setLoading] = useState(false);
    const [lastResponse, setLastResponse] = useState<StoryCompileApiResponse | null>(null);
    const [lastError, setLastError] = useState<string | null>(null);

    // Session list state
    const [sessions, setSessions] = useState<SessionOption[]>([]);
    const [sessionsLoading, setSessionsLoading] = useState(true);
    const [sessionsError, setSessionsError] = useState<string | null>(null);

    // Load sessions from Firestore
    useEffect(() => {
        if (!firestore || (!isAdmin && !isWriter)) {
            setSessionsLoading(false);
            return;
        }

        setSessionsLoading(true);
        const sessionsRef = collection(firestore, 'storySessions');
        const sessionsQuery = query(sessionsRef, orderBy('createdAt', 'desc'), limit(50));

        const unsubscribe = onSnapshot(sessionsQuery,
            (snapshot) => {
                const sessionList = snapshot.docs.map(d => {
                    const data = d.data() as StorySession;
                    return {
                        id: d.id,
                        childId: data.childId || '',
                        status: data.status || 'unknown',
                        currentPhase: data.currentPhase || 'unknown',
                        storyMode: data.storyMode,
                        storyTypeId: data.storyTypeId,
                        parentUid: data.parentUid,
                        hasGeminiFinalStory: !!(data.gemini3FinalStory || data.gemini4FinalStory),
                        friendsPhase: data.friendsPhase,
                    };
                });
                setSessions(sessionList);
                setSessionsLoading(false);
                setSessionsError(null);

                // Auto-select first compilable session, or first session if none are compilable
                if (sessionList.length > 0 && !sessionIdInput) {
                    const compilableSession = sessionList.find(s => getCompileStatus(s).canCompile);
                    setSessionIdInput(compilableSession?.id || sessionList[0].id);
                }
            },
            (err) => {
                console.error("Error fetching story sessions:", err);
                setSessionsError("Could not fetch story sessions.");
                setSessions([]);
                setSessionsLoading(false);
            }
        );

        return () => unsubscribe();
    }, [firestore, isAdmin, isWriter]);

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

    const selectedSession = sessions.find(s => s.id === sessionIdInput);
    const diagnostics = {
        page: 'admin-storyCompileTest',
        auth: { isAuthenticated, isAdmin, loading: authLoading, error: authError },
        input: { sessionId: sessionIdInput },
        selectedSession: selectedSession || null,
        sessionsAvailable: sessions.length,
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
                {lastResponse?.ok && lastResponse.storyText && (
                    <CardContent className="space-y-4">
                        <div>
                            <h3 className="font-semibold">Resolved Story Text <Badge variant="outline" className="ml-2">names shown</Badge></h3>
                            <Textarea
                                readOnly
                                value={lastResponse.storyText}
                                className="h-64 mt-2 font-mono text-sm bg-muted"
                            />
                        </div>
                        {lastResponse.rawStoryText && (
                            <div>
                                <h3 className="font-semibold">Raw Story Text <Badge variant="outline" className="ml-2">$$id$$ placeholders</Badge></h3>
                                <Textarea
                                    readOnly
                                    value={lastResponse.rawStoryText}
                                    className="h-64 mt-2 font-mono text-sm bg-muted"
                                />
                            </div>
                        )}
                        {lastResponse.synopsis && (
                            <div>
                                <h3 className="font-semibold">Synopsis</h3>
                                <p className="p-2 bg-muted rounded-md text-sm">
                                    {lastResponse.synopsis}
                                </p>
                            </div>
                        )}
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
        if (!isAdmin && !isWriter) return <p>You are signed in but do not have admin or writer rights.</p>;

        return (
            <>
                <Card>
                    <CardHeader>
                        <CardTitle>Run Test</CardTitle>
                        <CardDescription>Select an existing session or enter a session ID manually</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        {/* Session Selector */}
                        <div className="space-y-2">
                            <Label>Select Session</Label>
                            {sessionsLoading ? (
                                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                                    <LoaderCircle className="h-4 w-4 animate-spin" />
                                    Loading sessions...
                                </div>
                            ) : sessionsError ? (
                                <p className="text-sm text-destructive">{sessionsError}</p>
                            ) : sessions.length === 0 ? (
                                <p className="text-sm text-muted-foreground">No sessions found</p>
                            ) : (
                                <Select value={sessionIdInput} onValueChange={setSessionIdInput}>
                                    <SelectTrigger>
                                        <SelectValue placeholder="Select a session..." />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {sessions.map((session) => {
                                            const compileStatus = getCompileStatus(session);
                                            return (
                                                <SelectItem key={session.id} value={session.id}>
                                                    <div className="flex items-center gap-2">
                                                        <span className={`w-2 h-2 rounded-full ${compileStatus.canCompile ? 'bg-green-500' : 'bg-red-500'}`} />
                                                        <span className="font-mono text-xs">{session.id.slice(0, 12)}...</span>
                                                        <Badge variant="outline" className="text-xs">
                                                            {session.storyMode || session.currentPhase}
                                                        </Badge>
                                                        <span className="text-xs text-muted-foreground">
                                                            {session.status}
                                                        </span>
                                                    </div>
                                                </SelectItem>
                                            );
                                        })}
                                    </SelectContent>
                                </Select>
                            )}
                            <p className="text-xs text-muted-foreground">
                                {sessions.length} session{sessions.length !== 1 ? 's' : ''} available • {sessions.filter(s => getCompileStatus(s).canCompile).length} compilable (🟢)
                            </p>
                        </div>

                        {/* Manual Session ID Input */}
                        <div className="space-y-2">
                            <Label htmlFor="sessionId">Or Enter Session ID Manually</Label>
                            <Input
                                id="sessionId"
                                value={sessionIdInput}
                                onChange={(e) => setSessionIdInput(e.target.value)}
                                placeholder="Enter a story session ID"
                            />
                        </div>

                        {/* Selected Session Info */}
                        {sessionIdInput && sessions.find(s => s.id === sessionIdInput) && (
                            <div className="p-3 bg-muted rounded-md text-sm">
                                <p className="font-medium mb-1">Selected Session:</p>
                                {(() => {
                                    const session = sessions.find(s => s.id === sessionIdInput)!;
                                    const compileStatus = getCompileStatus(session);
                                    return (
                                        <>
                                            <div className="grid grid-cols-2 gap-1 text-xs">
                                                <span className="text-muted-foreground">ID:</span>
                                                <span className="font-mono">{session.id}</span>
                                                <span className="text-muted-foreground">Child:</span>
                                                <span className="font-mono">{session.childId || 'none'}</span>
                                                <span className="text-muted-foreground">Status:</span>
                                                <span>{session.status}</span>
                                                <span className="text-muted-foreground">Phase:</span>
                                                <span>{session.currentPhase}</span>
                                                {session.storyMode && (
                                                    <>
                                                        <span className="text-muted-foreground">Mode:</span>
                                                        <span>{session.storyMode}</span>
                                                    </>
                                                )}
                                                {session.friendsPhase && (
                                                    <>
                                                        <span className="text-muted-foreground">Friends Phase:</span>
                                                        <span>{session.friendsPhase}</span>
                                                    </>
                                                )}
                                            </div>
                                            <div className={`mt-2 p-2 rounded text-xs ${compileStatus.canCompile ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300' : 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300'}`}>
                                                <span className="font-medium">{compileStatus.canCompile ? '✓ Ready to compile' : '✗ Cannot compile'}:</span> {compileStatus.reason}
                                            </div>
                                        </>
                                    );
                                })()}
                            </div>
                        )}
                    </CardContent>
                    <CardFooter>
                        <Button onClick={handleRunTest} disabled={loading || !sessionIdInput}>
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

            <DiagnosticsPanel pageName="admin-storyCompileTest" data={diagnostics} className="mt-8" />
        </div>
    );
}
