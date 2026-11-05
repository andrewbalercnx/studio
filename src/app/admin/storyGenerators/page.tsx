'use client';

import { useAdminStatus } from '@/hooks/use-admin-status';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { LoaderCircle, RefreshCw } from 'lucide-react';
import { DiagnosticsPanel } from '@/components/diagnostics-panel';
import { useEffect, useState } from 'react';
import { useFirestore, useAuth } from '@/firebase';
import { collection, onSnapshot } from 'firebase/firestore';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import type { StoryGenerator, AIModelName, StoryGeneratorPromptConfig } from '@/lib/types';
import { api } from '@/lib/api';
import { GeneratorCard } from '@/components/admin/story-generators/generator-card';

export default function AdminStoryGeneratorsPage() {
  const { isAuthenticated, isAdmin, isWriter, email, loading: authLoading } = useAdminStatus();
  const firestore = useFirestore();
  const auth = useAuth();
  const { toast } = useToast();

  const [generators, setGenerators] = useState<StoryGenerator[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [seeding, setSeeding] = useState(false);

  useEffect(() => {
    if (!firestore || (!isAdmin && !isWriter)) {
      setLoading(false);
      return;
    }

    setLoading(true);
    const generatorsRef = collection(firestore, 'storyGenerators');

    const unsubscribe = onSnapshot(generatorsRef,
      (snapshot) => {
        const genList = snapshot.docs.map(d => ({ ...d.data(), id: d.id } as StoryGenerator));
        // Sort by order (lower first), then by name
        genList.sort((a, b) => {
          const orderA = a.order ?? 0;
          const orderB = b.order ?? 0;
          if (orderA !== orderB) return orderA - orderB;
          return (a.name || a.id).localeCompare(b.name || b.id);
        });
        setGenerators(genList);
        setLoading(false);
        setError(null);
      },
      (err) => {
        console.error("Error fetching generators:", err);
        setError("Could not fetch story generators.");
        setGenerators([]);
        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, [firestore, isAdmin, isWriter]);

  const handleSeedGenerators = async () => {
    if (!auth.currentUser) return;
    setSeeding(true);
    try {
      const token = await auth.currentUser.getIdToken();
      const response = await fetch('/api/admin/story-generators/seed', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
        },
      });
      const result = await response.json();
      if (!result.ok) {
        throw new Error(result.errorMessage);
      }
      toast({ title: 'Success', description: result.message });
    } catch (error: any) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    } finally {
      setSeeding(false);
    }
  };

  const handleUpdateMusic = async (generatorId: string, prompt: string) => {
    if (!firestore) return;
    await api.catalog.admin.update('storyGenerators', generatorId, {
      'backgroundMusic.prompt': prompt,
    });
  };

  const handleUpdatePrompts = async (generatorId: string, prompts: Record<string, string>) => {
    if (!firestore) return;
    await api.catalog.admin.update('storyGenerators', generatorId, {
      prompts,
    });
  };

  const handleUpdateInfo = async (generatorId: string, data: { name: string; description: string; enabledForKids?: boolean; order?: number }) => {
    if (!firestore) return;
    await api.catalog.admin.update('storyGenerators', generatorId, {
      name: data.name,
      description: data.description,
      ...(data.enabledForKids !== undefined && { enabledForKids: data.enabledForKids }),
      ...(data.order !== undefined && { order: data.order }),
    });
  };

  const handleUpdateAISettings = async (
    generatorId: string,
    data: { defaultModel?: AIModelName; defaultTemperature?: number; promptConfig?: Record<string, StoryGeneratorPromptConfig> }
  ) => {
    if (!firestore) return;
    await api.catalog.admin.update('storyGenerators', generatorId, {
      ...(data.defaultModel !== undefined && { defaultModel: data.defaultModel }),
      ...(data.defaultTemperature !== undefined && { defaultTemperature: data.defaultTemperature }),
      ...(data.promptConfig !== undefined && { promptConfig: data.promptConfig }),
    });
  };

  const diagnostics = {
    page: 'admin-storyGenerators',
    auth: {
      isAuthenticated,
      email,
      isAdmin,
      isWriter,
      loading: authLoading,
    },
    firestore: {
      collection: 'storyGenerators',
      count: generators.length,
      ids: generators.map(g => g.id),
    },
    ...(error ? { error } : {}),
  };

  const renderContent = () => {
    if (authLoading || loading) {
      return (
        <div className="flex items-center gap-2">
          <LoaderCircle className="h-5 w-5 animate-spin" />
          <span>Loading generators...</span>
        </div>
      );
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
    if (generators.length === 0) {
      return (
        <div className="text-center py-8 border-2 border-dashed rounded-lg">
          <p className="text-muted-foreground mb-4">No story generators found.</p>
          <Button onClick={handleSeedGenerators} disabled={seeding}>
            {seeding ? <LoaderCircle className="h-4 w-4 animate-spin mr-2" /> : null}
            Seed Default Generators
          </Button>
        </div>
      );
    }

    return (
      <div className="space-y-4">
        {generators.map((gen) => (
          <GeneratorCard
            key={gen.id}
            generator={gen}
            onUpdateMusic={handleUpdateMusic}
            onUpdatePrompts={handleUpdatePrompts}
            onUpdateInfo={handleUpdateInfo}
            onUpdateAISettings={handleUpdateAISettings}
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
            <CardTitle>Story Generators</CardTitle>
            <CardDescription>
              Configure background music and AI prompts for story generation flows.
            </CardDescription>
          </div>
          {generators.length > 0 && (
            <Button variant="outline" onClick={handleSeedGenerators} disabled={seeding}>
              {seeding ? <LoaderCircle className="h-4 w-4 animate-spin mr-2" /> : <RefreshCw className="h-4 w-4 mr-2" />}
              Reset Defaults
            </Button>
          )}
        </CardHeader>
        <CardContent>
          {renderContent()}
        </CardContent>
      </Card>

      <DiagnosticsPanel pageName="admin-storyGenerators" data={diagnostics} className="mt-8" />
    </div>
  );
}
