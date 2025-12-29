'use client';

import React, { createContext, useContext, useEffect, useMemo, useCallback } from 'react';
import { doc, setDoc, serverTimestamp } from 'firebase/firestore';
import { useFirestore } from '@/firebase';
import { useDocument } from '@/lib/firestore-hooks';
import { useUser } from '@/firebase/auth/use-user';
import type { DiagnosticsConfig } from '@/lib/types';
import { DEFAULT_DIAGNOSTICS_CONFIG } from '@/lib/types';

interface DiagnosticsContextType {
  config: DiagnosticsConfig;
  loading: boolean;
  error: string | null;
  showDiagnosticsPanel: boolean;
  enableClientLogging: boolean;
  enableServerLogging: boolean;
  enableAIFlowLogging: boolean;
  updateConfig: (updates: Partial<DiagnosticsConfig>) => Promise<void>;
  toggleDiagnosticsPanel: () => Promise<void>;
}

const DiagnosticsContext = createContext<DiagnosticsContextType | undefined>(undefined);

const DIAGNOSTICS_DOC_PATH = 'systemConfig/diagnostics';

export function DiagnosticsProvider({ children }: { children: React.ReactNode }) {
  const firestore = useFirestore();
  const { user } = useUser();

  // Listen to the diagnostics config document - only when authenticated
  const configRef = useMemo(() => {
    if (!firestore || !user) return null;
    return doc(firestore, DIAGNOSTICS_DOC_PATH);
  }, [firestore, user]);

  const { data: configData, loading, error } = useDocument<DiagnosticsConfig>(configRef);

  // Merge with defaults
  const config = useMemo((): DiagnosticsConfig => {
    if (!configData) return DEFAULT_DIAGNOSTICS_CONFIG;
    return {
      ...DEFAULT_DIAGNOSTICS_CONFIG,
      ...configData,
    };
  }, [configData]);

  // Update config in Firestore
  const updateConfig = useCallback(async (updates: Partial<DiagnosticsConfig>) => {
    if (!firestore || !user) {
      console.warn('[Diagnostics] Cannot update config: no firestore or user');
      return;
    }

    const docRef = doc(firestore, DIAGNOSTICS_DOC_PATH);
    await setDoc(docRef, {
      ...config,
      ...updates,
      updatedAt: serverTimestamp(),
      updatedBy: user.email || user.uid,
    }, { merge: true });
  }, [firestore, user, config]);

  // Convenience toggle for diagnostics panel
  const toggleDiagnosticsPanel = useCallback(async () => {
    await updateConfig({ showDiagnosticsPanel: !config.showDiagnosticsPanel });
  }, [updateConfig, config.showDiagnosticsPanel]);

  // Client-side logging based on config
  useEffect(() => {
    if (config.enableClientLogging) {
      console.debug('[Diagnostics] Client logging enabled');
    }
  }, [config.enableClientLogging]);

  const value: DiagnosticsContextType = {
    config,
    loading,
    error: error?.message || null,
    showDiagnosticsPanel: config.showDiagnosticsPanel,
    enableClientLogging: config.enableClientLogging,
    enableServerLogging: config.enableServerLogging,
    enableAIFlowLogging: config.enableAIFlowLogging,
    updateConfig,
    toggleDiagnosticsPanel,
  };

  return (
    <DiagnosticsContext.Provider value={value}>
      {children}
    </DiagnosticsContext.Provider>
  );
}

export function useDiagnostics() {
  const context = useContext(DiagnosticsContext);
  if (context === undefined) {
    throw new Error('useDiagnostics must be used within a DiagnosticsProvider');
  }
  return context;
}

// Optional hook that doesn't throw if not in provider (for components that might be used outside)
export function useDiagnosticsOptional(): DiagnosticsContextType | null {
  return useContext(DiagnosticsContext) || null;
}
