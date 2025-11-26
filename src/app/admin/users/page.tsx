
'use client';

import { useAdminStatus } from '@/hooks/use-admin-status';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { LoaderCircle, Shield, ShieldOff, BrainCircuit, Pencil } from 'lucide-react';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useFirestore } from '@/firebase';
import { collection, doc, onSnapshot, updateDoc } from 'firebase/firestore';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import type { UserProfile } from '@/lib/types';
import { Badge } from '@/components/ui/badge';

export default function AdminUsersPage() {
  const { isAuthenticated, isAdmin, loading, error } = useAdminStatus();
  const firestore = useFirestore();
  const { toast } = useToast();
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [usersLoading, setUsersLoading] = useState(true);

  useEffect(() => {
    if (!firestore || !isAdmin) {
        setUsersLoading(false);
        return;
    };

    const usersRef = collection(firestore, 'users');
    const unsubscribe = onSnapshot(usersRef, (snapshot) => {
      const userList = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as UserProfile));
      setUsers(userList);
      setUsersLoading(false);
    }, (err) => {
        console.error("Error fetching users:", err);
        toast({ title: "Error fetching users", description: err.message, variant: "destructive" });
        setUsersLoading(false);
    });

    return () => unsubscribe();
  }, [firestore, isAdmin, toast]);


  const toggleRole = async (user: UserProfile, role: 'isAdmin' | 'isWriter') => {
    if (!firestore) return;
    const userRef = doc(firestore, 'users', user.id);
    const newRoleState = !user.roles?.[role];
    try {
        await updateDoc(userRef, { [`roles.${role}`]: newRoleState });
        toast({
            title: "Success",
            description: `${user.email}'s ${role} status set to ${newRoleState}.`
        });
    } catch (e: any) {
        console.error("Error updating user role:", e);
        toast({ title: "Error updating role", description: e.message, variant: "destructive" });
    }
  };


  const renderContent = () => {
    if (loading || usersLoading) {
      return <LoaderCircle className="mx-auto h-8 w-8 animate-spin" />;
    }
    if (error) {
      return <p className="text-destructive">Error: {error}</p>;
    }
    if (!isAuthenticated) {
      return <p>You must be signed in to access admin pages.</p>;
    }
    if (!isAdmin) {
      return <p>You are signed in but do not have admin rights.</p>;
    }
    return (
        <Table>
            <TableHeader>
                <TableRow>
                    <TableHead>Email</TableHead>
                    <TableHead>Roles</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                </TableRow>
            </TableHeader>
            <TableBody>
                {users.map((user) => (
                    <TableRow key={user.id}>
                        <TableCell className="font-mono">{user.email}</TableCell>
                        <TableCell className="flex gap-1">
                            {user.roles?.isAdmin && <Badge><Shield className="mr-1"/>Admin</Badge>}
                            {user.roles?.isWriter && <Badge variant="secondary"><Pencil className="mr-1"/>Writer</Badge>}
                             {user.roles?.isParent && <Badge variant="outline">Parent</Badge>}
                        </TableCell>
                        <TableCell className="text-right space-x-2">
                             <Button variant="outline" size="sm" onClick={() => toggleRole(user, 'isWriter')}>
                                {user.roles?.isWriter ? <Pencil /> : <Pencil />}
                                {user.roles?.isWriter ? 'Revoke Writer' : 'Make Writer'}
                            </Button>
                            <Button variant="outline" size="sm" onClick={() => toggleRole(user, 'isAdmin')}>
                                {user.roles?.isAdmin ? <ShieldOff /> : <Shield />}
                                {user.roles?.isAdmin ? 'Demote Admin' : 'Promote Admin'}
                            </Button>
                        </TableCell>
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
          <CardTitle>User Management</CardTitle>
          <CardDescription>
            Promote or demote users to administrators and writers. Changes may require a page refresh to update custom claims.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {renderContent()}
        </CardContent>
      </Card>
    </div>
  );
}
