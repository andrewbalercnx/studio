
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
// Dialog is approximately 448px wide and 250px tall
const DIALOG_WIDTH = 448;
const DIALOG_HEIGHT = 250;
const MARGIN = 24;

function getPositionFromSetting(setting: HelpWizardPosition): { x: number; y: number } {
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
    x = (vw - DIALOG_WIDTH) / 2;
  }

  // Vertical position
  if (setting.includes('top')) {
    y = MARGIN + 56; // Account for header height
  } else if (setting.includes('bottom')) {
    y = vh - DIALOG_HEIGHT - MARGIN;
  } else {
    y = (vh - DIALOG_HEIGHT) / 2;
  }

  return { x, y };
}

export function HelpWizard() {
  const { activeWizard, advanceWizard, closeWizard } = useAppContext();
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
  const dialogRef = useRef<HTMLDivElement>(null);
  const offsetRef = useRef({ x: 0, y: 0 });

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
    const newPosition = getPositionFromSetting(positionSetting);
    setPosition(newPosition);
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
    if (wizard && activeWizard && activeWizard.step < wizard.pages.length - 1) {
      advanceWizard();
    } else {
      handleClose();
    }
  };

  const handlePrev = () => {
    // This is a simple implementation; a more complex one might use a state stack.
    // For now, we just close it.
    handleClose();
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
      {/* Highlight overlay for selected element */}
      {highlightRect && (
        <div
          className="pointer-events-none fixed inset-0 z-40"
          style={{
            background: `
              linear-gradient(to bottom, rgba(0,0,0,0.5) ${highlightRect.top - 8}px, transparent ${highlightRect.top - 8}px),
              linear-gradient(to top, rgba(0,0,0,0.5) ${window.innerHeight - highlightRect.bottom - 8}px, transparent ${window.innerHeight - highlightRect.bottom - 8}px),
              linear-gradient(to right, rgba(0,0,0,0.5) ${highlightRect.left - 8}px, transparent ${highlightRect.left - 8}px),
              linear-gradient(to left, rgba(0,0,0,0.5) ${window.innerWidth - highlightRect.right - 8}px, transparent ${window.innerWidth - highlightRect.right - 8}px)
            `,
          }}
        />
      )}
      {highlightRect && (
        <div
          className="pointer-events-none fixed z-40 rounded-lg ring-4 ring-primary ring-offset-2 ring-offset-background"
          style={{
            top: highlightRect.top - 4,
            left: highlightRect.left - 4,
            width: highlightRect.width + 8,
            height: highlightRect.height + 8,
          }}
        />
      )}
      <Dialog open={true} onOpenChange={(isOpen) => !isOpen && handleClose()} modal={false}>
       <DialogContent
        ref={dialogRef}
        className="sm:max-w-md cursor-grab"
        onMouseDown={onMouseDown}
        style={{
          position: 'fixed',
          top: `${position.y}px`,
          left: `${position.x}px`,
          transform: 'none', // Override shadcn centering
        }}
        onInteractOutside={(e) => e.preventDefault()}
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
