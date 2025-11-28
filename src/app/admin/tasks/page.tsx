'use client';

import { useState } from 'react';
import { useAdminStatus } from '@/hooks/use-admin-status';
import { useUser } from '@/firebase/auth/use-user';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { LoaderCircle } from 'lucide-react';

export default function AdminTasksPage() {
  const { isAdmin, loading: adminLoading, error } = useAdminStatus();
  const { user } = useUser();
  const [isRunning, setIsRunning] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [errorEntries, setErrorEntries] = useState<Array<{ id: string; reason: string }> | null>(null);

  const handleMigration = async () => {
    if (!user) return;
    setIsRunning(true);
    setResult(null);
    setErrorMessage(null);
    try {
      const idToken = await user.getIdToken();
      const response = await fetch('/api/admin/migrations/story-sessions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${idToken}`,
        },
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.message || 'Migration failed.');
      }
      setResult(`Migrated ${data.migrated} of ${data.total} sessions. Deleted ${data.deleted ?? 0}. Skipped ${data.skipped}.`);
      setErrorEntries(Array.isArray(data.errors) ? data.errors : null);
    } catch (err: any) {
      setErrorMessage(err.message);
      setErrorEntries(null);
    } finally {
      setIsRunning(false);
    }
  };

  if (adminLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <LoaderCircle className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  if (error || !isAdmin) {
    return <div className="p-8 text-center text-destructive">Admin access required.</div>;
  }

  return (
    <div className="container mx-auto px-4 py-8">
      <Card>
        <CardHeader>
          <CardTitle>Admin Maintenance Tasks</CardTitle>
          <CardDescription>One-off utilities for migrating data and performing maintenance.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="rounded-lg border p-4">
            <h3 className="text-lg font-semibold">Story Sessions → Child Sessions</h3>
            <p className="text-sm text-muted-foreground">
              Copies legacy <code>/storySessions</code> documents under each child (<code>/children/{'{childId}'}/sessions</code>),
              adds missing <code>parentUid</code>, and mirrors messages.
            </p>
            <Button className="mt-3" onClick={handleMigration} disabled={isRunning}>
              {isRunning ? (
                <>
                  <LoaderCircle className="mr-2 h-4 w-4 animate-spin" />
                  Running...
                </>
              ) : (
                'Run Migration'
              )}
            </Button>
            {result && <p className="mt-3 text-sm text-green-600">{result}</p>}
            {errorMessage && <p className="mt-3 text-sm text-destructive">{errorMessage}</p>}
            {errorEntries && errorEntries.length > 0 && (
              <div className="mt-4 max-h-64 overflow-auto rounded-md border bg-muted/30 p-3 text-sm">
                <p className="font-semibold">Skipped documents ({errorEntries.length}):</p>
                <ul className="mt-2 space-y-1">
                  {errorEntries.slice(0, 50).map((entry) => (
                    <li key={entry.id} className="break-all">
                      <span className="font-mono text-xs">{entry.id}</span>: {entry.reason}
                    </li>
                  ))}
                </ul>
                {errorEntries.length > 50 && (
                  <p className="mt-2 text-xs text-muted-foreground">
                    Showing first 50 errors. Check the network response for the full list.
                  </p>
                )}
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {errorEntries && errorEntries.length > 0 && (
        <Card className="mt-6">
          <CardHeader>
            <CardTitle>Migration Diagnostics</CardTitle>
            <CardDescription>Skipped or deleted sessions.</CardDescription>
          </CardHeader>
          <CardContent className="max-h-80 overflow-auto text-sm space-y-1">
            {errorEntries.map((entry) => (
              <div key={entry.id} className="break-all">
                <span className="font-mono text-xs">{entry.id}</span>: {entry.reason}
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
