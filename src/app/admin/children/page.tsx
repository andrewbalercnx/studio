
'use client';

import { useAdminStatus } from '@/hooks/use-admin-status';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Copy, LoaderCircle } from 'lucide-react';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useEffect, useState } from 'react';
import { useFirestore } from '@/firebase';
import { collection, doc, onSnapshot, setDoc, serverTimestamp } from 'firebase/firestore';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import type { ChildProfile } from '@/lib/types';

const sampleChild: ChildProfile = {
    id: "sample-child-1",
    displayName: "Sample Child",
    createdAt: new Date(), // This will be replaced by serverTimestamp
    estimatedLevel: 2,
    favouriteGenres: ["funny", "magical"],
    favouriteCharacterTypes: ["self", "pet"],
    preferredStoryLength: "short",
    helpPreference: "more_scaffolding"
};

export default function AdminChildrenPage() {
  const { isAuthenticated, isAdmin, email, loading: authLoading } = useAdminStatus();
  const firestore = useFirestore();
  const { toast } = useToast();

  const [children, setChildren] = useState<ChildProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!firestore || !isAdmin) {
      setLoading(false);
      return;
    }
    
    setLoading(true);
    const childrenRef = collection(firestore, 'children');
    const unsubscribe = onSnapshot(childrenRef, 
      (snapshot) => {
        const childrenList = snapshot.docs.map(d => ({ ...d.data(), id: d.id }) as ChildProfile);
        setChildren(childrenList);
        setLoading(false);
        setError(null);
      },
      (err) => {
        console.error("Error fetching children:", err);
        setError("Could not fetch children profiles.");
        setChildren([]);
        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, [firestore, isAdmin]);
  
  const handleCreateSampleChild = async () => {
    if (!firestore) return;
    try {
        const docRef = doc(firestore, "children", sampleChild.id);
        await setDoc(docRef, { ...sampleChild, createdAt: serverTimestamp() });
        toast({ title: 'Success', description: 'Sample child profile created.' });
    } catch (e: any) {
        console.error("Error creating sample child:", e);
        toast({ title: 'Error', description: e.message, variant: 'destructive' });
    }
  };


  const diagnostics = {
    page: 'admin-children',
    auth: {
      isAuthenticated,
      email,
      isAdmin,
      loading: authLoading,
      error: null, // useAdminStatus hook error
    },
    firestore: {
        collection: 'children',
        count: children.length,
        sampleIds: children.slice(0, 3).map(c => c.id),
    },
    ...(error ? { firestoreErrorChildren: error } : {})
  };

  const handleCopyDiagnostics = () => {
    const textToCopy = `Page: admin-children\n\nDiagnostics\n${JSON.stringify(diagnostics, null, 2)}`;
    navigator.clipboard.writeText(textToCopy);
    toast({ title: 'Copied to clipboard!' });
  };

  const renderContent = () => {
    if (authLoading || loading) {
      return <div className="flex items-center gap-2"><LoaderCircle className="h-5 w-5 animate-spin" /><span>Loading children...</span></div>;
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
    if (children.length === 0) {
        return (
            <div className="text-center py-8 border-2 border-dashed rounded-lg">
                <p className="text-muted-foreground mb-4">No children found.</p>
                <Button onClick={handleCreateSampleChild}>Create sample child</Button>
            </div>
        )
    }

    return (
      <Table>
          <TableHeader>
              <TableRow>
                  <TableHead>ID</TableHead>
                  <TableHead>Display Name</TableHead>
                  <TableHead>Est. Level</TableHead>
                  <TableHead>Story Length</TableHead>
              </TableRow>
          </TableHeader>
          <TableBody>
              {children.map((child) => (
                  <TableRow key={child.id}>
                      <TableCell className="font-mono">{child.id}</TableCell>
                      <TableCell>{child.displayName}</TableCell>
                      <TableCell>{child.estimatedLevel}</TableCell>
                      <TableCell>{child.preferredStoryLength}</TableCell>
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
          <CardTitle>Children</CardTitle>
          <CardDescription>
            List of child profiles.
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
