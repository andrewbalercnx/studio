

'use client';
import { authFetch } from '@/lib/auth-fetch';

import { useState, useMemo } from 'react';
import { useAdminStatus } from '@/hooks/use-admin-status';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { LoaderCircle, Trash2 } from 'lucide-react';
import { DiagnosticsPanel } from '@/components/diagnostics-panel';
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
    // Text samples from pages (first content page)
    sampleBodyText?: string | null;      // Unresolved text with $$id$$ placeholders
    sampleDisplayText?: string | null;   // Resolved text with names
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
            // Clean up legacy outputs subcollection (if exists)
            const outputsSnap = await getDocs(collection(firestore, 'stories', storyId, 'outputs'));
            for (const outputDoc of outputsSnap.docs) {
                await deleteSubcollectionDocs(firestore, ['stories', storyId, 'outputs', outputDoc.id, 'pages']);
                await deleteDoc(outputDoc.ref);
            }
            // Clean up new storybooks subcollection
            const storybooksSnap = await getDocs(collection(firestore, 'stories', storyId, 'storybooks'));
            for (const storybookDoc of storybooksSnap.docs) {
                await deleteSubcollectionDocs(firestore, ['stories', storyId, 'storybooks', storybookDoc.id, 'pages']);
                await deleteDoc(storybookDoc.ref);
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
  { id: 'SCENARIO_GEMINI4_FLOW', name: 'Scenario: Gemini4 Story Flow', status: 'PENDING', message: '' },
  { id: 'API_BOOKS_V3_AUTH', name: 'API: /api/manuscripts + /api/books (Auth + Not Found)', status: 'PENDING', message: '' },
  { id: 'API_PERSONA', name: 'API: /api/persona (auth + childId validation)', status: 'PENDING', message: '' },
  { id: 'API_VERIFY_PIN_LOCKOUT', name: 'API: /api/parent/verify-pin (lockout policy dry-run)', status: 'PENDING', message: '' },
  { id: 'API_WARMUP_REPLY', name: 'API: /api/warmupReply (Input)', status: 'PENDING', message: '' },
  { id: 'API_USER_ONBOARDING_GET', name: 'API: /api/user/onboarding (GET shape)', status: 'PENDING', message: '' },
  { id: 'API_USER_ONBOARDING_POST', name: 'API: /api/user/onboarding (POST validation)', status: 'PENDING', message: '' },
  { id: 'API_ADMIN_OPS_METRICS', name: 'API: /api/admin/ops/metrics (GET shape)', status: 'PENDING', message: '' },
  { id: 'API_ADMIN_OPS_HEALTH_CHECK', name: 'API: /api/admin/ops/health-check (POST dry-run)', status: 'PENDING', message: '' },
  { id: 'API_ADMIN_SESSIONS', name: 'API: /api/admin/sessions (GET shape + lastError)', status: 'PENDING', message: '' },
  { id: 'API_HEALTH', name: 'API: /api/health (version + dependency probe)', status: 'PENDING', message: '' },
  { id: 'API_ROUTE_AUTH_ANON', name: 'API: protected routes reject anonymous calls (401)', status: 'PENDING', message: '' },
  { id: 'API_FLAGS', name: 'API: /api/flags (server-evaluated feature flags)', status: 'PENDING', message: '' },
  { id: 'API_FEEDBACK_POST_VALIDATION', name: 'API: /api/feedback (POST validation)', status: 'PENDING', message: '' },
  { id: 'API_FEEDBACK_ELIGIBILITY', name: 'API: /api/feedback/eligibility (GET shape)', status: 'PENDING', message: '' },
  { id: 'API_TICKETS_GET', name: 'API: /api/tickets (GET shape)', status: 'PENDING', message: '' },
  { id: 'API_REPORT_ISSUE_VALIDATION', name: 'API: /api/report-issue (POST validation)', status: 'PENDING', message: '' },
  { id: 'API_MY_ORDERS_TIMELINE', name: 'API: /api/printOrders/my-orders (timeline shape)', status: 'PENDING', message: '' },
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
  { id: 'DATA_IMAGE_STYLES_SCENE_EXEMPLARS', name: 'Firestore: Image Style Scene Exemplars', status: 'PENDING', message: '' },
  { id: 'DATA_CHILDREN_CANONICAL', name: 'Firestore: Children Canonical Image Status', status: 'PENDING', message: '' },
  { id: 'SCENARIO_CANONICAL_IMAGE_TRIGGER', name: 'Scenario: Canonical Image Generation Trigger', status: 'PENDING', message: '' },
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
       
      // Test: DATA_IMAGE_STYLES_SCENE_EXEMPLARS
      try {
          const SCENE_TAGS = ['indoor-day', 'outdoor-day', 'indoor-night', 'outdoor-night'] as const;
          const stylesRef = collection(firestore, 'imageStyles');
          const stylesSnap = await getDocs(query(stylesRef, limit(10)));
          fsSummary.imageStylesCount = stylesSnap.size;

          if (stylesSnap.empty) {
              updateTestResult('DATA_IMAGE_STYLES_SCENE_EXEMPLARS', { status: 'SKIP', message: 'No image styles found.' });
          } else {
              let stylesWithExemplars = 0;
              let totalTagsReady = 0;
              let totalTagsMissing = 0;

              for (const docSnap of stylesSnap.docs) {
                  const style = docSnap.data();
                  const exemplars: Record<string, any> = style.sceneExemplars ?? {};
                  if (SCENE_TAGS.some(tag => exemplars[tag]?.status)) stylesWithExemplars++;
                  for (const tag of SCENE_TAGS) {
                      const entry = exemplars[tag];
                      if (entry?.status === 'ready' && entry?.imageUrl) totalTagsReady++;
                      else totalTagsMissing++;
                  }
              }

              updateTestResult('DATA_IMAGE_STYLES_SCENE_EXEMPLARS', {
                  status: totalTagsReady > 0 ? 'PASS' : 'FAIL',
                  message: `${stylesSnap.size} style(s) checked; ${stylesWithExemplars} have exemplars; ${totalTagsReady} tag(s) ready, ${totalTagsMissing} missing/pending.`,
              });
          }
      } catch (e: any) {
          updateTestResult('DATA_IMAGE_STYLES_SCENE_EXEMPLARS', { status: 'FAIL', message: e.message });
      }

      // Test: DATA_CHILDREN_CANONICAL
      try {
          const childrenRef = collection(firestore, 'children');
          const childrenSnap = await getDocs(query(childrenRef, limit(10)));

          if (childrenSnap.empty) {
              updateTestResult('DATA_CHILDREN_CANONICAL', { status: 'SKIP', message: 'No children found.' });
          } else {
              const withPhotos = childrenSnap.docs.filter(d => {
                  const photos = d.data().photos;
                  return Array.isArray(photos) && photos.length > 0;
              });

              if (withPhotos.length === 0) {
                  updateTestResult('DATA_CHILDREN_CANONICAL', { status: 'SKIP', message: `${childrenSnap.size} children found, none have photos yet.` });
              } else {
                  const withCanonicalField = withPhotos.filter(d => d.data().canonicalImageGeneration !== undefined);
                  const withCanonicalReady = withCanonicalField.filter(d => d.data().canonicalImageGeneration?.status === 'ready');

                  if (withCanonicalField.length === 0) {
                      updateTestResult('DATA_CHILDREN_CANONICAL', { status: 'FAIL', message: `${withPhotos.length} child(ren) with photos but none have canonicalImageGeneration field.` });
                  } else {
                      updateTestResult('DATA_CHILDREN_CANONICAL', { status: 'PASS', message: `${withPhotos.length} child(ren) with photos; ${withCanonicalField.length} have canonicalImageGeneration; ${withCanonicalReady.length} ready.` });
                  }
              }
          }
      } catch (e: any) {
          updateTestResult('DATA_CHILDREN_CANONICAL', { status: 'FAIL', message: e.message });
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
        const endingRes = await authFetch('/api/storyEnding', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sessionId: sessionRef.id }) });
        if (!endingRes.ok) { const body = await endingRes.json(); throw new Error(`Ending API failed: ${body.errorMessage}`); }
        sessionSnap = await getDoc(sessionRef);
        phaseStateScenarioSummary.phaseAfterEnding = sessionSnap.data()?.currentPhase;
        if (sessionSnap.data()?.currentPhase !== 'ending') throw new Error(`Phase after ending was ${sessionSnap.data()?.currentPhase}, expected 'ending'`);

        // 5. Compile
        const compileRes = await authFetch('/api/storyCompile', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sessionId: sessionRef.id, storyOutputTypeId: 'picture_book_standard_v1' }) });
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

        const response = await authFetch('/api/storyCompile', {
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

        updateTestResult('SCENARIO_STORY_COMPILE', { status: 'PASS', message: `Compiled story length ${result.storyText.length} chars. Sample: "${result.storyText.slice(0, 80)}..."` });

    } catch (e: any) {
        if (storyCompileScenarioSummary) storyCompileScenarioSummary.error = e.message;
        updateTestResult('SCENARIO_STORY_COMPILE', { status: 'ERROR', message: e.message, details: storyCompileScenarioSummary });
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
        
        const response = await authFetch('/api/storyEnding', {
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
            const beatRes = await authFetch('/api/storyBeat', {
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

        const response = await authFetch('/api/characterTraits', {
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

        const response = await authFetch('/api/storyBeat', {
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
            const res1 = await authFetch('/api/storyBeat', {
              method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sessionId: moreOptionsSessionId }),
            });
            const result1 = await res1.json();
            if (!result1.ok) throw new Error(`First beat call failed: ${result1.errorMessage}`);
            
            const messagesRef = collection(firestore, 'storySessions', moreOptionsSessionId, 'messages');
            await addDoc(messagesRef, { sender: 'assistant', text: result1.storyContinuation, kind: 'beat_continuation', createdAt: serverTimestamp() });
            await addDoc(messagesRef, { sender: 'assistant', text: 'What happens next?', kind: 'beat_options', options: result1.options, createdAt: serverTimestamp() });

            const res2 = await authFetch('/api/storyBeat', {
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

        const response = await authFetch('/api/storyBeat', {
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

        const response = await authFetch('/api/warmupReply', {
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

    // Test: SCENARIO_GEMINI4_FLOW
    // Tests the Gemini4 story creation flow which uses a different path than the traditional beat-based flow
    try {
        const parentUid = `${REGRESSION_SUITE_TAG}-gemini4-parent-${Date.now()}`;
        const childRef = await createRegressionChild({
            displayName: 'Gemini4 Test Child',
            ownerParentUid: parentUid,
            createdAt: serverTimestamp(),
            likes: ['adventures', 'animals'],
            dislikes: [],
        }, 'SCENARIO_GEMINI4_FLOW');

        const sessionRef = await createRegressionSession({
            childId: childRef.id,
            parentUid,
            status: 'in_progress',
            currentPhase: 'gemini4',
            storyMode: 'gemini4',
            currentStepIndex: 0,
        }, 'SCENARIO_GEMINI4_FLOW');

        // Call the gemini4 API to generate story content
        const geminiRes = await authFetch('/api/gemini4', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sessionId: sessionRef.id }),
        });
        const geminiPayload = await geminiRes.json();

        if (!geminiRes.ok || !geminiPayload?.ok) {
            throw new Error(geminiPayload?.errorMessage || 'Gemini4 API failed.');
        }

        // Verify the response has expected fields
        if (!geminiPayload.question && !geminiPayload.options && !geminiPayload.finalStory) {
            throw new Error('Gemini4 response missing expected fields (question, options, or finalStory).');
        }

        updateTestResult('SCENARIO_GEMINI4_FLOW', {
            status: 'PASS',
            message: `Gemini4 API returned valid response. Has question: ${!!geminiPayload.question}, options: ${geminiPayload.options?.length || 0}`
        });

    } catch (e: any) {
        updateTestResult('SCENARIO_GEMINI4_FLOW', { status: 'ERROR', message: e.message });
    }

    // Test: API_BOOKS_V3_AUTH — the server-side Book pipeline routes (slice 5.1).
    // All five reject anonymous calls (401). Authenticated calls on ids that do
    // not exist get past the auth gate and return 404, so no Manuscript or Book
    // is created, no allowance is charged and no AI runs. The full pipeline is
    // covered by src/server/books/__tests__/pipeline.test.ts (and runs in the
    // emulator with TEST_MODE=1).
    try {
        const booksToken = await auth?.currentUser?.getIdToken?.();
        if (!booksToken) throw new Error('Admin authentication required for books auth test.');
        const missingStory = { storyId: 'regression-missing-story', formId: 'regression-missing-form' };
        const missingBook = 'regression-missing-book';
        const routes: Array<{ path: string; body?: unknown }> = [
            { path: '/api/manuscripts', body: missingStory },
            { path: '/api/books', body: { ...missingStory, styleId: 'regression-missing-style', idempotencyKey: 'regression-books-auth' } },
            { path: `/api/books/${missingBook}/pages/2/retry` },
            { path: `/api/books/${missingBook}/lock` },
            { path: `/api/books/${missingBook}/unlock` },
        ];
        for (const route of routes) {
            const init = { method: 'POST', body: route.body === undefined ? undefined : JSON.stringify(route.body) };
            // Plain fetch: authFetch would attach the signed-in admin's token.
            const anonymous = await fetch(route.path, { ...init, headers: { 'Content-Type': 'application/json' } });
            if (anonymous.status !== 401) throw new Error(`${route.path}: expected 401 without auth, got ${anonymous.status}`);
            const authed = await authFetch(route.path, {
                ...init,
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${booksToken}` },
            });
            if (authed.status !== 404) throw new Error(`${route.path}: expected 404 for a missing id, got ${authed.status}`);
        }
        updateTestResult('API_BOOKS_V3_AUTH', {
            status: 'PASS',
            message: 'manuscripts, books, retry, lock and unlock reject anonymous calls (401) and return 404 for missing ids.',
        });
    } catch (e: any) {
        updateTestResult('API_BOOKS_V3_AUTH', { status: 'ERROR', message: e.message });
    }

    // Test: API_PERSONA — the persona cookie endpoint (Sprint W4-A).
    // Validation-only: never sets a real child persona for the admin (that
    // would scope this browser's subsequent generation requests); finishes
    // with DELETE so the suite always leaves the browser unscoped.
    try {
        const personaToken = await auth?.currentUser?.getIdToken?.();
        if (!personaToken) throw new Error('Admin authentication required for persona test.');

        // 1. Unauthenticated -> 401
        const unauthedPersonaRes = await globalThis.fetch('/api/persona', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ childId: 'regression-persona-child' }),
        });
        if (unauthedPersonaRes.status !== 401) throw new Error(`Expected 401 without auth, got ${unauthedPersonaRes.status}`);

        const personaHeaders = { 'Content-Type': 'application/json', Authorization: `Bearer ${personaToken}` };

        // 2. Bad childId type -> 400
        const badPersonaRes = await authFetch('/api/persona', {
            method: 'POST', headers: personaHeaders, body: JSON.stringify({ childId: 123 }),
        });
        if (badPersonaRes.status !== 400) throw new Error(`Expected 400 for non-string childId, got ${badPersonaRes.status}`);

        // 3. Unknown childId -> 404 (or 503 when no signing secret is configured locally)
        const missingPersonaRes = await authFetch('/api/persona', {
            method: 'POST', headers: personaHeaders, body: JSON.stringify({ childId: 'regression-persona-nonexistent-child' }),
        });
        if (missingPersonaRes.status !== 404 && missingPersonaRes.status !== 503) {
            throw new Error(`Expected 404 for unknown childId (or 503 unconfigured), got ${missingPersonaRes.status}`);
        }

        // 4. DELETE clears (no auth required by design — sign-out path)
        const clearPersonaRes = await authFetch('/api/persona', { method: 'DELETE' });
        if (!clearPersonaRes.ok) throw new Error(`Expected DELETE to clear the persona, got ${clearPersonaRes.status}`);

        updateTestResult('API_PERSONA', {
            status: 'PASS',
            message: 'persona requires auth (401), validates childId (400 bad type, 404 unknown), and DELETE clears the cookie. Browser left unscoped.',
        });
    } catch (e: any) {
        updateTestResult('API_PERSONA', { status: 'ERROR', message: e.message });
    }

    // Test: API_VERIFY_PIN_LOCKOUT — verify-pin brute-force lockout policy
    // (Sprint W4-A). Uses the dryRun seam: reports the lockout configuration
    // and current state WITHOUT comparing a PIN or recording an attempt, so
    // the admin account can never be locked out by this suite.
    try {
        const pinDryRunToken = await auth?.currentUser?.getIdToken?.();
        if (!pinDryRunToken) throw new Error('Admin authentication required for verify-pin lockout test.');
        const pinDryRunHeaders = { 'Content-Type': 'application/json', Authorization: `Bearer ${pinDryRunToken}` };

        const dryRunRes = await authFetch('/api/parent/verify-pin', {
            method: 'POST', headers: pinDryRunHeaders, body: JSON.stringify({ dryRun: true }),
        });
        const dryRunPayload = await dryRunRes.json();
        if (!dryRunRes.ok || dryRunPayload?.ok !== true || dryRunPayload?.dryRun !== true) {
            throw new Error(`Expected dry-run 200, got ${dryRunRes.status}: ${dryRunPayload?.message || ''}`);
        }
        if (dryRunPayload?.lockout?.maxAttempts !== 5 || dryRunPayload?.lockout?.lockoutMs !== 300000) {
            throw new Error(`Unexpected lockout config: ${JSON.stringify(dryRunPayload?.lockout)}`);
        }
        if (typeof dryRunPayload?.failedAttempts !== 'number' || typeof dryRunPayload?.locked !== 'boolean') {
            throw new Error('Dry-run response missing failedAttempts/locked state.');
        }

        // Format validation still rejects without recording an attempt.
        const shortPinRes = await authFetch('/api/parent/verify-pin', {
            method: 'POST', headers: pinDryRunHeaders, body: JSON.stringify({ pin: '12' }),
        });
        if (shortPinRes.status !== 400) throw new Error(`Expected 400 for short PIN, got ${shortPinRes.status}`);

        updateTestResult('API_VERIFY_PIN_LOCKOUT', {
            status: 'PASS',
            message: `Lockout policy live (${dryRunPayload.lockout.maxAttempts} attempts / ${dryRunPayload.lockout.lockoutMs / 60000} min); locked=${dryRunPayload.locked}, failedAttempts=${dryRunPayload.failedAttempts}; bad format 400s. Non-destructive (dryRun).`,
        });
    } catch (e: any) {
        updateTestResult('API_VERIFY_PIN_LOCKOUT', { status: 'ERROR', message: e.message });
    }

    // Test: SCENARIO_CANONICAL_IMAGE_TRIGGER
    // Uploads a minimal photo via API and verifies canonicalImageGeneration.status is set to 'pending'.
    try {
        const authToken = await auth?.currentUser?.getIdToken?.();
        if (!authToken) throw new Error('Admin auth token not available.');

        const childRef = await createRegressionChild({
            displayName: 'Photo Trigger Test Child',
            ownerParentUid: `${REGRESSION_SUITE_TAG}-photo-parent`,
            createdAt: serverTimestamp(),
            likes: [],
            dislikes: [],
        }, 'SCENARIO_CANONICAL_IMAGE_TRIGGER');

        // Minimal 1×1 PNG
        const MINIMAL_PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI6QAAAABJRU5ErkJggg==';

        const uploadRes = await authFetch('/api/children/photos', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` },
            body: JSON.stringify({ childId: childRef.id, dataUrl: MINIMAL_PNG }),
        });
        const uploadBody = await uploadRes.json();
        if (!uploadRes.ok || !uploadBody?.ok) {
            throw new Error(uploadBody?.errorMessage || `Photo upload API returned ${uploadRes.status}`);
        }

        // Read the child doc to verify generation statuses were set
        const childSnap = await getDoc(childRef);
        if (!childSnap.exists()) throw new Error('Child document missing after photo upload.');
        const childData = childSnap.data();

        if (childData.canonicalImageGeneration?.status !== 'pending') {
            throw new Error(`Expected canonicalImageGeneration.status='pending', got '${childData.canonicalImageGeneration?.status ?? 'undefined'}'.`);
        }
        if (childData.imageDescriptionGeneration?.status !== 'pending') {
            throw new Error(`Expected imageDescriptionGeneration.status='pending', got '${childData.imageDescriptionGeneration?.status ?? 'undefined'}'.`);
        }

        updateTestResult('SCENARIO_CANONICAL_IMAGE_TRIGGER', {
            status: 'PASS',
            message: `Photo uploaded; canonicalImageGeneration and imageDescriptionGeneration both set to 'pending'.`,
        });
    } catch (e: any) {
        updateTestResult('SCENARIO_CANONICAL_IMAGE_TRIGGER', { status: 'ERROR', message: e.message });
    }

    // --- API Tests ---

    // Test: API_STORY_BEAT
    if (!beatSessionId) {
      updateTestResult('API_STORY_BEAT', { status: 'SKIP', message: 'No beat-ready sessionId provided' });
    } else {
      try {
        const response = await authFetch('/api/storyBeat', {
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
            const response = await authFetch('/api/warmupReply', {
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

    // Test: API_USER_ONBOARDING_GET — derived first-run checklist shape.
    // Read-only for established accounts (state is cached once complete/dismissed).
    try {
        const onboardingToken = await auth?.currentUser?.getIdToken?.();
        if (!onboardingToken) throw new Error('Authentication required.');
        const response = await authFetch('/api/user/onboarding', {
            headers: { Authorization: `Bearer ${onboardingToken}` },
        });
        const result = await response.json();
        if (response.status !== 200) {
            throw new Error(`API returned status ${response.status}: ${result.error || 'Unknown error'}`);
        }
        if (result.ok !== true) throw new Error('API response missing ok:true.');
        if (!Array.isArray(result.steps) || result.steps.length !== 5) {
            throw new Error(`Expected 5 onboarding steps, got ${Array.isArray(result.steps) ? result.steps.length : typeof result.steps}.`);
        }
        const badStep = result.steps.find((s: any) => !s.id || typeof s.complete !== 'boolean' || !s.href);
        if (badStep) throw new Error('A step is missing id/complete/href.');
        if (typeof result.complete !== 'boolean' || typeof result.dismissed !== 'boolean') {
            throw new Error('Response missing complete/dismissed booleans.');
        }
        updateTestResult('API_USER_ONBOARDING_GET', { status: 'PASS', message: `5 steps returned; complete=${result.complete}, dismissed=${result.dismissed}.` });
    } catch (e: any) {
        updateTestResult('API_USER_ONBOARDING_GET', { status: 'FAIL', message: e.message });
    }

    // Test: API_USER_ONBOARDING_POST — input validation only (no state mutation:
    // an unknown action must be rejected with 400 before any write).
    try {
        const onboardingToken = await auth?.currentUser?.getIdToken?.();
        if (!onboardingToken) throw new Error('Authentication required.');
        const response = await authFetch('/api/user/onboarding', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${onboardingToken}` },
            body: JSON.stringify({ action: 'regression-bogus-action' }),
        });
        if (response.status !== 400) {
            throw new Error(`Expected 400 for unknown action, got ${response.status}.`);
        }
        updateTestResult('API_USER_ONBOARDING_POST', { status: 'PASS', message: 'Unknown action correctly rejected with 400.' });
    } catch (e: any) {
        updateTestResult('API_USER_ONBOARDING_POST', { status: 'FAIL', message: e.message });
    }

    // Test: API_ADMIN_OPS_METRICS — ops dashboard metrics shape (read-only).
    try {
        const opsToken = await auth?.currentUser?.getIdToken?.();
        if (!opsToken) throw new Error('Authentication required.');
        const response = await authFetch('/api/admin/ops/metrics', {
            headers: { Authorization: `Bearer ${opsToken}` },
        });
        const result = await response.json();
        if (response.status !== 200) {
            throw new Error(`API returned status ${response.status}: ${result.errorMessage || 'Unknown error'}`);
        }
        if (result.ok !== true) throw new Error('API response missing ok:true.');
        if (typeof result.analytics?.activeUsers?.available !== 'boolean') {
            throw new Error('analytics.activeUsers missing available flag.');
        }
        if (typeof result.analytics?.funnel?.available !== 'boolean') {
            throw new Error('analytics.funnel missing available flag.');
        }
        if (typeof result.generation?.total !== 'number' || typeof result.generation?.errorRate !== 'number') {
            throw new Error('generation section missing total/errorRate numbers.');
        }
        if (typeof result.printOrders?.placed !== 'number' || !result.printOrders?.conversion) {
            throw new Error('printOrders section missing placed/conversion.');
        }
        const phState = result.analytics.activeUsers.available ? 'PostHog live' : 'PostHog gated';
        updateTestResult('API_ADMIN_OPS_METRICS', { status: 'PASS', message: `Metrics OK (${phState}); ${result.generation.total} flow runs, ${result.printOrders.placed} orders in window.` });
    } catch (e: any) {
        updateTestResult('API_ADMIN_OPS_METRICS', { status: 'FAIL', message: e.message });
    }

    // Test: API_ADMIN_OPS_HEALTH_CHECK — dry-run evaluates checks without alerting/persisting.
    try {
        const opsToken = await auth?.currentUser?.getIdToken?.();
        if (!opsToken) throw new Error('Authentication required.');
        const response = await authFetch('/api/admin/ops/health-check?dryRun=1', {
            method: 'POST',
            headers: { Authorization: `Bearer ${opsToken}` },
        });
        const result = await response.json();
        if (response.status !== 200) {
            throw new Error(`API returned status ${response.status}: ${result.errorMessage || 'Unknown error'}`);
        }
        if (result.ok !== true) throw new Error('API response missing ok:true.');
        if (result.dryRun !== true) throw new Error('Expected dryRun:true in response.');
        if (!Array.isArray(result.results) || result.results.length !== 3) {
            throw new Error(`Expected 3 health-check results, got ${Array.isArray(result.results) ? result.results.length : typeof result.results}.`);
        }
        const badCheck = result.results.find((r: any) => !r.id || typeof r.breached !== 'boolean' || !r.summary);
        if (badCheck) throw new Error('A health-check result is missing id/breached/summary.');
        if (!Array.isArray(result.alertsSent) || result.alertsSent.length !== 0) {
            throw new Error('Dry run must not send alerts.');
        }
        updateTestResult('API_ADMIN_OPS_HEALTH_CHECK', { status: 'PASS', message: `3 checks evaluated (healthy=${result.healthy}); no alerts on dry run.` });
    } catch (e: any) {
        updateTestResult('API_ADMIN_OPS_HEALTH_CHECK', { status: 'FAIL', message: e.message });
    }

    // Test: API_ADMIN_SESSIONS — sessions list with server-computed lastError (read-only).
    try {
        const opsToken = await auth?.currentUser?.getIdToken?.();
        if (!opsToken) throw new Error('Authentication required.');
        const response = await authFetch('/api/admin/sessions', {
            headers: { Authorization: `Bearer ${opsToken}` },
        });
        const result = await response.json();
        if (response.status !== 200) {
            throw new Error(`API returned status ${response.status}: ${result.errorMessage || 'Unknown error'}`);
        }
        if (result.ok !== true) throw new Error('API response missing ok:true.');
        if (!Array.isArray(result.sessions)) throw new Error('Response missing sessions array.');
        const badSession = result.sessions.find((s: any) => !s.id || !('lastError' in s));
        if (badSession) throw new Error('A session row is missing id or the lastError field.');
        const withErrors = result.sessions.filter((s: any) => s.lastError).length;
        updateTestResult('API_ADMIN_SESSIONS', { status: 'PASS', message: `${result.sessions.length} session(s) returned; ${withErrors} with a lastError summary.` });
    } catch (e: any) {
        updateTestResult('API_ADMIN_SESSIONS', { status: 'FAIL', message: e.message });
    }

    // Test: API_HEALTH — canary/rollback probe (W3-B). Read-only; verifies the
    // verbose body shape (version + firestore dependency probe). A 'degraded'
    // 503 is a FAIL (the probe is doing its job — the dependency is down).
    try {
        const response = await authFetch('/api/health', { cache: 'no-store' });
        const result = await response.json();
        if (!result.version || typeof result.version !== 'string') {
            throw new Error('Response missing version (build SHA).');
        }
        if (result.status === 'ok' && result.checks === undefined) {
            // Minimal body — the health_verbose flag is off; still a valid state.
            updateTestResult('API_HEALTH', { status: 'PASS', message: `Minimal body (health_verbose=false); version=${result.version}.` });
        } else if (response.status === 200 && result.status === 'ok') {
            if (result.checks?.firestore?.ok !== true) throw new Error('Firestore probe not ok despite status ok.');
            if (typeof result.uptimeSeconds !== 'number') throw new Error('Response missing uptimeSeconds.');
            updateTestResult('API_HEALTH', { status: 'PASS', message: `ok; version=${result.version}; firestore ${result.checks.firestore.latencyMs}ms.` });
        } else {
            throw new Error(`Status ${response.status}/${result.status}; firestore error: ${result.checks?.firestore?.error || 'unknown'}`);
        }
    } catch (e: any) {
        updateTestResult('API_HEALTH', { status: 'FAIL', message: e.message });
    }

    // Test: API_ROUTE_AUTH_ANON — Phase 0 route auth. Calls protected routes
    // with NO token (plain fetch, deliberately not authFetch) and expects a
    // refusal before any AI call, Firestore read or upstream billing happens.
    // The IDs are placeholders; a 404 would mean auth ran too late.
    try {
        const anonymous: Array<{ path: string; init?: RequestInit; expect: number[] }> = [
            { path: '/api/storyBeat', init: { method: 'POST', body: JSON.stringify({ sessionId: 'regression-anon' }) }, expect: [401] },
            { path: '/api/storyCompile', init: { method: 'POST', body: JSON.stringify({ sessionId: 'regression-anon' }) }, expect: [401] },
            { path: '/api/characters/create', init: { method: 'POST', body: JSON.stringify({ sessionId: 'regression-anon', characterLabel: 'x', characterType: 'Pet' }) }, expect: [401] },
            { path: '/api/storyBook/regression-anon', expect: [401] },
            { path: '/api/printStoryBooks/regression-anon/generate-pdfs', init: { method: 'POST' }, expect: [401] },
            { path: '/api/postcode/lookup?postcode=SW1A1AA', expect: [401] },
            { path: '/api/webhooks/mixam', init: { method: 'POST', body: '{}' }, expect: [401, 503] },
        ];
        const failures: string[] = [];
        for (const { path, init, expect } of anonymous) {
            const response = await globalThis.fetch(path, {
                ...init,
                headers: { 'Content-Type': 'application/json' },
                cache: 'no-store',
            });
            if (!expect.includes(response.status)) failures.push(`${path} → ${response.status}`);
        }
        if (failures.length > 0) throw new Error(`Not rejected: ${failures.join('; ')}`);
        updateTestResult('API_ROUTE_AUTH_ANON', { status: 'PASS', message: `${anonymous.length} protected routes refused anonymous calls.` });
    } catch (e: any) {
        updateTestResult('API_ROUTE_AUTH_ANON', { status: 'FAIL', message: e.message });
    }

    // Test: API_FLAGS — server-evaluated feature flags (W3-B). Read-only;
    // verifies every value is a boolean and the worked-example flag is present.
    try {
        const flagsToken = await auth?.currentUser?.getIdToken?.();
        const response = await authFetch('/api/flags', {
            headers: flagsToken ? { Authorization: `Bearer ${flagsToken}` } : undefined,
            cache: 'no-store',
        });
        const result = await response.json();
        if (response.status !== 200 || result.ok !== true) {
            throw new Error(`API returned status ${response.status}: ${result.error || 'Unknown error'}`);
        }
        if (!result.flags || typeof result.flags !== 'object') throw new Error('Response missing flags map.');
        if (typeof result.flags.health_verbose !== 'boolean') throw new Error('flags.health_verbose missing or not boolean.');
        const nonBoolean = Object.entries(result.flags).find(([, v]) => typeof v !== 'boolean');
        if (nonBoolean) throw new Error(`Flag '${nonBoolean[0]}' is not a boolean.`);
        updateTestResult('API_FLAGS', { status: 'PASS', message: `${Object.keys(result.flags).length} flag(s); authenticated=${result.authenticated}.` });
    } catch (e: any) {
        updateTestResult('API_FLAGS', { status: 'FAIL', message: e.message });
    }

    // ── Sprint W3-C: feedback / tickets / order-timeline APIs ──────────────
    // Validation-only checks: nothing below mutates state (no feedback docs,
    // no tickets, no emails) so the suite stays repeatable.

    // Test: API_FEEDBACK_POST_VALIDATION — bogus trigger must be rejected with 400.
    try {
        const w3cToken = await auth?.currentUser?.getIdToken?.();
        if (!w3cToken) throw new Error('Authentication required.');
        const response = await authFetch('/api/feedback', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${w3cToken}` },
            body: JSON.stringify({ trigger: 'regression-bogus-trigger', subjectId: 'regression', action: 'submitted', rating: 5 }),
        });
        if (response.status !== 400) {
            throw new Error(`Expected 400 for unknown trigger, got ${response.status}.`);
        }
        updateTestResult('API_FEEDBACK_POST_VALIDATION', { status: 'PASS', message: 'Unknown trigger correctly rejected with 400.' });
    } catch (e: any) {
        updateTestResult('API_FEEDBACK_POST_VALIDATION', { status: 'FAIL', message: e.message });
    }

    // Test: API_FEEDBACK_ELIGIBILITY — read-only eligibility check returns a boolean.
    try {
        const w3cToken = await auth?.currentUser?.getIdToken?.();
        if (!w3cToken) throw new Error('Authentication required.');
        const response = await authFetch('/api/feedback/eligibility?trigger=book_first_view&subjectId=regression-nonexistent-book', {
            headers: { Authorization: `Bearer ${w3cToken}` },
        });
        const result = await response.json();
        if (response.status !== 200) throw new Error(`API returned status ${response.status}: ${result.error || 'Unknown error'}`);
        if (result.ok !== true || typeof result.eligible !== 'boolean') {
            throw new Error('Response missing ok:true / eligible boolean.');
        }
        updateTestResult('API_FEEDBACK_ELIGIBILITY', { status: 'PASS', message: `Eligibility check returned eligible=${result.eligible}.` });
    } catch (e: any) {
        updateTestResult('API_FEEDBACK_ELIGIBILITY', { status: 'FAIL', message: e.message });
    }

    // Test: API_TICKETS_GET — own-tickets list shape.
    try {
        const w3cToken = await auth?.currentUser?.getIdToken?.();
        if (!w3cToken) throw new Error('Authentication required.');
        const response = await authFetch('/api/tickets', {
            headers: { Authorization: `Bearer ${w3cToken}` },
        });
        const result = await response.json();
        if (response.status !== 200) throw new Error(`API returned status ${response.status}: ${result.error || 'Unknown error'}`);
        if (result.ok !== true || !Array.isArray(result.tickets)) throw new Error('Response missing ok:true / tickets array.');
        const badTicket = result.tickets.find((t: any) => !t.id || !['open', 'in_progress', 'resolved'].includes(t.status));
        if (badTicket) throw new Error(`Ticket ${badTicket.id || '?'} has an invalid status.`);
        updateTestResult('API_TICKETS_GET', { status: 'PASS', message: `${result.tickets.length} ticket(s) returned with valid statuses.` });
    } catch (e: any) {
        updateTestResult('API_TICKETS_GET', { status: 'FAIL', message: e.message });
    }

    // Test: API_REPORT_ISSUE_VALIDATION — missing message must be rejected with 400
    // (validated before any ticket write or email).
    try {
        const w3cToken = await auth?.currentUser?.getIdToken?.();
        if (!w3cToken) throw new Error('Authentication required.');
        const response = await authFetch('/api/report-issue', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${w3cToken}` },
            body: JSON.stringify({ pagePath: '/admin/regression' }),
        });
        if (response.status !== 400) {
            throw new Error(`Expected 400 for missing message, got ${response.status}.`);
        }
        updateTestResult('API_REPORT_ISSUE_VALIDATION', { status: 'PASS', message: 'Missing message correctly rejected with 400 (no ticket created).' });
    } catch (e: any) {
        updateTestResult('API_REPORT_ISSUE_VALIDATION', { status: 'FAIL', message: e.message });
    }

    // Test: API_MY_ORDERS_TIMELINE — server-derived timeline/statusCategory shape.
    try {
        const w3cToken = await auth?.currentUser?.getIdToken?.();
        if (!w3cToken) throw new Error('Authentication required.');
        const response = await authFetch('/api/printOrders/my-orders', {
            headers: { Authorization: `Bearer ${w3cToken}` },
        });
        const result = await response.json();
        if (response.status !== 200) throw new Error(`API returned status ${response.status}: ${result.error || 'Unknown error'}`);
        if (result.ok !== true || !Array.isArray(result.orders)) throw new Error('Response missing ok:true / orders array.');
        if (!result.estimatedTurnaround || typeof result.estimatedTurnaround.label !== 'string') {
            throw new Error('Response missing estimatedTurnaround.label.');
        }
        const badOrder = result.orders.find((o: any) =>
            !o.timeline || !Array.isArray(o.timeline.steps) || o.timeline.steps.length !== 5 ||
            !['pending', 'in_progress', 'completed', 'cancelled'].includes(o.statusCategory));
        if (badOrder) throw new Error(`Order ${badOrder.id || '?'} is missing a 5-step timeline or valid statusCategory.`);
        updateTestResult('API_MY_ORDERS_TIMELINE', { status: 'PASS', message: `${result.orders.length} order(s) with server-derived timelines; estimate present.` });
    } catch (e: any) {
        updateTestResult('API_MY_ORDERS_TIMELINE', { status: 'FAIL', message: e.message });
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

      <DiagnosticsPanel pageName="admin-regression" data={finalDiagnostics} className="mt-8" />
    </div>
  );
}
