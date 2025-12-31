'use client';

import { useState } from 'react';
import { useAdminStatus } from '@/hooks/use-admin-status';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Copy, LoaderCircle, Play, Volume2 } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

type VoiceInfo = {
    id: string;
    name: string;
    description?: string;
    accent?: string;
    labels?: Record<string, string>;
    category?: string;
};

type VoiceListResponse = {
    ok: boolean;
    search?: string;
    category?: string;
    count?: number;
    voices?: VoiceInfo[];
    errorMessage?: string;
};

export default function AdminVoiceTestPage() {
    const { isAuthenticated, isAdmin, isWriter, loading: authLoading } = useAdminStatus();
    const { toast } = useToast();

    const [searchTerm, setSearchTerm] = useState('british');
    const [category, setCategory] = useState('premade');
    const [loading, setLoading] = useState(false);
    const [previewLoading, setPreviewLoading] = useState<string | null>(null);
    const [voices, setVoices] = useState<VoiceInfo[]>([]);
    const [lastError, setLastError] = useState<string | null>(null);

    const handleSearch = async () => {
        setLoading(true);
        setLastError(null);
        setVoices([]);

        try {
            const params = new URLSearchParams({
                search: searchTerm,
                category,
            });
            const response = await fetch(`/api/voices/list?${params}`);
            const result: VoiceListResponse = await response.json();

            if (!response.ok || !result.ok) {
                setLastError(result.errorMessage || 'Failed to fetch voices');
                toast({ title: 'Search Failed', description: result.errorMessage, variant: 'destructive' });
            } else {
                setVoices(result.voices || []);
                toast({ title: 'Search Complete', description: `Found ${result.count} voices` });
            }
        } catch (e: any) {
            const errorMessage = e.message || 'Failed to search voices';
            setLastError(errorMessage);
            toast({ title: 'Error', description: errorMessage, variant: 'destructive' });
        } finally {
            setLoading(false);
        }
    };

    const handlePreview = async (voiceId: string) => {
        setPreviewLoading(voiceId);

        try {
            const response = await fetch('/api/voices/preview', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ voiceName: voiceId }),
            });

            const result = await response.json();

            if (!response.ok || !result.ok) {
                toast({ title: 'Preview Failed', description: result.errorMessage, variant: 'destructive' });
            } else {
                // Play the audio
                const audio = new Audio(`data:${result.mimeType};base64,${result.audioData}`);
                audio.play();
                toast({ title: 'Playing Preview' });
            }
        } catch (e: any) {
            toast({ title: 'Error', description: e.message || 'Failed to preview voice', variant: 'destructive' });
        } finally {
            setPreviewLoading(null);
        }
    };

    const handleCopyConfig = () => {
        const config = voices.map(v => ({
            id: v.id,
            name: v.name,
            description: v.description || `${v.labels?.accent || 'Unknown accent'}, ${v.labels?.gender || 'Unknown'}`,
            recommended: false,
        }));
        const code = `// British voices from ElevenLabs\n${JSON.stringify(config, null, 2)}`;
        navigator.clipboard.writeText(code);
        toast({ title: 'Copied to clipboard!' });
    };

    const renderContent = () => {
        if (authLoading) return <LoaderCircle className="mx-auto h-8 w-8 animate-spin" />;
        if (!isAuthenticated) return <p>You must be signed in to access admin pages.</p>;
        if (!isAdmin && !isWriter) return <p>You are signed in but do not have admin or writer rights.</p>;

        return (
            <>
                <Card>
                    <CardHeader>
                        <CardTitle>Search ElevenLabs Voices</CardTitle>
                        <CardDescription>Search for voices by accent or other criteria</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-2">
                                <Label htmlFor="search">Search Term</Label>
                                <Input
                                    id="search"
                                    value={searchTerm}
                                    onChange={(e) => setSearchTerm(e.target.value)}
                                    placeholder="e.g., british, australian, american"
                                />
                            </div>
                            <div className="space-y-2">
                                <Label>Category</Label>
                                <Select value={category} onValueChange={setCategory}>
                                    <SelectTrigger>
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="premade">Premade</SelectItem>
                                        <SelectItem value="cloned">Cloned</SelectItem>
                                        <SelectItem value="generated">Generated</SelectItem>
                                        <SelectItem value="professional">Professional</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>
                        </div>
                    </CardContent>
                    <CardFooter className="gap-2">
                        <Button onClick={handleSearch} disabled={loading}>
                            {loading ? <><LoaderCircle className="mr-2 h-4 w-4 animate-spin" /> Searching...</> : 'Search Voices'}
                        </Button>
                        {voices.length > 0 && (
                            <Button variant="outline" onClick={handleCopyConfig}>
                                <Copy className="mr-2 h-4 w-4" /> Copy Config
                            </Button>
                        )}
                    </CardFooter>
                </Card>

                {lastError && (
                    <Card className="mt-6 border-destructive">
                        <CardContent className="pt-6">
                            <p className="text-destructive">{lastError}</p>
                        </CardContent>
                    </Card>
                )}

                {voices.length > 0 && (
                    <Card className="mt-6">
                        <CardHeader>
                            <CardTitle>Found {voices.length} Voices</CardTitle>
                            <CardDescription>Click play to preview a voice</CardDescription>
                        </CardHeader>
                        <CardContent>
                            <div className="grid gap-3">
                                {voices.map((voice) => (
                                    <div
                                        key={voice.id}
                                        className="flex items-center justify-between p-3 border rounded-lg"
                                    >
                                        <div className="flex-1">
                                            <div className="flex items-center gap-2">
                                                <span className="font-medium">{voice.name}</span>
                                                {voice.labels?.accent && (
                                                    <Badge variant="outline">{voice.labels.accent}</Badge>
                                                )}
                                                {voice.labels?.gender && (
                                                    <Badge variant="secondary">{voice.labels.gender}</Badge>
                                                )}
                                                {voice.labels?.age && (
                                                    <Badge variant="secondary">{voice.labels.age}</Badge>
                                                )}
                                            </div>
                                            <p className="text-sm text-muted-foreground mt-1">
                                                {voice.description || 'No description'}
                                            </p>
                                            <p className="text-xs text-muted-foreground font-mono mt-1">
                                                ID: {voice.id}
                                            </p>
                                        </div>
                                        <Button
                                            variant="outline"
                                            size="icon"
                                            onClick={() => handlePreview(voice.id)}
                                            disabled={previewLoading === voice.id}
                                        >
                                            {previewLoading === voice.id ? (
                                                <LoaderCircle className="h-4 w-4 animate-spin" />
                                            ) : (
                                                <Play className="h-4 w-4" />
                                            )}
                                        </Button>
                                    </div>
                                ))}
                            </div>
                        </CardContent>
                    </Card>
                )}
            </>
        );
    };

    return (
        <div className="container mx-auto p-4 sm:p-6 md:p-8 max-w-4xl">
            <h1 className="text-2xl font-bold mb-1">Voice Search Test</h1>
            <p className="text-muted-foreground mb-6">Search ElevenLabs for voices by accent and preview them.</p>

            {renderContent()}
        </div>
    );
}
