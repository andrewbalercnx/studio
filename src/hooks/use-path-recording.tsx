'use client';

import React, { createContext, useContext, useState, useCallback, useRef } from 'react';
import { generateCssSelector, getWizardTargetId } from '@/lib/css-selector';
import type { HelpWizardPage, HelpWizard } from '@/lib/types';

/**
 * Map of dynamic route parameter names to their help-* sample document IDs.
 * These IDs match the documents created by the help sample data seeder.
 */
const HELP_ID_MAPPINGS: Record<string, string> = {
  childId: 'help-child',
  characterId: 'help-character',
  sessionId: 'help-session',
  storyId: 'help-story',
  storybookId: 'help-storybook',
  bookId: 'help-storybook',
  printStoryBookId: 'help-print-storybook',
  orderId: 'help-print-order',
};

/**
 * Replace dynamic route segments with help-* IDs for wizard recordings.
 * This allows recorded wizards to work with the sample help data.
 *
 * Examples:
 * - /child/abc123/story/xyz789 → /child/help-child/story/help-story
 * - /story/play/abc123 → /story/play/help-session
 */
function replaceRouteWithHelpIds(route: string): string {
  // Match common dynamic ID patterns (UUIDs, Firebase IDs, etc.)
  // but skip paths that are clearly not IDs (like 'create-book', 'print-layout')
  const segments = route.split('/');
  const result: string[] = [];

  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i];
    const prevSegment = segments[i - 1];

    // Check if this segment looks like a dynamic ID
    // (alphanumeric, 10+ chars, or contains numbers mixed with letters)
    const looksLikeId = segment.length >= 10 &&
      /^[a-zA-Z0-9_-]+$/.test(segment) &&
      !/^[a-z-]+$/.test(segment); // Not a route name like 'create-book'

    if (looksLikeId && prevSegment) {
      // Determine which help ID to use based on the previous segment
      const paramName = getParamNameFromSegment(prevSegment);
      if (paramName && HELP_ID_MAPPINGS[paramName]) {
        result.push(HELP_ID_MAPPINGS[paramName]);
        continue;
      }
    }

    result.push(segment);
  }

  return result.join('/');
}

/**
 * Map route segment names to their parameter names.
 */
function getParamNameFromSegment(segment: string): string | null {
  const mapping: Record<string, string> = {
    'child': 'childId',
    'character': 'characterId',
    'session': 'sessionId',
    'story': 'storyId',
    'storybook': 'storybookId',
    'book': 'bookId',
    'play': 'sessionId',
    'read': 'bookId',
    'create': 'sessionId',
    'wizard': 'sessionId',
    'type': 'sessionId',
    'print-layout': 'printStoryBookId',
    'print-orders': 'orderId',
  };
  return mapping[segment] || null;
}

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

    // Generate two pages per recorded click:
    // 1. First page highlights the element with action: 'click' (wizard will click it when user advances)
    // 2. Second page shows the result after clicking (same route, no highlight)
    const pages: HelpWizardPage[] = [];
    let pageNumber = 1;

    steps.forEach((step) => {
      // Replace dynamic IDs in route with help-* IDs
      const helpRoute = replaceRouteWithHelpIds(step.route);

      // Page 1: Highlight the element to click, with action: 'click'
      pages.push({
        title: `Step ${pageNumber}`,
        description: `[Edit] Click on ${step.elementTagName}${step.elementText ? `: "${step.elementText}"` : ''}`,
        route: helpRoute,
        wizardTargetId: step.wizardTargetId,
        highlightSelector: step.highlightSelector,
        position: 'bottom-center' as const,
        action: 'click',
      });
      pageNumber++;

      // Page 2: Show the opened content (no highlight, user describes what opened)
      pages.push({
        title: `Step ${pageNumber}`,
        description: `[Edit] Describe what opened or appeared after clicking`,
        route: helpRoute,
        position: 'center-center' as const,
        // No highlight or action - this is for showing/describing the result
      });
      pageNumber++;
    });

    const wizard: Omit<HelpWizard, 'createdAt' | 'updatedAt'> = {
      id: `recorded-${Date.now()}`,
      title: title || 'Recorded Wizard',
      pages,
      status: 'draft',
      role: 'parent',
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
