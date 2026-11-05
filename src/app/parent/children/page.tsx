'use client';

/**
 * The parent's children (slice 5.7b). Read and changed through
 * `/api/children/**`; photos and the avatar through `LikenessPanel`. The
 * browser never writes child documents.
 */
import { useAdminStatus } from '@/hooks/use-admin-status';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { LoaderCircle, Plus, Pencil, Sparkles, Image as ImageIcon, Volume2 } from 'lucide-react';
import { DiagnosticsPanel } from '@/components/diagnostics-panel';
import { useState, useCallback } from 'react';
import { DeleteButton, UndoBanner, useDeleteWithUndo } from '@/components/shared/DeleteWithUndo';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useUser } from '@/firebase/auth/use-user';
import { Badge } from '@/components/ui/badge';
import { useRouter } from 'next/navigation';
import { useAppContext } from '@/hooks/use-app-context';
import { EntityEditor } from '@/components/shared/EntityEditor';
import { LikenessPanel } from '@/components/shared/LikenessPanel';
import { track, ANALYTICS_EVENTS } from '@/lib/analytics';
import { VoiceSelector } from '@/components/parent/VoiceSelector';
import { useChildren } from '@/lib/people/use-people';
import { api, type ChildView, type PersonView } from '@/lib/api';

export default function ManageChildrenPage() {
    const { user, loading: userLoading } = useUser();
    const { isAdmin, loading: adminLoading } = useAdminStatus();
    const { toast } = useToast();
    const router = useRouter();
    const { setActiveChildId } = useAppContext();
    const { items: children, loading, error, reload, replace } = useChildren();

    const [isCreateOpen, setIsCreateOpen] = useState(false);
    const [isPhotosOpen, setIsPhotosOpen] = useState(false);
    const [selectedChild, setSelectedChild] = useState<ChildView | null>(null);
    const [editingChild, setEditingChild] = useState<ChildView | null>(null);
    const [isEditOpen, setIsEditOpen] = useState(false);
    const [isVoiceOpen, setIsVoiceOpen] = useState(false);
    const [voiceChild, setVoiceChild] = useState<ChildView | null>(null);

    const replacePerson = useCallback((person?: PersonView) => {
        if (person?.kind === 'child') replace(person);
    }, [replace]);

    // Select this child and drop into their experience (same flow as the
    // "Who is playing?" home screen).
    const handlePlayAsChild = (child: ChildView) => {
        setActiveChildId(child.id);
        router.push(`/child/${child.id}`);
    }

    const handleManagePhotos = (child: ChildView) => {
        setSelectedChild(child);
        setIsPhotosOpen(true);
    }

    const handleEditChild = (child: ChildView) => {
        setEditingChild(child);
        setIsEditOpen(true);
    }

    const handleManageVoice = (child: ChildView) => {
        setVoiceChild(child);
        setIsVoiceOpen(true);
    }

    const handleVoiceSelect = async (childId: string, voiceId: string) => {
        replacePerson(await api.people.update('child', childId, { preferredVoiceId: voiceId }));
    }

    const handleAutoReadAloudChange = async (childId: string, enabled: boolean) => {
        replacePerson(await api.people.update('child', childId, { autoReadAloud: enabled }));
    }

    // Delete with undo functionality
    const { deletedItem, markAsDeleted, clearDeletedItem } = useDeleteWithUndo();

    const handleDeleteChild = useCallback(async (childId: string) => {
        const child = children.find(c => c.id === childId);
        if (!child) return;
        try {
            await api.people.remove('child', childId);
            await reload();
            markAsDeleted({ id: childId, name: child.displayName, type: 'child' });
            toast({ title: 'Child profile deleted', description: `${child.displayName} has been removed.` });
        } catch (err) {
            toast({ title: 'Could not delete', description: err instanceof Error ? err.message : String(err), variant: 'destructive' });
        }
    }, [children, markAsDeleted, reload, toast]);

    const handleUndoDelete = useCallback(async (childId: string) => {
        try {
            await api.people.restore('child', childId);
            await reload();
            toast({ title: 'Undo successful', description: 'The child profile has been restored.' });
        } catch (err) {
            toast({ title: 'Could not restore', description: err instanceof Error ? err.message : String(err), variant: 'destructive' });
        }
    }, [reload, toast]);

    const visibleChildren = children;

    const diagnostics = {
        page: 'parent-children',
        auth: { isAuthenticated: !!user, isAdmin, loading: userLoading || adminLoading, error: null, },
        api: { route: '/api/children?view=person', count: children.length, sampleIds: children.slice(0, 3).map(c => c.id), },
        ...(error ? { apiError: error } : {})
    };

    const getDisplayDate = (date: string) => {
        const d = new Date(`${date}T00:00:00`);
        return isNaN(d.getTime()) ? '' : d.toLocaleDateString();
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
                <div className="text-center py-8 border-2 border-dashed rounded-lg" data-wiz-target="add-first-child">
                    <h2 className="text-xl font-semibold mb-2">Add your first child</h2>
                    <p className="text-muted-foreground mb-4 max-w-sm mx-auto">
                        Create a profile for your child to start making personalised stories starring them.
                    </p>
                    <Button onClick={() => setIsCreateOpen(true)}>
                        <Plus className="mr-2 h-4 w-4" />
                        Add your first child
                    </Button>
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
                                    <AvatarImage src={child.likeness.avatar ?? undefined} alt={child.displayName} className="object-cover" />
                                    <AvatarFallback>{child.displayName.charAt(0)}</AvatarFallback>
                                </Avatar>
                                <div>
                                    <CardTitle>{child.displayName}</CardTitle>
                                    {child.dateOfBirth && <CardDescription>Born: {getDisplayDate(child.dateOfBirth)}</CardDescription>}
                                </div>
                            </CardHeader>
                            <CardContent>
                                {child.description && <p className="text-sm text-muted-foreground mb-3">{child.description}</p>}
                                {(child.likes.length > 0 || child.dislikes.length > 0) ? (
                                    <div className="space-y-2">
                                        {child.likes.length > 0 && (
                                            <div>
                                                <p className="text-xs font-semibold mb-1">Likes:</p>
                                                <div className="flex flex-wrap gap-1">
                                                    {child.likes.map((like) => (
                                                        <Badge key={like} variant="secondary" className="text-xs">{like}</Badge>
                                                    ))}
                                                </div>
                                            </div>
                                        )}
                                        {child.dislikes.length > 0 && (
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
                                <Button size="sm" className="mr-auto" onClick={() => handlePlayAsChild(child)} data-wiz-target={`child-play-${child.id}`}>
                                    <Sparkles className="mr-2 h-4 w-4" />
                                    Play as {child.displayName}
                                </Button>
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
                    <DialogContent className="max-h-[90vh] overflow-y-auto">
                        <DialogHeader>
                            <DialogTitle>Create New Child Profile</DialogTitle>
                        </DialogHeader>
                        {user && (
                            <EntityEditor
                                entityType="child"
                                entity={null}
                                onSave={(saved) => { replacePerson(saved); setIsCreateOpen(false); }}
                                onCancel={() => setIsCreateOpen(false)}
                                onCreated={() => track(ANALYTICS_EVENTS.childCreated, { source: 'parent' })}
                            />
                        )}
                    </DialogContent>
                </Dialog>

                <Dialog open={isPhotosOpen} onOpenChange={setIsPhotosOpen}>
                    <DialogContent className="max-h-[90vh] overflow-y-auto">
                        <DialogHeader>
                            <DialogTitle>Manage Photos for {selectedChild?.displayName}</DialogTitle>
                        </DialogHeader>
                        {selectedChild && <LikenessPanel person={selectedChild} onChange={replacePerson} />}
                    </DialogContent>
                </Dialog>

                <Dialog open={isEditOpen} onOpenChange={setIsEditOpen}>
                    <DialogContent className="max-h-[90vh] overflow-y-auto">
                        <DialogHeader>
                            <DialogTitle>Edit {editingChild?.displayName}</DialogTitle>
                        </DialogHeader>
                        {user && editingChild && (
                            <EntityEditor
                                entityType="child"
                                entity={editingChild}
                                onSave={(saved) => { replacePerson(saved); setIsEditOpen(false); }}
                                onCancel={() => setIsEditOpen(false)}
                                onLikenessChange={replacePerson}
                            />
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
                                onAutoReadAloudChange={(enabled) => handleAutoReadAloudChange(voiceChild.id, enabled)}
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

                <DiagnosticsPanel pageName="parent-children" data={diagnostics} className="mt-8" />
            </div>
        </>
    );
}
