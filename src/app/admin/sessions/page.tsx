
'use client';

import { useAdminStatus } from '@/hooks/use-admin-status';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { LoaderCircle, RefreshCw } from 'lucide-react';
import { DiagnosticsPanel } from '@/components/diagnostics-panel';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { useUser } from '@/firebase/auth/use-user';

// Shape returned by GET /api/admin/sessions (server-computed, including lastError summary)
type AdminSessionRow = {
  id: string;
  childId: string | null;
  status: string | null;
  currentPhase: string | null;
  storyTitle: string | null;
  storyMode: string | null;
  promptConfigId: string | null;
  promptConfigLevelBand: string | null;
  createdAtMs: number | null;
  updatedAtMs: number | null;
  lastError: {
    flowName: string;
    message: string;
    status: string;
    atMs: number | null;
  } | null;
};

export default function AdminSessionsPage() {
  const { isAuthenticated, isAdmin, isWriter, email, loading: authLoading } = useAdminStatus();
  const { user } = useUser();

  const [sessions, setSessions] = useState<AdminSessionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadSessions = useCallback(async () => {
    if (!user) return;
    try {
      setLoading(true);
      setError(null);
      const idToken = await user.getIdToken();
      const response = await fetch('/api/admin/sessions', {
        headers: { Authorization: `Bearer ${idToken}` },
      });
      const data = await response.json();
      if (!response.ok || data.ok !== true) {
        throw new Error(data.errorMessage || 'Failed to load story sessions');
      }
      setSessions(data.sessions || []);
    } catch (e: any) {
      console.error('Error fetching story sessions:', e);
      setError(e.message || 'Could not fetch story sessions.');
      setSessions([]);
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    if (!authLoading && user && (isAdmin || isWriter)) {
      loadSessions();
    } else if (!authLoading) {
      setLoading(false);
    }
  }, [authLoading, user, isAdmin, isWriter, loadSessions]);

  const formatTime = (ms: number | null) => (ms ? new Date(ms).toLocaleString() : '-');

  const diagnostics = {
    page: 'admin-sessions',
    auth: {
      isAuthenticated,
      email,
      isAdmin,
      loading: authLoading,
      error: null,
    },
    api: {
      endpoint: '/api/admin/sessions',
      count: sessions.length,
      sampleIds: sessions.slice(0, 3).map(s => s.id),
      withErrors: sessions.filter(s => s.lastError).length,
    },
    ...(error ? { apiErrorSessions: error } : {})
  };

  const renderContent = () => {
    if (authLoading || loading) {
      return <div className="flex items-center gap-2"><LoaderCircle className="h-5 w-5 animate-spin" /><span>Loading story sessions...</span></div>;
    }
    if (!isAuthenticated) {
      return <p>You must be signed in to access admin pages.</p>;
    }
    if (!isAdmin && !isWriter) {
      return <p>You are signed in but do not have admin or writer rights.</p>;
    }
    if (error) {
        return <p className="text-destructive">{error}</p>;
    }
    if (sessions.length === 0) {
        return (
            <div className="text-center py-8 border-2 border-dashed rounded-lg">
                <p className="text-muted-foreground">No story sessions found.</p>
            </div>
        )
    }

    return (
      <Table>
          <TableHeader>
              <TableRow>
                  <TableHead>ID</TableHead>
                  <TableHead>Child ID</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Phase</TableHead>
                  <TableHead>Title</TableHead>
                  <TableHead>Updated</TableHead>
                  <TableHead>Last Error</TableHead>
              </TableRow>
          </TableHeader>
          <TableBody>
              {sessions.map((session) => (
                  <TableRow key={session.id} className={session.lastError ? 'bg-red-50/50' : undefined}>
                      <TableCell className="font-mono text-xs">{session.id}</TableCell>
                      <TableCell className="font-mono text-xs">{session.childId || '-'}</TableCell>
                      <TableCell>{session.status || '-'}</TableCell>
                      <TableCell>{session.currentPhase || '-'}</TableCell>
                      <TableCell>{session.storyTitle || '-'}</TableCell>
                      <TableCell className="text-xs whitespace-nowrap">{formatTime(session.updatedAtMs)}</TableCell>
                      <TableCell className="max-w-md">
                          {session.lastError ? (
                              <div className="text-xs">
                                  <span className="inline-block px-1.5 py-0.5 rounded bg-red-100 text-red-800 font-medium mr-1">
                                      {session.lastError.flowName}
                                  </span>
                                  <span className="text-red-700" title={session.lastError.message}>
                                      {session.lastError.message.length > 120
                                        ? `${session.lastError.message.slice(0, 120)}…`
                                        : session.lastError.message}
                                  </span>
                              </div>
                          ) : (
                              <span className="text-muted-foreground text-xs">-</span>
                          )}
                      </TableCell>
                  </TableRow>
              ))}
          </TableBody>
      </Table>
    );
  };

  return (
    <div className="container mx-auto p-4 sm:p-6 md:p-8">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Story Sessions</CardTitle>
              <CardDescription>
                Recent story sessions (latest 100) with failure reasons surfaced from the AI flow logs.
              </CardDescription>
            </div>
            <Button variant="outline" size="sm" onClick={loadSessions} disabled={loading}>
              <RefreshCw className={`mr-2 h-4 w-4 ${loading ? 'animate-spin' : ''}`} /> Refresh
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {renderContent()}
        </CardContent>
      </Card>

      <DiagnosticsPanel pageName="admin-sessions" data={diagnostics} className="mt-8" />
    </div>
  );
}
