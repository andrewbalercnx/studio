
'use client';

import { useState, useEffect } from 'react';
import { useAdminStatus } from '@/hooks/use-admin-status';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Copy, LoaderCircle, ChevronDown, ChevronUp } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useFirestore } from '@/firebase';
import { collection, query, orderBy, limit, onSnapshot, where } from 'firebase/firestore';
import type { Story, StoryOutputType as StoryOutputTypeT } from '@/lib/types';

type PaginationFlowPage = {
    pageNumber: number;
    bodyText: string;
    entityIds: string[];
    imageDescription?: string;
};

type PaginationFlowResult = {
    ok: boolean;
    storyId?: string;
    pages?: PaginationFlowPage[];
    stats?: {
        pageCount: number;
        targetPageCount: number;
    };
    errorMessage?: string;
    debug?: {
        stage: string;
        details: Record<string, unknown>;
    };
};

type StoryOption = {
    id: string;
    childId: string;
    title: string;
    storyTextPreview: string;
    status?: string;
    createdAt?: any;
};

type OutputTypeOption = {
    id: string;
    name: string;
    category: string;
    pageCount?: number;
    hasPaginationPrompt: boolean;
};

export default function AdminPaginationTestPage() {
    const { isAuthenticated, isAdmin, isWriter, loading: authLoading, error: authError } = useAdminStatus();
    const { toast } = useToast();
    const firestore = useFirestore();

    const [storyIdInput, setStoryIdInput] = useState('');
    const [outputTypeIdInput, setOutputTypeIdInput] = useState('');
    const [loading, setLoading] = useState(false);
    const [lastResponse, setLastResponse] = useState<PaginationFlowResult | null>(null);
    const [lastError, setLastError] = useState<string | null>(null);
    const [showDebug, setShowDebug] = useState(false);

    // Stories list state
    const [stories, setStories] = useState<StoryOption[]>([]);
    const [storiesLoading, setStoriesLoading] = useState(true);
    const [storiesError, setStoriesError] = useState<string | null>(null);

    // Output types list state
    const [outputTypes, setOutputTypes] = useState<OutputTypeOption[]>([]);
    const [outputTypesLoading, setOutputTypesLoading] = useState(true);
    const [outputTypesError, setOutputTypesError] = useState<string | null>(null);

    // Load stories from Firestore
    useEffect(() => {
        if (!firestore || (!isAdmin && !isWriter)) {
            setStoriesLoading(false);
            return;
        }

        setStoriesLoading(true);
        const storiesRef = collection(firestore, 'stories');
        const storiesQuery = query(storiesRef, orderBy('createdAt', 'desc'), limit(50));

        const unsubscribe = onSnapshot(storiesQuery,
            (snapshot) => {
                const storyList = snapshot.docs.map(d => {
                    const data = d.data() as Story;
                    const title = data.metadata?.title || 'Untitled Story';
                    const storyTextPreview = data.storyText?.slice(0, 100) + (data.storyText?.length > 100 ? '...' : '') || '';
                    return {
                        id: d.id,
                        childId: data.childId || 'unknown',
                        title,
                        storyTextPreview,
                        status: data.status,
                        createdAt: data.createdAt,
                    };
                });
                setStories(storyList);
                setStoriesLoading(false);
                setStoriesError(null);

                // Auto-select first story if none selected
                if (storyList.length > 0 && !storyIdInput) {
                    setStoryIdInput(storyList[0].id);
                }
            },
            (err) => {
                console.error("Error fetching stories:", err);
                setStoriesError("Could not fetch stories.");
                setStories([]);
                setStoriesLoading(false);
            }
        );

        return () => unsubscribe();
    }, [firestore, isAdmin, isWriter]);

    // Load output types from Firestore
    useEffect(() => {
        if (!firestore || (!isAdmin && !isWriter)) {
            setOutputTypesLoading(false);
            return;
        }

        setOutputTypesLoading(true);
        const outputTypesRef = collection(firestore, 'storyOutputTypes');
        const outputTypesQuery = query(outputTypesRef, where('status', '==', 'live'), orderBy('name', 'asc'));

        const unsubscribe = onSnapshot(outputTypesQuery,
            (snapshot) => {
                const typesList = snapshot.docs.map(d => {
                    const data = d.data() as StoryOutputTypeT;
                    return {
                        id: d.id,
                        name: data.name,
                        category: data.category,
                        pageCount: data.layoutHints?.pageCount,
                        hasPaginationPrompt: !!data.paginationPrompt,
                    };
                });
                setOutputTypes(typesList);
                setOutputTypesLoading(false);
                setOutputTypesError(null);

                // Auto-select first output type if none selected
                if (typesList.length > 0 && !outputTypeIdInput) {
                    setOutputTypeIdInput(typesList[0].id);
                }
            },
            (err) => {
                console.error("Error fetching output types:", err);
                setOutputTypesError("Could not fetch output types.");
                setOutputTypes([]);
                setOutputTypesLoading(false);
            }
        );

        return () => unsubscribe();
    }, [firestore, isAdmin, isWriter]);

    const handleRunTest = async () => {
        if (!storyIdInput) {
            toast({ title: 'Story ID is required', variant: 'destructive' });
            return;
        }
        if (!outputTypeIdInput) {
            toast({ title: 'Output Type is required', variant: 'destructive' });
            return;
        }

        setLoading(true);
        setLastResponse(null);
        setLastError(null);

        try {
            const response = await fetch('/api/storyPagination', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    storyId: storyIdInput,
                    storyOutputTypeId: outputTypeIdInput,
                }),
            });

            const result: PaginationFlowResult = await response.json();
            setLastResponse(result);

            if (!response.ok || !result.ok) {
                setLastError(result.errorMessage || 'An unknown error occurred.');
                toast({ title: 'Flow Failed', description: result.errorMessage, variant: 'destructive' });
            } else {
                toast({ title: 'Flow Succeeded!', description: `Generated ${result.pages?.length || 0} pages` });
            }

        } catch (e: any) {
            const errorMessage = e.message || 'Failed to run pagination flow.';
            setLastError(errorMessage);
            toast({ title: 'Flow Error', description: errorMessage, variant: 'destructive' });
        } finally {
            setLoading(false);
        }
    };

    const selectedStory = stories.find(s => s.id === storyIdInput);
    const selectedOutputType = outputTypes.find(t => t.id === outputTypeIdInput);

    const diagnostics = {
        page: 'admin-paginationTest',
        auth: { isAuthenticated, isAdmin, loading: authLoading, error: authError },
        input: { storyId: storyIdInput, outputTypeId: outputTypeIdInput },
        selectedStory: selectedStory || null,
        selectedOutputType: selectedOutputType || null,
        storiesAvailable: stories.length,
        outputTypesAvailable: outputTypes.length,
        flowResult: lastResponse,
        error: lastError,
    };

    const handleCopyDiagnostics = () => {
        const textToCopy = `Page: admin-paginationTest\n\nDiagnostics\n${JSON.stringify(diagnostics, null, 2)}`;
        navigator.clipboard.writeText(textToCopy);
        toast({ title: 'Copied to clipboard!' });
    };

    const renderResults = () => {
        if (!lastResponse && !lastError) return null;

        return (
            <Card>
                <CardHeader>
                    <CardTitle>Pagination Results</CardTitle>
                    <CardDescription>
                         Status: {lastResponse?.ok ? <Badge>Success</Badge> : <Badge variant="destructive">Error</Badge>}
                         {lastResponse?.ok && lastResponse.stats && (
                             <span className="ml-2 text-sm">
                                 {lastResponse.stats.pageCount} pages generated
                                 {lastResponse.stats.targetPageCount > 0 && ` (target: ${lastResponse.stats.targetPageCount})`}
                             </span>
                         )}
                    </CardDescription>
                </CardHeader>
                {lastResponse?.ok && lastResponse.pages && (
                    <CardContent className="space-y-4">
                        <div className="grid gap-4">
                            {lastResponse.pages.map((page, index) => (
                                <div key={index} className="border rounded-lg p-4 space-y-2">
                                    <div className="flex items-center gap-2">
                                        <Badge variant="outline">Page {page.pageNumber}</Badge>
                                        {page.entityIds?.length > 0 && (
                                            <span className="text-xs text-muted-foreground">
                                                Actors: {page.entityIds.join(', ')}
                                            </span>
                                        )}
                                    </div>
                                    <div className="text-sm bg-muted p-3 rounded">
                                        {page.bodyText}
                                    </div>
                                    {page.imageDescription && (
                                        <div className="text-xs text-muted-foreground">
                                            <span className="font-medium">Image:</span> {page.imageDescription}
                                        </div>
                                    )}
                                </div>
                            ))}
                        </div>

                        {/* Debug Section */}
                        {lastResponse.debug && (
                            <div className="border-t pt-4">
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => setShowDebug(!showDebug)}
                                    className="flex items-center gap-1"
                                >
                                    {showDebug ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                                    Debug Info
                                </Button>
                                {showDebug && (
                                    <pre className="mt-2 bg-muted p-4 rounded-lg overflow-x-auto text-xs">
                                        <code>{JSON.stringify(lastResponse.debug, null, 2)}</code>
                                    </pre>
                                )}
                            </div>
                        )}
                    </CardContent>
                )}
                {lastError && (
                    <CardContent>
                        <p className="text-destructive">{lastError}</p>
                        {lastResponse?.debug && (
                            <pre className="mt-4 bg-muted p-4 rounded-lg overflow-x-auto text-xs">
                                <code>{JSON.stringify(lastResponse.debug, null, 2)}</code>
                            </pre>
                        )}
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
                        <CardTitle>Run Pagination Test</CardTitle>
                        <CardDescription>Select a story and output type to test AI-driven pagination</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        {/* Story Selector */}
                        <div className="space-y-2">
                            <Label>Select Story</Label>
                            {storiesLoading ? (
                                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                                    <LoaderCircle className="h-4 w-4 animate-spin" />
                                    Loading stories...
                                </div>
                            ) : storiesError ? (
                                <p className="text-sm text-destructive">{storiesError}</p>
                            ) : stories.length === 0 ? (
                                <p className="text-sm text-muted-foreground">No stories found</p>
                            ) : (
                                <Select value={storyIdInput} onValueChange={setStoryIdInput}>
                                    <SelectTrigger>
                                        <SelectValue placeholder="Select a story..." />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {stories.map((story) => (
                                            <SelectItem key={story.id} value={story.id}>
                                                <div className="flex items-center gap-2">
                                                    <span className="font-medium">{story.title}</span>
                                                    <span className="text-xs text-muted-foreground font-mono">
                                                        ({story.id.slice(0, 8)}...)
                                                    </span>
                                                </div>
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            )}
                            <p className="text-xs text-muted-foreground">
                                {stories.length} stor{stories.length !== 1 ? 'ies' : 'y'} available (most recent first)
                            </p>
                        </div>

                        {/* Manual Story ID Input */}
                        <div className="space-y-2">
                            <Label htmlFor="storyId">Or Enter Story ID Manually</Label>
                            <Input
                                id="storyId"
                                value={storyIdInput}
                                onChange={(e) => setStoryIdInput(e.target.value)}
                                placeholder="Enter a story ID"
                            />
                        </div>

                        {/* Output Type Selector */}
                        <div className="space-y-2">
                            <Label>Select Output Type</Label>
                            {outputTypesLoading ? (
                                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                                    <LoaderCircle className="h-4 w-4 animate-spin" />
                                    Loading output types...
                                </div>
                            ) : outputTypesError ? (
                                <p className="text-sm text-destructive">{outputTypesError}</p>
                            ) : outputTypes.length === 0 ? (
                                <p className="text-sm text-muted-foreground">No output types found</p>
                            ) : (
                                <Select value={outputTypeIdInput} onValueChange={setOutputTypeIdInput}>
                                    <SelectTrigger>
                                        <SelectValue placeholder="Select an output type..." />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {outputTypes.map((type) => (
                                            <SelectItem key={type.id} value={type.id}>
                                                <div className="flex items-center gap-2">
                                                    <span className="font-medium">{type.name}</span>
                                                    <Badge variant="outline" className="text-xs">
                                                        {type.category}
                                                    </Badge>
                                                    {type.pageCount && (
                                                        <span className="text-xs text-muted-foreground">
                                                            {type.pageCount} pages
                                                        </span>
                                                    )}
                                                    {type.hasPaginationPrompt && (
                                                        <Badge variant="secondary" className="text-xs">
                                                            Custom Prompt
                                                        </Badge>
                                                    )}
                                                </div>
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            )}
                        </div>

                        {/* Manual Output Type ID Input */}
                        <div className="space-y-2">
                            <Label htmlFor="outputTypeId">Or Enter Output Type ID Manually</Label>
                            <Input
                                id="outputTypeId"
                                value={outputTypeIdInput}
                                onChange={(e) => setOutputTypeIdInput(e.target.value)}
                                placeholder="Enter an output type ID"
                            />
                        </div>

                        {/* Selected Story Info */}
                        {storyIdInput && selectedStory && (
                            <div className="p-3 bg-muted rounded-md text-sm">
                                <p className="font-medium mb-1">Selected Story:</p>
                                <div className="grid grid-cols-2 gap-1 text-xs">
                                    <span className="text-muted-foreground">ID:</span>
                                    <span className="font-mono">{selectedStory.id}</span>
                                    <span className="text-muted-foreground">Title:</span>
                                    <span>{selectedStory.title}</span>
                                    <span className="text-muted-foreground">Child:</span>
                                    <span className="font-mono">{selectedStory.childId}</span>
                                </div>
                                {selectedStory.storyTextPreview && (
                                    <div className="mt-2">
                                        <span className="text-muted-foreground text-xs">Preview:</span>
                                        <p className="text-xs italic mt-1">{selectedStory.storyTextPreview}</p>
                                    </div>
                                )}
                            </div>
                        )}

                        {/* Selected Output Type Info */}
                        {outputTypeIdInput && selectedOutputType && (
                            <div className="p-3 bg-muted rounded-md text-sm">
                                <p className="font-medium mb-1">Selected Output Type:</p>
                                <div className="grid grid-cols-2 gap-1 text-xs">
                                    <span className="text-muted-foreground">ID:</span>
                                    <span className="font-mono">{selectedOutputType.id}</span>
                                    <span className="text-muted-foreground">Name:</span>
                                    <span>{selectedOutputType.name}</span>
                                    <span className="text-muted-foreground">Category:</span>
                                    <span>{selectedOutputType.category}</span>
                                    <span className="text-muted-foreground">Target Pages:</span>
                                    <span>{selectedOutputType.pageCount || 'Flexible'}</span>
                                    <span className="text-muted-foreground">Custom Prompt:</span>
                                    <span>{selectedOutputType.hasPaginationPrompt ? 'Yes' : 'No (uses default)'}</span>
                                </div>
                            </div>
                        )}
                    </CardContent>
                    <CardFooter>
                        <Button onClick={handleRunTest} disabled={loading || !storyIdInput || !outputTypeIdInput}>
                            {loading ? <><LoaderCircle className="mr-2 h-4 w-4 animate-spin" /> Running Pagination...</> : 'Run Pagination Flow'}
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
            <h1 className="text-2xl font-bold mb-1">Story Pagination Test</h1>
            <p className="text-muted-foreground mb-6">Test the AI-driven story pagination flow that transforms story text into paginated pages.</p>

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
