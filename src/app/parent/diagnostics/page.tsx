
'use client';

import { useMemo } from 'react';
import { useUser } from '@/firebase/auth/use-user';
import { useFirestore } from '@/firebase';
import { collection, query, where } from 'firebase/firestore';
import { useCollection } from '@/lib/firestore-hooks';
import type { ChildProfile } from '@/lib/types';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { useParentGuard } from '@/hooks/use-parent-guard';

export default function ParentDiagnosticsPage() {
  const { user, idTokenResult, loading: userLoading } = useUser();
  const firestore = useFirestore();
  const { isParentGuardValidated } = useParentGuard();

  const childrenQuery = useMemo(() => {
    if (!user || !firestore) return null;
    return query(collection(firestore, 'children'), where('ownerParentUid', '==', user.uid));
  }, [user, firestore]);

  const { data: children, loading: childrenLoading, error: childrenError } = useCollection<ChildProfile>(childrenQuery);

  const diagnostics = {
    auth: {
      userLoading,
      isAuthenticated: !!user,
      uid: user?.uid ?? null,
      email: user?.email ?? null,
      claims: idTokenResult?.claims ?? null,
    },
    parentGuard: {
      isParentGuardValidated,
    },
    firestoreQuery: {
      isQuerying: !!childrenQuery,
      queryString: childrenQuery ? `collection('children').where('ownerParentUid', '==', '${user?.uid}')` : 'Query not built (user or firestore not ready).',
    },
    firestoreResult: {
      childrenLoading,
      error: childrenError ? { name: childrenError.name, message: childrenError.message, code: (childrenError as any).code } : null,
      childCount: children?.length ?? null,
      children: children,
    },
  };

  return (
    <div className="container mx-auto p-4">
      <Card>
        <CardHeader>
          <CardTitle>Parent Diagnostics</CardTitle>
          <CardDescription>
            This page runs a query to list your children to help diagnose permission issues.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <pre className="bg-muted p-4 rounded-lg overflow-x-auto text-sm">
            <code>{JSON.stringify(diagnostics, null, 2)}</code>
          </pre>
        </CardContent>
      </Card>
    </div>
  );
}
