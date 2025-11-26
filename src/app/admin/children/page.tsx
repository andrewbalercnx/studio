
'use client';

import { useAdminStatus } from '@/hooks/use-admin-status';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Copy, LoaderCircle, PlusCircle, Image as ImageIcon, User as UserIcon } from 'lucide-react';
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

function slugify(text: string) {
    return text
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '');
}

function ChildForm({ parentUid, onSave }: { parentUid: string, onSave: () => void }) {
    const firestore = useFirestore();
    const { toast } = useToast();
    const [name, setName] = useState('');
    const [dob, setDob] = useState('');
    const [isSaving, setIsSaving] = useState(false);

    const handleSubmit = async () => {
        if (!firestore || !name || !dob) {
            toast({ title: 'Please fill out all fields.', variant: 'destructive' });
            return;
        }
        setIsSaving(true);
        const childId = `${slugify(name)}-${Date.now().toString().slice(-6)}`;
        const initialAvatarSeed = name || 'avatar';
        
        const newChildData: Omit<ChildProfile, 'id' | 'createdAt' | 'updatedAt'> = {
            displayName: name,
            ownerParentUid: parentUid,
            dateOfBirth: new Date(dob),
            avatarUrl: `https://picsum.photos/seed/${initialAvatarSeed}/200/200`,
            photos: [],
        };

        try {
            const docRef = doc(firestore, 'children', childId);
            await setDoc(docRef, {
                ...newChildData,
                createdAt: serverTimestamp(),
                updatedAt: serverTimestamp(),
            });
            toast({ title: 'Child profile created!', description: `${name} has been added.` });
            onSave();
        } catch (serverError: any) {
            const permissionError = new FirestorePermissionError({
                path: `children/${childId}`,
                operation: 'create',
                requestResourceData: newChildData,
            });
            errorEmitter.emit('permission-error', permissionError);
            toast({ title: 'Error creating child', description: 'Check the console for permission details.', variant: 'destructive' });
        } finally {
            setIsSaving(false);
        }
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
            <Button onClick={handleSubmit} disabled={isSaving}>
                {isSaving ? <LoaderCircle className="animate-spin mr-2" /> : null}
                Save Child
            </Button>
        </div>
    )
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
            const path = `users/${user.uid}/children/${child.id}/photos/${Date.now()}_${file.name}`;

            try {
                const downloadURL = await uploadFile(path, dataUrl);
                if (downloadURL) {
                    const childRef = doc(firestore, 'children', child.id);
                    await updateDoc(childRef, {
                        photos: [...optimisticPhotos, downloadURL],
                    });
                    setOptimisticPhotos(prev => [...prev, downloadURL]);
                    toast({ title: 'Photo uploaded!' });
                }
            } catch (e: any) {
                toast({ title: 'Upload failed', description: e.message, variant: 'destructive' });
            }
        };
    };
    
    const handleSetAvatar = async (photoUrl: string) => {
        if (!firestore) return;
        const childRef = doc(firestore, 'children', child.id);
        try {
            await updateDoc(childRef, { avatarUrl: photoUrl });
            toast({ title: 'Avatar updated!' });
            onOpenChange(false);
        } catch(e: any) {
            toast({ title: 'Error setting avatar', description: e.message, variant: 'destructive' });
        }
    }

    return (
        <div>
            <div className="mb-4">
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


export default function AdminChildrenPage() {
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

    const childrenQuery = useMemo(() => {
        if (!user || !firestore) return null;
        // Admins see all, parents see their own
        return isAdmin 
            ? collection(firestore, 'children')
            : query(collection(firestore, 'children'), where('ownerParentUid', '==', user.uid));
    }, [user, firestore, isAdmin]);

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

    const diagnostics = {
        page: 'admin-children',
        auth: { isAuthenticated: !!user, isAdmin, loading: userLoading || adminLoading, error: null, },
        firestore: { collection: 'children', count: children.length, sampleIds: children.slice(0, 3).map(c => c.id), },
        ...(error ? { firestoreErrorChildren: error } : {})
    };

    const handleCopyDiagnostics = () => {
        navigator.clipboard.writeText(`Page: admin-children\n\nDiagnostics\n${JSON.stringify(diagnostics, null, 2)}`);
        toast({ title: 'Copied to clipboard!' });
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
                {children.map((child) => (
                    <Card key={child.id}>
                        <CardHeader className="flex flex-row items-center gap-4">
                            <Avatar className="h-16 w-16">
                                <AvatarImage src={child.avatarUrl} alt={child.displayName} />
                                <AvatarFallback>{child.displayName.charAt(0)}</AvatarFallback>
                            </Avatar>
                            <div>
                                <CardTitle>{child.displayName}</CardTitle>
                                {child.dateOfBirth && <CardDescription>Born: {new Date(child.dateOfBirth).toLocaleDateString()}</CardDescription>}
                            </div>
                        </CardHeader>
                        <CardFooter className="flex justify-end gap-2">
                             <Button variant="outline" size="sm" onClick={() => handleManagePhotos(child)}>
                                <ImageIcon className="mr-2 h-4 w-4"/>
                                Manage Photos
                             </Button>
                        </CardFooter>
                    </Card>
                ))}
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
                        {user && <ChildForm parentUid={user.uid} onSave={() => setIsCreateOpen(false)} />}
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

    