'use client';

import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';

interface WizardTargetDiagnosticsContextType {
  /** Whether wizard target diagnostics mode is enabled */
  enabled: boolean;
  /** Toggle diagnostics mode on/off */
  toggle: () => void;
  /** Enable diagnostics mode */
  enable: () => void;
  /** Disable diagnostics mode */
  disable: () => void;
}

const WizardTargetDiagnosticsContext = createContext<WizardTargetDiagnosticsContextType | undefined>(undefined);

// Local storage key for persisting the preference
const STORAGE_KEY = 'wizard-target-diagnostics-enabled';

export function WizardTargetDiagnosticsProvider({ children }: { children: React.ReactNode }) {
  const [enabled, setEnabled] = useState(false);

  // Load preference from localStorage on mount
  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === 'true') {
      setEnabled(true);
    }
  }, []);

  // Persist preference to localStorage
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, enabled ? 'true' : 'false');
  }, [enabled]);

  const toggle = useCallback(() => {
    setEnabled(prev => !prev);
  }, []);

  const enable = useCallback(() => {
    setEnabled(true);
  }, []);

  const disable = useCallback(() => {
    setEnabled(false);
  }, []);

  const value: WizardTargetDiagnosticsContextType = {
    enabled,
    toggle,
    enable,
    disable,
  };

  return (
    <WizardTargetDiagnosticsContext.Provider value={value}>
      {children}
    </WizardTargetDiagnosticsContext.Provider>
  );
}

export function useWizardTargetDiagnostics(): WizardTargetDiagnosticsContextType {
  const context = useContext(WizardTargetDiagnosticsContext);
  if (context === undefined) {
    throw new Error('useWizardTargetDiagnostics must be used within a WizardTargetDiagnosticsProvider');
  }
  return context;
}

// Optional hook that doesn't throw if not in provider
export function useWizardTargetDiagnosticsOptional(): WizardTargetDiagnosticsContextType | null {
  return useContext(WizardTargetDiagnosticsContext) || null;
}
