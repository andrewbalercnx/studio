'use client';

import React, { createContext, useContext, useState, useCallback, useRef } from 'react';
import { generateCssSelector, getWizardTargetId } from '@/lib/css-selector';
import type { HelpWizardPage, HelpWizard } from '@/lib/types';

interface RecordedStep {
  route: string;
  wizardTargetId?: string;
  highlightSelector?: string;
  timestamp: number;
  elementTagName: string;
  elementText: string;
}

interface PathRecordingContextType {
  /** Whether path recording is currently active */
  isRecording: boolean;
  /** The recorded steps so far */
  steps: RecordedStep[];
  /** Start recording clicks */
  startRecording: () => void;
  /** Stop recording and return steps */
  stopRecording: () => RecordedStep[];
  /** Download the recorded steps as a HelpWizard JSON file */
  downloadWizard: (title: string) => void;
  /** Clear all recorded steps */
  clearRecording: () => void;
}

const PathRecordingContext = createContext<PathRecordingContextType | undefined>(undefined);

export function PathRecordingProvider({ children }: { children: React.ReactNode }) {
  const [isRecording, setIsRecording] = useState(false);
  const [steps, setSteps] = useState<RecordedStep[]>([]);
  const clickHandlerRef = useRef<((e: MouseEvent) => void) | null>(null);

  const handleClick = useCallback((e: MouseEvent) => {
    const target = e.target as Element;
    if (!target) return;

    // Skip clicks on the recording UI itself
    if (target.closest('[data-path-recording-ui]')) return;

    // Skip clicks on the diagnostics banner
    if (target.closest('[data-diagnostics-banner]')) return;

    const wizTargetId = getWizardTargetId(target);
    const selector = generateCssSelector(target);

    const step: RecordedStep = {
      route: window.location.pathname,
      wizardTargetId: wizTargetId || undefined,
      highlightSelector: wizTargetId ? undefined : selector,
      timestamp: Date.now(),
      elementTagName: target.tagName.toLowerCase(),
      elementText: (target.textContent || '').slice(0, 50).trim(),
    };

    setSteps(prev => [...prev, step]);
  }, []);

  const startRecording = useCallback(() => {
    setSteps([]);
    setIsRecording(true);

    // Add global click listener in capture phase
    const handler = (e: MouseEvent) => handleClick(e);
    clickHandlerRef.current = handler;
    document.addEventListener('click', handler, { capture: true });
  }, [handleClick]);

  const stopRecording = useCallback(() => {
    setIsRecording(false);

    // Remove global click listener
    if (clickHandlerRef.current) {
      document.removeEventListener('click', clickHandlerRef.current, { capture: true });
      clickHandlerRef.current = null;
    }

    return steps;
  }, [steps]);

  const downloadWizard = useCallback((title: string) => {
    if (steps.length === 0) return;

    const pages: HelpWizardPage[] = steps.map((step, index) => ({
      title: `Step ${index + 1}`,
      description: `[Edit this description] Clicked on ${step.elementTagName}${step.elementText ? `: "${step.elementText}"` : ''}`,
      route: step.route,
      wizardTargetId: step.wizardTargetId,
      highlightSelector: step.highlightSelector,
      position: 'bottom-center' as const,
    }));

    const wizard: Omit<HelpWizard, 'createdAt' | 'updatedAt'> = {
      id: `recorded-${Date.now()}`,
      title: title || 'Recorded Wizard',
      pages,
      status: 'draft',
      order: 99,
    };

    const blob = new Blob([JSON.stringify(wizard, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `helpwizard-recorded-${Date.now()}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    setSteps([]);
  }, [steps]);

  const clearRecording = useCallback(() => {
    setSteps([]);
    setIsRecording(false);
    if (clickHandlerRef.current) {
      document.removeEventListener('click', clickHandlerRef.current, { capture: true });
      clickHandlerRef.current = null;
    }
  }, []);

  const value: PathRecordingContextType = {
    isRecording,
    steps,
    startRecording,
    stopRecording,
    downloadWizard,
    clearRecording,
  };

  return (
    <PathRecordingContext.Provider value={value}>
      {children}
    </PathRecordingContext.Provider>
  );
}

export function usePathRecording(): PathRecordingContextType {
  const context = useContext(PathRecordingContext);
  if (context === undefined) {
    throw new Error('usePathRecording must be used within PathRecordingProvider');
  }
  return context;
}

export function usePathRecordingOptional(): PathRecordingContextType | null {
  return useContext(PathRecordingContext) || null;
}
