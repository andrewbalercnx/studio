
'use client';

import React, { useState, useMemo } from 'react';
import { useAuth, useFirestore } from '@/firebase';
import { useUser } from '@/firebase/auth/use-user';
import {
  doc,
  getDoc,
  setDoc,
  addDoc,
  deleteDoc,
  updateDoc,
  collection,
  getDocs,
  query,
  where,
  writeBatch,
} from 'firebase/firestore';
import { signOut } from 'firebase/auth';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { LoaderCircle, Copy, Trash2, Shield, User as UserIcon, Pen } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { Progress } from '@/components/ui/progress';

type TestRole = 'unauthenticated' | 'admin' | 'writer' | 'parent' | 'child';
type TestOperation = 'get' | 'list' | 'create' | 'update' | 'delete';
type TestExpectation = 'allow' | 'deny';

type TestCase = {
  id: string;
  description: string;
  role: TestRole;
  operation: TestOperation;
  path: string | ((ids: Record<string, string>) => string);
  data?: Record<string, any> | ((ids: Record<string, string>) => Record<string, any>);
  queryConstraints?: any[];
  expected: TestExpectation;
};

type TestResult = {
  case: TestCase;
  status: 'pending' | 'running' | 'pass' | 'fail';
  error?: string;
};

// --- Test Definitions ---
const testCases: TestCase[] = [
  // User Profile
  { id: 'users-read-self', description: 'Parent can read their own profile', role: 'parent', operation: 'get', path: (ids) => `users/${ids.parentUid}`, expected: 'allow' },
  { id: 'users-read-other', description: 'Parent cannot read other user profiles', role: 'parent', operation: 'get', path: (ids) => `users/${ids.otherParentUid}`, expected: 'deny' },
  { id: 'users-write-self', description: 'Parent can write to their own profile', role: 'parent', operation: 'update', path: (ids) => `users/${ids.parentUid}`, data: { displayName: 'Test Parent' }, expected: 'allow' },
  { id: 'users-write-other', description: 'Parent cannot write to other user profiles', role: 'parent', operation: 'update', path: (ids) => `users/${ids.otherParentUid}`, data: { displayName: 'Malicious' }, expected: 'deny' },
  { id: 'users-list-all', description: 'Parent cannot list all users', role: 'parent', operation: 'list', path: 'users', expected: 'deny' },
  { id: 'users-admin-list', description: 'Admin can list users', role: 'admin', operation: 'list', path: 'users', expected: 'allow' },

  // Children
  { id: 'children-create', description: 'Parent can create a child', role: 'parent', operation: 'create', path: (ids) => `children`, data: (ids) => ({ ownerParentUid: ids.parentUid, displayName: 'Test Child' }), expected: 'allow' },
  { id: 'children-read-own', description: 'Parent can read their own child', role: 'parent', operation: 'get', path: (ids) => `children/${ids.childId}`, expected: 'allow' },
  { id: 'children-read-other', description: 'Parent cannot read another parent\'s child', role: 'parent', operation: 'get', path: (ids) => `children/${ids.otherChildId}`, expected: 'deny' },
  { id: 'children-list-own', description: 'Parent can list their own children', role: 'parent', operation: 'list', path: 'children', queryConstraints: (ids) => [where('ownerParentUid', '==', ids.parentUid)], expected: 'allow' },
  { id: 'children-list-other', description: 'Parent cannot list other children', role: 'parent', operation: 'list', path: 'children', queryConstraints: (ids) => [where('ownerParentUid', '==', ids.otherParentUid)], expected: 'deny' },
  { id: 'children-child-read', description: 'Child can read their own profile', role: 'child', operation: 'get', path: (ids) => `children/${ids.childId}`, expected: 'allow' },
  { id: 'children-child-read-sibling', description: 'Child cannot read a sibling\'s profile', role: 'child', operation: 'get', path: (ids) => `children/${ids.siblingId}`, expected: 'deny' },
  { id: 'children-help-read', description: 'Anyone can read a help child doc', role: 'unauthenticated', operation: 'get', path: (ids) => `children/help-child`, expected: 'allow' },

  // Add more tests for other collections...
];

export default function FirestoreTestPage() {
  const { user, idTokenResult } = useUser();
  const auth = useAuth();
  const firestore = useFirestore();
  const { toast } = useToast();

  const [results, setResults] = useState<TestResult[]>([]);
  const [isRunning, setIsRunning] = useState(false);
  const [isCleaning, setIsCleaning] = useState(false);
  const [progress, setProgress] = useState(0);

  const roles = useMemo(() => {
    return {
      isAdmin: !!idTokenResult?.claims.isAdmin,
      isWriter: !!idTokenResult?.claims.isWriter,
      isParent: !!idTokenResult?.claims.isParent,
    };
  }, [idTokenResult]);

  const executeTest = async (testCase: TestCase, ids: Record<string, string>): Promise<{ permitted: boolean; error: string | null }> => {
    if (!firestore) {
      return { permitted: false, error: 'Firestore not initialized' };
    }

    try {
      let path = typeof testCase.path === 'function' ? testCase.path(ids) : testCase.path;
      let data = typeof testCase.data === 'function' ? testCase.data(ids) : testCase.data;
      if (data) {
        data = { ...data, rulesTest: true };
      }

      switch (testCase.operation) {
        case 'get':
          await getDoc(doc(firestore, path));
          break;
        case 'list':
          const constraints = testCase.queryConstraints ? testCase.queryConstraints(ids) : [];
          await getDocs(query(collection(firestore, path), ...constraints));
          break;
        case 'create':
          await addDoc(collection(firestore, path), data);
          break;
        case 'update':
          await updateDoc(doc(firestore, path), data);
          break;
        case 'delete':
          await deleteDoc(doc(firestore, path));
          break;
      }
      return { permitted: true, error: null };
    } catch (e: any) {
      // Catch ANY error and return it. The caller will decide if it's a pass or fail.
      return { permitted: false, error: e.message || 'An unknown error occurred' };
    }
  };

  const runTests = async () => {
    if (!firestore) return;
    setIsRunning(true);
    setResults([]);
    setProgress(0);

    const testIds: Record<string, string> = {
        parentUid: user?.uid ?? 'test-parent',
        otherParentUid: 'other-parent-uid',
    };

    // Setup initial data
    const batch = writeBatch(firestore);
    const childRef = doc(collection(firestore, 'children'));
    testIds.childId = childRef.id;
    batch.set(childRef, { rulesTest: true, ownerParentUid: testIds.parentUid, displayName: 'Owned Child' });
    
    const otherChildRef = doc(collection(firestore, 'children'));
    testIds.otherChildId = otherChildRef.id;
    batch.set(otherChildRef, { rulesTest: true, ownerParentUid: testIds.otherParentUid, displayName: 'Other Child' });
    
    const siblingRef = doc(collection(firestore, 'children'));
    testIds.siblingId = siblingRef.id;
    batch.set(siblingRef, { rulesTest: true, ownerParentUid: testIds.parentUid, displayName: 'Sibling' });
    
    const helpChildRef = doc(firestore, 'children', 'help-child');
    batch.set(helpChildRef, { rulesTest: true, ownerParentUid: 'help-owner' });

    // Seed a user doc for the "other" parent to test reads against
    const otherUserRef = doc(firestore, 'users', testIds.otherParentUid);
    batch.set(otherUserRef, { rulesTest: true, email: 'other@test.com' });
    // Seed the current user's doc for self-write tests
    if(user) {
      const currentUserRef = doc(firestore, 'users', testIds.parentUid);
      batch.set(currentUserRef, { rulesTest: true, email: user.email || 'parent@test.com' }, { merge: true });
    }

    await batch.commit();

    const allTestResults: TestResult[] = [];

    for (let i = 0; i < testCases.length; i++) {
        const testCase = testCases[i];
        const result: TestResult = { case: testCase, status: 'running', error: undefined };
        allTestResults.push(result);
        setResults([...allTestResults]);
        setProgress(((i + 1) / testCases.length) * 100);

        try {
            if (testCase.role !== 'parent' && testCase.role !== 'unauthenticated') {
                result.status = 'pending';
                result.error = `Skipping: Manual login required for role '${testCase.role}'`;
                setResults([...allTestResults]);
                continue;
            }
            
            if (testCase.role === 'unauthenticated' && auth?.currentUser) {
                await signOut(auth);
            }

            const { permitted, error } = await executeTest(testCase, testIds);
            const expectedToPass = testCase.expected === 'allow';

            if (expectedToPass && permitted) {
                result.status = 'pass';
            } else if (!expectedToPass && !permitted) {
                result.status = 'pass';
            } else {
                result.status = 'fail';
                result.error = error || `Expected '${testCase.expected}' but operation was ${permitted ? 'allowed' : 'denied'}.`;
            }
        } catch (e: any) {
            result.status = 'fail';
            result.error = `[RUNNER_ERROR] ${e.message}`;
        }
        setResults([...allTestResults]);
    }

    setIsRunning(false);
  };
  
  const cleanupData = async () => {
    if (!firestore) return;
    setIsCleaning(true);
    const batch = writeBatch(firestore);
    const collections = ['users', 'children', 'storySessions', 'characters', 'stories'];
    let count = 0;
    
    for (const coll of collections) {
        const q = query(collection(firestore, coll), where('rulesTest', '==', true));
        const snapshot = await getDocs(q);
        snapshot.forEach(doc => {
            batch.delete(doc.ref);
            count++;
        });
    }
    
    try {
        await batch.commit();
        toast({ title: 'Cleanup Complete', description: `Deleted ${count} test documents.` });
    } catch (e: any) {
        toast({ title: 'Cleanup Failed', description: e.message, variant: 'destructive' });
    }
    setIsCleaning(false);
  };
  
  const getStatusVariant = (status: TestResult['status']) => {
    switch (status) {
        case 'pass': return 'default';
        case 'fail': return 'destructive';
        case 'pending': return 'secondary';
        case 'running': return 'outline';
        default: return 'outline';
    }
  };

  const diagnostics = {
      user: {
          uid: user?.uid,
          email: user?.email,
          roles,
      },
      results,
  };

  return (
    <div className="container mx-auto p-4 sm:p-6 md:p-8">
      <Card>
        <CardHeader>
          <CardTitle>Firestore Security Rules Test Suite</CardTitle>
          <CardDescription>
            Run automated tests against your `firestore.rules` to verify permissions for each user role.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
            <div className="flex items-center gap-4 rounded-lg border p-4">
                <Shield className="h-6 w-6 text-muted-foreground" />
                <div>
                    <p className="font-semibold">Current User Roles</p>
                    <div className="flex gap-2 text-sm">
                        {roles.isAdmin && <Badge>Admin</Badge>}
                        {roles.isWriter && <Badge>Writer</Badge>}
                        {roles.isParent && <Badge>Parent</Badge>}
                        {!user && <Badge variant="outline">Unauthenticated</Badge>}
                    </div>
                </div>
            </div>
          <div className="flex gap-2">
            <Button onClick={runTests} disabled={isRunning}>
              {isRunning ? <LoaderCircle className="mr-2 animate-spin" /> : null}
              Run All Tests
            </Button>
            <Button variant="destructive" onClick={cleanupData} disabled={isCleaning}>
              {isCleaning ? <LoaderCircle className="mr-2 animate-spin" /> : <Trash2 className="mr-2" />}
              Cleanup Test Data
            </Button>
          </div>
          {isRunning && <Progress value={progress} className="w-full" />}
        </CardContent>
      </Card>
      
      <Card className="mt-6">
        <CardHeader>
          <CardTitle>Test Results</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Description</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Operation</TableHead>
                <TableHead>Expectation</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Message</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {results.map((result, i) => (
                <TableRow key={i}>
                  <TableCell>{result.case.description}</TableCell>
                  <TableCell><Badge variant="outline">{result.case.role}</Badge></TableCell>
                  <TableCell className="font-mono text-xs">{result.case.operation}</TableCell>
                  <TableCell><Badge variant={result.case.expected === 'allow' ? 'secondary' : 'destructive'}>{result.case.expected}</Badge></TableCell>
                  <TableCell><Badge variant={getStatusVariant(result.status)}>{result.status}</Badge></TableCell>
                  <TableCell className="text-xs text-destructive">{result.error}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
      
      <Card className="mt-8">
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Diagnostics</CardTitle>
          <Button variant="ghost" size="icon" onClick={() => {
              navigator.clipboard.writeText(JSON.stringify(diagnostics, null, 2));
              toast({ title: 'Copied to clipboard!' });
          }}>
            <Copy className="h-4 w-4" />
          </Button>
        </CardHeader>
        <CardContent>
          <pre className="bg-muted p-4 rounded-lg overflow-x-auto text-sm max-h-96">
            <code>{JSON.stringify(diagnostics, null, 2)}</code>
          </pre>
        </CardContent>
      </Card>
    </div>
  );
}

    