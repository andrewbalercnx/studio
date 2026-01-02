'use client';

import { useState, useEffect, useRef } from 'react';
import { useFirestore } from '@/firebase';
import { useUser } from '@/firebase/auth/use-user';
import { collection, query, orderBy, onSnapshot, deleteDoc, doc, updateDoc } from 'firebase/firestore';
import { ImageStyle, ImageStyleExampleImage } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { User } from 'firebase/auth';

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

    const handleTogglePreferred = async (styleId: string, currentValue: boolean) => {
        if (!firestore) return;

        try {
            await updateDoc(doc(firestore, 'imageStyles', styleId), {
                preferred: !currentValue,
                updatedAt: new Date(),
            });
        } catch (error: any) {
            alert(`Error updating preferred status: ${error.message}`);
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
                                <div className="flex items-center justify-between gap-2">
                                    <CardTitle className="text-lg">{style.title}</CardTitle>
                                    <div className="flex items-center gap-2">
                                        <Switch
                                            checked={style.preferred ?? false}
                                            onCheckedChange={() => handleTogglePreferred(style.id, style.preferred ?? false)}
                                            aria-label="Toggle preferred"
                                        />
                                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${style.preferred ? 'bg-amber-100 text-amber-800' : 'bg-gray-100 text-gray-500'}`}>
                                            {style.preferred ? 'Preferred' : 'Standard'}
                                        </span>
                                    </div>
                                </div>
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
                            user={user}
                        />
                    </DialogContent>
                </Dialog>
            )}
        </div>
    );
}

const MAX_EXAMPLE_IMAGES = 5;

function ImageStyleEditor({ style, onClose, firestore, user }: { style: ImageStyle; onClose: () => void; firestore: any; user: User | null }) {
    const [formData, setFormData] = useState(style);
    const [isSaving, setIsSaving] = useState(false);
    const [isUploading, setIsUploading] = useState(false);
    const [urlInput, setUrlInput] = useState('');
    const fileInputRef = useRef<HTMLInputElement>(null);

    const exampleImages = formData.exampleImages ?? [];
    const canAddMore = exampleImages.length < MAX_EXAMPLE_IMAGES;

    const handleSave = async () => {
        if (!firestore) return;

        setIsSaving(true);
        try {
            const { id, createdAt, updatedAt, exampleImages: _, ...data } = formData;
            const now = new Date();

            if (id) {
                // Update existing (don't update exampleImages - managed separately)
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

    const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file || !user || !style.id) return;

        setIsUploading(true);
        try {
            // Convert file to data URL
            const dataUrl = await new Promise<string>((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = () => resolve(reader.result as string);
                reader.onerror = reject;
                reader.readAsDataURL(file);
            });

            const token = await user.getIdToken();
            const response = await fetch('/api/imageStyles/uploadExampleImage', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`,
                },
                body: JSON.stringify({
                    imageStyleId: style.id,
                    dataUrl,
                }),
            });

            const result = await response.json();
            if (result.ok) {
                // Update local state with new image
                setFormData({
                    ...formData,
                    exampleImages: [...exampleImages, result.exampleImage],
                });
            } else {
                alert(`Error: ${result.errorMessage}`);
            }
        } catch (error: any) {
            alert(`Error uploading: ${error.message}`);
        } finally {
            setIsUploading(false);
            if (fileInputRef.current) {
                fileInputRef.current.value = '';
            }
        }
    };

    const handleUrlUpload = async () => {
        if (!urlInput.trim() || !user || !style.id) return;

        setIsUploading(true);
        try {
            const token = await user.getIdToken();
            const response = await fetch('/api/imageStyles/uploadExampleImage', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`,
                },
                body: JSON.stringify({
                    imageStyleId: style.id,
                    sourceUrl: urlInput.trim(),
                }),
            });

            const result = await response.json();
            if (result.ok) {
                setFormData({
                    ...formData,
                    exampleImages: [...exampleImages, result.exampleImage],
                });
                setUrlInput('');
            } else {
                alert(`Error: ${result.errorMessage}`);
            }
        } catch (error: any) {
            alert(`Error uploading: ${error.message}`);
        } finally {
            setIsUploading(false);
        }
    };

    const handleDeleteImage = async (imageId: string) => {
        if (!user || !style.id) return;

        if (!confirm('Delete this example image?')) return;

        try {
            const token = await user.getIdToken();
            const response = await fetch('/api/imageStyles/deleteExampleImage', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`,
                },
                body: JSON.stringify({
                    imageStyleId: style.id,
                    exampleImageId: imageId,
                }),
            });

            const result = await response.json();
            if (result.ok) {
                setFormData({
                    ...formData,
                    exampleImages: exampleImages.filter((img) => img.id !== imageId),
                });
            } else {
                alert(`Error: ${result.errorMessage}`);
            }
        } catch (error: any) {
            alert(`Error deleting: ${error.message}`);
        }
    };

    return (
        <div className="space-y-4 max-h-[70vh] overflow-y-auto pr-2">
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

            <div className="flex items-center gap-3">
                <Switch
                    id="preferred"
                    checked={formData.preferred ?? false}
                    onCheckedChange={(checked) => setFormData({ ...formData, preferred: checked })}
                />
                <Label htmlFor="preferred" className="cursor-pointer">
                    Preferred Style
                </Label>
                <span className="text-xs text-muted-foreground">
                    (shown first in child selection)
                </span>
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

            {/* Example Images Section - only show for existing styles */}
            {style.id && (
                <div className="border-t pt-4">
                    <Label className="text-base font-semibold">Example Images for AI Reference</Label>
                    <p className="text-sm text-muted-foreground mb-3">
                        Upload up to {MAX_EXAMPLE_IMAGES} example images. These will be used as visual references by the AI when generating story illustrations.
                    </p>

                    {/* Existing images */}
                    {exampleImages.length > 0 && (
                        <div className="grid grid-cols-5 gap-2 mb-4">
                            {exampleImages.map((img) => (
                                <div key={img.id} className="relative group">
                                    <img
                                        src={img.url}
                                        alt="Example"
                                        className="w-full h-20 object-cover rounded border"
                                    />
                                    <button
                                        onClick={() => handleDeleteImage(img.id)}
                                        className="absolute -top-2 -right-2 bg-destructive text-destructive-foreground rounded-full w-5 h-5 text-xs opacity-0 group-hover:opacity-100 transition-opacity"
                                        title="Delete"
                                    >
                                        X
                                    </button>
                                </div>
                            ))}
                        </div>
                    )}

                    {/* Upload controls */}
                    {canAddMore && (
                        <div className="space-y-3">
                            <div className="flex gap-2">
                                <input
                                    ref={fileInputRef}
                                    type="file"
                                    accept="image/*"
                                    onChange={handleFileUpload}
                                    disabled={isUploading}
                                    className="hidden"
                                    id="example-image-upload"
                                />
                                <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    disabled={isUploading}
                                    onClick={() => fileInputRef.current?.click()}
                                >
                                    {isUploading ? 'Uploading...' : 'Upload File'}
                                </Button>
                            </div>
                            <div className="flex gap-2">
                                <Input
                                    value={urlInput}
                                    onChange={(e) => setUrlInput(e.target.value)}
                                    placeholder="Or paste image URL..."
                                    disabled={isUploading}
                                    className="flex-1"
                                />
                                <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    disabled={isUploading || !urlInput.trim()}
                                    onClick={handleUrlUpload}
                                >
                                    Add URL
                                </Button>
                            </div>
                            <p className="text-xs text-muted-foreground">
                                {exampleImages.length} of {MAX_EXAMPLE_IMAGES} images used
                            </p>
                        </div>
                    )}

                    {!canAddMore && (
                        <p className="text-sm text-muted-foreground">
                            Maximum of {MAX_EXAMPLE_IMAGES} example images reached. Delete one to add more.
                        </p>
                    )}
                </div>
            )}

            {!style.id && (
                <p className="text-sm text-muted-foreground italic">
                    Save this style first to add example images.
                </p>
            )}

            <div className="flex justify-end gap-2 pt-4 border-t">
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
