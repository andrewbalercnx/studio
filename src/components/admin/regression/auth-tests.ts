'use client';

import { collection, getDocs, query, where, limit } from 'firebase/firestore';
import { api } from '@/lib/api';
import { AuthSummary, addRegressionMeta } from '@/components/admin/regression/shared';
import type { RegressionContext } from './context';

/** Regression scenarios run from the admin regression page. */
export async function runAuthTests({ firestore, auth, updateTestResult }: RegressionContext): Promise<AuthSummary> {
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
        let tempWriterConfigId: string | null = null;
        try {
            await getDocs(query(collection(firestore!, 'promptConfigs'), limit(1)));
            await getDocs(query(collection(firestore!, 'storyTypes'), limit(1)));
            // Config is written through the catalog route (slice 6.4a); the rules refuse browser writes.
            tempWriterConfigId = (
                await api.catalog.admin.create('promptConfigs', addRegressionMeta({ phase: 'test' }, 'DATA_AUTH_WRITER_CONFIGS'))
            ).id;
            
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
            if (tempWriterConfigId) {
                await api.catalog.admin.remove('promptConfigs', tempWriterConfigId);
            }
        }

        if (writerTestPassed) {
            updateTestResult('DATA_AUTH_WRITER_CONFIGS', { status: 'PASS', message: 'Writer can manage configs and is blocked from children.' });
        } else {
            updateTestResult('DATA_AUTH_WRITER_CONFIGS', { status: 'FAIL', message: failMessage });
        }
    }
    return summary;
}
