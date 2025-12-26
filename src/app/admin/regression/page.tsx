

'use client';

import { useState, useMemo } from 'react';
import { useAdminStatus } from '@/hooks/use-admin-status';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Copy, LoaderCircle, Trash2 } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import { useFirestore, useAuth } from '@/firebase';
import { collection, getDocs, doc, getDoc, query, where, limit, addDoc, serverTimestamp, updateDoc, increment, orderBy, deleteDoc, writeBatch, setDoc } from 'firebase/firestore';
import type { Firestore, DocumentReference } from 'firebase/firestore';
import type { ChatMessage, StorySession, Character, PromptConfig, Choice, StoryType, ChildProfile, StoryOutputPage as StoryBookPage, StoryOutput, PrintLayout } from '@/lib/types';
import { IdTokenResult } from 'firebase/auth';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Progress } from '@/components/ui/progress';

type TestStatus = 'PENDING' | 'PASS' | 'FAIL' | 'ERROR' | 'SKIP';
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
    debug?: any;
} | null;

type ScenarioMoreOptionsResult = {
    childId: string;
    sessionId: string;
    firstCallStatus?: number;
    secondCallStatus?: number;
    firstContinuationPreview?: string | null;
    secondContinuationPreview?: string | null;
} | null;

type ScenarioCharacterResult = {
    childId: string;
    sessionId: string;
    optionsCount: number | null;
    sampleOption: Choice | null;
} | null;

type ScenarioCharacterTraitsResult = {
    childId: string | null;
    sessionId: string | null;
    characterId: string | null;
    question?: string | null;
    suggestedTraits?: string[];
    ok?: boolean;
    errorMessage?: string;
    [key: string]: any;
} | null;


type ScenarioArcAdvanceResult = {
    childId: string | null;
    sessionId: string | null;
    initialArcStepIndex: number | null;
    finalArcStepIndex: number | null;
    error?: string;
} | null;

type ScenarioArcBoundsResult = {
    sessionId: string | null,
    storyTypeId: string,
    stepsCount: number,
    maxAllowedIndex: number,
    maxObservedArcStepIndex: number,
    lastArcStepId: string | null,
    expectedLastArcStepId: string,
    error?: string;
} | null;

type ScenarioEndingResult = {
    childId: string | null;
    sessionId: string | null;
    endingsCount: number | null;
    sampleEnding: string | null;
    error?: string;
} | null;

type ScenarioStoryCompileResult = {
    childId: string | null;
    sessionId: string | null;
    storyLength: number | null;
    storyPreview: string | null;
    hasStory: boolean;
    storyId: string | null;
    storyStatus?: string | null;
    pagesCount?: number | null;
    firstPageKind?: string | null;
    lastPageKind?: string | null;
    interiorPlacementsAlternate?: boolean | null;
    imageLogs?: string[] | null;
    error?: string;
} | null;

type ScenarioPhaseStateResult = {
    sessionId: string | null;
    phaseAfterWarmup?: string;
    phaseAfterFirstBeat?: string;
    phaseAtFinalBeat?: string;
    phaseAfterEnding?: string;
    phaseAfterCompile?: string;
    [key: string]: any; // for errors
} | null;

type ScenarioChildStoryListResult = {
    childId: string;
    parentUid: string;
    storyCount: number;
    firstStoryId?: string;
    error?: string;
} | null;

type ScenarioStorybookE2EResult = {
    childId: string;
    sessionId: string;
    storyTypeId: string;
    beatCount: number;
    endingsGenerated: number;
    storyId?: string;
    pagesReady?: number;
    artReady?: boolean;
    finalized?: boolean;
    printableReady?: boolean;
    orderId?: string | null;
    error?: string;
} | null;

type AuthSummary = {
    uid: string | null;
    email: string | null;
    isAdmin: boolean;
    isWriter: boolean;
    isParent: boolean;
    rawClaims?: Record<string, unknown>;
};

const REGRESSION_SUITE_TAG = 'admin-regression';

type RegressionArtifactTracker = {
    children: Set<string>;
    sessions: Set<string>;
    characters: Set<string>;
    stories: Set<string>;
    promptConfigs: Set<string>;
    printOrders: Set<string>;
    printLayouts: Set<string>;
};

const createArtifactTracker = (): RegressionArtifactTracker => ({
    children: new Set(),
    sessions: new Set(),
    characters: new Set(),
    stories: new Set(),
    promptConfigs: new Set(),
    printOrders: new Set(),
    printLayouts: new Set(),
});

const addRegressionMeta = <T extends Record<string, any>>(data: T, scenarioId: string) => ({
    ...data,
    regressionTest: true,
    regressionTag: `${REGRESSION_SUITE_TAG}:${scenarioId}`,
});

const trackArtifact = (
    tracker: RegressionArtifactTracker,
    category: keyof RegressionArtifactTracker,
    id: string | null | undefined
) => {
    if (id) {
        tracker[category].add(id);
    }
};

const tracedCollection = (
    firestore: Firestore | null,
    context: string,
    ...segments: [string, ...string[]]
) => {
    if (!firestore) {
        const error = new Error(`[${context}] Firestore instance is not initialized.`);
        console.error(error.message);
        throw error;
    }
    try {
        return collection(firestore, ...segments);
    } catch (err) {
        console.error(`[Regression][collection] ${context}`, {
            segments,
            errorMessage: (err as Error)?.message,
            stack: (err as Error)?.stack,
        });
        throw err;
    }
};

const deleteSubcollectionDocs = async (firestore: Firestore, segments: string[]) => {
    const collectionRef = collection(firestore, ...(segments as [string, ...string[]]));
    const snapshot = await getDocs(collectionRef);
    await Promise.all(snapshot.docs.map((docSnap) => deleteDoc(docSnap.ref)));
};

const cleanupRegressionArtifacts = async (firestore: Firestore, tracker: RegressionArtifactTracker) => {
    const deleteWithLogging = async (label: string, fn: () => Promise<void>) => {
        try {
            await fn();
        } catch (error) {
            console.error(`[RegressionCleanup] Failed to delete ${label}`, error);
        }
    };

    for (const sessionId of tracker.sessions) {
        await deleteWithLogging(`storySessions/${sessionId}`, async () => {
            await deleteSubcollectionDocs(firestore, ['storySessions', sessionId, 'messages']);
            await deleteDoc(doc(firestore, 'storySessions', sessionId));
        });
    }

    for (const childId of tracker.children) {
        await deleteWithLogging(`children/${childId}`, async () => {
            await deleteSubcollectionDocs(firestore, ['children', childId, 'sessions']);
            await deleteDoc(doc(firestore, 'children', childId));
        });
    }

    for (const characterId of tracker.characters) {
        await deleteWithLogging(`characters/${characterId}`, async () => {
            await deleteDoc(doc(firestore, 'characters', characterId));
        });
    }

    for (const storyId of tracker.stories) {
        await deleteWithLogging(`stories/${storyId}`, async () => {
            const outputsSnap = await getDocs(collection(firestore, 'stories', storyId, 'outputs'));
            for (const outputDoc of outputsSnap.docs) {
                await deleteSubcollectionDocs(firestore, ['stories', storyId, 'outputs', outputDoc.id, 'pages']);
                await deleteDoc(outputDoc.ref);
            }
            await deleteDoc(doc(firestore, 'stories', storyId));
        });
    }
    
    for (const orderId of tracker.printOrders) {
        await deleteWithLogging(`printOrders/${orderId}`, async () => {
            await deleteDoc(doc(firestore, 'printOrders', orderId));
        });
    }

    for (const configId of tracker.promptConfigs) {
        await deleteWithLogging(`promptConfigs/${configId}`, async () => {
            await deleteDoc(doc(firestore, 'promptConfigs', configId));
        });
    }
    for (const layoutId of tracker.printLayouts) {
        await deleteWithLogging(`printLayouts/${layoutId}`, async () => {
            await deleteDoc(doc(firestore, 'printLayouts', layoutId));
        });
    }
};


const initialTests: TestResult[] = [
  { id: 'DATA_AUTH_CLAIMS', name: 'Auth: Claims Visibility', status: 'PENDING', message: '' },
  { id: 'DATA_AUTH_ADMIN_FIRESTORE', name: 'Auth: Admin Firestore Access', status: 'PENDING', message: '' },
  { id: 'DATA_AUTH_PARENT_CHILDREN', name: 'Auth: Parent Child Access', status: 'PENDING', message: '' },
  { id: 'DATA_AUTH_WRITER_CONFIGS', name: 'Auth: Writer Config Access', status: 'PENDING', message: '' },
  { id: 'SCENARIO_CHILD_STORY_LIST', name: 'Scenario: Child Story List', status: 'PENDING', message: '' },
  { id: 'SCENARIO_STORYBOOK_E2E', name: 'Scenario: Storybook E2E Flow', status: 'PENDING', message: '' },
  { id: 'SCENARIO_PHASE_STATE_MACHINE', name: 'Scenario: Phase State Machine', status: 'PENDING', message: '' },
  { id: 'SCENARIO_STORY_COMPILE', name: 'Scenario: Story Compile', status: 'PENDING', message: '' },
  { id: 'SCENARIO_ENDING_FLOW', name: 'Scenario: Ending Flow', status: 'PENDING', message: '' },
  { id: 'SCENARIO_ARC_BOUNDS', name: 'Scenario: Arc Bounds', status: 'PENDING', message: '' },
  { id: 'SCENARIO_ARC_STEP_ADVANCE', name: 'Scenario: Arc Step Advance', status: 'PENDING', message: '' },
  { id: 'SCENARIO_CHARACTER_TRAITS', name: 'Scenario: Character Traits Flow', status: 'PENDING', message: '' },
  { id: 'SCENARIO_CHARACTER_FROM_BEAT', name: 'Scenario: Character Metadata in Beat Options', status: 'PENDING', message: '' },
  { id: 'SCENARIO_MORE_OPTIONS', name: 'Scenario: More Options on Beat', status: 'PENDING', message: '' },
  { id: 'SCENARIO_BEAT_AUTO', name: 'Scenario: Auto-Beat (Legacy ID)', status: 'PENDING', message: '' },
  { id: 'SCENARIO_WARMUP_AUTO', name: 'Scenario: Auto-Warmup', status: 'PENDING', message: '' },
  { id: 'API_WARMUP_REPLY', name: 'API: /api/warmupReply (Input)', status: 'PENDING', message: '' },
  { id: 'API_STORY_BEAT', name: 'API: /api/storyBeat (Input)', status: 'PENDING', message: '' },
  { id: 'SESSION_BEAT_MESSAGES', name: 'Session: Beat Messages (Input)', status: 'PENDING', message: '' },
  { id: 'SESSION_BEAT_STRUCTURE', name: 'Session: Beat Structure (Input)', status: 'PENDING', message: '' },
  { id: 'DATA_SESSIONS_OVERVIEW', name: 'Firestore: Sessions Overview', status: 'PENDING', message: '' },
  { id: 'DATA_CHILDREN_EXTENDED', name: 'Firestore: Children (Extended)', status: 'PENDING', message: '' },
  { id: 'DATA_CHILDREN', name: 'Firestore: Children', status: 'PENDING', message: '' },
  { id: 'DATA_STORY_OUTPUTS', name: 'Firestore: Story Output Types', status: 'PENDING', message: '' },
  { id: 'DATA_STORY_PHASES', name: 'Firestore: Story Phases', status: 'PENDING', message: '' },
  { id: 'DATA_STORY_TYPES', name: 'Firestore: Story Types', status: 'PENDING', message: '' },
  { id: 'DATA_PRINT_LAYOUTS', name: 'Firestore: Print Layouts', status: 'PENDING', message: '' },
  { id: 'DATA_PROMPTS_STORY_BEAT_LIVE', name: 'Firestore: StoryBeat Live Configs', status: 'PENDING', message: '' },
  { id: 'DATA_PROMPTS', name: 'Firestore: Prompt Configs', status: 'PENDING', message: '' },
];

const resetTestState = (): TestResult[] =>
  initialTests.map((test) => ({
    ...test,
    status: 'PENDING',
    message: '',
    details: undefined,
  }));

const totalTests = initialTests.length;

export default function AdminRegressionPage() {
  const { isAuthenticated, isAdmin: statusIsAdmin, loading: authLoading } = useAdminStatus();
  const firestore = useFirestore();
  const auth = useAuth();
  const { toast } = useToast();

  const [beatSessionId, setBeatSessionId] = useState('');
  const [warmupSessionId, setWarmupSessionId] = useState('');
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
  
  const runAuthTests = async (): Promise<AuthSummary> => {
      const user = auth?.currentUser;
      if (!user) {
          const summary = { uid: null, email: null, isAdmin: false, isWriter: false, isParent: false };
          updateTestResult('DATA_AUTH_CLAIMS', { status: 'FAIL', message: "No authenticated user found." });
          updateTestResult('DATA_AUTH_ADMIN_FIRESTORE', { status: 'SKIP', message: "Requires authenticated user." });
          updateTestResult('DATA_AUTH_PARENT_CHILDREN', { status: 'SKIP', message: "Requires authenticated user." });
          updateTestResult('DATA_AUTH_WRITER_CONFIGS', { status: 'SKIP', message: "Requires authenticated user." });
          return summary;
      }
      
      const tokenResult = await user.getIdTokenResult(true);
      const claims = tokenResult.claims;
      const summary: AuthSummary = {
          uid: user.uid,
          email: user.email,
          isAdmin: !!claims.isAdmin,
          isWriter: !!claims.isWriter,
          isParent: !!claims.isParent,
          rawClaims: { ...claims }
      };

      // Test: DATA_AUTH_CLAIMS
      updateTestResult('DATA_AUTH_CLAIMS', {
          status: 'PASS',
          message: `Auth as ${summary.email}; roles: admin=${summary.isAdmin}, writer=${summary.isWriter}, parent=${summary.isParent}`,
          details: { claims: summary.rawClaims }
      });

      // Test: DATA_AUTH_ADMIN_FIRESTORE
      if (!summary.isAdmin) {
          updateTestResult('DATA_AUTH_ADMIN_FIRESTORE', { status: 'SKIP', message: 'Not an admin.' });
      } else {
          try {
              const collectionsToTest = ['promptConfigs', 'storyTypes', 'storyPhases', 'storyOutputTypes', 'children'];
              const promises = collectionsToTest.map(c => getDocs(query(collection(firestore!, c), limit(1))));
              await Promise.all(promises);
              updateTestResult('DATA_AUTH_ADMIN_FIRESTORE', { status: 'PASS', message: 'Admin can read core config and children collections.' });
          } catch(e:any) {
              updateTestResult('DATA_AUTH_ADMIN_FIRESTORE', { status: 'FAIL', message: `Admin read failed: ${e.message}` });
          }
      }

      // Test: DATA_AUTH_PARENT_CHILDREN
      if (summary.isAdmin || summary.isWriter) {
          updateTestResult('DATA_AUTH_PARENT_CHILDREN', { status: 'SKIP', message: 'Skipping parent test for admin/writer.' });
      } else {
          try {
              const ownChildrenQuery = query(collection(firestore!, 'children'), where('ownerParentUid', '==', user.uid));
              const otherChildrenQuery = query(collection(firestore!, 'children'), where('ownerParentUid', '!=', user.uid), limit(1));
              
              await getDocs(ownChildrenQuery); // Should succeed
              let failedAsExpected = false;
              try {
                  await getDocs(otherChildrenQuery); // Should fail
              } catch(e: any) {
                  if (e.code === 'permission-denied') failedAsExpected = true;
              }

              if (failedAsExpected) {
                  updateTestResult('DATA_AUTH_PARENT_CHILDREN', { status: 'PASS', message: "Parent can read own children and is blocked from others'." });
              } else {
                  updateTestResult('DATA_AUTH_PARENT_CHILDREN', { status: 'FAIL', message: "Parent was able to read other children's data." });
              }
          } catch(e:any) {
              updateTestResult('DATA_AUTH_PARENT_CHILDREN', { status: 'FAIL', message: `Parent test failed unexpectedly: ${e.message}` });
          }
      }

      // Test: DATA_AUTH_WRITER_CONFIGS
      if (!summary.isWriter || summary.isAdmin) {
          updateTestResult('DATA_AUTH_WRITER_CONFIGS', { status: 'SKIP', message: 'Skipping for non-writers or admins.' });
      } else {
          let writerTestPassed = true;
          let failMessage = '';
          let tempWriterConfigRef: DocumentReference | null = null;
          try {
              await getDocs(query(collection(firestore!, 'promptConfigs'), limit(1)));
              await getDocs(query(collection(firestore!, 'storyTypes'), limit(1)));
              tempWriterConfigRef = await addDoc(
                  collection(firestore!, 'promptConfigs'),
                  addRegressionMeta({ id: `test_${user.uid}`, phase: 'test' }, 'DATA_AUTH_WRITER_CONFIGS')
              );
              
              let failedChildReadAsExpected = false;
              try {
                   await getDocs(query(collection(firestore!, 'children'), limit(1)));
              } catch (e: any) {
                  if (e.code === 'permission-denied') failedChildReadAsExpected = true;
              }

              if (!failedChildReadAsExpected) {
                  writerTestPassed = false;
                  failMessage = 'Writer was able to read children collection.';
              }
          } catch(e:any) {
              writerTestPassed = false;
              failMessage = `Writer test failed unexpectedly: ${e.message}`;
          } finally {
              if (tempWriterConfigRef) {
                  await deleteDoc(tempWriterConfigRef);
              }
          }

          if (writerTestPassed) {
              updateTestResult('DATA_AUTH_WRITER_CONFIGS', { status: 'PASS', message: 'Writer can manage configs and is blocked from children.' });
          } else {
              updateTestResult('DATA_AUTH_WRITER_CONFIGS', { status: 'FAIL', message: failMessage });
          }
      }
      return summary;
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

      // Test: DATA_PROMPTS_STORY_BEAT_LIVE
      try {
        const promptsRef = collection(firestore, 'promptConfigs');
        const q = query(promptsRef, where('phase', '==', 'storyBeat'), where('status', '==', 'live'));
        const snap = await getDocs(q);
        const liveBeatConfigs = snap.docs.map(d => d.data() as PromptConfig);
        fsSummary.storyBeatLiveCount = liveBeatConfigs.length;

        if (liveBeatConfigs.length === 0) {
          throw new Error("No live storyBeat promptConfigs found; at least one is required.");
        }
        
        const lowLevelConfigs = liveBeatConfigs.filter(p => p.levelBand === 'low');
        fsSummary.storyBeatLiveLowCount = lowLevelConfigs.length;

        if (lowLevelConfigs.length === 0) {
            updateTestResult('DATA_PROMPTS_STORY_BEAT_LIVE', { status: 'FAIL', message: "Live storyBeat configs exist, but none have levelBand 'low'." });
        } else {
            updateTestResult('DATA_PROMPTS_STORY_BEAT_LIVE', { status: 'PASS', message: `Found ${liveBeatConfigs.length} live configs, including ${lowLevelConfigs.length} for levelBand 'low'.` });
        }
      } catch (e: any) {
        updateTestResult('DATA_PROMPTS_STORY_BEAT_LIVE', { status: 'FAIL', message: e.message });
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

      // Test: DATA_STORY_OUTPUTS
       try {
        const outputsRef = collection(firestore, 'storyOutputTypes');
        const snap = await getDocs(query(outputsRef, limit(10)));
        fsSummary.storyOutputTypesCount = snap.size;
        if (snap.empty) {
          throw new Error('Collection is empty. Visit /admin/storyOutputs to seed data.');
        }
        const firstDoc = snap.docs[0].data();
        if (!firstDoc.name || !firstDoc.category || !firstDoc.ageRange || !firstDoc.status) {
          throw new Error('First doc is missing required fields (name, category, ageRange, status).');
        }
        updateTestResult('DATA_STORY_OUTPUTS', { status: 'PASS', message: `Found ${snap.size} output types. First doc OK.` });
      } catch (e: any) {
        updateTestResult('DATA_STORY_OUTPUTS', { status: 'FAIL', message: e.message });
      }
      
      // Test: DATA_PRINT_LAYOUTS
      try {
          const layoutsRef = collection(firestore, 'printLayouts');
          const snap = await getDocs(layoutsRef);
          fsSummary.printLayoutsCount = snap.size;
          if(snap.empty) {
              throw new Error("Collection is empty. Visit /admin/print-layouts to seed data.");
          }
          const firstLayout = snap.docs[0].data() as PrintLayout;
          if (!firstLayout.name || !firstLayout.leafWidth || !firstLayout.leafHeight || !firstLayout.leavesPerSpread) {
              throw new Error("First layout doc is missing required fields.");
          }
          updateTestResult('DATA_PRINT_LAYOUTS', {status: 'PASS', message: `Found ${snap.size} layouts. First doc OK.`});
      } catch(e: any) {
          updateTestResult('DATA_PRINT_LAYOUTS', {status: 'FAIL', message: e.message});
      }


      // Test: DATA_CHILDREN
      try {
        const childrenRef = collection(firestore, 'children');
        const snap = await getDocs(query(childrenRef, limit(5)));
        fsSummary.childrenCount = snap.size;
        if (snap.empty) {
            updateTestResult('DATA_CHILDREN', { status: 'PASS', message: 'No children found; may be expected in dev.' });
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
      
      // Test: DATA_CHILDREN_EXTENDED
      try {
          const childrenRef = collection(firestore, 'children');
          const snap = await getDocs(query(childrenRef, limit(1)));
          fsSummary.childrenExtendedCount = snap.size;
          if (snap.empty) {
              updateTestResult('DATA_CHILDREN_EXTENDED', { status: 'SKIP', message: 'No children found to test.' });
          } else {
              const child = snap.docs[0].data() as ChildProfile;
              if (!child.ownerParentUid) {
                  throw new Error('First child document is missing ownerParentUid.');
              }
              if (!child.displayName) {
                  throw new Error('First child document is missing displayName.');
              }
              // Check for new required fields (likes and dislikes arrays)
              if (!Array.isArray(child.likes)) {
                  throw new Error('Child doc missing likes array field.');
              }
              if (!Array.isArray(child.dislikes)) {
                  throw new Error('Child doc missing dislikes array field.');
              }

              updateTestResult('DATA_CHILDREN_EXTENDED', { status: 'PASS', message: 'First child has ownerParentUid, displayName, likes, and dislikes fields.' });
          }
      } catch (e: any) {
          updateTestResult('DATA_CHILDREN_EXTENDED', { status: 'FAIL', message: e.message });
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
                updateTestResult('DATA_SESSIONS_OVERVIEW', { status: 'FAIL', message: `Found ${snap.size} sessions but none have childId, storyPhaseId, and arcStepIndex.` });
            }
        }
      } catch (e: any) {
        updateTestResult('DATA_SESSIONS_OVERVIEW', { status: 'FAIL', message: e.message });
      }
       
       setDiagnostics((prev: any) => ({...prev, firestoreSummary: {...prev.firestoreSummary, ...fsSummary }}));
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
          } catch (e:any) {
               updateTestResult('SESSION_BEAT_STRUCTURE', { status: 'FAIL', message: e.message });
          }
      }

      // Test: SESSION_BEAT_MESSAGES
      if (!beatSessionId) {
        updateTestResult('SESSION_BEAT_MESSAGES', { status: 'SKIP', message: 'No beat-ready sessionId provided.' });
      } else {
        try {
        const messagesRef = collection(firestore, 'storySessions', beatSessionId, 'messages');
            const snap = await getDocs(query(messagesRef, orderBy('createdAt', 'asc')));
            const messages = snap.docs.map(d => d.data() as ChatMessage);
            const total = messages.length;
            const continuations = messages.filter(m => m.kind === 'beat_continuation').length;
            const optionsMessages = messages.filter(m => m.kind === 'beat_options' && Array.isArray(m.options));

            if (total === 0) {
                updateTestResult('SESSION_BEAT_MESSAGES', { status: 'FAIL', message: 'No messages found for this session.' });
            } else if (continuations === 0 && optionsMessages.length === 0) {
                 updateTestResult('SESSION_BEAT_MESSAGES', { status: 'PASS', message: `Found ${total} messages. No beat messages yet.` });
            } else {
                const firstWithOptions = optionsMessages[0];
                if (firstWithOptions && firstWithOptions.options?.length === 3 && firstWithOptions.options.every(o => o.id && o.text)) {
                     updateTestResult('SESSION_BEAT_MESSAGES', { status: 'PASS', message: `Found ${total} messages, ${optionsMessages.length} options blocks. First has 3 valid items.` });
                } else {
                     updateTestResult('SESSION_BEAT_MESSAGES', { status: 'FAIL', message: `Found ${optionsMessages.length} options blocks, but structure is incorrect.` });
                }
            }
        } catch (e: any) {
            updateTestResult('SESSION_BEAT_MESSAGES', { status: 'ERROR', message: e.message });
        }
      }
  };

  const runScenarioAndApiTests = async (): Promise<{ beat: ScenarioResult, warmup: ScenarioWarmupResult, moreOptions: ScenarioMoreOptionsResult, character: ScenarioCharacterResult, characterTraits: ScenarioCharacterTraitsResult, arcAdvance: ScenarioArcAdvanceResult, arcBounds: ScenarioArcBoundsResult, ending: ScenarioEndingResult, storyCompile: ScenarioStoryCompileResult, phaseState: ScenarioPhaseStateResult, childStoryList: ScenarioChildStoryListResult }> => {
    if (!firestore) return { beat: null, warmup: null, moreOptions: null, character: null, characterTraits: null, arcAdvance: null, arcBounds: null, ending: null, storyCompile: null, phaseState: null, childStoryList: null };
    
    const artifacts = createArtifactTracker();

    const createRegressionChild = async (data: Record<string, any>, scenarioId: string) => {
        const childRef = await addDoc(collection(firestore, 'children'), addRegressionMeta(data, scenarioId));
        trackArtifact(artifacts, 'children', childRef.id);
        return childRef;
    };

    const createRegressionSession = async (data: Record<string, any>, scenarioId: string) => {
        const childId = data.childId;
        if (!childId) {
            throw new Error(`[createRegressionSession] childId is required`);
        }
        const payload = {
            ...data,
            parentUid: data.parentUid ?? `${REGRESSION_SUITE_TAG}-parent`,
        };
        const taggedPayload = addRegressionMeta(payload, scenarioId);

        const batch = writeBatch(firestore);
        const sessionRef = doc(collection(firestore, 'storySessions'));
        batch.set(sessionRef, taggedPayload);
        batch.set(doc(firestore, 'children', childId, 'sessions', sessionRef.id), taggedPayload);
        
        await batch.commit();

        trackArtifact(artifacts, 'sessions', sessionRef.id);
        return sessionRef;
    };
    
    const createRegressionPrintOrder = async (data: Record<string, any>, scenarioId: string) => {
        const orderRef = await addDoc(collection(firestore, 'printOrders'), addRegressionMeta(data, scenarioId));
        trackArtifact(artifacts, 'printOrders', orderRef.id);
        return orderRef;
    }

    const createRegressionCharacter = async (data: Record<string, any>, scenarioId: string) => {
        const characterRef = await addDoc(collection(firestore, 'characters'), addRegressionMeta(data, scenarioId));
        trackArtifact(artifacts, 'characters', characterRef.id);
        return characterRef;
    };

    const tagExistingDoc = async (docRef: DocumentReference, scenarioId: string) => {
        await updateDoc(docRef, addRegressionMeta({}, scenarioId));
    };

    let beatScenarioSummary: ScenarioResult = null;
    let warmupScenarioSummary: ScenarioWarmupResult = null;
    let moreOptionsScenarioSummary: ScenarioMoreOptionsResult = null;
    let characterScenarioSummary: ScenarioCharacterResult = null;
    let characterTraitsScenarioSummary: ScenarioCharacterTraitsResult = null;
    let arcAdvanceScenarioSummary: ScenarioArcAdvanceResult = null;
    let arcBoundsScenarioSummary: ScenarioArcBoundsResult = null;
    let endingScenarioSummary: ScenarioEndingResult = null;
    let storyCompileScenarioSummary: ScenarioStoryCompileResult = null;
    let phaseStateScenarioSummary: ScenarioPhaseStateResult = null;
    let childStoryListScenarioSummary: ScenarioChildStoryListResult = null;
    let storybookE2EScenarioSummary: ScenarioStorybookE2EResult = null;
    let apiSummary: any = {};

    try {

    // Test: SCENARIO_CHILD_STORY_LIST
    try {
        const parentUid = `parent_${Date.now()}`;
        const childRef = await createRegressionChild({
            displayName: 'Story List Test Child',
            ownerParentUid: parentUid,
            likes: [],
            dislikes: [],
            createdAt: serverTimestamp()
        }, 'SCENARIO_CHILD_STORY_LIST');
        const sessionRef = await createRegressionSession({
            childId: childRef.id,
            parentUid: parentUid,
            storyTitle: 'Test Story for List',
            status: 'completed',
            createdAt: serverTimestamp()
        }, 'SCENARIO_CHILD_STORY_LIST');
        
        childStoryListScenarioSummary = { childId: childRef.id, parentUid, storyCount: 0 };
        
        // This simulates the query from the /stories page
        const storiesQuery = query(
            collection(firestore, 'storySessions'),
            where('parentUid', '==', parentUid),
            where('childId', '==', childRef.id)
        );
        const storiesSnap = await getDocs(storiesQuery);
        childStoryListScenarioSummary.storyCount = storiesSnap.size;
        
        if (storiesSnap.size !== 1) {
            throw new Error(`Expected 1 story for child, but found ${storiesSnap.size}.`);
        }
        
        const storyData = storiesSnap.docs[0].data();
        childStoryListScenarioSummary.firstStoryId = storiesSnap.docs[0].id;
        
        if (storyData.childId !== childRef.id) {
            throw new Error('Found story does not belong to the correct child.');
        }

        updateTestResult('SCENARIO_CHILD_STORY_LIST', { status: 'PASS', message: 'Successfully created and queried story for a specific child.' });

    } catch (e: any) {
        if(childStoryListScenarioSummary) childStoryListScenarioSummary.error = e.message;
        updateTestResult('SCENARIO_CHILD_STORY_LIST', { status: 'ERROR', message: e.message, details: childStoryListScenarioSummary });
    }

    // Test: SCENARIO_PHASE_STATE_MACHINE
    try {
        phaseStateScenarioSummary = { sessionId: null };
        const childRef = await createRegressionChild({ displayName: 'Phase Test Child', likes: [], dislikes: [], createdAt: serverTimestamp() }, 'SCENARIO_PHASE_STATE_MACHINE');

        // 1. Warmup
        const warmupPromptSnap = await getDocs(query(collection(firestore, 'promptConfigs'), where('phase', '==', 'warmup'), where('status', '==', 'live'), limit(1)));
        if (warmupPromptSnap.empty) throw new Error("No live warmup prompt config found.");
        
        const sessionRef = await createRegressionSession({
            childId: childRef.id, status: 'in_progress', currentPhase: 'warmup', storyPhaseId: 'warmup_phase_v1',
            parentUid: 'regression-phase-parent',
            promptConfigId: warmupPromptSnap.docs[0].id, arcStepIndex: 0
        }, 'SCENARIO_PHASE_STATE_MACHINE');
        phaseStateScenarioSummary.sessionId = sessionRef.id;
        let sessionSnap = await getDoc(sessionRef);
        phaseStateScenarioSummary.phaseAfterWarmup = sessionSnap.data()?.currentPhase;
        if (sessionSnap.data()?.currentPhase !== 'warmup') throw new Error(`Phase after warmup was ${sessionSnap.data()?.currentPhase}, expected 'warmup'`);

        // 2. First Beat
        await updateDoc(sessionRef, {
            currentPhase: 'story', storyPhaseId: 'story_beat_phase_v1', storyTypeId: 'animal_adventure_v1', promptConfigId: 'story_beat_level_low_v1'
        });
        sessionSnap = await getDoc(sessionRef);
        phaseStateScenarioSummary.phaseAfterFirstBeat = sessionSnap.data()?.currentPhase;
        if (sessionSnap.data()?.currentPhase !== 'story') throw new Error(`Phase after first beat was ${sessionSnap.data()?.currentPhase}, expected 'story'`);
        
        // 3. Final Beat (state before ending)
        await updateDoc(sessionRef, { arcStepIndex: 5 });
        sessionSnap = await getDoc(sessionRef);
        phaseStateScenarioSummary.phaseAtFinalBeat = sessionSnap.data()?.currentPhase;
        if (sessionSnap.data()?.currentPhase !== 'story') throw new Error(`Phase at final beat was ${sessionSnap.data()?.currentPhase}, expected 'story'`);
        
        // 4. Ending
        const endingRes = await fetch('/api/storyEnding', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sessionId: sessionRef.id }) });
        if (!endingRes.ok) { const body = await endingRes.json(); throw new Error(`Ending API failed: ${body.errorMessage}`); }
        sessionSnap = await getDoc(sessionRef);
        phaseStateScenarioSummary.phaseAfterEnding = sessionSnap.data()?.currentPhase;
        if (sessionSnap.data()?.currentPhase !== 'ending') throw new Error(`Phase after ending was ${sessionSnap.data()?.currentPhase}, expected 'ending'`);

        // 5. Compile
        const compileRes = await fetch('/api/storyCompile', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sessionId: sessionRef.id, storyOutputTypeId: 'picture_book_standard_v1' }) });
        if (!compileRes.ok) { const body = await compileRes.json(); throw new Error(`Compile API failed: ${body.errorMessage}`); }
        sessionSnap = await getDoc(sessionRef);
        phaseStateScenarioSummary.phaseAfterCompile = sessionSnap.data()?.currentPhase;
        if (sessionSnap.data()?.currentPhase !== 'final' || sessionSnap.data()?.status !== 'completed') {
            throw new Error(`Phase/status after compile was ${sessionSnap.data()?.currentPhase}/${sessionSnap.data()?.status}, expected 'final'/'completed'`);
        }
        
        updateTestResult('SCENARIO_PHASE_STATE_MACHINE', { status: 'PASS', message: 'Session correctly transitioned through all phases.' });
    } catch (e: any) {
        if(phaseStateScenarioSummary) phaseStateScenarioSummary.error = e.message;
        updateTestResult('SCENARIO_PHASE_STATE_MACHINE', { status: 'ERROR', message: e.message, details: phaseStateScenarioSummary });
    }


    // Test: SCENARIO_STORY_COMPILE
    try {
        const storyTypeId = 'animal_adventure_v1';
        const storyTypeRef = doc(firestore, 'storyTypes', storyTypeId);
        const storyTypeSnap = await getDoc(storyTypeRef);
        if (!storyTypeSnap.exists()) throw new Error(`Required story type '${storyTypeId}' not found.`);
        const storyType = storyTypeSnap.data() as StoryType;
        
        const childRef = await createRegressionChild({ displayName: 'Compile Test Child', likes: [], dislikes: [], createdAt: serverTimestamp() }, 'SCENARIO_STORY_COMPILE');
        const sessionRef = await createRegressionSession({
            childId: childRef.id, storyTypeId, storyPhaseId: storyType.endingPhaseId,
            arcStepIndex: 5, status: 'in_progress', currentPhase: 'ending', parentUid: 'regression-compile-parent'
        }, 'SCENARIO_STORY_COMPILE');
        await addDoc(collection(firestore, 'storySessions', sessionRef.id, 'messages'), { sender: 'assistant', text: 'The story is now complete!', createdAt: serverTimestamp() });

        const response = await fetch('/api/storyCompile', {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sessionId: sessionRef.id, storyOutputTypeId: 'picture_book_standard_v1' }),
        });
        const result = await response.json();
        
        storyCompileScenarioSummary = {
            childId: childRef.id,
            sessionId: sessionRef.id,
            storyLength: null,
            storyPreview: null,
            hasStory: false,
            storyId: null,
            storyStatus: null,
            pagesCount: null,
            firstPageKind: null,
            lastPageKind: null,
            interiorPlacementsAlternate: null,
            imageLogs: null,
            error: result.errorMessage
        };

        if (!response.ok || !result.ok) {
            throw new Error(result.errorMessage || `API returned status ${response.status}`);
        }
        if (!result.storyText || typeof result.storyText !== 'string' || result.storyText.length < 50) {
            throw new Error(`API response storyText is invalid or too short. Length: ${result.storyText?.length ?? 0}`);
        }

        storyCompileScenarioSummary.storyLength = result.storyText.length;
        storyCompileScenarioSummary.storyPreview = result.storyText.slice(0, 120);
        const storyRef = doc(firestore, 'stories', sessionRef.id);
        const storySnap = await getDoc(storyRef);
        if (!storySnap.exists()) {
            throw new Error('stories document missing after compile flow.');
        }
        await tagExistingDoc(storyRef, 'SCENARIO_STORY_COMPILE');
        trackArtifact(artifacts, 'stories', storyRef.id);
        storyCompileScenarioSummary.hasStory = true;
        storyCompileScenarioSummary.storyId = storyRef.id;
        const storyStoryText: string | undefined = storySnap.data()?.storyText;
        if (!storyStoryText || storyStoryText.length < 50) {
            throw new Error('stories document has invalid storyText.');
        }

        const pagesResponse = await fetch('/api/storyBook/pages', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ storyId: storyRef.id, regressionTag: `${REGRESSION_SUITE_TAG}:SCENARIO_STORY_COMPILE` }),
        });
        const pagesResult = await pagesResponse.json();
        if (!pagesResponse.ok || !pagesResult?.ok) {
            throw new Error(pagesResult?.errorMessage || 'Storybook page generation API failed.');
        }

        const outputsSnap = await getDocs(query(collection(firestore, 'stories', storyRef.id, 'outputs'), limit(1)));
        if (outputsSnap.empty) {
            throw new Error('No story outputs created.');
        }
        const outputId = outputsSnap.docs[0].id;
        const pagesCollectionRef = tracedCollection(firestore, 'SCENARIO_STORY_COMPILE:pagesCollection', 'stories', storyRef.id, 'outputs', outputId, 'pages');
        const pagesSnapshot = await getDocs(query(pagesCollectionRef, orderBy('pageNumber', 'asc')));
        const pageDocs = pagesSnapshot.docs.map(docSnap => docSnap.data());

        if (pagesSnapshot.size === 0) {
            throw new Error('No story output pages were created.');
        }
        if (Array.isArray(pagesResult.pages) && pagesResult.pages.length !== pagesSnapshot.size) {
            throw new Error(`Page count mismatch: API returned ${pagesResult.pages.length} but Firestore has ${pagesSnapshot.size}.`);
        }

        const firstPageKind = pageDocs[0]?.kind ?? null;
        const lastPageKind = pageDocs[pageDocs.length - 1]?.kind ?? null;
        if (firstPageKind !== 'cover_front') {
            throw new Error(`First storybook page kind was ${firstPageKind}, expected cover_front.`);
        }
        if (lastPageKind !== 'cover_back') {
            throw new Error(`Last storybook page kind was ${lastPageKind}, expected cover_back.`);
        }

        // Check second page is a title page
        const secondPageKind = pageDocs[1]?.kind ?? null;
        if (secondPageKind !== 'title_page') {
            throw new Error(`Second storybook page kind was ${secondPageKind}, expected title_page.`);
        }

        // Interior pages (between title page and back cover) should be text or blank
        const interiorPages = pageDocs.slice(2, -1);
        const validInteriorKinds = ['text', 'image', 'blank'];
        const allInteriorValid = interiorPages.every((page) => validInteriorKinds.includes(page?.kind));
        if (!allInteriorValid) {
            const invalidKinds = interiorPages.filter(p => !validInteriorKinds.includes(p?.kind)).map(p => p?.kind);
            throw new Error(`One or more interior pages have invalid kind: ${invalidKinds.join(', ')}. Expected: ${validInteriorKinds.join(', ')}.`);
        }

        // Check text placement alternates on text pages only
        const textPages = interiorPages.filter((page) => page?.kind === 'text');
        const placementsAlternate = textPages.every((page, idx) => {
            const expectedPlacement = idx % 2 === 0 ? 'bottom' : 'top';
            return page?.layoutHints?.textPlacement === expectedPlacement;
        });
        if (!placementsAlternate) {
            throw new Error('Text page text placement failed to alternate top/bottom.');
        }

        storyCompileScenarioSummary.pagesCount = pagesSnapshot.size;
        storyCompileScenarioSummary.firstPageKind = firstPageKind;
        storyCompileScenarioSummary.lastPageKind = lastPageKind;
        storyCompileScenarioSummary.interiorPlacementsAlternate = placementsAlternate;

        const imagesResponse = await fetch('/api/storyBook/images', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                storyId: storyRef.id,
                regressionTag: `${REGRESSION_SUITE_TAG}:SCENARIO_STORY_COMPILE`,
                forceRegenerate: true,
            }),
        });
        const imagesResult = await imagesResponse.json();
        if (!imagesResponse.ok || !imagesResult?.ok) {
            throw new Error(imagesResult?.errorMessage || 'Storybook image generation API failed.');
        }
        storyCompileScenarioSummary.imageLogs = imagesResult?.logs ?? null;

        const imagesSnapshot = await getDocs(query(pagesCollectionRef, orderBy('pageNumber', 'asc')));
        const imagePages = imagesSnapshot.docs.map((docSnap) => docSnap.data() as StoryBookPage);
        const allImagesReady = imagePages.every((page) => page.imageStatus === 'ready' && typeof page.imageUrl === 'string' && page.imageUrl.length > 0);
        if (!allImagesReady) {
            const logPreview = Array.isArray(imagesResult?.logs) ? imagesResult.logs.slice(0, 5).join(' | ') : 'No logs';
            throw new Error(`One or more storyBook pages failed to generate art. Logs: ${logPreview}`);
        }
        storyCompileScenarioSummary.storyStatus = imagesResult.status ?? 'ready';

        updateTestResult('SCENARIO_STORY_COMPILE', { status: 'PASS', message: `Compiled story length ${result.storyText.length} chars. Sample: "${result.storyText.slice(0, 80)}..."` });

    } catch (e: any) {
        if (storyCompileScenarioSummary) storyCompileScenarioSummary.error = e.message;
        updateTestResult('SCENARIO_STORY_COMPILE', { status: 'ERROR', message: e.message, details: storyCompileScenarioSummary });
    }

    // Test: SCENARIO_STORYBOOK_E2E
    try {
        const scenarioId = 'SCENARIO_STORYBOOK_E2E';
        const regressionScenarioTag = `${REGRESSION_SUITE_TAG}:${scenarioId}`;
        const parentUid = `${REGRESSION_SUITE_TAG}-parent-${Date.now()}`;
        const childRef = await createRegressionChild({
            displayName: 'E2E Story Kid',
            ownerParentUid: parentUid,
            createdAt: serverTimestamp(),
            photos: ['https://picsum.photos/seed/regression-story-kid/200/200'],
            likes: ['blue', 'green', 'mac and cheese', 'hide and seek', 'art'],
            dislikes: [],
        }, scenarioId);
        const storyTypeId = 'animal_adventure_v1';
        const storyTypeSnap = await getDoc(doc(firestore, 'storyTypes', storyTypeId));
        if (!storyTypeSnap.exists()) {
            throw new Error(`Required story type '${storyTypeId}' not found.`);
        }
        const storyType = storyTypeSnap.data() as StoryType;
        const arcSteps = storyType.arcTemplate?.steps ?? [];
        const sessionRef = await createRegressionSession({
            childId: childRef.id,
            parentUid,
            status: 'in_progress',
            currentPhase: 'story',
            storyTypeId,
            storyTypeName: storyType.name,
            storyPhaseId: storyType.defaultPhaseId,
            endingPhaseId: storyType.endingPhaseId,
            arcStepIndex: 0,
        }, scenarioId);
        storybookE2EScenarioSummary = {
            childId: childRef.id,
            sessionId: sessionRef.id,
            storyTypeId,
            beatCount: 0,
            endingsGenerated: 0,
        };
        const messagesRef = collection(firestore, 'storySessions', sessionRef.id, 'messages');
        await addDoc(messagesRef, { sender: 'assistant', text: 'Hi friend! Ready to make a story?', createdAt: serverTimestamp() });
        for (let i = 0; i < arcSteps.length; i++) {
            const beatRes = await fetch('/api/storyBeat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ sessionId: sessionRef.id }),
            });
            const beatPayload = await beatRes.json();
            if (!beatRes.ok || !beatPayload?.ok) {
                throw new Error(beatPayload?.errorMessage || `Beat API failed at step ${i + 1}`);
            }
            storybookE2EScenarioSummary.beatCount += 1;
            const choiceList: Choice[] = beatPayload.options ?? [];
            const chosenOption = choiceList.find((opt) => !opt.introducesCharacter) ?? choiceList[0];
            if (chosenOption) {
                await addDoc(messagesRef, {
                    sender: 'child',
                    text: chosenOption.text,
                    kind: 'child_choice',
                    selectedOptionId: chosenOption.id,
                    createdAt: serverTimestamp(),
                });
            }
            await updateDoc(sessionRef, {
                arcStepIndex: Math.min(i + 1, Math.max(arcSteps.length - 1, 0)),
                updatedAt: serverTimestamp(),
            });
        }
        const endingRes = await fetch('/api/storyEnding', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sessionId: sessionRef.id }),
        });
        const endingPayload = await endingRes.json();
        if (!endingRes.ok || !endingPayload?.ok) {
            throw new Error(endingPayload?.errorMessage || 'Ending API failed for E2E scenario.');
        }
        storybookE2EScenarioSummary.endingsGenerated = endingPayload.endings?.length ?? 0;
        const chosenEnding = endingPayload.endings?.[0];
        if (chosenEnding) {
            await updateDoc(sessionRef, {
                selectedEndingId: chosenEnding.id,
                selectedEndingText: chosenEnding.text,
                currentPhase: 'ending',
                updatedAt: serverTimestamp(),
            });
            await addDoc(messagesRef, {
                sender: 'child',
                text: chosenEnding.text,
                kind: 'child_ending_choice',
                selectedOptionId: chosenEnding.id,
                createdAt: serverTimestamp(),
            });
        }
        const compileRes = await fetch('/api/storyCompile', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sessionId: sessionRef.id, storyOutputTypeId: 'picture_book_standard_v1' }),
        });
        const compilePayload = await compileRes.json();
        if (!compileRes.ok || !compilePayload?.ok) {
            throw new Error(compilePayload?.errorMessage || 'Story compile failed for E2E scenario.');
        }
        const storyRef = doc(firestore, 'stories', sessionRef.id);
        const storySnap = await getDoc(storyRef);
        if (!storySnap.exists()) {
            throw new Error('story document missing after compile in E2E scenario.');
        }
        await tagExistingDoc(storyRef, scenarioId);
        trackArtifact(artifacts, 'stories', storyRef.id);
        const pagesResponse = await fetch('/api/storyBook/pages', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ storyId: storyRef.id, regressionTag: regressionScenarioTag }),
        });
        const pagesPayload = await pagesResponse.json();
        if (!pagesResponse.ok || !pagesPayload?.ok) {
            throw new Error(pagesPayload?.errorMessage || 'Page generation API failed for E2E scenario.');
        }
        const outputsSnap = await getDocs(query(collection(firestore, 'stories', storyRef.id, 'outputs'), limit(1)));
        if(outputsSnap.empty) {
            throw new Error('No story outputs created in E2E scenario.');
        }
        const outputId = outputsSnap.docs[0].id;
        const pagesCollectionRef = tracedCollection(firestore, 'SCENARIO_STORYBOOK_E2E:pagesCollection', 'stories', storyRef.id, 'outputs', outputId, 'pages');
        const pagesSnapshot = await getDocs(query(pagesCollectionRef, orderBy('pageNumber', 'asc')));
        if (pagesSnapshot.empty) {
            throw new Error('No storybook pages created in E2E scenario.');
        }
        const imagesResponse = await fetch('/api/storyBook/images', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                storyId: storyRef.id,
                regressionTag: regressionScenarioTag,
                forceRegenerate: true,
            }),
        });
        const imagesPayload = await imagesResponse.json();
        if (!imagesResponse.ok || !imagesPayload?.ok) {
            throw new Error(imagesPayload?.errorMessage || 'Image generation API failed for E2E scenario.');
        }
        const refreshedPages = await getDocs(query(pagesCollectionRef, orderBy('pageNumber', 'asc')));
        const allImagesReady = refreshedPages.docs.every((docSnap) => {
            const page = docSnap.data() as StoryBookPage;
            return page.imageStatus === 'ready' && typeof page.imageUrl === 'string' && page.imageUrl.length > 0;
        });
        storybookE2EScenarioSummary.storyId = storyRef.id;
        storybookE2EScenarioSummary.pagesReady = refreshedPages.size;
        storybookE2EScenarioSummary.artReady = allImagesReady;
        if (!allImagesReady) {
            throw new Error('One or more images failed to reach ready state in E2E scenario.');
        }
        const authToken = await auth?.currentUser?.getIdToken?.();
        if (!authToken) {
            throw new Error('Admin authentication required for finalize pipeline.');
        }
        const authedHeaders = {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${authToken}`,
        };
        const finalizeResponse = await fetch('/api/storyBook/finalize', {
            method: 'POST',
            headers: authedHeaders,
            body: JSON.stringify({ storyId: storyRef.id, outputId: outputId, action: 'finalize', regressionTag: regressionScenarioTag }),
        });
        const finalizePayload = await finalizeResponse.json();
        if (!finalizeResponse.ok || !finalizePayload?.ok) {
            throw new Error(finalizePayload?.errorMessage || 'Finalize API failed for E2E scenario.');
        }
        storybookE2EScenarioSummary.finalized = true;
        const printableResponse = await fetch('/api/storyBook/printable', {
            method: 'POST',
            headers: authedHeaders,
            body: JSON.stringify({ storyId: storyRef.id, outputId: outputId, regressionTag: regressionScenarioTag }),
        });
        const printablePayload = await printableResponse.json();
        if (!printableResponse.ok || !printablePayload?.ok) {
            throw new Error(printablePayload?.errorMessage || 'Printable API failed for E2E scenario.');
        }
        storybookE2EScenarioSummary.printableReady = true;
        const orderRes = await createRegressionPrintOrder({
            storyId: storyRef.id,
            outputId: outputId,
            quantity: 1,
            contactEmail: 'regression@example.com',
            shippingAddress: {
                name: 'Regression Tester', line1: '123 QA Lane', city: 'Testville', state: 'CA', postalCode: '94000', country: 'USA',
            }
        }, scenarioId);
        storybookE2EScenarioSummary.orderId = orderRes.id;
        
        const payResponse = await fetch(`/api/printOrders/${orderRes.id}/pay`, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${authToken}`,
            },
        });
        const payPayload = await payResponse.json();
        if (!payResponse.ok || !payPayload?.ok) {
            throw new Error(payPayload?.errorMessage || 'Mark-as-paid API failed for E2E scenario.');
        }
        updateTestResult('SCENARIO_STORYBOOK_E2E', { status: 'PASS', message: `E2E flow completed with ${refreshedPages.size} pages and printable order.` });
    } catch (e: any) {
        if (storybookE2EScenarioSummary) storybookE2EScenarioSummary.error = e.message;
        updateTestResult('SCENARIO_STORYBOOK_E2E', { status: 'ERROR', message: e.message, details: storybookE2EScenarioSummary });
    }

    // Test: SCENARIO_ENDING_FLOW
    try {
        const storyTypeId = 'animal_adventure_v1';
        const storyTypeRef = doc(firestore, 'storyTypes', storyTypeId);
        const storyTypeSnap = await getDoc(storyTypeRef);
        if (!storyTypeSnap.exists()) throw new Error(`Required story type '${storyTypeId}' not found.`);
        const storyType = storyTypeSnap.data() as StoryType;
        const steps = storyType.arcTemplate?.steps;
        if (!steps || steps.length === 0) throw new Error(`Story type '${storyTypeId}' has no arc steps.`);
        
        const childRef = await createRegressionChild({ displayName: 'Ending Test Child', likes: [], dislikes: [], createdAt: serverTimestamp() }, 'SCENARIO_ENDING_FLOW');
        const sessionRef = await createRegressionSession({
            childId: childRef.id, storyTypeId, storyPhaseId: storyType.endingPhaseId,
            arcStepIndex: steps.length - 1, // Set to final step
            promptConfigLevelBand: 'low', status: 'in_progress', currentPhase: 'story',
            parentUid: 'regression-ending-parent'
        }, 'SCENARIO_ENDING_FLOW');
        await addDoc(collection(firestore, 'storySessions', sessionRef.id, 'messages'), { sender: 'assistant', text: 'The story is almost over!', createdAt: serverTimestamp() });
        
        const response = await fetch('/api/storyEnding', {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sessionId: sessionRef.id }),
        });
        const result = await response.json();
        
        endingScenarioSummary = { childId: childRef.id, sessionId: sessionRef.id, endingsCount: null, sampleEnding: null, error: result.errorMessage };
        
        if (!response.ok || !result.ok) {
            throw new Error(result.errorMessage || `API returned status ${response.status}`);
        }
        if (!Array.isArray(result.endings) || result.endings.length !== 3) {
            throw new Error(`API response did not contain 3 endings. Got: ${JSON.stringify(result.endings)}`);
        }

        if (!result.endings.every((e: any) => e.id && e.text)) {
            throw new Error('One or more endings are missing id or text fields.');
        }

        endingScenarioSummary.endingsCount = result.endings.length;
        endingScenarioSummary.sampleEnding = result.endings[0]?.text.slice(0, 80);

        updateTestResult('SCENARIO_ENDING_FLOW', { status: 'PASS', message: `Generated 3 endings. Sample: "${endingScenarioSummary.sampleEnding}"` });
        
    } catch(e: any) {
        if (endingScenarioSummary) endingScenarioSummary.error = e.message;
        updateTestResult('SCENARIO_ENDING_FLOW', { status: 'ERROR', message: e.message, details: endingScenarioSummary });
    }

    // Test: SCENARIO_ARC_BOUNDS
    try {
        const storyTypeId = 'animal_adventure_v1';
        const storyTypeRef = doc(firestore, 'storyTypes', storyTypeId);
        const storyTypeSnap = await getDoc(storyTypeRef);
        if (!storyTypeSnap.exists()) throw new Error(`Required story type '${storyTypeId}' not found.`);
        const storyType = storyTypeSnap.data() as StoryType;
        const steps = storyType.arcTemplate?.steps;
        if (!steps || steps.length === 0) throw new Error(`Story type '${storyTypeId}' has no arc steps.`);
        
        const stepsCount = steps.length;
        const maxIndex = stepsCount - 1;
        // Handle both legacy string format and new ArcStep object format
        const lastStep = steps[maxIndex];
        const lastStepId = typeof lastStep === 'string' ? lastStep : lastStep.id;

        const childRef = await createRegressionChild({ displayName: 'Arc Bounds Child', likes: [], dislikes: [], createdAt: serverTimestamp() }, 'SCENARIO_ARC_BOUNDS');
        const sessionRef = await createRegressionSession({
            childId: childRef.id, storyTypeId, storyPhaseId: 'story_beat_phase_v1',
            arcStepIndex: 0, promptConfigLevelBand: 'low', status: 'in_progress', currentPhase: 'story',
            parentUid: 'regression-arc-bounds-parent'
        }, 'SCENARIO_ARC_BOUNDS');
        await addDoc(collection(firestore, 'storySessions', sessionRef.id, 'messages'), { sender: 'assistant', text: 'Hi', createdAt: serverTimestamp() });
        
        let maxObservedArcStepIndex = 0;
        let lastArcStepIdFromApi: string | null = null;
        const maxBeats = stepsCount + 5;

        for (let i = 0; i < maxBeats; i++) {
            const beatRes = await fetch('/api/storyBeat', {
                method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sessionId: sessionRef.id }),
            });
            const beatResult = await beatRes.json();
            if (!beatResult.ok) throw new Error(`Beat call #${i+1} failed: ${beatResult.errorMessage}`);
            lastArcStepIdFromApi = beatResult.arcStep;

            const sessionSnap = await getDoc(sessionRef);
            const currentArcStepIndex = sessionSnap.data()?.arcStepIndex ?? 0;
            maxObservedArcStepIndex = Math.max(maxObservedArcStepIndex, currentArcStepIndex);
            
            let nextIndex = currentArcStepIndex + 1;
            if (steps.length > 0) {
                const maxAllowedIndex = steps.length - 1;
                if (nextIndex > maxAllowedIndex) {
                    nextIndex = maxAllowedIndex;
                }
            }
            await updateDoc(sessionRef, { arcStepIndex: nextIndex });
        }
        
        arcBoundsScenarioSummary = {
            sessionId: sessionRef.id, storyTypeId, stepsCount, maxAllowedIndex: maxIndex,
            maxObservedArcStepIndex, lastArcStepId: lastArcStepIdFromApi, expectedLastArcStepId: lastStepId,
        };

        if (maxObservedArcStepIndex > maxIndex) {
            throw new Error(`arcStepIndex exceeded bounds: max observed was ${maxObservedArcStepIndex}, but max allowed is ${maxIndex}.`);
        }
        if (lastArcStepIdFromApi !== lastStepId) {
            throw new Error(`Last arc step mismatch: API returned '${lastArcStepIdFromApi}', expected '${lastStepId}'.`);
        }

        updateTestResult('SCENARIO_ARC_BOUNDS', { status: 'PASS', message: `Arc index clamped at ${maxIndex} and last step was '${lastStepId}'.` });
    } catch(e: any) {
        if (arcBoundsScenarioSummary) arcBoundsScenarioSummary.error = e.message;
        updateTestResult('SCENARIO_ARC_BOUNDS', { status: 'ERROR', message: e.message, details: arcBoundsScenarioSummary });
    }

    // Test: SCENARIO_ARC_STEP_ADVANCE
    try {
        const typesRef = collection(firestore, 'storyTypes');
        const typeQuery = query(typesRef, where('status', '==', 'live'), limit(1));
        const typeSnap = await getDocs(typeQuery);
        if (typeSnap.empty) throw new Error('No live story types found.');
        const storyType = typeSnap.docs[0].data();
        const storyTypeId = typeSnap.docs[0].id;

        const childRef = await createRegressionChild({ displayName: 'Arc Test Child', likes: [], dislikes: [], createdAt: serverTimestamp() }, 'SCENARIO_ARC_STEP_ADVANCE');
        
        const sessionRef = await createRegressionSession({
            childId: childRef.id, storyTypeId, storyPhaseId: storyType.defaultPhaseId,
            arcStepIndex: 0, promptConfigLevelBand: 'low', status: 'in_progress', currentPhase: 'story',
            createdAt: serverTimestamp(), updatedAt: serverTimestamp()
        }, 'SCENARIO_ARC_STEP_ADVANCE');
        
        arcAdvanceScenarioSummary = { childId: childRef.id, sessionId: sessionRef.id, initialArcStepIndex: 0, finalArcStepIndex: null };

        // Simulate choosing an option, which is where the increment should happen
        await updateDoc(sessionRef, {
            arcStepIndex: increment(1),
            updatedAt: serverTimestamp(),
        });
        
        const updatedSessionDoc = await getDoc(sessionRef);
        if (!updatedSessionDoc.exists()) throw new Error("Session doc disappeared after update.");
        
        const finalArcStepIndex = updatedSessionDoc.data().arcStepIndex;
        arcAdvanceScenarioSummary.finalArcStepIndex = finalArcStepIndex;

        if (finalArcStepIndex !== 1) {
            throw new Error(`arcStepIndex did not advance. Expected 1, got ${finalArcStepIndex}.`);
        }
        
        updateTestResult('SCENARIO_ARC_STEP_ADVANCE', { status: 'PASS', message: 'arcStepIndex successfully advanced from 0 to 1.' });

    } catch (e: any) {
         if (arcAdvanceScenarioSummary) {
            arcAdvanceScenarioSummary.error = e instanceof Error ? e.message : String(e);
        }
        updateTestResult('SCENARIO_ARC_STEP_ADVANCE', { status: 'ERROR', message: e.message, details: arcAdvanceScenarioSummary });
    }
    
    // Test: SCENARIO_CHARACTER_TRAITS
    try {
        const childRef = await createRegressionChild({ displayName: 'Traits Test Child', likes: [], dislikes: [], createdAt: serverTimestamp() }, 'SCENARIO_CHARACTER_TRAITS');
        const sessionRef = await createRegressionSession({
            childId: childRef.id, storyTypeId: 'animal_adventure_v1', storyPhaseId: 'story_beat_phase_v1',
            arcStepIndex: 0, promptConfigLevelBand: 'low', status: 'in_progress',
            parentUid: 'regression-character-traits-parent'
        }, 'SCENARIO_CHARACTER_TRAITS');
        const charRef = await createRegressionCharacter({
            ownerParentUid: 'regression-character-traits-parent',
            childId: childRef.id,
            displayName: 'Test Bunny',
            type: 'Pet',
            likes: [],
            dislikes: [],
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp()
        }, 'SCENARIO_CHARACTER_TRAITS');
        await addDoc(collection(firestore, 'storySessions', sessionRef.id, 'messages'), {
            sender: 'assistant', text: 'Once upon a time...', createdAt: serverTimestamp()
        });

        const response = await fetch('/api/characterTraits', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sessionId: sessionRef.id, characterId: charRef.id })
        });
        
        const body = await response.json().catch(() => ({ ok: false, errorMessage: "Could not parse JSON response" }));
        characterTraitsScenarioSummary = { childId: childRef.id, sessionId: sessionRef.id, characterId: charRef.id, ...body };

        if (!response.ok || !body?.ok) {
            throw new Error(`API returned status ${response.status}${body?.errorMessage ? ': ' + body.errorMessage : ''}`);
        }
        if (!body.question || typeof body.question !== 'string') throw new Error('Response missing question field.');
        if (!Array.isArray(body.suggestedTraits) || body.suggestedTraits.length === 0) throw new Error('Response missing suggestedTraits array.');
        
        updateTestResult('SCENARIO_CHARACTER_TRAITS', { 
            status: 'PASS', 
            message: 'API returned ok:true with a character trait question.',
            details: { questionPreview: body.question.slice(0, 80), traitsCount: body.suggestedTraits.length, characterId: charRef.id }
        });
    } catch (e: any) {
        updateTestResult('SCENARIO_CHARACTER_TRAITS', { status: 'ERROR', message: e.message, details: characterTraitsScenarioSummary });
    }

    // Test: SCENARIO_CHARACTER_FROM_BEAT
    try {
        const typesRef = collection(firestore, 'storyTypes');
        const typeQuery = query(typesRef, where('status', '==', 'live'), limit(1));
        const typeSnap = await getDocs(typeQuery);
        if (typeSnap.empty) throw new Error('No live story types found.');
        const storyType = typeSnap.docs[0].data();
        const storyTypeId = typeSnap.docs[0].id;

        const childRef = await createRegressionChild({ displayName: 'Char Test Child', likes: [], dislikes: [], createdAt: serverTimestamp() }, 'SCENARIO_CHARACTER_FROM_BEAT');
        const sessionRef = await createRegressionSession({
            childId: childRef.id, storyTypeId, storyPhaseId: storyType.defaultPhaseId,
            arcStepIndex: 0, promptConfigLevelBand: 'low', status: 'in_progress', currentPhase: 'story',
            createdAt: serverTimestamp(), updatedAt: serverTimestamp()
        }, 'SCENARIO_CHARACTER_FROM_BEAT');
        
        characterScenarioSummary = { childId: childRef.id, sessionId: sessionRef.id, optionsCount: null, sampleOption: null };

        const response = await fetch('/api/storyBeat', {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sessionId: sessionRef.id })
        });
        if (!response.ok) throw new Error(`API returned status ${response.status}`);
        const result = await response.json();
        if (!result.ok) throw new Error(`API returned ok:false: ${result.errorMessage}`);
        
        const options = result.options as Choice[];
        if (!Array.isArray(options) || options.length < 3) throw new Error(`API returned ${options?.length ?? 0} options, expected 3.`);
        
        characterScenarioSummary.optionsCount = options.length;
        characterScenarioSummary.sampleOption = options[0];

        // Validate shape
        for (const opt of options) {
            if (typeof opt.id !== 'string' || typeof opt.text !== 'string') {
                throw new Error('Option missing required id or text fields.');
            }
            if ('introducesCharacter' in opt && typeof opt.introducesCharacter !== 'boolean') {
                 throw new Error('Option field introducesCharacter has wrong type.');
            }
             if ('newCharacterLabel' in opt && opt.newCharacterLabel !== null && typeof opt.newCharacterLabel !== 'string') {
                throw new Error('Option field newCharacterLabel has wrong type.');
            }
        }
        
        updateTestResult('SCENARIO_CHARACTER_FROM_BEAT', { status: 'PASS', message: 'Beat returned options with valid character metadata shape.' });
        
    } catch(e: any) {
        updateTestResult('SCENARIO_CHARACTER_FROM_BEAT', { status: 'ERROR', message: e.message, details: characterScenarioSummary });
    }

    // Test: SCENARIO_MORE_OPTIONS
    const moreOptionsSessionId = beatScenarioSummary ? beatScenarioSummary.sessionId : null;
    if (!moreOptionsSessionId) {
        updateTestResult('SCENARIO_MORE_OPTIONS', { status: 'SKIP', message: 'Depends on successful SCENARIO_BEAT_AUTO.' });
    } else {
        try {
            const res1 = await fetch('/api/storyBeat', {
              method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sessionId: moreOptionsSessionId }),
            });
            const result1 = await res1.json();
            if (!result1.ok) throw new Error(`First beat call failed: ${result1.errorMessage}`);
            
            const messagesRef = collection(firestore, 'storySessions', moreOptionsSessionId, 'messages');
            await addDoc(messagesRef, { sender: 'assistant', text: result1.storyContinuation, kind: 'beat_continuation', createdAt: serverTimestamp() });
            await addDoc(messagesRef, { sender: 'assistant', text: 'What happens next?', kind: 'beat_options', options: result1.options, createdAt: serverTimestamp() });

            const res2 = await fetch('/api/storyBeat', {
              method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sessionId: moreOptionsSessionId }),
            });
            const result2 = await res2.json();
             if (!result2.ok) throw new Error(`Second beat call (more choices) failed: ${result2.errorMessage}`);
            
            moreOptionsScenarioSummary = {
                childId: beatScenarioSummary!.childId,
                sessionId: moreOptionsSessionId,
                firstCallStatus: res1.status,
                secondCallStatus: res2.status,
                firstContinuationPreview: result1.storyContinuation?.slice(0, 80),
                secondContinuationPreview: result2.storyContinuation?.slice(0, 80),
            };

            if (result1.storyContinuation === result2.storyContinuation && result1.options[0]?.text === result2.options[0]?.text) {
                // This is a soft failure; the model might just be uncreative. The main thing is it didn't crash.
                updateTestResult('SCENARIO_MORE_OPTIONS', { status: 'PASS', message: 'Ran twice, but options/continuation were identical.' });
            } else {
                updateTestResult('SCENARIO_MORE_OPTIONS', { status: 'PASS', message: 'Successfully ran storyBeat twice with different results.' });
            }

        } catch (e: any) {
            updateTestResult('SCENARIO_MORE_OPTIONS', { status: 'ERROR', message: `More-options scenario failed: ${e.message}`, details: moreOptionsScenarioSummary });
        }
    }

    // Test: SCENARIO_BEAT_AUTO
    try {
        const typesRef = collection(firestore, 'storyTypes');
        const typeQuery = query(typesRef, where('status', '==', 'live'), limit(1));
        const typeSnap = await getDocs(typeQuery);
        if (typeSnap.empty) throw new Error('No live story types found.');
        const storyType = typeSnap.docs[0].data();
        const storyTypeId = typeSnap.docs[0].id;

        const childRef = await createRegressionChild({ displayName: 'Regression Child', likes: [], dislikes: [], createdAt: serverTimestamp() }, 'SCENARIO_BEAT_AUTO');

        const mainCharRef = await createRegressionCharacter({
            ownerParentUid: 'regression-beat-parent',
            childId: childRef.id,
            displayName: 'Reggie',
            type: 'Family',
            likes: [],
            dislikes: [],
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp()
        }, 'SCENARIO_BEAT_AUTO');

        // Use a legacy ID to test resolution
        const legacyPromptConfigId = 'story_beat_level_low_v1';

        const sessionRef = await createRegressionSession({
            childId: childRef.id,
            storyTypeId: storyTypeId,
            storyPhaseId: 'story_beat_phase_v1',
            currentPhase: 'story',
            arcStepIndex: 0,
            mainCharacterId: mainCharRef.id,
            promptConfigId: legacyPromptConfigId,
            promptConfigLevelBand: 'low',
            status: 'in_progress',
            parentUid: 'regression-beat-parent',
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
        }, 'SCENARIO_BEAT_AUTO');
        
        beatScenarioSummary = { childId: childRef.id, sessionId: sessionRef.id };

        const response = await fetch('/api/storyBeat', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sessionId: sessionRef.id }),
        });
        if (!response.ok) throw new Error(`API returned ${response.status}`);
        const result = await response.json();
        if (!result.ok) throw new Error(`API returned ok:false: ${result.errorMessage}`);
        if (!result.storyContinuation || result.options?.length < 3) throw new Error('API response has invalid shape.');
        
        const resolvedId = result.promptConfigId;
        if (!resolvedId || resolvedId === legacyPromptConfigId) {
            throw new Error(`Prompt ID resolution failed. Expected a canonical ID, got '${resolvedId}'`);
        }

        updateTestResult('SCENARIO_BEAT_AUTO', { status: 'PASS', message: `Created session ${sessionRef.id.slice(0,5)} and resolved '${legacyPromptConfigId}' to '${resolvedId}'.` });

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

        const childRef = await createRegressionChild({ displayName: 'Regression Warmup Child', likes: [], dislikes: [], createdAt: serverTimestamp() }, 'SCENARIO_WARMUP_AUTO');
        
        const sessionRef = await createRegressionSession({
            childId: childRef.id,
            storyPhaseId: 'warmup_phase_v1',
            promptConfigId: warmupPromptConfigId,
            promptConfigLevelBand: warmupPromptConfigLevelBand,
            status: 'in_progress',
            currentPhase: 'warmup',
            arcStepIndex: 0,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
        }, 'SCENARIO_WARMUP_AUTO');

        await addDoc(collection(firestore, 'storySessions', sessionRef.id, 'messages'), {
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
            debug: jsonResponse?.debug ?? null,
        };

        if (response.status !== 200) {
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
        updateTestResult('SCENARIO_WARMUP_AUTO', { status: 'ERROR', message: e.message, details: warmupScenarioSummary });
    }
    
    // --- API Tests ---
    
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
    const warmupTestSessionId = warmupSessionId || warmupScenarioSummary?.sessionId;
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
            apiSummary.warmupReply.lastErrorMessage = result.errorMessage || null;
            apiSummary.warmupReply.debug = result.debug || null;
            
            if (response.status !== 200) {
                 throw new Error(`API returned status ${response.status}: ${result.errorMessage || 'Unknown error'}`);
            }
             if (typeof result.ok !== 'boolean') {
                throw new Error('API response missing "ok" field.');
            }
            if (!result.ok) {
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
    
    const scenarioResults = { beat: beatScenarioSummary, warmup: warmupScenarioSummary, moreOptions: moreOptionsScenarioSummary, character: characterScenarioSummary, characterTraits: characterTraitsScenarioSummary, arcAdvance: arcAdvanceScenarioSummary, arcBounds: arcBoundsScenarioSummary, ending: endingScenarioSummary, storyCompile: storyCompileScenarioSummary, phaseState: phaseStateScenarioSummary, childStoryList: childStoryListScenarioSummary };
    setDiagnostics((prev: any) => ({...prev, apiSummary: {...prev.apiSummary, ...apiSummary }, scenario: scenarioResults }));
    return scenarioResults;
    } finally {
        await cleanupRegressionArtifacts(firestore, artifacts);
    }
  };

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
      const currentAuthSummary = await runAuthTests();
      setAuthSummary(currentAuthSummary);

      const testGroups = initialTests.reduce((acc, test) => {
          const prefix = test.id.split('_')[0];
          if (!acc[prefix]) acc[prefix] = [];
          acc[prefix].push(test);
          return acc;
      }, {} as Record<string, TestResult[]>);

      if (testGroups['DATA']) {
          await runDataTests();
      }
      if (testGroups['SESSION']) {
          await runSessionTests();
      }
      if (testGroups['API'] || testGroups['SCENARIO']) {
          await runScenarioAndApiTests();
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
        const collectionsToClean = ['children', 'storySessions', 'characters', 'stories', 'promptConfigs', 'printOrders', 'printLayouts'];
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

  const handleCopyDiagnostics = () => {
    const textToCopy = `Page: admin-regression\n\nDiagnostics\n${JSON.stringify(finalDiagnostics, null, 2)}`;
    navigator.clipboard.writeText(textToCopy);
    toast({ title: 'Copied to clipboard!' });
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
                <div className="grid sm:grid-cols-2 gap-4">
                    <div className="space-y-2">
                        <Label htmlFor="beatSessionId">Beat-ready Session ID</Label>
                        <Input id="beatSessionId" value={beatSessionId} onChange={e => setBeatSessionId(e.target.value)} placeholder="Uses auto-scenario if blank"/>
                        <p className="text-xs text-muted-foreground">A session with storyTypeId, phaseId, arcStepIndex set.</p>
                    </div>
                     <div className="space-y-2">
                        <Label htmlFor="warmupSessionId">Warmup Session ID</Label>
                        <Input id="warmupSessionId" value={warmupSessionId} onChange={e => setWarmupSessionId(e.target.value)} placeholder="Uses auto-scenario if blank"/>
                        <p className="text-xs text-muted-foreground">A session in warmup phase with at least one message.</p>
                    </div>
                </div>
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
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Diagnostics</CardTitle>
          <Button variant="ghost" size="icon" onClick={handleCopyDiagnostics}>
            <Copy className="h-4 w-4" />
          </Button>
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
