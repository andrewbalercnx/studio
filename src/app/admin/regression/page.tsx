'use client';

import { useState, useMemo } from 'react';
import { useAdminStatus } from '@/hooks/use-admin-status';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { LoaderCircle, Trash2 } from 'lucide-react';
import { DiagnosticsPanel } from '@/components/diagnostics-panel';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import { useFirestore, useAuth } from '@/firebase';
import { collection, getDocs, doc, query, where, writeBatch } from 'firebase/firestore';
import type { Firestore } from 'firebase/firestore';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Progress } from '@/components/ui/progress';
import { AuthSummary, TestResult, TestStatus, initialTests, resetTestState, totalTests } from '@/components/admin/regression/shared';
import { runAuthTests } from '@/components/admin/regression/auth-tests';
import { runDataTests } from '@/components/admin/regression/data-tests';
import { runScenarioAndApiTests } from '@/components/admin/regression/scenario-api-tests';
import type { RegressionContext } from '@/components/admin/regression/context';

export default function AdminRegressionPage() {
  const { isAuthenticated, isAdmin: statusIsAdmin, loading: authLoading } = useAdminStatus();
  const firestore = useFirestore();
  const auth = useAuth();
  const { toast } = useToast();

  const [isRunning, setIsRunning] = useState(false);
  const [isCleaning, setIsCleaning] = useState(false);
  const [tests, setTests] = useState<TestResult[]>(initialTests);
  const [authSummary, setAuthSummary] = useState<AuthSummary | null>(null);

  const [diagnostics, setDiagnostics] = useState<any>({
    page: 'admin-regression',
    firestoreSummary: {},
    apiSummary: {},
    scenario: {},
  });

  const completedCount = useMemo(
    () => tests.filter((test) => test.status !== 'PENDING').length,
    [tests]
  );
  const progressPercent = useMemo(() => {
    if (totalTests === 0) return 0;
    return Math.round((completedCount / totalTests) * 100);
  }, [completedCount]);
  
  const updateTestResult = (id: string, result: Partial<TestResult>) => {
    setTests(prev => prev.map(t => t.id === id ? { ...t, ...result } : t));
  };
  
  const regression: RegressionContext = { firestore, auth, updateTestResult, setDiagnostics };

  
  

  const markPendingTests = (status: TestStatus, message: string) => {
    setTests(prev => prev.map(t => (t.status === 'PENDING' ? { ...t, status, message } : t)));
  };

  const runAllTests = async () => {
    if (!firestore) {
      toast({
        title: 'Firestore client unavailable',
        description: 'Hold on a moment and try again—client Firestore has not finished initializing.',
        variant: 'destructive',
      });
      return;
    }

    setIsRunning(true);
    setTests(resetTestState());
    setDiagnostics((prev: any) => ({ ...prev, firestoreSummary: {}, apiSummary: {}, scenario: {} }));
    
    try {
      const currentAuthSummary = await runAuthTests(regression);
      setAuthSummary(currentAuthSummary);

      const testGroups = initialTests.reduce((acc, test) => {
          const prefix = test.id.split('_')[0];
          if (!acc[prefix]) acc[prefix] = [];
          acc[prefix].push(test);
          return acc;
      }, {} as Record<string, TestResult[]>);

      if (testGroups['DATA']) {
          await runDataTests(regression);
      }
      if (testGroups['API'] || testGroups['SCENARIO']) {
          await runScenarioAndApiTests(regression);
      }

      // Mark any remaining PENDING tests as skipped if they weren't handled
      markPendingTests('SKIP', 'Test runner logic did not execute for this test.');
      toast({ title: 'Regression tests complete!' });
    } catch (error: any) {
      console.error('Regression test run failed', error);
      const message = error?.message || 'Unexpected error while running tests.';
      toast({ title: 'Regression suite failed', description: message, variant: 'destructive' });
      markPendingTests('ERROR', `Runner crashed: ${message}`);
    } finally {
      setIsRunning(false);
    }
  };
  
  const cleanupAllRegressionData = async () => {
    if (!firestore) {
        toast({ title: 'Firestore client not ready.', variant: 'destructive' });
        return;
    }
    setIsCleaning(true);
    try {
        const collectionsToClean = ['children', 'characters', 'stories', 'promptConfigs', 'printOrders', 'printLayouts'];
        const batch = writeBatch(firestore);
        let deletedCount = 0;

        for (const coll of collectionsToClean) {
            const q = query(collection(firestore, coll), where('regressionTest', '==', true));
            const snapshot = await getDocs(q);
            snapshot.forEach(doc => {
                batch.delete(doc.ref);
                deletedCount++;
            });
        }
        await batch.commit();
        toast({ title: 'Cleanup Complete', description: `Deleted ${deletedCount} regression test documents.` });
    } catch (error: any) {
        toast({ title: 'Cleanup Failed', description: error.message, variant: 'destructive' });
    } finally {
        setIsCleaning(false);
    }
  };
  
   const getStatusVariant = (status: TestStatus) => {
    switch (status) {
      case 'PASS': return 'default';
      case 'FAIL': return 'destructive';
      case 'ERROR': return 'destructive';
      case 'SKIP': return 'secondary';
      default: return 'outline';
    }
  };


  const renderContent = () => {
    if (authLoading) return <LoaderCircle className="mx-auto h-8 w-8 animate-spin" />;
    if (!isAuthenticated || !statusIsAdmin) return <p>You must be an admin to run these tests.</p>;

    return (
        <>
        <Card>
            <CardHeader>
                <CardTitle>Test Parameters</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
                <div className="space-y-2 rounded-lg border bg-muted/40 p-4">
                    <div className="flex items-center justify-between text-sm font-medium">
                        <span>{isRunning ? 'Running regression suite…' : 'Suite progress'}</span>
                        <span className="text-muted-foreground">{completedCount}/{totalTests} complete</span>
                    </div>
                    <Progress value={progressPercent} className="h-2" />
                </div>
            </CardContent>
             <CardFooter className="gap-2">
                <Button onClick={runAllTests} disabled={isRunning || isCleaning}>
                    {isRunning ? <><LoaderCircle className="mr-2 h-4 w-4 animate-spin"/>Running...</> : 'Run all regression tests'}
                </Button>
                 <Button variant="destructive" onClick={cleanupAllRegressionData} disabled={isRunning || isCleaning}>
                    {isCleaning ? <><LoaderCircle className="mr-2 h-4 w-4 animate-spin"/>Cleaning...</> : <><Trash2 className="mr-2 h-4 w-4"/>Cleanup Leftover Data</>}
                </Button>
            </CardFooter>
        </Card>

        <Card className="mt-6">
            <CardHeader><CardTitle>Test Results</CardTitle></CardHeader>
            <CardContent>
                <Table>
                    <TableHeader>
                        <TableRow>
                            <TableHead>ID</TableHead>
                            <TableHead>Name</TableHead>
                            <TableHead>Status</TableHead>
                            <TableHead>Summary</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {tests.map(t => (
                            <TableRow key={t.id}>
                                <TableCell className="font-mono text-xs">{t.id}</TableCell>
                                <TableCell>{t.name}</TableCell>
                                <TableCell><Badge variant={getStatusVariant(t.status)}>{t.status}</Badge></TableCell>
                                <TableCell className="text-xs">{t.message}</TableCell>
                            </TableRow>
                        ))}
                    </TableBody>
                </Table>
            </CardContent>
        </Card>
        </>
    );
  };

  const finalDiagnostics = {
      ...diagnostics,
      authSummary: authSummary,
      tests
  };


  return (
    <div className="container mx-auto p-4 sm:p-6 md:p-8">
      <div className="mb-6">
        <h1 className="text-3xl font-bold">Regression Test Dashboard</h1>
        <p className="text-muted-foreground">Runs a suite of non-destructive checks against Firestore and Genkit APIs.</p>
      </div>
      
      {renderContent()}

      <DiagnosticsPanel pageName="admin-regression" data={finalDiagnostics} className="mt-8" />
    </div>
  );
}
