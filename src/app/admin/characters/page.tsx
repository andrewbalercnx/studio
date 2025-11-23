'use client';

import { useAdminStatus } from '@/hooks/use-admin-status';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { LoaderCircle } from 'lucide-react';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useEffect, useState } from 'react';
import { useFirestore } from '@/firebase';
import { collection, doc, onSnapshot, writeBatch, serverTimestamp, query, orderBy } from 'firebase/firestore';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import type { Character } from '@/lib/types';

const sampleCharacters: Omit<Character, 'id' | 'createdAt' | 'updatedAt'>[] = [
    {
        ownerChildId: "sample-child-1",
        sessionId: "sample-session-1",
        role: "child",
        name: "Sample Hero",
        realPersonRef: {
            kind: "self",
            label: "You"
        },
        traits: {
            ageApprox: "about your age",
            size: "medium",
            bravery: "brave",
            energy: "playful",
            moodDefault: "curious"
        },
        visualNotes: {
            hair: "short hair",
            clothing: "bright jumper",
            specialItem: "small backpack"
        }
    },
    {
        ownerChildId: "sample-child-1",
        sessionId: "sample-session-1",
        role: "family",
        name: "Sample Grown-Up",
        realPersonRef: {
            kind: "family",
            label: "Grown-up helper"
        },
        traits: {
            size: "big",
            moodDefault: "kind"
        }
    },
    {
        ownerChildId: "sample-child-1",
        sessionId: "sample-session-1",
        role: "friend",
        name: "Sample Friend",
        realPersonRef: {
            kind: "friend",
            label: "Friend from school"
        },
        traits: {
            energy: "bouncy",
            moodDefault: "silly"
        }
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
            batch.set(docRef, { ...charData, createdAt: now, updatedAt: now });
        });
        
        await batch.commit();
        toast({ title: 'Success', description: 'Sample characters created.' });
    } catch (e: any) {
        console.error("Error creating sample characters:", e);
        toast({ title: 'Error', description: e.message, variant: 'destructive' });
    }
  };

  const getTraitsSummary = (character: Character) => {
      if (!character.traits) return '-';
      return Object.values(character.traits).filter(Boolean).join(', ');
  }


  const diagnostics = {
    page: 'admin-characters',
    auth: { isAuthenticated, email, isAdmin, loading: authLoading, error: authError },
    firestore: {
        collection: 'characters',
        count: characters.length,
        sampleIds: characters.slice(0, 3).map(c => c.id),
    },
    ...(error ? { firestoreError: error } : {})
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
                  <TableHead>Owner Child ID</TableHead>
                  <TableHead>Session ID</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>Traits Summary</TableHead>
              </TableRow>
          </TableHeader>
          <TableBody>
              {characters.map((char) => (
                  <TableRow key={char.id}>
                      <TableCell className="font-mono text-xs">{char.id}</TableCell>
                      <TableCell className="font-mono text-xs">{char.ownerChildId}</TableCell>
                      <TableCell className="font-mono text-xs">{char.sessionId || '-'}</TableCell>
                      <TableCell>{char.role}</TableCell>
                      <TableCell>{char.name}</TableCell>
                      <TableCell className="text-xs">{getTraitsSummary(char)}</TableCell>
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
      
      <Card className="mt-8">
        <CardHeader>
          <CardTitle>Diagnostics</CardTitle>
        </CardHeader>
        <CardContent>
          <pre className="bg-muted p-4 rounded-lg overflow-x-auto text-sm">
            <code>{JSON.stringify(diagnostics, null, 2)}</code>
          </pre>
        </CardContent>
      </Card>
    </div>
  );
}

    