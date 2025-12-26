
'use server';

import { FieldValue } from 'firebase-admin/firestore';
import { getServerFirestore } from '@/lib/server-firestore';

type LogAIFlowParams = {
  flowName: string;
  sessionId?: string | null;
  parentId?: string | null;
  prompt: string;
  response?: any;
  error?: any;
  startTime?: number;
  modelName?: string;
};

export async function logAIFlow({
  flowName,
  sessionId,
  parentId,
  prompt,
  response,
  error,
  startTime,
  modelName,
}: LogAIFlowParams) {
  try {
    const firestore = await getServerFirestore();
    const logData: any = {
      flowName,
      sessionId: sessionId || null,
      parentId: parentId || null,
      prompt,
      createdAt: FieldValue.serverTimestamp(),
    };

    // Calculate latency if startTime was provided
    if (startTime) {
      logData.latencyMs = Date.now() - startTime;
    }

    if (error) {
      logData.status = 'error';
      logData.errorMessage = error.message || JSON.stringify(error);
    } else {
      logData.status = 'success';

      // Extract model version - prefer explicit modelName, then check response locations
      const modelVersion = modelName
        || response?.model
        || response?.custom?.candidates?.[0]?.modelVersion
        || response?.raw?.candidates?.[0]?.modelVersion
        || null;

      logData.response = {
        text: response?.text ?? null,
        finishReason: response?.finishReason ?? null,
        model: modelVersion,
      };

      // Extract usage/token information from Genkit response
      // Genkit normalizes to response.usage, but raw Gemini data is in response.custom.usageMetadata
      const usage = response?.usage;
      const rawUsageMetadata = response?.custom?.usageMetadata || response?.raw?.usageMetadata;

      // Check if usage has any actual data (not just an empty object)
      const hasUsageData = usage && (
        usage.inputTokens !== undefined ||
        usage.outputTokens !== undefined ||
        usage.totalTokens !== undefined
      );

      if (hasUsageData) {
        logData.usage = {
          inputTokens: usage.inputTokens ?? null,
          outputTokens: usage.outputTokens ?? null,
          totalTokens: usage.totalTokens ?? null,
          thoughtsTokens: usage.thoughtsTokens ?? null,
          cachedContentTokens: usage.cachedContentTokens ?? null,
        };
      } else if (rawUsageMetadata) {
        // Fallback to raw Gemini usageMetadata if Genkit didn't normalize it
        logData.usage = {
          inputTokens: rawUsageMetadata.promptTokenCount ?? null,
          outputTokens: rawUsageMetadata.candidatesTokenCount ?? null,
          totalTokens: rawUsageMetadata.totalTokenCount ?? null,
          thoughtsTokens: rawUsageMetadata.thoughtsTokenCount ?? null,
          cachedContentTokens: rawUsageMetadata.cachedContentTokenCount ?? null,
        };
      }

      // Don't store the full custom object - it's too large and duplicates data
      // The important fields (usage, model) are now extracted above
    }

    await firestore.collection('aiFlowLogs').add(logData);

  } catch (logError: any) {
    console.warn('[ai-flow-logger] Failed to write AI flow log', {
      originalFlow: flowName,
      logError: logError.message,
    });
  }
}
