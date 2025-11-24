'use client';

import { useState } from 'react';
import { useAdminStatus } from '@/hooks/use-admin-status';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { LoaderCircle } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import { useFirestore } from '@/firebase';
import { collection, getDocs, doc, getDoc, query, where, limit } from 'firebase/firestore';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

type TestStatus = 'PENDING' | 'PASS' | 'FAIL' | 'SKIP' | 'ERROR';
type TestResult = {
  id: string;
  name: string;
  status: TestStatus;
  message: string;
  details?: any;
};

const initialTests: TestResult[] = [
  { id: 'DATA_PROMPTS', name: 'Firestore: Prompt Configs', status: 'PENDING', message: '' },
  { id: 'DATA_STORY_TYPES', name: 'Firestore: Story Types', status: 'PENDING', message: '' },
  { id: 'DATA_STORY_PHASES', name: 'Firestore: Story Phases', status: 'PENDING', message: '' },
  { id: 'DATA_CHILDREN', name: 'Firestore: Children', status: 'PENDING', message: '' },
  { id: 'DATA_SESSIONS_OVERVIEW', name: 'Firestore: Sessions Overview', status: 'PENDING', message: '' },
  { id: 'SESSION_BEAT_STRUCTURE', name: 'Session: Beat Structure', status: 'PENDING', message: '' },
  { id: 'SESSION_BEAT_MESSAGES', name: 'Session: Beat Messages', status: 'PENDING', message: '' },
  { id: 'API_STORY_BEAT', name: 'API: /api/storyBeat', status: 'PENDING', message: '' },
  { id: 'API_WARMUP_REPLY', name: 'API: /api/warmupReply', status: 'PENDING', message: '' },
];


export default function AdminRegressionPage() {
  const { isAuthenticated, isAdmin, email, loading: authLoading } = useAdminStatus();
  const firestore = useFirestore();
  const { toast } = useToast();

  const [beatSessionId, setBeatSessionId] = useState('sample-session-1');
  const [warmupSessionId, setWarmupSessionId] = useState('sample-session-1');
  const [isRunning, setIsRunning] = useState(false);
  const [tests, setTests] = useState<TestResult[]>(initialTests);

  const [diagnostics, setDiagnostics] = useState<any>({
    page: 'admin-regression',
    firestoreSummary: {},
    apiSummary: {},
  });

  const updateTestResult = (id: string, result: Partial<TestResult>) => {
    setTests(prev => prev.map(t => t.id === id ? { ...t, ...result } : t));
  };
  
  const runDataTests = async () => {
      if (!firestore) return;
      let fsSummary: any = {};

      // Test: DATA_PROMPTS
      try {
          const promptsRef = collection(firestore, 'promptConfigs');
          const qWarmup = query(promptsRef, where('phase', '==', 'warmup'), limit(1));
          const qBeat = query(promptsRef, where('phase', '==', 'storyBeat'), limit(1));
          const [warmupSnap, beatSnap] = await Promise.all([getDocs(qWarmup), getDocs(qBeat)]);
          
          fsSummary.promptConfigsCount = (await getDocs(promptsRef)).size;

          if (warmupSnap.empty || beatSnap.empty) {
              throw new Error(`Missing configs: warmup=${warmupSnap.size}, storyBeat=${beatSnap.size}`);
          }
          const promptDoc = beatSnap.docs[0].data();
          if (!promptDoc.id || !promptDoc.model?.name) {
              throw new Error('Beat prompt config missing key fields.');
          }
          updateTestResult('DATA_PROMPTS', { status: 'PASS', message: `Found ${fsSummary.promptConfigsCount} configs, including warmup and storyBeat.` });
      } catch (e: any) {
          updateTestResult('DATA_PROMPTS', { status: 'FAIL', message: e.message });
      }

      // Test: DATA_STORY_TYPES
       try {
          const storyTypesRef = collection(firestore, 'storyTypes');
          const snap = await getDocs(storyTypesRef);
          fsSummary.storyTypesCount = snap.size;
          if (snap.empty) throw new Error('Collection is empty.');
          const typeDoc = snap.docs[0].data();
          if (!typeDoc.name || !typeDoc.defaultPhaseId || !typeDoc.arcTemplate?.steps?.length) {
              throw new Error('First story type doc is missing key fields.');
          }
          updateTestResult('DATA_STORY_TYPES', { status: 'PASS', message: `Found ${snap.size} types. First doc OK.` });
       } catch(e: any) {
            updateTestResult('DATA_STORY_TYPES', { status: 'FAIL', message: e.message });
       }
       
       setDiagnostics(prev => ({...prev, firestoreSummary: {...prev.firestoreSummary, ...fsSummary }}));
  };
  
  const runSessionTests = async () => {
      if (!firestore) return;

      // Test: SESSION_BEAT_STRUCTURE
      if (!beatSessionId) {
          updateTestResult('SESSION_BEAT_STRUCTURE', { status: 'SKIP', message: 'No beat-ready sessionId provided' });
      } else {
          try {
              const sessionRef = doc(firestore, 'storySessions', beatSessionId);
              const sessionSnap = await getDoc(sessionRef);
              if (!sessionSnap.exists()) throw new Error(`Doc ${beatSessionId} not found.`);
              const sessionData = sessionSnap.data();
              if (!sessionData.storyTypeId || typeof sessionData.arcStepIndex !== 'number' || !sessionData.mainCharacterId) {
                  throw new Error('Session doc is missing storyTypeId, arcStepIndex, or mainCharacterId');
              }
              updateTestResult('SESSION_BEAT_STRUCTURE', { status: 'PASS', message: 'Doc exists and has required fields.' });
          } catch(e:any) {
               updateTestResult('SESSION_BEAT_STRUCTURE', { status: 'FAIL', message: e.message });
          }
      }
  };

  const runApiTests = async () => {
    let apiSummary: any = {};
    
    // Test: API_STORY_BEAT
    if (!beatSessionId) {
      updateTestResult('API_STORY_BEAT', { status: 'SKIP', message: 'No beat-ready sessionId provided' });
    } else {
      try {
        const response = await fetch('/api/storyBeat', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sessionId: beatSessionId }),
        });
        apiSummary.storyBeat = { lastStatus: response.status };
        const result = await response.json();
        apiSummary.storyBeat.lastOk = result.ok;

        if (!response.ok || !result.ok) {
            apiSummary.storyBeat.lastErrorMessage = result.errorMessage;
            throw new Error(result.errorMessage || `API returned status ${response.status}`);
        }
        if (!result.storyContinuation || result.options?.length < 3) {
            throw new Error('API response missing storyContinuation or has insufficient options.');
        }
        apiSummary.storyBeat.lastContinuationPreview = result.storyContinuation.slice(0, 80);
        updateTestResult('API_STORY_BEAT', { status: 'PASS', message: 'API returned ok:true with valid shape.' });
      } catch (e: any) {
        updateTestResult('API_STORY_BEAT', { status: 'FAIL', message: e.message });
      }
    }
    
    setDiagnostics(prev => ({...prev, apiSummary: {...prev.apiSummary, ...apiSummary}}));
  };


  const runAllTests = async () => {
    setIsRunning(true);
    setTests(initialTests); // Reset tests to PENDING
    setDiagnostics(prev => ({ ...prev, firestoreSummary: {}, apiSummary: {} }));

    await runDataTests();
    await runSessionTests();
    await runApiTests();

    setIsRunning(false);
    toast({ title: 'Regression tests complete!' });
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
    if (!isAuthenticated || !isAdmin) return <p>You must be an admin to run these tests.</p>;

    return (
        <>
        <Card>
            <CardHeader>
                <CardTitle>Test Parameters</CardTitle>
            </CardHeader>
            <CardContent className="grid sm:grid-cols-2 gap-4">
                <div className="space-y-2">
                    <Label htmlFor="beatSessionId">Beat-ready Session ID</Label>
                    <Input id="beatSessionId" value={beatSessionId} onChange={e => setBeatSessionId(e.target.value)} />
                    <p className="text-xs text-muted-foreground">A session with storyTypeId, phaseId, arcStepIndex set.</p>
                </div>
                 <div className="space-y-2">
                    <Label htmlFor="warmupSessionId">Warmup Session ID</Label>
                    <Input id="warmupSessionId" value={warmupSessionId} onChange={e => setWarmupSessionId(e.target.value)} />
                    <p className="text-xs text-muted-foreground">A session in warmup phase with at least one message.</p>
                </div>
            </CardContent>
             <CardFooter>
                <Button onClick={runAllTests} disabled={isRunning}>
                    {isRunning ? <><LoaderCircle className="mr-2 h-4 w-4 animate-spin"/>Running...</> : 'Run all regression tests'}
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


  return (
    <div className="container mx-auto p-4 sm:p-6 md:p-8">
      <div className="mb-6">
        <h1 className="text-3xl font-bold">Regression Test Dashboard</h1>
        <p className="text-muted-foreground">Runs a suite of non-destructive checks against Firestore and Genkit APIs.</p>
      </div>
      
      {renderContent()}

      <Card className="mt-8">
        <CardHeader>
          <CardTitle>Diagnostics</CardTitle>
        </CardHeader>
        <CardContent>
          <pre className="bg-muted p-4 rounded-lg overflow-x-auto text-sm">
            <code>{JSON.stringify({ ...diagnostics, auth: { isAuthenticated, isAdmin, email }, input: { beatSessionId, warmupSessionId }, tests }, null, 2)}</code>
          </pre>
        </CardContent>
      </Card>
    </div>
  );
}
