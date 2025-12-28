
'use client';

import { useAdminStatus } from '@/hooks/use-admin-status';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Copy, LoaderCircle, Plus, User, Pencil, X, Sparkles, Image as ImageIcon, Volume2, Trash2 } from 'lucide-react';
import { useEffect, useState, useCallback, useMemo } from 'react';
import { useFirestore } from '@/firebase';
import { collection, doc, onSnapshot, setDoc, serverTimestamp, query, where, writeBatch, updateDoc, deleteField } from 'firebase/firestore';
import { DeleteButton, UndoBanner, useDeleteWithUndo, type DeletedItem } from '@/components/shared/DeleteWithUndo';
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
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { useRouter } from 'next/navigation';
import { useAppContext } from '@/hooks/use-app-context';
import { EntityEditor } from '@/components/shared/EntityEditor';
import { VoiceSelector } from '@/components/parent/VoiceSelector';

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

// Wrapper to use EntityEditor for children
function ChildForm({ parentUid, onSave, child }: { parentUid: string, onSave: () => void, child?: ChildProfile | null }) {
    return (
        <EntityEditor
            entityType="child"
            entity={child}
            parentUid={parentUid}
            onSave={onSave}
            onCancel={onSave}
        />
    );
}

function AvatarGenerator({ child, onAvatarUpdate }: { child: ChildProfile, onAvatarUpdate: (url: string) => void }) {
    const { user } = useUser();
    const [isLoading, setIsLoading] = useState(false);
    const [isAnimationLoading, setIsAnimationLoading] = useState(false);
    const [generatedAvatar, setGeneratedAvatar] = useState<string | null>(null);
    const [generatedAnimation, setGeneratedAnimation] = useState<string | null>(null);
    const [feedback, setFeedback] = useState('');
    const [error, setError] = useState<string | null>(null);
    const [animationError, setAnimationError] = useState<string | null>(null);
    const { toast } = useToast();

    // The avatar to display: newly generated > existing avatar > null
    const displayAvatar = generatedAvatar || child.avatarUrl;
    // The animation to display: newly generated > existing animation > null
    const displayAnimation = generatedAnimation || child.avatarAnimationUrl;
    const animationStatus = child.avatarAnimationGeneration?.status;

    const handleGenerate = async () => {
        if (!user) {
            toast({ title: 'Authentication Error', description: 'Please sign in again to generate an avatar.', variant: 'destructive' });
            return;
        }

        setIsLoading(true);
        setError(null);
        try {
            const idToken = await user.getIdToken();
            const res = await fetch('/api/generateAvatar', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${idToken}`,
                },
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

    const handleGenerateAnimation = async () => {
        if (!user) {
            toast({ title: 'Authentication Error', description: 'Please sign in again.', variant: 'destructive' });
            return;
        }

        if (!displayAvatar) {
            toast({ title: 'No Avatar', description: 'Please generate an avatar first before creating an animation.', variant: 'destructive' });
            return;
        }

        setIsAnimationLoading(true);
        setAnimationError(null);
        try {
            const idToken = await user.getIdToken();
            const res = await fetch('/api/generateAvatar/animation', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${idToken}`,
                },
                body: JSON.stringify({ childId: child.id, forceRegenerate: true }),
            });
            const result = await res.json();
            console.log('[AvatarGenerator] Animation generation result:', result);
            // Log debug info prominently for Veo troubleshooting
            if (result.debugInfo) {
                console.log('[AvatarGenerator] === VEO DEBUG INFO ===');
                console.log('[AvatarGenerator] Veo Attempted:', result.debugInfo.veoAttempted);
                console.log('[AvatarGenerator] Fallback Used:', result.debugInfo.fallbackUsed);
                if (result.debugInfo.veoError) {
                    console.log('[AvatarGenerator] Veo Error:', result.debugInfo.veoError);
                }
                if (result.debugInfo.veoErrorCode) {
                    console.log('[AvatarGenerator] Veo Error Code:', result.debugInfo.veoErrorCode);
                }
                if (result.debugInfo.veoResponse) {
                    console.log('[AvatarGenerator] Veo Response:', result.debugInfo.veoResponse);
                }
                console.log('[AvatarGenerator] === END VEO DEBUG INFO ===');
            }
            if (!res.ok || !result.ok) {
                throw new Error(result.errorMessage || 'Failed to generate animation.');
            }
            console.log('[AvatarGenerator] Setting generatedAnimation to:', result.animationUrl);
            console.log('[AvatarGenerator] Current child.avatarAnimationUrl:', child.avatarAnimationUrl);
            setGeneratedAnimation(result.animationUrl);

            // Check if it's a video or static image
            const decodedUrl = decodeURIComponent(result.animationUrl || '');
            const isVideo = decodedUrl.includes('.mp4') || decodedUrl.includes('.webm');
            console.log('[AvatarGenerator] New animation is video:', isVideo, 'URL preview:', decodedUrl.substring(0, 150));

            toast({
                title: 'Animation Generated!',
                description: isVideo ? 'Video animation created!' : 'Dance pose image created (Veo video unavailable).'
            });
        } catch (err: any) {
            console.error('[AvatarGenerator] Animation generation error:', err);
            setAnimationError(err.message);
            toast({ title: 'Animation Generation Failed', description: err.message, variant: 'destructive' });
        } finally {
            setIsAnimationLoading(false);
        }
    };

    return (
        <Card className="bg-muted/50">
            <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2"><Sparkles className="text-primary" /> AI Avatar Generator</CardTitle>
                <CardDescription>Create a cartoon avatar from your child's photos.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
                {/* Avatar and Animation side by side */}
                <div className="grid grid-cols-2 gap-6">
                    {/* Static Avatar */}
                    <div className="space-y-3">
                        <Label className="text-center block font-medium">Static Avatar</Label>
                        <div className="flex justify-center">
                            {isLoading ? (
                                <div className="h-32 w-32 flex items-center justify-center bg-muted rounded-full">
                                    <LoaderCircle className="h-8 w-8 animate-spin text-primary" />
                                </div>
                            ) : displayAvatar ? (
                                <div className="relative">
                                    <Image src={displayAvatar} alt="Avatar" width={128} height={128} className="rounded-full border-4 border-primary shadow-md object-cover" />
                                    {generatedAvatar && (
                                        <Badge className="absolute -bottom-2 left-1/2 -translate-x-1/2 bg-green-500 text-xs">New!</Badge>
                                    )}
                                </div>
                            ) : (
                                <div className="h-32 w-32 flex items-center justify-center bg-muted rounded-full text-muted-foreground">
                                    <User className="h-8 w-8" />
                                </div>
                            )}
                        </div>
                        {error && <p className="text-xs text-destructive text-center">{error}</p>}
                    </div>

                    {/* Dancing Animation */}
                    <div className="space-y-3">
                        <Label className="text-center block font-medium">Dancing Animation</Label>
                        <div className="flex justify-center">
                            {isAnimationLoading ? (
                                <div className="h-32 w-32 flex items-center justify-center bg-muted rounded-full">
                                    <LoaderCircle className="h-8 w-8 animate-spin text-primary" />
                                </div>
                            ) : displayAnimation ? (
                                <div className="relative">
                                    {/* Check if it's a video - decode URL first since Firebase encodes the path */}
                                    {(() => {
                                        const decodedUrl = decodeURIComponent(displayAnimation);
                                        const isVideo = decodedUrl.includes('.mp4') || decodedUrl.includes('.webm');
                                        const isGif = decodedUrl.includes('.gif');
                                        const isStaticImage = decodedUrl.includes('.png') || decodedUrl.includes('.jpg') || decodedUrl.includes('.jpeg');
                                        console.log('[AvatarGenerator] Animation display:', { isVideo, isGif, isStaticImage, decodedUrl: decodedUrl.substring(0, 100) });
                                        if (isVideo) {
                                            return (
                                                <video
                                                    src={displayAnimation}
                                                    autoPlay
                                                    loop
                                                    muted
                                                    playsInline
                                                    className="h-32 w-32 rounded-full border-4 border-primary shadow-md object-cover"
                                                />
                                            );
                                        }
                                        if (isGif) {
                                            // GIF animates natively
                                            return (
                                                <img
                                                    src={displayAnimation}
                                                    alt="Dancing Avatar"
                                                    className="h-32 w-32 rounded-full border-4 border-primary shadow-md object-cover"
                                                />
                                            );
                                        }
                                        // Static image (PNG/JPG) with CSS bounce animation
                                        return (
                                            <img
                                                src={displayAnimation}
                                                alt="Dancing Avatar"
                                                className="h-32 w-32 rounded-full border-4 border-primary shadow-md object-cover"
                                                style={{ animation: 'avatarDance 0.8s ease-in-out infinite' }}
                                            />
                                        );
                                    })()}
                                    {generatedAnimation && (
                                        <Badge className="absolute -bottom-2 left-1/2 -translate-x-1/2 bg-green-500 text-xs">New!</Badge>
                                    )}
                                    {animationStatus === 'generating' && (
                                        <Badge className="absolute -bottom-2 left-1/2 -translate-x-1/2 bg-yellow-500 text-xs">Generating...</Badge>
                                    )}
                                </div>
                            ) : displayAvatar ? (
                                <div className="h-32 w-32 flex items-center justify-center bg-muted/50 rounded-full text-muted-foreground border-2 border-dashed">
                                    <span className="text-xs text-center px-2">Click below to generate</span>
                                </div>
                            ) : (
                                <div className="h-32 w-32 flex items-center justify-center bg-muted rounded-full text-muted-foreground">
                                    <span className="text-xs text-center px-2">Avatar needed first</span>
                                </div>
                            )}
                        </div>
                        {animationError && <p className="text-xs text-destructive text-center">{animationError}</p>}
                        {animationStatus === 'error' && child.avatarAnimationGeneration?.lastErrorMessage && (
                            <p className="text-xs text-destructive text-center">{child.avatarAnimationGeneration.lastErrorMessage}</p>
                        )}
                    </div>
                </div>

                {/* CSS for dance animation */}
                <style dangerouslySetInnerHTML={{ __html: `
                    @keyframes avatarDance {
                        0%, 100% { transform: translateY(0) rotate(0deg) scale(1); }
                        25% { transform: translateY(-6px) rotate(-3deg) scale(1.02); }
                        50% { transform: translateY(0) rotate(0deg) scale(1); }
                        75% { transform: translateY(-6px) rotate(3deg) scale(1.02); }
                    }
                `}} />

                <div className="space-y-2">
                    <Label htmlFor="feedback">Feedback (optional)</Label>
                    <Textarea id="feedback" value={feedback} onChange={(e) => setFeedback(e.target.value)} placeholder="e.g., make the hair blonder, add glasses..." />
                </div>

                {/* Avatar Generation Buttons */}
                <div className="flex gap-2">
                    <Button onClick={handleGenerate} disabled={isLoading} className="flex-1">
                        {isLoading ? 'Generating...' : (displayAvatar ? 'Regenerate Avatar' : 'Generate Avatar')}
                    </Button>
                    {generatedAvatar && <Button onClick={handleAccept} className="flex-1">Accept & Save</Button>}
                </div>

                {/* Animation Generation Button */}
                <div className="flex gap-2">
                    <Button
                        onClick={handleGenerateAnimation}
                        disabled={isAnimationLoading || !displayAvatar}
                        variant="outline"
                        className="flex-1"
                    >
                        {isAnimationLoading ? 'Generating Animation...' : (displayAnimation ? 'Regenerate Animation' : 'Generate Dancing Animation')}
                    </Button>
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

function ChildIcon({ profile }: { profile: ChildProfile }) {
  const router = useRouter();
  const { setActiveChildId } = useAppContext();

  const handleSelectChild = () => {
    setActiveChildId(profile.id);
    router.push(`/child/${profile.id}`);
  };

  return (
    <div className="flex flex-col items-center gap-2 text-center w-32">
      <button onClick={handleSelectChild} className="rounded-full hover:ring-4 hover:ring-primary/50 transition-all">
        <Avatar className="h-24 w-24 border-4 border-white shadow-md">
          <AvatarImage src={profile.avatarUrl} alt={profile.displayName} className="object-cover" />
          <AvatarFallback className="text-3xl bg-secondary text-secondary-foreground">
             {profile.displayName ? profile.displayName.charAt(0) : <User />}
          </AvatarFallback>
        </Avatar>
      </button>
      <p className="font-bold text-lg truncate w-full">{profile.displayName}</p>
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
    const [isVoiceOpen, setIsVoiceOpen] = useState(false);
    const [voiceChild, setVoiceChild] = useState<ChildProfile | null>(null);

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

    const handleManageVoice = (child: ChildProfile) => {
        setVoiceChild(child);
        setIsVoiceOpen(true);
    }

    const handleVoiceSelect = async (childId: string, voiceId: string) => {
        if (!firestore) return;
        const childRef = doc(firestore, 'children', childId);
        await updateDoc(childRef, {
            preferredVoiceId: voiceId,
            updatedAt: serverTimestamp(),
        });
    }

    // Delete with undo functionality
    const { deletedItem, markAsDeleted, clearDeletedItem } = useDeleteWithUndo();

    const handleDeleteChild = useCallback(async (childId: string) => {
        if (!firestore || !user) return;
        const child = children.find(c => c.id === childId);
        if (!child) return;

        const childRef = doc(firestore, 'children', childId);
        await updateDoc(childRef, {
            deletedAt: serverTimestamp(),
            deletedBy: user.uid,
            updatedAt: serverTimestamp(),
        });

        markAsDeleted({ id: childId, name: child.displayName, type: 'child' });
        toast({ title: 'Child profile deleted', description: `${child.displayName} has been removed.` });
    }, [firestore, user, children, markAsDeleted, toast]);

    const handleUndoDelete = useCallback(async (childId: string) => {
        if (!firestore) return;

        const childRef = doc(firestore, 'children', childId);
        await updateDoc(childRef, {
            deletedAt: deleteField(),
            deletedBy: deleteField(),
            updatedAt: serverTimestamp(),
        });

        toast({ title: 'Undo successful', description: 'The child profile has been restored.' });
    }, [firestore, toast]);

    // Filter out deleted children for display
    const visibleChildren = useMemo(() => {
        return children.filter(child => !child.deletedAt);
    }, [children]);

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
        if (visibleChildren.length === 0) {
            return (
                <div className="text-center py-8 border-2 border-dashed rounded-lg">
                    <p className="text-muted-foreground mb-4">No children found.</p>
                    <Button onClick={() => setIsCreateOpen(true)}>Create a child profile</Button>
                </div>
            )
        }

        return (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {visibleChildren.map((child) => {
                    return (
                        <Card key={child.id} data-wiz-target={`child-card-${child.id}`}>
                            <CardHeader className="flex flex-row items-center gap-4">
                                <Avatar className="h-16 w-16">
                                    <AvatarImage src={child.avatarUrl} alt={child.displayName} className="object-cover" />
                                    <AvatarFallback>{child.displayName.charAt(0)}</AvatarFallback>
                                </Avatar>
                                <div>
                                    <CardTitle>{child.displayName}</CardTitle>
                                    {child.dateOfBirth && <CardDescription>Born: {getDisplayDate(child.dateOfBirth)}</CardDescription>}
                                </div>
                            </CardHeader>
                            <CardContent>
                                {child.description && <p className="text-sm text-muted-foreground mb-3">{child.description}</p>}
                                {(child.likes?.length > 0 || child.dislikes?.length > 0) ? (
                                    <div className="space-y-2">
                                        {child.likes?.length > 0 && (
                                            <div>
                                                <p className="text-xs font-semibold mb-1">Likes:</p>
                                                <div className="flex flex-wrap gap-1">
                                                    {child.likes.map((like) => (
                                                        <Badge key={like} variant="secondary" className="text-xs">{like}</Badge>
                                                    ))}
                                                </div>
                                            </div>
                                        )}
                                        {child.dislikes?.length > 0 && (
                                            <div>
                                                <p className="text-xs font-semibold mb-1">Dislikes:</p>
                                                <div className="flex flex-wrap gap-1">
                                                    {child.dislikes.map((dislike) => (
                                                        <Badge key={dislike} variant="destructive" className="text-xs opacity-70">{dislike}</Badge>
                                                    ))}
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                ) : (
                                    <p className="text-sm text-muted-foreground italic">No likes/dislikes saved yet.</p>
                                )}
                            </CardContent>
                            <CardFooter className="flex flex-wrap justify-end gap-2">
                                <Button variant="outline" size="sm" onClick={() => handleEditChild(child)} data-wiz-target={`child-edit-${child.id}`}>
                                    <Pencil className="mr-2 h-4 w-4" />
                                    Edit
                                </Button>
                                <Button variant="outline" size="sm" onClick={() => handleManagePhotos(child)} data-wiz-target={`child-photos-${child.id}`}>
                                    <ImageIcon className="mr-2 h-4 w-4" />
                                    Photos
                                </Button>
                                <Button variant="outline" size="sm" onClick={() => handleManageVoice(child)} data-wiz-target={`child-voice-${child.id}`}>
                                    <Volume2 className="mr-2 h-4 w-4" />
                                    Voice
                                </Button>
                                <DeleteButton
                                    item={{ id: child.id, name: child.displayName }}
                                    itemType="child"
                                    onDelete={handleDeleteChild}
                                />
                            </CardFooter>
                        </Card>
                    );
                })}
            </div>
        );
    };

    return (
        <>
            <UndoBanner
                deletedItem={deletedItem}
                onUndo={handleUndoDelete}
                onDismiss={clearDeletedItem}
            />
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

                <Dialog open={isVoiceOpen} onOpenChange={setIsVoiceOpen}>
                    <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
                        <DialogHeader>
                            <DialogTitle>Story Voice for {voiceChild?.displayName}</DialogTitle>
                        </DialogHeader>
                        {voiceChild && (
                            <VoiceSelector
                                child={voiceChild}
                                onVoiceSelect={(voiceId) => handleVoiceSelect(voiceChild.id, voiceId)}
                            />
                        )}
                    </DialogContent>
                </Dialog>

                <div className="flex justify-between items-center mb-6">
                    <h1 className="text-3xl font-bold">Manage Children</h1>
                    <Button onClick={() => setIsCreateOpen(true)} data-wiz-target="children-add-button"><Plus className="mr-2"/> Add New Child</Button>
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
        </>
    );
}
