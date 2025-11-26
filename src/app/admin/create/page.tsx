
'use client';

import { useAdminStatus } from '@/hooks/use-admin-status';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { LoaderCircle } from 'lucide-react';
import { useFirestore } from '@/firebase';
import { doc, setDoc, serverTimestamp } from 'firebase/firestore';
import { useToast } from '@/hooks/use-toast';
import { useUser } from '@/firebase/auth/use-user';

export default function AdminCreateDataPage() {
  const { isAuthenticated, isAdmin, loading: authLoading } = useAdminStatus();
  const { user } = useUser();
  const firestore = useFirestore();
  const { toast } = useToast();

  const handleCreateChild = async () => {
    if (!firestore || !user) {
      toast({ title: 'Error', description: 'You must be logged in.', variant: 'destructive' });
      return;
    }
    const childId = `child_${user.uid.slice(0, 8)}_${Date.now().toString().slice(-4)}`;
    const childData = {
      id: childId,
      ownerParentUid: user.uid,
      displayName: 'Sample Child',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    };
    try {
      await setDoc(doc(firestore, 'children', childId), childData);
      toast({ title: 'Success', description: `Child profile created: ${childId}` });
    } catch (e: any) {
      toast({ title: 'Error', description: e.message, variant: 'destructive' });
    }
  };
  
    const handleCreateSession = async () => {
    if (!firestore || !user) {
      toast({ title: 'Error', description: 'You must be logged in.', variant: 'destructive' });
      return;
    }
    const sessionId = `session_${user.uid.slice(0, 8)}_${Date.now().toString().slice(-4)}`;
    const sessionData = {
        id: sessionId,
        childId: `child_${user.uid.slice(0,8)}`, // assumes a child exists
        parentUid: user.uid,
        status: 'in_progress',
        currentPhase: 'warmup',
        currentStepIndex: 0,
        storyTypeId: "animal_adventure_v1",
        storyPhaseId: "warmup_phase_v1",
        arcStepIndex: 0,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
    };
     try {
      await setDoc(doc(firestore, 'storySessions', sessionId), sessionData);
      toast({ title: 'Success', description: `Story session created: ${sessionId}` });
    } catch (e: any) {
      toast({ title: 'Error', description: e.message, variant: 'destructive' });
    }
  }

  const renderContent = () => {
    if (authLoading) {
      return <LoaderCircle className="mx-auto h-8 w-8 animate-spin" />;
    }
    if (!isAuthenticated) {
      return <p>You must be signed in to access admin pages.</p>;
    }
    if (!isAdmin) {
      return <p>You are signed in but do not have admin rights.</p>;
    }
    return (
      <div className="flex flex-wrap gap-4">
        <Button onClick={handleCreateChild}>Create Sample Child</Button>
        <Button onClick={handleCreateSession}>Create Sample Session</Button>
      </div>
    );
  };

  return (
    <div className="container mx-auto p-4 sm:p-6 md:p-8">
      <Card>
        <CardHeader>
          <CardTitle>Create Sample Data</CardTitle>
          <CardDescription>
            Quickly create sample documents for development and testing.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {renderContent()}
        </CardContent>
      </Card>
    </div>
  );
}
