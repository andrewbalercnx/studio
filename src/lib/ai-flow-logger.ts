
'use server';

import { FieldValue } from 'firebase-admin/firestore';
import { getServerFirestore } from '@/lib/server-firestore';

type LogAIFlowParams = {
  flowName: string;
  sessionId?: string | null;
  prompt: string;
  response?: any;
  error?: any;
};

export async function logAIFlow({
  flowName,
  sessionId,
  prompt,
  response,
  error,
}: LogAIFlowParams) {
  try {
    const firestore = await getServerFirestore();
    const logData: any = {
      flowName,
      sessionId: sessionId || null,
      prompt,
      createdAt: FieldValue.serverTimestamp(),
    };

    if (error) {
      logData.status = 'error';
      logData.errorMessage = error.message || JSON.stringify(error);
    } else {
      logData.status = 'success';
      logData.response = {
        text: response?.text ?? null,
        finishReason: response?.finishReason ?? null,
        model: response?.model ?? null,
      };
    }
    
    await firestore.collection('aiFlowLogs').add(logData);

  } catch (logError: any) {
    console.warn('[ai-flow-logger] Failed to write AI flow log', {
      originalFlow: flowName,
      logError: logError.message,
    });
  }
}
