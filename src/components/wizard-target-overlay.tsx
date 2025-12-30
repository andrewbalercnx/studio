'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { useWizardTargetDiagnosticsOptional } from '@/hooks/use-wizard-target-diagnostics';
import { usePathRecordingOptional } from '@/hooks/use-path-recording';
import { cn } from '@/lib/utils';

interface TargetInfo {
  id: string;
  top: number;
  left: number;
  width: number;
  height: number;
}

/**
 * WizardTargetOverlay renders visual indicators for all elements with data-wiz-target attributes.
 * When wizard target diagnostics mode is enabled, it shows:
 * - A colored border around each targetable element
 * - A tooltip badge showing the target ID
 *
 * This helps Help Wizard editors identify which selectors to use.
 */
export function WizardTargetOverlay() {
  const diagnostics = useWizardTargetDiagnosticsOptional();
  const pathRecording = usePathRecordingOptional();
  const [targets, setTargets] = useState<TargetInfo[]>([]);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const rafRef = useRef<number | null>(null);

  // Scan for all elements with data-wiz-target attribute
  const scanTargets = useCallback(() => {
    // Cancel any pending animation frame
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
    }

    // Use requestAnimationFrame to batch DOM reads and ensure accurate measurements
    rafRef.current = requestAnimationFrame(() => {
      const elements = document.querySelectorAll('[data-wiz-target]');
      const newTargets: TargetInfo[] = [];

      elements.forEach((element) => {
        const id = element.getAttribute('data-wiz-target');
        if (id) {
          const rect = element.getBoundingClientRect();
          // Only include visible elements
          if (rect.width > 0 && rect.height > 0) {
            newTargets.push({
              id,
              top: rect.top,
              left: rect.left,
              width: rect.width,
              height: rect.height,
            });
          }
        }
      });

      setTargets(newTargets);
    });
  }, []);

  // Scan on mount and when diagnostics mode changes
  useEffect(() => {
    if (!diagnostics?.enabled) {
      setTargets([]);
      return;
    }

    // Initial scan after a short delay to ensure DOM is ready
    const initialTimeout = setTimeout(scanTargets, 100);

    // Set up a MutationObserver to detect DOM changes
    const observer = new MutationObserver(() => {
      scanTargets();
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['data-wiz-target'],
    });

    // Update positions on scroll/resize with passive listeners for performance
    const handleUpdate = () => scanTargets();
    window.addEventListener('scroll', handleUpdate, { capture: true, passive: true });
    window.addEventListener('resize', handleUpdate, { passive: true });

    // Periodic refresh for dynamic content
    const intervalId = setInterval(scanTargets, 1000);

    return () => {
      clearTimeout(initialTimeout);
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
      }
      observer.disconnect();
      window.removeEventListener('scroll', handleUpdate, { capture: true } as EventListenerOptions);
      window.removeEventListener('resize', handleUpdate);
      clearInterval(intervalId);
    };
  }, [diagnostics?.enabled, scanTargets]);

  // Handle copying target ID to clipboard
  const handleCopyId = useCallback(async (id: string) => {
    try {
      await navigator.clipboard.writeText(`[data-wiz-target="${id}"]`);
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  }, []);

  // Don't render if diagnostics mode is not enabled
  if (!diagnostics?.enabled) {
    return null;
  }

  return (
    <>
      {/* Diagnostic mode indicator banner - click to disable */}
      <button
        onClick={() => diagnostics?.disable()}
        data-diagnostics-banner
        className={cn(
          "fixed top-14 left-0 right-0 z-[60] text-center py-1 text-sm font-medium transition-colors cursor-pointer",
          pathRecording?.isRecording
            ? "bg-red-500 text-white animate-pulse"
            : "bg-amber-500 text-amber-950 hover:bg-amber-400"
        )}
      >
        {pathRecording?.isRecording
          ? `🔴 Recording Path — ${pathRecording.steps.length} steps captured. Use menu to stop.`
          : '🎯 Wizard Target Diagnostics Mode — Click here to exit, or click any target badge to copy its selector'
        }
      </button>

      {/* Render overlays for each target */}
      {targets.map((target) => (
        <div key={target.id}>
          {/* Border highlight around the element - pointer-events-none so clicks pass through */}
          <div
            className="pointer-events-none fixed z-[45] rounded border-2 border-dashed border-amber-500"
            style={{
              top: target.top - 2,
              left: target.left - 2,
              width: target.width + 4,
              height: target.height + 4,
            }}
          />

          {/* Target ID badge - positioned to the right of the element to avoid blocking */}
          <button
            onClick={() => handleCopyId(target.id)}
            className={cn(
              "fixed z-[45] px-2 py-0.5 rounded text-xs font-mono font-medium shadow-lg",
              "transition-all duration-150 cursor-pointer",
              "hover:scale-105 active:scale-95",
              copiedId === target.id
                ? "bg-green-500 text-white"
                : "bg-amber-500 text-amber-950 hover:bg-amber-400"
            )}
            style={{
              // Position badge to the right of the element, or above if no room on right
              top: target.left + target.width + 100 < window.innerWidth
                ? target.top
                : Math.max(0, target.top - 24),
              left: target.left + target.width + 100 < window.innerWidth
                ? target.left + target.width + 4
                : target.left,
            }}
            title={`Click to copy: [data-wiz-target="${target.id}"]`}
          >
            {copiedId === target.id ? '✓ Copied!' : target.id}
          </button>
        </div>
      ))}
    </>
  );
}
