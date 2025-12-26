'use client';

import { useState, useCallback, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Trash2, Undo2, AlertTriangle } from 'lucide-react';

export type DeletedItem = {
  id: string;
  name: string;
  type: 'child' | 'character' | 'storybook';
};

type DeleteWithUndoProps = {
  item: { id: string; name: string };
  itemType: 'child' | 'character' | 'storybook';
  onDelete: (id: string) => Promise<void>;
  onUndo: (id: string) => Promise<void>;
  buttonVariant?: 'default' | 'destructive' | 'outline' | 'secondary' | 'ghost' | 'link';
  buttonSize?: 'default' | 'sm' | 'lg' | 'icon';
  showIcon?: boolean;
  className?: string;
};

export function DeleteButton({
  item,
  itemType,
  onDelete,
  buttonVariant = 'outline',
  buttonSize = 'sm',
  showIcon = true,
  className,
}: Omit<DeleteWithUndoProps, 'onUndo'>) {
  const [isDeleting, setIsDeleting] = useState(false);

  const itemTypeLabel = {
    child: 'child profile',
    character: 'character',
    storybook: 'storybook',
  }[itemType];

  const handleDelete = async () => {
    setIsDeleting(true);
    try {
      await onDelete(item.id);
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button
          variant={buttonVariant}
          size={buttonSize}
          className={className}
          disabled={isDeleting}
        >
          {showIcon && <Trash2 className="mr-1 h-3 w-3" />}
          Delete
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-destructive" />
            Delete {item.name}?
          </AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-2 text-sm text-muted-foreground">
              <p>
                Are you sure you want to delete this {itemTypeLabel}? It will be hidden from your view.
              </p>
              <p className="text-destructive font-medium">
                Only an administrator will be able to restore deleted items. Contact support if you need to recover this {itemTypeLabel}.
              </p>
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={handleDelete}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            {isDeleting ? 'Deleting...' : 'Delete'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

type UndoBannerProps = {
  deletedItem: DeletedItem | null;
  onUndo: (id: string) => Promise<void>;
  onDismiss: () => void;
  autoDismissMs?: number;
};

export function UndoBanner({
  deletedItem,
  onUndo,
  onDismiss,
  autoDismissMs = 10000, // 10 seconds default
}: UndoBannerProps) {
  const [isUndoing, setIsUndoing] = useState(false);
  const [countdown, setCountdown] = useState(Math.ceil(autoDismissMs / 1000));

  // Auto-dismiss after timeout
  useEffect(() => {
    if (!deletedItem) return;

    setCountdown(Math.ceil(autoDismissMs / 1000));

    const countdownInterval = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(countdownInterval);
  }, [deletedItem, autoDismissMs]);

  // Handle dismiss when countdown reaches 0
  useEffect(() => {
    if (countdown === 0 && deletedItem) {
      onDismiss();
    }
  }, [countdown, deletedItem, onDismiss]);

  const handleUndo = async () => {
    if (!deletedItem) return;

    setIsUndoing(true);
    try {
      await onUndo(deletedItem.id);
      onDismiss();
    } finally {
      setIsUndoing(false);
    }
  };

  if (!deletedItem) return null;

  const itemTypeLabel = {
    child: 'Child profile',
    character: 'Character',
    storybook: 'Storybook',
  }[deletedItem.type];

  return (
    <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 animate-in slide-in-from-bottom-4 duration-300">
      <div className="bg-foreground text-background px-4 py-3 rounded-lg shadow-lg flex items-center gap-4 max-w-md">
        <div className="flex-grow">
          <p className="font-medium">
            {itemTypeLabel} "{deletedItem.name}" deleted
          </p>
          <p className="text-sm opacity-80">
            Undo available for {countdown}s
          </p>
        </div>
        <Button
          variant="secondary"
          size="sm"
          onClick={handleUndo}
          disabled={isUndoing}
          className="shrink-0"
        >
          <Undo2 className="mr-1 h-4 w-4" />
          {isUndoing ? 'Undoing...' : 'Undo'}
        </Button>
      </div>
    </div>
  );
}

// Hook for managing delete/undo state
export function useDeleteWithUndo() {
  const [deletedItem, setDeletedItem] = useState<DeletedItem | null>(null);

  const markAsDeleted = useCallback((item: DeletedItem) => {
    setDeletedItem(item);
  }, []);

  const clearDeletedItem = useCallback(() => {
    setDeletedItem(null);
  }, []);

  return {
    deletedItem,
    markAsDeleted,
    clearDeletedItem,
  };
}
