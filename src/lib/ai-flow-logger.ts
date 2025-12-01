
'use server';

import { initializeFirebase } from '@/firebase';
import { collection, addDoc, serverTimestamp } from 'firebase/firestore';

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
    const { firestore } = initializeFirebase();
    const logData: any = {
      flowName,
      sessionId: sessionId || null,
      prompt,
      createdAt: serverTimestamp(),
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
    
    await addDoc(collection(firestore, 'aiFlowLogs'), logData);

  } catch (logError: any) {
    console.warn('[ai-flow-logger] Failed to write AI flow log', {
      originalFlow: flowName,
      logError: logError.message,
    });
  }
}
