'use client';

import { useState, useRef, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Pencil, LoaderCircle, Check, X } from 'lucide-react';
import { cn } from '@/lib/utils';

type StoryTitleEditorProps = {
  initialTitle: string;
  onSave: (newTitle: string) => Promise<void>;
  className?: string;
};

export function StoryTitleEditor({ initialTitle, onSave, className }: StoryTitleEditorProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [title, setTitle] = useState(initialTitle);
  const [isSaving, setIsSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isEditing]);

  useEffect(() => {
    setTitle(initialTitle);
  }, [initialTitle]);

  const handleSave = async () => {
    const trimmed = title.trim();
    if (trimmed === initialTitle.trim() || !trimmed) {
      setTitle(initialTitle);
      setIsEditing(false);
      return;
    }

    setIsSaving(true);
    try {
      await onSave(trimmed);
      setIsEditing(false);
    } catch (error) {
      console.error('Failed to save title:', error);
      setTitle(initialTitle);
    } finally {
      setIsSaving(false);
    }
  };

  const handleCancel = () => {
    setTitle(initialTitle);
    setIsEditing(false);
  };

  if (!isEditing) {
    return (
      <div className={cn('flex items-center gap-2 group', className)}>
        <h3 className="text-xl font-semibold">{title}</h3>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setIsEditing(true)}
          className="opacity-0 group-hover:opacity-100 transition-opacity h-8 w-8 p-0"
        >
          <Pencil className="h-4 w-4" />
        </Button>
      </div>
    );
  }

  return (
    <div className={cn('flex items-center gap-2', className)}>
      <Input
        ref={inputRef}
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') handleSave();
          if (e.key === 'Escape') handleCancel();
        }}
        disabled={isSaving}
        className="text-xl font-semibold h-10"
      />
      {isSaving ? (
        <LoaderCircle className="h-5 w-5 animate-spin text-muted-foreground" />
      ) : (
        <>
          <Button variant="ghost" size="sm" onClick={handleSave} className="h-8 w-8 p-0">
            <Check className="h-4 w-4 text-green-600" />
          </Button>
          <Button variant="ghost" size="sm" onClick={handleCancel} className="h-8 w-8 p-0">
            <X className="h-4 w-4 text-red-600" />
          </Button>
        </>
      )}
    </div>
  );
}
