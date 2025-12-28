
'use client';

import { useAdminStatus } from '@/hooks/use-admin-status';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Copy, LoaderCircle } from 'lucide-react';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useEffect, useState } from 'react';
import { useFirestore } from '@/firebase';
import { collection, doc, onSnapshot, writeBatch, query, orderBy } from 'firebase/firestore';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import type { StoryPhase } from '@/lib/types';


const samplePhases: StoryPhase[] = [
    {
        id: "warmup_phase_v1",
        name: "Warmup Phase",
        phaseType: "warmup",
        description: "Warmup questions to learn about the child and their world. Free-text answers, no options.",
        choiceCount: 0,
        allowMore: false,
        status: "live",
        orderIndex: 1,
    },
    {
        id: "story_beat_phase_v1",
        name: "Story Beat Phase",
        phaseType: "storyBeat",
        description: "The main story beats. The AI should present three short options and allow the child to ask for more options.",
        choiceCount: 3,
        allowMore: true,
        status: "live",
        orderIndex: 2,
    },
    {
        id: "ending_phase_v1",
        name: "Ending Phase",
        phaseType: "ending",
        description: "The story ending. The AI should propose three complete endings and allow the child to see more endings if they want.",
        choiceCount: 3,
        allowMore: true,
        status: "live",
        orderIndex: 3,
    },
];

export default function AdminStoryPhasesPage() {
  const { isAuthenticated, isAdmin, isWriter, email, loading: authLoading } = useAdminStatus();
  const firestore = useFirestore();
  const { toast } = useToast();

  const [phases, setPhases] = useState<StoryPhase[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!firestore || (!isAdmin && !isWriter)) {
      setLoading(false);
      return;
    }

    setLoading(true);
    const phasesRef = collection(firestore, 'storyPhases');
    const q = query(phasesRef, orderBy('orderIndex', 'asc'), orderBy('name', 'asc'));

    const unsubscribe = onSnapshot(q,
      (snapshot) => {
        const phaseList = snapshot.docs.map(d => d.data() as StoryPhase);
        setPhases(phaseList);
        setLoading(false);
        setError(null);
      },
      (err) => {
        console.error("Error fetching story phases:", err);
        setError("Could not fetch story phases.");
        setPhases([]);
        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, [firestore, isAdmin, isWriter]);
  
  const handleCreateSamplePhases = async () => {
    if (!firestore) return;
    try {
        const batch = writeBatch(firestore);
        samplePhases.forEach(p => {
            const docRef = doc(firestore, "storyPhases", p.id);
            batch.set(docRef, p);
        });
        await batch.commit();
        toast({ title: 'Success', description: 'Sample story phases created.' });
    } catch (e: any) {
        console.error("Error creating sample phases:", e);
        toast({ title: 'Error', description: e.message, variant: 'destructive' });
    }
  };


  const diagnostics = {
    page: 'admin-storyPhases',
    auth: {
      isAuthenticated,
      email,
      isAdmin,
      loading: authLoading,
      error: null, // useAdminStatus hook error
    },
    firestore: {
        collection: 'storyPhases',
        count: phases.length,
        sampleIds: phases.slice(0, 3).map(p => p.id),
    },
    ...(error ? { firestoreError: error } : {})
  };

  const handleCopyDiagnostics = () => {
    const textToCopy = `Page: admin-storyPhases\n\nDiagnostics\n${JSON.stringify(diagnostics, null, 2)}`;
    navigator.clipboard.writeText(textToCopy);
    toast({ title: 'Copied to clipboard!' });
  };

  const renderContent = () => {
    if (authLoading || loading) {
      return <div className="flex items-center gap-2"><LoaderCircle className="h-5 w-5 animate-spin" /><span>Loading story phases...</span></div>;
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
    if (phases.length === 0) {
        return (
            <div className="text-center py-8 border-2 border-dashed rounded-lg">
                <p className="text-muted-foreground mb-4">No story phases found.</p>
                <Button onClick={handleCreateSamplePhases}>Create sample story phases</Button>
            </div>
        )
    }

    return (
      <Table>
          <TableHeader>
              <TableRow>
                  <TableHead>ID</TableHead>
                  <TableHead>Phase Type</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>Choice Count</TableHead>
                  <TableHead>Allow More</TableHead>
                  <TableHead>Status</TableHead>
              </TableRow>
          </TableHeader>
          <TableBody>
              {phases.map((phase) => (
                  <TableRow key={phase.id}>
                      <TableCell className="font-mono">{phase.id}</TableCell>
                      <TableCell>{phase.phaseType}</TableCell>
                      <TableCell>{phase.name}</TableCell>
                      <TableCell>{phase.choiceCount}</TableCell>
                      <TableCell>{phase.allowMore ? 'Yes' : 'No'}</TableCell>
                      <TableCell>{phase.status}</TableCell>
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
          <CardTitle>Story Phases</CardTitle>
          <CardDescription>
            Configuration for each phase of the story creation process.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {renderContent()}
        </CardContent>
      </Card>
      
      <Card className="mt-8">
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Diagnostics</CardTitle>
          <Button variant="ghost" size="icon" onClick={handleCopyDiagnostics}>
            <Copy className="h-4 w-4" />
          </Button>
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
