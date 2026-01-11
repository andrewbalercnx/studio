
'use server';

import { FieldValue } from 'firebase-admin/firestore';
import { getServerFirestore } from '@/lib/server-firestore';

type LogAIFlowParams = {
  flowName: string;
  sessionId?: string | null;
  parentId?: string | null;
  prompt: string;
  /** Conversation messages passed to the AI (for multi-turn flows) */
  messages?: Array<{ role: string; content: string }>;
  response?: any;
  error?: any;
  startTime?: number;
  modelName?: string;
  /** Retry attempt number (1-based). If > 1, indicates this is a retry. */
  attemptNumber?: number;
  /** Total number of attempts that will be made */
  maxAttempts?: number;
  /** Reason for retry (if this is a retry attempt) */
  retryReason?: string;
  /** URL of the generated image (for image generation flows) */
  imageUrl?: string | null;
};

export async function logAIFlow({
  flowName,
  sessionId,
  parentId,
  prompt,
  messages,
  response,
  error,
  startTime,
  modelName,
  attemptNumber,
  maxAttempts,
  retryReason,
  imageUrl,
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

    // Include conversation messages if provided (for multi-turn flows)
    if (messages && messages.length > 0) {
      logData.messages = messages;
    }

    // Add retry information if this is a retry attempt
    if (attemptNumber !== undefined && attemptNumber > 1) {
      logData.retry = {
        attemptNumber,
        maxAttempts: maxAttempts || null,
        reason: retryReason || null,
      };
    } else if (attemptNumber !== undefined) {
      // First attempt - just note the attempt number for context
      logData.attemptNumber = attemptNumber;
      if (maxAttempts) {
        logData.maxAttempts = maxAttempts;
      }
    }

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

    // Add image URL for image generation flows
    if (imageUrl) {
      logData.imageUrl = imageUrl;
    }

    await firestore.collection('aiFlowLogs').add(logData);

  } catch (logError: any) {
    console.warn('[ai-flow-logger] Failed to write AI flow log', {
      originalFlow: flowName,
      logError: logError.message,
    });
  }
}
