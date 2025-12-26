'use server';

import { getServerFirestore } from '@/lib/server-firestore';
import { FieldValue } from 'firebase-admin/firestore';
import { DEFAULT_DIAGNOSTICS_CONFIG } from '@/lib/types';

/**
 * Seeds the system diagnostics configuration document
 */
export async function seedDiagnosticsConfig(): Promise<{ success: boolean; error?: string }> {
  try {
    const firestore = await getServerFirestore();
    const docRef = firestore.doc('systemConfig/diagnostics');

    // Check if document already exists
    const existing = await docRef.get();
    if (existing.exists) {
      return {
        success: true,
        error: 'Document already exists'
      };
    }

    await docRef.set({
      ...DEFAULT_DIAGNOSTICS_CONFIG,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
      createdBy: 'system'
    });

    return { success: true };

  } catch (error: any) {
    return {
      success: false,
      error: error.message
    };
  }
}