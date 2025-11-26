'use client';

import { useAdminStatus } from '@/hooks/use-admin-status';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { LoaderCircle, Save, X } from 'lucide-react';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useEffect, useState } from 'react';
import { useFirestore } from '@/firebase';
import { collection, doc, onSnapshot, query, orderBy, updateDoc } from 'firebase/firestore';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import type { ChildProfile } from '@/lib/types';
import { Input } from '@/components/ui/input';

export default function AdminChildrenPage() {
  const { isAuthenticated, isAdmin, loading: authLoading, error: authError } = useAdminStatus();
  const firestore = useFirestore();
  const { toast } = useToast();

  const [children, setChildren] = useState<ChildProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editingRows, setEditingRows] = useState<Record<string, { ownerParentUid: string }>>({});

  useEffect(() => {
    if (!firestore || !isAdmin) {
      setLoading(false);
      return;
    }
    
    setLoading(true);
    const childrenRef = collection(firestore, 'children');
    const q = query(childrenRef, orderBy('createdAt', 'desc'));
    
    const unsubscribe = onSnapshot(q, 
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

  const handleEdit = (child: ChildProfile) => {
    setEditingRows(prev => ({
      ...prev,
      [child.id]: { ownerParentUid: child.ownerParentUid }
    }));
  };

  const handleCancel = (childId: string) => {
    setEditingRows(prev => {
      const newRows = { ...prev };
      delete newRows[childId];
      return newRows;
    });
  };

  const handleSave = async (childId: string) => {
    if (!firestore) return;

    const updatedData = editingRows[childId];
    if (!updatedData || !updatedData.ownerParentUid) {
      toast({ title: "Parent UID cannot be empty", variant: "destructive" });
      return;
    }

    const childRef = doc(firestore, 'children', childId);
    try {
      await updateDoc(childRef, { ownerParentUid: updatedData.ownerParentUid });
      toast({ title: 'Success', description: `Child ${childId} updated.` });
      handleCancel(childId); // Exit editing mode
    } catch (e: any) {
      toast({ title: 'Error updating child', description: e.message, variant: 'destructive' });
    }
  };

  const handleInputChange = (childId: string, field: 'ownerParentUid', value: string) => {
    setEditingRows(prev => ({
      ...prev,
      [childId]: { ...prev[childId], [field]: value }
    }));
  };

  const renderContent = () => {
    if (authLoading || loading) {
      return <div className="flex items-center gap-2"><LoaderCircle className="h-5 w-5 animate-spin" /><span>Loading all children...</span></div>;
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
                <p className="text-muted-foreground mb-4">No children found in the system.</p>
            </div>
        )
    }

    return (
      <Table>
          <TableHeader>
              <TableRow>
                  <TableHead>Child ID</TableHead>
                  <TableHead>Display Name</TableHead>
                  <TableHead>Owner Parent UID</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
              </TableRow>
          </TableHeader>
          <TableBody>
              {children.map((child) => {
                const isEditing = !!editingRows[child.id];
                return (
                  <TableRow key={child.id}>
                      <TableCell className="font-mono text-xs">{child.id}</TableCell>
                      <TableCell>{child.displayName}</TableCell>
                      <TableCell className="font-mono text-xs">
                        {isEditing ? (
                          <Input 
                            value={editingRows[child.id].ownerParentUid}
                            onChange={(e) => handleInputChange(child.id, 'ownerParentUid', e.target.value)}
                            className="h-8"
                          />
                        ) : (
                          child.ownerParentUid
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        {isEditing ? (
                          <div className="flex gap-2 justify-end">
                            <Button variant="outline" size="sm" onClick={() => handleSave(child.id)}><Save className="h-4 w-4 mr-2"/>Save</Button>
                            <Button variant="ghost" size="sm" onClick={() => handleCancel(child.id)}><X className="h-4 w-4 mr-2"/>Cancel</Button>
                          </div>
                        ) : (
                          <Button variant="outline" size="sm" onClick={() => handleEdit(child)}>Edit</Button>
                        )}
                      </TableCell>
                  </TableRow>
              )})}
          </TableBody>
      </Table>
    );
  };

  return (
    <div className="container mx-auto p-4 sm:p-6 md:p-8">
      <Card>
        <CardHeader>
          <CardTitle>Children Management (Admin)</CardTitle>
          <CardDescription>
            View and manage all child profiles in the system.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {renderContent()}
        </CardContent>
      </Card>
    </div>
  );
}
