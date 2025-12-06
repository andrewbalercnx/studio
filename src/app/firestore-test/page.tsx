

'use client';

import React, { useState, useMemo, useCallback } from 'react';
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
  DocumentReference,
} from 'firebase/firestore';
import { signOut, User } from 'firebase/auth';
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
  queryConstraints?: (ids: Record<string, string>) => any[];
  expected: TestExpectation;
};

type TestResult = {
  case: TestCase;
  status: 'pending' | 'running' | 'pass' | 'fail';
  error?: string;
};

type SetupDiagnosticStep = {
  step: string;
  status: 'pending' | 'pass' | 'fail';
  path?: string;
  error?: string | null;
};

const formatFirebaseError = (error: unknown): string => {
  if (!error) return 'An unknown error occurred';

  if (typeof error === 'string') return error;

  if (typeof error === 'object') {
    const firebaseError = error as { code?: string; message?: string };
    if (firebaseError.code && firebaseError.message) {
      if (firebaseError.code === 'permission-denied') {
        return `[permission-denied] Missing or insufficient permissions.`;
      }
      return `[${firebaseError.code}] ${firebaseError.message}`;
    }
    if (firebaseError.message) {
      return firebaseError.message;
    }
  }

  return 'An unknown error occurred';
};


// --- Test Definitions ---
// IMPORTANT: Unauthenticated tests are at the END because they sign the user out.
// Once signed out, parent tests cannot run. So we run all parent tests first, then unauthenticated tests last.
const testCases: TestCase[] = [
  // ========== USER PROFILE TESTS ==========
  { id: 'users-read-self', description: 'Parent can read their own profile', role: 'parent', operation: 'get', path: (ids) => `users/${ids.parentUid}`, expected: 'allow' },
  { id: 'users-read-other', description: 'Parent cannot read other user profiles', role: 'parent', operation: 'get', path: (ids) => `users/${ids.otherParentUid}`, expected: 'deny' },
  { id: 'users-write-self', description: 'Parent can write to their own profile', role: 'parent', operation: 'update', path: (ids) => `users/${ids.parentUid}`, data: { displayName: 'Test Parent' }, expected: 'allow' },
  { id: 'users-write-other', description: 'Parent cannot write to other user profiles', role: 'parent', operation: 'update', path: (ids) => `users/${ids.otherParentUid}`, data: { displayName: 'Malicious' }, expected: 'deny' },
  { id: 'users-list-all', description: 'Parent cannot list all users', role: 'parent', operation: 'list', path: 'users', expected: 'deny' },
  { id: 'users-admin-list', description: 'Admin can list users', role: 'admin', operation: 'list', path: 'users', expected: 'allow' },

  // ========== CHILDREN TESTS ==========
  { id: 'children-create', description: 'Parent can create a child', role: 'parent', operation: 'create', path: (ids) => `children`, data: (ids) => ({ ownerParentUid: ids.parentUid, displayName: 'Test Child' }), expected: 'allow' },
  { id: 'children-read-own', description: 'Parent can read their own child', role: 'parent', operation: 'get', path: (ids) => `children/${ids.childId}`, expected: 'allow' },
  { id: 'children-read-other', description: 'Parent cannot read another parent\'s child', role: 'parent', operation: 'get', path: (ids) => `children/${ids.otherChildId}`, expected: 'deny' },
  { id: 'children-update-own', description: 'Parent can update their own child', role: 'parent', operation: 'update', path: (ids) => `children/${ids.childId}`, data: { displayName: 'Updated Child' }, expected: 'allow' },
  { id: 'children-delete-own', description: 'Parent can delete their own child', role: 'parent', operation: 'delete', path: (ids) => `children/${ids.childId}`, expected: 'allow' },
  { id: 'children-list-own', description: 'Parent cannot list children (admin only)', role: 'parent', operation: 'list', path: 'children', queryConstraints: (ids) => [where('ownerParentUid', '==', ids.parentUid)], expected: 'deny' },
  { id: 'children-list-other', description: 'Parent cannot list other children', role: 'parent', operation: 'list', path: 'children', queryConstraints: (ids) => [where('ownerParentUid', '==', ids.otherParentUid)], expected: 'deny' },
  { id: 'children-help-read-auth', description: 'Authenticated user can read help-child', role: 'parent', operation: 'get', path: () => `children/help-child`, expected: 'allow' },
  { id: 'children-help-wildcard-read', description: 'Authenticated user can read help-* child docs', role: 'parent', operation: 'get', path: () => `children/help-example`, expected: 'allow' },

  // ========== CHILD SESSIONS (LEGACY) TESTS ==========
  { id: 'child-sessions-read-own', description: 'Parent can read their child\'s sessions', role: 'parent', operation: 'get', path: (ids) => `children/${ids.childId}/sessions/${ids.sessionId}`, expected: 'allow' },
  { id: 'child-sessions-help-read', description: 'Authenticated user can read help-child sessions', role: 'parent', operation: 'get', path: (ids) => `children/help-child/sessions/demo-session`, expected: 'allow' },

  // ========== STORY SESSIONS TESTS ==========
  { id: 'storysessions-create', description: 'Parent can create a story session', role: 'parent', operation: 'create', path: () => `storySessions`, data: (ids) => ({ parentUid: ids.parentUid, childId: ids.childId, status: 'in_progress', currentPhase: 'warmup' }), expected: 'allow' },
  { id: 'storysessions-read-own', description: 'Parent can read their own story session', role: 'parent', operation: 'get', path: (ids) => `storySessions/${ids.storySessionId}`, expected: 'allow' },
  { id: 'storysessions-read-other', description: 'Parent cannot read other parent\'s story session', role: 'parent', operation: 'get', path: (ids) => `storySessions/${ids.otherStorySessionId}`, expected: 'deny' },
  { id: 'storysessions-update-own', description: 'Parent can update their own story session', role: 'parent', operation: 'update', path: (ids) => `storySessions/${ids.storySessionId}`, data: { currentPhase: 'story' }, expected: 'allow' },
  { id: 'storysessions-help-read', description: 'Authenticated user can read help-storysession', role: 'parent', operation: 'get', path: () => `storySessions/help-storysession`, expected: 'allow' },

  // ========== STORY SESSION MESSAGES TESTS ==========
  { id: 'messages-create', description: 'Parent can create messages in their session', role: 'parent', operation: 'create', path: (ids) => `storySessions/${ids.storySessionId}/messages`, data: { sender: 'child', text: 'Test message' }, expected: 'allow' },
  { id: 'messages-read-own', description: 'Parent can read messages in their session', role: 'parent', operation: 'get', path: (ids) => `storySessions/${ids.storySessionId}/messages/${ids.messageId}`, expected: 'allow' },
  { id: 'messages-read-other', description: 'Parent cannot read messages in other session', role: 'parent', operation: 'get', path: (ids) => `storySessions/${ids.otherStorySessionId}/messages/msg-1`, expected: 'deny' },
  { id: 'messages-help-read', description: 'Authenticated user can read help-storysession messages', role: 'parent', operation: 'get', path: () => `storySessions/help-storysession/messages/demo-msg`, expected: 'allow' },

  // ========== STORY SESSION EVENTS TESTS ==========
  { id: 'events-create', description: 'Parent can create events in their session', role: 'parent', operation: 'create', path: (ids) => `storySessions/${ids.storySessionId}/events`, data: { eventType: 'session_started' }, expected: 'allow' },
  { id: 'events-read-own', description: 'Parent can read events in their session', role: 'parent', operation: 'get', path: (ids) => `storySessions/${ids.storySessionId}/events/evt-1`, expected: 'allow' },
  { id: 'events-help-read', description: 'Authenticated user can read help-storysession events', role: 'parent', operation: 'get', path: () => `storySessions/help-storysession/events/demo-event`, expected: 'allow' },

  // ========== CHARACTERS TESTS ==========
  { id: 'characters-create', description: 'Parent can create a character', role: 'parent', operation: 'create', path: () => `characters`, data: (ids) => ({ ownerParentUid: ids.parentUid, displayName: 'Test Character', role: 'friend' }), expected: 'allow' },
  { id: 'characters-read-own', description: 'Parent can read their own character', role: 'parent', operation: 'get', path: (ids) => `characters/${ids.characterId}`, expected: 'allow' },
  { id: 'characters-read-other', description: 'Parent cannot read other parent\'s character', role: 'parent', operation: 'get', path: (ids) => `characters/${ids.otherCharacterId}`, expected: 'deny' },
  { id: 'characters-update-own', description: 'Parent can update their own character', role: 'parent', operation: 'update', path: (ids) => `characters/${ids.characterId}`, data: { displayName: 'Updated Character' }, expected: 'allow' },
  { id: 'characters-delete-own', description: 'Parent can delete their own character', role: 'parent', operation: 'delete', path: (ids) => `characters/${ids.characterId}`, expected: 'allow' },
  { id: 'characters-help-read', description: 'Authenticated user can read help-character', role: 'parent', operation: 'get', path: () => `characters/help-character`, expected: 'allow' },

  // ========== STORIES TESTS ==========
  { id: 'stories-create', description: 'Parent can create a story', role: 'parent', operation: 'create', path: () => `stories`, data: (ids) => ({ parentUid: ids.parentUid, childId: ids.childId, storySessionId: ids.storySessionId, storyText: 'Once upon a time...' }), expected: 'allow' },
  { id: 'stories-read-own', description: 'Parent can read their own story', role: 'parent', operation: 'get', path: (ids) => `stories/${ids.storyId}`, expected: 'allow' },
  { id: 'stories-read-other', description: 'Parent cannot read other parent\'s story', role: 'parent', operation: 'get', path: (ids) => `stories/${ids.otherStoryId}`, expected: 'deny' },
  { id: 'stories-update-own', description: 'Parent can update their own story', role: 'parent', operation: 'update', path: (ids) => `stories/${ids.storyId}`, data: { storyText: 'Updated story...' }, expected: 'allow' },
  { id: 'stories-help-read', description: 'Authenticated user can read help-story', role: 'parent', operation: 'get', path: () => `stories/help-story`, expected: 'allow' },
  { id: 'stories-help-storybook-read', description: 'Authenticated user can read help-storybook', role: 'parent', operation: 'get', path: () => `stories/help-storybook`, expected: 'allow' },

  // ========== STORY OUTPUTS TESTS ==========
  { id: 'story-outputs-read-own', description: 'Parent can read their story outputs', role: 'parent', operation: 'get', path: (ids) => `stories/${ids.storyId}/outputs/output-1`, expected: 'allow' },
  { id: 'story-outputs-help-read', description: 'Authenticated user can read help-story outputs', role: 'parent', operation: 'get', path: () => `stories/help-story/outputs/demo-output`, expected: 'allow' },

  // ========== STORY PAGES TESTS ==========
  { id: 'story-pages-read-own', description: 'Parent can read their story pages', role: 'parent', operation: 'get', path: (ids) => `stories/${ids.storyId}/outputs/output-1/pages/1`, expected: 'allow' },
  { id: 'story-pages-help-read', description: 'Authenticated user can read help-story pages', role: 'parent', operation: 'get', path: () => `stories/help-story/outputs/demo-output/pages/1`, expected: 'allow' },

  // ========== PRINT ORDERS TESTS ==========
  { id: 'printorders-create', description: 'Parent can create a print order', role: 'parent', operation: 'create', path: () => `printOrders`, data: (ids) => ({ parentUid: ids.parentUid, storyId: ids.storyId, quantity: 1, paymentStatus: 'unpaid', fulfillmentStatus: 'pending' }), expected: 'allow' },
  { id: 'printorders-read-own', description: 'Parent can read their own print order', role: 'parent', operation: 'get', path: (ids) => `printOrders/${ids.printOrderId}`, expected: 'allow' },
  { id: 'printorders-read-other', description: 'Parent cannot read other parent\'s print order', role: 'parent', operation: 'get', path: (ids) => `printOrders/${ids.otherPrintOrderId}`, expected: 'deny' },
  { id: 'printorders-update-own', description: 'Parent can update their own print order', role: 'parent', operation: 'update', path: (ids) => `printOrders/${ids.printOrderId}`, data: { quantity: 2 }, expected: 'allow' },

  // ========== CONFIGURATION COLLECTIONS TESTS ==========
  { id: 'promptconfigs-read-parent', description: 'Parent can read prompt configs', role: 'parent', operation: 'get', path: () => `promptConfigs/config-1`, expected: 'allow' },
  { id: 'promptconfigs-write-parent', description: 'Parent cannot write prompt configs', role: 'parent', operation: 'update', path: () => `promptConfigs/config-1`, data: { version: 2 }, expected: 'deny' },
  { id: 'promptconfigs-write-writer', description: 'Writer can write prompt configs', role: 'writer', operation: 'update', path: () => `promptConfigs/config-1`, data: { version: 2 }, expected: 'allow' },

  { id: 'storyphases-read-parent', description: 'Parent can read story phases', role: 'parent', operation: 'get', path: () => `storyPhases/phase-1`, expected: 'allow' },
  { id: 'storyphases-write-parent', description: 'Parent cannot write story phases', role: 'parent', operation: 'update', path: () => `storyPhases/phase-1`, data: { name: 'Updated' }, expected: 'deny' },
  { id: 'storyphases-write-admin', description: 'Admin can write story phases', role: 'admin', operation: 'update', path: () => `storyPhases/phase-1`, data: { name: 'Updated' }, expected: 'allow' },

  { id: 'storytypes-read-parent', description: 'Parent can read story types', role: 'parent', operation: 'get', path: () => `storyTypes/type-1`, expected: 'allow' },
  { id: 'storytypes-write-parent', description: 'Parent cannot write story types', role: 'parent', operation: 'update', path: () => `storyTypes/type-1`, data: { name: 'Updated' }, expected: 'deny' },

  { id: 'storyoutputtypes-read-parent', description: 'Parent can read story output types', role: 'parent', operation: 'get', path: () => `storyOutputTypes/type-1`, expected: 'allow' },
  { id: 'storyoutputtypes-write-parent', description: 'Parent cannot write story output types', role: 'parent', operation: 'update', path: () => `storyOutputTypes/type-1`, data: { name: 'Updated' }, expected: 'deny' },

  { id: 'printlayouts-read-parent', description: 'Parent can read print layouts', role: 'parent', operation: 'get', path: () => `printLayouts/layout-1`, expected: 'allow' },
  { id: 'printlayouts-write-parent', description: 'Parent cannot write print layouts', role: 'parent', operation: 'update', path: () => `printLayouts/layout-1`, data: { name: 'Updated' }, expected: 'deny' },

  // ========== SYSTEM COLLECTIONS TESTS ==========
  { id: 'aiflowlogs-read-parent', description: 'Parent cannot read AI flow logs', role: 'parent', operation: 'get', path: () => `aiFlowLogs/log-1`, expected: 'deny' },
  { id: 'aiflowlogs-write-parent', description: 'Parent cannot write AI flow logs', role: 'parent', operation: 'create', path: () => `aiFlowLogs`, data: { flowName: 'test' }, expected: 'deny' },
  { id: 'aiflowlogs-read-admin', description: 'Admin can read AI flow logs', role: 'admin', operation: 'get', path: () => `aiFlowLogs/log-1`, expected: 'allow' },

  { id: 'helpwizards-read-parent', description: 'Parent can read help wizards', role: 'parent', operation: 'get', path: () => `helpWizards/wizard-1`, expected: 'allow' },
  { id: 'helpwizards-write-parent', description: 'Parent cannot write help wizards', role: 'parent', operation: 'update', path: () => `helpWizards/wizard-1`, data: { title: 'Updated' }, expected: 'deny' },

  // ========== UNAUTHENTICATED TESTS (RUN LAST) ==========
  // These tests sign out the user, so they must run after all authenticated tests
  { id: 'users-unauth-read', description: 'Unauthenticated cannot read user profiles', role: 'unauthenticated', operation: 'get', path: (ids) => `users/${ids.parentUid}`, expected: 'deny' },
  { id: 'promptconfigs-read-unauth', description: 'Unauthenticated cannot read prompt configs', role: 'unauthenticated', operation: 'get', path: () => `promptConfigs/config-1`, expected: 'deny' },
  { id: 'helpwizards-read-unauth', description: 'Unauthenticated cannot read help wizards', role: 'unauthenticated', operation: 'get', path: () => `helpWizards/wizard-1`, expected: 'deny' },
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
  const [setupDiagnostics, setSetupDiagnostics] = useState<SetupDiagnosticStep[]>([]);
  const [capturedRoles, setCapturedRoles] = useState<{ isAdmin: boolean; isWriter: boolean; isParent: boolean } | null>(null);

  const roles = useMemo(() => {
    return {
      isAdmin: !!idTokenResult?.claims.isAdmin,
      isWriter: !!idTokenResult?.claims.isWriter,
      isParent: !!idTokenResult?.claims.isParent,
    };
  }, [idTokenResult]);

  const executeTest = useCallback(async (testCase: TestCase, ids: Record<string, string>, currentUser: User | null): Promise<{ permitted: boolean; error: string | null }> => {
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
          // For create, path is the collection, data is the payload
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
    } catch (e: unknown) {
      // Any error is considered a failure for the operation
      return { permitted: false, error: formatFirebaseError(e) };
    }
  }, [firestore]);


  const runTests = async () => {
    if (!firestore) return;
    setIsRunning(true);
    setResults([]);
    setProgress(0);
    const allTestResults: TestResult[] = [];
    const setupSteps: SetupDiagnosticStep[] = [];
    setSetupDiagnostics(setupSteps);

    let tempAuth = auth;
    let currentUser: User | null = tempAuth?.currentUser ?? null;

    // Capture roles at START of test run, before any signout occurs
    const initialRoles = {
      isAdmin: !!idTokenResult?.claims.isAdmin,
      isWriter: !!idTokenResult?.claims.isWriter,
      isParent: !!idTokenResult?.claims.isParent,
    };
    setCapturedRoles(initialRoles);

    try {
      const testIds: Record<string, string> = {
        parentUid: currentUser?.uid ?? 'test-parent-unauthed',
        otherParentUid: 'other-parent-uid',
      };

      // --- Setup initial data step-by-step ---
      const setupDoc = async (stepName: string, docRef: DocumentReference, data: Record<string, any>) => {
        const step: SetupDiagnosticStep = { step: stepName, status: 'pending', path: docRef.path };
        setupSteps.push(step);
        setSetupDiagnostics([...setupSteps]);
        try {
          await setDoc(docRef, { ...data, rulesTest: true });
          step.status = 'pass';
        } catch (e) {
          step.status = 'fail';
          step.error = formatFirebaseError(e);
          setSetupDiagnostics([...setupSteps]);
          throw e; // Stop the setup process
        }
        setSetupDiagnostics([...setupSteps]);
      };

      // 1. Own child
      const childRef = doc(collection(firestore, 'children'));
      testIds.childId = childRef.id;
      await setupDoc('Create own child', childRef, { ownerParentUid: testIds.parentUid, displayName: 'Owned Child' });

      // 2. Sibling
      const siblingRef = doc(collection(firestore, 'children'));
      testIds.siblingId = siblingRef.id;
      await setupDoc('Create sibling child', siblingRef, { ownerParentUid: testIds.parentUid, displayName: 'Sibling' });

      // 3. Other Child (if admin) - for parents, this will just be a simulated ID.
      if (roles.isAdmin) {
        const otherChildRef = doc(collection(firestore, 'children'));
        testIds.otherChildId = otherChildRef.id;
        await setupDoc('Create other child', otherChildRef, { ownerParentUid: testIds.otherParentUid, displayName: 'Other Child' });
      } else {
        testIds.otherChildId = 'simulated-other-child-id-for-parent';
      }

      // 4. Legacy session under child
      const sessionRef = doc(collection(firestore, `children/${testIds.childId}/sessions`));
      testIds.sessionId = sessionRef.id;
      await setupDoc('Create child session', sessionRef, { parentUid: testIds.parentUid, status: 'completed' });

      // 5. Story session
      const storySessionRef = doc(collection(firestore, 'storySessions'));
      testIds.storySessionId = storySessionRef.id;
      await setupDoc('Create story session', storySessionRef, { parentUid: testIds.parentUid, childId: testIds.childId, status: 'in_progress', currentPhase: 'warmup' });

      // 6. Other story session (simulated for parents, real for admins)
      if (roles.isAdmin) {
        const otherStorySessionRef = doc(collection(firestore, 'storySessions'));
        testIds.otherStorySessionId = otherStorySessionRef.id;
        await setupDoc('Create other story session', otherStorySessionRef, { parentUid: testIds.otherParentUid, childId: testIds.otherChildId, status: 'in_progress', currentPhase: 'warmup' });
      } else {
        testIds.otherStorySessionId = 'simulated-other-story-session-id';
      }

      // 7. Message in story session
      const messageRef = doc(collection(firestore, `storySessions/${testIds.storySessionId}/messages`));
      testIds.messageId = messageRef.id;
      await setupDoc('Create session message', messageRef, { sender: 'child', text: 'Hello!' });

      // 8. Character
      const characterRef = doc(collection(firestore, 'characters'));
      testIds.characterId = characterRef.id;
      await setupDoc('Create character', characterRef, { ownerParentUid: testIds.parentUid, displayName: 'Test Character', role: 'friend' });

      // 9. Other character (simulated for parents, real for admins)
      if (roles.isAdmin) {
        const otherCharacterRef = doc(collection(firestore, 'characters'));
        testIds.otherCharacterId = otherCharacterRef.id;
        await setupDoc('Create other character', otherCharacterRef, { ownerParentUid: testIds.otherParentUid, displayName: 'Other Character', role: 'pet' });
      } else {
        testIds.otherCharacterId = 'simulated-other-character-id';
      }

      // 10. Story
      const storyRef = doc(collection(firestore, 'stories'));
      testIds.storyId = storyRef.id;
      await setupDoc('Create story', storyRef, { parentUid: testIds.parentUid, childId: testIds.childId, storySessionId: testIds.storySessionId, storyText: 'Once upon a time...' });

      // 11. Other story (simulated for parents, real for admins)
      if (roles.isAdmin) {
        const otherStoryRef = doc(collection(firestore, 'stories'));
        testIds.otherStoryId = otherStoryRef.id;
        await setupDoc('Create other story', otherStoryRef, { parentUid: testIds.otherParentUid, childId: testIds.otherChildId, storySessionId: testIds.otherStorySessionId, storyText: 'Another story...' });
      } else {
        testIds.otherStoryId = 'simulated-other-story-id';
      }

      // 12. Print order
      const printOrderRef = doc(collection(firestore, 'printOrders'));
      testIds.printOrderId = printOrderRef.id;
      await setupDoc('Create print order', printOrderRef, { parentUid: testIds.parentUid, storyId: testIds.storyId, quantity: 1, paymentStatus: 'unpaid', fulfillmentStatus: 'pending' });

      // 13. Other print order (simulated for parents, real for admins)
      if (roles.isAdmin) {
        const otherPrintOrderRef = doc(collection(firestore, 'printOrders'));
        testIds.otherPrintOrderId = otherPrintOrderRef.id;
        await setupDoc('Create other print order', otherPrintOrderRef, { parentUid: testIds.otherParentUid, storyId: testIds.otherStoryId, quantity: 2, paymentStatus: 'unpaid', fulfillmentStatus: 'pending' });
      } else {
        testIds.otherPrintOrderId = 'simulated-other-print-order-id';
      }

      // --- Run Tests ---
      // Track initial user to restore auth state between tests
      const initialUser = currentUser;
      let wasSignedOut = false;

      for (let i = 0; i < testCases.length; i++) {
        const testCase = testCases[i];
        const result: TestResult = { case: testCase, status: 'running', error: undefined };
        allTestResults.push(result);
        setResults([...allTestResults]);
        setProgress(((i + 1) / testCases.length) * 100);

        try {
          // Skip tests that require different roles than what we have
          if (testCase.role !== 'parent' && testCase.role !== 'unauthenticated') {
            result.status = 'pending';
            result.error = `Skipping: Manual login required for role '${testCase.role}'`;
            setResults([...allTestResults]);
            continue;
          }

          // Handle authentication state for this test
          if (testCase.role === 'unauthenticated') {
            // Sign out if currently signed in
            if (!wasSignedOut && tempAuth?.currentUser) {
              await signOut(tempAuth);
              wasSignedOut = true;
            }
          } else if (testCase.role === 'parent') {
            // Re-authenticate if we were signed out
            if (wasSignedOut) {
              // Cannot automatically re-authenticate - user must refresh page
              result.status = 'pending';
              result.error = 'Cannot run parent tests after unauthenticated tests - please refresh the page and run tests again, skipping unauthenticated tests';
              setResults([...allTestResults]);
              continue;
            }
            // Verify user is still authenticated
            if (!tempAuth?.currentUser) {
              throw new Error("A logged-in parent is required to run parent tests.");
            }
          }

          const { permitted, error } = await executeTest(testCase, testIds, tempAuth?.currentUser ?? null);
          const expectedToPass = testCase.expected === 'allow';

          if (expectedToPass === permitted) {
            result.status = 'pass';
            result.error = permitted ? undefined : error ?? 'Blocked as expected';
          } else {
            result.status = 'fail';
            result.error = error || `Expected '${testCase.expected}' but operation was ${permitted ? 'allowed' : 'denied'}.`;
          }
        } catch (e: unknown) {
          result.status = 'fail';
          result.error = `[RUNNER_CRASH] ${formatFirebaseError(e)}`;
        }
        setResults([...allTestResults]);
      }
    } catch (error: unknown) {
      allTestResults.push({
        case: {
          id: 'runner-error',
          description: 'Test runner failed before completing. Check permissions or setup.',
          role: 'parent',
          operation: 'get',
          path: 'test-runner',
          expected: 'allow',
        },
        status: 'fail',
        error: formatFirebaseError(error),
      });
      setResults(allTestResults);
      toast({ title: 'Test run failed', description: formatFirebaseError(error), variant: 'destructive' });
    } finally {
      setIsRunning(false);
    }
  };
  
  const cleanupData = async () => {
    if (!firestore) return;
    setIsCleaning(true);
    const batch = writeBatch(firestore);
    // CRITICAL: Removed 'users' from this array to prevent deleting live user data.
    const collections = ['children', 'storySessions', 'characters', 'stories', 'printOrders'];
    let count = 0;

    for (const coll of collections) {
        try {
            const q = query(collection(firestore, coll), where('rulesTest', '==', true));
            const snapshot = await getDocs(q);
            snapshot.forEach(doc => {
                batch.delete(doc.ref);
                count++;
            });
        } catch(e) {
            console.warn(`Cleanup failed for collection: ${coll}. This might be expected if rules block list access.`)
        }
    }

    try {
        await batch.commit();
        toast({ title: 'Cleanup Complete', description: `Attempted to delete ${count} test documents.` });
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
          roles: capturedRoles || roles,
      },
      setup: setupDiagnostics,
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
                  <TableCell className="text-xs text-destructive font-mono">{result.error}</TableCell>
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
