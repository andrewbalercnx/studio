
'use client';

import { useAdminStatus } from '@/hooks/use-admin-status';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { LoaderCircle } from 'lucide-react';
import { DiagnosticsPanel } from '@/components/diagnostics-panel';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useEffect, useState } from 'react';
import { useFirestore } from '@/firebase';
import { collection, doc, onSnapshot, writeBatch, serverTimestamp, query, orderBy } from 'firebase/firestore';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import type { Character } from '@/lib/types';
import { logAIFlow } from '@/lib/ai-flow-logger';

const sampleCharacters: Omit<Character, 'id' | 'createdAt' | 'updatedAt' | 'ownerParentUid'>[] = [
    {
        type: "Family",
        displayName: "Sample Hero",
        likes: ["brave", "curious", "playful"],
        dislikes: [],
        description: "A brave and curious child"
    },
    {
        type: "Family",
        displayName: "Sample Grown-Up",
        likes: ["kind", "big"],
        dislikes: [],
        description: "A kind grown-up helper"
    },
    {
        type: "Friend",
        displayName: "Sample Friend",
        likes: ["bouncy", "silly"],
        dislikes: [],
        description: "A bouncy, silly friend from school"
    }
];

const sampleCharacterIds = ["sample-char-main-child", "sample-char-family", "sample-char-friend"];


export default function AdminCharactersPage() {
  const { isAuthenticated, isAdmin, email, loading: authLoading, error: authError } = useAdminStatus();
  const firestore = useFirestore();
  const { toast } = useToast();

  const [characters, setCharacters] = useState<Character[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);



  useEffect(() => {
    if (!firestore || !isAdmin) {
      setLoading(false);
      return;
    }
    
    setLoading(true);
    const charactersRef = collection(firestore, 'characters');
    const q = query(charactersRef, orderBy('createdAt', 'desc'));
    
    const unsubscribe = onSnapshot(q, 
      (snapshot) => {
        const characterList = snapshot.docs.map(d => ({ ...d.data(), id: d.id }) as Character);
        setCharacters(characterList);
        setLoading(false);
        setError(null);
      },
      (err) => {
        console.error("Error fetching characters:", err);
        setError("Could not fetch characters.");
        setCharacters([]);
        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, [firestore, isAdmin]);
  
  const handleCreateSampleCharacters = async () => {
    if (!firestore) return;
    try {
        const batch = writeBatch(firestore);
        const now = serverTimestamp();
        
        sampleCharacters.forEach((charData, index) => {
            const docId = sampleCharacterIds[index];
            const docRef = doc(firestore, "characters", docId);
            batch.set(docRef, { ...charData, ownerParentUid: 'sample-parent-1', createdAt: now, updatedAt: now });
        });
        
        await batch.commit();
        toast({ title: 'Success', description: 'Sample characters created.' });
    } catch (e: any) {
        console.error("Error creating sample characters:", e);
        toast({ title: 'Error', description: e.message, variant: 'destructive' });
    }
  };

  const getLikesSummary = (character: Character) => {
    if (!character.likes || !Array.isArray(character.likes) || character.likes.length === 0) {
      return '-';
    }
    return character.likes.join(', ');
  }


  const diagnostics = {
    page: 'admin-characters',
    auth: { isAuthenticated, email, isAdmin, loading: authLoading, error: authError },
    firestore: {
        collection: 'characters',
        count: characters.length,
        sampleIds: characters.slice(0, 3).map(c => c.id),
    },
    ...(error ? { firestoreError: error } : {}),
  };


  const renderContent = () => {
    if (authLoading || loading) {
      return <div className="flex items-center gap-2"><LoaderCircle className="h-5 w-5 animate-spin" /><span>Loading characters...</span></div>;
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
    if (characters.length === 0) {
        return (
            <div className="text-center py-8 border-2 border-dashed rounded-lg">
                <p className="text-muted-foreground mb-4">No characters found.</p>
                <Button onClick={handleCreateSampleCharacters}>Create sample characters</Button>
            </div>
        )
    }

    return (
      <Table>
          <TableHeader>
              <TableRow>
                  <TableHead>ID</TableHead>
                  <TableHead>Owner Parent UID</TableHead>
                  <TableHead>Child ID / Scope</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>Likes Summary</TableHead>
              </TableRow>
          </TableHeader>
          <TableBody>
              {characters.map((char) => (
                  <TableRow key={char.id}>
                      <TableCell className="font-mono text-xs">{char.id}</TableCell>
                      <TableCell className="font-mono text-xs">{char.ownerParentUid}</TableCell>
                      <TableCell className="font-mono text-xs">{char.childId || 'Family-wide'}</TableCell>
                      <TableCell>{char.type}</TableCell>
                      <TableCell>{char.displayName}</TableCell>
                      <TableCell className="text-xs">{getLikesSummary(char)}</TableCell>
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
          <CardTitle>Characters</CardTitle>
          <CardDescription>
            List of story characters for children and their sessions.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {renderContent()}
        </CardContent>
      </Card>
      
      <DiagnosticsPanel pageName="admin-characters" data={diagnostics} className="mt-8" />
    </div>
  );
}
