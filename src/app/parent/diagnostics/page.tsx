
'use client';

import { useMemo } from 'react';
import { useUser } from '@/firebase/auth/use-user';
import { useFirestore } from '@/firebase';
import { collection, query, where } from 'firebase/firestore';
import { useCollection } from '@/lib/firestore-hooks';
import type { ChildProfile } from '@/lib/types';
import { LoaderCircle, AlertTriangle } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import Link from 'next/link';
import { useParentGuard } from '@/hooks/use-parent-guard';

export default function ParentDiagnosticsPage() {
  const { user, loading: userLoading, idTokenResult } = useUser();
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
      queryString: childrenQuery ? `collection('children').where('ownerParentUid', '==', '${user?.uid}')` : 'Query not constructed',
    },
    firestoreResult: {
      childrenLoading,
      error: childrenError ? { name: childrenError.name, message: childrenError.message, code: (childrenError as any).code } : null,
      childCount: children?.length ?? null,
      children: children,
    },
  };

  const renderContent = () => {
    if (userLoading) {
      return (
        <div className="flex items-center justify-center py-8">
          <LoaderCircle className="h-8 w-8 animate-spin" />
          <p className="ml-4">Verifying authentication...</p>
        </div>
      );
    }

    if (!user) {
      return (
        <div className="text-center">
          <p className="text-destructive">Authentication failed. Please sign in.</p>
          <Button asChild variant="link"><Link href="/login">Sign In</Link></Button>
        </div>
      );
    }

    if (childrenError) {
      return (
        <div className="rounded-lg border border-destructive bg-destructive/10 p-4">
          <div className="flex items-center gap-3">
            <AlertTriangle className="h-6 w-6 text-destructive" />
            <h3 className="text-lg font-semibold text-destructive">Firestore Permission Error</h3>
          </div>
          <p className="mt-2 text-sm text-destructive-foreground">The query to list your children was denied by security rules.</p>
        </div>
      );
    }
    
     if (childrenLoading) {
      return (
        <div className="flex items-center justify-center py-8">
          <LoaderCircle className="h-8 w-8 animate-spin" />
          <p className="ml-4">Fetching children...</p>
        </div>
      );
    }

    return (
       <div className="rounded-lg border border-green-500 bg-green-50 p-4">
          <h3 className="text-lg font-semibold text-green-800">Success!</h3>
          <p className="mt-2 text-sm text-green-700">Successfully fetched {children?.length ?? 0} child profile(s).</p>
       </div>
    );
  };

  return (
    <div className="container mx-auto max-w-4xl p-4 sm:p-6 md:p-8">
      <Card>
        <CardHeader>
          <CardTitle>Parent Diagnostics</CardTitle>
          <CardDescription>This page attempts to load your children's profiles and displays the results to help diagnose permission issues.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {renderContent()}
          <Card className="bg-muted/50">
            <CardHeader>
              <CardTitle className="text-base">Detailed Diagnostics</CardTitle>
            </CardHeader>
            <CardContent>
              <pre className="text-xs overflow-x-auto rounded-md bg-background p-4">
                <code>{JSON.stringify(diagnostics, null, 2)}</code>
              </pre>
            </CardContent>
          </Card>
           <Button asChild variant="outline">
            <Link href="/parent">Continue to Parent Dashboard</Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
