'use client';

import { useAdminStatus } from '@/hooks/use-admin-status';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { LoaderCircle, Plus } from 'lucide-react';
import { DiagnosticsPanel } from '@/components/diagnostics-panel';
import { useEffect, useState } from 'react';
import { useFirestore, useAuth } from '@/firebase';
import { collection, onSnapshot, query, orderBy } from 'firebase/firestore';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import type { StoryType, StoryTypePromptConfig, ArcStep } from '@/lib/types';
import { api } from '@/lib/api';
import { BackgroundMusicEditor } from '@/components/admin/story-types/background-music-editor';
import { CreateStoryTypeDialog } from '@/components/admin/story-types/create-story-type-dialog';
import { sampleStoryTypes } from '@/components/admin/story-types/shared';
import { StoryTypeCard } from '@/components/admin/story-types/story-type-card';

export default function AdminStoryTypesPage() {
  const { isAuthenticated, isAdmin, isWriter, email, loading: authLoading } = useAdminStatus();
  const firestore = useFirestore();
  const auth = useAuth();
  const { toast } = useToast();

  const [types, setTypes] = useState<StoryType[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);

  useEffect(() => {
    if (!firestore || (!isAdmin && !isWriter)) {
      setLoading(false);
      return;
    }

    setLoading(true);
    const typesRef = collection(firestore, 'storyTypes');
    const q = query(typesRef, orderBy('name', 'asc'));

    const unsubscribe = onSnapshot(q,
      (snapshot) => {
        const typeList = snapshot.docs.map(d => ({ ...d.data(), id: d.id } as StoryType));
        setTypes(typeList);
        setLoading(false);
        setError(null);
      },
      (err) => {
        console.error("Error fetching story types:", err);
        setError("Could not fetch story types.");
        setTypes([]);
        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, [firestore, isAdmin, isWriter]);

  const handleCreateSampleTypes = async () => {
    if (!firestore) return;
    try {
        await api.catalog.admin.batch('storyTypes', sampleStoryTypes.map((t) => ({ id: t.id, data: t as unknown as Record<string, unknown> })));
        toast({ title: 'Success', description: 'Sample story types created.' });
    } catch (e: any) {
        console.error("Error creating sample types:", e);
        toast({ title: 'Error', description: e.message, variant: 'destructive' });
    }
  };

  const handleCreateStoryType = async (storyType: Omit<StoryType, 'createdAt' | 'updatedAt'>) => {
    if (!firestore) return;
    try {
      await api.catalog.admin.set('storyTypes', storyType.id, storyType as unknown as Record<string, unknown>);
      toast({ title: 'Success', description: `Story type "${storyType.name}" created.` });
    } catch (e: any) {
      console.error("Error creating story type:", e);
      toast({ title: 'Error', description: e.message, variant: 'destructive' });
      throw e;
    }
  };

  const handleUpdateArcSteps = async (storyTypeId: string, steps: ArcStep[]) => {
    if (!firestore) return;
    try {
      await api.catalog.admin.update('storyTypes', storyTypeId, { 'arcTemplate.steps': steps });
      toast({ title: 'Success', description: 'Arc steps updated.' });
    } catch (e: any) {
      console.error("Error updating arc steps:", e);
      toast({ title: 'Error', description: e.message, variant: 'destructive' });
    }
  };

  const handleUpdatePromptConfig = async (storyTypeId: string, promptConfig: StoryTypePromptConfig) => {
    if (!firestore) return;
    try {
      await api.catalog.admin.update('storyTypes', storyTypeId, { promptConfig });
      toast({ title: 'Success', description: 'Prompt configuration updated.' });
    } catch (e: any) {
      console.error("Error updating prompt config:", e);
      toast({ title: 'Error', description: e.message, variant: 'destructive' });
    }
  };

  const handleUpdateSettings = async (storyTypeId: string, updates: Partial<StoryType>) => {
    if (!firestore) return;
    try {
      await api.catalog.admin.update('storyTypes', storyTypeId, updates as Record<string, unknown>);
      toast({ title: 'Success', description: 'Story type settings updated.' });
    } catch (e: any) {
      console.error("Error updating settings:", e);
      toast({ title: 'Error', description: e.message, variant: 'destructive' });
    }
  };

  const handleUpdateMusic = async (storyTypeId: string, musicConfig: { prompt: string }) => {
    if (!firestore) return;
    try {
      await api.catalog.admin.update('storyTypes', storyTypeId, { 'backgroundMusic.prompt': musicConfig.prompt });
      // Note: toast is shown by the BackgroundMusicEditor component
    } catch (e: any) {
      console.error("Error updating music config:", e);
      throw e; // Re-throw so the editor can handle it
    }
  };

  const diagnostics = {
    page: 'admin-storyTypes',
    auth: {
      isAuthenticated,
      email,
      isAdmin,
      loading: authLoading,
      error: null,
    },
    firestore: {
        collection: 'storyTypes',
        count: types.length,
        sampleIds: types.slice(0, 3).map(t => t.id),
    },
    ...(error ? { firestoreError: error } : {})
  };


  const renderContent = () => {
    if (authLoading || loading) {
      return <div className="flex items-center gap-2"><LoaderCircle className="h-5 w-5 animate-spin" /><span>Loading story types...</span></div>;
    }
    if (!isAuthenticated) {
      return <p>You must be signed in to access admin pages.</p>;
    }
    if (!isAdmin && !isWriter) {
      return <p>You are signed in but do not have admin or writer rights.</p>;
    }
    if (error) {
        return <p className="text-destructive">{error}</p>;
    }
    if (types.length === 0) {
        return (
            <div className="text-center py-8 border-2 border-dashed rounded-lg">
                <p className="text-muted-foreground mb-4">No story types found.</p>
                <Button onClick={handleCreateSampleTypes}>Create sample story types</Button>
            </div>
        )
    }

    return (
      <div className="space-y-4">
        {types.map((type) => (
          <StoryTypeCard
            key={type.id}
            storyType={type}
            onUpdateArcSteps={handleUpdateArcSteps}
            onUpdatePromptConfig={handleUpdatePromptConfig}
            onUpdateSettings={handleUpdateSettings}
            onUpdateMusic={handleUpdateMusic}
          />
        ))}
      </div>
    );
  };

  return (
    <div className="container mx-auto p-4 sm:p-6 md:p-8">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle>Story Types</CardTitle>
            <CardDescription>
              Configuration for different story templates and arcs.
            </CardDescription>
          </div>
          <div className="flex gap-2">
            <Button onClick={() => setCreateDialogOpen(true)}>
              <Plus className="h-4 w-4 mr-2" />
              Create New
            </Button>
            {types.length > 0 && (
              <Button variant="outline" onClick={handleCreateSampleTypes}>
                Reset to Sample Types
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {renderContent()}
        </CardContent>
      </Card>

      <DiagnosticsPanel pageName="admin-storyTypes" data={diagnostics} className="mt-8" />

      <CreateStoryTypeDialog
        open={createDialogOpen}
        onOpenChange={setCreateDialogOpen}
        onCreate={handleCreateStoryType}
      />
    </div>
  );
}
