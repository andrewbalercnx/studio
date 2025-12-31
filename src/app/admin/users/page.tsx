
'use client';

import { useAdminStatus } from '@/hooks/use-admin-status';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { LoaderCircle, Shield, ShieldOff, BrainCircuit, Pencil, User as UserIcon, RefreshCw, Target, Bell, BellOff } from 'lucide-react';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useFirestore, useAuth } from '@/firebase';
import { collection, doc, onSnapshot, updateDoc, deleteField } from 'firebase/firestore';
import { useEffect, useState, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import type { UserProfile } from '@/lib/types';
import { Badge } from '@/components/ui/badge';
import type { TokenUsageByParent, TokenUsageResponse } from '@/app/api/admin/token-usage/route';

function formatNumber(num: number): string {
  if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
  if (num >= 1000) return (num / 1000).toFixed(1) + 'K';
  return num.toString();
}

export default function AdminUsersPage() {
  const { isAuthenticated, isAdmin, loading, error } = useAdminStatus();
  const firestore = useFirestore();
  const auth = useAuth();
  const { toast } = useToast();
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [usersLoading, setUsersLoading] = useState(true);
  const [tokenUsage, setTokenUsage] = useState<TokenUsageByParent[]>([]);
  const [tokenTotals, setTokenTotals] = useState<{
    day: { inputTokens: number; outputTokens: number; totalTokens: number; thoughtsTokens: number; flowCount: number };
    month: { inputTokens: number; outputTokens: number; totalTokens: number; thoughtsTokens: number; flowCount: number };
  } | null>(null);
  const [tokenUsageLoading, setTokenUsageLoading] = useState(false);

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

  const fetchTokenUsage = useCallback(async () => {
    setTokenUsageLoading(true);
    try {
      const user = auth?.currentUser;
      if (!user) {
        toast({ title: 'Error', description: 'Not authenticated', variant: 'destructive' });
        setTokenUsageLoading(false);
        return;
      }
      const idToken = await user.getIdToken();
      const response = await fetch('/api/admin/token-usage', {
        headers: { 'Authorization': `Bearer ${idToken}` }
      });
      const data: TokenUsageResponse = await response.json();
      if (data.ok) {
        setTokenUsage(data.data);
        setTokenTotals(data.totals);
      } else {
        toast({ title: 'Error fetching token usage', description: data.error, variant: 'destructive' });
      }
    } catch (err: any) {
      toast({ title: 'Error fetching token usage', description: err.message, variant: 'destructive' });
    } finally {
      setTokenUsageLoading(false);
    }
  }, [auth, toast]);

  useEffect(() => {
    if (isAdmin) {
      fetchTokenUsage();
    }
  }, [isAdmin, fetchTokenUsage]);

  const toggleRole = async (user: UserProfile, role: 'isAdmin' | 'isWriter' | 'isParent') => {
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


  const revokePin = async (user: UserProfile) => {
    if (!firestore) return;
    const userRef = doc(firestore, 'users', user.id);
    try {
      await updateDoc(userRef, {
        pinHash: deleteField(),
        pinSalt: deleteField(),
        pinUpdatedAt: deleteField(),
      });
      toast({ title: 'PIN revoked', description: `${user.email} will be asked to create a new PIN on next login.` });
    } catch (e: any) {
      console.error('Error revoking PIN:', e);
      toast({ title: 'Error revoking PIN', description: e.message, variant: 'destructive' });
    }
  };

  const toggleWizardTargets = async (user: UserProfile) => {
    if (!firestore) return;
    const userRef = doc(firestore, 'users', user.id);
    const newValue = !user.canShowWizardTargets;
    try {
      await updateDoc(userRef, { canShowWizardTargets: newValue });
      toast({
        title: 'Success',
        description: `${user.email} can ${newValue ? 'now' : 'no longer'} toggle wizard targets.`
      });
    } catch (e: any) {
      console.error('Error updating wizard targets permission:', e);
      toast({ title: 'Error updating permission', description: e.message, variant: 'destructive' });
    }
  };

  const toggleNotifiedUser = async (user: UserProfile) => {
    if (!firestore) return;
    const userRef = doc(firestore, 'users', user.id);
    const newValue = !user.notifiedUser;
    try {
      await updateDoc(userRef, { notifiedUser: newValue });
      toast({
        title: 'Success',
        description: `${user.email} will ${newValue ? 'now receive' : 'no longer receive'} print order notifications.`
      });
    } catch (e: any) {
      console.error('Error updating notification setting:', e);
      toast({ title: 'Error updating notification setting', description: e.message, variant: 'destructive' });
    }
  };

  const renderUsersTable = () => (
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
              <Button variant="outline" size="sm" onClick={() => toggleRole(user, 'isParent')}>
                <UserIcon />
                {user.roles?.isParent ? 'Revoke Parent' : 'Make Parent'}
              </Button>
              <Button variant="outline" size="sm" onClick={() => toggleRole(user, 'isAdmin')}>
                {user.roles?.isAdmin ? <ShieldOff /> : <Shield />}
                {user.roles?.isAdmin ? 'Demote Admin' : 'Promote Admin'}
              </Button>
              <Button
                variant="destructive"
                size="sm"
                disabled={!user.pinHash}
                onClick={() => revokePin(user)}
              >
                Revoke PIN
              </Button>
              <Button
                variant={user.canShowWizardTargets ? 'default' : 'outline'}
                size="sm"
                onClick={() => toggleWizardTargets(user)}
              >
                <Target className="mr-1 h-4 w-4" />
                {user.canShowWizardTargets ? 'Wizard Targets On' : 'Wizard Targets Off'}
              </Button>
              <Button
                variant={user.notifiedUser ? 'default' : 'outline'}
                size="sm"
                onClick={() => toggleNotifiedUser(user)}
                title={user.notifiedUser ? 'Receiving print order notifications' : 'Not receiving notifications'}
              >
                {user.notifiedUser ? <Bell className="mr-1 h-4 w-4" /> : <BellOff className="mr-1 h-4 w-4" />}
                {user.notifiedUser ? 'Notify On' : 'Notify Off'}
              </Button>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );

  const renderTokenUsageTable = () => (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <p className="text-sm text-muted-foreground">
          Token usage aggregated by parent user (last 24 hours and 30 days)
        </p>
        <Button variant="outline" size="sm" onClick={fetchTokenUsage} disabled={tokenUsageLoading}>
          <RefreshCw className={`mr-2 h-4 w-4 ${tokenUsageLoading ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
      </div>

      {tokenTotals && (
        <div className="grid grid-cols-2 gap-4 p-4 bg-muted/50 rounded-lg">
          <div>
            <h4 className="font-semibold text-sm mb-2">Last 24 Hours (All Users)</h4>
            <div className="grid grid-cols-2 gap-2 text-xs">
              <p><strong className="text-muted-foreground">Input:</strong> {formatNumber(tokenTotals.day.inputTokens)}</p>
              <p><strong className="text-muted-foreground">Output:</strong> {formatNumber(tokenTotals.day.outputTokens)}</p>
              <p><strong className="text-muted-foreground">Total:</strong> {formatNumber(tokenTotals.day.totalTokens)}</p>
              <p><strong className="text-muted-foreground">Thoughts:</strong> {formatNumber(tokenTotals.day.thoughtsTokens)}</p>
              <p><strong className="text-muted-foreground">Flows:</strong> {tokenTotals.day.flowCount}</p>
            </div>
          </div>
          <div>
            <h4 className="font-semibold text-sm mb-2">Last 30 Days (All Users)</h4>
            <div className="grid grid-cols-2 gap-2 text-xs">
              <p><strong className="text-muted-foreground">Input:</strong> {formatNumber(tokenTotals.month.inputTokens)}</p>
              <p><strong className="text-muted-foreground">Output:</strong> {formatNumber(tokenTotals.month.outputTokens)}</p>
              <p><strong className="text-muted-foreground">Total:</strong> {formatNumber(tokenTotals.month.totalTokens)}</p>
              <p><strong className="text-muted-foreground">Thoughts:</strong> {formatNumber(tokenTotals.month.thoughtsTokens)}</p>
              <p><strong className="text-muted-foreground">Flows:</strong> {tokenTotals.month.flowCount}</p>
            </div>
          </div>
        </div>
      )}

      {tokenUsageLoading ? (
        <LoaderCircle className="mx-auto h-8 w-8 animate-spin" />
      ) : tokenUsage.length === 0 ? (
        <p className="text-center text-muted-foreground py-8">No token usage data found.</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>User</TableHead>
              <TableHead className="text-right">Day Input</TableHead>
              <TableHead className="text-right">Day Output</TableHead>
              <TableHead className="text-right">Day Total</TableHead>
              <TableHead className="text-right">Day Flows</TableHead>
              <TableHead className="text-right">Month Input</TableHead>
              <TableHead className="text-right">Month Output</TableHead>
              <TableHead className="text-right">Month Total</TableHead>
              <TableHead className="text-right">Month Flows</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {tokenUsage.map((usage) => (
              <TableRow key={usage.parentId}>
                <TableCell className="font-mono text-xs">
                  {usage.email || usage.parentId.slice(0, 12) + '...'}
                </TableCell>
                <TableCell className="text-right text-xs">{formatNumber(usage.day.inputTokens)}</TableCell>
                <TableCell className="text-right text-xs">{formatNumber(usage.day.outputTokens)}</TableCell>
                <TableCell className="text-right text-xs font-semibold">{formatNumber(usage.day.totalTokens)}</TableCell>
                <TableCell className="text-right text-xs">{usage.day.flowCount}</TableCell>
                <TableCell className="text-right text-xs">{formatNumber(usage.month.inputTokens)}</TableCell>
                <TableCell className="text-right text-xs">{formatNumber(usage.month.outputTokens)}</TableCell>
                <TableCell className="text-right text-xs font-semibold">{formatNumber(usage.month.totalTokens)}</TableCell>
                <TableCell className="text-right text-xs">{usage.month.flowCount}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );

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
      <Tabs defaultValue="users" className="w-full">
        <TabsList className="mb-4">
          <TabsTrigger value="users">Users</TabsTrigger>
          <TabsTrigger value="token-usage">
            <BrainCircuit className="mr-2 h-4 w-4" />
            Token Usage
          </TabsTrigger>
        </TabsList>
        <TabsContent value="users">
          {renderUsersTable()}
        </TabsContent>
        <TabsContent value="token-usage">
          {renderTokenUsageTable()}
        </TabsContent>
      </Tabs>
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
