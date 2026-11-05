'use client';
import { collection, getDocs, doc, deleteDoc } from 'firebase/firestore';
import type { Firestore } from 'firebase/firestore';
import { api } from '@/lib/api';

export type TestStatus = 'PENDING' | 'PASS' | 'FAIL' | 'ERROR' | 'SKIP';

export type TestResult = {
  id: string;
  name: string;
  status: TestStatus;
  message: string;
  details?: any;
};

export type AuthSummary = {
    uid: string | null;
    email: string | null;
    isAdmin: boolean;
    isWriter: boolean;
    isParent: boolean;
    rawClaims?: Record<string, unknown>;
};

export const REGRESSION_SUITE_TAG = 'admin-regression';

export type RegressionArtifactTracker = {
    children: Set<string>;
    sessions: Set<string>;
    characters: Set<string>;
    stories: Set<string>;
    promptConfigs: Set<string>;
    printOrders: Set<string>;
    printLayouts: Set<string>;
};

export const createArtifactTracker = (): RegressionArtifactTracker => ({
    children: new Set(),
    sessions: new Set(),
    characters: new Set(),
    stories: new Set(),
    promptConfigs: new Set(),
    printOrders: new Set(),
    printLayouts: new Set(),
});

export const addRegressionMeta = <T extends Record<string, any>>(data: T, scenarioId: string) => ({
    ...data,
    regressionTest: true,
    regressionTag: `${REGRESSION_SUITE_TAG}:${scenarioId}`,
});

export const trackArtifact = (
    tracker: RegressionArtifactTracker,
    category: keyof RegressionArtifactTracker,
    id: string | null | undefined
) => {
    if (id) {
        tracker[category].add(id);
    }
};

export const tracedCollection = (
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

export const deleteSubcollectionDocs = async (firestore: Firestore, segments: string[]) => {
    const collectionRef = collection(firestore, ...(segments as [string, ...string[]]));
    const snapshot = await getDocs(collectionRef);
    await Promise.all(snapshot.docs.map((docSnap) => deleteDoc(docSnap.ref)));
};

export const cleanupRegressionArtifacts = async (firestore: Firestore, tracker: RegressionArtifactTracker) => {
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
            await api.catalog.admin.remove('promptConfigs', configId);
        });
    }
    for (const layoutId of tracker.printLayouts) {
        await deleteWithLogging(`printLayouts/${layoutId}`, async () => {
            await api.catalog.admin.remove('printLayouts', layoutId);
        });
    }
};

export const initialTests: TestResult[] = [
  { id: 'DATA_AUTH_CLAIMS', name: 'Auth: Claims Visibility', status: 'PENDING', message: '' },
  { id: 'DATA_AUTH_ADMIN_FIRESTORE', name: 'Auth: Admin Firestore Access', status: 'PENDING', message: '' },
  { id: 'DATA_AUTH_PARENT_CHILDREN', name: 'Auth: Parent Child Access', status: 'PENDING', message: '' },
  { id: 'DATA_AUTH_WRITER_CONFIGS', name: 'Auth: Writer Config Access', status: 'PENDING', message: '' },
  { id: 'API_BOOKS_V3_AUTH', name: 'API: /api/manuscripts + /api/books + print renders (Auth + Not Found)', status: 'PENDING', message: '' },
  { id: 'API_STORIES_V3_AUTH', name: 'API: /api/stories + turns/abandon/finish (Auth + Not Found)', status: 'PENDING', message: '' },
  { id: 'API_STORIES_READ', name: 'API: GET /api/stories, /api/stories/{id}, /api/creation-modes (Auth + shape)', status: 'PENDING', message: '' },
  { id: 'API_ADMIN_ALLOWANCES', name: 'API: /api/admin/allowances (admin only, read own family)', status: 'PENDING', message: '' },
  { id: 'API_LIBRARY_SUMMARY', name: 'API: /api/library/summary (auth + shape)', status: 'PENDING', message: '' },
  { id: 'API_ADMIN_TRACE', name: 'API: /api/admin/trace (admin only, id required, 404)', status: 'PENDING', message: '' },
  { id: 'API_PERSONA', name: 'API: /api/persona (auth + childId validation)', status: 'PENDING', message: '' },
  { id: 'API_VERIFY_PIN_LOCKOUT', name: 'API: /api/parent/verify-pin (lockout policy dry-run)', status: 'PENDING', message: '' },
  { id: 'API_USER_ONBOARDING_GET', name: 'API: /api/user/onboarding (GET shape)', status: 'PENDING', message: '' },
  { id: 'API_USER_ONBOARDING_POST', name: 'API: /api/user/onboarding (POST validation)', status: 'PENDING', message: '' },
  { id: 'API_ADMIN_OPS_METRICS', name: 'API: /api/admin/ops/metrics (GET shape)', status: 'PENDING', message: '' },
  { id: 'API_ADMIN_OPS_HEALTH_CHECK', name: 'API: /api/admin/ops/health-check (POST dry-run)', status: 'PENDING', message: '' },
  { id: 'API_HEALTH', name: 'API: /api/health (version + dependency probe)', status: 'PENDING', message: '' },
  { id: 'API_AUTH_PASSWORD_RESET', name: 'API: /api/auth/password-reset (validation only, sends nothing)', status: 'PENDING', message: '' },
  { id: 'API_ROUTE_AUTH_ANON', name: 'API: protected routes reject anonymous calls (401)', status: 'PENDING', message: '' },
  { id: 'API_FLAGS', name: 'API: /api/flags (server-evaluated feature flags)', status: 'PENDING', message: '' },
  { id: 'API_FEEDBACK_POST_VALIDATION', name: 'API: /api/feedback (POST validation)', status: 'PENDING', message: '' },
  { id: 'API_FEEDBACK_ELIGIBILITY', name: 'API: /api/feedback/eligibility (GET shape)', status: 'PENDING', message: '' },
  { id: 'API_TICKETS_GET', name: 'API: /api/tickets (GET shape)', status: 'PENDING', message: '' },
  { id: 'API_REPORT_ISSUE_VALIDATION', name: 'API: /api/report-issue (POST validation)', status: 'PENDING', message: '' },
  { id: 'API_MY_ORDERS_TIMELINE', name: 'API: GET /api/orders (timeline and actions)', status: 'PENDING', message: '' },
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
  { id: 'SCENARIO_LIKENESS_PHOTO_JOBS', name: 'Scenario: Photo Upload Queues Appearance and Portrait', status: 'PENDING', message: '' },
];

export const resetTestState = (): TestResult[] =>
  initialTests.map((test) => ({
    ...test,
    status: 'PENDING',
    message: '',
    details: undefined,
  }));

export const totalTests = initialTests.length;
