
'use client';

import { useAdminStatus } from '@/hooks/use-admin-status';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Copy, LoaderCircle, PlusCircle, Image as ImageIcon, User as UserIcon, Pencil, X, Sparkles } from 'lucide-react';
import { useEffect, useState, useCallback, useMemo } from 'react';
import { useFirestore } from '@/firebase';
import { collection, doc, onSnapshot, setDoc, serverTimestamp, query, where, writeBatch, updateDoc } from 'firebase/firestore';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import type { ChildProfile } from '@/lib/types';
import { errorEmitter } from '@/firebase/error-emitter';
import { FirestorePermissionError } from '@/firebase/errors';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useUser } from '@/firebase/auth/use-user';
import { useUploadFile } from '@/firebase/storage/use-upload-file';
import Image from 'next/image';
import { ParentGuard } from '@/components/parent/parent-guard';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';

function slugify(text: string) {
    return text
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '');
}

function formatDateInput(value?: any) {
    if (!value) return '';
    if (typeof value === 'string') {
        const parsed = new Date(value);
        if (!isNaN(parsed.getTime())) {
            return parsed.toISOString().split('T')[0];
        }
        return '';
    }
    if (value.toDate && typeof value.toDate === 'function') {
        const date = value.toDate();
        return date.toISOString().split('T')[0];
    }
    const date = new Date(value);
    if (isNaN(date.getTime())) {
        return '';
    }
    return date.toISOString().split('T')[0];
}

type PreferenceInputProps = {
    label: string;
    placeholder: string;
    values: string[];
    onChange: (next: string[]) => void;
};

function PreferenceInput({ label, placeholder, values, onChange }: PreferenceInputProps) {
    const [draft, setDraft] = useState('');

    const handleAdd = () => {
        const value = draft.trim();
        if (!value) return;
        if (values.includes(value)) {
            setDraft('');
            return;
        }
        onChange([...values, value]);
        setDraft('');
    };

    const handleRemove = (value: string) => {
        onChange(values.filter(v => v !== value));
    };

    return (
        <div className="space-y-2">
            <Label>{label}</Label>
            <div className="flex gap-2">
                <Input
                    value={draft}
                    placeholder={placeholder}
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                            e.preventDefault();
                            handleAdd();
                        }
                    }}
                />
                <Button type="button" variant="outline" onClick={handleAdd} disabled={!draft.trim()}>
                    Add
                </Button>
            </div>
            {values.length > 0 && (
                <div className="flex flex-wrap gap-2">
                    {values.map((value) => (
                        <Badge key={value} variant="secondary" className="flex items-center gap-1">
                            <span>{value}</span>
                            <button type="button" onClick={() => handleRemove(value)} aria-label={`Remove ${value}`}>
                                <X className="h-3 w-3" />
                            </button>
                        </Badge>
                    ))}
                </div>
            )}
        </div>
    );
}

function ChildForm({ parentUid, onSave, child }: { parentUid: string, onSave: () => void, child?: ChildProfile | null }) {
    const firestore = useFirestore();
    const { toast } = useToast();
    const isEditing = !!child;
    const [name, setName] = useState(child?.displayName ?? '');
    const [dob, setDob] = useState(formatDateInput(child?.dateOfBirth));
    const [isSaving, setIsSaving] = useState(false);
    const [favoriteColors, setFavoriteColors] = useState<string[]>(child?.preferences?.favoriteColors ?? []);
    const [favoriteFoods, setFavoriteFoods] = useState<string[]>(child?.preferences?.favoriteFoods ?? []);
    const [favoriteGames, setFavoriteGames] = useState<string[]>(child?.preferences?.favoriteGames ?? []);
    const [favoriteSubjects, setFavoriteSubjects] = useState<string[]>(child?.preferences?.favoriteSubjects ?? []);

    const buildPreferencesPayload = () => {
        const payload: Record<string, string[]> = {};
        if (favoriteColors.length) payload.favoriteColors = favoriteColors;
        if (favoriteFoods.length) payload.favoriteFoods = favoriteFoods;
        if (favoriteGames.length) payload.favoriteGames = favoriteGames;
        if (favoriteSubjects.length) payload.favoriteSubjects = favoriteSubjects;
        return Object.keys(payload).length > 0 ? payload : {};
    };

    const handleSubmit = async () => {
        if (!firestore || !name || (!dob && !isEditing)) {
            toast({ title: 'Please fill out all fields.', variant: 'destructive' });
            return;
        }
        setIsSaving(true);
        const childId = child?.id ?? `${slugify(name)}-${Date.now().toString().slice(-6)}`;
        const docRef = doc(firestore, 'children', childId);
        const preferencesPayload = buildPreferencesPayload();
        const writePayload: Record<string, any> = {
            displayName: name,
            ownerParentUid: parentUid,
            updatedAt: serverTimestamp(),
        };

        if (!isEditing) {
            const initialAvatarSeed = name || 'avatar';
            writePayload.avatarUrl = `https://picsum.photos/seed/${initialAvatarSeed}/200/200`;
            writePayload.photos = [];
            writePayload.createdAt = serverTimestamp();
        }

        if (dob) {
            writePayload.dateOfBirth = new Date(dob);
        }

        if (Object.keys(preferencesPayload).length > 0) {
            writePayload.preferences = preferencesPayload;
        } else if (isEditing) {
            writePayload.preferences = {};
        }

        const writePromise = isEditing
            ? updateDoc(docRef, writePayload)
            : setDoc(docRef, writePayload);

        writePromise
            .then(() => {
                toast({
                    title: isEditing ? 'Child profile updated!' : 'Child profile created!',
                    description: isEditing ? `${name}'s preferences were saved.` : `${name} has been added.`,
                });
                onSave();
            })
            .catch((serverError: any) => {
                const permissionError = new FirestorePermissionError({
                    path: docRef.path,
                    operation: isEditing ? 'update' : 'create',
                    requestResourceData: writePayload,
                });
                errorEmitter.emit('permission-error', permissionError);
            })
            .finally(() => {
                setIsSaving(false);
            });
    };

    return (
        <div className="space-y-4">
            <div className="space-y-2">
                <Label htmlFor="name">Child's Name</Label>
                <Input id="name" value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="space-y-2">
                <Label htmlFor="dob">Date of Birth</Label>
                <Input id="dob" type="date" value={dob} onChange={(e) => setDob(e.target.value)} />
            </div>
            <PreferenceInput label="Favorite Colors" placeholder="Add a color" values={favoriteColors} onChange={setFavoriteColors} />
            <PreferenceInput label="Favorite Foods" placeholder="Add a food" values={favoriteFoods} onChange={setFavoriteFoods} />
            <PreferenceInput label="Favorite Games" placeholder="Add a game or activity" values={favoriteGames} onChange={setFavoriteGames} />
            <PreferenceInput label="Favorite School Subjects" placeholder="Add a subject (art, science...)" values={favoriteSubjects} onChange={setFavoriteSubjects} />
            <Button onClick={handleSubmit} disabled={isSaving}>
                {isSaving ? <LoaderCircle className="animate-spin mr-2" /> : null}
                {isEditing ? 'Update Child' : 'Save Child'}
            </Button>
        </div>
    )
}

function AvatarGenerator({ child, onAvatarUpdate }: { child: ChildProfile, onAvatarUpdate: (url: string) => void }) {
    const [isLoading, setIsLoading] = useState(false);
    const [generatedAvatar, setGeneratedAvatar] = useState<string | null>(null);
    const [feedback, setFeedback] = useState('');
    const [error, setError] = useState<string | null>(null);
    const { toast } = useToast();

    const handleGenerate = async () => {
        setIsLoading(true);
        setError(null);
        try {
            const res = await fetch('/api/generateAvatar', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ childId: child.id, feedback }),
            });
            const result = await res.json();
            if (!res.ok || !result.ok) {
                throw new Error(result.errorMessage || 'Failed to generate avatar.');
            }
            setGeneratedAvatar(result.imageUrl);
            setFeedback('');
        } catch (err: any) {
            setError(err.message);
            toast({ title: 'Avatar Generation Failed', description: err.message, variant: 'destructive' });
        } finally {
            setIsLoading(false);
        }
    };

    const handleAccept = () => {
        if (generatedAvatar) {
            onAvatarUpdate(generatedAvatar);
            toast({ title: 'Avatar Updated!', description: 'The new avatar has been saved.' });
        }
    };

    return (
        <Card className="bg-muted/50">
            <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2"><Sparkles className="text-primary" /> AI Avatar Generator</CardTitle>
                <CardDescription>Create a cartoon avatar from your child's photos.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
                <div className="flex justify-center">
                    {isLoading ? (
                        <div className="h-40 w-40 flex items-center justify-center bg-muted rounded-full">
                            <LoaderCircle className="h-10 w-10 animate-spin text-primary" />
                        </div>
                    ) : generatedAvatar ? (
                        <Image src={generatedAvatar} alt="Generated avatar" width={160} height={160} className="rounded-full border-4 border-primary shadow-md" />
                    ) : (
                        <div className="h-40 w-40 flex items-center justify-center bg-muted rounded-full text-muted-foreground">
                            <UserIcon className="h-10 w-10" />
                        </div>
                    )}
                </div>
                {error && <p className="text-sm text-destructive text-center">{error}</p>}
                <div className="space-y-2">
                    <Label htmlFor="feedback">Feedback (optional)</Label>
                    <Textarea id="feedback" value={feedback} onChange={(e) => setFeedback(e.target.value)} placeholder="e.g., make the hair blonder, add glasses..." />
                </div>
                <div className="flex gap-2">
                    <Button onClick={handleGenerate} disabled={isLoading} className="flex-1">
                        {isLoading ? 'Generating...' : (generatedAvatar ? 'Regenerate' : 'Generate Avatar')}
                    </Button>
                    {generatedAvatar && <Button onClick={handleAccept} className="flex-1">Accept</Button>}
                </div>
            </CardContent>
        </Card>
    );
}


function ManagePhotos({ child, onOpenChange }: { child: ChildProfile, onOpenChange: (open: boolean) => void }) {
    const firestore = useFirestore();
    const { toast } = useToast();
    const { uploadFile, isUploading } = useUploadFile();
    const { user } = useUser();
    const [optimisticPhotos, setOptimisticPhotos] = useState(child.photos || []);

    const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
        if (!user) return;
        const file = event.target.files?.[0];
        if (!file) return;

        const reader = new FileReader();
        reader.readAsDataURL(file);
        reader.onload = async () => {
            const dataUrl = reader.result as string;

            try {
                const downloadURL = await uploadFile({
                    childId: child.id,
                    dataUrl,
                    fileName: file.name,
                });
                if (!downloadURL) {
                    toast({ title: 'Upload failed', description: 'Please try again in a moment.', variant: 'destructive' });
                    return;
                }
                const childRef = doc(firestore, 'children', child.id);
                const updatedPhotos = [...optimisticPhotos, downloadURL];
                await updateDoc(childRef, {
                    photos: updatedPhotos,
                });
                setOptimisticPhotos(updatedPhotos);
                toast({ title: 'Photo uploaded!' });
            } catch (e: any) {
                toast({ title: 'Upload failed', description: e.message, variant: 'destructive' });
            }
        };
    };
    
    const handleSetAvatar = async (photoUrl: string) => {
        if (!firestore) return;
        const childRef = doc(firestore, 'children', child.id);
        const updateData = { avatarUrl: photoUrl };

        updateDoc(childRef, updateData)
            .then(() => {
                toast({ title: 'Avatar updated!' });
                onOpenChange(false);
            })
            .catch((serverError: any) => {
                const permissionError = new FirestorePermissionError({
                    path: childRef.path,
                    operation: 'update',
                    requestResourceData: updateData,
                });
                errorEmitter.emit('permission-error', permissionError);
            });
    }

    return (
        <div className="space-y-6">
            <AvatarGenerator child={child} onAvatarUpdate={handleSetAvatar} />

            <div>
                <Label htmlFor="photo-upload" className="block text-sm font-medium text-gray-700 mb-2">Upload a new photo</Label>
                <Input id="photo-upload" type="file" accept="image/*" onChange={handleFileChange} disabled={isUploading} />
                {isUploading && <p className="text-sm text-muted-foreground mt-2 flex items-center"><LoaderCircle className="animate-spin mr-2" /> Uploading...</p>}
            </div>

            <div className="grid grid-cols-3 gap-2">
                {optimisticPhotos.map((photo, index) => (
                    <div key={index} className="relative group">
                        <Image src={photo} alt={`Child photo ${index + 1}`} width={150} height={150} className="rounded-md object-cover aspect-square" />
                        <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity">
                            <Button size="sm" onClick={() => handleSetAvatar(photo)}>Set as Avatar</Button>
                        </div>
                    </div>
                ))}
            </div>
             {optimisticPhotos.length === 0 && !isUploading && (
                <p className="text-sm text-muted-foreground text-center py-4">No photos uploaded yet.</p>
            )}
        </div>
    );
}


export default function ManageChildrenPage() {
    const { user, loading: userLoading } = useUser();
    const { isAdmin, loading: adminLoading } = useAdminStatus();
    const firestore = useFirestore();
    const { toast } = useToast();

    const [children, setChildren] = useState<ChildProfile[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [isCreateOpen, setIsCreateOpen] = useState(false);
    const [isPhotosOpen, setIsPhotosOpen] = useState(false);
    const [selectedChild, setSelectedChild] = useState<ChildProfile | null>(null);
    const [editingChild, setEditingChild] = useState<ChildProfile | null>(null);
    const [isEditOpen, setIsEditOpen] = useState(false);

    const childrenQuery = useMemo(() => {
        if (!user || !firestore) return null;
        return query(collection(firestore, 'children'), where('ownerParentUid', '==', user.uid));
    }, [user, firestore]);

    useEffect(() => {
        if (!childrenQuery) {
            setLoading(false);
            return;
        }
        setLoading(true);
        const unsubscribe = onSnapshot(childrenQuery,
            (snapshot) => {
                const childrenList = snapshot.docs.map(d => ({ ...d.data(), id: d.id }) as ChildProfile);
                setChildren(childrenList);
                setLoading(false);
                setError(null);
            },
            (serverError) => {
                const permissionError = new FirestorePermissionError({ path: 'children', operation: 'list' });
                errorEmitter.emit('permission-error', permissionError);
                setError("Could not fetch children profiles. Check console for details.");
                setChildren([]);
                setLoading(false);
            }
        );
        return () => unsubscribe();
    }, [childrenQuery]);

    const handleManagePhotos = (child: ChildProfile) => {
        setSelectedChild(child);
        setIsPhotosOpen(true);
    }

    const handleEditChild = (child: ChildProfile) => {
        setEditingChild(child);
        setIsEditOpen(true);
    }

    const diagnostics = {
        page: 'parent-children',
        auth: { isAuthenticated: !!user, isAdmin, loading: userLoading || adminLoading, error: null, },
        firestore: { collection: 'children', count: children.length, sampleIds: children.slice(0, 3).map(c => c.id), },
        ...(error ? { firestoreErrorChildren: error } : {})
    };

    const handleCopyDiagnostics = () => {
        navigator.clipboard.writeText(`Page: parent-children\n\nDiagnostics\n${JSON.stringify(diagnostics, null, 2)}`);
        toast({ title: 'Copied to clipboard!' });
    };

    const getDisplayDate = (date: any) => {
        if (!date) return '';
        // Firestore timestamp objects have a toDate() method
        if (date.toDate) {
            return date.toDate().toLocaleDateString();
        }
        // Handle case where it might already be a Date object or a string
        const d = new Date(date);
        if (!isNaN(d.getTime())) {
            return d.toLocaleDateString();
        }
        return 'Invalid Date';
    };

    const renderContent = () => {
        if (userLoading || loading) {
            return <div className="flex items-center gap-2 justify-center py-8"><LoaderCircle className="h-5 w-5 animate-spin" /><span>Loading children...</span></div>;
        }
        if (!user) {
            return <p className="text-center text-muted-foreground py-8">You must be signed in to manage children.</p>;
        }
        if (error) {
            return <p className="text-destructive text-center py-8">{error}</p>;
        }
        if (children.length === 0) {
            return (
                <div className="text-center py-8 border-2 border-dashed rounded-lg">
                    <p className="text-muted-foreground mb-4">No children found.</p>
                    <Button onClick={() => setIsCreateOpen(true)}>Create a child profile</Button>
                </div>
            )
        }

        return (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {children.map((child) => {
                    const preferenceSections = [
                        { label: 'Colors', values: child.preferences?.favoriteColors },
                        { label: 'Foods', values: child.preferences?.favoriteFoods },
                        { label: 'Games', values: child.preferences?.favoriteGames },
                        { label: 'Subjects', values: child.preferences?.favoriteSubjects },
                    ].filter((section) => Array.isArray(section.values) && section.values.length > 0);
                    return (
                        <Card key={child.id}>
                            <CardHeader className="flex flex-row items-center gap-4">
                                <Avatar className="h-16 w-16">
                                    <AvatarImage src={child.avatarUrl} alt={child.displayName} />
                                    <AvatarFallback>{child.displayName.charAt(0)}</AvatarFallback>
                                </Avatar>
                                <div>
                                    <CardTitle>{child.displayName}</CardTitle>
                                    {child.dateOfBirth && <CardDescription>Born: {getDisplayDate(child.dateOfBirth)}</CardDescription>}
                                </div>
                            </CardHeader>
                            <CardContent>
                                {preferenceSections.length > 0 ? (
                                    <div className="flex flex-wrap gap-2">
                                        {preferenceSections.map((section) => (
                                            <Badge key={`${child.id}-${section.label}`} variant="outline">
                                                {section.label}: {section.values!.join(', ')}
                                            </Badge>
                                        ))}
                                    </div>
                                ) : (
                                    <p className="text-sm text-muted-foreground">No preferences saved yet.</p>
                                )}
                            </CardContent>
                            <CardFooter className="flex justify-end gap-2">
                                <Button variant="outline" size="sm" onClick={() => handleEditChild(child)}>
                                    <Pencil className="mr-2 h-4 w-4" />
                                    Edit
                                </Button>
                                <Button variant="outline" size="sm" onClick={() => handleManagePhotos(child)}>
                                    <ImageIcon className="mr-2 h-4 w-4" />
                                    Manage Photos
                                </Button>
                            </CardFooter>
                        </Card>
                    );
                })}
            </div>
        );
    };

    return (
        <ParentGuard>
            <div className="container mx-auto p-4 sm:p-6 md:p-8">
                <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
                    <DialogContent>
                        <DialogHeader>
                            <DialogTitle>Create New Child Profile</DialogTitle>
                        </DialogHeader>
                        {user && <ChildForm parentUid={user.uid} onSave={() => setIsCreateOpen(false)} child={null} />}
                    </DialogContent>
                </Dialog>

                <Dialog open={isPhotosOpen} onOpenChange={setIsPhotosOpen}>
                    <DialogContent>
                        <DialogHeader>
                            <DialogTitle>Manage Photos for {selectedChild?.displayName}</DialogTitle>
                        </DialogHeader>
                        {selectedChild && <ManagePhotos child={selectedChild} onOpenChange={setIsPhotosOpen}/>}
                    </DialogContent>
                </Dialog>

                <Dialog open={isEditOpen} onOpenChange={setIsEditOpen}>
                    <DialogContent>
                        <DialogHeader>
                            <DialogTitle>Edit {editingChild?.displayName}</DialogTitle>
                        </DialogHeader>
                        {user && editingChild && (
                            <ChildForm parentUid={user.uid} onSave={() => setIsEditOpen(false)} child={editingChild} />
                        )}
                    </DialogContent>
                </Dialog>

                <div className="flex justify-between items-center mb-6">
                    <h1 className="text-3xl font-bold">Manage Children</h1>
                    <Button onClick={() => setIsCreateOpen(true)}><PlusCircle className="mr-2"/> Add New Child</Button>
                </div>
                
                <Card>
                    <CardContent className="pt-6">
                        {renderContent()}
                    </CardContent>
                </Card>

                <Card className="mt-8">
                    <CardHeader className="flex flex-row items-center justify-between">
                        <CardTitle>Diagnostics</CardTitle>
                        <Button variant="ghost" size="icon" onClick={handleCopyDiagnostics}><Copy className="h-4 w-4" /></Button>
                    </CardHeader>
                    <CardContent>
                        <pre className="bg-muted p-4 rounded-lg overflow-x-auto text-sm">
                            <code>{JSON.stringify(diagnostics, null, 2)}</code>
                        </pre>
                    </CardContent>
                </Card>
            </div>
        </ParentGuard>
    );
}
