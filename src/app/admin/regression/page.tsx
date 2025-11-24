
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
import { collection, getDocs, doc, getDoc, query, where, limit, addDoc, serverTimestamp } from 'firebase/firestore';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import type { Message, StorySession, Character } from '@/lib/types';

type TestStatus = 'PENDING' | 'PASS' | 'FAIL' | 'SKIP' | 'ERROR';
type TestResult = {
  id: string;
  name: string;
  status: TestStatus;
  message: string;
  details?: any;
};

type ScenarioResult = {
    childId: string;
    sessionId: string;
} | null;

type ScenarioWarmupResult = {
    childId: string;
    sessionId: string;
    lastStatus: number;
    lastOk: boolean | null;
    lastErrorMessage: string | null;
    lastPreview: string | null;
} | null;


const initialTests: TestResult[] = [
  { id: 'DATA_PROMPTS', name: 'Firestore: Prompt Configs', status: 'PENDING', message: '' },
  { id: 'DATA_STORY_TYPES', name: 'Firestore: Story Types', status: 'PENDING', message: '' },
  { id: 'DATA_STORY_PHASES', name: 'Firestore: Story Phases', status: 'PENDING', message: '' },
  { id: 'DATA_CHILDREN', name: 'Firestore: Children', status: 'PENDING', message: '' },
  { id: 'DATA_SESSIONS_OVERVIEW', name: 'Firestore: Sessions Overview', status: 'PENDING', message: '' },
  { id: 'SCENARIO_BEAT_AUTO', name: 'Scenario: Auto-Beat', status: 'PENDING', message: '' },
  { id: 'SCENARIO_WARMUP_AUTO', name: 'Scenario: Auto-Warmup', status: 'PENDING', message: '' },
  { id: 'SESSION_BEAT_STRUCTURE', name: 'Session: Beat Structure (Input)', status: 'PENDING', message: '' },
  { id: 'SESSION_BEAT_MESSAGES', name: 'Session: Beat Messages (Input)', status: 'PENDING', message: '' },
  { id: 'API_STORY_BEAT', name: 'API: /api/storyBeat (Input)', status: 'PENDING', message: '' },
  { id: 'API_WARMUP_REPLY', name: 'API: /api/warmupReply (Input)', status: 'PENDING', message: '' },
];


export default function AdminRegressionPage() {
  const { isAuthenticated, isAdmin, loading: authLoading } = useAdminStatus();
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
    scenario: {},
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
          const [warmupSnap, beatSnap, allSnap] = await Promise.all([getDocs(qWarmup), getDocs(qBeat), getDocs(promptsRef)]);
          
          fsSummary.promptConfigsCount = allSnap.size;

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

      // Test: DATA_STORY_PHASES
      try {
        const phasesRef = collection(firestore, 'storyPhases');
        const requiredIds = ["warmup_phase_v1", "story_beat_phase_v1", "ending_phase_v1"];
        const docs = await Promise.all(requiredIds.map(id => getDoc(doc(phasesRef, id))));
        fsSummary.storyPhasesCount = (await getDocs(phasesRef)).size;
        const missing = [];
        for (let i = 0; i < docs.length; i++) {
            if (!docs[i].exists()) {
                missing.push(requiredIds[i]);
            }
        }
        if (missing.length > 0) {
            throw new Error(`Missing required phases: ${missing.join(', ')}`);
        }
        updateTestResult('DATA_STORY_PHASES', { status: 'PASS', message: 'Found all required phases.' });
      } catch (e: any) {
          updateTestResult('DATA_STORY_PHASES', { status: 'FAIL', message: e.message });
      }

      // Test: DATA_CHILDREN
      try {
        const childrenRef = collection(firestore, 'children');
        const snap = await getDocs(query(childrenRef, limit(5)));
        fsSummary.childrenCount = snap.size;
        if (snap.empty) {
            updateTestResult('DATA_CHILDREN', { status: 'SKIP', message: 'No children found; may be expected in dev.' });
        } else {
            const firstChild = snap.docs[0].data();
            if (!firstChild.displayName) {
                throw new Error('First child doc is missing displayName field.');
            }
            updateTestResult('DATA_CHILDREN', { status: 'PASS', message: `Found ${snap.size} children. First doc OK.` });
        }
      } catch (e: any) {
        updateTestResult('DATA_CHILDREN', { status: 'FAIL', message: e.message });
      }

      // Test: DATA_SESSIONS_OVERVIEW
      try {
        const sessionsRef = collection(firestore, 'storySessions');
        const snap = await getDocs(query(sessionsRef, limit(20)));
        fsSummary.sessionsCount = snap.size;
        
        if (snap.empty) {
            updateTestResult('DATA_SESSIONS_OVERVIEW', { status: 'SKIP', message: 'No story sessions found.' });
        } else {
            let wellFormedCount = 0;
            snap.docs.forEach(d => {
                const s = d.data();
                if (s.childId && s.storyPhaseId && typeof s.arcStepIndex === 'number') {
                    wellFormedCount++;
                }
            });
            fsSummary.sessionsWellFormed = wellFormedCount;
            fsSummary.sessionsMalformed = snap.size - wellFormedCount;

            if (wellFormedCount > 0) {
                updateTestResult('DATA_SESSIONS_OVERVIEW', { status: 'PASS', message: `Found ${snap.size} sessions; ${wellFormedCount} well-formed, ${fsSummary.sessionsMalformed} malformed.` });
            } else {
                throw new Error(`Found ${snap.size} sessions but none have childId, storyPhaseId, and arcStepIndex.`);
            }
        }
      } catch (e: any) {
        updateTestResult('DATA_SESSIONS_OVERVIEW', { status: 'FAIL', message: e.message });
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
              const sessionData = sessionSnap.data() as StorySession;
              if (!sessionData.storyTypeId || typeof sessionData.arcStepIndex !== 'number' || !sessionData.mainCharacterId) {
                  throw new Error('Session doc is missing storyTypeId, arcStepIndex, or mainCharacterId');
              }
              updateTestResult('SESSION_BEAT_STRUCTURE', { status: 'PASS', message: 'Doc exists and has required fields.' });
          } catch(e:any) {
               updateTestResult('SESSION_BEAT_STRUCTURE', { status: 'FAIL', message: e.message });
          }
      }

      // Test: SESSION_BEAT_MESSAGES
      if (!beatSessionId) {
        updateTestResult('SESSION_BEAT_MESSAGES', { status: 'SKIP', message: 'No beat-ready sessionId provided.' });
      } else {
        try {
            const messagesRef = collection(firestore, `storySessions/${beatSessionId}/messages`);
            const snap = await getDocs(messagesRef);
            const messages = snap.docs.map(d => d.data() as Message);
            const total = messages.length;
            const continuations = messages.filter(m => m.kind === 'beat_continuation').length;
            const options = messages.filter(m => m.kind === 'beat_options' && m.options && m.options.length > 0).length;

            if (total === 0) {
                updateTestResult('SESSION_BEAT_MESSAGES', { status: 'FAIL', message: 'No messages found for this session.' });
            } else if (continuations > 0 && options > 0) {
                 updateTestResult('SESSION_BEAT_MESSAGES', { status: 'PASS', message: `Found ${total} messages, including ${continuations} continuations and ${options} options.` });
            } else {
                updateTestResult('SESSION_BEAT_MESSAGES', { status: 'PASS', message: `Found ${total} messages. No beat messages yet.` });
            }
        } catch (e: any) {
            updateTestResult('SESSION_BEAT_MESSAGES', { status: 'ERROR', message: e.message });
        }
      }
  };

  const runApiTests = async (scenarioResults: { beat: ScenarioResult, warmup: ScenarioWarmupResult }) => {
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

    // Test: API_WARMUP_REPLY
    const warmupTestSessionId = warmupSessionId || scenarioResults.warmup?.sessionId;
    if (!warmupTestSessionId) {
        updateTestResult('API_WARMUP_REPLY', { status: 'SKIP', message: 'No warmup sessionId provided and scenario failed.' });
    } else {
        try {
            const response = await fetch('/api/warmupReply', {
                method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sessionId: warmupTestSessionId }),
            });
            apiSummary.warmupReply = { lastStatus: response.status, forSession: warmupTestSessionId };
            const result = await response.json();
            apiSummary.warmupReply.lastOk = result.ok;
            
            if (!response.ok) {
                 apiSummary.warmupReply.lastErrorMessage = result.errorMessage;
                 // Don't throw for config errors on manual session
                 if (warmupSessionId) {
                    updateTestResult('API_WARMUP_REPLY', { status: 'FAIL', message: `API returned status ${response.status}: ${result.errorMessage || 'Unknown error'}` });
                    setDiagnostics(prev => ({...prev, apiSummary: {...prev.apiSummary, ...apiSummary}}));
                    return; // End test here for manual session failure
                 }
                 throw new Error(`API returned status ${response.status}: ${result.errorMessage}`);
            }
             if (typeof result.ok !== 'boolean') {
                throw new Error('API response missing "ok" field.');
            }
            if (!result.ok) {
                // If it's a structured error, treat as a "soft fail" for the test
                updateTestResult('API_WARMUP_REPLY', { status: 'FAIL', message: `API returned ok:false. Error: ${result.errorMessage.slice(0, 100)}` });
            } else {
                apiSummary.warmupReply.lastPreview = result.assistantTextPreview;
                const source = warmupSessionId ? `manual session ${warmupSessionId.slice(0,5)}` : 'auto-scenario';
                updateTestResult('API_WARMUP_REPLY', { status: 'PASS', message: `API returned ok:true for ${source}.` });
            }

        } catch (e: any) {
             updateTestResult('API_WARMUP_REPLY', { status: 'FAIL', message: e.message });
        }
    }
    
    setDiagnostics(prev => ({...prev, apiSummary: {...prev.apiSummary, ...apiSummary}}));
  };
  
  const runScenarioTests = async (): Promise<{ beat: ScenarioResult, warmup: ScenarioWarmupResult }> => {
    if (!firestore) return { beat: null, warmup: null };
    
    let beatScenarioSummary: ScenarioResult = null;
    let warmupScenarioSummary: ScenarioWarmupResult = null;

    // Test: SCENARIO_BEAT_AUTO
    try {
        const typesRef = collection(firestore, 'storyTypes');
        const typeQuery = query(typesRef, where('status', '==', 'live'), limit(1));
        const typeSnap = await getDocs(typeQuery);
        if (typeSnap.empty) throw new Error('No live story types found.');
        const storyType = typeSnap.docs[0].data();
        const storyTypeId = typeSnap.docs[0].id;

        const childRef = await addDoc(collection(firestore, 'children'), { displayName: 'Regression Child', createdAt: serverTimestamp(), regressionTag: 'auto_beat' });

        const mainCharRef = await addDoc(collection(firestore, 'characters'), { ownerChildId: childRef.id, name: 'Reggie', role: 'child' });

        const sessionRef = await addDoc(collection(firestore, 'storySessions'), {
            childId: childRef.id,
            storyTypeId: storyTypeId,
            storyPhaseId: storyType.defaultPhaseId,
            arcStepIndex: 0,
            mainCharacterId: mainCharRef.id,
            promptConfigLevelBand: 'low',
            status: 'in_progress',
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
        });
        
        beatScenarioSummary = { childId: childRef.id, sessionId: sessionRef.id };

        const response = await fetch('/api/storyBeat', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sessionId: sessionRef.id }),
        });
        if (!response.ok) throw new Error(`API returned ${response.status}`);
        const result = await response.json();
        if (!result.ok) throw new Error(`API returned ok:false: ${result.errorMessage}`);
        if (!result.storyContinuation || result.options?.length < 3) throw new Error('API response has invalid shape.');

        updateTestResult('SCENARIO_BEAT_AUTO', { status: 'PASS', message: `Created session ${sessionRef.id.slice(0,5)} and got valid API response.` });

    } catch (e: any) {
        updateTestResult('SCENARIO_BEAT_AUTO', { status: 'ERROR', message: e.message });
        beatScenarioSummary = null;
    }
    
    // Test: SCENARIO_WARMUP_AUTO
    try {
        const promptQuery = query(collection(firestore, 'promptConfigs'), where('phase', '==', 'warmup'), where('levelBand', '==', 'low'), where('status', '==', 'live'), limit(1));
        const promptSnap = await getDocs(promptQuery);
        if (promptSnap.empty) throw new Error('No live low-level warmup promptConfig found.');
        const warmupPromptConfigId = promptSnap.docs[0].id;
        const warmupPromptConfigLevelBand = promptSnap.docs[0].data().levelBand;

        const childRef = await addDoc(collection(firestore, 'children'), { displayName: 'Regression Warmup Child', createdAt: serverTimestamp(), regressionTag: 'auto_warmup' });
        
        const sessionRef = await addDoc(collection(firestore, 'storySessions'), {
            childId: childRef.id,
            storyPhaseId: 'warmup_phase_v1',
            promptConfigId: warmupPromptConfigId,
            promptConfigLevelBand: warmupPromptConfigLevelBand,
            status: 'in_progress',
            arcStepIndex: 0,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
        });

        await addDoc(collection(firestore, `storySessions/${sessionRef.id}/messages`), {
             sender: 'assistant', text: 'Hi! I am your Story Guide. What should I call you?', createdAt: serverTimestamp()
        });

        const response = await fetch('/api/warmupReply', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sessionId: sessionRef.id }),
        });
        
        let jsonResponse;
        try {
            jsonResponse = await response.json();
        } catch (jsonErr) {
            throw new Error(`Could not parse JSON response from API. Status: ${response.status}.`);
        }

        warmupScenarioSummary = {
            childId: childRef.id,
            sessionId: sessionRef.id,
            lastStatus: response.status,
            lastOk: jsonResponse?.ok ?? null,
            lastErrorMessage: jsonResponse?.errorMessage ?? null,
            lastPreview: jsonResponse?.assistantTextPreview ?? null,
        };

        if (!response.ok) {
            throw new Error(`API returned status ${response.status}: ${jsonResponse.errorMessage || 'Unknown error'}`);
        }
        if (!jsonResponse.ok) {
             throw new Error(`API returned ok:false: ${jsonResponse.errorMessage}`);
        }
        if (!jsonResponse.assistantText) {
            throw new Error('API response missing assistantText.');
        }

        updateTestResult('SCENARIO_WARMUP_AUTO', { status: 'PASS', message: `Created session ${sessionRef.id.slice(0,5)} and got valid API response.` });

    } catch(e:any) {
        updateTestResult('SCENARIO_WARMUP_AUTO', { status: 'ERROR', message: e.message });
    }

    const scenarioResults = { beat: beatScenarioSummary, warmup: warmupScenarioSummary };
    setDiagnostics(prev => ({...prev, scenario: scenarioResults }));
    return scenarioResults;
  };


  const runAllTests = async () => {
    setIsRunning(true);
    setTests(initialTests.map(t => ({...t, status: 'PENDING', message: '' })));
    setDiagnostics(prev => ({ ...prev, firestoreSummary: {}, apiSummary: {}, scenario: {} }));

    await runDataTests();
    const scenarioResults = await runScenarioTests();
    await runSessionTests();
    await runApiTests(scenarioResults);
    
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

  const finalDiagnostics = {
      ...diagnostics,
      auth: { isAuthenticated, isAdmin },
      input: { beatSessionId, warmupSessionId },
      tests
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
            <code>{JSON.stringify(finalDiagnostics, null, 2)}</code>
          </pre>
        </CardContent>
      </Card>
    </div>
  );
}

    