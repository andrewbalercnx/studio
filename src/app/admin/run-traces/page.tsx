'use client';

import { useAdminStatus } from '@/hooks/use-admin-status';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { LoaderCircle, ChevronDown, ChevronRight, DollarSign, Clock, Zap, MessageSquare, Copy, Check } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useFirestore } from '@/firebase';
import { collection, onSnapshot, query, orderBy, limit, doc, getDoc } from 'firebase/firestore';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { formatDistanceToNow } from 'date-fns';
import type { AIRunTrace, AICallTrace } from '@/lib/types';

function formatTimestamp(timestamp: any): string {
  if (!timestamp) return 'N/A';
  try {
    const date = timestamp.toDate();
    return `${formatDistanceToNow(date, { addSuffix: true })}`;
  } catch (e) {
    return 'Invalid Date';
  }
}

function formatCost(cost: number): string {
  if (cost < 0.01) {
    return `$${(cost * 100).toFixed(3)}¢`;
  }
  return `$${cost.toFixed(4)}`;
}

function formatTokens(tokens: number | null | undefined): string {
  if (tokens === null || tokens === undefined) return 'N/A';
  if (tokens >= 1000) {
    return `${(tokens / 1000).toFixed(1)}k`;
  }
  return tokens.toString();
}

function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <Button variant="ghost" size="sm" onClick={handleCopy} className="h-6 px-2 text-xs">
      {copied ? <Check className="h-3 w-3 mr-1" /> : <Copy className="h-3 w-3 mr-1" />}
      {copied ? 'Copied!' : label}
    </Button>
  );
}

function CallTraceCard({ call, index }: { call: AICallTrace; index: number }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="border rounded-lg bg-card">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full p-3 flex items-center justify-between hover:bg-muted/50 transition-colors"
      >
        <div className="flex items-center gap-3">
          {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          <span className="text-sm font-medium">#{index + 1}</span>
          <Badge variant={call.status === 'success' ? 'default' : 'destructive'} className="text-xs">
            {call.flowName}
          </Badge>
          <span className="text-xs text-muted-foreground">{call.modelName}</span>
        </div>
        <div className="flex items-center gap-4 text-xs text-muted-foreground">
          <span className="flex items-center gap-1">
            <MessageSquare className="h-3 w-3" />
            {formatTokens(call.usage?.totalTokens)}
          </span>
          <span className="flex items-center gap-1">
            <DollarSign className="h-3 w-3" />
            {formatCost(call.cost?.totalCost || 0)}
          </span>
          <span className="flex items-center gap-1">
            <Clock className="h-3 w-3" />
            {call.latencyMs}ms
          </span>
        </div>
      </button>

      {expanded && (
        <div className="border-t p-4 space-y-4">
          {/* Configuration */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-xs">
            <div>
              <span className="text-muted-foreground">Temperature:</span>
              <span className="ml-2 font-mono">{call.temperature}</span>
            </div>
            <div>
              <span className="text-muted-foreground">Max Tokens:</span>
              <span className="ml-2 font-mono">{call.maxOutputTokens}</span>
            </div>
            <div>
              <span className="text-muted-foreground">Finish Reason:</span>
              <span className="ml-2 font-mono">{call.finishReason}</span>
            </div>
            <div>
              <span className="text-muted-foreground">Latency:</span>
              <span className="ml-2 font-mono">{call.latencyMs}ms</span>
            </div>
          </div>

          {/* Token Usage */}
          <div className="bg-blue-50 dark:bg-blue-950/50 rounded-lg p-3">
            <h4 className="text-xs font-semibold mb-2">Token Usage & Cost</h4>
            <div className="grid grid-cols-3 md:grid-cols-6 gap-2 text-xs">
              <div>
                <span className="text-muted-foreground">Input:</span>
                <span className="ml-1 font-mono">{formatTokens(call.usage?.inputTokens)}</span>
              </div>
              <div>
                <span className="text-muted-foreground">Output:</span>
                <span className="ml-1 font-mono">{formatTokens(call.usage?.outputTokens)}</span>
              </div>
              <div>
                <span className="text-muted-foreground">Thinking:</span>
                <span className="ml-1 font-mono">{formatTokens(call.usage?.thoughtsTokens)}</span>
              </div>
              <div>
                <span className="text-muted-foreground">Cached:</span>
                <span className="ml-1 font-mono">{formatTokens(call.usage?.cachedContentTokens)}</span>
              </div>
              <div>
                <span className="text-muted-foreground">Total:</span>
                <span className="ml-1 font-mono font-semibold">{formatTokens(call.usage?.totalTokens)}</span>
              </div>
              <div>
                <span className="text-muted-foreground">Cost:</span>
                <span className="ml-1 font-mono font-semibold text-green-600">{formatCost(call.cost?.totalCost || 0)}</span>
              </div>
            </div>
          </div>

          {/* System Prompt */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <h4 className="text-xs font-semibold">System Prompt</h4>
              <CopyButton text={call.systemPrompt} label="Copy" />
            </div>
            <pre className="text-xs whitespace-pre-wrap font-mono bg-muted p-3 rounded-lg max-h-60 overflow-y-auto">
              {call.systemPrompt}
            </pre>
          </div>

          {/* User Messages */}
          {call.userMessages && call.userMessages.length > 0 && (
            <div>
              <h4 className="text-xs font-semibold mb-2">Conversation History ({call.userMessages.length} messages)</h4>
              <div className="space-y-2 max-h-60 overflow-y-auto">
                {call.userMessages.map((msg, i) => (
                  <div
                    key={i}
                    className={`text-xs p-2 rounded ${
                      msg.role === 'model' ? 'bg-blue-100 dark:bg-blue-900/30' : 'bg-gray-100 dark:bg-gray-800'
                    }`}
                  >
                    <span className="font-semibold">{msg.role === 'model' ? 'Assistant' : 'User'}:</span>
                    <span className="ml-2 whitespace-pre-wrap">{msg.content.slice(0, 500)}{msg.content.length > 500 ? '...' : ''}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Output */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <h4 className="text-xs font-semibold">Output</h4>
              <CopyButton text={call.outputText} label="Copy" />
            </div>
            <pre className="text-xs whitespace-pre-wrap font-mono bg-muted p-3 rounded-lg max-h-40 overflow-y-auto">
              {call.outputText || '(empty)'}
            </pre>
          </div>

          {/* Structured Output */}
          {call.structuredOutput && (
            <div>
              <div className="flex items-center justify-between mb-2">
                <h4 className="text-xs font-semibold">Structured Output (Parsed)</h4>
                <CopyButton text={JSON.stringify(call.structuredOutput, null, 2)} label="Copy JSON" />
              </div>
              <pre className="text-xs whitespace-pre-wrap font-mono bg-green-50 dark:bg-green-950/30 p-3 rounded-lg max-h-40 overflow-y-auto">
                {JSON.stringify(call.structuredOutput, null, 2)}
              </pre>
            </div>
          )}

          {/* Error */}
          {call.errorMessage && (
            <div>
              <h4 className="text-xs font-semibold text-destructive mb-2">Error</h4>
              <pre className="text-xs whitespace-pre-wrap font-mono bg-destructive/10 text-destructive p-3 rounded-lg">
                {call.errorMessage}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function RunTraceDetail({ trace }: { trace: AIRunTrace }) {
  const [showAllCalls, setShowAllCalls] = useState(false);
  const calls = trace.calls || [];
  const displayedCalls = showAllCalls ? calls : calls.slice(0, 5);

  return (
    <div className="space-y-6">
      {/* Summary Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center gap-2">
              <Zap className="h-4 w-4 text-yellow-500" />
              <span className="text-sm text-muted-foreground">Total Calls</span>
            </div>
            <p className="text-2xl font-bold">{trace.summary?.totalCalls || 0}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center gap-2">
              <MessageSquare className="h-4 w-4 text-blue-500" />
              <span className="text-sm text-muted-foreground">Total Tokens</span>
            </div>
            <p className="text-2xl font-bold">{formatTokens(trace.summary?.totalTokens)}</p>
            <p className="text-xs text-muted-foreground">
              In: {formatTokens(trace.summary?.totalInputTokens)} / Out: {formatTokens(trace.summary?.totalOutputTokens)}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center gap-2">
              <DollarSign className="h-4 w-4 text-green-500" />
              <span className="text-sm text-muted-foreground">Total Cost</span>
            </div>
            <p className="text-2xl font-bold">{formatCost(trace.summary?.totalCost || 0)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center gap-2">
              <Clock className="h-4 w-4 text-purple-500" />
              <span className="text-sm text-muted-foreground">Total Time</span>
            </div>
            <p className="text-2xl font-bold">{((trace.summary?.totalLatencyMs || 0) / 1000).toFixed(1)}s</p>
            <p className="text-xs text-muted-foreground">
              Avg: {trace.summary?.averageLatencyMs || 0}ms/call
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Calls by Flow */}
      {trace.summary?.callsByFlow && Object.keys(trace.summary.callsByFlow).length > 0 && (
        <div className="bg-muted/50 rounded-lg p-4">
          <h3 className="text-sm font-semibold mb-2">Calls by Flow</h3>
          <div className="flex flex-wrap gap-2">
            {Object.entries(trace.summary.callsByFlow).map(([flow, count]) => (
              <Badge key={flow} variant="secondary" className="text-xs">
                {flow}: {count}
              </Badge>
            ))}
          </div>
        </div>
      )}

      {/* Individual Calls */}
      <div>
        <h3 className="text-sm font-semibold mb-3">AI Calls ({calls.length})</h3>
        {calls.length === 0 ? (
          <div className="text-center py-8 border-2 border-dashed rounded-lg bg-muted/30">
            <p className="text-muted-foreground mb-2">No AI calls recorded for this trace.</p>
            <p className="text-xs text-muted-foreground">
              This can happen if:
            </p>
            <ul className="text-xs text-muted-foreground mt-1 space-y-1">
              <li>• The session was completed before instrumentation was deployed</li>
              <li>• The trace was initialized but no AI calls were made yet</li>
              <li>• There was an error logging the calls</li>
            </ul>
          </div>
        ) : (
          <>
            <div className="space-y-2">
              {displayedCalls.map((call, index) => (
                <CallTraceCard key={call.callId || index} call={call} index={index} />
              ))}
            </div>
            {calls.length > 5 && (
              <Button
                variant="outline"
                size="sm"
                className="mt-3 w-full"
                onClick={() => setShowAllCalls(!showAllCalls)}
              >
                {showAllCalls ? 'Show Less' : `Show All ${calls.length} Calls`}
              </Button>
            )}
          </>
        )}
      </div>
    </div>
  );
}

export default function AdminRunTracesPage() {
  const { isAuthenticated, isAdmin, loading: authLoading } = useAdminStatus();
  const firestore = useFirestore();

  const [traces, setTraces] = useState<(AIRunTrace & { id: string })[]>([]);
  const [selectedTrace, setSelectedTrace] = useState<(AIRunTrace & { id: string }) | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sessionIdInput, setSessionIdInput] = useState('');
  const [lookupLoading, setLookupLoading] = useState(false);

  useEffect(() => {
    if (!firestore || !isAdmin) {
      setLoading(false);
      return;
    }

    setLoading(true);
    const tracesRef = collection(firestore, 'aiRunTraces');
    const q = query(tracesRef, orderBy('startedAt', 'desc'), limit(20));

    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const traceList = snapshot.docs.map((d) => ({
          ...d.data(),
          id: d.id,
        })) as (AIRunTrace & { id: string })[];
        setTraces(traceList);
        setLoading(false);
        setError(null);
      },
      (err) => {
        console.error('Error fetching run traces:', err);
        setError('Could not fetch run traces. Check Firestore rules.');
        setTraces([]);
        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, [firestore, isAdmin]);

  const handleLookupSession = async () => {
    if (!firestore || !sessionIdInput.trim()) return;

    setLookupLoading(true);
    try {
      const traceDoc = await getDoc(doc(firestore, 'aiRunTraces', sessionIdInput.trim()));
      if (traceDoc.exists()) {
        setSelectedTrace({ ...traceDoc.data(), id: traceDoc.id } as AIRunTrace & { id: string });
      } else {
        setError(`No trace found for session: ${sessionIdInput}`);
        setTimeout(() => setError(null), 3000);
      }
    } catch (err: any) {
      setError(`Error looking up session: ${err.message}`);
      setTimeout(() => setError(null), 3000);
    } finally {
      setLookupLoading(false);
    }
  };

  const renderContent = () => {
    if (authLoading || loading) {
      return (
        <div className="flex items-center gap-2">
          <LoaderCircle className="h-5 w-5 animate-spin" />
          <span>Loading traces...</span>
        </div>
      );
    }
    if (!isAuthenticated || !isAdmin) {
      return <p>You must be an admin to view this page.</p>;
    }

    if (selectedTrace) {
      return (
        <div>
          <div className="flex items-center gap-4 mb-4">
            <Button variant="outline" size="sm" onClick={() => setSelectedTrace(null)}>
              &larr; Back to List
            </Button>
            <div className="flex-1">
              <h3 className="font-semibold">Session: {selectedTrace.sessionId}</h3>
              <p className="text-xs text-muted-foreground">
                {selectedTrace.storyTypeName || 'Unknown Story Type'} &bull;{' '}
                {formatTimestamp(selectedTrace.startedAt)}
              </p>
            </div>
            <Badge
              variant={
                selectedTrace.status === 'completed'
                  ? 'default'
                  : selectedTrace.status === 'error'
                  ? 'destructive'
                  : 'secondary'
              }
            >
              {selectedTrace.status}
            </Badge>
          </div>
          <RunTraceDetail trace={selectedTrace} />
        </div>
      );
    }

    return (
      <div className="space-y-4">
        {/* Session Lookup */}
        <div className="flex gap-2">
          <Input
            placeholder="Enter session ID to look up..."
            value={sessionIdInput}
            onChange={(e) => setSessionIdInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleLookupSession()}
            className="flex-1"
          />
          <Button onClick={handleLookupSession} disabled={lookupLoading || !sessionIdInput.trim()}>
            {lookupLoading ? <LoaderCircle className="h-4 w-4 animate-spin" /> : 'Lookup'}
          </Button>
        </div>

        {error && <p className="text-destructive text-sm">{error}</p>}

        {/* Recent Traces Header */}
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold">Recent Traces</h3>
          <p className="text-xs text-muted-foreground">
            Showing {traces.length} most recent traces
          </p>
        </div>

        {traces.length === 0 ? (
          <div className="text-center py-8 border-2 border-dashed rounded-lg">
            <p className="text-muted-foreground">No run traces found yet.</p>
            <p className="text-xs text-muted-foreground mt-2">
              Run traces are created when story generation flows execute.
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {traces.map((trace) => {
              const hasCalls = (trace.summary?.totalCalls || 0) > 0;
              return (
                <button
                  key={trace.id}
                  onClick={() => setSelectedTrace(trace)}
                  className={`w-full p-4 border rounded-lg hover:bg-muted/50 transition-colors text-left ${
                    !hasCalls ? 'opacity-60' : ''
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div>
                        <p className="font-semibold text-sm">{trace.sessionId}</p>
                        <p className="text-xs text-muted-foreground">
                          {trace.storyTypeName || 'Unknown Story Type'} &bull; {formatTimestamp(trace.startedAt)}
                        </p>
                      </div>
                      {!hasCalls && (
                        <Badge variant="outline" className="text-xs">
                          No calls
                        </Badge>
                      )}
                    </div>
                    <div className="flex items-center gap-4">
                      <div className="text-right">
                        <p className="text-sm font-mono">{trace.summary?.totalCalls || 0} calls</p>
                        <p className="text-xs text-muted-foreground">
                          {formatTokens(trace.summary?.totalTokens)} tokens
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="text-sm font-mono text-green-600">
                          {formatCost(trace.summary?.totalCost || 0)}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {((trace.summary?.totalLatencyMs || 0) / 1000).toFixed(1)}s
                        </p>
                      </div>
                      <Badge
                        variant={
                          trace.status === 'completed'
                            ? 'default'
                            : trace.status === 'error'
                            ? 'destructive'
                            : 'secondary'
                        }
                      >
                        {trace.status}
                      </Badge>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="container mx-auto p-4 sm:p-6 md:p-8">
      <Card>
        <CardHeader>
          <CardTitle>AI Run Traces</CardTitle>
          <CardDescription>
            View aggregated AI generation traces for story sessions. Each trace contains all AI calls
            made during a story generation run with full prompts, outputs, and token costs.
          </CardDescription>
        </CardHeader>
        <CardContent>{renderContent()}</CardContent>
      </Card>
    </div>
  );
}
