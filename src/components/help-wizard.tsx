
'use client';

import { useEffect, useMemo, useState, useRef } from 'react';
import { useAppContext } from '@/hooks/use-app-context';
import { useDocument } from '@/lib/firestore-hooks';
import { useFirestore } from '@/firebase';
import { doc } from 'firebase/firestore';
import type { HelpWizard } from '@/lib/types';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { LoaderCircle, X, ChevronLeft, ChevronRight } from 'lucide-react';
import { useRouter } from 'next/navigation';
import Markdown from 'react-markdown';

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
  const dialogRef = useRef<HTMLDivElement>(null);
  const offsetRef = useRef({ x: 0, y: 0 });

  useEffect(() => {
    if (activeWizard && !returnUrl) {
      setReturnUrl(window.location.pathname);
      // Center the dialog on first open
      setPosition({
        x: window.innerWidth / 2 - 224, // Assumes 448px width
        y: window.innerHeight / 2 - 150, // Approximate height
      });
    }
    if (!activeWizard) {
      setReturnUrl(null);
    }
  }, [activeWizard, returnUrl]);

  const currentPage = useMemo(() => {
    if (!wizard || !activeWizard || !wizard.pages) return null;
    return wizard.pages[activeWizard.step] ?? null;
  }, [wizard, activeWizard]);

  useEffect(() => {
    if (currentPage?.route) {
      router.push(currentPage.route);
    }
  }, [currentPage, router]);

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
  );
}
