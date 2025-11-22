'use client';

import { useAdminStatus } from '@/hooks/use-admin-status';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { LoaderCircle } from 'lucide-react';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useEffect, useState } from 'react';
import { useFirestore } from '@/firebase';
import { collection, doc, onSnapshot, setDoc, serverTimestamp } from 'firebase/firestore';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import type { StorySession } from '@/lib/types';

const sampleSession: Omit<StorySession, 'createdAt' | 'updatedAt' | 'messages' | 'characters' | 'beats'> = {
    id: "sample-session-1",
    childId: "sample-child-1",
    status: "in_progress",
    currentPhase: "warmup",
    currentStepIndex: 0,
    storyTitle: "Sample Story",
    storyVibe: "funny",
};

export default function AdminSessionsPage() {
  const { isAuthenticated, isAdmin, email, loading: authLoading } = useAdminStatus();
  const firestore = useFirestore();
  const { toast } = useToast();

  const [sessions, setSessions] = useState<StorySession[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!firestore || !isAdmin) {
      setLoading(false);
      return;
    }
    
    setLoading(true);
    const sessionsRef = collection(firestore, 'storySessions');
    const unsubscribe = onSnapshot(sessionsRef, 
      (snapshot) => {
        const sessionList = snapshot.docs.map(d => ({ ...d.data(), id: d.id }) as StorySession);
        setSessions(sessionList);
        setLoading(false);
        setError(null);
      },
      (err) => {
        console.error("Error fetching story sessions:", err);
        setError("Could not fetch story sessions.");
        setSessions([]);
        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, [firestore, isAdmin]);
  
  const handleCreateSampleSession = async () => {
    if (!firestore) return;
    try {
        const docRef = doc(firestore, "storySessions", sampleSession.id);
        const now = serverTimestamp();
        await setDoc(docRef, { ...sampleSession, characters: [], beats: [], createdAt: now, updatedAt: now });
        toast({ title: 'Success', description: 'Sample story session created.' });
    } catch (e: any) {
        console.error("Error creating sample session:", e);
        toast({ title: 'Error', description: e.message, variant: 'destructive' });
    }
  };


  const diagnostics = {
    page: 'admin-sessions',
    auth: {
      isAuthenticated,
      email,
      isAdmin,
      loading: authLoading,
      error: null,
    },
    firestore: {
        collection: 'storySessions',
        count: sessions.length,
        sampleIds: sessions.slice(0, 3).map(s => s.id),
    },
    ...(error ? { firestoreErrorSessions: error } : {})
  };

  const renderContent = () => {
    if (authLoading || loading) {
      return <div className="flex items-center gap-2"><LoaderCircle className="h-5 w-5 animate-spin" /><span>Loading story sessions...</span></div>;
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
    if (sessions.length === 0) {
        return (
            <div className="text-center py-8 border-2 border-dashed rounded-lg">
                <p className="text-muted-foreground mb-4">No story sessions found.</p>
                <Button onClick={handleCreateSampleSession}>Create sample story session</Button>
            </div>
        )
    }

    return (
      <Table>
          <TableHeader>
              <TableRow>
                  <TableHead>ID</TableHead>
                  <TableHead>Child ID</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Current Phase</TableHead>
                  <TableHead>Title</TableHead>
              </TableRow>
          </TableHeader>
          <TableBody>
              {sessions.map((session) => (
                  <TableRow key={session.id}>
                      <TableCell className="font-mono">{session.id}</TableCell>
                      <TableCell className="font-mono">{session.childId}</TableCell>
                      <TableCell>{session.status}</TableCell>
                      <TableCell>{session.currentPhase}</TableCell>
                      <TableCell>{session.storyTitle}</TableCell>
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
          <CardTitle>Story Sessions</CardTitle>
          <CardDescription>
            List of story sessions.
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
