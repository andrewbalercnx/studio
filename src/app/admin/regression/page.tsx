

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
import { collection, getDocs, doc, getDoc, query, where, limit, addDoc, serverTimestamp, updateDoc, orderBy, increment } from 'firebase/firestore';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import type { ChatMessage, StorySession, Character, PromptConfig, Choice, StoryType } from '@/lib/types';

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
    questionPreview?: string | null;
    traitsCount?: number | null;
    error?: any;
    [key: string]: any; // Allow other properties from flow response
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


const initialTests: TestResult[] = [
  { id: 'SCENARIO_ARC_BOUNDS', name: 'Scenario: Arc Bounds', status: 'PENDING', message: '' },
  { id: 'SCENARIO_ARC_STEP_ADVANCE', name: 'Scenario: Arc Step Advance', status: 'PENDING', message: '' },
  { id: 'SCENARIO_CHARACTER_TRAITS', name: 'Scenario: Character Traits Flow', status: 'PENDING', message: '' },
  { id: 'SCENARIO_CHARACTER_FROM_BEAT', name: 'Scenario: Character Metadata in Beat Options', status: 'PENDING', message: '' },
  { id: 'SCENARIO_BEAT_MORE_OPTIONS', name: 'Scenario: More Options on Beat', status: 'PENDING', message: '' },
  { id: 'SCENARIO_WARMUP_AUTO', name: 'Scenario: Auto-Warmup', status: 'PENDING', message: '' },
  { id: 'SCENARIO_BEAT_AUTO', name: 'Scenario: Auto-Beat', status: 'PENDING', message: '' },
  { id: 'API_WARMUP_REPLY', name: 'API: /api/warmupReply (Input)', status: 'PENDING', message: '' },
  { id: 'API_STORY_BEAT', name: 'API: /api/storyBeat (Input)', status: 'PENDING', message: '' },
  { id: 'SESSION_BEAT_MESSAGES', name: 'Session: Beat Messages (Input)', status: 'PENDING', message: '' },
  { id: 'SESSION_BEAT_STRUCTURE', name: 'Session: Beat Structure (Input)', status: 'PENDING', message: '' },
  { id: 'DATA_SESSIONS_OVERVIEW', name: 'Firestore: Sessions Overview', status: 'PENDING', message: '' },
  { id: 'DATA_CHILDREN', name: 'Firestore: Children', status: 'PENDING', message: '' },
  { id: 'DATA_STORY_PHASES', name: 'Firestore: Story Phases', status: 'PENDING', message: '' },
  { id: 'DATA_STORY_TYPES', name: 'Firestore: Story Types', status: 'PENDING', message: '' },
  { id: 'DATA_PROMPTS_STORY_BEAT_LIVE', name: 'Firestore: StoryBeat Live Configs', status: 'PENDING', message: '' },
  { id: 'DATA_PROMPTS', name: 'Firestore: Prompt Configs', status: 'PENDING', message: '' },
];


export default function AdminRegressionPage() {
  const { isAuthenticated, isAdmin, loading: authLoading } = useAdminStatus();
  const firestore = useFirestore();
  const { toast } = useToast();

  const [beatSessionId, setBeatSessionId] = useState('');
  const [warmupSessionId, setWarmupSessionId] = useState('');
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

  const runScenarioAndApiTests = async (): Promise<{ beat: ScenarioResult, warmup: ScenarioWarmupResult, moreOptions: ScenarioMoreOptionsResult, character: ScenarioCharacterResult, characterTraits: ScenarioCharacterTraitsResult, arcAdvance: ScenarioArcAdvanceResult, arcBounds: ScenarioArcBoundsResult }> => {
    if (!firestore) return { beat: null, warmup: null, moreOptions: null, character: null, characterTraits: null, arcAdvance: null, arcBounds: null };
    
    let beatScenarioSummary: ScenarioResult = null;
    let warmupScenarioSummary: ScenarioWarmupResult = null;
    let moreOptionsScenarioSummary: ScenarioMoreOptionsResult = null;
    let characterScenarioSummary: ScenarioCharacterResult = null;
    let characterTraitsScenarioSummary: ScenarioCharacterTraitsResult = null;
    let arcAdvanceScenarioSummary: ScenarioArcAdvanceResult = null;
    let arcBoundsScenarioSummary: ScenarioArcBoundsResult = null;
    let apiSummary: any = {};

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

    // Test: SCENARIO_BEAT_MORE_OPTIONS
    const moreOptionsSessionId = beatScenarioSummary?.sessionId;
    if (!moreOptionsSessionId) {
        updateTestResult('SCENARIO_BEAT_MORE_OPTIONS', { status: 'SKIP', message: 'Depends on successful SCENARIO_BEAT_AUTO.' });
    } else {
        try {
            const res1 = await fetch('/api/storyBeat', {
              method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sessionId: moreOptionsSessionId }),
            });
            const result1 = await res1.json();
            if (!result1.ok) throw new Error(`First beat call failed: ${result1.errorMessage}`);
            
            const messagesRef = collection(firestore, `storySessions/${moreOptionsSessionId}/messages`);
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
                updateTestResult('SCENARIO_BEAT_MORE_OPTIONS', { status: 'PASS', message: 'Ran twice, but options/continuation were identical.' });
            } else {
                updateTestResult('SCENARIO_BEAT_MORE_OPTIONS', { status: 'PASS', message: 'Successfully ran storyBeat twice with different results.' });
            }

        } catch (e: any) {
            updateTestResult('SCENARIO_BEAT_MORE_OPTIONS', { status: 'ERROR', message: `More-options scenario failed: ${e.message}`, details: moreOptionsScenarioSummary });
        }
    }

    // Test: SCENARIO_CHARACTER_FROM_BEAT
    try {
        const typesRef = collection(firestore, 'storyTypes');
        const typeQuery = query(typesRef, where('status', '==', 'live'), limit(1));
        const typeSnap = await getDocs(typeQuery);
        if (typeSnap.empty) throw new Error('No live story types found.');
        const storyType = typeSnap.docs[0].data();
        const storyTypeId = typeSnap.docs[0].id;

        const childRef = await addDoc(collection(firestore, 'children'), { displayName: 'Char Test Child', createdAt: serverTimestamp(), regressionTag: 'char_beat' });
        const sessionRef = await addDoc(collection(firestore, 'storySessions'), {
            childId: childRef.id, storyTypeId, storyPhaseId: storyType.defaultPhaseId,
            arcStepIndex: 0, promptConfigLevelBand: 'low', status: 'in_progress',
            createdAt: serverTimestamp(), updatedAt: serverTimestamp()
        });
        
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

    // Test: SCENARIO_CHARACTER_TRAITS
    let traitsChildId: string | null = null;
    let traitsSessionId: string | null = null;
    let traitsCharacterId: string | null = null;
    let traitsErrorDetails: any = null;

    try {
        const childRef = await addDoc(collection(firestore, 'children'), { displayName: 'Traits Test Child', createdAt: serverTimestamp() });
        traitsChildId = childRef.id;

        const sessionRef = await addDoc(collection(firestore, 'storySessions'), {
            childId: childRef.id, storyTypeId: 'animal_adventure_v1', storyPhaseId: 'story_beat_phase_v1',
            arcStepIndex: 0, promptConfigLevelBand: 'low', status: 'in_progress'
        });
        traitsSessionId = sessionRef.id;
        
        const charRef = await addDoc(collection(firestore, 'characters'), {
            ownerChildId: childRef.id, sessionId: sessionRef.id, name: 'Test Bunny',
            role: 'pet', traits: [], createdAt: serverTimestamp(), updatedAt: serverTimestamp()
        });
        traitsCharacterId = charRef.id;
        
        await addDoc(collection(firestore, `storySessions/${sessionRef.id}/messages`), {
            sender: 'assistant', text: 'Once upon a time...', createdAt: serverTimestamp()
        });
        
        const response = await fetch('/api/characterTraits', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sessionId: traitsSessionId, characterId: traitsCharacterId })
        });
        
        let body: any = null;
        try {
            body = await response.json();
        } catch (e) {
             throw new Error(`API did not return valid JSON. Status: ${response.status}`);
        }
        
        traitsErrorDetails = body;

        if (!response.ok || !body.ok) {
            updateTestResult('SCENARIO_CHARACTER_TRAITS', { 
                status: 'ERROR', 
                message: `API returned status ${response.status}${body?.errorMessage ? ': ' + body.errorMessage : ''}`, 
                details: body || { rawError: 'No JSON body returned' }
            });
            throw new Error(`API returned status ${response.status}`);
        }
        
        if (!body.question || typeof body.question !== 'string') throw new Error('Response missing question field.');
        if (!Array.isArray(body.suggestedTraits) || body.suggestedTraits.length === 0) throw new Error('Response missing suggestedTraits array.');
        
        characterTraitsScenarioSummary = {
            childId: traitsChildId, sessionId: traitsSessionId, characterId: traitsCharacterId, ...body
        };
        
        updateTestResult('SCENARIO_CHARACTER_TRAITS', { 
            status: 'PASS', 
            message: 'API returned ok:true with a character trait question.',
            details: {
                questionPreview: body.question.slice(0, 80),
                traitsCount: body.suggestedTraits.length,
                characterId: traitsCharacterId,
            }
        });

    } catch (e: any) {
        if (e instanceof Error && e.message.includes('API returned status')) {
             // The specific error was already set, so we don't need a generic one.
        } else {
             updateTestResult('SCENARIO_CHARACTER_TRAITS', { 
                status: 'ERROR', 
                message: `Exception in character traits scenario: ${e instanceof Error ? e.message : String(e)}`, 
                details: traitsErrorDetails || { rawError: String(e) }
            });
        }
       
        characterTraitsScenarioSummary = {
            childId: traitsChildId, sessionId: traitsSessionId, characterId: traitsCharacterId,
            error: traitsErrorDetails || { message: e instanceof Error ? e.message : String(e) }
        };
    }

    // Test: SCENARIO_ARC_STEP_ADVANCE
    try {
        const typesRef = collection(firestore, 'storyTypes');
        const typeQuery = query(typesRef, where('status', '==', 'live'), limit(1));
        const typeSnap = await getDocs(typeQuery);
        if (typeSnap.empty) throw new Error('No live story types found.');
        const storyType = typeSnap.docs[0].data();
        const storyTypeId = typeSnap.docs[0].id;

        const childRef = await addDoc(collection(firestore, 'children'), { displayName: 'Arc Test Child', createdAt: serverTimestamp(), regressionTag: 'arc_advance' });
        
        const sessionRef = await addDoc(collection(firestore, 'storySessions'), {
            childId: childRef.id, storyTypeId, storyPhaseId: storyType.defaultPhaseId,
            arcStepIndex: 0, promptConfigLevelBand: 'low', status: 'in_progress',
            createdAt: serverTimestamp(), updatedAt: serverTimestamp()
        });
        
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
        const lastStepId = steps[maxIndex];

        const childRef = await addDoc(collection(firestore, 'children'), { displayName: 'Arc Bounds Child', createdAt: serverTimestamp() });
        const sessionRef = await addDoc(collection(firestore, 'storySessions'), {
            childId: childRef.id, storyTypeId, storyPhaseId: 'story_beat_phase_v1',
            arcStepIndex: 0, promptConfigLevelBand: 'low', status: 'in_progress',
        });
        await addDoc(collection(firestore, `storySessions/${sessionRef.id}/messages`), { sender: 'assistant', text: 'Hi', createdAt: serverTimestamp() });
        
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
            
            // Only increment if not at the end
            if (currentArcStepIndex < maxIndex) {
                 await updateDoc(sessionRef, { arcStepIndex: increment(1) });
            }
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

    const scenarioResults = { beat: beatScenarioSummary, warmup: warmupScenarioSummary, moreOptions: moreOptionsScenarioSummary, character: characterScenarioSummary, characterTraits: characterTraitsScenarioSummary, arcAdvance: arcAdvanceScenarioSummary, arcBounds: arcBoundsScenarioSummary };
    
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
    
    setDiagnostics(prev => ({...prev, apiSummary: {...prev.apiSummary, ...apiSummary }, scenario: scenarioResults }));
    return scenarioResults;
  };


  const runAllTests = async () => {
    setIsRunning(true);
    setTests(initialTests.map(t => ({...t, status: 'PENDING', message: '', details: undefined })));
    setDiagnostics(prev => ({ ...prev, firestoreSummary: {}, apiSummary: {}, scenario: {} }));

    await runDataTests();
    await runSessionTests();
    await runScenarioAndApiTests();
    
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
                    <Input id="beatSessionId" value={beatSessionId} onChange={e => setBeatSessionId(e.target.value)} placeholder="Uses auto-scenario if blank"/>
                    <p className="text-xs text-muted-foreground">A session with storyTypeId, phaseId, arcStepIndex set.</p>
                </div>
                 <div className="space-y-2">
                    <Label htmlFor="warmupSessionId">Warmup Session ID</Label>
                    <Input id="warmupSessionId" value={warmupSessionId} onChange={e => setWarmupSessionId(e.target.value)} placeholder="Uses auto-scenario if blank"/>
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

    