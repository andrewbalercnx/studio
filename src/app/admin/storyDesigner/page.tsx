
'use client';

import { useAdminStatus } from '@/hooks/use-admin-status';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { LoaderCircle, BookOpen, Mic, Palette, Copy } from 'lucide-react';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useFirestore } from '@/firebase';
import { collection, onSnapshot, query, orderBy } from 'firebase/firestore';
import { useEffect, useState, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import Link from 'next/link';
import type { StoryType, PromptConfig, StoryOutputType } from '@/lib/types';
import { Badge } from '@/components/ui/badge';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { useToast } from '@/hooks/use-toast';

type GroupedStoryTypes = {
    [ageRange: string]: StoryType[];
};

export default function AdminStoryDesignerPage() {
    const { isAuthenticated, isAdmin, isWriter, loading: authLoading, error: authError } = useAdminStatus();
    const firestore = useFirestore();
    const { toast } = useToast();

    const [storyTypes, setStoryTypes] = useState<StoryType[]>([]);
    const [promptConfigs, setPromptConfigs] = useState<PromptConfig[]>([]);
    const [outputTypes, setOutputTypes] = useState<StoryOutputType[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (!firestore || (!isAdmin && !isWriter)) {
            setLoading(false);
            return;
        }

        const unsubscribes: (() => void)[] = [];
        let active = true;

        const fetchData = async () => {
            try {
                const storyTypesQuery = query(collection(firestore, 'storyTypes'), orderBy('name'));
                unsubscribes.push(onSnapshot(storyTypesQuery, (snap) => {
                    if (active) setStoryTypes(snap.docs.map(d => d.data() as StoryType));
                }));

                const promptsQuery = query(collection(firestore, 'promptConfigs'), orderBy('phase'));
                unsubscribes.push(onSnapshot(promptsQuery, (snap) => {
                    if (active) setPromptConfigs(snap.docs.map(d => d.data() as PromptConfig));
                }));

                const outputsQuery = query(collection(firestore, 'storyOutputTypes'), orderBy('name'));
                unsubscribes.push(onSnapshot(outputsQuery, (snap) => {
                     if (active) setOutputTypes(snap.docs.map(d => ({id: d.id, ...d.data()}) as StoryOutputType));
                }));

                setLoading(false);

            } catch (e: any) {
                if(active) {
                    setError('Failed to load creative assets. Check Firestore permissions.');
                    setLoading(false);
                }
            }
        };

        fetchData();

        return () => {
            active = false;
            unsubscribes.forEach(unsub => unsub());
        };
    }, [firestore, isAdmin, isWriter]);
    
    const groupedStoryTypes = useMemo(() => {
        return storyTypes.reduce((acc, type) => {
            const ageRange = type.ageRange || 'Uncategorized';
            if (!acc[ageRange]) {
                acc[ageRange] = [];
            }
            acc[ageRange].push(type);
            return acc;
        }, {} as GroupedStoryTypes);
    }, [storyTypes]);

    const diagnostics = {
        page: 'admin-story-designer',
        auth: { isAuthenticated, isAdmin, loading: authLoading, error: authError },
        firestore: {
            storyTypes: storyTypes.length,
            promptConfigs: promptConfigs.length,
            outputTypes: outputTypes.length,
        },
        error: error
    };

    const handleCopyDiagnostics = () => {
        const textToCopy = `Page: admin-story-designer\n\nDiagnostics\n${JSON.stringify(diagnostics, null, 2)}`;
        navigator.clipboard.writeText(textToCopy);
        toast({ title: 'Copied to clipboard!' });
    };

    const renderContent = () => {
        if (authLoading || loading) return <div className="flex items-center gap-2"><LoaderCircle className="h-5 w-5 animate-spin" /><span>Loading creative assets...</span></div>;
        if (!isAuthenticated) return <p>You must be signed in to access admin pages.</p>;
        if (!isAdmin && !isWriter) return <p>You are signed in but do not have admin or writer rights.</p>;
        if (error) return <p className="text-destructive">{error}</p>;

        return (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                
                {/* Story Types */}
                <Card className="lg:col-span-1">
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2"><BookOpen/>What kinds of stories can we make?</CardTitle>
                        <CardDescription>Templates that define story structure and age range.</CardDescription>
                    </CardHeader>
                    <CardContent>
                       <Accordion type="single" collapsible className="w-full">
                            {Object.entries(groupedStoryTypes).map(([ageRange, types]) => (
                                <AccordionItem key={ageRange} value={ageRange}>
                                    <AccordionTrigger>Age: {ageRange} ({types.length})</AccordionTrigger>
                                    <AccordionContent>
                                        <div className="space-y-2">
                                            {types.map(type => (
                                                <div key={type.id} className="p-2 border rounded-md">
                                                    <div className="font-semibold">{type.name}</div>
                                                    <p className="text-xs text-muted-foreground">{type.shortDescription}</p>
                                                    <Badge variant={type.status === 'live' ? 'default' : 'secondary'} className="mt-1">{type.status}</Badge>
                                                </div>
                                            ))}
                                        </div>
                                    </AccordionContent>
                                </AccordionItem>
                            ))}
                        </Accordion>
                         <Button asChild variant="link" className="mt-4">
                            <Link href="/admin/storyTypes">Manage Story Types</Link>
                        </Button>
                    </CardContent>
                </Card>

                {/* Prompt Flows */}
                <Card className="lg:col-span-1">
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2"><Mic/>How does the Story Guide talk?</CardTitle>
                        <CardDescription>Configurations that control the AI's behavior at each step.</CardDescription>
                    </CardHeader>
                    <CardContent className="max-h-[400px] overflow-y-auto">
                        <Table>
                             <TableHeader>
                                <TableRow>
                                    <TableHead>Phase</TableHead>
                                    <TableHead>Level</TableHead>
                                    <TableHead>Status</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {promptConfigs.map(p => (
                                    <TableRow key={p.id}>
                                        <TableCell>{p.phase}</TableCell>
                                        <TableCell>{p.levelBand}</TableCell>
                                        <TableCell><Badge variant={p.status === 'live' ? 'default' : 'secondary'}>{p.status}</Badge></TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                         <Button asChild variant="link" className="mt-4">
                            <Link href="/admin/prompts">Manage Prompt Configs</Link>
                        </Button>
                    </CardContent>
                </Card>

                {/* Output Types */}
                <Card className="lg:col-span-1">
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2"><Palette/>What can we make at the end?</CardTitle>
                        <CardDescription>Defines the final products like books, poems, etc.</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-2">
                       {outputTypes.map(output => (
                           <div key={output.id} className="p-3 border rounded-lg">
                               <div className="flex justify-between items-start">
                                   <span className="font-bold">{output.name}</span>
                                   <Badge variant={output.status === 'live' ? 'default' : 'secondary'}>{output.status}</Badge>
                               </div>
                               <p className="text-sm text-muted-foreground">{output.shortDescription}</p>
                               <div className="flex gap-1 mt-2">
                                   <Badge variant="outline">{output.ageRange}</Badge>
                                   <Badge variant="outline">{output.category}</Badge>
                               </div>
                           </div>
                       ))}
                        <Button asChild variant="link" className="mt-4">
                            <Link href="/admin/storyOutputs">Manage Output Types</Link>
                        </Button>
                    </CardContent>
                </Card>
            </div>
        );
    };

    return (
        <div className="container mx-auto p-4 sm:p-6 md:p-8">
            <div className="mb-6">
                <h1 className="text-3xl font-bold">Story Designer Hub</h1>
                <p className="text-muted-foreground">A creative control panel for managing story assets.</p>
            </div>
            
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
