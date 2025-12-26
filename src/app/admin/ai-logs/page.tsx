
'use client';

import { useAdminStatus } from '@/hooks/use-admin-status';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { LoaderCircle } from 'lucide-react';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { useEffect, useState } from 'react';
import { useFirestore } from '@/firebase';
import { collection, onSnapshot, query, orderBy, limit } from 'firebase/firestore';
import type { AIFlowLog } from '@/lib/types';
import { Badge } from '@/components/ui/badge';
import { formatDistanceToNow } from 'date-fns';

function formatTimestamp(timestamp: any): string {
  if (!timestamp) return 'N/A';
  try {
    const date = timestamp.toDate();
    return `${formatDistanceToNow(date, { addSuffix: true })} (${date.toLocaleTimeString()})`;
  } catch (e) {
    return 'Invalid Date';
  }
}

export default function AdminAILogsPage() {
  const { isAuthenticated, isAdmin, loading: authLoading } = useAdminStatus();
  const firestore = useFirestore();

  const [logs, setLogs] = useState<AIFlowLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!firestore || !isAdmin) {
      setLoading(false);
      return;
    }
    
    setLoading(true);
    const logsRef = collection(firestore, 'aiFlowLogs');
    const q = query(logsRef, orderBy('createdAt', 'desc'), limit(50));
    
    const unsubscribe = onSnapshot(q, 
      (snapshot) => {
        const logList = snapshot.docs.map(d => ({ ...d.data(), id: d.id }) as AIFlowLog);
        setLogs(logList);
        setLoading(false);
        setError(null);
      },
      (err) => {
        console.error("Error fetching AI flow logs:", err);
        setError("Could not fetch AI logs. Check Firestore rules and collection name.");
        setLogs([]);
        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, [firestore, isAdmin]);
  

  const renderContent = () => {
    if (authLoading || loading) {
      return <div className="flex items-center gap-2"><LoaderCircle className="h-5 w-5 animate-spin" /><span>Loading logs...</span></div>;
    }
    if (!isAuthenticated || !isAdmin) {
      return <p>You must be an admin to view this page.</p>;
    }
    if (error) {
        return <p className="text-destructive">{error}</p>;
    }
    if (logs.length === 0) {
        return (
            <div className="text-center py-8 border-2 border-dashed rounded-lg">
                <p className="text-muted-foreground mb-4">No AI flow logs found yet.</p>
            </div>
        )
    }

    return (
      <Accordion type="single" collapsible className="w-full">
        {logs.map((log) => (
          <AccordionItem key={log.id} value={log.id}>
            <AccordionTrigger className="hover:no-underline">
              <div className="flex items-center justify-between w-full pr-4">
                <div className="flex items-center gap-4 text-sm">
                  <Badge variant={log.status === 'success' ? 'default' : 'destructive'} className="capitalize w-20 justify-center">{log.status}</Badge>
                  <span className="font-semibold">{log.flowName}</span>
                </div>
                <span className="text-xs text-muted-foreground font-mono">{formatTimestamp(log.createdAt)}</span>
              </div>
            </AccordionTrigger>
            <AccordionContent>
              <div className="space-y-4 p-4 bg-muted/50 rounded-lg">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
                    <p><strong className="text-muted-foreground">Session ID:</strong> {log.sessionId || 'N/A'}</p>
                    <p><strong className="text-muted-foreground">Parent ID:</strong> {log.parentId || 'N/A'}</p>
                    <p><strong className="text-muted-foreground">Model:</strong> {log.response?.model || 'N/A'}</p>
                    <p><strong className="text-muted-foreground">Latency:</strong> {log.latencyMs != null ? `${log.latencyMs}ms` : 'N/A'}</p>
                </div>
                {log.usage && (
                  <div className="grid grid-cols-2 md:grid-cols-5 gap-2 text-xs bg-blue-50 dark:bg-blue-950 p-2 rounded-md">
                    <p><strong className="text-muted-foreground">Input Tokens:</strong> {log.usage.inputTokens ?? 'N/A'}</p>
                    <p><strong className="text-muted-foreground">Output Tokens:</strong> {log.usage.outputTokens ?? 'N/A'}</p>
                    <p><strong className="text-muted-foreground">Total Tokens:</strong> {log.usage.totalTokens ?? 'N/A'}</p>
                    <p><strong className="text-muted-foreground">Thoughts Tokens:</strong> {log.usage.thoughtsTokens ?? 'N/A'}</p>
                    <p><strong className="text-muted-foreground">Cached Tokens:</strong> {log.usage.cachedContentTokens ?? 'N/A'}</p>
                  </div>
                )}
                <div>
                  <h4 className="font-semibold text-sm mb-1">Prompt</h4>
                  <pre className="text-xs whitespace-pre-wrap font-mono bg-background p-2 rounded-md max-h-60 overflow-y-auto">{log.prompt}</pre>
                </div>
                {log.response?.text && (
                  <div>
                    <h4 className="font-semibold text-sm mb-1">Response Text</h4>
                    <pre className="text-xs whitespace-pre-wrap font-mono bg-background p-2 rounded-md max-h-40 overflow-y-auto">{log.response.text}</pre>
                  </div>
                )}
                {log.errorMessage && (
                    <div>
                    <h4 className="font-semibold text-sm mb-1 text-destructive">Error</h4>
                    <pre className="text-xs whitespace-pre-wrap font-mono bg-destructive/10 text-destructive p-2 rounded-md">{log.errorMessage}</pre>
                    </div>
                )}
              </div>
            </AccordionContent>
          </AccordionItem>
        ))}
      </Accordion>
    );
  };

  return (
    <div className="container mx-auto p-4 sm:p-6 md:p-8">
      <Card>
        <CardHeader>
          <CardTitle>AI Flow Logs</CardTitle>
          <CardDescription>
            Review the most recent Genkit AI flow executions for debugging.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {renderContent()}
        </CardContent>
      </Card>
    </div>
  );
}
