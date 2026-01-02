
'use client';

import { useEffect, useMemo, useState, useRef } from 'react';
import { useAppContext } from '@/hooks/use-app-context';
import { useDocument } from '@/lib/firestore-hooks';
import { useFirestore } from '@/firebase';
import { doc } from 'firebase/firestore';
import type { HelpWizard, HelpWizardPosition } from '@/lib/types';
import { DEFAULT_WIZARD_POSITION } from '@/lib/types';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { LoaderCircle, X, ChevronLeft, ChevronRight } from 'lucide-react';
import { useRouter } from 'next/navigation';
import Markdown from 'react-markdown';

// Calculate pixel position from HelpWizardPosition
const DIALOG_WIDTH = 448;
const MARGIN = 24;
const HEADER_HEIGHT = 56;

// Detect Chrome browser (includes Edge Chromium, but not Firefox or Safari)
function isChromeBrowser(): boolean {
  if (typeof window === 'undefined') return false;
  const ua = navigator.userAgent;
  // Chrome includes "Chrome" but not "Edg" (Edge) - though Edge Chromium has same rendering
  // We check for Chrome specifically and exclude Firefox/Safari
  return /Chrome/.test(ua) && !/Firefox/.test(ua);
}

function getPositionFromSetting(
  setting: HelpWizardPosition,
  dialogHeight: number = 300 // Default estimate, will be updated after render
): { x: number; y: number } {
  const vw = typeof window !== 'undefined' ? window.innerWidth : 1024;
  const vh = typeof window !== 'undefined' ? window.innerHeight : 768;

  let x: number;
  let y: number;

  // Horizontal position
  if (setting.includes('left')) {
    x = MARGIN;
  } else if (setting.includes('right')) {
    x = vw - DIALOG_WIDTH - MARGIN;
  } else {
    // center
    x = (vw - DIALOG_WIDTH) / 2;
  }

  // Vertical position - ensure dialog stays within viewport
  if (setting.includes('top')) {
    y = MARGIN + HEADER_HEIGHT;
  } else if (setting.includes('bottom')) {
    // Position so the bottom of the dialog is at the bottom of the viewport (minus margin)
    y = vh - dialogHeight - MARGIN;
  } else {
    // center
    y = (vh - dialogHeight) / 2;
  }

  // Clamp to viewport bounds
  const maxX = Math.max(0, vw - DIALOG_WIDTH - MARGIN);
  const maxY = Math.max(0, vh - dialogHeight - MARGIN);
  const minY = MARGIN + HEADER_HEIGHT;

  x = Math.max(MARGIN, Math.min(x, maxX));
  y = Math.max(minY, Math.min(y, maxY));

  return { x, y };
}

export function HelpWizard() {
  const { activeWizard, advanceWizard, goBackWizard, closeWizard } = useAppContext();
  const firestore = useFirestore();
  const router = useRouter();

  const wizardRef = useMemo(() => {
    if (!firestore || !activeWizard) return null;
    return doc(firestore, 'helpWizards', activeWizard.id);
  }, [firestore, activeWizard]);

  const { data: wizard, loading: wizardLoading, error: wizardError } = useDocument<HelpWizard>(wizardRef);

  const [returnUrl, setReturnUrl] = useState<string | null>(null);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [highlightRect, setHighlightRect] = useState<DOMRect | null>(null);
  const [isChrome, setIsChrome] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const offsetRef = useRef({ x: 0, y: 0 });

  // Detect Chrome on mount
  useEffect(() => {
    setIsChrome(isChromeBrowser());
  }, []);

  const currentPage = useMemo(() => {
    if (!wizard || !activeWizard || !wizard.pages) return null;
    return wizard.pages[activeWizard.step] ?? null;
  }, [wizard, activeWizard]);

  useEffect(() => {
    if (activeWizard && !returnUrl) {
      setReturnUrl(window.location.pathname);
    }
    if (!activeWizard) {
      setReturnUrl(null);
    }
  }, [activeWizard, returnUrl]);

  // Update dialog position when the current page changes or on initial load
  useEffect(() => {
    if (!currentPage) return;
    const positionSetting = currentPage.position || DEFAULT_WIZARD_POSITION;

    // Initial position with estimated height
    const newPosition = getPositionFromSetting(positionSetting);
    setPosition(newPosition);

    // After render, measure actual height and recalculate if needed
    const measureAndReposition = () => {
      if (dialogRef.current) {
        const actualHeight = dialogRef.current.getBoundingClientRect().height;
        const adjustedPosition = getPositionFromSetting(positionSetting, actualHeight);
        setPosition(adjustedPosition);
      }
    };

    // Use requestAnimationFrame to wait for render
    const rafId = requestAnimationFrame(measureAndReposition);
    return () => cancelAnimationFrame(rafId);
  }, [currentPage]);

  // Also update position on window resize
  useEffect(() => {
    const handleResize = () => {
      if (!currentPage || !dialogRef.current) return;
      const positionSetting = currentPage.position || DEFAULT_WIZARD_POSITION;
      const actualHeight = dialogRef.current.getBoundingClientRect().height;
      const newPosition = getPositionFromSetting(positionSetting, actualHeight);
      setPosition(newPosition);
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [currentPage]);

  useEffect(() => {
    if (currentPage?.route) {
      router.push(currentPage.route);
    }
  }, [currentPage, router]);

  // Handle element highlighting - supports both wizardTargetId and highlightSelector
  useEffect(() => {
    // Determine the selector to use: prefer wizardTargetId, fall back to highlightSelector
    const selector = currentPage?.wizardTargetId
      ? `[data-wiz-target="${currentPage.wizardTargetId}"]`
      : currentPage?.highlightSelector;

    if (!selector) {
      setHighlightRect(null);
      return;
    }

    // Small delay to allow page navigation to complete
    const timeoutId = setTimeout(() => {
      const element = document.querySelector(selector);
      if (element) {
        const rect = element.getBoundingClientRect();
        setHighlightRect(rect);

        // Scroll element into view if needed
        element.scrollIntoView({ behavior: 'smooth', block: 'center' });
      } else {
        setHighlightRect(null);
      }
    }, 300);

    // Update highlight position on scroll/resize
    const updateHighlight = () => {
      const element = document.querySelector(selector);
      if (element) {
        setHighlightRect(element.getBoundingClientRect());
      }
    };

    window.addEventListener('scroll', updateHighlight, true);
    window.addEventListener('resize', updateHighlight);

    return () => {
      clearTimeout(timeoutId);
      window.removeEventListener('scroll', updateHighlight, true);
      window.removeEventListener('resize', updateHighlight);
    };
  }, [currentPage?.wizardTargetId, currentPage?.highlightSelector, currentPage?.route]);

  const handleClose = () => {
    if (returnUrl) {
      router.push(returnUrl);
    }
    closeWizard();
  };

  const handleNext = () => {
    // Execute action before advancing (e.g., click the highlighted element)
    if (currentPage?.action === 'click') {
      const selector = currentPage.wizardTargetId
        ? `[data-wiz-target="${currentPage.wizardTargetId}"]`
        : currentPage.highlightSelector;

      console.debug('[HelpWizard] Click action triggered', {
        wizardTargetId: currentPage.wizardTargetId,
        highlightSelector: currentPage.highlightSelector,
        selector
      });

      if (selector) {
        const element = document.querySelector(selector) as HTMLElement;
        console.debug('[HelpWizard] Element lookup result', {
          found: !!element,
          tagName: element?.tagName,
          selector
        });

        if (element) {
          console.debug('[HelpWizard] Clicking element...', element);
          element.click();
          // Add a short delay after clicking so the user can see what opened
          setTimeout(() => {
            if (wizard && activeWizard && activeWizard.step < wizard.pages.length - 1) {
              advanceWizard();
            } else {
              handleClose();
            }
          }, 500);
          return;
        } else {
          console.warn('[HelpWizard] Element not found for selector:', selector);
        }
      }
    }

    if (wizard && activeWizard && activeWizard.step < wizard.pages.length - 1) {
      advanceWizard();
    } else {
      handleClose();
    }
  };

  const handlePrev = () => {
    if (activeWizard && activeWizard.step > 0) {
      goBackWizard();
    }
  };
  
  const onMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!dialogRef.current) return;
    setIsDragging(true);
    const rect = dialogRef.current.getBoundingClientRect();
    offsetRef.current = {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    };
    document.body.style.userSelect = 'none';
  };

  const onMouseMove = (e: MouseEvent) => {
    if (!isDragging) return;
    setPosition({
      x: e.clientX - offsetRef.current.x,
      y: e.clientY - offsetRef.current.y,
    });
  };

  const onMouseUp = () => {
    setIsDragging(false);
    document.body.style.userSelect = '';
  };
  
  useEffect(() => {
    if (isDragging) {
      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);
    } else {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    }
    return () => {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };
  }, [isDragging]);


  if (!activeWizard) {
    return null;
  }

  return (
    <>
      {/* Highlight overlay - Chrome uses red border, others use ring with spotlight */}
      {/* z-[55] to stay above most dialogs (z-50) but below the wizard dialog (z-[60]) */}
      {highlightRect && (
        isChrome ? (
          // Chrome-compatible: simple red border without box-shadow spotlight
          <div
            className="pointer-events-none fixed z-[55] rounded-lg"
            style={{
              top: highlightRect.top - 6,
              left: highlightRect.left - 6,
              width: highlightRect.width + 12,
              height: highlightRect.height + 12,
              border: '4px solid #dc2626', // red-600
              backgroundColor: 'transparent',
            }}
          />
        ) : (
          // Other browsers: ring with spotlight effect
          <div
            className="pointer-events-none fixed z-[55] rounded-lg ring-4 ring-primary ring-offset-2 ring-offset-background"
            style={{
              top: highlightRect.top - 4,
              left: highlightRect.left - 4,
              width: highlightRect.width + 8,
              height: highlightRect.height + 8,
              boxShadow: '0 0 0 9999px rgba(0, 0, 0, 0.5)',
            }}
          />
        )
      )}
      <Dialog open={true} onOpenChange={(isOpen) => !isOpen && handleClose()} modal={false}>
       <DialogContent
        ref={dialogRef}
        className="sm:max-w-md cursor-grab z-[60]"
        onMouseDown={onMouseDown}
        style={{
          position: 'fixed',
          top: `${position.y}px`,
          left: `${position.x}px`,
          transform: 'none', // Override shadcn centering
        }}
        onInteractOutside={(e) => e.preventDefault()}
        onPointerDownOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
        hideOverlay={true}
      >
        <DialogHeader>
          <DialogTitle>{currentPage?.title ?? wizard?.title ?? 'Loading Help...'}</DialogTitle>
          {wizardLoading && (
            <div className="flex justify-center py-8">
              <LoaderCircle className="h-8 w-8 animate-spin text-primary" />
            </div>
          )}
          {wizardError && <DialogDescription className="text-destructive">Could not load help content.</DialogDescription>}
          {currentPage && 
            <DialogDescription asChild>
                <div className="prose prose-sm text-muted-foreground">
                    <Markdown>{currentPage.description}</Markdown>
                </div>
            </DialogDescription>
          }
        </DialogHeader>
        <DialogFooter className="sm:justify-between">
          <Button variant="ghost" onClick={handleClose}>
            End Tour
          </Button>
          <div className="flex gap-2">
            <Button variant="outline" onClick={handlePrev} disabled={!activeWizard || activeWizard.step === 0}>
              <ChevronLeft className="mr-2 h-4 w-4" /> Previous
            </Button>
            <Button onClick={handleNext}>
              {wizard && activeWizard && activeWizard.step >= wizard.pages.length - 1 ? 'Finish' : 'Next'}
              <ChevronRight className="ml-2 h-4 w-4" />
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    </>
  );
}
