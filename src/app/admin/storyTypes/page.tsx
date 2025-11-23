'use client';

import { useAdminStatus } from '@/hooks/use-admin-status';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { LoaderCircle } from 'lucide-react';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useEffect, useState } from 'react';
import { useFirestore } from '@/firebase';
import { collection, doc, onSnapshot, writeBatch, query, orderBy } from 'firebase/firestore';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import type { StoryType } from '@/lib/types';


const sampleStoryTypes: StoryType[] = [
    {
        id: "animal_adventure_v1",
        name: "Animal Adventure",
        shortDescription: "A friendly animal goes on a small adventure to meet a friend or find something special.",
        ageRange: "3-5",
        status: "live",
        tags: ["animals", "adventure", "gentle"],
        defaultPhaseId: "story_beat_phase_v1",
        endingPhaseId: "ending_phase_v1",
        levelBands: ["low", "medium", "high"],
        arcTemplate: {
            steps: ["introduce_character", "explore_setting", "tiny_goal", "tiny_obstacle", "resolution", "happy_close"]
        }
    },
    {
        id: "magical_friend_v1",
        name: "Magical Friend",
        shortDescription: "A gentle magical friend helps with a small problem using kind, sparkly magic.",
        ageRange: "3-5",
        status: "live",
        tags: ["magic", "friendship", "gentle"],
        defaultPhaseId: "story_beat_phase_v1",
        endingPhaseId: "ending_phase_v1",
        levelBands: ["low", "medium", "high"],
        arcTemplate: {
            steps: ["introduce_character", "meet_magical_friend", "discover_small_problem", "gentle_magic_helps", "resolution", "happy_close"]
        }
    },
    {
        id: "big_feelings_v1",
        name: "Big Feelings",
        shortDescription: "A character notices a big feeling and gently learns about it with help from a friend.",
        ageRange: "3-5",
        status: "live",
        tags: ["feelings", "friendship", "gentle"],
        defaultPhaseId: "story_beat_phase_v1",
        endingPhaseId: "ending_phase_v1",
        levelBands: ["low", "medium", "high"],
        arcTemplate: {
            steps: ["introduce_character", "notice_feeling", "talk_with_helper", "try_small_action", "feeling_softens", "happy_close"]
        }
    },
    {
        id: "favorite_place_adventure_v1",
        name: "Adventure in a Favorite Place",
        shortDescription: "A small adventure happens in the child’s favorite place, using warmup information.",
        ageRange: "3-5",
        status: "live",
        tags: ["place", "exploration", "gentle"],
        defaultPhaseId: "story_beat_phase_v1",
        endingPhaseId: "ending_phase_v1",
        levelBands: ["low", "medium", "high"],
        arcTemplate: {
            steps: ["introduce_character", "arrive_at_favorite_place", "tiny_goal", "tiny_obstacle", "resolution", "happy_close"]
        }
    },
    {
        id: "silly_story_v1",
        name: "Silly Story",
        shortDescription: "A very silly story with giggles, funny things, and safe, playful surprises.",
        ageRange: "3-5",
        status: "live",
        tags: ["silly", "funny", "play"],
        defaultPhaseId: "story_beat_phase_v1",
        endingPhaseId: "ending_phase_v1",
        levelBands: ["low", "medium", "high"],
        arcTemplate: {
            steps: ["introduce_character", "discover_silly_thing", "play_with_silliness", "tiny_surprise", "resolution", "happy_close"]
        }
    },
    {
        id: "bedtime_calm_v1",
        name: "Bedtime Calm Story",
        shortDescription: "A soft, sleepy story that ends with everyone cozy and calm.",
        ageRange: "3-5",
        status: "live",
        tags: ["bedtime", "calm", "gentle"],
        defaultPhaseId: "story_beat_phase_v1",
        endingPhaseId: "ending_phase_v1",
        levelBands: ["low", "medium", "high"],
        arcTemplate: {
            steps: ["introduce_character", "quiet_activity", "soft_change", "getting_cozy", "sleepy_close", "happy_close"]
        }
    }
];

export default function AdminStoryTypesPage() {
  const { isAuthenticated, isAdmin, email, loading: authLoading } = useAdminStatus();
  const firestore = useFirestore();
  const { toast } = useToast();

  const [types, setTypes] = useState<StoryType[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!firestore || !isAdmin) {
      setLoading(false);
      return;
    }
    
    setLoading(true);
    const typesRef = collection(firestore, 'storyTypes');
    const q = query(typesRef, orderBy('name', 'asc'));
    
    const unsubscribe = onSnapshot(q, 
      (snapshot) => {
        const typeList = snapshot.docs.map(d => d.data() as StoryType);
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
  }, [firestore, isAdmin]);
  
  const handleCreateSampleTypes = async () => {
    if (!firestore) return;
    try {
        const batch = writeBatch(firestore);
        sampleStoryTypes.forEach(t => {
            const docRef = doc(firestore, "storyTypes", t.id);
            batch.set(docRef, t);
        });
        await batch.commit();
        toast({ title: 'Success', description: 'Sample story types created.' });
    } catch (e: any) {
        console.error("Error creating sample types:", e);
        toast({ title: 'Error', description: e.message, variant: 'destructive' });
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
    if (!isAdmin) {
      return <p>You are signed in but do not have admin rights.</p>;
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
      <Table>
          <TableHeader>
              <TableRow>
                  <TableHead>ID</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Age Range</TableHead>
                  <TableHead>Tags</TableHead>
                  <TableHead>Default Phase ID</TableHead>
                  <TableHead>Ending Phase ID</TableHead>
              </TableRow>
          </TableHeader>
          <TableBody>
              {types.map((type) => (
                  <TableRow key={type.id}>
                      <TableCell className="font-mono">{type.id}</TableCell>
                      <TableCell>{type.name}</TableCell>
                      <TableCell>{type.status}</TableCell>
                      <TableCell>{type.ageRange}</TableCell>
                      <TableCell>{type.tags.join(', ')}</TableCell>
                      <TableCell className="font-mono">{type.defaultPhaseId}</TableCell>
                      <TableCell className="font-mono">{type.endingPhaseId}</TableCell>
                  </TableRow>
              ))}
          </TableBody>
      </Table>
    );
  };

  return (
    <div className="container mx-auto p-4 sm:p-6 md:p-8">
      <Card>
        <CardHeader>
          <CardTitle>Story Types</CardTitle>
          <CardDescription>
            Configuration for different story templates and arcs.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {renderContent()}
        </CardContent>
      </Card>
      
      <Card className="mt-8">
        <CardHeader>
          <CardTitle>Diagnostics</CardTitle>
        </CardHeader>
        <CardContent>
          <pre className="bg-muted p-4 rounded-lg overflow-x-auto">
            <code>{JSON.stringify(diagnostics, null, 2)}</code>
          </pre>
        </CardContent>
      </Card>
    </div>
  );
}
