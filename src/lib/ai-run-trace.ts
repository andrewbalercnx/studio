'use server';

/**
 * @fileOverview AI Run Trace - Aggregates all AI generation calls for a story session.
 *
 * This module provides comprehensive tracing of all AI calls made during a story
 * generation run, including:
 * - Full prompts (system + user messages)
 * - Model configuration (temperature, maxOutputTokens)
 * - Raw outputs
 * - Token usage and costs
 * - Timing information
 *
 * The trace document is stored at: aiRunTraces/{sessionId}
 * Each AI call is appended to the `calls` array with full context.
 */

import { FieldValue, type Firestore } from 'firebase-admin/firestore';
import { getServerFirestore } from '@/lib/server-firestore';

// Token costs per 1M tokens (as of Dec 2024 for Google AI models)
// These are approximate and should be updated periodically
const TOKEN_COSTS_PER_MILLION = {
  'googleai/gemini-2.5-pro': {
    input: 1.25,   // $1.25 per 1M input tokens
    output: 10.00, // $10.00 per 1M output tokens
    thinking: 3.75, // $3.75 per 1M thinking tokens (if applicable)
    cached: 0.32,   // $0.3125 per 1M cached tokens
  },
  'googleai/gemini-2.5-flash': {
    input: 0.075,  // $0.075 per 1M input tokens
    output: 0.30,  // $0.30 per 1M output tokens
    thinking: 0.19, // $0.1875 per 1M thinking tokens
    cached: 0.02,   // $0.01875 per 1M cached tokens
  },
  // Default fallback for unknown models
  'default': {
    input: 1.00,
    output: 5.00,
    thinking: 2.50,
    cached: 0.25,
  },
} as const;

export type AICallTrace = {
  // Identification
  callId: string;
  flowName: string;
  timestamp: any;

  // Model configuration
  modelName: string;
  temperature: number;
  maxOutputTokens: number;

  // Input
  systemPrompt: string;
  userMessages?: Array<{
    role: 'user' | 'model';
    content: string;
  }>;
  promptTokenEstimate?: number;  // Estimated from character count if not available

  // Output
  outputText: string;
  structuredOutput?: any;
  finishReason: string;

  // Token usage
  usage: {
    inputTokens: number | null;
    outputTokens: number | null;
    totalTokens: number | null;
    thoughtsTokens?: number | null;
    cachedContentTokens?: number | null;
  };

  // Cost calculation
  cost: {
    inputCost: number;
    outputCost: number;
    thinkingCost: number;
    cachedSavings: number;  // How much was saved due to caching
    totalCost: number;
    currency: 'USD';
  };

  // Timing
  latencyMs: number;

  // Status
  status: 'success' | 'error';
  errorMessage?: string;
};

export type AIRunTrace = {
  // Session identification
  sessionId: string;
  parentUid: string;
  childId?: string;
  storyTypeId?: string;
  storyTypeName?: string;

  // Trace metadata
  startedAt: any;
  lastUpdatedAt: any;
  status: 'in_progress' | 'completed' | 'error';

  // Aggregated calls
  calls: AICallTrace[];

  // Summary statistics
  summary: {
    totalCalls: number;
    totalInputTokens: number;
    totalOutputTokens: number;
    totalThinkingTokens: number;
    totalCachedTokens: number;
    totalTokens: number;
    totalCost: number;
    totalLatencyMs: number;
    averageLatencyMs: number;
    callsByFlow: Record<string, number>;
    errorCount: number;
  };
};

/**
 * Calculate cost for tokens based on model pricing
 */
function calculateTokenCost(
  modelName: string,
  inputTokens: number | null,
  outputTokens: number | null,
  thinkingTokens: number | null | undefined,
  cachedTokens: number | null | undefined
): AICallTrace['cost'] {
  const pricing = TOKEN_COSTS_PER_MILLION[modelName as keyof typeof TOKEN_COSTS_PER_MILLION]
    || TOKEN_COSTS_PER_MILLION['default'];

  const input = inputTokens || 0;
  const output = outputTokens || 0;
  const thinking = thinkingTokens || 0;
  const cached = cachedTokens || 0;

  // Cached tokens are subtracted from input cost
  const effectiveInput = Math.max(0, input - cached);

  const inputCost = (effectiveInput / 1_000_000) * pricing.input;
  const outputCost = (output / 1_000_000) * pricing.output;
  const thinkingCost = (thinking / 1_000_000) * pricing.thinking;
  const cachedSavings = (cached / 1_000_000) * (pricing.input - pricing.cached);

  return {
    inputCost: Math.round(inputCost * 100000) / 100000,  // Round to 5 decimal places
    outputCost: Math.round(outputCost * 100000) / 100000,
    thinkingCost: Math.round(thinkingCost * 100000) / 100000,
    cachedSavings: Math.round(cachedSavings * 100000) / 100000,
    totalCost: Math.round((inputCost + outputCost + thinkingCost) * 100000) / 100000,
    currency: 'USD',
  };
}

/**
 * Generate a unique call ID
 */
function generateCallId(): string {
  return `call_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}

/**
 * Initialize a new AI run trace for a session
 */
export async function initializeRunTrace(params: {
  sessionId: string;
  parentUid: string;
  childId?: string;
  storyTypeId?: string;
  storyTypeName?: string;
}): Promise<void> {
  const firestore = await getServerFirestore();
  const traceRef = firestore.collection('aiRunTraces').doc(params.sessionId);

  const existingTrace = await traceRef.get();
  if (existingTrace.exists) {
    // Trace already exists, just update the lastUpdatedAt
    await traceRef.update({
      lastUpdatedAt: FieldValue.serverTimestamp(),
    });
    return;
  }

  const trace: Omit<AIRunTrace, 'calls'> & { calls: AICallTrace[] } = {
    sessionId: params.sessionId,
    parentUid: params.parentUid,
    childId: params.childId,
    storyTypeId: params.storyTypeId,
    storyTypeName: params.storyTypeName,
    startedAt: FieldValue.serverTimestamp(),
    lastUpdatedAt: FieldValue.serverTimestamp(),
    status: 'in_progress',
    calls: [],
    summary: {
      totalCalls: 0,
      totalInputTokens: 0,
      totalOutputTokens: 0,
      totalThinkingTokens: 0,
      totalCachedTokens: 0,
      totalTokens: 0,
      totalCost: 0,
      totalLatencyMs: 0,
      averageLatencyMs: 0,
      callsByFlow: {},
      errorCount: 0,
    },
  };

  await traceRef.set(trace);
}

/**
 * Parameters for logging an AI call to the run trace
 */
export type LogAICallParams = {
  sessionId: string;
  flowName: string;
  modelName: string;
  temperature: number;
  maxOutputTokens: number;
  systemPrompt: string;
  userMessages?: Array<{
    role: 'user' | 'model';
    content: string;
  }>;
  response?: any;
  error?: any;
  startTime: number;
};

/**
 * Log an AI generation call to the run trace
 */
export async function logAICallToTrace(params: LogAICallParams): Promise<void> {
  try {
    const firestore = await getServerFirestore();
    const traceRef = firestore.collection('aiRunTraces').doc(params.sessionId);

    const latencyMs = Date.now() - params.startTime;
    const isError = !!params.error;

    // Extract usage information
    const usage = params.response?.usage;
    const rawUsageMetadata = params.response?.custom?.usageMetadata || params.response?.raw?.usageMetadata;

    let tokenUsage: AICallTrace['usage'];
    if (usage && (usage.inputTokens !== undefined || usage.outputTokens !== undefined)) {
      tokenUsage = {
        inputTokens: usage.inputTokens ?? null,
        outputTokens: usage.outputTokens ?? null,
        totalTokens: usage.totalTokens ?? null,
        thoughtsTokens: usage.thoughtsTokens ?? null,
        cachedContentTokens: usage.cachedContentTokens ?? null,
      };
    } else if (rawUsageMetadata) {
      tokenUsage = {
        inputTokens: rawUsageMetadata.promptTokenCount ?? null,
        outputTokens: rawUsageMetadata.candidatesTokenCount ?? null,
        totalTokens: rawUsageMetadata.totalTokenCount ?? null,
        thoughtsTokens: rawUsageMetadata.thoughtsTokenCount ?? null,
        cachedContentTokens: rawUsageMetadata.cachedContentTokenCount ?? null,
      };
    } else {
      tokenUsage = {
        inputTokens: null,
        outputTokens: null,
        totalTokens: null,
      };
    }

    // Calculate costs
    const cost = calculateTokenCost(
      params.modelName,
      tokenUsage.inputTokens,
      tokenUsage.outputTokens,
      tokenUsage.thoughtsTokens,
      tokenUsage.cachedContentTokens
    );

    // Build the call trace
    const callTrace: AICallTrace = {
      callId: generateCallId(),
      flowName: params.flowName,
      timestamp: FieldValue.serverTimestamp(),
      modelName: params.modelName,
      temperature: params.temperature,
      maxOutputTokens: params.maxOutputTokens,
      systemPrompt: params.systemPrompt,
      userMessages: params.userMessages,
      outputText: params.response?.text || '',
      structuredOutput: params.response?.output || null,
      finishReason: params.response?.finishReason || (isError ? 'error' : 'unknown'),
      usage: tokenUsage,
      cost,
      latencyMs,
      status: isError ? 'error' : 'success',
      errorMessage: isError ? (params.error?.message || JSON.stringify(params.error)) : undefined,
    };

    // Update the trace document
    const traceDoc = await traceRef.get();

    if (!traceDoc.exists) {
      // Create a minimal trace if it doesn't exist (shouldn't happen normally)
      await traceRef.set({
        sessionId: params.sessionId,
        parentUid: 'unknown',
        startedAt: FieldValue.serverTimestamp(),
        lastUpdatedAt: FieldValue.serverTimestamp(),
        status: 'in_progress',
        calls: [callTrace],
        summary: {
          totalCalls: 1,
          totalInputTokens: tokenUsage.inputTokens || 0,
          totalOutputTokens: tokenUsage.outputTokens || 0,
          totalThinkingTokens: tokenUsage.thoughtsTokens || 0,
          totalCachedTokens: tokenUsage.cachedContentTokens || 0,
          totalTokens: tokenUsage.totalTokens || 0,
          totalCost: cost.totalCost,
          totalLatencyMs: latencyMs,
          averageLatencyMs: latencyMs,
          callsByFlow: { [params.flowName]: 1 },
          errorCount: isError ? 1 : 0,
        },
      });
      return;
    }

    const existingData = traceDoc.data() as AIRunTrace;
    const existingCalls = existingData.calls || [];
    const existingSummary = existingData.summary || {
      totalCalls: 0,
      totalInputTokens: 0,
      totalOutputTokens: 0,
      totalThinkingTokens: 0,
      totalCachedTokens: 0,
      totalTokens: 0,
      totalCost: 0,
      totalLatencyMs: 0,
      averageLatencyMs: 0,
      callsByFlow: {},
      errorCount: 0,
    };

    // Update summary
    const newTotalCalls = existingSummary.totalCalls + 1;
    const newTotalInputTokens = existingSummary.totalInputTokens + (tokenUsage.inputTokens || 0);
    const newTotalOutputTokens = existingSummary.totalOutputTokens + (tokenUsage.outputTokens || 0);
    const newTotalThinkingTokens = existingSummary.totalThinkingTokens + (tokenUsage.thoughtsTokens || 0);
    const newTotalCachedTokens = existingSummary.totalCachedTokens + (tokenUsage.cachedContentTokens || 0);
    const newTotalTokens = existingSummary.totalTokens + (tokenUsage.totalTokens || 0);
    const newTotalCost = existingSummary.totalCost + cost.totalCost;
    const newTotalLatencyMs = existingSummary.totalLatencyMs + latencyMs;

    const callsByFlow = { ...existingSummary.callsByFlow };
    callsByFlow[params.flowName] = (callsByFlow[params.flowName] || 0) + 1;

    const updatedSummary = {
      totalCalls: newTotalCalls,
      totalInputTokens: newTotalInputTokens,
      totalOutputTokens: newTotalOutputTokens,
      totalThinkingTokens: newTotalThinkingTokens,
      totalCachedTokens: newTotalCachedTokens,
      totalTokens: newTotalTokens,
      totalCost: Math.round(newTotalCost * 100000) / 100000,
      totalLatencyMs: newTotalLatencyMs,
      averageLatencyMs: Math.round(newTotalLatencyMs / newTotalCalls),
      callsByFlow,
      errorCount: existingSummary.errorCount + (isError ? 1 : 0),
    };

    await traceRef.update({
      calls: [...existingCalls, callTrace],
      summary: updatedSummary,
      lastUpdatedAt: FieldValue.serverTimestamp(),
    });

  } catch (err: any) {
    console.warn('[ai-run-trace] Failed to log AI call to trace', {
      sessionId: params.sessionId,
      flowName: params.flowName,
      error: err.message,
    });
  }
}

/**
 * Mark a run trace as completed
 */
export async function completeRunTrace(sessionId: string): Promise<void> {
  try {
    const firestore = await getServerFirestore();
    const traceRef = firestore.collection('aiRunTraces').doc(sessionId);

    await traceRef.update({
      status: 'completed',
      lastUpdatedAt: FieldValue.serverTimestamp(),
    });
  } catch (err: any) {
    console.warn('[ai-run-trace] Failed to complete run trace', {
      sessionId,
      error: err.message,
    });
  }
}

/**
 * Mark a run trace as errored
 */
export async function errorRunTrace(sessionId: string, errorMessage: string): Promise<void> {
  try {
    const firestore = await getServerFirestore();
    const traceRef = firestore.collection('aiRunTraces').doc(sessionId);

    await traceRef.update({
      status: 'error',
      lastUpdatedAt: FieldValue.serverTimestamp(),
      errorMessage,
    });
  } catch (err: any) {
    console.warn('[ai-run-trace] Failed to mark run trace as errored', {
      sessionId,
      error: err.message,
    });
  }
}

/**
 * Get a run trace by session ID
 */
export async function getRunTrace(sessionId: string): Promise<AIRunTrace | null> {
  const firestore = await getServerFirestore();
  const traceRef = firestore.collection('aiRunTraces').doc(sessionId);
  const doc = await traceRef.get();

  if (!doc.exists) {
    return null;
  }

  return doc.data() as AIRunTrace;
}
