'use client';

import { useState, useEffect } from 'react';
import { useFirestore } from '@/firebase';
import { useUser } from '@/firebase/auth/use-user';
import { collection, query, orderBy, onSnapshot, deleteDoc, doc } from 'firebase/firestore';
import { ImageStyle } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

export default function ImageStylesAdminPage() {
    const firestore = useFirestore();
    const { user } = useUser();
    const [imageStyles, setImageStyles] = useState<ImageStyle[]>([]);
    const [selectedStyle, setSelectedStyle] = useState<ImageStyle | null>(null);
    const [isEditModalOpen, setIsEditModalOpen] = useState(false);
    const [isSeeding, setIsSeeding] = useState(false);
    const [isGenerating, setIsGenerating] = useState(false);

    // Load image styles
    useEffect(() => {
        if (!firestore) return;

        const q = query(collection(firestore, 'imageStyles'), orderBy('ageRange', 'asc'));
        const unsubscribe = onSnapshot(q, (snapshot) => {
            const styles: ImageStyle[] = [];
            snapshot.forEach((doc) => {
                styles.push({ id: doc.id, ...doc.data() } as ImageStyle);
            });
            setImageStyles(styles);
        });

        return () => unsubscribe();
    }, [firestore]);

    const handleSeedStyles = async () => {
        if (!user) {
            alert('Please sign in to perform this action');
            return;
        }

        setIsSeeding(true);
        try {
            const token = await user.getIdToken();
            const response = await fetch('/api/imageStyles/seed', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`,
                },
            });
            const result = await response.json();
            if (result.ok) {
                alert(`Successfully seeded ${result.styles.length} image styles!`);
            } else {
                alert(`Error: ${result.errorMessage}`);
            }
        } catch (error: any) {
            alert(`Error seeding styles: ${error.message}`);
        } finally {
            setIsSeeding(false);
        }
    };

    const handleEditStyle = (style: ImageStyle) => {
        setSelectedStyle(style);
        setIsEditModalOpen(true);
    };

    const handleGenerateSample = async (styleId: string) => {
        if (!user) {
            alert('Please sign in to perform this action');
            return;
        }

        setIsGenerating(true);
        try {
            const token = await user.getIdToken();
            const response = await fetch('/api/imageStyles/generateSample', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`,
                },
                body: JSON.stringify({ imageStyleId: styleId }),
            });
            const result = await response.json();
            if (result.ok) {
                alert('Sample image generated successfully!');
            } else {
                alert(`Error: ${result.errorMessage}`);
            }
        } catch (error: any) {
            alert(`Error generating sample: ${error.message}`);
        } finally {
            setIsGenerating(false);
        }
    };

    const handleDeleteStyle = async (styleId: string, title: string) => {
        if (!firestore) return;

        if (confirm(`Are you sure you want to delete "${title}"?`)) {
            try {
                await deleteDoc(doc(firestore, 'imageStyles', styleId));
                alert('Image style deleted successfully');
            } catch (error: any) {
                alert(`Error deleting style: ${error.message}`);
            }
        }
    };

    const handleCreateNew = () => {
        setSelectedStyle({
            id: '',
            title: '',
            description: '',
            ageRange: '',
            stylePrompt: '',
            sampleDescription: '',
            sampleImageUrl: null,
            createdAt: null,
            updatedAt: null,
        } as ImageStyle);
        setIsEditModalOpen(true);
    };

    return (
        <div className="container mx-auto p-6 max-w-7xl">
            <div className="flex justify-between items-center mb-6">
                <div>
                    <h1 className="text-3xl font-bold">Image Styles</h1>
                    <p className="text-muted-foreground">Manage visual styles for story illustrations</p>
                </div>
                <div className="flex gap-2">
                    <Button onClick={handleCreateNew} variant="default">
                        Create New Style
                    </Button>
                    <Button onClick={handleSeedStyles} disabled={isSeeding} variant="outline">
                        {isSeeding ? 'Seeding...' : 'Seed Styles'}
                    </Button>
                </div>
            </div>

            {imageStyles.length === 0 ? (
                <Card>
                    <CardContent className="pt-6">
                        <p className="text-center text-muted-foreground">
                            No image styles found. Click &quot;Seed Styles&quot; to create the initial set.
                        </p>
                    </CardContent>
                </Card>
            ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {imageStyles.map((style) => (
                        <Card key={style.id} className="flex flex-col">
                            <CardHeader>
                                <CardTitle className="text-lg">{style.title}</CardTitle>
                                <CardDescription>
                                    Ages: {style.ageFrom ?? 0}
                                    {style.ageTo ? `-${style.ageTo}` : '+'}
                                    {style.ageRange && ` (${style.ageRange})`}
                                </CardDescription>
                            </CardHeader>
                            <CardContent className="flex-1 flex flex-col justify-between">
                                <div className="mb-4">
                                    <p className="text-sm text-muted-foreground mb-2">{style.description}</p>
                                    {style.sampleImageUrl && (
                                        <img
                                            src={style.sampleImageUrl}
                                            alt={`Sample for ${style.title}`}
                                            className="w-full h-40 object-cover rounded-md mt-2"
                                        />
                                    )}
                                </div>
                                <div className="flex gap-2 flex-wrap">
                                    <Button
                                        onClick={() => handleEditStyle(style)}
                                        variant="outline"
                                        size="sm"
                                    >
                                        Edit
                                    </Button>
                                    <Button
                                        onClick={() => handleGenerateSample(style.id)}
                                        disabled={isGenerating}
                                        variant="outline"
                                        size="sm"
                                    >
                                        {isGenerating ? 'Generating...' : 'Generate Sample'}
                                    </Button>
                                    <Button
                                        onClick={() => handleDeleteStyle(style.id, style.title)}
                                        variant="destructive"
                                        size="sm"
                                    >
                                        Delete
                                    </Button>
                                </div>
                            </CardContent>
                        </Card>
                    ))}
                </div>
            )}

            {/* Edit/Create Modal */}
            {selectedStyle && (
                <Dialog open={isEditModalOpen} onOpenChange={setIsEditModalOpen}>
                    <DialogContent className="max-w-2xl">
                        <DialogHeader>
                            <DialogTitle>
                                {selectedStyle.id ? 'Edit Image Style' : 'Create New Image Style'}
                            </DialogTitle>
                            <DialogDescription>
                                Configure the visual style properties and sample description
                            </DialogDescription>
                        </DialogHeader>
                        <ImageStyleEditor
                            style={selectedStyle}
                            onClose={() => setIsEditModalOpen(false)}
                            firestore={firestore}
                        />
                    </DialogContent>
                </Dialog>
            )}
        </div>
    );
}

function ImageStyleEditor({ style, onClose, firestore }: { style: ImageStyle; onClose: () => void; firestore: any }) {
    const [formData, setFormData] = useState(style);
    const [isSaving, setIsSaving] = useState(false);

    const handleSave = async () => {
        if (!firestore) return;

        setIsSaving(true);
        try {
            const { id, createdAt, updatedAt, ...data } = formData;
            const now = new Date();

            if (id) {
                // Update existing
                await import('firebase/firestore').then(({ doc, updateDoc }) =>
                    updateDoc(doc(firestore, 'imageStyles', id), {
                        ...data,
                        updatedAt: now,
                    })
                );
            } else {
                // Create new
                await import('firebase/firestore').then(({ collection, addDoc }) =>
                    addDoc(collection(firestore, 'imageStyles'), {
                        ...data,
                        createdAt: now,
                        updatedAt: now,
                    })
                );
            }

            alert('Image style saved successfully!');
            onClose();
        } catch (error: any) {
            alert(`Error saving style: ${error.message}`);
        } finally {
            setIsSaving(false);
        }
    };

    return (
        <div className="space-y-4">
            <div>
                <Label htmlFor="title">Title</Label>
                <Input
                    id="title"
                    value={formData.title}
                    onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                    placeholder="The Soft Vector Style"
                />
            </div>

            <div>
                <Label htmlFor="description">Description</Label>
                <Textarea
                    id="description"
                    value={formData.description}
                    onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                    placeholder="A clean, modern style with high clarity..."
                    rows={2}
                />
            </div>

            <div className="grid grid-cols-3 gap-4">
                <div>
                    <Label htmlFor="ageFrom">Age From</Label>
                    <Input
                        id="ageFrom"
                        type="number"
                        min="0"
                        max="18"
                        value={formData.ageFrom ?? ''}
                        onChange={(e) => setFormData({ ...formData, ageFrom: e.target.value ? parseInt(e.target.value) : null })}
                        placeholder="0"
                    />
                    <p className="text-xs text-muted-foreground mt-1">Empty = no min</p>
                </div>
                <div>
                    <Label htmlFor="ageTo">Age To</Label>
                    <Input
                        id="ageTo"
                        type="number"
                        min="0"
                        max="18"
                        value={formData.ageTo ?? ''}
                        onChange={(e) => setFormData({ ...formData, ageTo: e.target.value ? parseInt(e.target.value) : null })}
                        placeholder="No limit"
                    />
                    <p className="text-xs text-muted-foreground mt-1">Empty = no max</p>
                </div>
                <div>
                    <Label htmlFor="ageRange">Display Label</Label>
                    <Input
                        id="ageRange"
                        value={formData.ageRange}
                        onChange={(e) => setFormData({ ...formData, ageRange: e.target.value })}
                        placeholder="0-4"
                    />
                    <p className="text-xs text-muted-foreground mt-1">Legacy text</p>
                </div>
            </div>

            <div>
                <Label htmlFor="stylePrompt">Style Prompt</Label>
                <Textarea
                    id="stylePrompt"
                    value={formData.stylePrompt}
                    onChange={(e) => setFormData({ ...formData, stylePrompt: e.target.value })}
                    placeholder="flat, modern vector art with soft rounded corners..."
                    rows={3}
                />
            </div>

            <div>
                <Label htmlFor="sampleDescription">Sample Description</Label>
                <Textarea
                    id="sampleDescription"
                    value={formData.sampleDescription}
                    onChange={(e) => setFormData({ ...formData, sampleDescription: e.target.value })}
                    placeholder="A friendly cartoon elephant playing with colorful building blocks"
                    rows={2}
                />
            </div>

            <div className="flex justify-end gap-2 pt-4">
                <Button variant="outline" onClick={onClose}>
                    Cancel
                </Button>
                <Button onClick={handleSave} disabled={isSaving}>
                    {isSaving ? 'Saving...' : 'Save'}
                </Button>
            </div>
        </div>
    );
}
